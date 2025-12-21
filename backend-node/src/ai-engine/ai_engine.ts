import { performance } from 'perf_hooks';
import fs from 'fs/promises';
import path from 'path';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { Agent } from '../agent';
import * as db from '../db';
import { AiContextManager } from './context_manager';
import {
  AiChatRequest,
  AiChatResponse,
  AiEditorActionRequest,
  AiEditorActionResponse,
  AiEmbeddingsRequest,
  AiEmbeddingsResponse,
  AiEngineRequest,
  AiEngineResponse,
  AiInlineRequest,
  AiInlineResponse,
  AiRouteTarget,
  AiToolsRequest,
  AiToolsResponse
} from './contracts';
import { AiEngineConfigStore } from './config_store';
import { AiEngineMetrics } from './metrics';
import { decideRoute } from './router';
import { LlmClientFactory } from './llm_factory';
import { embedTexts } from './embeddings';
import { AiToolExecutor } from './tool_executor';
import { normalizeRuntimeConfig, AiEngineRuntimeConfig } from './runtime_config';
import { getWorkspaceRoot } from '../context';
import { getProjectStructure } from '../tools/filesystem';

function ensureRequestId(req: AiEngineRequest) {
  return req.requestId && req.requestId.trim().length > 0 ? req.requestId : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getSystemContextMaxChars(contextMaxLength: number | undefined) {
  const tokens = typeof contextMaxLength === 'number' && Number.isFinite(contextMaxLength) ? contextMaxLength : 128000;
  const approxChars = Math.floor(tokens * 4 * 0.06);
  return Math.max(6000, Math.min(18000, approxChars));
}

function extractQueryTokens(text: string) {
  const raw = (text || '').toLowerCase();
  const matches = raw.match(/[a-z_][a-z0-9_]{2,}/g) || [];
  const stop = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'your', 'you', 'are', 'not', 'can', 'will', 'use', 'using']);
  const uniq: string[] = [];
  for (const m of matches) {
    if (stop.has(m)) continue;
    if (!uniq.includes(m)) uniq.push(m);
    if (uniq.length >= 16) break;
  }
  return uniq;
}

function chunkByLines(text: string, opts?: { maxLines?: number; maxChars?: number; overlapLines?: number }) {
  const maxLines = opts?.maxLines ?? 80;
  const maxChars = opts?.maxChars ?? 2400;
  const overlapLines = opts?.overlapLines ?? 10;
  const lines = (text || '').split(/\r?\n/);
  const chunks: Array<{ startLine: number; endLine: number; text: string }> = [];
  let i = 0;
  while (i < lines.length) {
    const start = i;
    let end = Math.min(lines.length, start + maxLines);
    let out = lines.slice(start, end).join('\n');
    while (out.length > maxChars && end > start + 10) {
      end -= 5;
      out = lines.slice(start, end).join('\n');
    }
    if (out.trim().length > 0) {
      chunks.push({ startLine: start + 1, endLine: end, text: out });
    }
    if (end >= lines.length) break;
    i = Math.max(start + 1, end - overlapLines);
  }
  return chunks;
}

function cosine(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

function isQwen3EmbeddingModelName(model: string | undefined) {
  const m = (model || '').toLowerCase();
  return m.includes('qwen3-embedding');
}

function withQwen3Eot(text: string) {
  const t = text || '';
  return t.endsWith('<|endoftext|>') ? t : `${t}<|endoftext|>`;
}

async function buildRagAddendum(opts: {
  root: string;
  query: string;
  editorFilePath?: string;
  cfg: AiEngineRuntimeConfig;
  maxChars: number;
  embeddingModel?: string;
}) {
  const query = (opts.query || '').trim();
  if (!query) return '';

  const tokens = extractQueryTokens(query);
  if (tokens.length === 0 && query.length < 12) return '';

  let struct: any;
  try {
    struct = await getProjectStructure(opts.root);
  } catch {
    struct = null;
  }
  const entries: any[] = (struct && Array.isArray(struct.entries)) ? struct.entries : [];
  const candidates = entries.filter(e => e && e.type === 'file');

  const preferExt = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.py', '.go', '.rs', '.java', '.cs', '.cpp', '.c', '.h']);
  const scoredFiles = candidates
    .map(e => {
      const p = String(e.path || '');
      const baseRoot = typeof e.workspace_root === 'string' && e.workspace_root ? e.workspace_root : opts.root;
      const ext = path.extname(p).toLowerCase();
      let score = 0;
      const pLower = p.toLowerCase();
      if (opts.editorFilePath && pLower.endsWith(String(opts.editorFilePath).toLowerCase())) score += 8;
      for (const t of tokens) if (pLower.includes(t)) score += 2;
      if (preferExt.has(ext)) score += 1;
      return { baseRoot, path: p, score };
    })
    .filter(x => x.path && x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  const fallbackFiles = scoredFiles.length > 0
    ? scoredFiles
    : (struct?.entry_candidates && Array.isArray(struct.entry_candidates)
      ? struct.entry_candidates.slice(0, 5).map((p: string) => ({ baseRoot: opts.root, path: p, score: 1 }))
      : []);

  const filesToRead = (scoredFiles.length > 0 ? scoredFiles : fallbackFiles).slice(0, 12);
  if (filesToRead.length === 0) return '';

  const chunkCandidates: Array<{ filePath: string; startLine: number; endLine: number; text: string; lexicalScore: number }> = [];
  for (const f of filesToRead) {
    try {
      const fullPath = path.resolve(f.baseRoot, f.path);
      const stat = await fs.stat(fullPath);
      if (!stat.isFile() || stat.size > 400_000) continue;
      const content = await fs.readFile(fullPath, 'utf-8');
      if (!content || content.indexOf('\0') !== -1) continue;
      const chunks = chunkByLines(content, { maxLines: 80, maxChars: 2600, overlapLines: 12 });
      for (const c of chunks) {
        const lower = c.text.toLowerCase();
        let lexicalScore = 0;
        for (const t of tokens) {
          const re = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
          const m = lower.match(re);
          if (m) lexicalScore += Math.min(6, m.length);
        }
        if (lexicalScore === 0 && tokens.length > 0) continue;
        chunkCandidates.push({ filePath: f.path, startLine: c.startLine, endLine: c.endLine, text: c.text, lexicalScore });
        if (chunkCandidates.length >= 200) break;
      }
    } catch {
    }
    if (chunkCandidates.length >= 200) break;
  }

  const topLex = chunkCandidates
    .sort((a, b) => b.lexicalScore - a.lexicalScore)
    .slice(0, 24);
  if (topLex.length === 0) return '';

  const embeddingModel = opts.embeddingModel || opts.cfg.defaultModels?.embeddings;
  const useQwen3Eot = isQwen3EmbeddingModelName(embeddingModel);
  const queryInput = `Instruct: Given a code search query, retrieve relevant code snippets that answer the query.\nQuery: ${query}`;
  const embeddingInputs = [
    useQwen3Eot ? withQwen3Eot(queryInput) : queryInput,
    ...topLex.map(c => {
      const body = `file:${c.filePath}:${c.startLine}-${c.endLine}\n${c.text}`;
      return useQwen3Eot ? withQwen3Eot(body) : body;
    })
  ];

  let vectors: number[][];
  try {
    const out = await embedTexts(embeddingInputs, opts.cfg, embeddingModel);
    vectors = out.vectors;
  } catch {
    return '';
  }

  if (!vectors || vectors.length !== embeddingInputs.length) return '';
  const qv = vectors[0];
  const ranked = topLex
    .map((c, i) => ({ c, score: cosine(qv, vectors[i + 1]) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  const lines: string[] = [];
  lines.push('Relevant code snippets (retrieved):');
  for (const r of ranked) {
    const header = `${r.c.filePath}:${r.c.startLine}-${r.c.endLine}`;
    const body = r.c.text.length > 1800 ? `${r.c.text.slice(0, 1800)}\n[...truncated...]` : r.c.text;
    lines.push(`${header}\n${body}`);
  }
  const joined = lines.join('\n\n');
  return joined.length > opts.maxChars ? `${joined.slice(0, opts.maxChars)}\n[...truncated...]` : joined;
}

function mergeRuntimeConfig(base: AiEngineRuntimeConfig, llmConfig: Record<string, unknown> | undefined): AiEngineRuntimeConfig {
  if (!llmConfig) return base;
  const provider = typeof llmConfig.provider === 'string' ? llmConfig.provider : undefined;
  const apiKey = typeof llmConfig.api_key === 'string' ? llmConfig.api_key : undefined;
  const baseUrl = typeof llmConfig.base_url === 'string' ? llmConfig.base_url : undefined;
  const model = typeof llmConfig.model === 'string' ? llmConfig.model : undefined;
  const poolIdRaw = typeof (llmConfig as any).pool_id === 'string' ? String((llmConfig as any).pool_id) : undefined;
  const defaultModelsRaw = (llmConfig as any).default_models;
  const routingRaw = (llmConfig as any).routing;

  const next = normalizeRuntimeConfig(base);
  const supportedProviders = new Set(['openai', 'anthropic', 'openrouter', 'xai', 'ollama', 'lmstudio', 'llamacpp']);
  if (provider && supportedProviders.has(provider)) next.defaultProvider = provider as any;

  const poolId = (poolIdRaw && poolIdRaw.trim().length > 0 ? poolIdRaw.trim() : 'default');
  if (provider && supportedProviders.has(provider) && apiKey) {
    const prev = (next.providers as any)?.[provider];
    const prevPools = (prev && typeof prev === 'object' && prev.pools && typeof prev.pools === 'object') ? prev.pools : {};
    next.providers = {
      ...next.providers,
      [provider]: {
        defaultPoolId: poolId,
        pools: {
          ...prevPools,
          [poolId]: { apiKey, baseUrl }
        }
      }
    } as any;
  }

  if (defaultModelsRaw && typeof defaultModelsRaw === 'object') {
    const incoming: any = {};
    for (const key of ['general', 'fast', 'reasoning', 'tools', 'embeddings']) {
      const val = (defaultModelsRaw as any)[key];
      if (typeof val === 'string' && val.trim().length > 0) incoming[key] = val.trim();
    }
    if (Object.keys(incoming).length > 0) {
      next.defaultModels = { ...next.defaultModels, ...incoming };
    }
  }

  if (routingRaw && typeof routingRaw === 'object') {
    const nextRouting: any = { ...(next.routing || {}) };
    const capabilities = ['chat', 'inline', 'editorAction', 'tools', 'embeddings'];
    for (const cap of capabilities) {
      const list = (routingRaw as any)[cap];
      if (!Array.isArray(list)) continue;
      const normalized = list
        .map((t: any) => {
          const p = typeof t?.provider === 'string' ? String(t.provider) : '';
          if (!p || !supportedProviders.has(p)) return null;
          const out: any = { provider: p };
          if (typeof t?.model === 'string' && String(t.model).trim().length > 0) out.model = String(t.model).trim();
          const poolId = typeof t?.poolId === 'string' ? String(t.poolId).trim() : '';
          if (poolId) out.poolId = poolId;
          const tags = Array.isArray(t?.tags) ? t.tags.filter((x: any) => typeof x === 'string' && x.trim().length > 0) : null;
          if (tags && tags.length > 0) out.tags = tags;
          return out;
        })
        .filter(Boolean);
      if (normalized.length > 0) nextRouting[cap] = normalized;
    }
    next.routing = nextRouting;
  }

  if (model) next.defaultModels = { ...next.defaultModels, general: model };
  return next;
}

async function delay(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts: number, baseDelayMs: number) {
  let lastErr: any = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts) await delay(baseDelayMs * attempt);
    }
  }
  throw lastErr;
}

export class AiEngine {
  private configStore: AiEngineConfigStore;
  private llmFactory: LlmClientFactory;
  private contextManager: AiContextManager;
  private toolExecutor: AiToolExecutor;
  private metrics: AiEngineMetrics;
  private llamaServer: ChildProcess | null = null;
  private llamaServerShuttingDown = false;
  private llamaServerRestartTimer: NodeJS.Timeout | null = null;
  private llamaServerRestartAttempts = 0;

  constructor(opts?: {
    configStore?: AiEngineConfigStore;
    llmFactory?: LlmClientFactory;
    contextManager?: AiContextManager;
    toolExecutor?: AiToolExecutor;
    metrics?: AiEngineMetrics;
  }) {
    this.configStore = opts?.configStore || new AiEngineConfigStore();
    this.llmFactory = opts?.llmFactory || new LlmClientFactory();
    this.contextManager = opts?.contextManager || new AiContextManager();
    this.toolExecutor = opts?.toolExecutor || new AiToolExecutor();
    this.metrics = opts?.metrics || new AiEngineMetrics();
  }

  async init() {
    await db.initDb();
    await this.configStore.loadOnce();
    await this.maybeStartLlamaCppEmbeddingServer();
    this.configStore.startWatching();
  }

  getMetrics() {
    return this.metrics.snapshot();
  }

  private async maybeStartLlamaCppEmbeddingServer() {
    const envBin = (process.env.LLAMACPP_SERVER_BIN || '').trim();
    const envModelPath = (process.env.LLAMACPP_MODEL_PATH || '').trim();
    const defaultHipBin = path.resolve(process.cwd(), 'llama.cpp', 'build-hip', 'bin', 'llama-server.exe');
    const defaultCpuBin = path.resolve(process.cwd(), 'llama.cpp', 'build', 'bin', 'llama-server.exe');
    const defaultModelPath = path.resolve(process.cwd(), 'models', 'qwen3-embedding-0.6b', 'Qwen3-Embedding-0.6B-Q8_0.gguf');
    const binCandidates = [envBin, defaultHipBin, defaultCpuBin].filter(Boolean);
    const modelCandidates = [envModelPath, defaultModelPath].filter(Boolean);
    const pickFirstFile = async (candidates: string[]) => {
      for (const p of candidates) {
        try {
          const st = await fs.stat(p);
          if (st.isFile()) return p;
        } catch {
        }
      }
      return '';
    };
    const bin = await pickFirstFile(binCandidates);
    const modelPath = await pickFirstFile(modelCandidates);
    if (!bin || !modelPath) return;
    if (this.llamaServer) return;

    const host = (process.env.LLAMACPP_HOST || '127.0.0.1').trim() || '127.0.0.1';
    const portRaw = (process.env.LLAMACPP_PORT || '8080').trim();
    const port = Number.isFinite(Number(portRaw)) ? Math.max(1, Math.min(65535, Number(portRaw))) : 8080;
    const baseUrl = `http://${host}:${port}/v1`;
    if (!process.env.LLAMACPP_EMBEDDINGS_BASE_URL) process.env.LLAMACPP_EMBEDDINGS_BASE_URL = baseUrl;
    if (!process.env.LLAMACPP_EMBEDDINGS_API_KEY) process.env.LLAMACPP_EMBEDDINGS_API_KEY = 'local';
    if (!process.env.LLAMACPP_EMBEDDINGS_MODEL) process.env.LLAMACPP_EMBEDDINGS_MODEL = path.basename(modelPath);
    if (isQwen3EmbeddingModelName(modelPath) && !process.env.LLAMACPP_EMBEDDINGS_L2_NORMALIZE) process.env.LLAMACPP_EMBEDDINGS_L2_NORMALIZE = '1';

    const nglRaw = (process.env.LLAMACPP_NGL || '999').trim();
    const ngl = Number.isFinite(Number(nglRaw)) ? Math.max(0, Math.min(9999, Number(nglRaw))) : 999;
    const mainGpuRaw = (process.env.LLAMACPP_MAIN_GPU || '0').trim();
    const mainGpuEnv = Number.isFinite(Number(mainGpuRaw)) ? Math.max(0, Math.min(999, Number(mainGpuRaw))) : 0;
    const splitMode = ((process.env.LLAMACPP_SPLIT_MODE || 'none').trim() || 'none').toLowerCase();
    const deviceListEnv = (process.env.LLAMACPP_DEVICE || '').trim();
    const modelAlias = (process.env.LLAMACPP_EMBEDDINGS_MODEL || '').trim() || path.basename(modelPath);

    const listDevices = () => {
      try {
        const out = spawnSync(bin, ['--list-devices'], { encoding: 'utf-8', windowsHide: true });
        const text = `${out.stdout || ''}\n${out.stderr || ''}`;
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const items: Array<{ name: string; line: string }> = [];
        for (const l of lines) {
          const m = l.match(/^(\S+):\s*(.*)$/);
          if (m) items.push({ name: m[1], line: l });
        }
        const seen = new Set<string>();
        return items.filter(x => (seen.has(x.name) ? false : (seen.add(x.name), true)));
      } catch {
        return [];
      }
    };
    const availableDevices = listDevices();
    const parseMiB = (line: string) => {
      const m = line.match(/\((\d+)\s*MiB,\s*(\d+)\s*MiB\s+free\)/i);
      if (!m) return null;
      return { total: Number(m[1]), free: Number(m[2]) };
    };
    const normalizeDeviceList = (value: string) => value.split(',').map(s => s.trim()).filter(Boolean);
    const isDeviceAvailable = (d: string) => availableDevices.length === 0 || availableDevices.some(x => x.name === d);
    const isRx9070xt = (line: string) => /rx\s*9070|9070\s*xt|gfx120/i.test(line);
    const rankDevices = (devices: Array<{ name: string; line: string }>) => {
      const ranked = devices
        .map(d => {
          const mem = parseMiB(d.line);
          return {
            ...d,
            totalMiB: mem?.total ?? -1,
            freeMiB: mem?.free ?? -1
          };
        })
        .sort((a, b) => (b.totalMiB - a.totalMiB) || (b.freeMiB - a.freeMiB) || a.name.localeCompare(b.name));
      return ranked;
    };
    const rocmDevices = availableDevices.filter(d => d.name.toLowerCase().startsWith('rocm'));
    const preferDevices = rankDevices(rocmDevices.filter(d => isRx9070xt(d.line)));
    const rankedRocm = rankDevices(rocmDevices);
    const rankedAll = rankDevices(availableDevices);
    const preferredDevice = (preferDevices[0] || rankedRocm[0] || rankedAll[0] || null)?.name || '';

    const requestedDevices = normalizeDeviceList(deviceListEnv);
    const requestedIncludesPreferred = preferredDevice && requestedDevices.includes(preferredDevice);
    const effectiveDevices = requestedDevices.filter(isDeviceAvailable);
    const chosenDeviceList = preferredDevice
      ? (requestedIncludesPreferred ? effectiveDevices.join(',') : preferredDevice)
      : (effectiveDevices.length > 0 ? effectiveDevices.join(',') : '');
    const chosenDevicesForMainGpu = normalizeDeviceList(chosenDeviceList);
    const mainGpu =
      typeof process.env.LLAMACPP_MAIN_GPU === 'string' && process.env.LLAMACPP_MAIN_GPU.trim().length > 0
        ? mainGpuEnv
        : (chosenDevicesForMainGpu.length <= 1 ? 0 : (chosenDeviceList.match(/(\d+)/) ? Number(chosenDeviceList.match(/(\d+)/)![1]) : 0));

    const baseArgs = [
      '-m',
      modelPath,
      '--alias',
      modelAlias,
      '--host',
      host,
      '--port',
      String(port),
      '--embedding',
      '--pooling',
      'last',
      '--split-mode',
      (splitMode === 'layer' || splitMode === 'row' ? splitMode : 'none'),
      '-ngl',
      String(ngl),
      '-ub',
      '8192',
      '--no-warmup'
    ];

    const buildArgs = (deviceList: string, mainGpuIdx: number) => [
      ...baseArgs,
      '-mg',
      String(mainGpuIdx),
      ...(deviceList ? (['--device', deviceList] as string[]) : ([] as string[]))
    ];

    const start = (deviceList: string, mainGpuIdx: number, onExit: () => void) => {
      const child = spawn(bin, buildArgs(deviceList, mainGpuIdx), { windowsHide: true });
      child.on('exit', onExit);
      return child;
    };

    const scheduleRestart = () => {
      if (this.llamaServerShuttingDown) return;
      if (this.llamaServerRestartTimer) return;
      const delayMs = Math.min(30_000, 500 * Math.pow(2, Math.min(6, this.llamaServerRestartAttempts)));
      this.llamaServerRestartAttempts += 1;
      this.llamaServerRestartTimer = setTimeout(() => {
        this.llamaServerRestartTimer = null;
        void this.maybeStartLlamaCppEmbeddingServer();
      }, delayMs);
    };

    const clearServer = () => {
      this.llamaServer = null;
      scheduleRestart();
    };

    this.llamaServer = start(chosenDeviceList, mainGpu, clearServer);
    const tryHealth = async () => {
      const url = `http://${host}:${port}/health`;
      await withRetry(async () => {
        if (!this.llamaServer) throw new Error('llama-server not running');
        const resp = await fetch(url, { method: 'GET' });
        if (!resp.ok) throw new Error(`health ${resp.status}`);
        return true;
      }, 12, 200);
    };
    const tryFallback = async () => {
      const fallbacks = rankDevices(rocmDevices.length > 0 ? rocmDevices : availableDevices).map(d => d.name);
      for (const fallbackDevice of fallbacks) {
        if (!fallbackDevice) continue;
        if (fallbackDevice === chosenDeviceList) continue;
        try {
          this.llamaServer?.kill();
        } catch {
        }
        this.llamaServer = start(fallbackDevice, 0, clearServer);
        await tryHealth();
        return;
      }
      return;
    };
    try {
      await tryHealth();
      this.llamaServerRestartAttempts = 0;
    } catch {
      try {
        await tryFallback();
        this.llamaServerRestartAttempts = 0;
      } catch {
      }
    }

    const kill = () => {
      try {
        this.llamaServerShuttingDown = true;
        this.llamaServer?.kill();
      } catch {
      }
    };
    process.once('exit', kill);
    process.once('SIGINT', kill);
    process.once('SIGTERM', kill);
  }

  async checkHealth(llmConfig?: Record<string, unknown>) {
    const baseCfg = this.configStore.get();
    const cfg = mergeRuntimeConfig(baseCfg, llmConfig);
    const route = decideRoute({ capability: 'chat', message: 'ping', stream: false }, cfg).primary;
    const requestModel =
      llmConfig && typeof (llmConfig as any).check_model === 'string' && String((llmConfig as any).check_model).trim().length > 0
        ? String((llmConfig as any).check_model).trim()
        : (llmConfig && typeof (llmConfig as any).model === 'string' && String((llmConfig as any).model).trim().length > 0
            ? String((llmConfig as any).model).trim()
            : undefined);
    const { client } = this.llmFactory.get({ ...route, model: requestModel || route.model }, cfg);
    const model = requestModel || route.model || cfg.defaultModels?.general;
    return client.checkHealth(model);
  }

  async *chatStream(req: AiChatRequest): AsyncGenerator<string, void, unknown> {
    const requestId = ensureRequestId(req);
    const t0 = performance.now();
    const baseCfg = this.configStore.get();
    const cfg = mergeRuntimeConfig(baseCfg, req.llmConfig);
    const decision = decideRoute(req, cfg);
    const contextMaxLength =
      (req.llmConfig && typeof (req.llmConfig as any).context_max_length === 'number' && Number.isFinite((req.llmConfig as any).context_max_length))
        ? Number((req.llmConfig as any).context_max_length)
        : 128000;
    const ragEnabled = ((req.llmConfig as any)?.rag === true) || process.env.AI_RAG === '1';
    const contextAddendum = await this.contextManager.buildSystemContext(req.editor, { maxChars: getSystemContextMaxChars(contextMaxLength) });
    let sessionSummary = '';
    let sessionSummaryReady = false;
    let ragAddendum = '';
    let ragAddendumReady = false;

    const run = (target: AiRouteTarget): AsyncGenerator<string, void, unknown> => {
      const self = this;
      return (async function* () {
        const { client, route } = self.llmFactory.get(target, cfg);
        const sessionId = req.sessionId;
        const agent = new Agent(client, sessionId, contextMaxLength);
        agent.setMode(req.mode || 'chat', req.toolOverrides);
        if (!sessionSummaryReady) {
          sessionSummaryReady = true;
          sessionSummary = await self.contextManager.buildSessionSummary(sessionId, client, route.model);
        }
        if (!ragAddendumReady) {
          ragAddendumReady = true;
          if (ragEnabled) {
            const root = (() => {
              try {
                return getWorkspaceRoot();
              } catch {
                return '';
              }
            })();
            if (root) {
              const maxChars = Math.max(1500, Math.min(5000, Math.floor(getSystemContextMaxChars(contextMaxLength) * 0.4)));
              ragAddendum = await buildRagAddendum({
                root,
                query: req.message || '',
                editorFilePath: req.editor?.filePath,
                cfg,
                maxChars,
                embeddingModel: (req.llmConfig as any)?.rag_embedding_model
              });
            }
          }
        }
        const combinedContext = [
          sessionSummary ? `Session summary:\n${sessionSummary}` : '',
          ragAddendum,
          contextAddendum
        ].filter(Boolean).join('\n\n');
        if (combinedContext) agent.setSystemContext(combinedContext);

        const parsedTopP = Number((req.llmConfig as any)?.top_p);
        const chatOptions: any = {
          model: route.model,
          max_tokens: (req.llmConfig as any)?.output_max_tokens,
          temperature: (req.llmConfig as any)?.temperature,
          top_p: Number.isFinite(parsedTopP) ? Math.min(1.0, Math.max(0.1, parsedTopP)) : undefined
        };

        for await (const chunk of agent.chat(req.message, req.attachments || [], chatOptions)) {
          yield chunk;
        }
      })();
    };

    const attempts = [decision.primary, ...decision.fallbacks];
    const maxAttempts = cfg.retries?.maxAttempts ?? 2;
    const baseDelayMs = cfg.retries?.baseDelayMs ?? 250;

    let ok = false;
    let usedRoute = decision.primary;
    let yielded = false;
    let lastError: any = null;

    try {
      for (const target of attempts) {
        usedRoute = target;
        try {
          const stream = await withRetry(async () => run(target), maxAttempts, baseDelayMs);
          for await (const c of stream) {
            yielded = true;
            yield c;
          }
          ok = true;
          lastError = null;
          break;
        } catch (e: any) {
          lastError = e;
          this.metrics.recordError(e?.message || String(e));
          if (yielded) throw e;
        }
      }
      if (!ok && lastError) throw lastError;
    } finally {
      const latencyMs = Math.round(performance.now() - t0);
      this.metrics.record({
        capability: req.capability,
        provider: usedRoute.provider,
        model: usedRoute.model,
        ok,
        latencyMs
      });
      if (req.sessionId) {
        await db.addLog(
          req.sessionId,
          'ai-engine',
          'chat',
          '',
          { requestId, route: usedRoute, decision },
          { ok },
          ok ? 200 : 500,
          ok,
          true,
          ok ? undefined : 'failed'
        );
      }
    }
  }

  async inline(req: AiInlineRequest): Promise<AiInlineResponse> {
    const requestId = ensureRequestId(req);
    const t0 = performance.now();
    const baseCfg = this.configStore.get();
    const cfg = mergeRuntimeConfig(baseCfg, req.llmConfig);
    const decision = decideRoute(req, cfg);
    const target = decision.primary;
    const { client, route } = this.llmFactory.get(target, cfg);
    const context = await this.contextManager.buildSystemContext(req.editor, { maxChars: 5000 });
    const system = `You are an IDE inline completion engine. Output only the code to insert.`;
    const user = `${context}\n\nCursor is at the end of the visible text. Continue the code with best effort.`;
    const messages = [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: user + `\n\n${req.editor.visibleText}` }
    ];

    const resp = await client.chatCompletion(messages as any, undefined, req.sessionId, {
      model: route.model,
      max_tokens: req.maxTokens ?? 128,
      temperature: 0.2
    });

    const text = typeof resp.content === 'string' ? resp.content : '';
    const latencyMs = Math.round(performance.now() - t0);
    this.metrics.record({ capability: req.capability, provider: route.provider, model: route.model, ok: true, latencyMs });
    return {
      requestId,
      capability: 'inline',
      route,
      latencyMs,
      suggestions: [{ text: text.trimStart(), kind: 'insert' }]
    };
  }

  async editorAction(req: AiEditorActionRequest): Promise<AiEditorActionResponse> {
    const requestId = ensureRequestId(req);
    const t0 = performance.now();
    const baseCfg = this.configStore.get();
    const cfg = mergeRuntimeConfig(baseCfg, req.llmConfig);
    const decision = decideRoute(req, cfg);
    const target = decision.primary;
    const { client, route } = this.llmFactory.get(target, cfg);
    const context = await this.contextManager.buildSystemContext(req.editor, { maxChars: 6500 });
    const system = `You are an IDE editor assistant. Follow the instruction and respond with the result.`;
    const user = `${context}\n\nAction: ${req.action}\nInstruction: ${req.instruction}\n\nVisible text:\n${req.editor.visibleText}`;
    const messages = [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: user }
    ];

    const resp = await client.chatCompletion(messages as any, undefined, req.sessionId, {
      model: route.model,
      max_tokens: 1024,
      temperature: 0.2
    });

    const content = typeof resp.content === 'string' ? resp.content : '';
    const latencyMs = Math.round(performance.now() - t0);
    this.metrics.record({ capability: req.capability, provider: route.provider, model: route.model, ok: true, latencyMs });
    return { requestId, capability: 'editorAction', route, latencyMs, content };
  }

  async tools(req: AiToolsRequest): Promise<AiToolsResponse> {
    const requestId = ensureRequestId(req);
    const t0 = performance.now();
    const baseCfg = this.configStore.get();
    const cfg = mergeRuntimeConfig(baseCfg, undefined);
    const decision = decideRoute(req, cfg);
    const route = decision.primary;
    const result = await this.toolExecutor.execute(req.toolName, req.args, req.sessionId);
    const latencyMs = Math.round(performance.now() - t0);
    this.metrics.record({ capability: req.capability, provider: route.provider, model: route.model, ok: true, latencyMs });
    return { requestId, capability: 'tools', route, latencyMs, result };
  }

  async embeddings(req: AiEmbeddingsRequest): Promise<AiEmbeddingsResponse> {
    const requestId = ensureRequestId(req);
    const t0 = performance.now();
    const baseCfg = this.configStore.get();
    const cfg = mergeRuntimeConfig(baseCfg, req.llmConfig);
    const decision = decideRoute(req, cfg);
    const vectors = await embedTexts(req.texts, cfg, req.model);
    const latencyMs = Math.round(performance.now() - t0);
    const route: AiRouteTarget = { provider: vectors.provider, model: vectors.model };
    this.metrics.record({ capability: req.capability, provider: route.provider, model: route.model, ok: true, latencyMs });
    return { requestId, capability: 'embeddings', route, latencyMs, vectors: vectors.vectors };
  }

  async handle(req: AiEngineRequest): Promise<AiEngineResponse> {
    if (req.capability === 'inline') return this.inline(req);
    if (req.capability === 'editorAction') return this.editorAction(req);
    if (req.capability === 'tools') return this.tools(req);
    if (req.capability === 'embeddings') return this.embeddings(req);
    throw new Error(`Non-stream chat must use chatStream: ${req.capability}`);
  }
}

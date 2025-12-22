"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiEngine = void 0;
const perf_hooks_1 = require("perf_hooks");
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const agent_1 = require("../agent");
const db = __importStar(require("../db"));
const context_manager_1 = require("./context_manager");
const config_store_1 = require("./config_store");
const metrics_1 = require("./metrics");
const router_1 = require("./router");
const llm_factory_1 = require("./llm_factory");
const embeddings_1 = require("./embeddings");
const tool_executor_1 = require("./tool_executor");
const runtime_config_1 = require("./runtime_config");
const context_1 = require("../context");
const filesystem_1 = require("../tools/filesystem");
const rag_index_1 = require("./rag_index");
function ensureRequestId(req) {
    return req.requestId && req.requestId.trim().length > 0 ? req.requestId : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function getSystemContextMaxChars(contextMaxLength) {
    const tokens = typeof contextMaxLength === 'number' && Number.isFinite(contextMaxLength) ? contextMaxLength : 128000;
    const approxChars = Math.floor(tokens * 4 * 0.03);
    return Math.max(6000, Math.min(60000, approxChars));
}
function extractQueryTokens(text) {
    const raw = (text || '').toLowerCase();
    const matches = raw.match(/[a-z_][a-z0-9_]{2,}/g) || [];
    const stop = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'your', 'you', 'are', 'not', 'can', 'will', 'use', 'using']);
    const uniq = [];
    for (const m of matches) {
        if (stop.has(m))
            continue;
        if (!uniq.includes(m))
            uniq.push(m);
        if (uniq.length >= 16)
            break;
    }
    return uniq;
}
function chunkByLines(text, opts) {
    const maxLines = opts?.maxLines ?? 80;
    const maxChars = opts?.maxChars ?? 2400;
    const overlapLines = opts?.overlapLines ?? 10;
    const lines = (text || '').split(/\r?\n/);
    const chunks = [];
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
        if (end >= lines.length)
            break;
        i = Math.max(start + 1, end - overlapLines);
    }
    return chunks;
}
function cosine(a, b) {
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
function isQwen3EmbeddingModelName(model) {
    const m = (model || '').toLowerCase();
    return m.includes('qwen3-embedding');
}
function withQwen3Eot(text) {
    const t = text || '';
    return t.endsWith('<|endoftext|>') ? t : `${t}<|endoftext|>`;
}
async function buildRagAddendum(opts) {
    const query = (opts.query || '').trim();
    if (!query)
        return '';
    const tokens = extractQueryTokens(query);
    if (tokens.length === 0 && query.length < 12)
        return '';
    let struct;
    try {
        struct = await (0, filesystem_1.getProjectStructure)(opts.root);
    }
    catch {
        struct = null;
    }
    const entries = (struct && Array.isArray(struct.entries)) ? struct.entries : [];
    const candidates = entries.filter(e => e && e.type === 'file');
    const preferExt = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.py', '.go', '.rs', '.java', '.cs', '.cpp', '.c', '.h']);
    const scoredFiles = candidates
        .map(e => {
        const p = String(e.path || '');
        const baseRoot = typeof e.workspace_root === 'string' && e.workspace_root ? e.workspace_root : opts.root;
        const ext = path_1.default.extname(p).toLowerCase();
        let score = 0;
        const pLower = p.toLowerCase();
        if (opts.editorFilePath && pLower.endsWith(String(opts.editorFilePath).toLowerCase()))
            score += 8;
        for (const t of tokens)
            if (pLower.includes(t))
                score += 2;
        if (preferExt.has(ext))
            score += 1;
        return { baseRoot, path: p, score };
    })
        .filter(x => x.path && x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);
    const fallbackFiles = scoredFiles.length > 0
        ? scoredFiles
        : (struct?.entry_candidates && Array.isArray(struct.entry_candidates)
            ? struct.entry_candidates.slice(0, 5).map((p) => ({ baseRoot: opts.root, path: p, score: 1 }))
            : []);
    const filesToRead = (scoredFiles.length > 0 ? scoredFiles : fallbackFiles).slice(0, 12);
    if (filesToRead.length === 0)
        return '';
    const chunkCandidates = [];
    for (const f of filesToRead) {
        try {
            const fullPath = path_1.default.resolve(f.baseRoot, f.path);
            const stat = await promises_1.default.stat(fullPath);
            if (!stat.isFile() || stat.size > 400_000)
                continue;
            const content = await promises_1.default.readFile(fullPath, 'utf-8');
            if (!content || content.indexOf('\0') !== -1)
                continue;
            const chunks = chunkByLines(content, { maxLines: 80, maxChars: 2600, overlapLines: 12 });
            for (const c of chunks) {
                const lower = c.text.toLowerCase();
                let lexicalScore = 0;
                for (const t of tokens) {
                    const re = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
                    const m = lower.match(re);
                    if (m)
                        lexicalScore += Math.min(6, m.length);
                }
                if (lexicalScore === 0 && tokens.length > 0)
                    continue;
                chunkCandidates.push({ filePath: f.path, startLine: c.startLine, endLine: c.endLine, text: c.text, lexicalScore });
                if (chunkCandidates.length >= 200)
                    break;
            }
        }
        catch {
        }
        if (chunkCandidates.length >= 200)
            break;
    }
    const topLex = chunkCandidates
        .sort((a, b) => b.lexicalScore - a.lexicalScore)
        .slice(0, 24);
    if (topLex.length === 0)
        return '';
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
    let vectors;
    try {
        const out = await (0, embeddings_1.embedTexts)(embeddingInputs, opts.cfg, embeddingModel);
        vectors = out.vectors;
    }
    catch {
        return '';
    }
    if (!vectors || vectors.length !== embeddingInputs.length)
        return '';
    const qv = vectors[0];
    const ranked = topLex
        .map((c, i) => ({ c, score: cosine(qv, vectors[i + 1]) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 4);
    const lines = [];
    lines.push('Relevant code snippets (retrieved):');
    for (const r of ranked) {
        const header = `${r.c.filePath}:${r.c.startLine}-${r.c.endLine}`;
        const body = r.c.text.length > 1800 ? `${r.c.text.slice(0, 1800)}\n[...truncated...]` : r.c.text;
        lines.push(`${header}\n${body}`);
    }
    const joined = lines.join('\n\n');
    return joined.length > opts.maxChars ? `${joined.slice(0, opts.maxChars)}\n[...truncated...]` : joined;
}
function mergeRuntimeConfig(base, llmConfig) {
    if (!llmConfig)
        return base;
    const provider = typeof llmConfig.provider === 'string' ? llmConfig.provider : undefined;
    const apiKey = typeof llmConfig.api_key === 'string' ? llmConfig.api_key : undefined;
    const baseUrl = typeof llmConfig.base_url === 'string' ? llmConfig.base_url : undefined;
    const model = typeof llmConfig.model === 'string' ? llmConfig.model : undefined;
    const poolIdRaw = typeof llmConfig.pool_id === 'string' ? String(llmConfig.pool_id) : undefined;
    const defaultModelsRaw = llmConfig.default_models;
    const routingRaw = llmConfig.routing;
    const providersRaw = llmConfig.providers;
    const embeddingOptionsRaw = llmConfig.embedding_options;
    const next = (0, runtime_config_1.normalizeRuntimeConfig)(base);
    const supportedProviders = new Set(['openai', 'anthropic', 'openrouter', 'xai', 'ollama', 'lmstudio', 'llamacpp']);
    if (provider && supportedProviders.has(provider))
        next.defaultProvider = provider;
    const poolId = (poolIdRaw && poolIdRaw.trim().length > 0 ? poolIdRaw.trim() : 'default');
    if (provider && supportedProviders.has(provider) && apiKey) {
        const prev = next.providers?.[provider];
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
        };
    }
    if (providersRaw && typeof providersRaw === 'object') {
        const merged = { ...(next.providers || {}) };
        for (const [pid, pr] of Object.entries(providersRaw)) {
            if (!supportedProviders.has(pid))
                continue;
            const normalized = (() => {
                if (!pr || typeof pr !== 'object')
                    return null;
                const anyPr = pr;
                const poolsRaw = anyPr.pools;
                if (!poolsRaw || typeof poolsRaw !== 'object')
                    return null;
                const pools = {};
                for (const [poolId, poolRaw] of Object.entries(poolsRaw)) {
                    if (!poolRaw || typeof poolRaw !== 'object')
                        continue;
                    const anyPool = poolRaw;
                    const apiKey = typeof anyPool.apiKey === 'string' ? anyPool.apiKey : (typeof anyPool.api_key === 'string' ? anyPool.api_key : '');
                    if (!apiKey || apiKey.trim().length === 0)
                        continue;
                    const baseUrl = typeof anyPool.baseUrl === 'string' ? anyPool.baseUrl : (typeof anyPool.base_url === 'string' ? anyPool.base_url : undefined);
                    pools[poolId] = { apiKey, baseUrl };
                }
                const poolIds = Object.keys(pools);
                if (poolIds.length === 0)
                    return null;
                const defaultPoolId = typeof anyPr.defaultPoolId === 'string' && poolIds.includes(anyPr.defaultPoolId)
                    ? anyPr.defaultPoolId
                    : (typeof anyPr.default_pool_id === 'string' && poolIds.includes(anyPr.default_pool_id) ? anyPr.default_pool_id : poolIds[0]);
                return { defaultPoolId, pools };
            })();
            if (!normalized)
                continue;
            const prev = merged[pid];
            const prevPools = (prev && typeof prev === 'object' && prev.pools && typeof prev.pools === 'object') ? prev.pools : {};
            merged[pid] = { defaultPoolId: normalized.defaultPoolId, pools: { ...prevPools, ...normalized.pools } };
        }
        next.providers = merged;
    }
    if (defaultModelsRaw && typeof defaultModelsRaw === 'object') {
        const incoming = {};
        for (const key of ['general', 'fast', 'reasoning', 'tools', 'embeddings']) {
            const val = defaultModelsRaw[key];
            if (typeof val === 'string' && val.trim().length > 0)
                incoming[key] = val.trim();
        }
        if (Object.keys(incoming).length > 0) {
            next.defaultModels = { ...next.defaultModels, ...incoming };
        }
    }
    if (routingRaw && typeof routingRaw === 'object') {
        const nextRouting = { ...(next.routing || {}) };
        const capabilities = ['chat', 'inline', 'editorAction', 'tools', 'embeddings'];
        for (const cap of capabilities) {
            const list = routingRaw[cap];
            if (!Array.isArray(list))
                continue;
            const normalized = list
                .map((t) => {
                const p = typeof t?.provider === 'string' ? String(t.provider) : '';
                if (!p || !supportedProviders.has(p))
                    return null;
                const out = { provider: p };
                if (typeof t?.model === 'string' && String(t.model).trim().length > 0)
                    out.model = String(t.model).trim();
                const poolId = typeof t?.poolId === 'string' ? String(t.poolId).trim() : '';
                if (poolId)
                    out.poolId = poolId;
                const tags = Array.isArray(t?.tags) ? t.tags.filter((x) => typeof x === 'string' && x.trim().length > 0) : null;
                if (tags && tags.length > 0)
                    out.tags = tags;
                return out;
            })
                .filter(Boolean);
            if (normalized.length > 0)
                nextRouting[cap] = normalized;
        }
        next.routing = nextRouting;
    }
    if (embeddingOptionsRaw && typeof embeddingOptionsRaw === 'object') {
        const anyOpt = embeddingOptionsRaw;
        const outputDimensions = Number(anyOpt.outputDimensions ?? anyOpt.output_dimensions);
        const embdNormalize = Number(anyOpt.embdNormalize ?? anyOpt.embd_normalize);
        const contextMaxLength = Number(anyOpt.contextMaxLength ?? anyOpt.context_max_length);
        const nextOpt = { ...(next.embeddingOptions || {}) };
        if (Number.isFinite(outputDimensions) && outputDimensions > 0)
            nextOpt.outputDimensions = Math.max(32, Math.min(1024, Math.round(outputDimensions)));
        if (Number.isFinite(embdNormalize))
            nextOpt.embdNormalize = Math.round(embdNormalize);
        if (Number.isFinite(contextMaxLength) && contextMaxLength > 0)
            nextOpt.contextMaxLength = Math.max(1024, Math.min(32768, Math.round(contextMaxLength)));
        next.embeddingOptions = nextOpt;
    }
    if (model)
        next.defaultModels = { ...next.defaultModels, general: model };
    return next;
}
async function delay(ms) {
    await new Promise(resolve => setTimeout(resolve, ms));
}
async function withRetry(fn, maxAttempts, baseDelayMs) {
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return await fn();
        }
        catch (e) {
            lastErr = e;
            if (attempt < maxAttempts)
                await delay(baseDelayMs * attempt);
        }
    }
    throw lastErr;
}
class AiEngine {
    configStore;
    llmFactory;
    contextManager;
    toolExecutor;
    metrics;
    llamaServer = null;
    llamaServerShuttingDown = false;
    llamaServerRestartTimer = null;
    llamaServerRestartAttempts = 0;
    ragIndexesByRoot = new Map();
    constructor(opts) {
        this.configStore = opts?.configStore || new config_store_1.AiEngineConfigStore();
        this.llmFactory = opts?.llmFactory || new llm_factory_1.LlmClientFactory();
        this.contextManager = opts?.contextManager || new context_manager_1.AiContextManager();
        this.toolExecutor = opts?.toolExecutor || new tool_executor_1.AiToolExecutor({
            getRagIndex: (root) => this.getOrCreateRagIndex(root),
            getConfig: () => this.configStore.get()
        });
        this.metrics = opts?.metrics || new metrics_1.AiEngineMetrics();
    }
    async init() {
        await db.initDb();
        await this.configStore.loadOnce();
        await this.maybeStartLlamaCppEmbeddingServer();
        this.configStore.startWatching();
    }
    ensureWorkspaceIndex(rootPath, llmConfig) {
        const root = path_1.default.resolve(String(rootPath || ''));
        const baseCfg = this.configStore.get();
        const cfg = mergeRuntimeConfig(baseCfg, llmConfig);
        const embeddingModel = cfg.defaultModels?.embeddings || 'text-embedding-3-small';
        const idx = this.getOrCreateRagIndex(root);
        idx.setRuntimeConfig(cfg);
        idx.startWatching();
        idx.kickoffInitialRefresh(cfg, embeddingModel);
    }
    notifyWorkspaceFileChanged(rootPath, relPath, llmConfig) {
        const root = path_1.default.resolve(String(rootPath || ''));
        const baseCfg = this.configStore.get();
        const cfg = mergeRuntimeConfig(baseCfg, llmConfig);
        const idx = this.getOrCreateRagIndex(root);
        idx.setRuntimeConfig(cfg);
        idx.startWatching();
        idx.notifyFileChanged(root, relPath);
    }
    async disposeWorkspaceIndex(rootPath) {
        const root = path_1.default.resolve(String(rootPath || ''));
        const idx = this.ragIndexesByRoot.get(root);
        if (!idx)
            return;
        this.ragIndexesByRoot.delete(root);
        await idx.dispose();
    }
    getMetrics() {
        return this.metrics.snapshot();
    }
    async maybeStartLlamaCppEmbeddingServer() {
        const envBin = (process.env.LLAMACPP_SERVER_BIN || '').trim();
        const envModelPath = (process.env.LLAMACPP_MODEL_PATH || '').trim();
        const defaultHipBin = path_1.default.resolve(process.cwd(), 'llama.cpp', 'build-hip', 'bin', 'llama-server.exe');
        const defaultCpuBin = path_1.default.resolve(process.cwd(), 'llama.cpp', 'build', 'bin', 'llama-server.exe');
        const defaultModelPath = path_1.default.resolve(process.cwd(), 'models', 'qwen3-embedding-0.6b', 'Qwen3-Embedding-0.6B-Q8_0.gguf');
        const binCandidates = [envBin, defaultHipBin, defaultCpuBin].filter(Boolean);
        const modelCandidates = [envModelPath, defaultModelPath].filter(Boolean);
        const pickFirstFile = async (candidates) => {
            for (const p of candidates) {
                try {
                    const st = await promises_1.default.stat(p);
                    if (st.isFile())
                        return p;
                }
                catch {
                }
            }
            return '';
        };
        const bin = await pickFirstFile(binCandidates);
        const modelPath = await pickFirstFile(modelCandidates);
        if (!bin || !modelPath)
            return;
        if (this.llamaServer)
            return;
        const host = (process.env.LLAMACPP_HOST || '127.0.0.1').trim() || '127.0.0.1';
        const portRaw = (process.env.LLAMACPP_PORT || '8080').trim();
        const port = Number.isFinite(Number(portRaw)) ? Math.max(1, Math.min(65535, Number(portRaw))) : 8080;
        const baseUrl = `http://${host}:${port}/v1`;
        if (!process.env.LLAMACPP_EMBEDDINGS_BASE_URL)
            process.env.LLAMACPP_EMBEDDINGS_BASE_URL = baseUrl;
        if (!process.env.LLAMACPP_EMBEDDINGS_API_KEY)
            process.env.LLAMACPP_EMBEDDINGS_API_KEY = 'local';
        if (!process.env.LLAMACPP_EMBEDDINGS_MODEL)
            process.env.LLAMACPP_EMBEDDINGS_MODEL = path_1.default.basename(modelPath);
        if (isQwen3EmbeddingModelName(modelPath) && !process.env.LLAMACPP_EMBEDDINGS_L2_NORMALIZE)
            process.env.LLAMACPP_EMBEDDINGS_L2_NORMALIZE = '1';
        const nglRaw = (process.env.LLAMACPP_NGL || '999').trim();
        const ngl = Number.isFinite(Number(nglRaw)) ? Math.max(0, Math.min(9999, Number(nglRaw))) : 999;
        const mainGpuRaw = (process.env.LLAMACPP_MAIN_GPU || '0').trim();
        const mainGpuEnv = Number.isFinite(Number(mainGpuRaw)) ? Math.max(0, Math.min(999, Number(mainGpuRaw))) : 0;
        const splitMode = ((process.env.LLAMACPP_SPLIT_MODE || 'none').trim() || 'none').toLowerCase();
        const deviceListEnv = (process.env.LLAMACPP_DEVICE || '').trim();
        const modelAlias = (process.env.LLAMACPP_EMBEDDINGS_MODEL || '').trim() || path_1.default.basename(modelPath);
        const listDevices = () => {
            try {
                const out = (0, child_process_1.spawnSync)(bin, ['--list-devices'], { encoding: 'utf-8', windowsHide: true });
                const text = `${out.stdout || ''}\n${out.stderr || ''}`;
                const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                const items = [];
                for (const l of lines) {
                    const m = l.match(/^(\S+):\s*(.*)$/);
                    if (m)
                        items.push({ name: m[1], line: l });
                }
                const seen = new Set();
                return items.filter(x => (seen.has(x.name) ? false : (seen.add(x.name), true)));
            }
            catch {
                return [];
            }
        };
        const availableDevices = listDevices();
        const parseMiB = (line) => {
            const m = line.match(/\((\d+)\s*MiB,\s*(\d+)\s*MiB\s+free\)/i);
            if (!m)
                return null;
            return { total: Number(m[1]), free: Number(m[2]) };
        };
        const normalizeDeviceList = (value) => value.split(',').map(s => s.trim()).filter(Boolean);
        const isDeviceAvailable = (d) => availableDevices.length === 0 || availableDevices.some(x => x.name === d);
        const isRx9070xt = (line) => /rx\s*9070|9070\s*xt|gfx120/i.test(line);
        const rankDevices = (devices) => {
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
        const mainGpu = typeof process.env.LLAMACPP_MAIN_GPU === 'string' && process.env.LLAMACPP_MAIN_GPU.trim().length > 0
            ? mainGpuEnv
            : (chosenDevicesForMainGpu.length <= 1 ? 0 : (chosenDeviceList.match(/(\d+)/) ? Number(chosenDeviceList.match(/(\d+)/)[1]) : 0));
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
        const buildArgs = (deviceList, mainGpuIdx) => [
            ...baseArgs,
            '-mg',
            String(mainGpuIdx),
            ...(deviceList ? ['--device', deviceList] : [])
        ];
        const start = (deviceList, mainGpuIdx, onExit) => {
            const child = (0, child_process_1.spawn)(bin, buildArgs(deviceList, mainGpuIdx), { windowsHide: true });
            child.on('exit', onExit);
            return child;
        };
        const scheduleRestart = () => {
            if (this.llamaServerShuttingDown)
                return;
            if (this.llamaServerRestartTimer)
                return;
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
                if (!this.llamaServer)
                    throw new Error('llama-server not running');
                const resp = await fetch(url, { method: 'GET' });
                if (!resp.ok)
                    throw new Error(`health ${resp.status}`);
                return true;
            }, 12, 200);
        };
        const tryFallback = async () => {
            const fallbacks = rankDevices(rocmDevices.length > 0 ? rocmDevices : availableDevices).map(d => d.name);
            for (const fallbackDevice of fallbacks) {
                if (!fallbackDevice)
                    continue;
                if (fallbackDevice === chosenDeviceList)
                    continue;
                try {
                    this.llamaServer?.kill();
                }
                catch {
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
        }
        catch {
            try {
                await tryFallback();
                this.llamaServerRestartAttempts = 0;
            }
            catch {
            }
        }
        const kill = () => {
            try {
                this.llamaServerShuttingDown = true;
                this.llamaServer?.kill();
            }
            catch {
            }
        };
        process.once('exit', kill);
        process.once('SIGINT', kill);
        process.once('SIGTERM', kill);
    }
    async checkHealth(llmConfig) {
        const baseCfg = this.configStore.get();
        const cfg = mergeRuntimeConfig(baseCfg, llmConfig);
        const route = (0, router_1.decideRoute)({ capability: 'chat', message: 'ping', stream: false }, cfg).primary;
        const requestModel = llmConfig && typeof llmConfig.check_model === 'string' && String(llmConfig.check_model).trim().length > 0
            ? String(llmConfig.check_model).trim()
            : (llmConfig && typeof llmConfig.model === 'string' && String(llmConfig.model).trim().length > 0
                ? String(llmConfig.model).trim()
                : undefined);
        const { client } = this.llmFactory.get({ ...route, model: requestModel || route.model }, cfg);
        const model = requestModel || route.model || cfg.defaultModels?.general;
        return client.checkHealth(model);
    }
    async *chatStream(req) {
        const requestId = ensureRequestId(req);
        const t0 = perf_hooks_1.performance.now();
        const baseCfg = this.configStore.get();
        const cfg = mergeRuntimeConfig(baseCfg, req.llmConfig);
        const decision = (0, router_1.decideRoute)(req, cfg);
        const contextMaxLength = (req.llmConfig && typeof req.llmConfig.context_max_length === 'number' && Number.isFinite(req.llmConfig.context_max_length))
            ? Number(req.llmConfig.context_max_length)
            : 128000;
        const ragEnabled = (req.llmConfig?.rag === true) || process.env.AI_RAG === '1';
        const contextAddendum = await this.contextManager.buildSystemContext(req.editor, { maxChars: getSystemContextMaxChars(contextMaxLength) });
        let sessionSummary = '';
        let sessionSummaryReady = false;
        let ragAddendum = '';
        let ragAddendumReady = false;
        const run = (target) => {
            const self = this;
            return (async function* () {
                const { client, route } = self.llmFactory.get(target, cfg);
                const sessionId = req.sessionId;
                const agent = new agent_1.Agent(client, {
                    sessionId,
                    contextMaxLength,
                    getRagIndex: (root) => self.getOrCreateRagIndex(root),
                    getConfig: () => self.configStore.get()
                });
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
                                return (0, context_1.getWorkspaceRoot)();
                            }
                            catch {
                                return '';
                            }
                        })();
                        if (root) {
                            const maxChars = Math.max(1500, Math.min(5000, Math.floor(getSystemContextMaxChars(contextMaxLength) * 0.4)));
                            const embeddingModel = req.llmConfig?.rag_embedding_model || cfg.defaultModels?.embeddings || 'text-embedding-3-small';
                            const idx = self.getOrCreateRagIndex(root);
                            ragAddendum = await idx.buildAddendum({
                                query: req.message || '',
                                cfg,
                                embeddingModel,
                                maxChars,
                                topK: 4
                            });
                        }
                    }
                }
                const combinedContext = [
                    sessionSummary ? `Session summary:\n${sessionSummary}` : '',
                    ragAddendum,
                    contextAddendum
                ].filter(Boolean).join('\n\n');
                if (combinedContext)
                    agent.setSystemContext(combinedContext);
                const parsedTopP = Number(req.llmConfig?.top_p);
                const chatOptions = {
                    model: route.model,
                    max_tokens: req.llmConfig?.output_max_tokens,
                    temperature: req.llmConfig?.temperature,
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
        let lastError = null;
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
                }
                catch (e) {
                    lastError = e;
                    this.metrics.recordError(e?.message || String(e));
                    if (yielded)
                        throw e;
                }
            }
            if (!ok && lastError)
                throw lastError;
        }
        finally {
            const latencyMs = Math.round(perf_hooks_1.performance.now() - t0);
            this.metrics.record({
                capability: req.capability,
                provider: usedRoute.provider,
                model: usedRoute.model,
                ok,
                latencyMs
            });
            if (req.sessionId) {
                await db.addLog(req.sessionId, 'ai-engine', 'chat', '', { requestId, route: usedRoute, decision }, { ok }, ok ? 200 : 500, ok, true, ok ? undefined : 'failed');
            }
        }
    }
    getOrCreateRagIndex(rootPath) {
        const root = path_1.default.resolve(String(rootPath || ''));
        const existing = this.ragIndexesByRoot.get(root);
        if (existing)
            return existing;
        const created = new rag_index_1.RagIndex(root);
        this.ragIndexesByRoot.set(root, created);
        return created;
    }
    async inline(req) {
        const requestId = ensureRequestId(req);
        const t0 = perf_hooks_1.performance.now();
        const baseCfg = this.configStore.get();
        const cfg = mergeRuntimeConfig(baseCfg, req.llmConfig);
        const decision = (0, router_1.decideRoute)(req, cfg);
        const target = decision.primary;
        const { client, route } = this.llmFactory.get(target, cfg);
        const context = await this.contextManager.buildSystemContext(req.editor, { maxChars: 5000 });
        const system = `You are an IDE inline completion engine. Output only the code to insert.`;
        const user = `${context}\n\nCursor is at the end of the visible text. Continue the code with best effort.`;
        const messages = [
            { role: 'system', content: system },
            { role: 'user', content: user + `\n\n${req.editor.visibleText}` }
        ];
        const resp = await client.chatCompletion(messages, undefined, req.sessionId, {
            model: route.model,
            max_tokens: req.maxTokens ?? 128,
            temperature: 0.2
        });
        const text = typeof resp.content === 'string' ? resp.content : '';
        const latencyMs = Math.round(perf_hooks_1.performance.now() - t0);
        this.metrics.record({ capability: req.capability, provider: route.provider, model: route.model, ok: true, latencyMs });
        return {
            requestId,
            capability: 'inline',
            route,
            latencyMs,
            suggestions: [{ text: text.trimStart(), kind: 'insert' }]
        };
    }
    async editorAction(req) {
        const requestId = ensureRequestId(req);
        const t0 = perf_hooks_1.performance.now();
        const baseCfg = this.configStore.get();
        const cfg = mergeRuntimeConfig(baseCfg, req.llmConfig);
        const decision = (0, router_1.decideRoute)(req, cfg);
        const target = decision.primary;
        const { client, route } = this.llmFactory.get(target, cfg);
        const context = await this.contextManager.buildSystemContext(req.editor, { maxChars: 6500 });
        const system = `You are an IDE editor assistant. Follow the instruction and respond with the result.`;
        const user = `${context}\n\nAction: ${req.action}\nInstruction: ${req.instruction}\n\nVisible text:\n${req.editor.visibleText}`;
        const messages = [
            { role: 'system', content: system },
            { role: 'user', content: user }
        ];
        const resp = await client.chatCompletion(messages, undefined, req.sessionId, {
            model: route.model,
            max_tokens: 1024,
            temperature: 0.2
        });
        const content = typeof resp.content === 'string' ? resp.content : '';
        const latencyMs = Math.round(perf_hooks_1.performance.now() - t0);
        this.metrics.record({ capability: req.capability, provider: route.provider, model: route.model, ok: true, latencyMs });
        return { requestId, capability: 'editorAction', route, latencyMs, content };
    }
    async tools(req) {
        const requestId = ensureRequestId(req);
        const t0 = perf_hooks_1.performance.now();
        const baseCfg = this.configStore.get();
        const cfg = mergeRuntimeConfig(baseCfg, undefined);
        const decision = (0, router_1.decideRoute)(req, cfg);
        const route = decision.primary;
        const result = await this.toolExecutor.execute(req.toolName, req.args, req.sessionId);
        const latencyMs = Math.round(perf_hooks_1.performance.now() - t0);
        this.metrics.record({ capability: req.capability, provider: route.provider, model: route.model, ok: true, latencyMs });
        return { requestId, capability: 'tools', route, latencyMs, result };
    }
    async embeddings(req) {
        const requestId = ensureRequestId(req);
        const t0 = perf_hooks_1.performance.now();
        const baseCfg = this.configStore.get();
        const cfg = mergeRuntimeConfig(baseCfg, req.llmConfig);
        const decision = (0, router_1.decideRoute)(req, cfg);
        const vectors = await (0, embeddings_1.embedTexts)(req.texts, cfg, req.model);
        const latencyMs = Math.round(perf_hooks_1.performance.now() - t0);
        const route = { provider: vectors.provider, model: vectors.model };
        this.metrics.record({ capability: req.capability, provider: route.provider, model: route.model, ok: true, latencyMs });
        return { requestId, capability: 'embeddings', route, latencyMs, vectors: vectors.vectors };
    }
    async handle(req) {
        if (req.capability === 'inline')
            return this.inline(req);
        if (req.capability === 'editorAction')
            return this.editorAction(req);
        if (req.capability === 'tools')
            return this.tools(req);
        if (req.capability === 'embeddings')
            return this.embeddings(req);
        throw new Error(`Non-stream chat must use chatStream: ${req.capability}`);
    }
}
exports.AiEngine = AiEngine;

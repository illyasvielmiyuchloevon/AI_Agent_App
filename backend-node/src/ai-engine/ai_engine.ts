import { performance } from 'perf_hooks';
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

function ensureRequestId(req: AiEngineRequest) {
  return req.requestId && req.requestId.trim().length > 0 ? req.requestId : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  const supportedProviders = new Set(['openai', 'anthropic', 'openrouter', 'xai', 'ollama', 'lmstudio']);
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
    this.configStore.startWatching();
  }

  getMetrics() {
    return this.metrics.snapshot();
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
    const contextAddendum = await this.contextManager.buildSystemContext(req.editor, { maxChars: 6000 });
    let sessionSummary = '';
    let sessionSummaryReady = false;

    const run = (target: AiRouteTarget): AsyncGenerator<string, void, unknown> => {
      const self = this;
      return (async function* () {
        const { client, route } = self.llmFactory.get(target, cfg);
        const sessionId = req.sessionId;
        const contextMaxLength = (req.llmConfig && typeof req.llmConfig.context_max_length === 'number') ? (req.llmConfig.context_max_length as number) : 128000;
        const agent = new Agent(client, sessionId, contextMaxLength);
        agent.setMode(req.mode || 'chat', req.toolOverrides);
        if (!sessionSummaryReady) {
          sessionSummaryReady = true;
          sessionSummary = await self.contextManager.buildSessionSummary(sessionId, client, route.model);
        }
        const combinedContext = [sessionSummary ? `Session summary:\n${sessionSummary}` : '', contextAddendum].filter(Boolean).join('\n\n');
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

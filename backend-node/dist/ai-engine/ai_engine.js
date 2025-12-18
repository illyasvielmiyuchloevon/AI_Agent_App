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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiEngine = void 0;
const perf_hooks_1 = require("perf_hooks");
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
function ensureRequestId(req) {
    return req.requestId && req.requestId.trim().length > 0 ? req.requestId : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
    const next = (0, runtime_config_1.normalizeRuntimeConfig)(base);
    const supportedProviders = new Set(['openai', 'anthropic', 'openrouter', 'xai', 'ollama', 'lmstudio']);
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
    constructor(opts) {
        this.configStore = opts?.configStore || new config_store_1.AiEngineConfigStore();
        this.llmFactory = opts?.llmFactory || new llm_factory_1.LlmClientFactory();
        this.contextManager = opts?.contextManager || new context_manager_1.AiContextManager();
        this.toolExecutor = opts?.toolExecutor || new tool_executor_1.AiToolExecutor();
        this.metrics = opts?.metrics || new metrics_1.AiEngineMetrics();
    }
    async init() {
        await db.initDb();
        await this.configStore.loadOnce();
        this.configStore.startWatching();
    }
    getMetrics() {
        return this.metrics.snapshot();
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
        const contextAddendum = await this.contextManager.buildSystemContext(req.editor, { maxChars: 6000 });
        let sessionSummary = '';
        let sessionSummaryReady = false;
        const run = (target) => {
            const self = this;
            return (async function* () {
                const { client, route } = self.llmFactory.get(target, cfg);
                const sessionId = req.sessionId;
                const contextMaxLength = (req.llmConfig && typeof req.llmConfig.context_max_length === 'number') ? req.llmConfig.context_max_length : 128000;
                const agent = new agent_1.Agent(client, sessionId, contextMaxLength);
                agent.setMode(req.mode || 'chat', req.toolOverrides);
                if (!sessionSummaryReady) {
                    sessionSummaryReady = true;
                    sessionSummary = await self.contextManager.buildSessionSummary(sessionId, client, route.model);
                }
                const combinedContext = [sessionSummary ? `Session summary:\n${sessionSummary}` : '', contextAddendum].filter(Boolean).join('\n\n');
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

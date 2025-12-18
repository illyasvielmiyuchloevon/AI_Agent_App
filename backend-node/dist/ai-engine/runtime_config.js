"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeRuntimeConfig = normalizeRuntimeConfig;
exports.getRoutingTargetsForCapability = getRoutingTargetsForCapability;
function normalizeRuntimeConfig(raw) {
    const env = (raw?.env || (process.env.NODE_ENV === 'production' ? 'prod' : process.env.NODE_ENV === 'test' ? 'test' : 'dev'));
    const cfg = {
        env,
        defaultProvider: raw?.defaultProvider || 'openai',
        defaultModels: raw?.defaultModels || { general: 'gpt-4o-mini', fast: 'gpt-4o-mini', reasoning: 'gpt-4o', embeddings: 'text-embedding-3-small' },
        providers: raw?.providers || {},
        routing: raw?.routing || {},
        thresholds: raw?.thresholds || { longTextChars: 12000 },
        retries: raw?.retries || { maxAttempts: 2, baseDelayMs: 250 },
        metrics: raw?.metrics || { enabled: true }
    };
    return cfg;
}
function getRoutingTargetsForCapability(cfg, capability) {
    const list = cfg.routing?.[capability] || [];
    return Array.isArray(list) ? list.filter(Boolean) : [];
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeRuntimeConfig = normalizeRuntimeConfig;
exports.getRoutingTargetsForCapability = getRoutingTargetsForCapability;
function normalizeProviderPoolsConfig(raw) {
    if (!raw || typeof raw !== 'object')
        return undefined;
    const asAny = raw;
    if (typeof asAny.apiKey === 'string' && asAny.apiKey.trim().length > 0) {
        return {
            defaultPoolId: 'default',
            pools: { default: { apiKey: asAny.apiKey, baseUrl: typeof asAny.baseUrl === 'string' ? asAny.baseUrl : undefined } }
        };
    }
    const pools = asAny.pools;
    if (!pools || typeof pools !== 'object')
        return undefined;
    const out = {};
    for (const [poolId, poolRaw] of Object.entries(pools)) {
        if (!poolRaw || typeof poolRaw !== 'object')
            continue;
        const poolAny = poolRaw;
        if (typeof poolAny.apiKey !== 'string' || poolAny.apiKey.trim().length === 0)
            continue;
        out[poolId] = { apiKey: poolAny.apiKey, baseUrl: typeof poolAny.baseUrl === 'string' ? poolAny.baseUrl : undefined };
    }
    const poolIds = Object.keys(out);
    if (poolIds.length === 0)
        return undefined;
    const defaultPoolId = typeof asAny.defaultPoolId === 'string' && poolIds.includes(asAny.defaultPoolId) ? asAny.defaultPoolId : poolIds[0];
    return { defaultPoolId, pools: out };
}
function normalizeRuntimeConfig(raw) {
    const env = (raw?.env || (process.env.NODE_ENV === 'production' ? 'prod' : process.env.NODE_ENV === 'test' ? 'test' : 'dev'));
    const providers = {};
    if (raw?.providers && typeof raw.providers === 'object') {
        for (const [providerId, providerRaw] of Object.entries(raw.providers)) {
            const normalized = normalizeProviderPoolsConfig(providerRaw);
            if (normalized)
                providers[providerId] = normalized;
        }
    }
    const cfg = {
        env,
        defaultProvider: raw?.defaultProvider || 'openai',
        defaultModels: raw?.defaultModels || {
            general: 'gpt-4o-mini',
            fast: 'gpt-4o-mini',
            reasoning: 'gpt-4o',
            embeddings: 'Qwen/Qwen3-Embedding-0.6B',
            tools: 'gpt-4o-mini'
        },
        providers,
        routing: raw?.routing || {},
        embeddingOptions: raw?.embeddingOptions || {},
        thresholds: raw?.thresholds || { longTextChars: 12000 },
        retries: raw?.retries || { maxAttempts: 2, baseDelayMs: 250 },
        metrics: raw?.metrics || { enabled: true },
        features: raw?.features || { workspaceSemanticSearch: true }
    };
    return cfg;
}
function getRoutingTargetsForCapability(cfg, capability) {
    const list = cfg.routing?.[capability] || [];
    return Array.isArray(list) ? list.filter(Boolean) : [];
}

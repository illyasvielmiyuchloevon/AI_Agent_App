"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LlmClientFactory = void 0;
const llm_1 = require("../core/llm");
function buildKey(provider, apiKey, baseUrl, model) {
    return `${provider}:${model || ''}:${baseUrl || ''}:${apiKey.slice(0, 6)}`;
}
function isOpenAiCompatible(provider) {
    return provider === 'openai' || provider === 'openrouter' || provider === 'xai' || provider === 'ollama' || provider === 'lmstudio';
}
class LlmClientFactory {
    cache = new Map();
    maxIdleMs = 15 * 60 * 1000;
    get(route, cfg) {
        const provider = route.provider;
        if (!isOpenAiCompatible(provider) && provider !== 'anthropic') {
            throw new Error(`Unsupported provider: ${provider}`);
        }
        const providerCfg = cfg.providers?.[provider];
        const pools = providerCfg?.pools;
        if (!pools || typeof pools !== 'object') {
            throw new Error(`Missing provider config for ${provider}`);
        }
        const desiredPoolId = typeof route.poolId === 'string' && route.poolId.trim().length > 0
            ? route.poolId.trim()
            : (typeof providerCfg.defaultPoolId === 'string' && providerCfg.defaultPoolId.trim().length > 0 ? providerCfg.defaultPoolId.trim() : undefined);
        const poolId = (desiredPoolId && pools[desiredPoolId]) ? desiredPoolId : Object.keys(pools)[0];
        const pool = pools[poolId];
        if (!pool?.apiKey || pool.apiKey.trim().length === 0) {
            throw new Error(`Missing apiKey for provider ${provider}`);
        }
        const model = route.model || cfg.defaultModels?.general;
        const key = `${poolId}:` + buildKey(provider, pool.apiKey, pool.baseUrl, model);
        const cached = this.cache.get(key);
        if (cached) {
            cached.lastUsedAt = Date.now();
            return { route: { ...route, model, poolId }, client: cached.client };
        }
        const client = provider === 'anthropic'
            ? new llm_1.AnthropicProvider(pool.apiKey, model || 'claude-3-5-sonnet-latest', pool.baseUrl)
            : new llm_1.OpenAIProvider(pool.apiKey, model || 'gpt-4o-mini', pool.baseUrl);
        this.cache.set(key, { client, lastUsedAt: Date.now() });
        this.evictIdle();
        return { route: { ...route, model, poolId }, client };
    }
    evictIdle() {
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.lastUsedAt > this.maxIdleMs)
                this.cache.delete(key);
        }
    }
}
exports.LlmClientFactory = LlmClientFactory;

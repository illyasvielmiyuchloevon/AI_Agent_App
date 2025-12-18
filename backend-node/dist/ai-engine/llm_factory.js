"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LlmClientFactory = void 0;
const llm_1 = require("../core/llm");
function buildKey(provider, apiKey, baseUrl, model) {
    return `${provider}:${model || ''}:${baseUrl || ''}:${apiKey.slice(0, 6)}`;
}
class LlmClientFactory {
    cache = new Map();
    maxIdleMs = 15 * 60 * 1000;
    get(route, cfg) {
        const provider = route.provider;
        if (provider !== 'openai' && provider !== 'anthropic') {
            throw new Error(`Unsupported provider for chat: ${provider}`);
        }
        const pool = cfg.providers?.[provider];
        if (!pool?.apiKey) {
            throw new Error(`Missing apiKey for provider ${provider}`);
        }
        const model = route.model || cfg.defaultModels?.general;
        const key = buildKey(provider, pool.apiKey, pool.baseUrl, model);
        const cached = this.cache.get(key);
        if (cached) {
            cached.lastUsedAt = Date.now();
            return { route: { ...route, model }, client: cached.client };
        }
        const client = provider === 'openai'
            ? new llm_1.OpenAIProvider(pool.apiKey, model || 'gpt-4o-mini', pool.baseUrl)
            : new llm_1.AnthropicProvider(pool.apiKey, model || 'claude-3-5-sonnet-latest', pool.baseUrl);
        this.cache.set(key, { client, lastUsedAt: Date.now() });
        this.evictIdle();
        return { route: { ...route, model }, client };
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

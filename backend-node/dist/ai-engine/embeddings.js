"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.embedTexts = embedTexts;
const openai_1 = __importDefault(require("openai"));
const crypto_1 = __importDefault(require("crypto"));
function localEmbed(text, dims) {
    const out = new Array(dims);
    const hash = crypto_1.default.createHash('sha256').update(text).digest();
    for (let i = 0; i < dims; i += 1) {
        const b = hash[i % hash.length];
        out[i] = (b - 128) / 128;
    }
    return out;
}
async function embedTexts(texts, cfg, modelOverride) {
    const model = modelOverride || cfg.defaultModels?.embeddings || 'text-embedding-3-small';
    const openAiCompatibleProviders = ['openai', 'openrouter', 'xai', 'lmstudio', 'ollama'];
    const preferred = cfg.defaultProvider && openAiCompatibleProviders.includes(cfg.defaultProvider) ? [cfg.defaultProvider, ...openAiCompatibleProviders] : openAiCompatibleProviders;
    const candidates = Array.from(new Set(preferred));
    for (const provider of candidates) {
        const providerCfg = cfg.providers?.[provider];
        const pools = providerCfg?.pools;
        if (!pools)
            continue;
        const poolId = providerCfg.defaultPoolId || Object.keys(pools)[0];
        const pool = pools[poolId];
        if (!pool?.apiKey)
            continue;
        const client = new openai_1.default({
            apiKey: pool.apiKey,
            baseURL: pool.baseUrl && pool.baseUrl.trim().length > 0 ? pool.baseUrl.trim() : undefined
        });
        const resp = await client.embeddings.create({ model, input: texts });
        const vectors = resp.data.map(d => d.embedding);
        return { vectors, provider, model };
    }
    const dims = 384;
    return { vectors: texts.map(t => localEmbed(t, dims)), provider: 'local', model: 'local-hash-384' };
}

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
    const openAiCompatibleProviders = ['llamacpp', 'openai', 'openrouter', 'xai', 'lmstudio', 'ollama'];
    const routed = Array.isArray(cfg.routing?.embeddings) ? cfg.routing.embeddings.map(r => r.provider).filter(Boolean) : [];
    const envBaseUrl = (process.env.LLAMACPP_EMBEDDINGS_BASE_URL || '').trim();
    const envApiKey = (process.env.LLAMACPP_EMBEDDINGS_API_KEY || '').trim();
    const preferred = [
        ...(envBaseUrl ? ['llamacpp'] : []),
        ...routed,
        ...(cfg.defaultProvider && openAiCompatibleProviders.includes(cfg.defaultProvider) ? [cfg.defaultProvider] : []),
        ...openAiCompatibleProviders
    ];
    const candidates = Array.from(new Set(preferred)).filter(p => openAiCompatibleProviders.includes(p));
    for (const provider of candidates) {
        if (provider === 'llamacpp' && envBaseUrl) {
            const requestModel = (process.env.LLAMACPP_EMBEDDINGS_MODEL || '').trim() || model;
            const client = new openai_1.default({
                apiKey: envApiKey || 'local',
                baseURL: envBaseUrl
            });
            const resp = await client.embeddings.create({ model: requestModel, input: texts });
            const vectors = resp.data.map(d => d.embedding);
            if (process.env.LLAMACPP_EMBEDDINGS_L2_NORMALIZE === '1') {
                for (let i = 0; i < vectors.length; i += 1) {
                    const v = vectors[i];
                    let sum = 0;
                    for (let j = 0; j < v.length; j += 1)
                        sum += v[j] * v[j];
                    const inv = sum > 0 ? 1 / Math.sqrt(sum) : 0;
                    if (inv > 0)
                        for (let j = 0; j < v.length; j += 1)
                            v[j] *= inv;
                }
            }
            return { vectors, provider, model: requestModel };
        }
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

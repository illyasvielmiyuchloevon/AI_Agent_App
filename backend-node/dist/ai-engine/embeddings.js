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
    const openaiPool = cfg.providers?.openai;
    const model = modelOverride || cfg.defaultModels?.embeddings || 'text-embedding-3-small';
    if (openaiPool?.apiKey) {
        const client = new openai_1.default({
            apiKey: openaiPool.apiKey,
            baseURL: openaiPool.baseUrl && openaiPool.baseUrl.trim().length > 0 ? openaiPool.baseUrl.trim() : undefined
        });
        const resp = await client.embeddings.create({ model, input: texts });
        const vectors = resp.data.map(d => d.embedding);
        return { vectors, provider: 'openai', model };
    }
    const dims = 384;
    return { vectors: texts.map(t => localEmbed(t, dims)), provider: 'local', model: 'local-hash-384' };
}

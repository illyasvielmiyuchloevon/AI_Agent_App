import OpenAI from 'openai';
import crypto from 'crypto';
import { AiProviderId } from './contracts';
import { AiEngineRuntimeConfig } from './runtime_config';

export interface EmbeddingsResult {
  vectors: number[][];
  provider: AiProviderId;
  model?: string;
}

function localEmbed(text: string, dims: number) {
  const out = new Array<number>(dims);
  const hash = crypto.createHash('sha256').update(text).digest();
  for (let i = 0; i < dims; i += 1) {
    const b = hash[i % hash.length];
    out[i] = (b - 128) / 128;
  }
  return out;
}

export async function embedTexts(texts: string[], cfg: AiEngineRuntimeConfig, modelOverride?: string): Promise<EmbeddingsResult> {
  const model = modelOverride || cfg.defaultModels?.embeddings || 'text-embedding-3-small';
  const openAiCompatibleProviders: AiProviderId[] = ['openai', 'openrouter', 'xai', 'lmstudio', 'ollama'];
  const preferred = cfg.defaultProvider && openAiCompatibleProviders.includes(cfg.defaultProvider) ? [cfg.defaultProvider, ...openAiCompatibleProviders] : openAiCompatibleProviders;
  const candidates = Array.from(new Set(preferred));

  for (const provider of candidates) {
    const providerCfg = cfg.providers?.[provider];
    const pools = providerCfg?.pools;
    if (!pools) continue;
    const poolId = providerCfg.defaultPoolId || Object.keys(pools)[0];
    const pool = pools[poolId];
    if (!pool?.apiKey) continue;
    const client = new OpenAI({
      apiKey: pool.apiKey,
      baseURL: pool.baseUrl && pool.baseUrl.trim().length > 0 ? pool.baseUrl.trim() : undefined
    });
    const resp = await client.embeddings.create({ model, input: texts });
    const vectors = resp.data.map(d => d.embedding as number[]);
    return { vectors, provider, model };
  }

  const dims = 384;
  return { vectors: texts.map(t => localEmbed(t, dims)), provider: 'local', model: 'local-hash-384' };
}

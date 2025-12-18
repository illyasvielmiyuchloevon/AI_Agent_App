import OpenAI from 'openai';
import crypto from 'crypto';
import { AiEngineRuntimeConfig } from './runtime_config';

export interface EmbeddingsResult {
  vectors: number[][];
  provider: 'openai' | 'local';
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
  const openaiPool = cfg.providers?.openai;
  const model = modelOverride || cfg.defaultModels?.embeddings || 'text-embedding-3-small';
  if (openaiPool?.apiKey) {
    const client = new OpenAI({
      apiKey: openaiPool.apiKey,
      baseURL: openaiPool.baseUrl && openaiPool.baseUrl.trim().length > 0 ? openaiPool.baseUrl.trim() : undefined
    });
    const resp = await client.embeddings.create({ model, input: texts });
    const vectors = resp.data.map(d => d.embedding as number[]);
    return { vectors, provider: 'openai', model };
  }

  const dims = 384;
  return { vectors: texts.map(t => localEmbed(t, dims)), provider: 'local', model: 'local-hash-384' };
}


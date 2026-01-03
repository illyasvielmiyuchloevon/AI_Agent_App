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

function buildOpenAiCompatEmbeddingsUrl(baseUrl: string) {
  const cleaned = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!cleaned) return '';
  if (cleaned.toLowerCase().endsWith('/v1')) return `${cleaned}/embeddings`;
  return `${cleaned}/v1/embeddings`;
}

function clampPositiveInt(n: unknown) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return undefined;
  return Math.max(1, Math.round(x));
}

function applyVectorDims(vectors: number[][], dims: number | undefined) {
  if (!dims) return vectors;
  for (let i = 0; i < vectors.length; i += 1) {
    const v = vectors[i];
    if (!Array.isArray(v) || v.length <= dims) continue;
    vectors[i] = v.slice(0, dims);
  }
  return vectors;
}

function l2NormalizeInPlace(vectors: number[][]) {
  for (let i = 0; i < vectors.length; i += 1) {
    const v = vectors[i];
    let sum = 0;
    for (let j = 0; j < v.length; j += 1) sum += v[j] * v[j];
    const inv = sum > 0 ? 1 / Math.sqrt(sum) : 0;
    if (inv > 0) for (let j = 0; j < v.length; j += 1) v[j] *= inv;
  }
}

async function createEmbeddingsOpenAiCompat(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  input: string[];
  extraBody?: Record<string, unknown>;
}) {
  const url = buildOpenAiCompatEmbeddingsUrl(opts.baseUrl);
  if (!url) throw new Error('Missing embeddings baseUrl');
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey || 'local'}`
    },
    body: JSON.stringify({
      model: opts.model,
      input: opts.input,
      ...(opts.extraBody || {})
    })
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = typeof data?.error?.message === 'string' ? data.error.message : (typeof data?.detail === 'string' ? data.detail : resp.statusText);
    throw new Error(msg || `Embeddings request failed (${resp.status})`);
  }
  return data;
}

export async function embedTexts(texts: string[], cfg: AiEngineRuntimeConfig, modelOverride?: string): Promise<EmbeddingsResult> {
  const contextTokens = clampPositiveInt(cfg.embeddingOptions?.contextMaxLength);
  const preparedTexts = (() => {
    if (!contextTokens) return texts;
    const maxChars = Math.max(1024, Math.min(400000, contextTokens * 4));
    const eot = '<|endoftext|>';
    return texts.map((t) => {
      const s = String(t || '');
      if (s.length <= maxChars) return s;
      const hadEot = s.endsWith(eot);
      if (!hadEot) return s.slice(0, maxChars);
      const base = s.slice(0, maxChars);
      if (base.endsWith(eot)) return base;
      const head = base.slice(0, Math.max(0, maxChars - eot.length));
      return `${head}${eot}`;
    });
  })();

  const routingModel =
    Array.isArray(cfg.routing?.embeddings) && cfg.routing!.embeddings!.length > 0
      ? (typeof (cfg.routing!.embeddings![0] as any)?.model === 'string' ? String((cfg.routing!.embeddings![0] as any).model) : '')
      : '';
  const model = modelOverride || (routingModel && routingModel.trim().length > 0 ? routingModel.trim() : undefined) || cfg.defaultModels?.embeddings || 'text-embedding-3-small';
  const openAiCompatibleProviders: AiProviderId[] = ['llamacpp', 'openai', 'openrouter', 'xai', 'lmstudio', 'ollama'];
  const routed = Array.isArray(cfg.routing?.embeddings) ? cfg.routing!.embeddings!.map(r => r.provider).filter(Boolean) : [];
  const envBaseUrl = (process.env.LLAMACPP_EMBEDDINGS_BASE_URL || '').trim();
  const envApiKey = (process.env.LLAMACPP_EMBEDDINGS_API_KEY || '').trim();
  const preferred = [
    ...(envBaseUrl ? (['llamacpp'] as AiProviderId[]) : []),
    ...routed,
    ...(cfg.defaultProvider && openAiCompatibleProviders.includes(cfg.defaultProvider) ? [cfg.defaultProvider] : []),
    ...openAiCompatibleProviders
  ];
  const candidates = Array.from(new Set(preferred)).filter(p => openAiCompatibleProviders.includes(p));
  const outputDimensions = clampPositiveInt(cfg.embeddingOptions?.outputDimensions);
  const embdNormalize = Number.isFinite(Number(cfg.embeddingOptions?.embdNormalize)) ? Math.round(Number(cfg.embeddingOptions?.embdNormalize)) : undefined;
  const envForceL2 = (process.env.LLAMACPP_EMBEDDINGS_L2_NORMALIZE === '1');

  for (const provider of candidates) {
    const isLlamaCppEnv = provider === 'llamacpp' && !!envBaseUrl;
    const providerCfg = cfg.providers?.[provider];
    const pools = providerCfg?.pools;
    const poolId = providerCfg?.defaultPoolId || (pools ? Object.keys(pools)[0] : undefined);
    const pool = (pools && poolId) ? pools[poolId] : undefined;

    const apiKey = isLlamaCppEnv ? (envApiKey || 'local') : (pool?.apiKey || '');
    const baseUrl = isLlamaCppEnv ? envBaseUrl : (pool?.baseUrl || '');
    if (!apiKey || apiKey.trim().length === 0) continue;
    if (!baseUrl || baseUrl.trim().length === 0) continue;

    const requestModel = (isLlamaCppEnv ? (process.env.LLAMACPP_EMBEDDINGS_MODEL || '').trim() : '') || model;
    const extraBody: Record<string, unknown> = {};
    if (provider === 'llamacpp' && typeof embdNormalize === 'number') extraBody.embd_normalize = embdNormalize;
    if (provider !== 'llamacpp' && outputDimensions) extraBody.dimensions = outputDimensions;

    const resp = await createEmbeddingsOpenAiCompat({
      apiKey,
      baseUrl,
      model: requestModel,
      input: preparedTexts,
      extraBody: Object.keys(extraBody).length > 0 ? extraBody : undefined
    });

    const vectorsRaw = Array.isArray(resp?.data) ? resp.data : [];
    const vectors: number[][] = vectorsRaw.map((d: any) => (Array.isArray(d?.embedding) ? (d.embedding as number[]) : []));
    if (vectors.length === 0 || vectors.some(v => !Array.isArray(v) || v.length === 0)) continue;

    applyVectorDims(vectors, outputDimensions);
    if (envForceL2 && (provider === 'llamacpp') && embdNormalize === undefined) {
      l2NormalizeInPlace(vectors);
    }

    return { vectors, provider, model: requestModel };
  }

  const dims = 384;
  return { vectors: preparedTexts.map(t => localEmbed(t, dims)), provider: 'local', model: 'local-hash-384' };
}

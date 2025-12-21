import { AiCapability, AiProviderId, AiRouteTarget } from './contracts';

export interface AiProviderPoolConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface AiProviderPoolsConfig {
  defaultPoolId?: string;
  pools: Record<string, AiProviderPoolConfig>;
}

export interface AiEngineRoutingConfig {
  chat?: AiRouteTarget[];
  inline?: AiRouteTarget[];
  editorAction?: AiRouteTarget[];
  tools?: AiRouteTarget[];
  embeddings?: AiRouteTarget[];
}

export interface AiEngineRuntimeConfig {
  env: 'dev' | 'test' | 'prod';
  defaultProvider?: AiProviderId;
  defaultModels?: Partial<Record<'general' | 'fast' | 'reasoning' | 'embeddings' | 'tools', string>>;
  providers?: Partial<Record<AiProviderId, AiProviderPoolsConfig>>;
  routing?: AiEngineRoutingConfig;
  thresholds?: {
    longTextChars?: number;
  };
  retries?: {
    maxAttempts?: number;
    baseDelayMs?: number;
  };
  metrics?: {
    enabled?: boolean;
  };
}

function normalizeProviderPoolsConfig(raw: unknown): AiProviderPoolsConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;

  const asAny = raw as any;
  if (typeof asAny.apiKey === 'string' && asAny.apiKey.trim().length > 0) {
    return {
      defaultPoolId: 'default',
      pools: { default: { apiKey: asAny.apiKey, baseUrl: typeof asAny.baseUrl === 'string' ? asAny.baseUrl : undefined } }
    };
  }

  const pools = asAny.pools;
  if (!pools || typeof pools !== 'object') return undefined;

  const out: Record<string, AiProviderPoolConfig> = {};
  for (const [poolId, poolRaw] of Object.entries(pools as Record<string, unknown>)) {
    if (!poolRaw || typeof poolRaw !== 'object') continue;
    const poolAny = poolRaw as any;
    if (typeof poolAny.apiKey !== 'string' || poolAny.apiKey.trim().length === 0) continue;
    out[poolId] = { apiKey: poolAny.apiKey, baseUrl: typeof poolAny.baseUrl === 'string' ? poolAny.baseUrl : undefined };
  }
  const poolIds = Object.keys(out);
  if (poolIds.length === 0) return undefined;

  const defaultPoolId = typeof asAny.defaultPoolId === 'string' && poolIds.includes(asAny.defaultPoolId) ? asAny.defaultPoolId : poolIds[0];
  return { defaultPoolId, pools: out };
}

export function normalizeRuntimeConfig(raw: Partial<AiEngineRuntimeConfig> | null | undefined): AiEngineRuntimeConfig {
  const env = (raw?.env || (process.env.NODE_ENV === 'production' ? 'prod' : process.env.NODE_ENV === 'test' ? 'test' : 'dev')) as
    | 'dev'
    | 'test'
    | 'prod';

  const providers: Partial<Record<AiProviderId, AiProviderPoolsConfig>> = {};
  if (raw?.providers && typeof raw.providers === 'object') {
    for (const [providerId, providerRaw] of Object.entries(raw.providers as Record<string, unknown>)) {
      const normalized = normalizeProviderPoolsConfig(providerRaw);
      if (normalized) (providers as any)[providerId] = normalized;
    }
  }

  const cfg: AiEngineRuntimeConfig = {
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
    thresholds: raw?.thresholds || { longTextChars: 12000 },
    retries: raw?.retries || { maxAttempts: 2, baseDelayMs: 250 },
    metrics: raw?.metrics || { enabled: true }
  };

  return cfg;
}

export function getRoutingTargetsForCapability(cfg: AiEngineRuntimeConfig, capability: AiCapability): AiRouteTarget[] {
  const list = cfg.routing?.[capability] || [];
  return Array.isArray(list) ? list.filter(Boolean) : [];
}

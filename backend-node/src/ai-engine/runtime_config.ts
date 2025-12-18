import { AiCapability, AiProviderId, AiRouteTarget } from './contracts';

export interface AiProviderPoolConfig {
  apiKey: string;
  baseUrl?: string;
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
  providers?: Partial<Record<AiProviderId, AiProviderPoolConfig>>;
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

export function normalizeRuntimeConfig(raw: Partial<AiEngineRuntimeConfig> | null | undefined): AiEngineRuntimeConfig {
  const env = (raw?.env || (process.env.NODE_ENV === 'production' ? 'prod' : process.env.NODE_ENV === 'test' ? 'test' : 'dev')) as
    | 'dev'
    | 'test'
    | 'prod';

  const cfg: AiEngineRuntimeConfig = {
    env,
    defaultProvider: raw?.defaultProvider || 'openai',
    defaultModels: raw?.defaultModels || { general: 'gpt-4o-mini', fast: 'gpt-4o-mini', reasoning: 'gpt-4o', embeddings: 'text-embedding-3-small' },
    providers: raw?.providers || {},
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


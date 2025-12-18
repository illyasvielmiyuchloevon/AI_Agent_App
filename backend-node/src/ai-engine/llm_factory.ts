import { LLMClient, OpenAIProvider, AnthropicProvider } from '../core/llm';
import { AiProviderId, AiRouteTarget } from './contracts';
import { AiEngineRuntimeConfig } from './runtime_config';

export interface BuiltLlmTarget {
  route: AiRouteTarget;
  client: LLMClient;
}

function buildKey(provider: AiProviderId, apiKey: string, baseUrl: string | undefined, model: string | undefined) {
  return `${provider}:${model || ''}:${baseUrl || ''}:${apiKey.slice(0, 6)}`;
}

export class LlmClientFactory {
  private cache = new Map<string, { client: LLMClient; lastUsedAt: number }>();
  private maxIdleMs = 15 * 60 * 1000;

  get(route: AiRouteTarget, cfg: AiEngineRuntimeConfig): BuiltLlmTarget {
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

    const client =
      provider === 'openai'
        ? new OpenAIProvider(pool.apiKey, model || 'gpt-4o-mini', pool.baseUrl)
        : new AnthropicProvider(pool.apiKey, model || 'claude-3-5-sonnet-latest', pool.baseUrl);

    this.cache.set(key, { client, lastUsedAt: Date.now() });
    this.evictIdle();
    return { route: { ...route, model }, client };
  }

  private evictIdle() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.lastUsedAt > this.maxIdleMs) this.cache.delete(key);
    }
  }
}


import { AiCapability, AiEngineRequest, AiProviderId, AiRouteTarget } from './contracts';
import { AiEngineRuntimeConfig } from './runtime_config';

export interface AiRouteDecision {
  primary: AiRouteTarget;
  fallbacks: AiRouteTarget[];
  reason: string;
}

function pickModelForCapability(capability: AiCapability) {
  if (capability === 'inline') return 'fast';
  if (capability === 'editorAction') return 'reasoning';
  if (capability === 'embeddings') return 'embeddings';
  if (capability === 'tools') return 'tools';
  return 'general';
}

function estimateSizeHint(req: AiEngineRequest): number {
  if (req.capability === 'chat') return (req.message || '').length;
  if (req.capability === 'inline') return req.editor.visibleText.length;
  if (req.capability === 'editorAction') return (req.instruction || '').length + req.editor.visibleText.length;
  if (req.capability === 'embeddings') return req.texts.reduce((acc, t) => acc + t.length, 0);
  return 0;
}

function hasProvider(cfg: AiEngineRuntimeConfig, provider: AiProviderId) {
  const providerCfg = cfg.providers?.[provider];
  const pools = providerCfg?.pools;
  if (!pools || typeof pools !== 'object') return false;
  return Object.values(pools).some((p) => !!p && typeof p.apiKey === 'string' && p.apiKey.trim().length > 0);
}

function defaultRouteFromConfig(cfg: AiEngineRuntimeConfig, capability: AiCapability): AiRouteDecision {
  const preferred = cfg.routing?.[capability]?.[0];
  if (preferred) {
    const fallbacks = (cfg.routing?.[capability] || []).slice(1);
    return {
      primary: preferred,
      fallbacks,
      reason: 'routing.config'
    };
  }

  const provider = cfg.defaultProvider || 'openai';
  const modelRole = pickModelForCapability(capability);
  const model = cfg.defaultModels?.[modelRole] || cfg.defaultModels?.general;
  const primary: AiRouteTarget = { provider, model, tags: ['default'] };
  const fallbacks: AiRouteTarget[] = [];
  if (provider !== 'anthropic' && hasProvider(cfg, 'anthropic')) {
    fallbacks.push({ provider: 'anthropic', model: cfg.defaultModels?.general, tags: ['fallback'] });
  }
  if (provider !== 'openai' && hasProvider(cfg, 'openai')) {
    fallbacks.push({ provider: 'openai', model: cfg.defaultModels?.general, tags: ['fallback'] });
  }
  return { primary, fallbacks, reason: 'routing.default' };
}

export function decideRoute(req: AiEngineRequest, cfg: AiEngineRuntimeConfig): AiRouteDecision {
  const base = defaultRouteFromConfig(cfg, req.capability);

  const sizeHint = estimateSizeHint(req);
  const preferLongContext = sizeHint >= (cfg.thresholds?.longTextChars ?? 12000);

  if (!preferLongContext) return base;

  const route = { ...base };
  if (hasProvider(cfg, 'anthropic')) {
    route.primary = {
      provider: 'anthropic',
      model: cfg.defaultModels?.general || route.primary.model,
      tags: ['long-context']
    };
    route.fallbacks = [
      ...route.fallbacks.filter(r => r.provider !== 'anthropic'),
      base.primary.provider !== 'anthropic' ? base.primary : undefined
    ].filter(Boolean) as AiRouteTarget[];
    route.reason = 'routing.long-context';
    return route;
  }

  return base;
}

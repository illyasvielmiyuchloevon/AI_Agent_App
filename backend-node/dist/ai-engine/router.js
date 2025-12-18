"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decideRoute = decideRoute;
function pickModelForCapability(capability) {
    if (capability === 'inline')
        return 'fast';
    if (capability === 'editorAction')
        return 'reasoning';
    if (capability === 'embeddings')
        return 'embeddings';
    if (capability === 'tools')
        return 'tools';
    return 'general';
}
function estimateSizeHint(req) {
    if (req.capability === 'chat')
        return (req.message || '').length;
    if (req.capability === 'inline')
        return req.editor.visibleText.length;
    if (req.capability === 'editorAction')
        return (req.instruction || '').length + req.editor.visibleText.length;
    if (req.capability === 'embeddings')
        return req.texts.reduce((acc, t) => acc + t.length, 0);
    return 0;
}
function hasProvider(cfg, provider) {
    const pool = cfg.providers?.[provider];
    return !!pool && typeof pool.apiKey === 'string' && pool.apiKey.trim().length > 0;
}
function defaultRouteFromConfig(cfg, capability) {
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
    const primary = { provider, model, tags: ['default'] };
    const fallbacks = [];
    if (provider !== 'anthropic' && hasProvider(cfg, 'anthropic')) {
        fallbacks.push({ provider: 'anthropic', model: cfg.defaultModels?.general, tags: ['fallback'] });
    }
    if (provider !== 'openai' && hasProvider(cfg, 'openai')) {
        fallbacks.push({ provider: 'openai', model: cfg.defaultModels?.general, tags: ['fallback'] });
    }
    return { primary, fallbacks, reason: 'routing.default' };
}
function decideRoute(req, cfg) {
    const base = defaultRouteFromConfig(cfg, req.capability);
    const sizeHint = estimateSizeHint(req);
    const preferLongContext = sizeHint >= (cfg.thresholds?.longTextChars ?? 12000);
    if (!preferLongContext)
        return base;
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
        ].filter(Boolean);
        route.reason = 'routing.long-context';
        return route;
    }
    return base;
}

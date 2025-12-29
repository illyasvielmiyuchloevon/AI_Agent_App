const TRUST_LEVELS = /** @type {const} */ (['official', 'community', 'local']);

function isTrustLevel(value) {
  return TRUST_LEVELS.includes(String(value || ''));
}

function normalizePluginId(id) {
  const s = String(id || '').trim();
  if (!s) return '';
  return s.replace(/[^a-zA-Z0-9._@/\\-]/g, '_');
}

module.exports = {
  TRUST_LEVELS,
  isTrustLevel,
  normalizePluginId,
  REGISTRY_VERSION: 1,
};

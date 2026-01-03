/**
 * DetailCache - In-memory cache for plugin details with TTL support
 * 
 * Requirements: 5.1, 5.2, 5.3, 5.4
 * - Cache responses for 10 minutes (default TTL)
 * - Return cached data for requests within TTL
 * - Fetch fresh data after TTL expires
 * - Support forceRefresh to bypass cache
 */

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * @typedef {Object} CachedDetail
 * @property {Object} detail - The cached plugin detail
 * @property {number} cachedAt - Timestamp when cached
 * @property {number} expiresAt - Timestamp when cache expires
 */

class DetailCache {
  /**
   * @param {Object} options
   * @param {number} [options.defaultTtlMs] - Default TTL in milliseconds
   * @param {() => number} [options.now] - Function to get current time (for testing)
   */
  constructor({ defaultTtlMs = DEFAULT_TTL_MS, now } = {}) {
    /** @type {Map<string, CachedDetail>} */
    this._cache = new Map();
    this._defaultTtlMs = defaultTtlMs;
    this._now = now || (() => Date.now());
  }

  /**
   * Get cached detail if exists and not expired
   * @param {string} key - Cache key
   * @returns {CachedDetail | null} - Cached detail or null if not found/expired
   */
  get(key) {
    const k = String(key || '').trim();
    if (!k) return null;

    const entry = this._cache.get(k);
    if (!entry) return null;

    const now = this._now();
    if (now >= entry.expiresAt) {
      // Cache expired, remove it
      this._cache.delete(k);
      return null;
    }

    return entry;
  }

  /**
   * Store detail in cache with TTL
   * @param {string} key - Cache key
   * @param {Object} detail - Plugin detail to cache
   * @param {number} [ttlMs] - TTL in milliseconds (optional, uses default if not provided)
   */
  set(key, detail, ttlMs) {
    const k = String(key || '').trim();
    if (!k) return;

    const ttl = typeof ttlMs === 'number' && ttlMs > 0 ? ttlMs : this._defaultTtlMs;
    const now = this._now();

    this._cache.set(k, {
      detail,
      cachedAt: now,
      expiresAt: now + ttl,
    });
  }

  /**
   * Invalidate (remove) a specific cache entry
   * @param {string} key - Cache key to invalidate
   */
  invalidate(key) {
    const k = String(key || '').trim();
    if (k) {
      this._cache.delete(k);
    }
  }

  /**
   * Clear all cache entries
   */
  clear() {
    this._cache.clear();
  }

  /**
   * Get the number of entries in cache (for testing/debugging)
   * @returns {number}
   */
  size() {
    return this._cache.size;
  }
}

module.exports = { DetailCache, DEFAULT_TTL_MS };

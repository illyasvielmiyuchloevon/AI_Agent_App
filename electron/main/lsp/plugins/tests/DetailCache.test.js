/**
 * Property-based tests for DetailCache
 * 
 * **Feature: plugin-detail-api, Property 4: Cache Lifecycle Correctness**
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const { DetailCache, DEFAULT_TTL_MS } = require('../DetailCache');

// Arbitrary for generating plugin detail objects
const pluginDetailArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 50 }),
  name: fc.string({ minLength: 1, maxLength: 100 }),
  version: fc.string({ minLength: 1, maxLength: 20 }),
  description: fc.string({ maxLength: 500 }),
  readme: fc.option(fc.string({ maxLength: 1000 }), { nil: null }),
  changelog: fc.option(fc.string({ maxLength: 1000 }), { nil: null }),
});

// Arbitrary for cache keys (non-empty, non-whitespace-only)
const cacheKeyArb = fc.string({ minLength: 1, maxLength: 100 })
  .filter(s => s.trim().length > 0);

// Arbitrary for TTL values (positive integers)
const ttlArb = fc.integer({ min: 1, max: 60 * 60 * 1000 }); // 1ms to 1 hour

test('Property 4: Cache Lifecycle Correctness - set then get within TTL returns cached data', async () => {
  /**
   * **Feature: plugin-detail-api, Property 4: Cache Lifecycle Correctness**
   * **Validates: Requirements 5.1, 5.2**
   * 
   * For any plugin detail and cache key, when stored in cache,
   * subsequent get within TTL should return the same detail.
   */
  await fc.assert(
    fc.asyncProperty(cacheKeyArb, pluginDetailArb, ttlArb, async (key, detail, ttl) => {
      let currentTime = 1000000;
      const cache = new DetailCache({
        defaultTtlMs: ttl,
        now: () => currentTime,
      });

      // Set the detail
      cache.set(key, detail);

      // Get immediately (within TTL)
      const result = cache.get(key);
      assert.ok(result !== null, 'Cache should return entry within TTL');
      assert.deepEqual(result.detail, detail, 'Cached detail should match original');
      assert.equal(result.cachedAt, currentTime, 'cachedAt should be set correctly');
      assert.equal(result.expiresAt, currentTime + ttl, 'expiresAt should be cachedAt + TTL');
    }),
    { numRuns: 100 }
  );
});

test('Property 4: Cache Lifecycle Correctness - get after TTL expires returns null', async () => {
  /**
   * **Feature: plugin-detail-api, Property 4: Cache Lifecycle Correctness**
   * **Validates: Requirements 5.3**
   * 
   * For any cached detail, when time advances past TTL,
   * get should return null (cache miss).
   */
  await fc.assert(
    fc.asyncProperty(cacheKeyArb, pluginDetailArb, ttlArb, async (key, detail, ttl) => {
      let currentTime = 1000000;
      const cache = new DetailCache({
        defaultTtlMs: ttl,
        now: () => currentTime,
      });

      // Set the detail
      cache.set(key, detail);

      // Advance time past TTL
      currentTime += ttl + 1;

      // Get should return null (expired)
      const result = cache.get(key);
      assert.equal(result, null, 'Cache should return null after TTL expires');
    }),
    { numRuns: 100 }
  );
});

test('Property 4: Cache Lifecycle Correctness - invalidate removes entry', async () => {
  /**
   * **Feature: plugin-detail-api, Property 4: Cache Lifecycle Correctness**
   * **Validates: Requirements 5.4**
   * 
   * For any cached detail, invalidate should remove it,
   * simulating forceRefresh behavior.
   */
  await fc.assert(
    fc.asyncProperty(cacheKeyArb, pluginDetailArb, async (key, detail) => {
      const cache = new DetailCache();

      // Set the detail
      cache.set(key, detail);
      assert.ok(cache.get(key) !== null, 'Entry should exist after set');

      // Invalidate
      cache.invalidate(key);

      // Get should return null
      const result = cache.get(key);
      assert.equal(result, null, 'Cache should return null after invalidate');
    }),
    { numRuns: 100 }
  );
});

test('Property 4: Cache Lifecycle Correctness - clear removes all entries', async () => {
  /**
   * **Feature: plugin-detail-api, Property 4: Cache Lifecycle Correctness**
   * **Validates: Requirements 5.4**
   * 
   * For any set of cached details, clear should remove all entries.
   */
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.tuple(cacheKeyArb, pluginDetailArb), { minLength: 1, maxLength: 10 }),
      async (entries) => {
        const cache = new DetailCache();

        // Set multiple entries
        for (const [key, detail] of entries) {
          cache.set(key, detail);
        }

        // Clear all
        cache.clear();

        // All entries should be gone
        for (const [key] of entries) {
          const result = cache.get(key);
          assert.equal(result, null, `Entry ${key} should be removed after clear`);
        }
        assert.equal(cache.size(), 0, 'Cache size should be 0 after clear');
      }
    ),
    { numRuns: 100 }
  );
});

test('Property 4: Cache Lifecycle Correctness - custom TTL overrides default', async () => {
  /**
   * **Feature: plugin-detail-api, Property 4: Cache Lifecycle Correctness**
   * **Validates: Requirements 5.1**
   * 
   * When setting with custom TTL, it should override the default TTL.
   */
  await fc.assert(
    fc.asyncProperty(
      cacheKeyArb,
      pluginDetailArb,
      fc.integer({ min: 1000, max: 10000 }), // default TTL
      fc.integer({ min: 100, max: 500 }),    // custom TTL (shorter)
      async (key, detail, defaultTtl, customTtl) => {
        let currentTime = 1000000;
        const cache = new DetailCache({
          defaultTtlMs: defaultTtl,
          now: () => currentTime,
        });

        // Set with custom TTL
        cache.set(key, detail, customTtl);

        // Should exist within custom TTL
        currentTime += customTtl - 1;
        assert.ok(cache.get(key) !== null, 'Should exist within custom TTL');

        // Should expire after custom TTL (not default)
        currentTime += 2;
        assert.equal(cache.get(key), null, 'Should expire after custom TTL');
      }
    ),
    { numRuns: 100 }
  );
});

test('Property 4: Cache Lifecycle Correctness - empty/invalid keys are handled', async () => {
  /**
   * Edge case: empty or whitespace-only keys should be handled gracefully.
   */
  const cache = new DetailCache();
  const detail = { id: 'test', name: 'Test' };

  // Empty key
  cache.set('', detail);
  assert.equal(cache.get(''), null, 'Empty key should return null');

  // Whitespace key
  cache.set('   ', detail);
  assert.equal(cache.get('   '), null, 'Whitespace key should return null');

  // Null/undefined
  cache.set(null, detail);
  assert.equal(cache.get(null), null, 'Null key should return null');

  cache.set(undefined, detail);
  assert.equal(cache.get(undefined), null, 'Undefined key should return null');
});

test('DetailCache uses default TTL of 10 minutes', () => {
  /**
   * Verify the default TTL constant is 10 minutes as per requirements.
   */
  assert.equal(DEFAULT_TTL_MS, 10 * 60 * 1000, 'Default TTL should be 10 minutes');
});

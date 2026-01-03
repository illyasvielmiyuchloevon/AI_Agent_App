/**
 * Property-based tests for LanguagePluginManager.getDetail
 * 
 * **Feature: plugin-detail-api, Property 1: Detail Response Structure Completeness**
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const { LanguagePluginManager } = require('../LanguagePluginManager');
const { DetailCache } = require('../DetailCache');

// Arbitrary for generating valid plugin IDs (namespace.name format)
const pluginIdArb = fc.tuple(
  fc.string({ minLength: 1, maxLength: 30 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
  fc.string({ minLength: 1, maxLength: 30 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s))
).map(([ns, name]) => `${ns}.${name}`);

// Arbitrary for generating valid PluginDetail objects
const pluginDetailArb = fc.record({
  id: pluginIdArb,
  name: fc.string({ minLength: 1, maxLength: 100 }),
  version: fc.string({ minLength: 1, maxLength: 20 }),
  description: fc.string({ maxLength: 500 }),
  readme: fc.option(fc.string({ maxLength: 1000 }), { nil: null }),
  changelog: fc.option(fc.string({ maxLength: 1000 }), { nil: null }),
  categories: fc.array(fc.string({ minLength: 1, maxLength: 30 }), { maxLength: 10 }),
  capabilities: fc.array(fc.string({ minLength: 1, maxLength: 30 }), { maxLength: 20 }),
  dependencies: fc.array(fc.record({
    id: fc.string({ minLength: 1, maxLength: 50 }),
    version: fc.string({ minLength: 1, maxLength: 20 }),
    optional: fc.boolean(),
  }), { maxLength: 5 }),
  repository: fc.option(fc.webUrl(), { nil: null }),
  license: fc.option(fc.constantFrom('MIT', 'Apache-2.0', 'GPL-3.0', 'BSD-3-Clause'), { nil: null }),
  publisher: fc.record({
    name: fc.string({ minLength: 1, maxLength: 50 }),
    url: fc.option(fc.webUrl(), { nil: null }),
  }),
  statistics: fc.option(fc.record({
    downloads: fc.nat({ max: 1000000 }),
    rating: fc.option(fc.double({ min: 0, max: 5, noNaN: true }), { nil: null }),
    reviewCount: fc.nat({ max: 10000 }),
  }), { nil: null }),
  lastUpdated: fc.nat({ max: Date.now() + 1000000 }),
  source: fc.record({
    providerId: fc.constantFrom('openvsx', 'github', 'official'),
    namespace: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
    name: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
  }),
});

/**
 * Create a mock provider that returns the given detail
 */
function createMockProvider(providerId, detailToReturn) {
  return {
    id: providerId,
    search: async () => [],
    get: async () => null,
    getDetail: async (id, version) => detailToReturn,
  };
}

/**
 * Create a mock registry
 */
function createMockRegistry(plugins = []) {
  const pluginMap = new Map(plugins.map(p => [p.id, p]));
  return {
    load: async () => {},
    listPlugins: () => Array.from(pluginMap.values()),
    getPlugin: (id) => pluginMap.get(id) || null,
    upsertPlugin: async (p) => { pluginMap.set(p.id, p); return p; },
    removePlugin: async (id) => pluginMap.delete(id),
  };
}

test('Property 1: Detail Response Structure Completeness - successful response contains all required fields', async () => {
  /**
   * **Feature: plugin-detail-api, Property 1: Detail Response Structure Completeness**
   * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
   * 
   * For any valid plugin ID and provider, when requesting plugin details,
   * the response SHALL contain all required fields (id, name, version, description, source)
   * with correct types.
   */
  await fc.assert(
    fc.asyncProperty(pluginDetailArb, async (detail) => {
      const mockProvider = createMockProvider('openvsx', detail);
      const manager = new LanguagePluginManager({
        registry: createMockRegistry(),
        providers: [mockProvider],
        detailCache: new DetailCache(),
      });

      const result = await manager.getDetail({ id: detail.id, providerId: 'openvsx' });

      // Response should be successful
      assert.equal(result.ok, true, 'Response should be ok');
      assert.ok(result.detail, 'Response should contain detail');

      // Required fields must exist and have correct types
      assert.equal(typeof result.detail.id, 'string', 'id must be a string');
      assert.equal(typeof result.detail.name, 'string', 'name must be a string');
      assert.equal(typeof result.detail.version, 'string', 'version must be a string');
      assert.equal(typeof result.detail.description, 'string', 'description must be a string');

      // Source must be present with correct structure
      assert.ok(result.detail.source, 'source must be present');
      assert.equal(typeof result.detail.source.providerId, 'string', 'source.providerId must be a string');
    }),
    { numRuns: 100 }
  );
});

test('Property 1: Detail Response Structure Completeness - optional fields are null or valid values', async () => {
  /**
   * **Feature: plugin-detail-api, Property 1: Detail Response Structure Completeness**
   * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
   * 
   * For any valid plugin detail response, optional fields (readme, changelog, repository, license)
   * SHALL be either valid strings/arrays or null.
   */
  await fc.assert(
    fc.asyncProperty(pluginDetailArb, async (detail) => {
      const mockProvider = createMockProvider('openvsx', detail);
      const manager = new LanguagePluginManager({
        registry: createMockRegistry(),
        providers: [mockProvider],
        detailCache: new DetailCache(),
      });

      const result = await manager.getDetail({ id: detail.id, providerId: 'openvsx' });

      assert.equal(result.ok, true, 'Response should be ok');
      const d = result.detail;

      // Optional string fields must be string or null
      assert.ok(
        d.readme === null || typeof d.readme === 'string',
        'readme must be string or null'
      );
      assert.ok(
        d.changelog === null || typeof d.changelog === 'string',
        'changelog must be string or null'
      );
      assert.ok(
        d.repository === null || typeof d.repository === 'string',
        'repository must be string or null'
      );
      assert.ok(
        d.license === null || typeof d.license === 'string',
        'license must be string or null'
      );

      // Array fields must be arrays
      assert.ok(Array.isArray(d.categories), 'categories must be an array');
      assert.ok(Array.isArray(d.capabilities), 'capabilities must be an array');
      assert.ok(Array.isArray(d.dependencies), 'dependencies must be an array');
    }),
    { numRuns: 100 }
  );
});

test('Property 1: Detail Response Structure Completeness - cached response matches original', async () => {
  /**
   * **Feature: plugin-detail-api, Property 1: Detail Response Structure Completeness**
   * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
   * 
   * For any successfully fetched plugin detail, subsequent requests should return
   * the same detail structure from cache.
   */
  await fc.assert(
    fc.asyncProperty(pluginDetailArb, async (detail) => {
      const mockProvider = createMockProvider('openvsx', detail);
      const manager = new LanguagePluginManager({
        registry: createMockRegistry(),
        providers: [mockProvider],
        detailCache: new DetailCache(),
      });

      // First request - should not be cached
      const result1 = await manager.getDetail({ id: detail.id, providerId: 'openvsx' });
      assert.equal(result1.ok, true);
      assert.equal(result1.cached, false, 'First request should not be cached');

      // Second request - should be cached
      const result2 = await manager.getDetail({ id: detail.id, providerId: 'openvsx' });
      assert.equal(result2.ok, true);
      assert.equal(result2.cached, true, 'Second request should be cached');

      // Both should have the same detail
      assert.deepEqual(result1.detail, result2.detail, 'Cached detail should match original');
    }),
    { numRuns: 100 }
  );
});

test('Property 1: Detail Response Structure Completeness - forceRefresh bypasses cache', async () => {
  /**
   * **Feature: plugin-detail-api, Property 1: Detail Response Structure Completeness**
   * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
   * 
   * When forceRefresh is true, the cache should be bypassed and fresh data fetched.
   */
  await fc.assert(
    fc.asyncProperty(pluginDetailArb, async (detail) => {
      let callCount = 0;
      const mockProvider = {
        id: 'openvsx',
        search: async () => [],
        get: async () => null,
        getDetail: async () => {
          callCount++;
          return detail;
        },
      };

      const manager = new LanguagePluginManager({
        registry: createMockRegistry(),
        providers: [mockProvider],
        detailCache: new DetailCache(),
      });

      // First request
      await manager.getDetail({ id: detail.id, providerId: 'openvsx' });
      assert.equal(callCount, 1, 'Provider should be called once');

      // Second request without forceRefresh - should use cache
      await manager.getDetail({ id: detail.id, providerId: 'openvsx' });
      assert.equal(callCount, 1, 'Provider should not be called again (cached)');

      // Third request with forceRefresh - should bypass cache
      const result = await manager.getDetail({ id: detail.id, providerId: 'openvsx', forceRefresh: true });
      assert.equal(callCount, 2, 'Provider should be called again (forceRefresh)');
      assert.equal(result.cached, false, 'Result should not be marked as cached');
    }),
    { numRuns: 100 }
  );
});

test('Property 1: Detail Response Structure Completeness - empty id returns error', async () => {
  /**
   * Edge case: empty or invalid plugin ID should return an error response.
   */
  const manager = new LanguagePluginManager({
    registry: createMockRegistry(),
    providers: [],
    detailCache: new DetailCache(),
  });

  // Empty id
  let result = await manager.getDetail({ id: '' });
  assert.equal(result.ok, false, 'Empty id should fail');
  assert.ok(result.error, 'Should have error message');

  // Null id
  result = await manager.getDetail({ id: null });
  assert.equal(result.ok, false, 'Null id should fail');

  // Undefined id
  result = await manager.getDetail({});
  assert.equal(result.ok, false, 'Undefined id should fail');
});

test('Property 1: Detail Response Structure Completeness - unknown provider returns error', async () => {
  /**
   * Edge case: unknown provider should return an error response.
   */
  const manager = new LanguagePluginManager({
    registry: createMockRegistry(),
    providers: [],
    detailCache: new DetailCache(),
  });

  const result = await manager.getDetail({ id: 'test.plugin', providerId: 'unknown' });
  assert.equal(result.ok, false, 'Unknown provider should fail');
  assert.ok(result.error?.includes('unknown provider'), 'Error should mention unknown provider');
});

test('Property 1: Detail Response Structure Completeness - provider without getDetail returns error', async () => {
  /**
   * Edge case: provider without getDetail method should return an error.
   */
  const mockProvider = {
    id: 'limited',
    search: async () => [],
    get: async () => null,
    // No getDetail method
  };

  const manager = new LanguagePluginManager({
    registry: createMockRegistry(),
    providers: [mockProvider],
    detailCache: new DetailCache(),
  });

  const result = await manager.getDetail({ id: 'test.plugin', providerId: 'limited' });
  assert.equal(result.ok, false, 'Provider without getDetail should fail');
  assert.ok(result.error?.includes('does not support getDetail'), 'Error should mention missing getDetail');
});

test('Property 1: Detail Response Structure Completeness - plugin not found returns error', async () => {
  /**
   * Edge case: when provider returns null, should return plugin not found error.
   */
  const mockProvider = createMockProvider('openvsx', null);

  const manager = new LanguagePluginManager({
    registry: createMockRegistry(),
    providers: [mockProvider],
    detailCache: new DetailCache(),
  });

  const result = await manager.getDetail({ id: 'nonexistent.plugin', providerId: 'openvsx' });
  assert.equal(result.ok, false, 'Non-existent plugin should fail');
  assert.ok(result.error?.includes('not found'), 'Error should mention not found');
});

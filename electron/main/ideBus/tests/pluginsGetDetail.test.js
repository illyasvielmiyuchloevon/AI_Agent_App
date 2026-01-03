/**
 * Property-based tests for plugins/getDetail IPC handler
 * 
 * **Feature: plugin-detail-api, Property 5: IPC Request-Response Integrity**
 * **Validates: Requirements 3.1, 3.2**
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

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
 * Create a mock plugins manager for testing
 */
function createMockPluginsManager(getDetailResult) {
  return {
    manager: {
      getDetail: async (params) => getDetailResult(params),
      listInstalled: () => [],
      listEnabledLanguages: () => [],
    },
    ready: Promise.resolve(),
    notify: () => {},
  };
}

/**
 * Simulate the IPC handler logic for plugins/getDetail
 * This mirrors the implementation in registerIdeBus.js
 */
async function simulateGetDetailHandler(plugins, payload) {
  if (!plugins?.manager?.getDetail) return { ok: false, error: 'plugins service unavailable' };
  
  // Simulate ensurePluginsReady
  try {
    await plugins?.ready;
  } catch {
    // ignore
  }

  const id = payload?.id != null ? String(payload.id) : '';
  const providerId = payload?.providerId != null ? String(payload.providerId) : undefined;
  const version = payload?.version != null ? String(payload.version) : undefined;
  const forceRefresh = !!payload?.forceRefresh;

  if (!id) return { ok: false, error: 'plugin id is required' };

  // Implement 30 second timeout (Requirement 3.3)
  const timeoutMs = 30000;
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('request timeout')), timeoutMs);
  });

  try {
    const result = await Promise.race([
      plugins.manager.getDetail({ id, providerId, version, forceRefresh }),
      timeoutPromise,
    ]);
    return result;
  } catch (err) {
    const message = err?.message || String(err);
    return { ok: false, error: message };
  }
}

test('Property 5: IPC Request-Response Integrity - response contains same plugin ID as requested', async () => {
  /**
   * **Feature: plugin-detail-api, Property 5: IPC Request-Response Integrity**
   * **Validates: Requirements 3.1, 3.2**
   * 
   * For any plugins/getDetail request through IDE Bus (IPC), the response SHALL contain
   * the same plugin ID as requested.
   */
  await fc.assert(
    fc.asyncProperty(pluginDetailArb, async (detail) => {
      const plugins = createMockPluginsManager((params) => ({
        ok: true,
        detail: { ...detail, id: params.id },
        cached: false,
      }));

      const result = await simulateGetDetailHandler(plugins, { id: detail.id });

      assert.equal(result.ok, true, 'Response should be ok');
      assert.ok(result.detail, 'Response should contain detail');
      assert.equal(result.detail.id, detail.id, 'Response detail ID should match requested ID');
    }),
    { numRuns: 100 }
  );
});

test('Property 5: IPC Request-Response Integrity - detail object matches PluginDetail schema', async () => {
  /**
   * **Feature: plugin-detail-api, Property 5: IPC Request-Response Integrity**
   * **Validates: Requirements 3.1, 3.2**
   * 
   * For any plugins/getDetail request, the detail object (if present) SHALL match
   * the PluginDetail schema.
   */
  await fc.assert(
    fc.asyncProperty(pluginDetailArb, async (detail) => {
      const plugins = createMockPluginsManager(() => ({
        ok: true,
        detail,
        cached: false,
      }));

      const result = await simulateGetDetailHandler(plugins, { id: detail.id });

      assert.equal(result.ok, true, 'Response should be ok');
      const d = result.detail;

      // Verify required fields
      assert.equal(typeof d.id, 'string', 'id must be a string');
      assert.equal(typeof d.name, 'string', 'name must be a string');
      assert.equal(typeof d.version, 'string', 'version must be a string');
      assert.equal(typeof d.description, 'string', 'description must be a string');

      // Verify source structure
      assert.ok(d.source, 'source must be present');
      assert.equal(typeof d.source.providerId, 'string', 'source.providerId must be a string');

      // Verify optional fields are correct types
      assert.ok(d.readme === null || typeof d.readme === 'string', 'readme must be string or null');
      assert.ok(d.changelog === null || typeof d.changelog === 'string', 'changelog must be string or null');
      assert.ok(Array.isArray(d.categories), 'categories must be an array');
      assert.ok(Array.isArray(d.capabilities), 'capabilities must be an array');
      assert.ok(Array.isArray(d.dependencies), 'dependencies must be an array');
    }),
    { numRuns: 100 }
  );
});

test('Property 5: IPC Request-Response Integrity - providerId is passed through correctly', async () => {
  /**
   * **Feature: plugin-detail-api, Property 5: IPC Request-Response Integrity**
   * **Validates: Requirements 3.1, 3.2**
   * 
   * For any plugins/getDetail request with a providerId, the providerId should be
   * passed through to the manager correctly.
   */
  const providerIdArb = fc.constantFrom('openvsx', 'github', 'official');

  await fc.assert(
    fc.asyncProperty(pluginIdArb, providerIdArb, async (pluginId, providerId) => {
      let receivedParams = null;
      const plugins = createMockPluginsManager((params) => {
        receivedParams = params;
        return {
          ok: true,
          detail: {
            id: params.id,
            name: 'Test Plugin',
            version: '1.0.0',
            description: 'Test',
            readme: null,
            changelog: null,
            categories: [],
            capabilities: [],
            dependencies: [],
            repository: null,
            license: null,
            publisher: { name: 'Test', url: null },
            statistics: null,
            lastUpdated: Date.now(),
            source: { providerId: params.providerId || 'openvsx' },
          },
          cached: false,
        };
      });

      await simulateGetDetailHandler(plugins, { id: pluginId, providerId });

      assert.ok(receivedParams, 'Manager should receive params');
      assert.equal(receivedParams.id, pluginId, 'Plugin ID should be passed through');
      assert.equal(receivedParams.providerId, providerId, 'Provider ID should be passed through');
    }),
    { numRuns: 100 }
  );
});

test('Property 5: IPC Request-Response Integrity - forceRefresh is passed through correctly', async () => {
  /**
   * **Feature: plugin-detail-api, Property 5: IPC Request-Response Integrity**
   * **Validates: Requirements 3.1, 3.2**
   * 
   * For any plugins/getDetail request with forceRefresh, the flag should be
   * passed through to the manager correctly.
   */
  await fc.assert(
    fc.asyncProperty(pluginIdArb, fc.boolean(), async (pluginId, forceRefresh) => {
      let receivedParams = null;
      const plugins = createMockPluginsManager((params) => {
        receivedParams = params;
        return {
          ok: true,
          detail: {
            id: params.id,
            name: 'Test Plugin',
            version: '1.0.0',
            description: 'Test',
            readme: null,
            changelog: null,
            categories: [],
            capabilities: [],
            dependencies: [],
            repository: null,
            license: null,
            publisher: { name: 'Test', url: null },
            statistics: null,
            lastUpdated: Date.now(),
            source: { providerId: 'openvsx' },
          },
          cached: false,
        };
      });

      await simulateGetDetailHandler(plugins, { id: pluginId, forceRefresh });

      assert.ok(receivedParams, 'Manager should receive params');
      assert.equal(receivedParams.forceRefresh, forceRefresh, 'forceRefresh should be passed through');
    }),
    { numRuns: 100 }
  );
});

test('Property 5: IPC Request-Response Integrity - cached flag is preserved in response', async () => {
  /**
   * **Feature: plugin-detail-api, Property 5: IPC Request-Response Integrity**
   * **Validates: Requirements 3.1, 3.2**
   * 
   * For any plugins/getDetail response, the cached flag should be preserved.
   */
  await fc.assert(
    fc.asyncProperty(pluginIdArb, fc.boolean(), async (pluginId, cached) => {
      const plugins = createMockPluginsManager(() => ({
        ok: true,
        detail: {
          id: pluginId,
          name: 'Test Plugin',
          version: '1.0.0',
          description: 'Test',
          readme: null,
          changelog: null,
          categories: [],
          capabilities: [],
          dependencies: [],
          repository: null,
          license: null,
          publisher: { name: 'Test', url: null },
          statistics: null,
          lastUpdated: Date.now(),
          source: { providerId: 'openvsx' },
        },
        cached,
      }));

      const result = await simulateGetDetailHandler(plugins, { id: pluginId });

      assert.equal(result.ok, true, 'Response should be ok');
      assert.equal(result.cached, cached, 'Cached flag should be preserved');
    }),
    { numRuns: 100 }
  );
});

test('Property 5: IPC Request-Response Integrity - plugins service unavailable returns error', async () => {
  /**
   * Edge case: when plugins service is unavailable, should return error.
   */
  const result = await simulateGetDetailHandler(null, { id: 'test.plugin' });
  assert.equal(result.ok, false, 'Should fail when plugins unavailable');
  assert.ok(result.error?.includes('unavailable'), 'Error should mention unavailable');

  const result2 = await simulateGetDetailHandler({}, { id: 'test.plugin' });
  assert.equal(result2.ok, false, 'Should fail when manager unavailable');

  const result3 = await simulateGetDetailHandler({ manager: {} }, { id: 'test.plugin' });
  assert.equal(result3.ok, false, 'Should fail when getDetail unavailable');
});

test('Property 5: IPC Request-Response Integrity - empty id returns error', async () => {
  /**
   * Edge case: empty plugin ID should return error.
   */
  const plugins = createMockPluginsManager(() => ({ ok: true, detail: {}, cached: false }));

  const result = await simulateGetDetailHandler(plugins, { id: '' });
  assert.equal(result.ok, false, 'Empty id should fail');
  assert.ok(result.error?.includes('required'), 'Error should mention required');

  const result2 = await simulateGetDetailHandler(plugins, {});
  assert.equal(result2.ok, false, 'Missing id should fail');
});

test('Property 5: IPC Request-Response Integrity - manager error is propagated', async () => {
  /**
   * Edge case: when manager throws an error, it should be propagated.
   */
  const plugins = createMockPluginsManager(() => {
    throw new Error('test error from manager');
  });

  const result = await simulateGetDetailHandler(plugins, { id: 'test.plugin' });
  assert.equal(result.ok, false, 'Should fail when manager throws');
  assert.ok(result.error?.includes('test error'), 'Error message should be propagated');
});

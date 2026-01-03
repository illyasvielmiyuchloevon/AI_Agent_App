/**
 * Property-based tests for OpenVsxProvider
 * 
 * **Feature: plugin-detail-api, Property 2: Provider Response Normalization**
 * **Validates: Requirements 2.1, 2.2, 2.4**
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const { OpenVsxProvider, normalizeOpenVsxDetail } = require('../providers/OpenVsxProvider');

// Arbitrary for generating valid ISO date strings
const isoDateArb = fc.date({ min: new Date('2000-01-01'), max: new Date('2030-12-31') })
  .filter(d => !isNaN(d.getTime()))
  .map(d => d.toISOString());

// Arbitrary for generating OpenVSX-like API responses
const openVsxResponseArb = fc.record({
  namespace: fc.string({ minLength: 1, maxLength: 50 }),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  displayName: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
  description: fc.option(fc.string({ maxLength: 500 }), { nil: undefined }),
  version: fc.string({ minLength: 1, maxLength: 20 }),
  readme: fc.option(fc.string({ maxLength: 2000 }), { nil: undefined }),
  changelog: fc.option(fc.string({ maxLength: 2000 }), { nil: undefined }),
  categories: fc.option(fc.array(fc.string({ minLength: 1, maxLength: 30 }), { maxLength: 10 }), { nil: undefined }),
  tags: fc.option(fc.array(fc.string({ minLength: 1, maxLength: 30 }), { maxLength: 20 }), { nil: undefined }),
  repository: fc.option(fc.webUrl(), { nil: undefined }),
  license: fc.option(fc.constantFrom('MIT', 'Apache-2.0', 'GPL-3.0', 'BSD-3-Clause'), { nil: undefined }),
  downloadCount: fc.option(fc.nat({ max: 1000000 }), { nil: undefined }),
  averageRating: fc.option(fc.double({ min: 0, max: 5, noNaN: true }), { nil: undefined }),
  reviewCount: fc.option(fc.nat({ max: 10000 }), { nil: undefined }),
  timestamp: fc.option(isoDateArb, { nil: undefined }),
  publishedBy: fc.option(fc.record({
    loginName: fc.string({ minLength: 1, maxLength: 50 }),
    homepage: fc.option(fc.webUrl(), { nil: undefined }),
  }), { nil: undefined }),
});

// Arbitrary for namespace and name (non-empty strings)
const namespaceArb = fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0);
const nameArb = fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0);

test('Property 2: Provider Response Normalization - produces valid PluginDetail with all required fields', async () => {
  /**
   * **Feature: plugin-detail-api, Property 2: Provider Response Normalization**
   * **Validates: Requirements 2.1, 2.4**
   * 
   * For any raw OpenVSX API response, the normalization function SHALL produce
   * a valid PluginDetail object with all required fields populated.
   */
  await fc.assert(
    fc.asyncProperty(openVsxResponseArb, namespaceArb, nameArb, async (json, ns, name) => {
      const result = normalizeOpenVsxDetail(json, ns, name);

      // Required fields must exist and have correct types
      assert.equal(typeof result.id, 'string', 'id must be a string');
      assert.equal(typeof result.name, 'string', 'name must be a string');
      assert.equal(typeof result.version, 'string', 'version must be a string');
      assert.equal(typeof result.description, 'string', 'description must be a string');

      // Source must be present with correct structure
      assert.ok(result.source, 'source must be present');
      assert.equal(result.source.providerId, 'openvsx', 'source.providerId must be openvsx');
      assert.equal(typeof result.source.namespace, 'string', 'source.namespace must be a string');
      assert.equal(typeof result.source.name, 'string', 'source.name must be a string');

      // Publisher must be present with correct structure
      assert.ok(result.publisher, 'publisher must be present');
      assert.equal(typeof result.publisher.name, 'string', 'publisher.name must be a string');

      // Statistics must be present with correct structure
      assert.ok(result.statistics, 'statistics must be present');
      assert.equal(typeof result.statistics.downloads, 'number', 'statistics.downloads must be a number');
      assert.equal(typeof result.statistics.reviewCount, 'number', 'statistics.reviewCount must be a number');

      // lastUpdated must be a number (timestamp)
      assert.equal(typeof result.lastUpdated, 'number', 'lastUpdated must be a number');
    }),
    { numRuns: 100 }
  );
});

test('Property 2: Provider Response Normalization - optional fields are null or valid values', async () => {
  /**
   * **Feature: plugin-detail-api, Property 2: Provider Response Normalization**
   * **Validates: Requirements 2.4**
   * 
   * For any raw OpenVSX API response, optional fields (readme, changelog, repository, license)
   * SHALL be either valid strings or null, never undefined.
   */
  await fc.assert(
    fc.asyncProperty(openVsxResponseArb, namespaceArb, nameArb, async (json, ns, name) => {
      const result = normalizeOpenVsxDetail(json, ns, name);

      // Optional string fields must be string or null
      assert.ok(
        result.readme === null || typeof result.readme === 'string',
        'readme must be string or null'
      );
      assert.ok(
        result.changelog === null || typeof result.changelog === 'string',
        'changelog must be string or null'
      );
      assert.ok(
        result.repository === null || typeof result.repository === 'string',
        'repository must be string or null'
      );
      assert.ok(
        result.license === null || typeof result.license === 'string',
        'license must be string or null'
      );
      assert.ok(
        result.publisher.url === null || typeof result.publisher.url === 'string',
        'publisher.url must be string or null'
      );
      assert.ok(
        result.statistics.rating === null || typeof result.statistics.rating === 'number',
        'statistics.rating must be number or null'
      );
    }),
    { numRuns: 100 }
  );
});

test('Property 2: Provider Response Normalization - arrays are always arrays', async () => {
  /**
   * **Feature: plugin-detail-api, Property 2: Provider Response Normalization**
   * **Validates: Requirements 2.4**
   * 
   * For any raw OpenVSX API response, array fields (categories, capabilities, dependencies)
   * SHALL always be arrays, even if the source data is missing.
   */
  await fc.assert(
    fc.asyncProperty(openVsxResponseArb, namespaceArb, nameArb, async (json, ns, name) => {
      const result = normalizeOpenVsxDetail(json, ns, name);

      assert.ok(Array.isArray(result.categories), 'categories must be an array');
      assert.ok(Array.isArray(result.capabilities), 'capabilities must be an array');
      assert.ok(Array.isArray(result.dependencies), 'dependencies must be an array');

      // All array elements must be strings
      result.categories.forEach((cat, i) => {
        assert.equal(typeof cat, 'string', `categories[${i}] must be a string`);
      });
      result.capabilities.forEach((cap, i) => {
        assert.equal(typeof cap, 'string', `capabilities[${i}] must be a string`);
      });
    }),
    { numRuns: 100 }
  );
});

test('Property 2: Provider Response Normalization - does not throw for missing optional fields', async () => {
  /**
   * **Feature: plugin-detail-api, Property 2: Provider Response Normalization**
   * **Validates: Requirements 2.4**
   * 
   * For any raw OpenVSX API response with missing optional fields,
   * the normalization function SHALL not throw exceptions.
   */
  await fc.assert(
    fc.asyncProperty(
      // Generate minimal responses with only required fields
      fc.record({
        version: fc.string({ minLength: 1, maxLength: 20 }),
      }),
      namespaceArb,
      nameArb,
      async (json, ns, name) => {
        // Should not throw
        let result;
        try {
          result = normalizeOpenVsxDetail(json, ns, name);
        } catch (err) {
          assert.fail(`normalizeOpenVsxDetail threw an exception: ${err.message}`);
        }

        // Result should still be valid
        assert.ok(result, 'result should not be null');
        assert.equal(typeof result.id, 'string', 'id must be a string');
        assert.equal(typeof result.version, 'string', 'version must be a string');
      }
    ),
    { numRuns: 100 }
  );
});

test('Property 2: Provider Response Normalization - id is correctly formed from namespace and name', async () => {
  /**
   * **Feature: plugin-detail-api, Property 2: Provider Response Normalization**
   * **Validates: Requirements 2.1**
   * 
   * For any namespace and name, the resulting id SHALL be "namespace.name".
   */
  await fc.assert(
    fc.asyncProperty(openVsxResponseArb, namespaceArb, nameArb, async (json, ns, name) => {
      const result = normalizeOpenVsxDetail(json, ns, name);

      assert.equal(result.id, `${ns}.${name}`, 'id should be namespace.name');
      assert.equal(result.source.namespace, ns, 'source.namespace should match input');
      assert.equal(result.source.name, name, 'source.name should match input');
    }),
    { numRuns: 100 }
  );
});

test('Property 2: Provider Response Normalization - handles null/undefined json gracefully', () => {
  /**
   * Edge case: null or undefined json should not throw.
   */
  const ns = 'test';
  const name = 'extension';

  // null json
  let result = normalizeOpenVsxDetail(null, ns, name);
  assert.ok(result, 'should handle null json');
  assert.equal(result.id, 'test.extension');
  assert.equal(result.version, '');

  // undefined json
  result = normalizeOpenVsxDetail(undefined, ns, name);
  assert.ok(result, 'should handle undefined json');
  assert.equal(result.id, 'test.extension');
  assert.equal(result.version, '');

  // empty object
  result = normalizeOpenVsxDetail({}, ns, name);
  assert.ok(result, 'should handle empty object');
  assert.equal(result.id, 'test.extension');
  assert.equal(result.version, '');
});

test('Property 2: Provider Response Normalization - preserves readme and changelog content', async () => {
  /**
   * **Feature: plugin-detail-api, Property 2: Provider Response Normalization**
   * **Validates: Requirements 2.1**
   * 
   * When readme and changelog are present in the response,
   * they should be preserved in the normalized output.
   */
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        version: fc.string({ minLength: 1, maxLength: 20 }),
        readme: fc.string({ minLength: 1, maxLength: 1000 }),
        changelog: fc.string({ minLength: 1, maxLength: 1000 }),
      }),
      namespaceArb,
      nameArb,
      async (json, ns, name) => {
        const result = normalizeOpenVsxDetail(json, ns, name);

        assert.equal(result.readme, json.readme, 'readme should be preserved');
        assert.equal(result.changelog, json.changelog, 'changelog should be preserved');
      }
    ),
    { numRuns: 100 }
  );
});

test('OpenVsxProvider.getDetail fetches readme and changelog files when available', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url === 'https://open-vsx.org/api/ns/name') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          namespace: 'ns',
          name: 'name',
          displayName: 'Name',
          description: 'Desc',
          version: '1.2.3',
          timestamp: new Date('2024-01-01T00:00:00.000Z').toISOString(),
          tags: ['tag-a'],
          categories: ['cat-a'],
          downloadCount: 1,
          reviewCount: 0,
          averageRating: 4.5,
          publishedBy: { loginName: 'pub', homepage: 'https://example.com' },
          files: {
            readme: 'https://files/readme.md',
            changelog: 'https://files/changelog.md',
          },
        }),
      };
    }
    if (url === 'https://files/readme.md') {
      return { ok: true, status: 200, text: async () => '# README' };
    }
    if (url === 'https://files/changelog.md') {
      return { ok: true, status: 200, text: async () => '## Changelog' };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };

  try {
    const provider = new OpenVsxProvider();
    const detail = await provider.getDetail('ns.name');
    assert.ok(detail, 'detail should not be null');
    assert.equal(detail.id, 'ns.name');
    assert.equal(detail.readme, '# README');
    assert.equal(detail.changelog, '## Changelog');
    assert.ok(calls.includes('https://files/readme.md'));
    assert.ok(calls.includes('https://files/changelog.md'));
  } finally {
    global.fetch = originalFetch;
  }
});

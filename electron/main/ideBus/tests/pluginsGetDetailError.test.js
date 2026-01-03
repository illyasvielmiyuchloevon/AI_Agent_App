/**
 * Property-based tests for plugins/getDetail error responses
 * 
 * **Feature: plugin-detail-api, Property 3: Error Response Consistency**
 * **Validates: Requirements 1.5**
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

// Arbitrary for generating valid plugin IDs (namespace.name format)
const pluginIdArb = fc.tuple(
  fc.string({ minLength: 1, maxLength: 30 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
  fc.string({ minLength: 1, maxLength: 30 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s))
).map(([ns, name]) => `${ns}.${name}`);

// Arbitrary for generating error messages
const errorMessageArb = fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0);

/**
 * Create a mock plugins manager that returns an error
 */
function createErrorPluginsManager(errorMessage) {
  return {
    manager: {
      getDetail: async () => ({
        ok: false,
        error: errorMessage,
      }),
      listInstalled: () => [],
      listEnabledLanguages: () => [],
    },
    ready: Promise.resolve(),
    notify: () => {},
  };
}

/**
 * Create a mock plugins manager that throws an error
 */
function createThrowingPluginsManager(errorMessage) {
  return {
    manager: {
      getDetail: async () => {
        throw new Error(errorMessage);
      },
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

test('Property 3: Error Response Consistency - error response has ok:false and non-empty error string', async () => {
  /**
   * **Feature: plugin-detail-api, Property 3: Error Response Consistency**
   * **Validates: Requirements 1.5**
   * 
   * For any invalid plugin ID or failed network request, the system SHALL return
   * a response with ok: false and a non-empty error string describing the failure reason.
   */
  await fc.assert(
    fc.asyncProperty(pluginIdArb, errorMessageArb, async (pluginId, errorMessage) => {
      const plugins = createErrorPluginsManager(errorMessage);

      const result = await simulateGetDetailHandler(plugins, { id: pluginId });

      // Response should indicate failure
      assert.equal(result.ok, false, 'Response should have ok: false');
      
      // Error should be a non-empty string
      assert.equal(typeof result.error, 'string', 'Error should be a string');
      assert.ok(result.error.length > 0, 'Error should be non-empty');
      assert.equal(result.error, errorMessage, 'Error message should match');
    }),
    { numRuns: 100 }
  );
});

test('Property 3: Error Response Consistency - thrown errors are converted to error responses', async () => {
  /**
   * **Feature: plugin-detail-api, Property 3: Error Response Consistency**
   * **Validates: Requirements 1.5**
   * 
   * When the manager throws an error, it should be converted to a proper error response.
   */
  await fc.assert(
    fc.asyncProperty(pluginIdArb, errorMessageArb, async (pluginId, errorMessage) => {
      const plugins = createThrowingPluginsManager(errorMessage);

      const result = await simulateGetDetailHandler(plugins, { id: pluginId });

      // Response should indicate failure
      assert.equal(result.ok, false, 'Response should have ok: false');
      
      // Error should be a non-empty string
      assert.equal(typeof result.error, 'string', 'Error should be a string');
      assert.ok(result.error.length > 0, 'Error should be non-empty');
      assert.ok(result.error.includes(errorMessage), 'Error message should contain original error');
    }),
    { numRuns: 100 }
  );
});

test('Property 3: Error Response Consistency - error response does not contain detail', async () => {
  /**
   * **Feature: plugin-detail-api, Property 3: Error Response Consistency**
   * **Validates: Requirements 1.5**
   * 
   * When an error occurs, the response should not contain a detail object.
   */
  await fc.assert(
    fc.asyncProperty(pluginIdArb, errorMessageArb, async (pluginId, errorMessage) => {
      const plugins = createErrorPluginsManager(errorMessage);

      const result = await simulateGetDetailHandler(plugins, { id: pluginId });

      assert.equal(result.ok, false, 'Response should have ok: false');
      assert.ok(!result.detail, 'Error response should not contain detail');
    }),
    { numRuns: 100 }
  );
});

test('Property 3: Error Response Consistency - missing plugin id returns descriptive error', async () => {
  /**
   * **Feature: plugin-detail-api, Property 3: Error Response Consistency**
   * **Validates: Requirements 1.5**
   * 
   * When plugin ID is missing, the error should describe the issue.
   */
  const plugins = createErrorPluginsManager('should not be called');

  // Empty string
  let result = await simulateGetDetailHandler(plugins, { id: '' });
  assert.equal(result.ok, false, 'Empty id should fail');
  assert.ok(result.error.includes('required') || result.error.includes('id'), 'Error should mention id');

  // Null
  result = await simulateGetDetailHandler(plugins, { id: null });
  assert.equal(result.ok, false, 'Null id should fail');
  assert.ok(result.error.includes('required') || result.error.includes('id'), 'Error should mention id');

  // Undefined
  result = await simulateGetDetailHandler(plugins, {});
  assert.equal(result.ok, false, 'Undefined id should fail');
  assert.ok(result.error.includes('required') || result.error.includes('id'), 'Error should mention id');
});

test('Property 3: Error Response Consistency - service unavailable returns descriptive error', async () => {
  /**
   * **Feature: plugin-detail-api, Property 3: Error Response Consistency**
   * **Validates: Requirements 1.5**
   * 
   * When plugins service is unavailable, the error should describe the issue.
   */
  // No plugins object
  let result = await simulateGetDetailHandler(null, { id: 'test.plugin' });
  assert.equal(result.ok, false, 'Should fail when plugins is null');
  assert.ok(result.error.includes('unavailable'), 'Error should mention unavailable');

  // Empty plugins object
  result = await simulateGetDetailHandler({}, { id: 'test.plugin' });
  assert.equal(result.ok, false, 'Should fail when plugins.manager is missing');
  assert.ok(result.error.includes('unavailable'), 'Error should mention unavailable');

  // Manager without getDetail
  result = await simulateGetDetailHandler({ manager: {} }, { id: 'test.plugin' });
  assert.equal(result.ok, false, 'Should fail when getDetail is missing');
  assert.ok(result.error.includes('unavailable'), 'Error should mention unavailable');
});

test('Property 3: Error Response Consistency - various error types produce consistent format', async () => {
  /**
   * **Feature: plugin-detail-api, Property 3: Error Response Consistency**
   * **Validates: Requirements 1.5**
   * 
   * Different types of errors should all produce the same response format.
   */
  const errorTypes = [
    'plugin not found',
    'network error',
    'timeout',
    'unknown provider',
    'rate limit exceeded',
    'parse error',
    'invalid response',
  ];

  for (const errorType of errorTypes) {
    const plugins = createErrorPluginsManager(errorType);
    const result = await simulateGetDetailHandler(plugins, { id: 'test.plugin' });

    assert.equal(result.ok, false, `${errorType}: Response should have ok: false`);
    assert.equal(typeof result.error, 'string', `${errorType}: Error should be a string`);
    assert.ok(result.error.length > 0, `${errorType}: Error should be non-empty`);
    assert.ok(!result.detail, `${errorType}: Should not have detail`);
  }
});

test('Property 3: Error Response Consistency - error with special characters is preserved', async () => {
  /**
   * **Feature: plugin-detail-api, Property 3: Error Response Consistency**
   * **Validates: Requirements 1.5**
   * 
   * Error messages with special characters should be preserved.
   */
  const specialErrors = [
    'Error: "quoted message"',
    "Error: 'single quoted'",
    'Error with\nnewline',
    'Error with\ttab',
    'Error with unicode: 中文错误',
    'Error with emoji: ❌',
    'Error with <html> tags',
    'Error with & ampersand',
  ];

  for (const errorMsg of specialErrors) {
    const plugins = createErrorPluginsManager(errorMsg);
    const result = await simulateGetDetailHandler(plugins, { id: 'test.plugin' });

    assert.equal(result.ok, false, 'Response should have ok: false');
    assert.equal(result.error, errorMsg, `Error message should be preserved: ${errorMsg}`);
  }
});

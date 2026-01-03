const test = require('node:test');
const assert = require('node:assert/strict');

const { createApplyEditCoordinator } = require('../applyEditCoordinator');

test('applyEditCoordinator resolves only for matching sender', async () => {
  const c = createApplyEditCoordinator({ timeoutMs: 200 });
  const requestId = 'r1';

  const promise = c.request({
    requestId,
    webContentsId: 10,
    send: () => {},
  });

  assert.deepEqual(
    c.handleResponse({ senderWebContentsId: 11, requestId, result: { applied: true } }),
    { ok: false, error: 'wrong sender' },
  );
  assert.deepEqual(
    c.handleResponse({ senderWebContentsId: 10, requestId, result: { applied: true } }),
    { ok: true },
  );

  const res = await promise;
  assert.equal(res.applied, true);
});

test('applyEditCoordinator times out', async () => {
  const c = createApplyEditCoordinator({ timeoutMs: 30 });
  const res = await c.request({ requestId: 't1', webContentsId: 1, send: () => {} });
  assert.equal(res.applied, false);
  assert.ok(String(res.failureReason || '').includes('timed out'));
});


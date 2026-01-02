const test = require('node:test');
const assert = require('node:assert/strict');

const { createPromptCoordinator } = require('../promptCoordinator');

test('promptCoordinator validates sender and kind', async () => {
  const c = createPromptCoordinator({ timeoutMs: 200 });
  const p = c.request({ requestId: 'p1', webContentsId: 9, kind: 'inputBox', send: () => {} });

  assert.deepEqual(c.handleResponse({ senderWebContentsId: 9, requestId: 'p1', kind: 'quickPick', result: { canceled: true } }), { ok: false, error: 'wrong kind' });
  assert.deepEqual(c.handleResponse({ senderWebContentsId: 8, requestId: 'p1', kind: 'inputBox', result: { value: 'x' } }), { ok: false, error: 'wrong sender' });
  assert.deepEqual(c.handleResponse({ senderWebContentsId: 9, requestId: 'p1', kind: 'inputBox', result: { value: 'ok' } }), { ok: true });

  const res = await p;
  assert.equal(res.ok, true);
  assert.equal(res.result.value, 'ok');
});


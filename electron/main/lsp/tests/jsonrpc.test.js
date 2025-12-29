const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { JsonRpcConnection } = require('../jsonrpc/JsonRpcConnection');
const { CancellationTokenSource } = require('../jsonrpc/Cancellation');
const { TimeoutError } = require('../jsonrpc/PendingRequests');

function createTransportPair() {
  const a = new EventEmitter();
  const b = new EventEmitter();

  const make = (self, peer) => ({
    send: (msg) => queueMicrotask(() => peer.emit('message', msg)),
    onMessage: (fn) => self.on('message', fn),
    onClose: (fn) => self.on('close', fn),
    close: () => self.emit('close'),
  });

  return { a: make(a, b), b: make(b, a) };
}

test('JsonRpcConnection supports out-of-order responses', async () => {
  const { a, b } = createTransportPair();
  const client = new JsonRpcConnection(a);
  const server = new JsonRpcConnection(b);

  server.onRequest('slow', async () => {
    await new Promise((r) => setTimeout(r, 30));
    return 'slow';
  });
  server.onRequest('fast', async () => 'fast');

  const p1 = client.sendRequest('slow', null);
  const p2 = client.sendRequest('fast', null);

  assert.equal(await p2, 'fast');
  assert.equal(await p1, 'slow');

  client.dispose();
  server.dispose();
});

test('JsonRpcConnection timeout rejects and ignores late response', async () => {
  const { a, b } = createTransportPair();
  const client = new JsonRpcConnection(a);
  const server = new JsonRpcConnection(b);

  server.onRequest('hang', async () => {
    await new Promise((r) => setTimeout(r, 50));
    return 'late';
  });

  await assert.rejects(() => client.sendRequest('hang', null, { timeoutMs: 10 }), (e) => e instanceof TimeoutError);

  client.dispose();
  server.dispose();
});

test('JsonRpcConnection cancellation rejects', async () => {
  const { a, b } = createTransportPair();
  const client = new JsonRpcConnection(a);
  const server = new JsonRpcConnection(b);

  server.onRequest('wait', async () => {
    await new Promise((r) => setTimeout(r, 100));
    return 'done';
  });

  const cts = new CancellationTokenSource();
  const p = client.sendRequest('wait', null, { cancelToken: cts.token });
  cts.cancel();
  await assert.rejects(p, /cancel/i);

  client.dispose();
  server.dispose();
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { MessageReader } = require('../transport/MessageReader');

test('MessageReader parses split frames', async () => {
  const stream = new PassThrough();
  const reader = new MessageReader(stream);

  const seen = [];
  reader.on('message', (m) => seen.push(m));

  const msg = { jsonrpc: '2.0', method: 'x', params: { a: 1 } };
  const json = JSON.stringify(msg);
  const bytes = Buffer.from(json, 'utf8');
  const header = Buffer.from(`Content-Length: ${bytes.length}\r\n\r\n`, 'ascii');
  const frame = Buffer.concat([header, bytes]);

  stream.write(frame.slice(0, 10));
  stream.write(frame.slice(10));

  await new Promise((r) => setTimeout(r, 10));
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], msg);

  reader.close();
  stream.end();
});

test('MessageReader parses multiple frames in one chunk', async () => {
  const stream = new PassThrough();
  const reader = new MessageReader(stream);

  const seen = [];
  reader.on('message', (m) => seen.push(m));

  const makeFrame = (obj) => {
    const json = JSON.stringify(obj);
    const bytes = Buffer.from(json, 'utf8');
    const header = Buffer.from(`Content-Length: ${bytes.length}\r\n\r\n`, 'ascii');
    return Buffer.concat([header, bytes]);
  };

  const a = { jsonrpc: '2.0', method: 'a' };
  const b = { jsonrpc: '2.0', method: 'b', params: [1, 2, 3] };
  stream.write(Buffer.concat([makeFrame(a), makeFrame(b)]));

  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(seen, [a, b]);

  reader.close();
  stream.end();
});

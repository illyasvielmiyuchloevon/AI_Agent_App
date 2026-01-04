const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { downloadWithResume } = require('../PluginInstaller');

const makeHeaders = (contentLength) => ({
  get: (key) => {
    const k = String(key || '').toLowerCase();
    if (k === 'content-length') return String(contentLength || 0);
    return null;
  },
});

const makeWebStream = (chunks) => new ReadableStream({
  start(controller) {
    for (const c of Array.isArray(chunks) ? chunks : []) {
      controller.enqueue(c);
    }
    controller.close();
  },
});

test('downloadWithResume supports fetch() web ReadableStream body', async () => {
  const originalFetch = global.fetch;
  const bytes = Buffer.from('hello web stream', 'utf8');
  global.fetch = async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: makeHeaders(bytes.length),
    body: makeWebStream([Uint8Array.from(bytes)]),
  });

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-web-'));
  const dest = path.join(dir, 'file.bin');
  try {
    const res = await downloadWithResume('https://example.invalid/file', dest);
    assert.equal(res.filePath, dest);
    const out = await fs.readFile(dest);
    assert.deepEqual(out, bytes);
  } finally {
    global.fetch = originalFetch;
  }
});


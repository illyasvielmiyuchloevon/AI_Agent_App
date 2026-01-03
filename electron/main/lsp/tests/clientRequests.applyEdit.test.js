const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { LspManager } = require('../LspManager');
const { toFileUri } = require('../util/uri');

const waitFor = async (predicate, { timeoutMs = 2000, intervalMs = 20 } = {}) => {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (predicate()) return;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout');
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, intervalMs));
  }
};

test('server->client requests: workspace/applyEdit + showMessageRequest + workDoneProgress/create', async () => {
  const logs = [];
  let applyCalls = 0;
  let lastEdit = null;

  const manager = new LspManager({
    onLog: (p) => logs.push(String(p?.message || '')),
    applyWorkspaceEdit: async ({ edit }) => {
      applyCalls += 1;
      lastEdit = edit;
      return { applied: true };
    },
  });

  const rootFsPath = path.resolve(__dirname);
  const rootUri = toFileUri(rootFsPath);

  const serverConfig = {
    id: 'fake',
    languageId: 'typescript',
    transport: {
      kind: 'stdio',
      command: process.execPath,
      args: [path.join(__dirname, 'fakeLspServer.js')],
      env: { ...process.env, FAKE_LSP_CLIENT_REQUESTS: '1' },
    },
    fileExtensions: ['.ts'],
  };

  const { serverId } = await manager.ensureServer({
    workspaceId: 'w1',
    languageId: 'typescript',
    serverConfig,
    workspace: { workspaceId: 'w1', rootUri, folders: [{ name: 'w1', uri: rootUri }] },
  });

  const uri = `${rootUri.replace(/\/$/, '')}/test.ts`;
  await manager.openDocument(serverId, { uri, languageId: 'typescript', version: 1, text: 'TODO test' });

  await waitFor(() => applyCalls > 0, { timeoutMs: 2000 });
  assert.equal(applyCalls, 1);
  assert.ok(lastEdit && typeof lastEdit === 'object');
  assert.ok(lastEdit.changes && typeof lastEdit.changes === 'object');
  assert.ok(Array.isArray(lastEdit.changes[uri]));

  await waitFor(() => logs.some((m) => m.includes('applyEdit response:')), { timeoutMs: 2000 });
  assert.ok(logs.some((m) => m.includes('"applied":true')));
  assert.ok(logs.some((m) => m.includes('showMessageRequest response:')));
  assert.ok(logs.some((m) => m.includes('workDoneProgress/create response:')));

  await manager.shutdownAll();
});

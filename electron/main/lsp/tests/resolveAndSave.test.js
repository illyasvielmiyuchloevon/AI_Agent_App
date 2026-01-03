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

test('didSave + completion resolve + codeAction resolve', async () => {
  const logs = [];
  const manager = new LspManager({
    onLog: (p) => logs.push(String(p?.message || '')),
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

  await manager.saveDocument(serverId, { uri, version: 1, text: 'TODO test' });
  await waitFor(() => logs.some((m) => m.includes('didSave')), { timeoutMs: 2000 });

  const completion = await manager.completion(serverId, { textDocument: { uri }, position: { line: 0, character: 1 } });
  const first = Array.isArray(completion?.items) ? completion.items[0] : (Array.isArray(completion) ? completion[0] : null);
  assert.ok(first);
  const resolvedItem = await manager.completionResolve(serverId, first, uri);
  assert.ok(resolvedItem?.documentation);

  const actions = await manager.codeAction(serverId, {
    textDocument: { uri },
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    context: { diagnostics: [] },
  });
  const action = Array.isArray(actions) ? actions[0] : null;
  assert.ok(action);
  const resolvedAction = await manager.codeActionResolve(serverId, action, uri);
  assert.ok(resolvedAction?.edit || resolvedAction?.command);

  await manager.shutdownAll();
});

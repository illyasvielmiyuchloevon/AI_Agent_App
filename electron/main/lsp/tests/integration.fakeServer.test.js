const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { LspManager } = require('../LspManager');
const { toFileUri } = require('../util/uri');

test('LspManager + fake server: didOpen triggers diagnostics', async () => {
  const received = [];
  const manager = new LspManager({
    onDiagnostics: (p) => received.push(p),
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

  await new Promise((r) => setTimeout(r, 50));
  assert.ok(received.some((d) => d.uri === uri));

  await manager.shutdownAll();
});

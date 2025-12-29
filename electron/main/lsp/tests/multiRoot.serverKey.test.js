const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { LspManager } = require('../LspManager');
const { toFileUri } = require('../util/uri');

test('multi-root: same server config yields different serverId per rootUri', async () => {
  const manager = new LspManager();

  const base = path.resolve(__dirname, '.tmp-multiRoot');
  const rootA = path.join(base, 'a');
  const rootB = path.join(base, 'b');
  await fs.mkdir(rootA, { recursive: true });
  await fs.mkdir(rootB, { recursive: true });

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

  const a = await manager.ensureServer({
    workspaceId: 'w1',
    languageId: 'typescript',
    serverConfig,
    workspace: { workspaceId: 'w1', rootUri: toFileUri(rootA), folders: [{ name: 'a', uri: toFileUri(rootA) }] },
  });
  const b = await manager.ensureServer({
    workspaceId: 'w1',
    languageId: 'typescript',
    serverConfig,
    workspace: { workspaceId: 'w1', rootUri: toFileUri(rootB), folders: [{ name: 'b', uri: toFileUri(rootB) }] },
  });

  assert.notEqual(a.serverId, b.serverId);

  await manager.shutdownAll();
});


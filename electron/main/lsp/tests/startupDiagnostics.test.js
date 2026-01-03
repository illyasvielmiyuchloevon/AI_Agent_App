const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { LspManager } = require('../LspManager');
const { toFileUri } = require('../util/uri');

test('initialize_failed includes stderrTail and hint', async () => {
  const statuses = [];
  const manager = new LspManager({
    onServerStatus: (p) => statuses.push(p),
  });

  const rootFsPath = path.resolve(__dirname);
  const rootUri = toFileUri(rootFsPath);

  const serverConfig = {
    id: 'hang-init',
    languageId: 'typescript',
    initializeTimeoutMs: 5000,
    transport: {
      kind: 'stdio',
      command: process.execPath,
      args: ['-e', "process.stderr.write('FAKE_STDERR\\n'); setTimeout(() => {}, 100000);"],
    },
    fileExtensions: ['.ts'],
  };

  await assert.rejects(async () => {
    await manager.ensureServer({
      workspaceId: 'w1',
      languageId: 'typescript',
      serverConfig,
      workspace: { workspaceId: 'w1', rootUri, folders: [{ name: 'w1', uri: rootUri }] },
    });
  });

  const failed = statuses.find((s) => String(s?.status || '') === 'initialize_failed');
  assert.ok(failed, 'should emit initialize_failed');
  assert.ok(String(failed?.stderrTail || '').includes('FAKE_STDERR'), 'stderrTail should include FAKE_STDERR');
  assert.ok(String(failed?.hint || ''), 'should include a hint');

  await manager.shutdownAll();
});


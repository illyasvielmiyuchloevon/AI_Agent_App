const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { LspManager } = require('../LspManager');
const { toFileUri } = require('../util/uri');

test('LspManager: server restart on crash (regression)', async () => {
  const statuses = [];
  const manager = new LspManager({
    onServerStatus: (p) => statuses.push(p),
  });

  const rootFsPath = path.resolve(__dirname);
  const rootUri = toFileUri(rootFsPath);

  const serverConfig = {
    id: 'fake-restart',
    languageId: 'typescript',
    transport: {
      kind: 'stdio',
      command: process.execPath,
      args: [path.join(__dirname, 'fakeLspServer.js')],
    },
    fileExtensions: ['.ts'],
  };

  // 1. Start server
  const { serverId } = await manager.ensureServer({
    workspaceId: 'w1',
    languageId: 'typescript',
    serverConfig,
    workspace: { workspaceId: 'w1', rootUri, folders: [{ name: 'w1', uri: rootUri }] },
  });

  // Wait for initial ready
  await new Promise((resolve) => {
    const check = () => {
      if (statuses.some(s => s.status === 'ready')) resolve();
      else setTimeout(check, 50);
    };
    check();
  });
  
  // Clear statuses to track restart sequence cleanly
  statuses.length = 0;

  // 2. Kill the server process
  const serverState = manager.servers.get(serverId);
  const pid = serverState?.proc?._proc?.pid;
  assert.ok(pid, 'Server process should have a PID');
  
  process.kill(pid, 'SIGKILL');

  // 3. Wait for restart sequence: exited -> restarting -> ready
  try {
    await new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        const exited = statuses.find(s => s.status === 'exited');
        const restarting = statuses.find(s => s.status === 'restarting');
        const ready = statuses.find(s => s.status === 'ready');

        if (exited && restarting && ready) {
          resolve();
        } else if (Date.now() - start > 10000) {
          reject(new Error(`Timeout waiting for restart. Statuses: ${JSON.stringify(statuses)}`));
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });

    // Verify sequence
    const restartingIdx = statuses.findIndex(s => s.status === 'restarting');
    const readyIdx = statuses.findIndex(s => s.status === 'ready');

    assert.ok(statuses.some(s => s.status === 'exited'), 'Should have exited status');
    assert.ok(restartingIdx >= 0, 'Should have restarting status');
    assert.ok(readyIdx >= 0, 'Should have ready status');
    // We don't strictly enforce exited < restarting because 'close' event might trigger restart before 'exit' event propagates
    assert.ok(restartingIdx < readyIdx, 'restarting before ready');
  } catch (err) {
    console.error('Test failed with statuses:', JSON.stringify(statuses, null, 2));
    throw err;
  } finally {
    await manager.shutdownAll();
  }
});

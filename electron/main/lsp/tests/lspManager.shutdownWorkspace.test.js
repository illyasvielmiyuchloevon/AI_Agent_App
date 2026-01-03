const test = require('node:test');
const assert = require('node:assert/strict');
const { LspManager } = require('../LspManager');

test('LspManager.shutdownWorkspace shuts down only matching workspace servers', async () => {
  const manager = new LspManager();

  const mkState = () => ({
    restart: { timer: null },
    proc: { shutdown: async () => {} },
    dynamicRegistrations: { byId: new Map(), byMethod: new Map() },
  });

  manager.servers.set('w1::file:///a::typescript::cfg1', mkState());
  manager.servers.set('w1::file:///b::typescript::cfg1', mkState());
  manager.servers.set('w2::file:///c::typescript::cfg1', mkState());
  manager.workspaceSettings.set('w1', { demo: true });
  manager.workspaceSettings.set('w2', { demo: true });

  await manager.shutdownWorkspace('w1');

  assert.equal(manager.servers.has('w1::file:///a::typescript::cfg1'), false);
  assert.equal(manager.servers.has('w1::file:///b::typescript::cfg1'), false);
  assert.equal(manager.servers.has('w2::file:///c::typescript::cfg1'), true);
  assert.equal(manager.workspaceSettings.has('w1'), false);
  assert.equal(manager.workspaceSettings.has('w2'), true);
});


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

test('dynamic registration: register -> effective, unregister -> removed', async () => {
  const capsEvents = [];
  const manager = new LspManager({
    onCapabilitiesChanged: (p) => capsEvents.push(p),
  });

  const rootFsPath = path.resolve(__dirname);
  const rootUri = toFileUri(rootFsPath);

  const serverConfig = {
    id: 'fake-dyn',
    languageId: 'typescript',
    transport: {
      kind: 'stdio',
      command: process.execPath,
      args: [path.join(__dirname, 'fakeLspServer.js')],
      env: { ...process.env, FAKE_LSP_DYNAMIC_REGS: '1' },
    },
    fileExtensions: ['.ts'],
  };

  const { serverId } = await manager.ensureServer({
    workspaceId: 'w1',
    languageId: 'typescript',
    serverConfig,
    workspace: { workspaceId: 'w1', rootUri, folders: [{ name: 'w1', uri: rootUri }] },
  });

  await waitFor(() => capsEvents.some((e) => e?.change?.type === 'register' && e?.change?.method === 'workspace/symbol'), { timeoutMs: 3000 });

  const caps1 = await manager.getServerCapabilities(serverId);
  assert.ok(caps1.semanticTokensProvider);
  assert.ok(caps1.inlayHintProvider);
  assert.ok(caps1.workspaceSymbolProvider);
  assert.ok(Array.isArray(caps1.semanticTokensProvider?.legend?.tokenTypes));

  await waitFor(() => capsEvents.some((e) => e?.change?.type === 'unregister' && e?.change?.method === 'workspace/symbol'), { timeoutMs: 3000 });

  const caps2 = await manager.getServerCapabilities(serverId);
  assert.ok(!caps2.workspaceSymbolProvider);

  await manager.shutdownAll();
});


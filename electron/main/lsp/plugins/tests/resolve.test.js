const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fsp = require('node:fs/promises');

const { LanguagePluginRegistry } = require('../LanguagePluginRegistry');
const { LanguagePluginManager } = require('../LanguagePluginManager');

test('LanguagePluginManager.resolveServerConfig resolves ${NODE} and ${PLUGIN_DIR}', async () => {
  const prevElectron = process.versions.electron;
  try { process.versions.electron = 'test'; } catch {}
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lsp-plugin-mgr-'));
  const regPath = path.join(dir, 'registry.json');
  const pluginDir = path.join(dir, 'plugins', 'tsls', '1.0.0');
  await fsp.mkdir(pluginDir, { recursive: true });

  const reg = new LanguagePluginRegistry({ registryPath: regPath });
  await reg.load();
  await reg.upsertPlugin({
    id: 'tsls',
    name: 'TSLS',
    trust: 'official',
    enabled: true,
    metadataOnly: false,
    installed: {
      version: '1.0.0',
      installDir: pluginDir,
      installedAt: Date.now(),
      source: { providerId: 'official' },
      manifest: {
        servers: [
          {
            id: 'tsls',
            languageIds: ['typescript'],
            fileExtensions: ['.ts'],
            transport: { kind: 'stdio', command: '${NODE}', args: ['${PLUGIN_DIR}/server.js', '--stdio'] },
          },
        ],
      },
    },
  });

  const mgr = new LanguagePluginManager({ registry: reg, installer: null, providers: [] });
  const res = mgr.resolveServerConfig({ workspaceId: 'w1', languageId: 'typescript', filePath: 'a.ts' });
  assert.equal(res.ok, true);
  assert.equal(res.serverConfig.transport.command, process.execPath);
  assert.ok(String(res.serverConfig.transport.args[0]).includes('server.js'));
  assert.equal(res.serverConfig.transport.env?.ELECTRON_RUN_AS_NODE, '1');
  try {
    if (prevElectron === undefined) delete process.versions.electron;
    else process.versions.electron = prevElectron;
  } catch {}
});

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { LanguagePluginManager } = require('../plugins/LanguagePluginManager');

test('LanguagePluginManager.resolveServerConfigs returns multiple matching servers (role-ordered)', () => {
  const pluginDir = path.resolve(__dirname);
  const registry = {
    listPlugins: () => ([
      {
        id: 'multi',
        name: 'Multi',
        trust: 'official',
        enabled: true,
        metadataOnly: false,
        installed: {
          version: '1.0.0',
          installDir: pluginDir,
          manifest: {
            servers: [
              {
                id: 'main',
                role: 'primary',
                languageIds: ['typescript'],
                fileExtensions: ['.ts'],
                transport: { kind: 'stdio', command: '${NODE}', args: ['-e', 'process.stdin.resume()'] },
              },
              {
                id: 'lint',
                role: 'lint',
                languageIds: ['typescript'],
                fileExtensions: ['.ts'],
                transport: { kind: 'stdio', command: '${NODE}', args: ['-e', 'process.stdin.resume()'] },
              },
            ],
          },
        },
      },
    ]),
  };

  const mgr = new LanguagePluginManager({ registry, installer: null, providers: [] });
  const res = mgr.resolveServerConfigs({ workspaceId: 'w1', languageId: 'typescript', filePath: 'src/a.ts' });
  assert.equal(res.ok, true);
  assert.equal(res.plugin.id, 'multi');
  assert.equal(Array.isArray(res.serverConfigs), true);
  assert.equal(res.serverConfigs.length, 2);
  assert.equal(res.serverConfigs[0].role, 'primary');
  assert.equal(res.serverConfigs[1].role, 'lint');
  assert.ok(String(res.serverConfigs[0].id).includes('main'));
  assert.ok(String(res.serverConfigs[1].id).includes('lint'));
});


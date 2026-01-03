const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fsp = require('node:fs/promises');

const { LanguagePluginRegistry } = require('../LanguagePluginRegistry');

test('LanguagePluginRegistry: upsert + reload', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lsp-plugin-reg-'));
  const regPath = path.join(dir, 'registry.json');

  const reg = new LanguagePluginRegistry({ registryPath: regPath });
  await reg.load();
  await reg.upsertPlugin({ id: 'tsls', name: 'TSLS', enabled: true, installed: { version: '1.0.0', installDir: 'X', installedAt: 1 } });

  const reg2 = new LanguagePluginRegistry({ registryPath: regPath });
  await reg2.load();
  assert.equal(reg2.getPlugin('tsls')?.enabled, true);
});


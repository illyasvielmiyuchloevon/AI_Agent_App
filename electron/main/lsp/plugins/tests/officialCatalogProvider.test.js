const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { OfficialCatalogProvider } = require('../providers/OfficialCatalogProvider');

test('OfficialCatalogProvider includes jsonls entry', async () => {
  const catalogPath = path.join(__dirname, '..', 'officialCatalog.json');
  const p = new OfficialCatalogProvider({ catalogPath });
  const item = await p.get('jsonls');
  assert.ok(item);
  assert.equal(item.id, 'jsonls');
  assert.ok(Array.isArray(item.languages));
  assert.ok(item.languages.includes('json'));
});


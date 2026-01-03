const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const { findFilesInWorkspace } = require('../fileSearch');
const { fsPathToFileUri } = require('../workspaceFsUtils');

const byName = (a, b) => String(a).localeCompare(String(b));

test('findFilesInWorkspace matches include pattern and ignores node_modules by default', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ide-find-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'a.js'), 'a');
  fs.writeFileSync(path.join(root, 'b.ts'), 'b');
  fs.writeFileSync(path.join(root, 'src', 'c.js'), 'c');
  fs.writeFileSync(path.join(root, 'node_modules', 'd.js'), 'd');

  const res = await findFilesInWorkspace({ workspaceRootFsPath: root, include: '**/*.js' });
  assert.equal(res.ok, true);
  const list = res.uris.map((u) => path.basename(u)).sort(byName);
  assert.deepEqual(list, ['a.js', 'c.js']);
});

test('findFilesInWorkspace supports baseUri scoping', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ide-find-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'a.js'), 'a');
  fs.writeFileSync(path.join(root, 'src', 'c.js'), 'c');

  const baseUri = fsPathToFileUri(path.join(root, 'src'));
  const res = await findFilesInWorkspace({ workspaceRootFsPath: root, include: { baseUri, pattern: '**/*.js' } });
  assert.equal(res.ok, true);
  assert.equal(res.uris.length, 1);
  assert.equal(path.basename(res.uris[0]), 'c.js');
});

test('findFilesInWorkspace honors maxResults', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ide-find-'));
  fs.writeFileSync(path.join(root, 'a.js'), 'a');
  fs.writeFileSync(path.join(root, 'b.js'), 'b');

  const res = await findFilesInWorkspace({ workspaceRootFsPath: root, include: '**/*.js', maxResults: 1 });
  assert.equal(res.ok, true);
  assert.equal(res.uris.length, 1);
});


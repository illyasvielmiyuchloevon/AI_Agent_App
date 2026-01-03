const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { Uri } = require('../vscodeTypes');
const { singleFolderFromFsPath, diffWorkspaceFolders } = require('../workspaceFoldersModel');

test('singleFolderFromFsPath creates one folder with basename name', () => {
  const root = process.platform === 'win32' ? path.join('C:\\', 'repo', 'project') : path.join('/', 'repo', 'project');
  const folders = singleFolderFromFsPath(root);
  assert.equal(folders.length, 1);
  assert.equal(folders[0].name, 'project');
  assert.equal(folders[0].uri.scheme, 'file');
});

test('diffWorkspaceFolders detects added and removed folders', () => {
  const aPath = process.platform === 'win32' ? 'C:\\a' : '/a';
  const bPath = process.platform === 'win32' ? 'C:\\b' : '/b';
  const a = [{ uri: Uri.file(aPath), name: 'a', index: 0 }];
  const b = [{ uri: Uri.file(bPath), name: 'b', index: 0 }];
  const diff = diffWorkspaceFolders(a, b);
  assert.equal(diff.added.length, 1);
  assert.equal(diff.removed.length, 1);
});

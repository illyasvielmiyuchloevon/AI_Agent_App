const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  toFileUriString,
  toFsPath,
  resolveWorkspaceFileFsPath,
  readWorkspaceSettingsSync,
  openTextDocument,
} = require('../documentModel');

test('documentModel: file uri round-trip and workspace resolution', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ide-docmodel-'));
  const root = path.join(tmp, 'ws');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, '.vscode'), { recursive: true });
  fs.writeFileSync(path.join(root, '.vscode', 'settings.json'), JSON.stringify({ editor: { tabSize: 2 } }), 'utf8');
  fs.writeFileSync(path.join(root, 'hello.txt'), 'hello', 'utf8');

  const settings = readWorkspaceSettingsSync(root);
  assert.equal(settings.editor.tabSize, 2);

  const fsPath = resolveWorkspaceFileFsPath(root, 'hello.txt');
  assert.equal(fsPath, path.resolve(path.join(root, 'hello.txt')));

  const uri = toFileUriString(fsPath);
  assert.ok(uri.startsWith('file:'));
  assert.equal(path.resolve(toFsPath(uri)), path.resolve(fsPath));

  const doc = await openTextDocument({ workspaceRootFsPath: root, uriOrPath: 'hello.txt' });
  assert.equal(doc.ok, true);
  assert.equal(doc.text, 'hello');
  assert.ok(String(doc.uri).startsWith('file:'));
});

test('documentModel: rejects paths outside workspace root', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ide-docmodel-'));
  const root = path.join(tmp, 'ws');
  const outside = path.join(tmp, 'outside.txt');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(outside, 'nope', 'utf8');

  const res = await openTextDocument({ workspaceRootFsPath: root, uriOrPath: outside });
  assert.equal(res.ok, false);
});


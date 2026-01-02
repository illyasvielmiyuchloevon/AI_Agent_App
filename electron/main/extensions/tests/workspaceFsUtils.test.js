const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const { resolveWorkspaceFileFsPath, fsPathToFileUri } = require('../workspaceFsUtils');

test('resolveWorkspaceFileFsPath resolves relative path inside root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ide-ws-'));
  fs.writeFileSync(path.join(root, 'a.txt'), 'x');
  const res = resolveWorkspaceFileFsPath(root, 'a.txt');
  assert.equal(res.ok, true);
  assert.equal(path.basename(res.fsPath), 'a.txt');
});

test('resolveWorkspaceFileFsPath rejects outside root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ide-ws-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ide-outside-'));
  fs.writeFileSync(path.join(outside, 'b.txt'), 'y');
  const res = resolveWorkspaceFileFsPath(root, path.join(outside, 'b.txt'));
  assert.equal(res.ok, false);
});

test('resolveWorkspaceFileFsPath accepts file:// uri inside root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ide-ws-'));
  const target = path.join(root, 'c.txt');
  fs.writeFileSync(target, 'z');
  const uri = fsPathToFileUri(target);
  const res = resolveWorkspaceFileFsPath(root, uri);
  assert.equal(res.ok, true);
  assert.equal(path.basename(res.fsPath), 'c.txt');
});


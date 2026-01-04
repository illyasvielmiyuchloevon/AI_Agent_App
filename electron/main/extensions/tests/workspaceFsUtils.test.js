const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

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

test('frontend file uri parsing handles windows localhost and drive host', async () => {
  const repoRoot = path.resolve(__dirname, '../../../../');
  const fsPathMod = await import(pathToFileURL(path.join(repoRoot, 'frontend/src/lsp/util/fsPath.js')).href);
  const toLspMod = await import(pathToFileURL(path.join(repoRoot, 'frontend/src/lsp/adapters/toLsp.js')).href);

  const windows = true;
  assert.equal(fsPathMod.fileUriToFsPath('file://localhost/C:/Users/me/a.ts', { windows }), 'C:\\Users\\me\\a.ts');
  assert.equal(fsPathMod.fileUriToFsPath('file://C:/Users/me/a.ts', { windows }), 'C:\\Users\\me\\a.ts');
  assert.equal(fsPathMod.fileUriToFsPath('file://server/share/a.ts', { windows }), '\\\\server\\share\\a.ts');
  assert.equal(fsPathMod.toWorkspaceRelativePath('C:\\Users\\me\\a.ts', 'c:\\users\\me'), 'a.ts');

  assert.equal(toLspMod.resolveFsPath('C:\\Users\\me', 'file://localhost/C:/Users/me/a.ts'), 'C:\\Users\\me\\a.ts');
  assert.equal(toLspMod.resolveFsPath('C:\\Users\\me', 'file://C:/Users/me/a.ts'), 'C:\\Users\\me\\a.ts');
});

test('modelSync lspUriToModelPath accepts workspace-relative file uri', async () => {
  const repoRoot = path.resolve(__dirname, '../../../../');
  const fsPathMod = await import(pathToFileURL(path.join(repoRoot, 'frontend/src/lsp/util/fsPath.js')).href);
  assert.equal(fsPathMod.fileUriToWorkspaceRelativePath('file:///todo-app/src/script.js', 'C:\\Users\\me\\Documents\\1112'), 'todo-app/src/script.js');
});

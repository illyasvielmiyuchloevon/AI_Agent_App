const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { fsCreateDirectory, fsDelete, fsRename, fsCopy } = require('../workspaceFsOps');
const { fsPathToFileUri } = require('../workspaceFsUtils');

const writeText = async (p, text) => {
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
  await fs.promises.writeFile(p, Buffer.from(String(text), 'utf8'));
};

test('workspaceFsOps: createDirectory/delete/rename/copy inside root', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ide-fsops-'));
  try {
    const aDir = path.join(root, 'a', 'b');
    const aUri = fsPathToFileUri(aDir);
    const mk = await fsCreateDirectory({ workspaceRootFsPath: root, uri: aUri });
    assert.equal(mk.ok, true);
    assert.equal(fs.existsSync(aDir), true);

    const src = path.join(root, 'a', 'b', 'hello.txt');
    await writeText(src, 'hello');
    const dst = path.join(root, 'a', 'b', 'hello2.txt');
    const cp = await fsCopy({ workspaceRootFsPath: root, from: fsPathToFileUri(src), to: fsPathToFileUri(dst), options: { overwrite: false } });
    assert.equal(cp.ok, true);
    assert.equal(fs.readFileSync(dst, 'utf8'), 'hello');

    const renamed = path.join(root, 'a', 'b', 'hello3.txt');
    const rn = await fsRename({ workspaceRootFsPath: root, from: fsPathToFileUri(dst), to: fsPathToFileUri(renamed), options: { overwrite: false } });
    assert.equal(rn.ok, true);
    assert.equal(fs.existsSync(dst), false);
    assert.equal(fs.readFileSync(renamed, 'utf8'), 'hello');

    const del = await fsDelete({ workspaceRootFsPath: root, uri: fsPathToFileUri(renamed), options: {} });
    assert.equal(del.ok, true);
    assert.equal(fs.existsSync(renamed), false);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test('workspaceFsOps: rename/copy overwrite rules', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ide-fsops-'));
  try {
    const src = path.join(root, 'src.txt');
    const dst = path.join(root, 'dst.txt');
    await writeText(src, '1');
    await writeText(dst, '2');

    const rnNo = await fsRename({ workspaceRootFsPath: root, from: fsPathToFileUri(src), to: fsPathToFileUri(dst), options: { overwrite: false } });
    assert.equal(rnNo.ok, false);

    const rnYes = await fsRename({ workspaceRootFsPath: root, from: fsPathToFileUri(src), to: fsPathToFileUri(dst), options: { overwrite: true } });
    assert.equal(rnYes.ok, true);
    assert.equal(fs.readFileSync(dst, 'utf8'), '1');

    await writeText(src, '3');
    const cpNo = await fsCopy({ workspaceRootFsPath: root, from: fsPathToFileUri(src), to: fsPathToFileUri(dst), options: { overwrite: false } });
    assert.equal(cpNo.ok, false);
    const cpYes = await fsCopy({ workspaceRootFsPath: root, from: fsPathToFileUri(src), to: fsPathToFileUri(dst), options: { overwrite: true } });
    assert.equal(cpYes.ok, true);
    assert.equal(fs.readFileSync(dst, 'utf8'), '3');
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test('workspaceFsOps: delete respects recursive flag', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ide-fsops-'));
  try {
    const dir = path.join(root, 'dir');
    await writeText(path.join(dir, 'f.txt'), 'x');

    const delNo = await fsDelete({ workspaceRootFsPath: root, uri: fsPathToFileUri(dir), options: { recursive: false } });
    assert.equal(delNo.ok, false);

    const delYes = await fsDelete({ workspaceRootFsPath: root, uri: fsPathToFileUri(dir), options: { recursive: true } });
    assert.equal(delYes.ok, true);
    assert.equal(fs.existsSync(dir), false);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test('workspaceFsOps: rejects paths outside root', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ide-fsops-'));
  try {
    const res = await fsCreateDirectory({ workspaceRootFsPath: root, uri: '../escape' });
    assert.equal(res.ok, false);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});


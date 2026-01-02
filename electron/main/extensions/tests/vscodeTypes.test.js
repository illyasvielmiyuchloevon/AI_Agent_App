const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const { Uri } = require('../vscodeTypes');

const norm = (p) => {
  const s = path.resolve(String(p || ''));
  return process.platform === 'win32' ? s.toLowerCase() : s;
};

test('Uri.file roundtrips fsPath', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ide-uri-'));
  const file = path.join(dir, 'a.txt');
  fs.writeFileSync(file, 'x');

  const u = Uri.file(file);
  assert.equal(u.scheme, 'file');
  assert.equal(norm(u.fsPath), norm(file));
});

test('Uri.parse(fileUrl).fsPath works', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ide-uri-'));
  const file = path.join(dir, 'b.txt');
  fs.writeFileSync(file, 'y');

  const url = Uri.file(file).toString();
  const u = Uri.parse(url);
  assert.equal(norm(u.fsPath), norm(file));
});


const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { LspManager } = require('../LspManager');
const { toFileUri } = require('../util/uri');
const {
  normalizePositionEncoding,
  convertPosition,
  convertRange,
  convertSemanticTokensData,
} = require('../util/positionEncoding');

test('normalizePositionEncoding accepts legacy spellings', () => {
  assert.equal(normalizePositionEncoding('utf16'), 'utf-16');
  assert.equal(normalizePositionEncoding('utf8'), 'utf-8');
  assert.equal(normalizePositionEncoding('utf32'), 'utf-32');
});

test('convertPosition converts utf-16 <-> utf-8 with emoji', () => {
  const text = 'a😀b\n中文🙂x';
  const utf16Pos = { line: 0, character: 3 }; // after 😀 before b (a=1, 😀=2)
  const utf8Pos = convertPosition(text, utf16Pos, 'utf-16', 'utf-8');
  assert.deepEqual(utf8Pos, { line: 0, character: 5 }); // a=1 byte, 😀=4 bytes
  const roundTrip = convertPosition(text, utf8Pos, 'utf-8', 'utf-16');
  assert.deepEqual(roundTrip, utf16Pos);
});

test('convertRange converts utf-16 <-> utf-8 with emoji', () => {
  const text = 'a😀b';
  const r16 = { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } }; // 😀
  const r8 = convertRange(text, r16, 'utf-16', 'utf-8');
  assert.deepEqual(r8, { start: { line: 0, character: 1 }, end: { line: 0, character: 5 } });
  const back = convertRange(text, r8, 'utf-8', 'utf-16');
  assert.deepEqual(back, r16);
});

test('convertSemanticTokensData converts token start/length between encodings', () => {
  const text = 'a😀b';
  const utf8Data = [0, 1, 4, 0, 0]; // starts at emoji (1 byte), length=4 bytes
  const utf16Data = convertSemanticTokensData(text, utf8Data, 'utf-8', 'utf-16');
  assert.deepEqual(utf16Data, [0, 1, 2, 0, 0]); // emoji is 2 UTF-16 code units
});

test('watched files matching supports RelativePattern baseUri (multi-root)', () => {
  const manager = new LspManager();
  const root1 = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-root1-'));
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-root2-'));
  const fileInRoot2 = path.join(root2, 'src', 'a.ts');

  const watchers = [
    { globPattern: { baseUri: toFileUri(root2), pattern: '**/*.ts' }, kind: 7 }, // create/change/delete
  ];
  assert.equal(manager._matchesWatchedFiles(watchers, [root1, root2], fileInRoot2, 2), true);
});


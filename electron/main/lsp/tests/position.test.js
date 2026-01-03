const test = require('node:test');
const assert = require('node:assert/strict');
const { offsetAt, positionAt, utf16CodeUnitsLength } = require('../util/position');

test('utf16CodeUnitsLength counts surrogate pairs as 2', () => {
  assert.equal(utf16CodeUnitsLength('🙂'), 2);
  assert.equal(utf16CodeUnitsLength('a🙂b'), 4);
});

test('offsetAt and positionAt round-trip with emoji', () => {
  const text = 'a🙂b\n中文🙂x';
  const pos = { line: 0, character: 3 }; // before 'b'
  const off = offsetAt(text, pos);
  assert.equal(off, 3);
  const back = positionAt(text, off);
  assert.deepEqual(back, pos);
});


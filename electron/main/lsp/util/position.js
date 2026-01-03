function utf16CodeUnitsLength(str) {
  return String(str || '').length;
}

function offsetAt(text, position) {
  const line = Math.max(0, Number(position?.line) || 0);
  const character = Math.max(0, Number(position?.character) || 0);
  const s = String(text || '');

  let idx = 0;
  let currentLine = 0;
  while (currentLine < line && idx < s.length) {
    const nl = s.indexOf('\n', idx);
    if (nl === -1) return s.length;
    idx = nl + 1;
    currentLine += 1;
  }
  return Math.min(s.length, idx + character);
}

function positionAt(text, offset) {
  const s = String(text || '');
  const target = Math.max(0, Math.min(s.length, Number(offset) || 0));

  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < target; i += 1) {
    if (s.charCodeAt(i) === 10) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, character: target - lineStart };
}

module.exports = { utf16CodeUnitsLength, offsetAt, positionAt };


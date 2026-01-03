const { Buffer } = require('buffer');

const PositionEncoding = {
  UTF8: 'utf-8',
  UTF16: 'utf-16',
  UTF32: 'utf-32',
};

function normalizePositionEncoding(value) {
  const v = String(value || '').toLowerCase();
  if (v === PositionEncoding.UTF8 || v === 'utf8') return PositionEncoding.UTF8;
  if (v === PositionEncoding.UTF32 || v === 'utf32') return PositionEncoding.UTF32;
  if (v === PositionEncoding.UTF16 || v === 'utf16') return PositionEncoding.UTF16;
  return PositionEncoding.UTF16;
}

function getLineSlice(text, line) {
  const s = String(text || '');
  const targetLine = Math.max(0, Number(line) || 0);
  let idx = 0;
  let current = 0;
  while (current < targetLine && idx < s.length) {
    const nl = s.indexOf('\n', idx);
    if (nl === -1) return { lineText: '', lineStart: s.length, lineEnd: s.length };
    idx = nl + 1;
    current += 1;
  }
  let end = s.indexOf('\n', idx);
  if (end === -1) end = s.length;
  return { lineText: s.slice(idx, end), lineStart: idx, lineEnd: end };
}

function clamp(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function toUtf16Character(lineText, character, fromEncoding) {
  const enc = normalizePositionEncoding(fromEncoding);
  const line = String(lineText || '');
  if (enc === PositionEncoding.UTF16) return clamp(character, 0, line.length);

  if (enc === PositionEncoding.UTF32) {
    const target = Math.max(0, Number(character) || 0);
    let cpCount = 0;
    let cuIndex = 0;
    for (const cp of line) {
      if (cpCount >= target) break;
      cuIndex += cp.length;
      cpCount += 1;
    }
    return clamp(cuIndex, 0, line.length);
  }

  // utf-8 (bytes)
  const targetBytes = Math.max(0, Number(character) || 0);
  let bytes = 0;
  let cuIndex = 0;
  for (const cp of line) {
    const b = Buffer.byteLength(cp, 'utf8');
    if (bytes + b > targetBytes) break;
    bytes += b;
    cuIndex += cp.length;
  }
  return clamp(cuIndex, 0, line.length);
}

function fromUtf16Character(lineText, utf16Character, toEncoding) {
  const enc = normalizePositionEncoding(toEncoding);
  const line = String(lineText || '');
  const target = clamp(utf16Character, 0, line.length);
  if (enc === PositionEncoding.UTF16) return target;

  if (enc === PositionEncoding.UTF32) {
    let cpCount = 0;
    let cuIndex = 0;
    for (const cp of line) {
      if (cuIndex >= target) break;
      cuIndex += cp.length;
      cpCount += 1;
    }
    return cpCount;
  }

  // utf-8 (bytes)
  return Buffer.byteLength(line.slice(0, target), 'utf8');
}

function convertPosition(text, position, fromEncoding, toEncoding) {
  const fromEnc = normalizePositionEncoding(fromEncoding);
  const toEnc = normalizePositionEncoding(toEncoding);
  if (fromEnc === toEnc) return position;
  if (!position || typeof position !== 'object') return position;

  const line = Math.max(0, Number(position.line) || 0);
  const { lineText } = getLineSlice(text, line);
  const utf16Char = toUtf16Character(lineText, position.character, fromEnc);
  const outChar = fromUtf16Character(lineText, utf16Char, toEnc);
  return { line, character: outChar };
}

function convertRange(text, range, fromEncoding, toEncoding) {
  if (!range || typeof range !== 'object') return range;
  return {
    start: convertPosition(text, range.start, fromEncoding, toEncoding),
    end: convertPosition(text, range.end, fromEncoding, toEncoding),
  };
}

function convertFoldingRange(text, foldingRange, fromEncoding, toEncoding) {
  const fr = foldingRange && typeof foldingRange === 'object' ? foldingRange : null;
  if (!fr) return fr;
  const fromEnc = normalizePositionEncoding(fromEncoding);
  const toEnc = normalizePositionEncoding(toEncoding);
  if (fromEnc === toEnc) return fr;

  const startLine = Number(fr.startLine);
  const endLine = Number(fr.endLine);
  if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) return fr;

  const out = { ...fr };
  if (Number.isFinite(fr.startCharacter)) {
    const { lineText } = getLineSlice(text, startLine);
    const utf16Char = toUtf16Character(lineText, fr.startCharacter, fromEnc);
    out.startCharacter = fromUtf16Character(lineText, utf16Char, toEnc);
  }
  if (Number.isFinite(fr.endCharacter)) {
    const { lineText } = getLineSlice(text, endLine);
    const utf16Char = toUtf16Character(lineText, fr.endCharacter, fromEnc);
    out.endCharacter = fromUtf16Character(lineText, utf16Char, toEnc);
  }
  return out;
}

function convertSemanticTokensData(text, data, fromEncoding, toEncoding) {
  const fromEnc = normalizePositionEncoding(fromEncoding);
  const toEnc = normalizePositionEncoding(toEncoding);
  const src = Array.isArray(data) ? data : [];
  if (fromEnc === toEnc || src.length === 0) return data;

  let line = 0;
  let charFrom = 0;
  let prevLine = 0;
  let prevCharOut = 0;

  const out = new Array(src.length);

  for (let i = 0; i + 4 < src.length; i += 5) {
    const deltaLine = Number(src[i] || 0);
    const deltaStart = Number(src[i + 1] || 0);
    const lengthFrom = Number(src[i + 2] || 0);
    const tokenType = src[i + 3];
    const tokenMods = src[i + 4];

    line += deltaLine;
    if (deltaLine > 0) charFrom = 0;
    charFrom += deltaStart;

    const { lineText } = getLineSlice(text, line);

    const startUtf16 = toUtf16Character(lineText, charFrom, fromEnc);
    const endUtf16 = toUtf16Character(lineText, charFrom + lengthFrom, fromEnc);
    const startOut = fromUtf16Character(lineText, startUtf16, toEnc);
    const endOut = fromUtf16Character(lineText, endUtf16, toEnc);
    const lengthOut = Math.max(0, Number(endOut) - Number(startOut));

    const outDeltaLine = line - prevLine;
    const outDeltaStart = outDeltaLine === 0 ? (startOut - prevCharOut) : startOut;

    out[i] = outDeltaLine;
    out[i + 1] = outDeltaStart;
    out[i + 2] = lengthOut;
    out[i + 3] = tokenType;
    out[i + 4] = tokenMods;

    prevLine = line;
    prevCharOut = startOut;
  }
  return out;
}

module.exports = {
  PositionEncoding,
  normalizePositionEncoding,
  convertPosition,
  convertRange,
  convertFoldingRange,
  convertSemanticTokensData,
};

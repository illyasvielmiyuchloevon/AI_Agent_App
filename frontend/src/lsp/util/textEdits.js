export function offsetAt(text, position) {
  const s = String(text || '');
  const line = Math.max(0, Number(position?.line || 0));
  const character = Math.max(0, Number(position?.character || 0));

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

export function applyLspTextEdits(text, edits) {
  const s = String(text || '');
  const list = Array.isArray(edits) ? edits : [];
  if (!list.length) return s;

  const normalized = list
    .map((e) => ({
      range: e?.range || e?.replace || e?.insert,
      newText: typeof e?.newText === 'string' ? e.newText : String(e?.text || ''),
    }))
    .filter((e) => e.range && e.range.start && e.range.end)
    .map((e) => {
      const start = offsetAt(s, e.range.start);
      const end = offsetAt(s, e.range.end);
      return { start, end, newText: e.newText };
    })
    .sort((a, b) => (b.start - a.start) || (b.end - a.end));

  let out = s;
  for (const e of normalized) {
    out = out.slice(0, e.start) + e.newText + out.slice(e.end);
  }
  return out;
}

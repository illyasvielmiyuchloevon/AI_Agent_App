const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

const clampInt = (value, min, max) => {
  const n = typeof value === 'string' ? Number.parseInt(value, 10) : (typeof value === 'number' ? value : NaN);
  if (!Number.isFinite(n)) return min;
  return clamp(Math.floor(n), min, max);
};

const clampNumber = (value, min, max) => {
  const n = typeof value === 'string' ? Number(value) : (typeof value === 'number' ? value : NaN);
  if (!Number.isFinite(n)) return min;
  return clamp(n, min, max);
};

export const DEFAULT_INTEGRATED_SETTINGS = {
  fontFamily: 'Consolas, ui-monospace, SFMono-Regular, Menlo, Monaco, "Liberation Mono", "Courier New", monospace',
  fontSize: 13,
  lineHeight: 1.2,
  cursorBlink: true,
  cursorStyle: 'block',
  scrollback: 4000,
  convertEol: true,
};

export const normalizeIntegratedOverrides = (raw) => {
  const src = raw && typeof raw === 'object' ? raw : {};
  const next = {};
  if (typeof src.fontFamily === 'string') next.fontFamily = String(src.fontFamily || '').trim();
  if (src.fontSize != null) next.fontSize = clampInt(src.fontSize, 9, 24);
  if (src.lineHeight != null) next.lineHeight = clampNumber(src.lineHeight, 1, 2);
  if (typeof src.cursorBlink === 'boolean') next.cursorBlink = !!src.cursorBlink;
  if (typeof src.cursorStyle === 'string') {
    const v = String(src.cursorStyle || '').toLowerCase();
    if (v === 'bar' || v === 'underline' || v === 'block') next.cursorStyle = v;
  }
  if (src.scrollback != null) next.scrollback = clampInt(src.scrollback, 100, 100000);
  if (typeof src.convertEol === 'boolean') next.convertEol = !!src.convertEol;
  if (typeof next.fontFamily === 'string' && !next.fontFamily) delete next.fontFamily;
  return next;
};

export const normalizeIntegratedSettings = (raw) => {
  const src = raw && typeof raw === 'object' ? raw : {};
  const next = { ...DEFAULT_INTEGRATED_SETTINGS };
  if (typeof src.fontFamily === 'string') next.fontFamily = String(src.fontFamily || '').trim() || next.fontFamily;
  if (src.fontSize != null) next.fontSize = clampInt(src.fontSize, 9, 24);
  if (src.lineHeight != null) next.lineHeight = clampNumber(src.lineHeight, 1, 2);
  if (typeof src.cursorBlink === 'boolean') next.cursorBlink = !!src.cursorBlink;
  if (typeof src.cursorStyle === 'string') {
    const v = String(src.cursorStyle || '').toLowerCase();
    next.cursorStyle = (v === 'bar' || v === 'underline' || v === 'block') ? v : next.cursorStyle;
  }
  if (src.scrollback != null) next.scrollback = clampInt(src.scrollback, 100, 100000);
  if (typeof src.convertEol === 'boolean') next.convertEol = !!src.convertEol;
  return next;
};


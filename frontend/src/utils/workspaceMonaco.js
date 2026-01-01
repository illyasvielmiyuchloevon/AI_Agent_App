const clampNumber = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

export const normalizeEditorSettings = (editorSettings) => {
  const s = (editorSettings && typeof editorSettings === 'object') ? editorSettings : {};
  const tabSize = clampNumber(s.tabSize, 1, 8, 4);
  const fontSize = clampNumber(s.fontSize, 10, 24, 13);
  const lineHeight = clampNumber(s.lineHeight, 14, 36, 21);
  const wordWrapEnabled = s.wordWrap === true || s.wordWrap === 'on';
  const minimapEnabled = s.minimap !== false;
  const fontLigaturesEnabled = s.fontLigatures !== false;
  const renderWhitespace = typeof s.renderWhitespace === 'string' ? s.renderWhitespace : 'none';
  return {
    tabSize: Math.round(tabSize),
    fontSize: Math.round(fontSize),
    lineHeight: Math.round(lineHeight),
    wordWrapEnabled,
    minimapEnabled,
    fontLigaturesEnabled,
    renderWhitespace,
  };
};

export const resolveEditorNavigationMode = (editorSettings) => {
  const raw = editorSettings && typeof editorSettings === 'object' ? String(editorSettings.navigationMode || '') : '';
  return raw === 'stickyScroll' ? 'stickyScroll' : 'breadcrumbs';
};

export const buildMonacoOptions = (normalizedEditorSettings, editorNavigationMode) => ({
  minimap: { enabled: normalizedEditorSettings.minimapEnabled, renderCharacters: false },
  glyphMargin: true,
  folding: true,
  renderLineHighlight: 'all',
  lineNumbers: 'on',
  wordWrap: normalizedEditorSettings.wordWrapEnabled ? 'on' : 'off',
  automaticLayout: true,
  scrollBeyondLastLine: true,
  fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', 'Courier New', monospace",
  fontLigatures: normalizedEditorSettings.fontLigaturesEnabled,
  fontSize: normalizedEditorSettings.fontSize,
  lineHeight: normalizedEditorSettings.lineHeight,
  letterSpacing: 0,
  tabSize: normalizedEditorSettings.tabSize,
  contextmenu: true,
  smoothScrolling: true,
  renderWhitespace: normalizedEditorSettings.renderWhitespace,
  bracketPairColorization: { enabled: true },
  guides: { indentation: true, highlightActiveIndentation: true },
  quickSuggestions: true,
  cursorBlinking: 'blink',
  stickyScroll: { enabled: editorNavigationMode === 'stickyScroll' },
});


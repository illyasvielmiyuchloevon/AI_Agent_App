export function lspPositionToMonacoPosition(pos) {
  return {
    lineNumber: Math.max(1, Number(pos?.line || 0) + 1),
    column: Math.max(1, Number(pos?.character || 0) + 1),
  };
}

export function lspRangeToMonacoRange(monaco, range) {
  const start = lspPositionToMonacoPosition(range?.start);
  const end = lspPositionToMonacoPosition(range?.end);
  return new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column);
}

export function lspDiagnosticToMonacoMarker(monaco, diagnostic) {
  const r = diagnostic?.range || {};
  const start = lspPositionToMonacoPosition(r.start);
  const end = lspPositionToMonacoPosition(r.end);
  const sev = Number(diagnostic?.severity || 0);

  const MarkerSeverity = monaco?.MarkerSeverity;
  const severity =
    sev === 1 ? MarkerSeverity.Error :
      (sev === 2 ? MarkerSeverity.Warning :
        (sev === 3 ? MarkerSeverity.Info : MarkerSeverity.Hint));

  return {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column,
    message: String(diagnostic?.message || ''),
    severity,
    source: diagnostic?.source ? String(diagnostic.source) : 'lsp',
    code: diagnostic?.code,
  };
}


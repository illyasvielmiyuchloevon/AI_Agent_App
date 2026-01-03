const listeners = new Set();

let monacoBound = false;
let markersCache = [];
let version = 0;
let snapshot = { version: 0, problems: [] };

const emit = () => {
  for (const fn of Array.from(listeners)) {
    try { fn(); } catch {}
  }
};

const normalizePath = (uri) => {
  if (!uri) return '';
  try {
    const raw = uri.path || uri.fsPath || uri._path || '';
    const s = String(raw || '');
    if (!s) return String(uri.toString ? uri.toString() : '');
    return s.replace(/^\//, '');
  } catch {
    return '';
  }
};

const severityName = (monaco, s) => {
  const Sev = monaco?.MarkerSeverity;
  if (!Sev) return 'info';
  if (s === Sev.Error) return 'error';
  if (s === Sev.Warning) return 'warning';
  return 'info';
};

const toProblem = (monaco, m) => ({
  id: `${normalizePath(m.resource)}:${m.startLineNumber}:${m.startColumn}:${m.owner}:${m.message}`,
  file: normalizePath(m.resource),
  message: String(m.message || ''),
  source: String(m.owner || m.source || ''),
  severity: severityName(monaco, m.severity),
  line: Number(m.startLineNumber || 1),
  col: Number(m.startColumn || 1),
  endLine: Number(m.endLineNumber || m.startLineNumber || 1),
  endCol: Number(m.endColumn || m.startColumn || 1),
});

export const diagnosticsService = {
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  getSnapshot() {
    return snapshot;
  },
  attachMonaco(monaco) {
    if (!monaco || monacoBound) return;
    if (!monaco.editor?.onDidChangeMarkers || !monaco.editor?.getModelMarkers) return;
    monacoBound = true;

    const refresh = () => {
      try {
        const markers = monaco.editor.getModelMarkers({});
        markersCache = Array.isArray(markers) ? markers.map((m) => toProblem(monaco, m)).filter((p) => p.file && p.message) : [];
      } catch {
        markersCache = [];
      }
      version += 1;
      snapshot = { version, problems: markersCache };
      emit();
    };

    refresh();
    monaco.editor.onDidChangeMarkers(() => refresh());
  },
};

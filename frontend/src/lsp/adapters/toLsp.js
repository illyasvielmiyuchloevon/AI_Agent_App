const isWindowsAbsPath = (p) => /^[a-zA-Z]:[\\/]/.test(String(p || ''));
const isUncPath = (p) => /^\\\\/.test(String(p || ''));

export function toFileUri(fsPath) {
  const raw = String(fsPath || '').trim();
  if (!raw) return '';
  if (raw.startsWith('file://')) return raw;

  if (isUncPath(raw)) {
    const withoutPrefix = raw.replace(/^\\\\+/, '');
    const normalized = withoutPrefix.replace(/\\/g, '/');
    const [host, ...rest] = normalized.split('/');
    return `file://${encodeURIComponent(host)}/${rest.map(encodeURIComponent).join('/')}`;
  }

  if (isWindowsAbsPath(raw)) {
    const normalized = raw.replace(/\\/g, '/');
    const [drive, rest] = [normalized.slice(0, 2), normalized.slice(2)];
    const driveUpper = drive.toUpperCase();
    return `file:///${driveUpper}${rest.split('/').map(encodeURIComponent).join('/')}`;
  }

  const normalized = raw.replace(/\\/g, '/');
  return `file://${normalized.startsWith('/') ? '' : '/'}${normalized.split('/').map(encodeURIComponent).join('/')}`;
}

export function toLspPositionFromMonaco(pos) {
  return {
    line: Math.max(0, Number(pos?.lineNumber || 1) - 1),
    character: Math.max(0, Number(pos?.column || 1) - 1),
  };
}

export function toLspRangeFromMonacoRange(range) {
  return {
    start: { line: Math.max(0, Number(range?.startLineNumber || 1) - 1), character: Math.max(0, Number(range?.startColumn || 1) - 1) },
    end: { line: Math.max(0, Number(range?.endLineNumber || 1) - 1), character: Math.max(0, Number(range?.endColumn || 1) - 1) },
  };
}

export function inferLanguageIdFromPath(filePath) {
  const p = String(filePath || '').toLowerCase();
  if (p.endsWith('.ts') || p.endsWith('.tsx')) return 'typescript';
  if (p.endsWith('.js') || p.endsWith('.jsx')) return 'javascript';
  if (p.endsWith('.json')) return 'json';
  if (p.endsWith('.py')) return 'python';
  if (p.endsWith('.rs')) return 'rust';
  return 'plaintext';
}

export function resolveFsPath(rootFsPath, modelPath) {
  const root = String(rootFsPath || '').trim();
  const rel = String(modelPath || '').replace(/^\//, '').replace(/^\\/, '');
  if (!root) return rel;
  const sep = root.includes('\\') || /^[a-zA-Z]:\\/.test(root) ? '\\' : '/';
  const left = root.replace(/[\\/]+$/, '');
  const right = rel.replace(/^[\\/]+/, '');
  return `${left}${sep}${right}`;
}


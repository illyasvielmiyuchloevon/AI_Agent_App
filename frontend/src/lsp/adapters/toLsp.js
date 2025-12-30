const isWindowsAbsPath = (p) => /^[a-zA-Z]:[\\/]/.test(String(p || ''));
const isUncPath = (p) => /^\\\\/.test(String(p || ''));
const looksLikeFileUri = (s) => /^file:/i.test(String(s || '').trim());

const fileUriToFsPath = (uri, { windowsHint = false } = {}) => {
  const raw = String(uri || '').trim();
  if (!looksLikeFileUri(raw)) return '';
  try {
    const u = new URL(raw);
    if (u.protocol !== 'file:') return '';
    const pathname = decodeURIComponent(u.pathname || '');
    const hostname = u.hostname ? decodeURIComponent(u.hostname) : '';
    const looksWindowsDrive = /^[a-zA-Z]:/.test(pathname.replace(/^\//, ''));
    const windows = !!(windowsHint || hostname || looksWindowsDrive);

    if (windows) {
      if (hostname) return `\\\\${hostname}${pathname.replace(/\//g, '\\')}`;
      return pathname.replace(/^\//, '').replace(/\//g, '\\');
    }
    return pathname;
  } catch {
    return '';
  }
};

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
  const raw = String(modelPath || '').trim();
  if (!raw) return '';

  const windows = root.includes('\\') || /^[a-zA-Z]:\\/.test(root) || /^\\\\/.test(root);
  if (looksLikeFileUri(raw)) {
    const fsPath = fileUriToFsPath(raw, { windowsHint: windows });
    if (fsPath) return fsPath;
  }

  if (isUncPath(raw) || isWindowsAbsPath(raw)) return raw;

  const rel = raw.replace(/^\//, '').replace(/^\\/, '');
  if (!root) return rel;
  const sep = windows ? '\\' : '/';
  const left = root.replace(/[\\/]+$/, '');
  const right = rel.replace(/^[\\/]+/, '');
  return `${left}${sep}${right}`;
}

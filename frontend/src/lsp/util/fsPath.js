export const guessIsWindows = (rootFsPath) => {
  const s = String(rootFsPath || '');
  return /^[a-zA-Z]:[\\/]/.test(s) || s.startsWith('\\\\') || s.includes('\\');
};

export const fileUriToFsPath = (uri, { windows = false } = {}) => {
  const s = String(uri || '');
  if (!s.startsWith('file:')) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'file:') return '';
    const hostname = u.hostname ? decodeURIComponent(u.hostname) : '';
    const pathname = decodeURIComponent(u.pathname || '');
    if (windows) {
      if (hostname) return `\\\\${hostname}${pathname.replace(/\//g, '\\')}`;
      return pathname.replace(/^\//, '').replace(/\//g, '\\');
    }
    return pathname;
  } catch {
    return '';
  }
};

export const toWorkspaceRelativePath = (fsPath, rootFsPath) => {
  const root = String(rootFsPath || '').trim();
  const full = String(fsPath || '').trim();
  if (!root || !full) return '';

  const windows = guessIsWindows(rootFsPath);
  const norm = (p) => (windows ? p.replace(/\//g, '\\') : p.replace(/\\/g, '/'));
  const a = norm(root).replace(/[\\/]+$/, '');
  const b = norm(full);

  if (windows) {
    const lowerA = a.toLowerCase();
    const lowerB = b.toLowerCase();
    if (!lowerB.startsWith(lowerA)) return '';
    const boundary = b.charAt(a.length);
    if (boundary && boundary !== '\\' && boundary !== '/') return '';
    const rest = b.slice(a.length).replace(/^[\\/]+/, '');
    return rest.replace(/\\/g, '/');
  }

  if (!b.startsWith(a)) return '';
  const boundary = b.charAt(a.length);
  if (boundary && boundary !== '/') return '';
  const rest = b.slice(a.length).replace(/^[\\/]+/, '');
  return rest;
};


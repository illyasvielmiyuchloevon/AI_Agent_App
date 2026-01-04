export const guessIsWindows = (rootFsPath) => {
  const s = String(rootFsPath || '');
  return /^[a-zA-Z]:[\\/]/.test(s) || s.startsWith('\\\\') || s.includes('\\');
};

export const fileUriToFsPath = (uri, { windows = false } = {}) => {
  const s = String(uri || '').trim();
  if (!/^file:/i.test(s)) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'file:') return '';
    const hostnameRaw = u.hostname ? decodeURIComponent(u.hostname) : '';
    const pathnameRaw = decodeURIComponent(u.pathname || '');
    if (windows) {
      const hostname = hostnameRaw.toLowerCase();
      const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
      const hostLooksDrive = /^[a-zA-Z]:$/.test(hostnameRaw);
      const pathLooksDrive = /^\/[a-zA-Z]:[\\/]/.test(pathnameRaw) || /^[a-zA-Z]:[\\/]/.test(pathnameRaw);

      if (hostLooksDrive) {
        const drive = hostnameRaw.toUpperCase();
        const rest = pathnameRaw.replace(/\//g, '\\');
        return `${drive}${rest}`;
      }

      if (hostnameRaw && !isLocalhost && !pathLooksDrive) {
        return `\\\\${hostnameRaw}${pathnameRaw.replace(/\//g, '\\')}`;
      }

      const withoutLeadingSlash = /^\/[a-zA-Z]:[\\/]/.test(pathnameRaw) ? pathnameRaw.slice(1) : pathnameRaw;
      return withoutLeadingSlash.replace(/\//g, '\\');
    }
    return pathnameRaw;
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

export const fileUriToWorkspaceRelativePath = (uri, rootFsPath) => {
  const u = String(uri || '').trim();
  if (!/^file:\/\//i.test(u)) return '';
  const root = String(rootFsPath || '').trim();
  if (!root) return '';

  const windows = guessIsWindows(root);
  const fsPath = fileUriToFsPath(u, { windows });
  const rel = fsPath ? toWorkspaceRelativePath(fsPath, root) : '';
  if (rel) return rel;

  if (!windows) return '';
  try {
    const parsed = new URL(u);
    const pathname = decodeURIComponent(parsed.pathname || '');
    if (!pathname) return '';
    if (/^\/[a-zA-Z]:[\\/]/.test(pathname) || /^[a-zA-Z]:[\\/]/.test(pathname)) return '';
    return pathname.replace(/^\/+/, '').replace(/\\/g, '/').trim();
  } catch {
    return '';
  }
};

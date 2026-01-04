const isAbsolutePath = (p = '') => {
  const s = String(p || '').trim();
  if (!s) return false;
  return /^[a-zA-Z]:[\\/]/.test(s) || s.startsWith('\\\\') || s.startsWith('/');
};

const normalizeRelPath = (p = '') => {
  const raw = String(p || '').replace(/\\/g, '/');
  // Remove leading "./" segments but keep dotfolders like ".trae" or ".git"
  const withoutDotSlash = raw.replace(/^(?:\.\/)+/, '');
  return withoutDotSlash.replace(/^\/+/, '');
};

const denyEscapes = (p) => {
  const path = normalizeRelPath(p);
  if (!path) return '.';
  if (path.includes('..')) throw new Error('禁止使用相对上级目录');
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) throw new Error('仅允许工作区内的相对路径');
  return path;
};

const basename = (abs = '') => {
  const s = String(abs || '').replace(/[\\\/]+$/, '');
  const idx1 = s.lastIndexOf('/');
  const idx2 = s.lastIndexOf('\\');
  const idx = Math.max(idx1, idx2);
  return idx >= 0 ? s.slice(idx + 1) : s;
};

const resolveBackendUrl = (url) => {
  const u = String(url || '');
  if (!u.startsWith('/')) return u;
  if (typeof window === 'undefined') return u;
  const proto = window.location?.protocol;
  const origin = window.location?.origin;
  if (proto === 'file:' || origin === 'null') {
    const rewritten = u.startsWith('/api') ? u.replace(/^\/api/, '') : u;
    return `http://127.0.0.1:8000${rewritten || '/'}`;
  }
  return u;
};

async function readJsonResponse(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export class BackendWorkspaceDriver {
  constructor(rootFsPath, meta = {}) {
  const root = String(rootFsPath || '').trim();
  if (!isAbsolutePath(root)) throw new Error('BackendWorkspaceDriver requires an absolute root path');
  this.rootFsPath = root;
  this.rootName = meta.rootName || basename(root) || 'workspace';
  this.projectId = meta.id || root;
  this.pathLabel = meta.pathLabel || root;
  this.workspaceId = meta.workspaceId || '';
  this.workspaceRoots = Array.isArray(meta.workspaceRoots) ? meta.workspaceRoots : [];
  this.fileOpsHooks = meta.fileOpsHooks && typeof meta.fileOpsHooks === 'object' ? meta.fileOpsHooks : null;
  }

  static isAvailable() {
    return typeof fetch === 'function';
  }

  static async fromFsPath(rootFsPath, meta = {}) {
    return new BackendWorkspaceDriver(rootFsPath, {
      id: meta.id || String(rootFsPath || '').trim(),
      rootName: meta.rootName,
      pathLabel: meta.pathLabel,
      workspaceId: meta.workspaceId,
      workspaceRoots: meta.workspaceRoots,
      fileOpsHooks: meta.fileOpsHooks,
    });
  }

  setFileOperationsHooks(hooks) {
    this.fileOpsHooks = hooks && typeof hooks === 'object' ? hooks : null;
  }

  _headers(extra = {}) {
    let workspaceId = this.workspaceId || '';
    if (!workspaceId) {
      try {
        if (typeof window !== 'undefined' && window.__NODE_AGENT_WORKSPACE_ID__) {
          workspaceId = String(window.__NODE_AGENT_WORKSPACE_ID__ || '').trim();
        }
      } catch {}
    }
    const base = {};
    if (workspaceId) {
      base['X-Workspace-Id'] = workspaceId;
    }
    base['X-Workspace-Root'] = this.rootFsPath;
    return { ...base, ...extra };
  }

  async _getJson(url) {
    const res = await fetch(resolveBackendUrl(url), { method: 'GET', headers: this._headers() });
    const data = await readJsonResponse(res);
    if (!res.ok) throw new Error(data?.detail || res.statusText || 'Request failed');
    return data;
  }

  async _postJson(url, body) {
    const res = await fetch(resolveBackendUrl(url), {
      method: 'POST',
      headers: this._headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body || {}),
    });
    const data = await readJsonResponse(res);
    if (!res.ok) throw new Error(data?.detail || res.statusText || 'Request failed');
    return data;
  }

  async readFile(path, options = {}) {
    const safe = denyEscapes(path);
    const allowMissing = !!options?.allowMissing;
    const qs = new URLSearchParams();
    qs.set('path', safe);
    if (allowMissing) qs.set('allow_missing', '1');
    const data = await this._getJson(`/api/workspace/read?${qs.toString()}`);
    return {
      path: safe,
      content: String(data?.content ?? ''),
      truncated: !!data?.truncated,
      exists: data?.exists !== false,
    };
  }

  async writeFile(path, content, { createDirectories = false, notifyCreate = true } = {}) {
    const safe = denyEscapes(path);
    const hooks = this.fileOpsHooks;
    const wantNotify = !!hooks && typeof hooks === 'object';
    const wantCreateNotify = !!notifyCreate && wantNotify && (typeof hooks.willCreateFiles === 'function' || typeof hooks.didCreateFiles === 'function');
    let existed = true;
    if (wantCreateNotify) {
      try {
        const res = await this.readFile(safe, { allowMissing: true });
        existed = res?.exists !== false;
      } catch {
        existed = true;
      }
    }
    const shouldNotifyCreate = wantCreateNotify && !existed;
    if (shouldNotifyCreate && typeof hooks.willCreateFiles === 'function') {
      try { await hooks.willCreateFiles([safe]); } catch {}
    }
    await this._postJson('/api/workspace/write', {
      path: safe,
      content: String(content ?? ''),
      create_directories: !!createDirectories,
    });
    if (shouldNotifyCreate && typeof hooks.didCreateFiles === 'function') {
      try { await hooks.didCreateFiles([safe]); } catch {}
    }
    return true;
  }

  async createFolder(path, { notifyCreate = true } = {}) {
    const safe = denyEscapes(path);
    const hooks = this.fileOpsHooks;
    if (notifyCreate && hooks && typeof hooks === 'object' && typeof hooks.willCreateFiles === 'function') {
      try { await hooks.willCreateFiles([safe]); } catch {}
    }
    await this._postJson('/api/workspace/mkdir', { path: safe, recursive: true });
    if (notifyCreate && hooks && typeof hooks === 'object' && typeof hooks.didCreateFiles === 'function') {
      try { await hooks.didCreateFiles([safe]); } catch {}
    }
    return true;
  }

  async deletePath(path, { notify = true } = {}) {
    const safe = denyEscapes(path);
    const hooks = this.fileOpsHooks;
    if (notify && hooks && typeof hooks === 'object' && typeof hooks.willDeleteFiles === 'function') {
      try { await hooks.willDeleteFiles([safe]); } catch {}
    }
    await this._postJson('/api/workspace/delete', { path: safe, recursive: true });
    if (notify && hooks && typeof hooks === 'object' && typeof hooks.didDeleteFiles === 'function') {
      try { await hooks.didDeleteFiles([safe]); } catch {}
    }
    return true;
  }

  async renamePath(oldPath, newPath, { notify = true } = {}) {
    const from = denyEscapes(oldPath);
    const to = denyEscapes(newPath);
    const hooks = this.fileOpsHooks;
    if (notify && hooks && typeof hooks === 'object' && typeof hooks.willRenameFiles === 'function') {
      try { await hooks.willRenameFiles([{ from, to }]); } catch {}
    }
    await this._postJson('/api/workspace/rename', { from, to });
    if (notify && hooks && typeof hooks === 'object' && typeof hooks.didRenameFiles === 'function') {
      try { await hooks.didRenameFiles([{ from, to }]); } catch {}
    }
    return true;
  }

  async getStructure({ includeContent = false } = {}) {
    const structure = await this._getJson('/api/workspace/structure');
    const entries = Array.isArray(structure?.entries) ? structure.entries : [];
    const roots = Array.isArray(structure?.roots) ? structure.roots : [];
    const files = [];
    if (includeContent) {
      const fileEntries = entries.filter((e) => e && e.type === 'file' && typeof e.path === 'string');
      for (const entry of fileEntries) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const data = await this.readFile(entry.path);
          files.push(data);
        } catch {
          // Ignore missing/unreadable files (dotfolders, races, permissions, etc.)
        }
      }
    }
    return {
      root: structure?.root || this.rootName,
      roots,
      entries,
      files,
      entry_candidates: Array.isArray(structure?.entry_candidates) ? structure.entry_candidates : [],
    };
  }

  async updatePathLabel(label) {
    this.pathLabel = String(label || '').trim() || this.pathLabel;
    return true;
  }

  async search(query, options = {}) {
    const { caseSensitive = false, isRegex = false } = options;
    const data = await this._postJson('/api/workspace/search', { 
        query,
        case_sensitive: caseSensitive,
        regex: isRegex
    });
    if (data.status === 'error') throw new Error(data.message);
    const results = (data.results || []).map(r => ({
        path: r.file,
        line: r.line,
        preview: r.context ? r.context.trim() : ''
    }));
    return { query, results };
  }

  async touchRecent() {
    return null;
  }
}

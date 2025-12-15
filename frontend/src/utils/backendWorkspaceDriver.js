const isAbsolutePath = (p = '') => {
  const s = String(p || '').trim();
  if (!s) return false;
  return /^[a-zA-Z]:[\\/]/.test(s) || s.startsWith('\\\\') || s.startsWith('/');
};

const normalizeRelPath = (p = '') => String(p || '').replace(/^[./\\]+/, '').replace(/\\/g, '/');

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
  }

  static isAvailable() {
    return typeof fetch === 'function';
  }

  static async fromFsPath(rootFsPath) {
    return new BackendWorkspaceDriver(rootFsPath, { id: String(rootFsPath || '').trim() });
  }

  _headers(extra = {}) {
    return { 'X-Workspace-Root': this.rootFsPath, ...extra };
  }

  async _getJson(url) {
    const res = await fetch(url, { method: 'GET', headers: this._headers() });
    const data = await readJsonResponse(res);
    if (!res.ok) throw new Error(data?.detail || res.statusText || 'Request failed');
    return data;
  }

  async _postJson(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: this._headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body || {}),
    });
    const data = await readJsonResponse(res);
    if (!res.ok) throw new Error(data?.detail || res.statusText || 'Request failed');
    return data;
  }

  async readFile(path) {
    const safe = denyEscapes(path);
    const data = await this._getJson(`/api/workspace/read?path=${encodeURIComponent(safe)}`);
    return { path: safe, content: String(data?.content ?? ''), truncated: !!data?.truncated };
  }

  async writeFile(path, content, { createDirectories = false } = {}) {
    const safe = denyEscapes(path);
    await this._postJson('/api/workspace/write', {
      path: safe,
      content: String(content ?? ''),
      create_directories: !!createDirectories,
    });
    return true;
  }

  async createFolder(path) {
    const safe = denyEscapes(path);
    await this._postJson('/api/workspace/mkdir', { path: safe, recursive: true });
    return true;
  }

  async deletePath(path) {
    const safe = denyEscapes(path);
    await this._postJson('/api/workspace/delete', { path: safe, recursive: true });
    return true;
  }

  async renamePath(oldPath, newPath) {
    const from = denyEscapes(oldPath);
    const to = denyEscapes(newPath);
    await this._postJson('/api/workspace/rename', { from, to });
    return true;
  }

  async getStructure({ includeContent = false } = {}) {
    const structure = await this._getJson('/api/workspace/structure');
    const entries = Array.isArray(structure?.entries) ? structure.entries : [];
    const files = [];
    if (includeContent) {
      const fileEntries = entries.filter((e) => e && e.type === 'file' && typeof e.path === 'string');
      for (const entry of fileEntries) {
        // eslint-disable-next-line no-await-in-loop
        const data = await this.readFile(entry.path);
        files.push(data);
      }
    }
    return {
      root: structure?.root || this.rootName,
      entries,
      files,
      entry_candidates: Array.isArray(structure?.entry_candidates) ? structure.entry_candidates : [],
    };
  }

  async updatePathLabel(label) {
    this.pathLabel = String(label || '').trim() || this.pathLabel;
    return true;
  }

  async touchRecent() {
    return null;
  }
}


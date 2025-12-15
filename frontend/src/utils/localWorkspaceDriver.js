import { get, set, del } from 'idb-keyval';

const REGISTRY_KEY = 'ai_agent_project_registry_v1';
const LAST_PROJECT_KEY = 'ai_agent_last_project_id';

const createId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `proj-${Date.now()}-${Math.random().toString(16).slice(2)}`);

const loadRegistry = async () => (await get(REGISTRY_KEY)) || [];
const saveRegistry = async (registry) => set(REGISTRY_KEY, registry);

const removeRegistryEntry = async (id) => {
  if (!id) return;
  const registry = await loadRegistry();
  const next = registry.filter((entry) => entry && entry.id !== id);
  await saveRegistry(next);
  const last = await get(LAST_PROJECT_KEY);
  if (last === id) {
    await del(LAST_PROJECT_KEY);
  }
};

const persistHandleToRegistry = async (handle, meta = {}) => {
  const registry = await loadRegistry();
  let existing = null;
  for (const entry of registry) {
    if (!entry?.handle) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      if (await handle.isSameEntry(entry.handle)) {
        existing = entry;
        break;
      }
    } catch {
      /* ignore broken handles */
    }
  }
  const id = existing?.id || createId();
  const entry = {
    id,
    name: handle.name,
    handle,
    lastOpened: Date.now(),
    pathLabel: meta.pathLabel || existing?.pathLabel || handle.name || '',
  };
  const next = [entry, ...registry.filter((r) => r && r.id !== id)].slice(0, 10);
  await saveRegistry(next);
  await set(LAST_PROJECT_KEY, id);
  return entry;
};

const updateRegistryEntry = async (id, updater) => {
  const registry = await loadRegistry();
  const next = registry.map((entry) => {
    if (!entry || entry.id !== id) return entry;
    return typeof updater === 'function' ? updater(entry) : { ...entry, ...updater };
  });
  await saveRegistry(next);
  return next.find((r) => r && r.id === id);
};

const listRecentProjects = async () => {
  const registry = await loadRegistry();
  return registry
    .filter(Boolean)
    .sort((a, b) => (b?.lastOpened || 0) - (a?.lastOpened || 0))
    .slice(0, 10)
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      pathLabel: entry.pathLabel || '',
      lastOpened: entry.lastOpened,
    }));
};

const denyEscapes = (path) => {
  if (!path) return '.';
  if (path.includes('..')) {
    throw new Error('禁止使用相对上级目录');
  }
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    throw new Error('仅允许工作区内的相对路径');
  }
  return path.replace(/^\.\/+/, '').replace(/\\/g, '/');
};

const ensurePermission = async (handle, { allowPrompt = true } = {}) => {
  if (!handle) return false;
  const status = await handle.queryPermission({ mode: 'readwrite' });
  if (status === 'granted') return true;
  if (status === 'prompt' && allowPrompt) {
    const res = await handle.requestPermission({ mode: 'readwrite' });
    return res === 'granted';
  }
  return false;
};

const parseGitignore = (raw) => {
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.replace(/^\.\//, '').replace(/\/+$/, ''));
};

const isIgnored = (path, rules) => {
  if (!rules?.length) return false;
  return rules.some((rule) => path === rule || path.startsWith(`${rule}/`));
};

const entryCandidates = (files = []) => {
  const priority = [
    'index.html',
    'public/index.html',
    'src/index.html',
    'main.html',
    'main.py',
    'app.py',
    'server.py',
    'app.jsx',
    'app.tsx',
    'src/App.jsx',
    'src/main.jsx',
    'src/main.tsx',
  ];
  const lower = new Map(files.map((f) => [f.toLowerCase(), f]));
  const picks = [];
  priority.forEach((target) => {
    const hit = lower.get(target.toLowerCase());
    if (hit && !picks.includes(hit)) picks.push(hit);
  });
  if (!picks.length && files.length) picks.push(files[0]);
  return picks;
};

export class LocalWorkspaceDriver {
  constructor(rootHandle, meta = {}) {
    this.rootHandle = rootHandle;
    this.rootName = rootHandle?.name || 'workspace';
    this.projectId = meta.id || null;
    this.pathLabel = meta.pathLabel || rootHandle?.name || '';
    this.handleMap = new Map([['', rootHandle]]);
    this.gitignore = [];
  }

  static async fromPersisted(projectId = null, { allowPrompt = true } = {}) {
    if (typeof window === 'undefined') return null;
    try {
      const registry = (await loadRegistry()).filter(Boolean).sort((a, b) => (b?.lastOpened || 0) - (a?.lastOpened || 0));
      const lastId = projectId || (await get(LAST_PROJECT_KEY));
      let candidate = lastId ? registry.find((r) => r.id === lastId) : registry[0];
      if (!candidate && registry.length) {
        candidate = registry[0];
      }
      if (!candidate?.handle) return null;
      const ok = await ensurePermission(candidate.handle, { allowPrompt });
      if (!ok) {
        const remaining = registry.filter((r) => r.id !== candidate.id);
        await saveRegistry(remaining);
        return null;
      }
      const driver = new LocalWorkspaceDriver(candidate.handle, candidate);
      await driver._loadGitignore();
      return driver;
    } catch {
      return null;
    }
  }

  static async pickFolder() {
    if (typeof window === 'undefined' || !window.showDirectoryPicker) {
      throw new Error('当前浏览器不支持 File System Access API');
    }
    const handle = await window.showDirectoryPicker({ id: 'ai-agent-workspace' });
    const ok = await ensurePermission(handle, { allowPrompt: true });
    if (!ok) {
      throw new Error('未授予读写权限，无法绑定工作区');
    }
    const driver = new LocalWorkspaceDriver(handle, { id: null, pathLabel: handle?.name || 'workspace' });
    await driver._loadGitignore();
    return driver;
  }

  static async listRecent() {
    return listRecentProjects();
  }

  static async removeRecent(projectId) {
    await removeRegistryEntry(projectId);
    return true;
  }

  async touchRecent({ pathLabel } = {}) {
    if (!this.rootHandle) return null;

    const nextPathLabel = (pathLabel || this.pathLabel || this.rootName || '').trim();

    if (!this.projectId) {
      const entry = await persistHandleToRegistry(this.rootHandle, { pathLabel: nextPathLabel });
      this.projectId = entry.id || this.projectId;
      this.pathLabel = entry.pathLabel || this.pathLabel;
      return entry;
    }

    const updated = await updateRegistryEntry(this.projectId, (prev) => ({
      ...prev,
      pathLabel: nextPathLabel || prev?.pathLabel || '',
      lastOpened: Date.now(),
    }));
    await set(LAST_PROJECT_KEY, this.projectId);
    return updated;
  }

  async _loadGitignore() {
    try {
      const fileHandle = await this.rootHandle.getFileHandle('.gitignore');
      const file = await fileHandle.getFile();
      const text = await file.text();
      this.gitignore = parseGitignore(text);
    } catch {
      this.gitignore = [];
    }
  }

  async ensureTree(path, { create = true } = {}) {
    const safe = denyEscapes(path);
    const parts = safe === '.' ? [] : safe.split('/').filter(Boolean);
    let cursor = this.rootHandle;
    let currentPath = '';
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const cacheKey = `${currentPath}/`;
      if (this.handleMap.has(cacheKey)) {
        cursor = this.handleMap.get(cacheKey);
        continue;
      }
      cursor = await cursor.getDirectoryHandle(part, { create });
      this.handleMap.set(cacheKey, cursor);
    }
    return cursor;
  }

  async getFileHandle(path, { create = false } = {}) {
    const safe = denyEscapes(path);
    const parts = safe.split('/').filter(Boolean);
    const fileName = parts.pop();
    const dirPath = parts.join('/');
    const dirHandle = await this.ensureTree(dirPath, { create });
    const fileHandle = await dirHandle.getFileHandle(fileName, { create });
    this.handleMap.set(safe, fileHandle);
    return fileHandle;
  }

  async readFile(path) {
    const fileHandle = await this.getFileHandle(path, { create: false });
    const file = await fileHandle.getFile();
    const text = await file.text();
    return { path: denyEscapes(path), content: text, truncated: false };
  }

  async writeFile(path, content, { createDirectories = true } = {}) {
    const fileHandle = await this.getFileHandle(path, { create: createDirectories });
    const writable = await fileHandle.createWritable();
    await writable.write(content || '');
    await writable.close();
    return { path: denyEscapes(path), bytes: (content || '').length };
  }

  async createFolder(path) {
    await this.ensureTree(path, { create: true });
    return { path: denyEscapes(path), created: true };
  }

  async deletePath(path) {
    const safe = denyEscapes(path);
    const parts = safe.split('/').filter(Boolean);
    const name = parts.pop();
    const dirHandle = await this.ensureTree(parts.join('/'), { create: false });
    await dirHandle.removeEntry(name, { recursive: true });
    this.handleMap.delete(safe);
    return { path: safe, deleted: true };
  }

  async renamePath(oldPath, newPath) {
    const oldSafe = denyEscapes(oldPath);
    const newSafe = denyEscapes(newPath);
    const oldHandle = await this.getFileHandle(oldSafe, { create: false }).catch(() => null);
    const isFile = !!oldHandle;
    if (isFile) {
      const file = await oldHandle.getFile();
      const content = await file.text();
      await this.writeFile(newSafe, content, { createDirectories: true });
      await this.deletePath(oldSafe);
      return { from: oldSafe, to: newSafe, migrated: true };
    }
    // Fallback for directories: shallow copy by recreating tree
    await this._copyDirectory(oldSafe, newSafe);
    await this.deletePath(oldSafe);
    return { from: oldSafe, to: newSafe, migrated: true };
  }

  async _copyDirectory(fromPath, toPath) {
    const safeFrom = denyEscapes(fromPath);
    const safeTo = denyEscapes(toPath);
    const fromHandle = await this.ensureTree(safeFrom, { create: false });
    const stack = [{ dir: fromHandle, rel: '' }];
    while (stack.length) {
      const { dir, rel } = stack.pop();
      for await (const entry of dir.values()) {
        const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.kind === 'directory') {
          await this.ensureTree(`${safeTo}/${nextRel}`, { create: true });
          stack.push({ dir: entry, rel: nextRel });
        } else {
          const file = await entry.getFile();
          const text = await file.text();
          await this.writeFile(`${safeTo}/${nextRel}`, text, { createDirectories: true });
        }
      }
    }
  }

  async listFiles(base = '.') {
    const safeBase = denyEscapes(base);
    const dirHandle = await this.ensureTree(safeBase, { create: false });
    const entries = [];
    const stack = [{ handle: dirHandle, rel: safeBase === '.' ? '' : safeBase }];
    while (stack.length) {
      const { handle, rel } = stack.pop();
      for await (const entry of handle.values()) {
        const path = rel ? `${rel}/${entry.name}` : entry.name;
        if (isIgnored(path, this.gitignore)) continue;
        if (entry.kind === 'directory') {
          entries.push({ path, type: 'dir' });
          stack.push({ handle: entry, rel: path });
        } else {
          const file = await entry.getFile();
          entries.push({ path, type: 'file', size: file.size });
        }
      }
    }
    entries.sort((a, b) => a.path.localeCompare(b.path));
    return entries;
  }

  async search(query, path = '.') {
    if (!query) throw new Error('缺少搜索关键字');
    const entries = await this.listFiles(path);
    const results = [];
    for (const entry of entries) {
      if (entry.type !== 'file') continue;
      const { content } = await this.readFile(entry.path);
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (line.toLowerCase().includes(query.toLowerCase())) {
          results.push({ path: entry.path, line: idx + 1, preview: line.trim() });
        }
      });
      if (results.length > 200) return { query, results };
    }
    return { query, results };
  }

  async getStructure({ includeContent = false } = {}) {
    await this._loadGitignore();
    const entries = await this.listFiles('.');
    const files = [];
    if (includeContent) {
      for (const entry of entries) {
        if (entry.type !== 'file') continue;
        const content = await this.readFile(entry.path);
        files.push(content);
      }
    }
    const flatFiles = entries.filter((e) => e.type === 'file').map((e) => e.path);
    return {
      root: this.rootName,
      entries,
      files,
      entry_candidates: entryCandidates(flatFiles),
    };
  }

  async updatePathLabel(label) {
    if (!this.projectId) return;
    this.pathLabel = label || this.pathLabel;
    await updateRegistryEntry(this.projectId, { pathLabel: this.pathLabel, lastOpened: Date.now() });
  }
}

export const clearPersistedWorkspace = async () => {
  await del(REGISTRY_KEY);
  await del(LAST_PROJECT_KEY);
};

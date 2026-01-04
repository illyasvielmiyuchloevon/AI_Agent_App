const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const REGISTRY_VERSION = 1;

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function atomicWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const tmp = `${filePath}.tmp.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, filePath);
}

function normalizeExtensionId(id) {
  const s = String(id || '').trim();
  if (!s) return '';
  const lower = s.toLowerCase();
  const parts = lower.split('.').filter(Boolean);
  if (parts.length < 2) return '';
  return `${parts[0]}.${parts.slice(1).join('.')}`;
}

class VscodeExtensionRegistry {
  constructor({ registryPath, logger } = {}) {
    this.registryPath = String(registryPath || '').trim();
    this.logger = logger;
    this.state = { version: REGISTRY_VERSION, extensions: {} };
  }

  async load() {
    if (!this.registryPath) throw new Error('VscodeExtensionRegistry.registryPath is required');
    const data = await readJson(this.registryPath, null);
    if (!data || typeof data !== 'object') return this.state;
    const version = Number(data.version || REGISTRY_VERSION);
    const extensions = (data.extensions && typeof data.extensions === 'object') ? data.extensions : {};
    this.state = { version, extensions };
    return this.state;
  }

  getSnapshot() {
    return this.state;
  }

  getExtension(id) {
    const key = normalizeExtensionId(id);
    return this.state.extensions[key] || null;
  }

  listExtensions() {
    return Object.values(this.state.extensions || {});
  }

  async upsertExtension(record) {
    const id = normalizeExtensionId(record?.id);
    if (!id) throw new Error('registry upsert requires record.id');
    const next = { ...(this.state.extensions[id] || {}), ...(record || {}), id };
    this.state.extensions[id] = next;
    await this.save();
    return next;
  }

  async removeExtension(id) {
    const key = normalizeExtensionId(id);
    if (!key) return;
    delete this.state.extensions[key];
    await this.save();
  }

  async save() {
    if (!this.registryPath) return;
    try {
      await atomicWriteJson(this.registryPath, this.state);
    } catch (err) {
      this.logger?.error?.('vscode extension registry save failed', { error: err?.message || String(err) });
      try {
        fs.mkdirSync(path.dirname(this.registryPath), { recursive: true });
        fs.writeFileSync(this.registryPath, JSON.stringify(this.state, null, 2), 'utf8');
      } catch {
      }
    }
  }
}

module.exports = { VscodeExtensionRegistry, normalizeExtensionId };

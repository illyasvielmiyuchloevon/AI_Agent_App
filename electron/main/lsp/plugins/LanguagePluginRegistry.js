const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { REGISTRY_VERSION, normalizePluginId } = require('./types');

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

class LanguagePluginRegistry {
  constructor({ registryPath, logger } = {}) {
    this.registryPath = String(registryPath || '').trim();
    this.logger = logger;
    this.state = { version: REGISTRY_VERSION, plugins: {} };
  }

  async load() {
    if (!this.registryPath) throw new Error('LanguagePluginRegistry.registryPath is required');
    const data = await readJson(this.registryPath, null);
    if (!data || typeof data !== 'object') return this.state;
    const version = Number(data.version || REGISTRY_VERSION);
    const plugins = (data.plugins && typeof data.plugins === 'object') ? data.plugins : {};
    this.state = { version, plugins };
    return this.state;
  }

  getSnapshot() {
    return this.state;
  }

  getPlugin(id) {
    const key = normalizePluginId(id);
    return this.state.plugins[key] || null;
  }

  listPlugins() {
    return Object.values(this.state.plugins || {});
  }

  async upsertPlugin(record) {
    const id = normalizePluginId(record?.id);
    if (!id) throw new Error('registry upsert requires record.id');
    const next = { ...(this.state.plugins[id] || {}), ...(record || {}), id };
    this.state.plugins[id] = next;
    await this.save();
    return next;
  }

  async removePlugin(id) {
    const key = normalizePluginId(id);
    if (!key) return;
    delete this.state.plugins[key];
    await this.save();
  }

  async save() {
    if (!this.registryPath) return;
    try {
      await atomicWriteJson(this.registryPath, this.state);
    } catch (err) {
      this.logger?.error?.('plugin registry save failed', { error: err?.message || String(err) });
      try {
        fs.mkdirSync(path.dirname(this.registryPath), { recursive: true });
        fs.writeFileSync(this.registryPath, JSON.stringify(this.state, null, 2), 'utf8');
      } catch {
        // ignore
      }
    }
  }
}

module.exports = { LanguagePluginRegistry };


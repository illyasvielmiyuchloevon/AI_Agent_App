const path = require('node:path');
const fsp = require('node:fs/promises');

const { normalizeExtensionId } = require('./VscodeExtensionRegistry');
const { sanitizeManifestForRegistry } = require('./VscodeExtensionInstaller');
const semver = require('semver');
const { downloadWithResume } = require('../lsp/plugins/PluginInstaller');

async function rimraf(target) {
  const p = String(target || '').trim();
  if (!p) return;
  await fsp.rm(p, { recursive: true, force: true });
}

function pickString(v) {
  if (v == null) return '';
  return String(v).trim();
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`request failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (!json || typeof json !== 'object') throw new Error('invalid json');
  return json;
}

function pickBestVersion(versions) {
  const items = (Array.isArray(versions) ? versions : []).map((v) => String(v || '').trim()).filter(Boolean);
  if (!items.length) return '';
  const valid = items.filter((v) => semver.valid(v));
  if (valid.length) return valid.sort(semver.rcompare)[0];
  return items.sort((a, b) => b.localeCompare(a))[0];
}

function normalizeOpenVsxSearchItems(json) {
  const raw = Array.isArray(json?.extensions) ? json.extensions : (Array.isArray(json?.items) ? json.items : []);
  return raw.map((it) => {
    const src = it && typeof it === 'object' ? it : {};
    const namespace = pickString(src.namespace || src.publisher || src.author || src.owner);
    const name = pickString(src.name);
    const version = pickString(src.version || src.latestVersion);
    const id = namespace && name ? `${namespace}.${name}`.toLowerCase() : '';
    return {
      type: 'vscode',
      id,
      name,
      publisher: namespace,
      version,
      description: pickString(src.description),
      source: {
        providerId: 'openvsx',
        namespace,
        name,
        version,
        url: pickString(src.url) || (namespace && name ? `https://open-vsx.org/extension/${namespace}/${name}` : ''),
      },
    };
  }).filter((x) => x.id && x.publisher && x.name);
}

class VscodeExtensionManager {
  constructor({ registry, installer, extensionsRootDir, logger } = {}) {
    this.registry = registry;
    this.installer = installer;
    this.extensionsRootDir = String(extensionsRootDir || '').trim();
    this.logger = logger;
  }

  async init() {
    if (!this.registry) throw new Error('VscodeExtensionManager.registry is required');
    if (!this.installer) throw new Error('VscodeExtensionManager.installer is required');
    await this.registry.load();
    return { ok: true };
  }

  listInstalled() {
    const items = Array.isArray(this.registry?.listExtensions?.()) ? this.registry.listExtensions() : [];
    const normalized = items.map((r) => ({
      id: pickString(r?.id),
      name: pickString(r?.name),
      publisher: pickString(r?.publisher),
      version: pickString(r?.version),
      enabled: !!r?.enabled,
      installDir: pickString(r?.installDir),
      source: r?.source && typeof r.source === 'object' ? r.source : undefined,
      installedAt: Number.isFinite(r?.installedAt) ? r.installedAt : undefined,
      updatedAt: Number.isFinite(r?.updatedAt) ? r.updatedAt : undefined,
      manifest: r?.manifest && typeof r.manifest === 'object' ? r.manifest : undefined,
      state: pickString(r?.state),
      lastError: r?.lastError && typeof r.lastError === 'object' ? r.lastError : undefined,
    })).filter((x) => x.id);
    normalized.sort((a, b) => a.id.localeCompare(b.id));
    return normalized;
  }

  async getDetail(id, { refreshManifest = true } = {}) {
    const key = normalizeExtensionId(id);
    if (!key) return { ok: false, error: 'invalid id' };
    const rec = this.registry.getExtension(key);
    if (!rec) return { ok: false, error: 'not installed' };
    if (refreshManifest) {
      const installDir = pickString(rec?.installDir);
      if (installDir) {
        const pkgPath = path.join(installDir, 'extension', 'package.json');
        try {
          const raw = await fsp.readFile(pkgPath, 'utf8');
          const json = JSON.parse(raw);
          const nextManifest = sanitizeManifestForRegistry(json);
          const curManifest = rec?.manifest && typeof rec.manifest === 'object' ? rec.manifest : null;
          const curStr = curManifest ? JSON.stringify(curManifest) : '';
          const nextStr = nextManifest ? JSON.stringify(nextManifest) : '';
          if (nextStr && nextStr !== curStr) {
            const updated = await this.registry.upsertExtension({ id: key, manifest: nextManifest });
            return { ok: true, item: updated };
          }
        } catch {}
      }
    }
    return { ok: true, item: rec };
  }

  async installFromVsixFile(filePath, { onProgress, source } = {}) {
    const res = await this.installer.installFromVsixFile(filePath, { onProgress });
    const existed = this.registry.getExtension(res.id);
    const enabled = existed ? !!existed.enabled : false;
    const now = Date.now();
    const record = await this.registry.upsertExtension({
      id: res.id,
      publisher: res.publisher,
      name: res.name,
      version: res.version,
      installDir: res.installDir,
      enabled,
      source: (source && typeof source === 'object') ? source : { providerId: 'local', filePath: String(filePath || '').trim() },
      installedAt: existed?.installedAt || now,
      updatedAt: now,
      manifest: res.manifest,
      state: enabled ? 'enabled' : 'installed',
      lastError: null,
    });
    return { ok: true, item: record, needsRestart: true };
  }

  async search({ query, providerIds, options } = {}) {
    const q = String(query || '').trim();
    if (!q) return [];
    const providers = Array.isArray(providerIds) ? providerIds.map((x) => String(x || '').trim()).filter(Boolean) : ['openvsx'];
    const offset = Number.isFinite(Number(options?.offset)) ? Math.max(0, Number(options.offset)) : 0;
    const limit = Number.isFinite(Number(options?.limit)) ? Math.max(1, Math.min(100, Number(options.limit))) : 50;

    const all = [];
    if (providers.includes('openvsx')) {
      const url = `https://open-vsx.org/api/-/search?query=${encodeURIComponent(q)}&offset=${offset}&size=${limit}`;
      const json = await fetchJson(url);
      all.push(...normalizeOpenVsxSearchItems(json));
    }
    all.sort((a, b) => a.id.localeCompare(b.id));
    return all;
  }

  async installFromOpenVsxRef({ namespace, name, version } = {}, { onProgress } = {}) {
    const ns = pickString(namespace);
    const nm = pickString(name);
    const desired = pickString(version);
    if (!ns || !nm) throw new Error('openvsx install requires namespace and name');

    const detailUrl = `https://open-vsx.org/api/${encodeURIComponent(ns)}/${encodeURIComponent(nm)}`;
    const detail = await fetchJson(detailUrl);

    const resolvedVersion = (() => {
      if (desired) return desired;
      const top = pickString(detail?.version || detail?.latestVersion);
      if (top) return top;
      const fromAll = detail?.allVersions && typeof detail.allVersions === 'object' ? Object.keys(detail.allVersions) : [];
      const best = pickBestVersion(fromAll);
      if (best) return best;
      const fromVersions = Array.isArray(detail?.versions) ? detail.versions.map((v) => v?.version) : [];
      return pickBestVersion(fromVersions);
    })();
    if (!resolvedVersion) throw new Error('openvsx version not found');

    const downloadUrl = (() => {
      const v = resolvedVersion;
      const all = detail?.allVersions && typeof detail.allVersions === 'object' ? detail.allVersions : null;
      const fromAll = all && typeof all[v] === 'string' ? all[v] : '';
      const files = detail?.files && typeof detail.files === 'object' ? detail.files : {};
      const fromFiles = pickString(files.download || files.vsix || files.package);
      if (fromAll) return fromAll;
      if (fromFiles) return fromFiles;
      return `https://open-vsx.org/api/${encodeURIComponent(ns)}/${encodeURIComponent(nm)}/${encodeURIComponent(v)}/file/${encodeURIComponent(`${ns}.${nm}-${v}.vsix`)}`;
    })();

    const downloadsDir = path.join(this.extensionsRootDir, 'downloads');
    const id = `${ns}.${nm}`.toLowerCase();
    const vsixPath = path.join(downloadsDir, `${id}-${resolvedVersion}.vsix`);

    onProgress?.({ stage: 'download', providerId: 'openvsx', id, version: resolvedVersion, url: downloadUrl });
    await downloadWithResume(downloadUrl, vsixPath, { onProgress, logger: this.logger });

    return await this.installFromVsixFile(vsixPath, {
      onProgress,
      source: { providerId: 'openvsx', namespace: ns, name: nm, version: resolvedVersion, url: downloadUrl },
    });
  }

  async enable(id) {
    const key = normalizeExtensionId(id);
    if (!key) return { ok: false, error: 'invalid id' };
    const rec = this.registry.getExtension(key);
    if (!rec) return { ok: false, error: 'not installed' };
    const next = await this.registry.upsertExtension({
      ...rec,
      enabled: true,
      state: 'enabled',
      updatedAt: Date.now(),
    });
    return { ok: true, item: next, needsRestart: true };
  }

  async disable(id) {
    const key = normalizeExtensionId(id);
    if (!key) return { ok: false, error: 'invalid id' };
    const rec = this.registry.getExtension(key);
    if (!rec) return { ok: false, error: 'not installed' };
    const next = await this.registry.upsertExtension({
      ...rec,
      enabled: false,
      state: 'disabled',
      updatedAt: Date.now(),
    });
    return { ok: true, item: next, needsRestart: true };
  }

  async uninstall(id) {
    const key = normalizeExtensionId(id);
    if (!key) return { ok: false, error: 'invalid id' };
    const rec = this.registry.getExtension(key);
    if (!rec) return { ok: true, removed: false, id: key };
    const installDir = pickString(rec.installDir);
    if (installDir) {
      await rimraf(installDir).catch(() => {});
    }
    const extRoot = path.join(this.extensionsRootDir, key);
    await rimraf(extRoot).catch(() => {});
    await this.registry.removeExtension(key);
    return { ok: true, removed: true, id: key, needsRestart: true };
  }

  listEnabledForHost() {
    const installed = this.listInstalled();
    const enabled = installed.filter((x) => x.enabled);
    const out = [];
    for (const it of enabled) {
      const id = pickString(it.id);
      const installDir = pickString(it.installDir);
      const extensionPath = installDir ? path.join(installDir, 'extension') : '';
      const mainRel = pickString(it?.manifest?.main);
      const mainAbs = (extensionPath && mainRel) ? path.join(extensionPath, mainRel) : '';
      if (!id || !extensionPath || !mainAbs) continue;
      out.push({ id, extensionPath, main: mainAbs });
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    return out;
  }
}

module.exports = { VscodeExtensionManager };

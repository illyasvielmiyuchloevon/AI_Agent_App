const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const yauzl = require('yauzl');

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function rimraf(target) {
  const p = String(target || '').trim();
  if (!p) return;
  await fsp.rm(p, { recursive: true, force: true });
}

function isPathInside(rootDir, targetPath) {
  const root = path.resolve(String(rootDir || ''));
  const full = path.resolve(String(targetPath || ''));
  const rel = path.relative(root, full);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function safeJoin(rootDir, entryPath) {
  const cleaned = String(entryPath || '').replace(/\\/g, '/');
  if (!cleaned || cleaned.includes('\0')) return '';
  const parts = cleaned.split('/').filter(Boolean);
  const safe = [];
  for (const part of parts) {
    if (part === '.' || part === '..') return '';
    safe.push(part);
  }
  const out = path.join(rootDir, ...safe);
  if (!isPathInside(rootDir, out)) return '';
  return out;
}

async function extractZip(zipPath, destDir) {
  await ensureDir(destDir);
  await new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      if (!zip) return reject(new Error('zip open failed'));

      zip.readEntry();
      zip.on('entry', (entry) => {
        const fileName = String(entry.fileName || '');
        const outPath = safeJoin(destDir, fileName);
        if (!outPath) {
          zip.readEntry();
          return;
        }

        if (/\/$/.test(fileName)) {
          fsp.mkdir(outPath, { recursive: true }).then(() => zip.readEntry()).catch(reject);
          return;
        }

        fsp.mkdir(path.dirname(outPath), { recursive: true })
          .then(() => new Promise((res2, rej2) => {
            zip.openReadStream(entry, (err2, stream) => {
              if (err2) return rej2(err2);
              const w = fs.createWriteStream(outPath);
              stream.on('error', rej2);
              w.on('error', rej2);
              w.on('finish', res2);
              stream.pipe(w);
            });
          }))
          .then(() => zip.readEntry())
          .catch(reject);
      });

      zip.on('end', () => resolve());
      zip.on('error', reject);
    });
  });
}

async function readJsonFile(filePath) {
  const raw = await fsp.readFile(filePath, 'utf8');
  const json = JSON.parse(raw);
  if (!json || typeof json !== 'object') throw new Error('invalid json');
  return json;
}

function pickString(v) {
  if (v == null) return '';
  const s = String(v).trim();
  return s;
}

function normalizeVsCodeEngines(engines) {
  const e = engines && typeof engines === 'object' ? engines : {};
  const vs = pickString(e.vscode);
  return vs;
}

function sanitizeManifestForRegistry(manifest) {
  const m = manifest && typeof manifest === 'object' ? manifest : {};
  const contributes = m.contributes && typeof m.contributes === 'object' ? m.contributes : {};
  const clampArray = (arr, max) => (Array.isArray(arr) ? arr.slice(0, Math.max(0, Number(max) || 0)) : []);
  const clampObject = (obj) => (obj && typeof obj === 'object' ? obj : {});
  const sanitizeKeybinding = (kb) => {
    const r = kb && typeof kb === 'object' ? kb : {};
    const command = pickString(r.command);
    const key = pickString(r.key);
    const mac = pickString(r.mac);
    const linux = pickString(r.linux);
    const win = pickString(r.win);
    const when = pickString(r.when);
    const args = r.args != null ? r.args : undefined;
    const out = { command };
    if (key) out.key = key;
    if (mac) out.mac = mac;
    if (linux) out.linux = linux;
    if (win) out.win = win;
    if (when) out.when = when;
    if (args !== undefined) out.args = args;
    return out;
  };
  const sanitizeMenuItem = (it) => {
    const r = it && typeof it === 'object' ? it : {};
    const command = pickString(r.command);
    const when = pickString(r.when);
    const group = pickString(r.group);
    const alt = r.alt != null ? (typeof r.alt === 'string' ? pickString(r.alt) : (r.alt && typeof r.alt === 'object' ? sanitizeMenuItem(r.alt) : undefined)) : undefined;
    const out = { command };
    if (when) out.when = when;
    if (group) out.group = group;
    if (alt !== undefined) out.alt = alt;
    return out;
  };
  const sanitizeMenus = (menus) => {
    const src = clampObject(menus);
    const out = {};
    for (const [k, v] of Object.entries(src)) {
      const key = pickString(k);
      if (!key) continue;
      const items = clampArray(v, 500).map((x) => sanitizeMenuItem(x)).filter((x) => x && x.command);
      if (items.length) out[key] = items;
    }
    return out;
  };
  return {
    name: pickString(m.name),
    publisher: pickString(m.publisher),
    displayName: pickString(m.displayName),
    version: pickString(m.version),
    description: pickString(m.description),
    main: pickString(m.main),
    engines: { vscode: normalizeVsCodeEngines(m.engines) },
    activationEvents: Array.isArray(m.activationEvents) ? m.activationEvents.map((x) => String(x)) : [],
    contributes: {
      commands: clampArray(contributes.commands, 500),
      keybindings: clampArray(contributes.keybindings, 800).map((x) => sanitizeKeybinding(x)).filter((x) => x && x.command),
      menus: sanitizeMenus(contributes.menus),
      languages: clampArray(contributes.languages, 200),
      grammars: clampArray(contributes.grammars, 400),
      snippets: clampArray(contributes.snippets, 400),
      themes: clampArray(contributes.themes, 200),
      iconThemes: clampArray(contributes.iconThemes, 200),
      configuration: contributes.configuration != null ? contributes.configuration : undefined,
    },
    extensionDependencies: Array.isArray(m.extensionDependencies) ? m.extensionDependencies.map((x) => String(x)) : [],
    extensionPack: Array.isArray(m.extensionPack) ? m.extensionPack.map((x) => String(x)) : [],
    capabilities: m.capabilities && typeof m.capabilities === 'object' ? m.capabilities : undefined,
  };
}

class VscodeExtensionInstaller {
  constructor({ extensionsRootDir, logger } = {}) {
    this.extensionsRootDir = String(extensionsRootDir || '').trim();
    this.logger = logger;
  }

  _stagingDir() {
    const root = this.extensionsRootDir;
    const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    return path.join(root, '.staging', suffix);
  }

  async installFromVsixFile(vsixPath, { onProgress } = {}) {
    const filePath = String(vsixPath || '').trim();
    if (!filePath) throw new Error('VSIX filePath is required');
    const stat = await fsp.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile()) throw new Error('VSIX file not found');

    const stagingDir = this._stagingDir();
    await ensureDir(stagingDir);
    try {
      onProgress?.({ stage: 'extract', filePath });
      await extractZip(filePath, stagingDir);

      const manifestPath = path.join(stagingDir, 'extension', 'package.json');
      const manifest = await readJsonFile(manifestPath);

      const publisher = pickString(manifest.publisher);
      const name = pickString(manifest.name);
      const version = pickString(manifest.version);
      if (!publisher || !name || !version) throw new Error('VSIX manifest missing publisher/name/version');

      const id = `${publisher}.${name}`.toLowerCase();
      const extDir = path.join(this.extensionsRootDir, id, version);
      await ensureDir(path.dirname(extDir));

      onProgress?.({ stage: 'move', id, version });
      await rimraf(extDir).catch(() => {});
      await fsp.rename(stagingDir, extDir).catch(async (err) => {
        this.logger?.warn?.('vsix move failed; using copy fallback', { error: err?.message || String(err) });
        await ensureDir(extDir);
        await fsp.cp(stagingDir, extDir, { recursive: true, force: true });
        await rimraf(stagingDir).catch(() => {});
      });

      const storedManifest = sanitizeManifestForRegistry(manifest);
      const extensionPath = path.join(extDir, 'extension');

      const mainRel = pickString(storedManifest.main);
      const mainAbs = mainRel ? path.join(extensionPath, mainRel) : '';
      if (mainAbs && !isPathInside(extensionPath, mainAbs)) throw new Error('VSIX manifest.main is invalid');
      if (mainAbs) {
        const mainStat = await fsp.stat(mainAbs).catch(() => null);
        if (!mainStat || !mainStat.isFile()) throw new Error('VSIX main entry not found');
      }

      return {
        id,
        publisher,
        name,
        version,
        installDir: extDir,
        extensionPath,
        manifest: storedManifest,
      };
    } catch (err) {
      await rimraf(stagingDir).catch(() => {});
      throw err;
    }
  }
}

module.exports = { VscodeExtensionInstaller, sanitizeManifestForRegistry };

const path = require('node:path');
const semver = require('semver');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const yauzl = require('yauzl');
const { normalizePluginId, isTrustLevel } = require('./types');
const { isPathInside, downloadWithResume } = require('./PluginInstaller');
const { DetailCache } = require('./DetailCache');

function guessFileExtension(filePath) {
  const p = String(filePath || '').trim().toLowerCase();
  const base = p.split('?')[0].split('#')[0];
  const idx = base.lastIndexOf('.');
  return idx >= 0 ? base.slice(idx) : '';
}

function interpolateString(value, vars) {
  let s = String(value ?? '');
  for (const [k, v] of Object.entries(vars || {})) {
    s = s.replaceAll(`\${${k}}`, String(v));
  }
  return s;
}

function resolveTransportTemplate(transport, vars) {
  const t = transport && typeof transport === 'object' ? transport : {};
  const command = interpolateString(t.command, vars);
  const args = Array.isArray(t.args) ? t.args.map((a) => interpolateString(a, vars)) : [];
  const env = (t.env && typeof t.env === 'object')
    ? Object.fromEntries(Object.entries(t.env).map(([k, v]) => [k, interpolateString(v, vars)]))
    : undefined;
  const cwd = t.cwd ? interpolateString(t.cwd, vars) : undefined;
  return { kind: 'stdio', command, args, env, cwd };
}

function isAllowedCommand(command, { pluginDir, allowNode = true } = {}) {
  const cmd = String(command || '').trim();
  if (!cmd) return false;
  if (allowNode && (cmd === 'node' || cmd === process.execPath)) return true;
  if (path.isAbsolute(cmd)) return isPathInside(pluginDir, cmd);
  return true;
}

class LanguagePluginManager {
  constructor({ registry, installer, providers, logger, detailCache } = {}) {
    this.registry = registry;
    this.installer = installer;
    this.providers = new Map();
    this.logger = logger;
    this.detailCache = detailCache || new DetailCache();
    for (const p of Array.isArray(providers) ? providers : []) {
      if (!p?.id) continue;
      this.providers.set(String(p.id), p);
    }
  }

  async init() {
    await this.registry.load();
  }

  _provider(id) {
    const p = this.providers.get(String(id || ''));
    if (!p) throw new Error(`unknown provider: ${id}`);
    return p;
  }

  listInstalled() {
    const items = this.registry.listPlugins();
    return items.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      trust: p.trust,
      enabled: !!p.enabled,
      installedVersion: p.installed?.version || '',
      installedAt: p.installed?.installedAt || 0,
      lastError: p.lastError || '',
      source: p.installed?.source || p.source || null,
      metadataOnly: !!p.metadataOnly,
      languages: Array.isArray(p.languages) ? p.languages : [],
    }));
  }

  async search({ query = '', providerIds = ['official', 'github', 'openvsx'], options } = {}) {
    const q = String(query || '').trim();
    const offset = Number.isFinite(options?.offset) ? Math.max(0, Number(options.offset)) : 0;
    const limit = Number.isFinite(options?.limit) ? Math.max(0, Number(options.limit)) : 0;
    const list = [];
    for (const id of Array.isArray(providerIds) ? providerIds : []) {
      const p = this.providers.get(String(id));
      if (!p?.search) continue;
      try {
        const res = await p.search(q, { offset, limit });
        for (const it of Array.isArray(res) ? res : []) list.push({ ...it, source: { ...(it.source || {}), providerId: p.id } });
      } catch (err) {
        this.logger?.warn?.('plugin search failed', { providerId: id, error: err?.message || String(err) });
      }
    }
    return list;
  }

  /**
   * Get detailed plugin information including README, changelog, and metadata
   * 
   * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 5.4
   * - Return plugin's README content in Markdown format
   * - Return plugin's feature list and capabilities
   * - Return plugin's changelog if available
   * - Return plugin's dependencies and requirements
   * - Return error message with failure reason if request fails
   * - Support forceRefresh to bypass cache
   * 
   * @param {Object} params
   * @param {string} params.id - Plugin ID
   * @param {string} [params.providerId] - Provider ID (optional, defaults to auto-detect)
   * @param {string} [params.version] - Version (optional, defaults to latest)
   * @param {boolean} [params.forceRefresh] - Force refresh cache
   * @returns {Promise<{ok: boolean, detail?: Object, error?: string, cached?: boolean}>}
   */
  async getDetail({ id, providerId, version, forceRefresh } = {}) {
    const pluginId = normalizePluginId(id);
    if (!pluginId) {
      return { ok: false, error: 'plugin id is required' };
    }

    // Determine provider ID - use provided, or try to detect from installed plugin
    let resolvedProviderId = String(providerId || '').trim();
    if (!resolvedProviderId) {
      // Try to get provider from installed plugin
      const installed = this.registry?.getPlugin?.(pluginId);
      resolvedProviderId = installed?.installed?.source?.providerId || installed?.source?.providerId || '';
    }

    // If still no provider, try default providers in order
    const providerIdsToTry = resolvedProviderId
      ? [resolvedProviderId]
      : ['openvsx', 'github', 'official'];

    // Build cache key
    const cacheKey = `${pluginId}:${version || 'latest'}:${providerIdsToTry.join(',')}`;

    // Check cache unless forceRefresh is true
    if (!forceRefresh) {
      const cached = this.detailCache.get(cacheKey);
      if (cached) {
        return { ok: true, detail: cached.detail, cached: true };
      }
    } else {
      // Invalidate cache if forceRefresh
      this.detailCache.invalidate(cacheKey);
    }

    // Try each provider until one succeeds
    let lastError = null;
    for (const pid of providerIdsToTry) {
      const provider = this.providers.get(pid);
      if (!provider) {
        lastError = `unknown provider: ${pid}`;
        continue;
      }

      if (!provider.getDetail) {
        lastError = `provider ${pid} does not support getDetail`;
        continue;
      }

      try {
        const detail = await provider.getDetail(pluginId, version);
        if (detail) {
          // Cache the successful result
          this.detailCache.set(cacheKey, detail);
          return { ok: true, detail, cached: false };
        }
        lastError = `plugin not found: ${pluginId}`;
      } catch (err) {
        lastError = err?.message || String(err);
        this.logger?.warn?.('plugin getDetail failed', {
          providerId: pid,
          pluginId,
          error: lastError,
        });
      }
    }

    return { ok: false, error: lastError || `plugin not found: ${pluginId}` };
  }

  async install({ providerId, id, version, filePath } = {}, { onProgress } = {}) {
    const provider = String(providerId || '').trim();
    const pluginId = normalizePluginId(id);
    if (!pluginId) throw new Error('install requires id');

    let spec = null;
    if (provider === 'local') {
      spec = {
        id: pluginId,
        name: pluginId,
        description: 'Local plugin',
        trust: 'local',
        version: String(version || 'local'),
        source: { providerId: 'local' },
        install: { kind: 'vsix', filePath: String(filePath || '').trim() },
        manifest: null,
        languages: [],
        metadataOnly: true,
      };
    } else {
      const p = this._provider(provider);
      spec = await p.get(pluginId, version);
    }
    if (!spec) throw new Error(`plugin not found: ${pluginId}`);

    const trust = isTrustLevel(spec.trust) ? spec.trust : 'community';
    const installed = await this.installer.install({ ...spec, trust }, { onProgress });

    const manifest = installed.manifest || spec.manifest || null;
    const servers = Array.isArray(manifest?.servers) ? manifest.servers : [];
    const inferredLanguages = Array.from(new Set(servers.flatMap((s) => {
      const langs = Array.isArray(s?.languageIds) ? s.languageIds : (s?.languageId ? [s.languageId] : []);
      return langs.map((x) => String(x));
    }))).filter(Boolean);

    const record = await this.registry.upsertPlugin({
      id: pluginId,
      name: spec.name || pluginId,
      description: spec.description || '',
      trust,
      enabled: false,
      languages: inferredLanguages.length ? inferredLanguages : (spec.languages || []),
      metadataOnly: !!spec.metadataOnly && servers.length === 0,
      installed: {
        version: installed.version,
        installDir: installed.installDir,
        installedAt: Date.now(),
        source: spec.source || { providerId: provider },
        manifest,
      },
      lastError: '',
    });

    return { ok: true, installed: record };
  }

  async uninstall(id) {
    const pluginId = normalizePluginId(id);
    if (!pluginId) return { ok: false };
    const record = this.registry.getPlugin(pluginId);
    if (record?.installed?.installDir) {
      try {
        const dir = String(record.installed.installDir);
        await require('node:fs/promises').rm(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    await this.registry.removePlugin(pluginId);
    return { ok: true };
  }

  async enable(id, { trust } = {}) {
    const pluginId = normalizePluginId(id);
    const record = this.registry.getPlugin(pluginId);
    if (!record) throw new Error(`plugin not installed: ${pluginId}`);
    const lvl = trust ? String(trust) : String(record.trust || '');
    if (!isTrustLevel(lvl)) throw new Error('invalid trust level');
    if (lvl !== 'official' && trust !== lvl) {
      throw new Error(`enabling ${lvl} plugin requires explicit trust`);
    }
    const next = await this.registry.upsertPlugin({ ...record, trust: lvl, enabled: true });
    return { ok: true, plugin: next };
  }

  async disable(id) {
    const pluginId = normalizePluginId(id);
    const record = this.registry.getPlugin(pluginId);
    if (!record) return { ok: true };
    const next = await this.registry.upsertPlugin({ ...record, enabled: false });
    return { ok: true, plugin: next };
  }

  async getDetails(id) {
    const pluginId = normalizePluginId(id);
    if (!pluginId) return { ok: false, error: 'missing id' };

    const record = this.registry.getPlugin(pluginId);
    const installed = !!record?.installed?.installDir;

    const normalizeZipPath = (p) => String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');

    const readZipEntry = async (zipPath, scoreFn, { maxBytes = 1024 * 1024 } = {}) => {
      const p = String(zipPath || '').trim();
      if (!p) return { fileName: '', buf: Buffer.alloc(0) };

      return await new Promise((resolve, reject) => {
        yauzl.open(p, { lazyEntries: true }, (err, zip) => {
          if (err) return reject(err);
          if (!zip) return reject(new Error('zip open failed'));

          let best = null;
          let bestScore = 0;

          zip.readEntry();
          zip.on('entry', (entry) => {
            const fileName = normalizeZipPath(entry.fileName || '');
            if (!fileName || /\/$/.test(fileName)) {
              zip.readEntry();
              return;
            }

            let score = 0;
            try { score = Number(scoreFn?.(fileName) || 0); } catch { score = 0; }
            if (Number.isFinite(score) && score > bestScore) {
              best = entry;
              bestScore = score;
            }
            zip.readEntry();
          });

          zip.on('end', () => {
            if (!best) {
              try { zip.close(); } catch {}
              return resolve({ fileName: '', buf: Buffer.alloc(0) });
            }
            zip.openReadStream(best, (err2, stream) => {
              if (err2) {
                try { zip.close(); } catch {}
                return reject(err2);
              }
              const chunks = [];
              let total = 0;
              let done = false;
              const finish = (buf) => {
                if (done) return;
                done = true;
                try { zip.close(); } catch {}
                resolve({ fileName: normalizeZipPath(best.fileName || ''), buf });
              };
              stream.on('data', (chunk) => {
                if (done) return;
                total += chunk.length;
                if (total > maxBytes) {
                  try { stream.destroy(); } catch {}
                  finish(Buffer.alloc(0));
                  return;
                }
                chunks.push(chunk);
              });
              stream.on('end', () => finish(Buffer.concat(chunks)));
              stream.on('error', () => finish(Buffer.alloc(0)));
            });
          });

          zip.on('error', (e) => {
            try { zip.close(); } catch {}
            reject(e);
          });
        });
      });
    };

    const safeParseJsonBuffer = (buf) => {
      try {
        const raw = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf || '');
        return JSON.parse(raw);
      } catch {
        return null;
      }
    };

    const safeTextBuffer = (buf) => {
      try {
        return Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf || '');
      } catch {
        return '';
      }
    };

    const pathMime = (p) => {
      const ext = path.extname(String(p || '')).toLowerCase();
      if (ext === '.svg') return 'image/svg+xml';
      if (ext === '.png') return 'image/png';
      if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
      if (ext === '.gif') return 'image/gif';
      if (ext === '.webp') return 'image/webp';
      return 'application/octet-stream';
    };

    const dataUrlFromBuffer = (buf, fileName) => {
      const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf || ''), 'utf8');
      if (!b.length) return '';
      const mime = pathMime(fileName);
      return `data:${mime};base64,${b.toString('base64')}`;
    };

    const loadMarketplaceSpec = async () => {
      for (const p of this.providers.values()) {
        if (!p?.get) continue;
        try {
          const spec = await p.get(pluginId);
          if (!spec) continue;
          return { ...spec, source: { ...(spec.source || {}), providerId: p.id } };
        } catch (err) {
          this.logger?.warn?.('plugin get failed', { providerId: p.id, pluginId, error: err?.message || String(err) });
        }
      }
      return null;
    };

    const readVsixDetails = async (spec) => {
      const install = spec?.install || {};
      const kind = String(install.kind || '').trim();
      if (kind !== 'vsix') return { packageJson: null, readme: '', changelog: '', icon: '' };

      const url = String(install.url || '').trim();
      const filePath = String(install.filePath || '').trim();
      const version = String(spec?.version || '').trim() || 'latest';
      const downloadsDir = String(this.installer?.downloadsDir || '').trim();
      if (!filePath && !url) return { packageJson: null, readme: '', changelog: '', icon: '' };

      let vsixPath = filePath;
      if (!vsixPath && url && downloadsDir) {
        await fsp.mkdir(path.join(downloadsDir, 'preview'), { recursive: true });
        const ext = guessFileExtension(url) || '.vsix';
        const dlPath = path.join(downloadsDir, 'preview', `${pluginId}-${version}${ext}`);
        const res = await downloadWithResume(url, dlPath, { logger: this.logger });
        vsixPath = res.filePath;
      }
      if (!vsixPath || !fs.existsSync(vsixPath)) return { packageJson: null, readme: '', changelog: '', icon: '' };

      const pkg = await readZipEntry(vsixPath, (fileName) => {
        const lower = String(fileName || '').toLowerCase();
        if (lower === 'extension/package.json') return 1000;
        if (lower.endsWith('/package.json')) return 200;
        if (path.basename(lower) === 'package.json') return 100;
        return 0;
      }, { maxBytes: 1024 * 1024 });

      const packageJson = safeParseJsonBuffer(pkg.buf);

      const readme = await readZipEntry(vsixPath, (fileName) => {
        const lower = String(fileName || '').toLowerCase();
        const base = path.basename(lower);
        const isReadme = base === 'readme.md' || base === 'readme' || base === 'readme.txt';
        if (!isReadme) return 0;
        const inExt = lower.startsWith('extension/') ? 1 : 0;
        const depth = lower.split('/').length;
        return 600 + (inExt ? 150 : 0) - depth;
      }, { maxBytes: 1024 * 1024 });

      const changelog = await readZipEntry(vsixPath, (fileName) => {
        const lower = String(fileName || '').toLowerCase();
        const base = path.basename(lower);
        const ok = base === 'changelog.md' || base === 'changelog' || base === 'history.md' || base === 'history';
        if (!ok) return 0;
        const inExt = lower.startsWith('extension/') ? 1 : 0;
        const depth = lower.split('/').length;
        return 500 + (inExt ? 120 : 0) - depth;
      }, { maxBytes: 1024 * 1024 });

      const icon = await (async () => {
        const iconRel = packageJson?.icon ? String(packageJson.icon) : '';
        if (!iconRel) return '';
        const iconRelNorm = normalizeZipPath(iconRel).toLowerCase();
        const iconEntry = await readZipEntry(vsixPath, (fileName) => {
          const lower = String(fileName || '').toLowerCase();
          if (lower === `extension/${iconRelNorm}`) return 900;
          if (lower.endsWith(`/${iconRelNorm}`)) return 300;
          return 0;
        }, { maxBytes: 512 * 1024 });
        if (!iconEntry.buf.length) return '';
        return dataUrlFromBuffer(iconEntry.buf, iconEntry.fileName || iconRel);
      })();

      return {
        packageJson: (packageJson && typeof packageJson === 'object') ? packageJson : null,
        readme: safeTextBuffer(readme.buf),
        changelog: safeTextBuffer(changelog.buf),
        icon,
      };
    };

    if (!record) {
      const spec = await loadMarketplaceSpec();
      if (!spec) return { ok: false, error: 'plugin not found' };

      const vsixDetails = await readVsixDetails(spec).catch(() => ({ packageJson: null, readme: '', changelog: '', icon: '' }));

      return {
        ok: true,
        plugin: {
          id: spec.id || pluginId,
          name: spec.name || pluginId,
          description: spec.description || '',
          trust: isTrustLevel(spec.trust) ? spec.trust : 'community',
          enabled: false,
          installedVersion: '',
          installedAt: 0,
          lastError: '',
          source: spec.source || null,
          metadataOnly: !!spec.metadataOnly,
          languages: Array.isArray(spec.languages) ? spec.languages : [],
        },
        installed: false,
        installDir: '',
        manifest: spec.manifest || null,
        packageJson: vsixDetails.packageJson,
        readme: vsixDetails.readme || '',
        changelog: vsixDetails.changelog || '',
        icon: vsixDetails.icon || '',
        marketplace: spec,
      };
    }

    const safeReadJson = async (p) => {
      try {
        const raw = await fsp.readFile(p, 'utf8');
        return JSON.parse(raw);
      } catch {
        return null;
      }
    };

    const safeReadText = async (p, { maxBytes = 1024 * 1024 } = {}) => {
      try {
        const st = await fsp.stat(p);
        if (!st.isFile()) return '';
        if (st.size > maxBytes) return '';
        return await fsp.readFile(p, 'utf8');
      } catch {
        return '';
      }
    };

    const safeReadDataUrl = async (p, { maxBytes = 512 * 1024 } = {}) => {
      try {
        const st = await fsp.stat(p);
        if (!st.isFile()) return '';
        if (st.size > maxBytes) return '';
        const ext = path.extname(p).toLowerCase();
        const mime = ext === '.svg' ? 'image/svg+xml'
          : (ext === '.png' ? 'image/png'
            : (ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
              : (ext === '.gif' ? 'image/gif' : 'application/octet-stream')));
        const buf = await fsp.readFile(p);
        return `data:${mime};base64,${buf.toString('base64')}`;
      } catch {
        return '';
      }
    };

    const dir = String(record?.installed?.installDir || '').trim();
    const manifest = record?.installed?.manifest || null;
    const candidates = dir ? [dir, path.join(dir, 'extension')] : [];

    const findOne = async (baseDir, names) => {
      if (!baseDir) return '';
      const want = new Set((Array.isArray(names) ? names : []).map((n) => String(n).toLowerCase()));
      if (!want.size) return '';
      let entries = [];
      try {
        entries = await fsp.readdir(baseDir, { withFileTypes: true });
      } catch {
        return '';
      }
      for (const ent of entries) {
        const n = String(ent?.name || '');
        if (!n) continue;
        if (!ent.isFile()) continue;
        if (!want.has(n.toLowerCase())) continue;
        return path.join(baseDir, n);
      }
      return '';
    };

    const findReadme = async () => {
      const names = ['README.md', 'README.markdown', 'README.txt', 'README'];
      for (const base of candidates) {
        const direct = await findOne(base, names);
        if (direct) return direct;
      }
      // shallow scan in subfolders (max depth 2)
      const queue = candidates.map((d) => ({ dir: d, depth: 0 }));
      const seen = new Set();
      let scanned = 0;
      while (queue.length && scanned < 600) {
        const cur = queue.shift();
        if (!cur?.dir) continue;
        const key = path.resolve(cur.dir);
        if (seen.has(key)) continue;
        seen.add(key);
        scanned += 1;
        const direct = await findOne(cur.dir, names);
        if (direct) return direct;
        if (cur.depth >= 2) continue;
        let entries = [];
        try {
          entries = await fsp.readdir(cur.dir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const ent of entries) {
          if (!ent?.isDirectory?.()) continue;
          const n = String(ent.name || '');
          if (!n || n.startsWith('.')) continue;
          if (n === 'node_modules') continue;
          queue.push({ dir: path.join(cur.dir, n), depth: cur.depth + 1 });
        }
      }
      return '';
    };

    const readmePath = installed ? await findReadme() : '';
    const readmeText = readmePath ? await safeReadText(readmePath) : '';

    const pkgPath = installed
      ? (await (async () => {
        for (const base of candidates) {
          const p = path.join(base, 'package.json');
          try {
            await fsp.access(p);
            return p;
          } catch {
            // ignore
          }
        }
        return '';
      })())
      : '';
    const packageJson = pkgPath ? await safeReadJson(pkgPath) : null;

    const iconDataUrl = (() => {
      const iconRel = packageJson?.icon ? String(packageJson.icon) : '';
      if (!iconRel || !dir) return '';
      const base = pkgPath ? path.dirname(pkgPath) : dir;
      const iconPath = path.resolve(base, iconRel);
      if (!iconPath || !fs.existsSync(iconPath)) return '';
      return iconPath;
    })();
    const icon = iconDataUrl ? await safeReadDataUrl(iconDataUrl) : '';

    const changelogPath = installed
      ? (await (async () => {
        const names = ['CHANGELOG.md', 'CHANGELOG', 'HISTORY.md', 'HISTORY'];
        for (const base of candidates) {
          const p = await findOne(base, names);
          if (p) return p;
        }
        return '';
      })())
      : '';
    const changelogText = changelogPath ? await safeReadText(changelogPath) : '';

    return {
      ok: true,
      plugin: {
        id: record.id,
        name: record.name,
        description: record.description,
        trust: record.trust,
        enabled: !!record.enabled,
        installedVersion: record.installed?.version || '',
        installedAt: record.installed?.installedAt || 0,
        lastError: record.lastError || '',
        source: record.installed?.source || record.source || null,
        metadataOnly: !!record.metadataOnly,
        languages: Array.isArray(record.languages) ? record.languages : [],
      },
      installed,
      installDir: dir,
      manifest,
      packageJson,
      readme: readmeText ? { path: readmePath, text: readmeText } : null,
      changelog: changelogText ? { path: changelogPath, text: changelogText } : null,
      icon: icon ? { dataUrl: icon } : null,
    };
  }

  doctor(id) {
    const pluginId = normalizePluginId(id);
    const items = pluginId ? [this.registry.getPlugin(pluginId)].filter(Boolean) : this.registry.listPlugins();
    const reports = [];
    for (const p of items) {
      const manifest = p?.installed?.manifest || null;
      const dir = String(p?.installed?.installDir || '');
      const needsNode = !!manifest?.requires?.node;
      const needsNpm = !!manifest?.requires?.npm;
      reports.push({
        id: p.id,
        enabled: !!p.enabled,
        installedVersion: p.installed?.version || '',
        installDir: dir,
        checks: {
          node: needsNode ? { ok: !!process.execPath } : { ok: true, skipped: true },
          npm: needsNpm ? { ok: null, note: 'npm is required for install/update' } : { ok: true, skipped: true },
          manifest: { ok: !!manifest, note: manifest ? '' : 'missing language-plugin.json' },
        },
      });
    }
    return { ok: true, reports };
  }

  resolveServerConfig({ workspaceId, languageId, filePath, preferredPluginId } = {}) {
    const res = this.resolveServerConfigs({ workspaceId, languageId, filePath, preferredPluginId });
    if (!res?.ok) return res;
    const first = Array.isArray(res.serverConfigs) ? res.serverConfigs[0] : null;
    if (!first) return { ok: false, error: 'plugin has no matching server' };
    return { ok: true, plugin: res.plugin, serverConfig: first };
  }

  resolveServerConfigs({ workspaceId, languageId, filePath, preferredPluginId } = {}) {
    const wid = String(workspaceId || '').trim();
    const lang = String(languageId || '').trim();
    const ext = guessFileExtension(filePath);

    const installed = this.registry
      .listPlugins()
      .filter((p) => p?.enabled && p?.installed?.installDir && p?.installed?.manifest && !p?.metadataOnly);

    const byTrust = (p) => (p.trust === 'official' ? 0 : (p.trust === 'community' ? 1 : 2));
    installed.sort((a, b) => byTrust(a) - byTrust(b));

    const prefer = normalizePluginId(preferredPluginId);
    if (prefer) installed.sort((a, b) => (a.id === prefer ? -1 : b.id === prefer ? 1 : 0));

    const pickPlugin = installed.find((p) => {
      const manifest = p.installed.manifest || {};
      const servers = Array.isArray(manifest.servers) ? manifest.servers : [];
      return servers.some((s) => {
        const langs = Array.isArray(s.languageIds) ? s.languageIds : (s.languageId ? [s.languageId] : []);
        const exts = Array.isArray(s.fileExtensions) ? s.fileExtensions : [];
        return (langs.includes(lang)) || (ext && exts.map((x) => String(x).toLowerCase()).includes(ext));
      });
    });

    if (!pickPlugin) return { ok: false, error: `no enabled LSP plugin for ${lang || ext || 'file'}` };
    const pluginDir = String(pickPlugin.installed.installDir);
    const manifest = pickPlugin.installed.manifest || {};
    const servers = Array.isArray(manifest.servers) ? manifest.servers : [];

    const matches = (s) => {
      const langs = Array.isArray(s.languageIds) ? s.languageIds : (s.languageId ? [s.languageId] : []);
      const exts = Array.isArray(s.fileExtensions) ? s.fileExtensions : [];
      if (langs.includes(lang)) return true;
      return ext && exts.map((x) => String(x).toLowerCase()).includes(ext);
    };

    const matchingServers = servers.filter(matches);
    if (!matchingServers.length) return { ok: false, error: 'plugin has no matching server' };

    const roleRank = (r) => {
      const role = String(r || '').toLowerCase();
      if (role === 'primary') return 0;
      if (role === 'lint') return 1;
      if (role === 'format' || role === 'formatting') return 2;
      if (role === 'diagnostics') return 3;
      return 10;
    };
    matchingServers.sort((a, b) => roleRank(a?.role) - roleRank(b?.role));

    const vars = {
      PLUGIN_DIR: pluginDir,
      NODE: process.execPath,
      EXE: process.platform === 'win32' ? '.exe' : '',
      WORKSPACE_ID: wid,
    };

    const serverConfigs = [];
    for (const server of matchingServers) {
      let transport = resolveTransportTemplate(server.transport || {}, vars);

      let command = String(transport.command || '').trim();
      if (!command) return { ok: false, error: 'resolved command is empty' };

      if (process.versions?.electron) {
        if (command === 'node' || command === process.execPath) {
          const baseEnv = (transport.env && typeof transport.env === 'object') ? transport.env : {};
          transport = { ...transport, env: { ...baseEnv, ELECTRON_RUN_AS_NODE: '1' } };
          command = process.execPath;
        }
      }

      if (!path.isAbsolute(command) && command !== 'node') {
        command = path.join(pluginDir, command);
      }
      if (!isAllowedCommand(command, { pluginDir })) return { ok: false, error: 'command not allowed by policy' };

      const serverEntryId = String(server?.id || '').trim() || `${lang || ext || 'file'}`;
      const role = server?.role ? String(server.role) : '';
      const cfg = {
        id: `${pickPlugin.id}@${pickPlugin.installed.version}:${serverEntryId}${role ? `:${role}` : ''}`,
        role,
        languageId: lang || server.languageId || '',
        transport: { ...transport, command },
        initializationOptions: manifest.initializationOptions,
        settingsSection: manifest.settingsSection,
        initializationTimeoutMs: server?.initializeTimeoutMs ?? manifest?.initializeTimeoutMs,
        fileExtensions: Array.isArray(server.fileExtensions) ? server.fileExtensions : [],
      };
      serverConfigs.push(cfg);
    }

    return { ok: true, plugin: { id: pickPlugin.id, name: pickPlugin.name, version: pickPlugin.installed.version }, serverConfigs };
  }

  listEnabledLanguages() {
    const installed = this.registry.listPlugins().filter((p) => p?.enabled && p?.installed?.manifest && !p?.metadataOnly);
    const out = new Set();
    for (const p of installed) {
      const servers = Array.isArray(p.installed.manifest?.servers) ? p.installed.manifest.servers : [];
      for (const s of servers) {
        const langs = Array.isArray(s.languageIds) ? s.languageIds : (s.languageId ? [s.languageId] : []);
        for (const l of langs) out.add(String(l));
      }
    }
    return Array.from(out).filter(Boolean);
  }

  async listUpdates() {
    const installed = this.registry.listPlugins();
    const updates = [];
    for (const p of installed) {
      const providerId = p.installed?.source?.providerId || p.source?.providerId;
      if (!providerId || providerId === 'official' || providerId === 'local') continue;
      const provider = this.providers.get(String(providerId));
      if (!provider?.get) continue;
      try {
        const latest = await provider.get(p.id);
        const current = String(p.installed?.version || '');
        const next = String(latest?.version || '');
        if (semver.valid(current) && semver.valid(next) && semver.gt(next, current)) {
          updates.push({ id: p.id, current, latest: next, providerId });
        }
      } catch {
        // ignore
      }
    }
    return updates;
  }
}

module.exports = { LanguagePluginManager };

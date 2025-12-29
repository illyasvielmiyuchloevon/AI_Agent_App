const path = require('node:path');
const semver = require('semver');
const { normalizePluginId, isTrustLevel } = require('./types');
const { isPathInside } = require('./PluginInstaller');

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
  constructor({ registry, installer, providers, logger } = {}) {
    this.registry = registry;
    this.installer = installer;
    this.providers = new Map();
    this.logger = logger;
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

  async search({ query = '', providerIds = ['official', 'github', 'openvsx'] } = {}) {
    const q = String(query || '').trim();
    const list = [];
    for (const id of Array.isArray(providerIds) ? providerIds : []) {
      const p = this.providers.get(String(id));
      if (!p?.search) continue;
      try {
        const res = await p.search(q);
        for (const it of Array.isArray(res) ? res : []) list.push({ ...it, source: { ...(it.source || {}), providerId: p.id } });
      } catch (err) {
        this.logger?.warn?.('plugin search failed', { providerId: id, error: err?.message || String(err) });
      }
    }
    return list;
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
      const transport = resolveTransportTemplate(server.transport || {}, vars);

      let command = String(transport.command || '').trim();
      if (!command) return { ok: false, error: 'resolved command is empty' };
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

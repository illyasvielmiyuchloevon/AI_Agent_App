function normalizeOpenVsxDetail(json, ns, name) {
  const id = ns && name ? `${ns}.${name}` : '';
  const version = String(json?.version || '');

  return {
    id,
    name: String(json?.displayName || name || ''),
    version,
    description: String(json?.description || ''),
    readme: json?.readme != null ? String(json.readme) : null,
    changelog: json?.changelog != null ? String(json.changelog) : null,
    categories: Array.isArray(json?.categories) ? json.categories.map(String) : [],
    capabilities: Array.isArray(json?.tags) ? json.tags.map(String) : [],
    dependencies: [],
    repository: json?.repository != null ? String(json.repository) : null,
    license: json?.license != null ? String(json.license) : null,
    publisher: {
      name: String(json?.publishedBy?.loginName || json?.namespace || ns || ''),
      url: json?.publishedBy?.homepage != null ? String(json.publishedBy.homepage) : null,
    },
    statistics: {
      downloads: typeof json?.downloadCount === 'number' ? json.downloadCount : 0,
      rating: typeof json?.averageRating === 'number' ? json.averageRating : null,
      reviewCount: typeof json?.reviewCount === 'number' ? json.reviewCount : 0,
    },
    lastUpdated: json?.timestamp ? new Date(json.timestamp).getTime() : Date.now(),
    source: { providerId: 'openvsx', namespace: ns, name },
  };
}

class OpenVsxProvider {
  constructor() {
    this.id = 'openvsx';
  }

  async _fetchText(url) {
    const u = url != null ? String(url || '').trim() : '';
    if (!u) return null;
    try {
      const res = await fetch(u);
      if (!res.ok) return null;
      const text = await res.text();
      return text != null ? String(text) : null;
    } catch {
      return null;
    }
  }

  async search(query = '', options) {
    const q = String(query || '').trim();
    if (!q) return [];
    const offset = Number.isFinite(options?.offset) ? Math.max(0, Number(options.offset)) : 0;
    const limit = Number.isFinite(options?.limit) ? Math.max(1, Number(options.limit)) : 20;
    const url = `https://open-vsx.org/api/-/search?query=${encodeURIComponent(q)}&size=${encodeURIComponent(String(limit))}&offset=${encodeURIComponent(String(offset))}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OpenVSX search failed: ${res.status}`);
    const json = await res.json();
    const hits = Array.isArray(json?.extensions) ? json.extensions : [];
    return hits.map((ext) => {
      const ns = String(ext?.namespace || '').trim();
      const name = String(ext?.name || '').trim();
      const version = String(ext?.version || '').trim();
      const id = ns && name ? `${ns}.${name}` : '';
      if (!id) return null;

      const vsixUrl = `https://open-vsx.org/api/${encodeURIComponent(ns)}/${encodeURIComponent(name)}/${encodeURIComponent(version)}/file/${encodeURIComponent(ns)}.${encodeURIComponent(name)}-${encodeURIComponent(version)}.vsix`;
      return {
        id,
        name: String(ext?.displayName || name),
        description: String(ext?.description || ''),
        version,
        trust: 'community',
        source: { providerId: this.id, namespace: ns, name },
        install: { kind: 'vsix', url: vsixUrl },
        manifest: null,
        languages: [],
        metadataOnly: true,
      };
    }).filter(Boolean);
  }

  async get(id) {
    const key = String(id || '').trim();
    if (!key) return null;
    const [ns, name] = key.split('.', 2);
    if (!ns || !name) return null;
    const res = await fetch(`https://open-vsx.org/api/${encodeURIComponent(ns)}/${encodeURIComponent(name)}`);
    if (!res.ok) return null;
    const json = await res.json();
    const version = String(json?.version || '');
    if (!version) return null;
    const vsixUrl = `https://open-vsx.org/api/${encodeURIComponent(ns)}/${encodeURIComponent(name)}/${encodeURIComponent(version)}/file/${encodeURIComponent(ns)}.${encodeURIComponent(name)}-${encodeURIComponent(version)}.vsix`;
    return {
      id: key,
      name: String(json?.displayName || name),
      description: String(json?.description || ''),
      version,
      trust: 'community',
      source: { providerId: this.id, namespace: ns, name },
      install: { kind: 'vsix', url: vsixUrl },
      manifest: null,
      languages: [],
      metadataOnly: true,
    };
  }

  async getDetail(id, version) {
    const key = String(id || '').trim();
    if (!key) return null;

    const parts = key.split('.');
    if (parts.length < 2) return null;

    const ns = parts[0];
    const name = parts.slice(1).join('.');
    if (!ns || !name) return null;

    try {
      // Build URL - if version specified, fetch that specific version
      let url = `https://open-vsx.org/api/${encodeURIComponent(ns)}/${encodeURIComponent(name)}`;
      if (version) {
        url += `/${encodeURIComponent(version)}`;
      }

      const res = await fetch(url);
      if (!res.ok) return null;

      const json = await res.json();
      if (!json || !json.version) return null;

      const detail = normalizeOpenVsxDetail(json, ns, name);

      const files = json?.files && typeof json.files === 'object' ? json.files : {};
      const [readme, changelog] = await Promise.all([
        this._fetchText(files.readme),
        this._fetchText(files.changelog),
      ]);
      if (readme != null) detail.readme = readme;
      if (changelog != null) detail.changelog = changelog;

      return detail;
    } catch (err) {
      return null;
    }
  }
}

module.exports = { OpenVsxProvider, normalizeOpenVsxDetail };

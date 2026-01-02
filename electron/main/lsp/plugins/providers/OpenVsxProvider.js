class OpenVsxProvider {
  constructor() {
    this.id = 'openvsx';
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
}

module.exports = { OpenVsxProvider };

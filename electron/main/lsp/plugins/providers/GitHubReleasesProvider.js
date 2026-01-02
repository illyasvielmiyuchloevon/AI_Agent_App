const semver = require('semver');

class GitHubReleasesProvider {
  constructor({ known = [] } = {}) {
    this.id = 'github';
    this.known = Array.isArray(known) ? known : [];
  }

  async search(query = '', options) {
    const q = String(query || '').trim().toLowerCase();
    const offset = Number.isFinite(options?.offset) ? Math.max(0, Number(options.offset)) : 0;
    const limit = Number.isFinite(options?.limit) ? Math.max(0, Number(options.limit)) : 0;
    const filtered = !q
      ? this.known
      : this.known.filter((p) => (`${p.id} ${p.name || ''} ${p.description || ''} ${p.repo || ''}`).toLowerCase().includes(q));
    const sliced = (!offset && !limit)
      ? filtered
      : filtered.slice(offset || 0, limit ? ((offset || 0) + limit) : undefined);
    return sliced.map((x) => ({ ...x, source: { providerId: this.id, repo: x.repo } }));
  }

  async get(id) {
    const key = String(id || '').trim();
    if (!key) return null;
    const item = this.known.find((x) => String(x?.id || '') === key);
    if (!item) return null;

    const repo = String(item.repo || '').trim();
    if (!repo.includes('/')) throw new Error('invalid repo');
    const url = `https://api.github.com/repos/${repo}/releases`;
    const res = await fetch(url, { headers: { 'User-Agent': 'ai-agent-ide' } });
    if (!res.ok) throw new Error(`GitHub releases failed: ${res.status}`);
    const releases = await res.json();
    const list = Array.isArray(releases) ? releases : [];
    const stable = list.filter((r) => !r?.prerelease);
    const pick = stable[0] || list[0];
    if (!pick) return null;

    const tag = String(pick.tag_name || pick.name || '').trim();
    const coerced = semver.coerce(tag);
    const version = coerced ? String(coerced) : (tag || 'latest');

    const asset = item.selectAsset?.(pick);
    if (!asset?.url) return null;
    return {
      id: item.id,
      name: item.name,
      description: item.description,
      version: asset.version || version,
      trust: item.trust || 'community',
      source: { providerId: this.id, repo },
      install: { kind: 'archive', url: asset.url, sha256: asset.sha256 || '' },
      manifest: item.manifest || null,
      languages: item.languages || [],
      metadataOnly: !item.manifest,
    };
  }
}

module.exports = { GitHubReleasesProvider };

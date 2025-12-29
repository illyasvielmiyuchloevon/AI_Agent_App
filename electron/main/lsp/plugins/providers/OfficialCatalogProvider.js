const fs = require('node:fs');
const path = require('node:path');

function safeReadJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const json = JSON.parse(raw);
    return json && typeof json === 'object' ? json : null;
  } catch {
    return null;
  }
}

class OfficialCatalogProvider {
  constructor({ catalogPath } = {}) {
    this.id = 'official';
    this.catalogPath = String(catalogPath || '').trim();
  }

  _readCatalog() {
    const p = this.catalogPath || path.join(__dirname, '..', 'officialCatalog.json');
    const json = safeReadJson(p);
    const items = Array.isArray(json?.plugins) ? json.plugins : [];
    return items.filter((x) => x && typeof x === 'object');
  }

  async search(query = '') {
    const q = String(query || '').trim().toLowerCase();
    const items = this._readCatalog();
    if (!q) return items;
    return items.filter((p) => {
      const hay = `${p.id} ${p.name || ''} ${p.description || ''} ${(p.languages || []).join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
  }

  async get(id) {
    const key = String(id || '').trim();
    if (!key) return null;
    const items = this._readCatalog();
    return items.find((x) => String(x?.id || '') === key) || null;
  }
}

module.exports = { OfficialCatalogProvider };


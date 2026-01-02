function normalizeLanguageIds(selector) {
  if (!selector) return [];
  if (typeof selector === 'string') return [selector];
  if (Array.isArray(selector)) return selector.flatMap((x) => normalizeLanguageIds(x));
  if (typeof selector === 'object') {
    const lang = selector.language ? String(selector.language) : '';
    return lang ? [lang] : [];
  }
  return [];
}

function normalizeCompletionItems(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object' && Array.isArray(value.items)) return value.items;
  return [];
}

class CompletionProviderRegistry {
  constructor() {
    this.nextId = 1;
    this.providers = new Map(); // providerId -> { languageIds, provider, triggerCharacters }
  }

  register(selector, provider, triggerCharacters) {
    const languageIds = normalizeLanguageIds(selector).map((x) => String(x || '').trim()).filter(Boolean);
    if (!languageIds.length) throw new Error('languages.registerCompletionItemProvider: missing language selector');
    if (!provider || typeof provider.provideCompletionItems !== 'function') throw new Error('languages.registerCompletionItemProvider: missing provider');

    const id = `cp_${this.nextId++}`;
    const triggers = Array.isArray(triggerCharacters) ? triggerCharacters.map((c) => String(c || '')).filter(Boolean) : [];
    this.providers.set(id, { languageIds, provider, triggerCharacters: triggers });
    return {
      id,
      dispose: () => this.providers.delete(id),
    };
  }

  async provide({ languageId, document, position, context, token } = {}) {
    const lang = String(languageId || '').trim();
    if (!lang) return [];
    const doc = document || null;
    const pos = position || null;
    const ctx = context || null;

    const matches = Array.from(this.providers.values()).filter((p) => p.languageIds.includes(lang));
    if (!matches.length) return [];

    const out = [];
    for (const entry of matches) {
      // eslint-disable-next-line no-await-in-loop
      const value = await entry.provider.provideCompletionItems(doc, pos, token, ctx);
      const items = normalizeCompletionItems(value);
      for (const it of items) out.push(it);
    }
    return out;
  }
}

module.exports = { CompletionProviderRegistry, normalizeLanguageIds, normalizeCompletionItems };


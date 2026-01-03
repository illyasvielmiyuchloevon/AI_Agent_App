const test = require('node:test');
const assert = require('node:assert/strict');

const { CompletionProviderRegistry, normalizeLanguageIds } = require('../completionProviderRegistry');

test('normalizeLanguageIds supports string/object/array', () => {
  assert.deepEqual(normalizeLanguageIds('js'), ['js']);
  assert.deepEqual(normalizeLanguageIds({ language: 'ts' }), ['ts']);
  assert.deepEqual(normalizeLanguageIds(['a', { language: 'b' }]), ['a', 'b']);
});

test('CompletionProviderRegistry merges providers for same language', async () => {
  const reg = new CompletionProviderRegistry();
  reg.register('js', { provideCompletionItems: async () => [{ label: 'a' }] });
  reg.register({ language: 'js' }, { provideCompletionItems: async () => ({ items: [{ label: 'b' }] }) });
  const items = await reg.provide({ languageId: 'js', document: {}, position: {} });
  assert.deepEqual(items.map((x) => x.label), ['a', 'b']);
});


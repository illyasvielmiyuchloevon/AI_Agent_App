export function normalizeHoverContents(hover) {
  const contents = hover?.contents;
  if (!contents) return '';
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) return contents.map((c) => c?.value || c).filter(Boolean).join('\n\n');
  return contents?.value ? String(contents.value) : '';
}


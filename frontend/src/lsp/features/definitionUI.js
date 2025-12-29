export function normalizeDefinitionResult(definition) {
  if (!definition) return [];
  return Array.isArray(definition) ? definition : [definition];
}


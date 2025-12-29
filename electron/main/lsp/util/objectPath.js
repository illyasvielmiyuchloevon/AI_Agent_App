function getByPath(obj, path) {
  if (!obj) return undefined;
  const p = String(path || '').trim();
  if (!p) return undefined;
  const parts = p.split('.').filter(Boolean);
  let cur = obj;
  for (const part of parts) {
    if (cur && typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, part)) {
      cur = cur[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

module.exports = { getByPath };


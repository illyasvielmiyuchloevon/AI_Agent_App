const fs = require('fs');
const path = require('path');

function resolvePreloadPath(electronRootDir) {
  const root = String(electronRootDir || '');
  const bundled = path.join(root, '.bundles', 'preload.cjs');
  if (fs.existsSync(bundled)) return bundled;

  return path.join(root, 'preload.js');
}

module.exports = { resolvePreloadPath };


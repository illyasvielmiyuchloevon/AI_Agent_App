/* eslint-disable no-console */
const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');

function tryLoadEsbuild() {
  try {
    // eslint-disable-next-line global-require
    return require('esbuild');
  } catch {}

  try {
    const frontendRequire = createRequire(path.join(__dirname, '..', '..', 'frontend', 'package.json'));
    return frontendRequire('esbuild');
  } catch {}

  return null;
}

function copyPreload(entry, outfile) {
  const code = fs.readFileSync(entry, 'utf8');
  fs.writeFileSync(outfile, code, 'utf8');
}

async function main() {
  const esbuild = tryLoadEsbuild();

  const watch = process.argv.includes('--watch');
  const rootDir = path.join(__dirname, '..');
  const entry = path.join(rootDir, 'preload.js');
  const outDir = path.join(rootDir, '.bundles');
  const outfile = path.join(outDir, 'preload.cjs');

  fs.mkdirSync(outDir, { recursive: true });

  if (!esbuild) {
    copyPreload(entry, outfile);
    console.warn('[preload] esbuild not found; copied preload.js without bundling');

    if (!watch) return;

    console.log(`[preload] watching (copy): ${path.relative(rootDir, entry)} -> ${path.relative(rootDir, outfile)}`);
    let timer = null;
    fs.watch(entry, { persistent: true }, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          copyPreload(entry, outfile);
        } catch (err) {
          console.error('[preload] copy failed:', err);
        }
      }, 50);
    });

    // Keep process alive.
    // eslint-disable-next-line no-constant-condition
    while (true) await new Promise((r) => setTimeout(r, 1 << 30));
  }

  const options = {
    entryPoints: [entry],
    bundle: true,
    outfile,
    platform: 'node',
    format: 'cjs',
    target: ['node20'],
    sourcemap: true,
    sourcesContent: false,
    logLevel: 'info',
    external: ['electron'],
  };

  if (!watch) {
    await esbuild.build(options);
    return;
  }

  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log(`[preload] watching: ${path.relative(rootDir, entry)} -> ${path.relative(rootDir, outfile)}`);
  // Keep process alive.
  // eslint-disable-next-line no-constant-condition
  while (true) await new Promise((r) => setTimeout(r, 1 << 30));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

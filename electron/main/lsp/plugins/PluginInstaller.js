const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const yauzl = require('yauzl');
const tar = require('tar');

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function rimraf(target) {
  const p = String(target || '').trim();
  if (!p) return;
  await fsp.rm(p, { recursive: true, force: true });
}

function sha256FileSync(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    while (true) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (!n) break;
      hash.update(buf.subarray(0, n));
    }
  } finally {
    try { fs.closeSync(fd); } catch {}
  }
  return hash.digest('hex');
}

function isPathInside(rootDir, targetPath) {
  const root = path.resolve(String(rootDir || ''));
  const full = path.resolve(String(targetPath || ''));
  const rel = path.relative(root, full);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

async function downloadWithResume(url, destPath, { onProgress, logger } = {}) {
  const target = String(destPath || '').trim();
  if (!target) throw new Error('download destPath required');
  await ensureDir(path.dirname(target));

  const tmp = `${target}.part`;
  const startAt = (() => {
    try {
      return fs.statSync(tmp).size || 0;
    } catch {
      return 0;
    }
  })();

  const headers = {};
  if (startAt > 0) headers.Range = `bytes=${startAt}-`;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText}`);

  const isPartial = res.status === 206;
  const total = (() => {
    const len = Number(res.headers.get('content-length') || 0);
    if (!Number.isFinite(len) || len <= 0) return 0;
    return isPartial ? startAt + len : len;
  })();

  if (startAt > 0 && !isPartial) {
    try { fs.unlinkSync(tmp); } catch {}
  }

  const file = fs.createWriteStream(tmp, { flags: startAt > 0 && isPartial ? 'a' : 'w' });

  let loaded = isPartial ? startAt : 0;
  await new Promise((resolve, reject) => {
    res.body.on('data', (chunk) => {
      loaded += chunk.length;
      try { onProgress?.({ loadedBytes: loaded, totalBytes: total, stage: 'download' }); } catch {}
    });
    res.body.on('error', reject);
    file.on('error', reject);
    file.on('finish', resolve);
    res.body.pipe(file);
  });

  try {
    await fsp.rename(tmp, target);
  } catch (err) {
    logger?.warn?.('download rename failed; using fallback', { error: err?.message || String(err) });
    await fsp.copyFile(tmp, target);
    await fsp.unlink(tmp).catch(() => {});
  }

  return { filePath: target, totalBytes: total || loaded };
}

function safeJoin(rootDir, entryPath) {
  const cleaned = String(entryPath || '').replace(/\\/g, '/');
  if (!cleaned || cleaned.includes('\0')) return '';
  const parts = cleaned.split('/').filter(Boolean);
  const safe = [];
  for (const part of parts) {
    if (part === '.' || part === '..') return '';
    safe.push(part);
  }
  const out = path.join(rootDir, ...safe);
  if (!isPathInside(rootDir, out)) return '';
  return out;
}

async function extractZip(zipPath, destDir) {
  await ensureDir(destDir);
  await new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      if (!zip) return reject(new Error('zip open failed'));

      zip.readEntry();
      zip.on('entry', (entry) => {
        const fileName = String(entry.fileName || '');
        const outPath = safeJoin(destDir, fileName);
        if (!outPath) {
          zip.readEntry();
          return;
        }

        if (/\/$/.test(fileName)) {
          fsp.mkdir(outPath, { recursive: true }).then(() => zip.readEntry()).catch(reject);
          return;
        }

        fsp.mkdir(path.dirname(outPath), { recursive: true })
          .then(() => new Promise((res2, rej2) => {
            zip.openReadStream(entry, (err2, stream) => {
              if (err2) return rej2(err2);
              const w = fs.createWriteStream(outPath);
              stream.on('error', rej2);
              w.on('error', rej2);
              w.on('finish', res2);
              stream.pipe(w);
            });
          }))
          .then(() => zip.readEntry())
          .catch(reject);
      });

      zip.on('end', () => resolve());
      zip.on('error', reject);
    });
  });
}

async function extractTgz(tgzPath, destDir) {
  await ensureDir(destDir);
  await tar.x({
    file: tgzPath,
    cwd: destDir,
    strip: 0,
    filter: (p) => {
      const cleaned = String(p || '').replace(/\\/g, '/');
      if (!cleaned) return false;
      if (cleaned.includes('..')) return false;
      if (cleaned.startsWith('/')) return false;
      return true;
    },
  });
}

async function readManifestFromDir(dir) {
  const candidates = [
    path.join(dir, 'language-plugin.json'),
    path.join(dir, 'language-plugin.manifest.json'),
  ];
  for (const p of candidates) {
    try {
      const raw = await fsp.readFile(p, 'utf8');
      const json = JSON.parse(raw);
      if (json && typeof json === 'object') return { manifest: json, manifestPath: p };
    } catch {
      // continue
    }
  }
  return { manifest: null, manifestPath: '' };
}

function resolveNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

async function runCommand(command, args, { cwd, env, onLine, logger } = {}) {
  const cmd = String(command || '').trim();
  if (!cmd) throw new Error('runCommand: command is required');
  const argv = (Array.isArray(args) ? args : []).map((a) => String(a ?? ''));

  const safeEnv = (() => {
    const merged = { ...(process.env || {}), ...(env && typeof env === 'object' ? env : {}) };
    const out = {};
    for (const [k, v] of Object.entries(merged)) {
      if (!k) continue;
      if (typeof v === 'string') out[k] = v;
      else if (v == null) continue;
      else out[k] = String(v);
    }
    return out;
  })();

  return await new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, {
      cwd: cwd ? String(cwd) : undefined,
      env: safeEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      // `.cmd` / `.bat` need a shell on Windows; otherwise spawn may throw EINVAL.
      shell: process.platform === 'win32',
    });

    const lines = (buf) => String(buf || '').split(/\r?\n/).filter(Boolean);
    child.stdout.on('data', (d) => lines(d).forEach((l) => onLine?.({ stream: 'stdout', line: l })));
    child.stderr.on('data', (d) => lines(d).forEach((l) => onLine?.({ stream: 'stderr', line: l })));

    child.on('error', (err) => reject(err));
    child.on('exit', (code) => {
      if (code === 0) return resolve({ code: 0 });
      const msg = `command failed (${code}): ${cmd} ${argv.join(' ')}`;
      logger?.warn?.(msg);
      reject(new Error(msg));
    });
  });
}

class PluginInstaller {
  constructor({ pluginsRootDir, downloadsDir, logger } = {}) {
    this.pluginsRootDir = String(pluginsRootDir || '').trim();
    this.downloadsDir = String(downloadsDir || '').trim();
    this.logger = logger;
  }

  _pluginInstallDir(pluginId, version) {
    return path.join(this.pluginsRootDir, 'plugins', String(pluginId || ''), String(version || ''));
  }

  async install(spec, { onProgress } = {}) {
    const pluginId = String(spec?.id || '').trim();
    if (!pluginId) throw new Error('plugin spec.id is required');
    const install = spec?.install || {};
    const kind = String(install.kind || '').trim();
    if (!kind) throw new Error('plugin spec.install.kind is required');

    const desiredVersion = String(spec?.version || '').trim() || 'latest';
    const installDir = this._pluginInstallDir(pluginId, desiredVersion);

    await rimraf(installDir);
    await ensureDir(installDir);

    if (kind === 'npm') {
      const packages = Array.isArray(install.packages) ? install.packages : [];
      if (!packages.length) throw new Error('npm install requires install.packages');

      const pkgJson = { name: `lsp-plugin-${pluginId}`, private: true };
      await fsp.writeFile(path.join(installDir, 'package.json'), JSON.stringify(pkgJson, null, 2), 'utf8');

      const npm = resolveNpmCommand();
      const args = [
        'install',
        '--no-audit',
        '--no-fund',
        '--silent',
        ...packages.map((p) => {
          const name = String(p?.name || '').trim();
          const ver = String(p?.version || '').trim();
          if (!name) throw new Error('npm package name required');
          return ver ? `${name}@${ver}` : name;
        }),
      ];

      onProgress?.({ stage: 'install', kind: 'npm', pluginId, detail: 'npm install' });
      await runCommand(npm, args, {
        cwd: installDir,
        onLine: ({ stream, line }) => onProgress?.({ stage: 'install', kind: 'npm', pluginId, stream, line }),
        logger: this.logger,
      });

      let resolvedVersion = desiredVersion;
      try {
        const first = packages[0];
        const pkgName = String(first?.name || '').trim();
        const pkgPath = path.join(installDir, 'node_modules', pkgName, 'package.json');
        const raw = await fsp.readFile(pkgPath, 'utf8');
        const json = JSON.parse(raw);
        if (json?.version) resolvedVersion = String(json.version);
      } catch {
        // ignore
      }

      const resolvedDir = this._pluginInstallDir(pluginId, resolvedVersion);
      if (resolvedDir !== installDir) {
        await ensureDir(path.dirname(resolvedDir));
        await rimraf(resolvedDir);
        await fsp.rename(installDir, resolvedDir);
      }

      const manifest = spec?.manifest && typeof spec.manifest === 'object' ? spec.manifest : null;
      await fsp.writeFile(path.join(resolvedDir, 'language-plugin.json'), JSON.stringify(manifest || {}, null, 2), 'utf8');

      return { pluginId, version: resolvedVersion, installDir: resolvedDir, manifest };
    }

    if (kind === 'archive' || kind === 'vsix') {
      const url = String(install.url || '').trim();
      const filePath = String(install.filePath || '').trim();
      const expectedSha256 = String(install.sha256 || '').trim().toLowerCase();
      const label = kind === 'vsix' ? 'VSIX' : 'archive';

      let archivePath = '';
      if (filePath) {
        archivePath = filePath;
      } else if (url) {
        const ext = path.extname(new URL(url).pathname || '') || (kind === 'vsix' ? '.vsix' : '.zip');
        const dlPath = path.join(this.downloadsDir, `${pluginId}-${desiredVersion}${ext}`);
        onProgress?.({ stage: 'download', kind, pluginId, url });
        const res = await downloadWithResume(url, dlPath, { onProgress, logger: this.logger });
        archivePath = res.filePath;
      } else {
        throw new Error(`${label} install requires install.url or install.filePath`);
      }

      if (expectedSha256) {
        onProgress?.({ stage: 'verify', kind, pluginId });
        const actual = sha256FileSync(archivePath);
        if (actual.toLowerCase() !== expectedSha256) {
          throw new Error(`sha256 mismatch: expected ${expectedSha256} got ${actual}`);
        }
      }

      onProgress?.({ stage: 'extract', kind, pluginId });
      const lower = archivePath.toLowerCase();
      if (lower.endsWith('.zip') || lower.endsWith('.vsix')) {
        await extractZip(archivePath, installDir);
      } else if (lower.endsWith('.tgz') || lower.endsWith('.tar.gz')) {
        await extractTgz(archivePath, installDir);
      } else {
        throw new Error(`unsupported archive type: ${archivePath}`);
      }

      const { manifest } = await readManifestFromDir(installDir);
      const finalManifest = manifest || (spec?.manifest && typeof spec.manifest === 'object' ? spec.manifest : null);
      if (finalManifest) {
        await fsp.writeFile(path.join(installDir, 'language-plugin.json'), JSON.stringify(finalManifest, null, 2), 'utf8');
      }

      return { pluginId, version: desiredVersion, installDir, manifest: finalManifest };
    }

    throw new Error(`unsupported install kind: ${kind}`);
  }
}

module.exports = { PluginInstaller, sha256FileSync, isPathInside, downloadWithResume };

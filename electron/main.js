const { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session } = require('electron');
const fs = require('fs');
const path = require('path');
const simpleGit = require('simple-git');
const { registerIpcHandlers } = require('./main/ipcHandlers');

const isDev = process.env.VITE_DEV_SERVER_URL || !app.isPackaged;

// Remove native application menu
Menu.setApplicationMenu(null);

const CSP = (
  "default-src 'self'; base-uri 'self'; object-src 'none'; " +
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: http: https:; " +
  "style-src 'self' 'unsafe-inline' http: https:; " +
  "img-src 'self' data: blob: http: https:; " +
  "font-src 'self' data: http: https:; " +
  "connect-src 'self' ws: wss: http: https:; " +
  "worker-src 'self' blob: data:; " +
  "frame-src 'self' blob: data: http: https:;"
);

function installCspHeaders() {
  try {
    const ses = session && session.defaultSession ? session.defaultSession : null;
    if (!ses || !ses.webRequest || typeof ses.webRequest.onHeadersReceived !== 'function') return;

    ses.webRequest.onHeadersReceived((details, callback) => {
      try {
        const type = details && details.resourceType ? String(details.resourceType) : '';
        if (type !== 'mainFrame' && type !== 'subFrame') {
          callback({ cancel: false, responseHeaders: details.responseHeaders });
          return;
        }

        const headers = details.responseHeaders || {};
        headers['Content-Security-Policy'] = [CSP];
        callback({ cancel: false, responseHeaders: headers });
      } catch {
        callback({ cancel: false, responseHeaders: details.responseHeaders });
      }
    });
  } catch {
    // ignore
  }
}

function createWindow() {
  const initialTheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';

  const win = new BrowserWindow({
    width: 1400,
    height: 800,
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
    win.webContents.once('devtools-opened', () => {
      const devtools = win.webContents.devToolsWebContents;
      if (!devtools) return;
      devtools.executeJavaScript(`
        try {
          localStorage.setItem('showSizeOnResize', 'false');
          localStorage.setItem('emulation.showSizeOnResize', 'false');
        } catch {}
      `, true).catch(() => {});
    });
  } else {
    const indexPath = path.join(__dirname, '../frontend/dist/index.html');
    win.loadFile(indexPath);
  }
}

app.whenReady().then(() => {
  registerIpcHandlers();
  installCspHeaders();

  ipcMain.handle('open-folder', async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths.length) return '';
    return res.filePaths[0];
  });

  ipcMain.on('renderer-theme-updated', (event, theme) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const nextTheme = theme === 'dark' ? 'dark' : 'light';
    nativeTheme.themeSource = nextTheme;
  });

  // --- Git IPC Handlers ---
  const handleGit = async (cwd, action) => {
    try {
      if (!cwd) throw new Error('No working directory specified');
      console.log(`[Git] Executing in ${cwd}`);
      const git = simpleGit(cwd);
      return await action(git);
    } catch (err) {
      const message = err && err.message ? String(err.message) : String(err);
      const lower = message.toLowerCase();
      const isExpectedState =
        lower.includes('no tracking information for the current branch') ||
        lower.includes('no configured push destination');
      if (isExpectedState) {
        console.warn('[Git] Expected state:', message);
      } else {
        console.error('[Git] Error:', message);
      }
      return { success: false, error: message };
    }
  };

  const normalizeGitPath = (value) => String(value || '').replace(/\\/g, '/');

  const sanitizeFolderName = (name) => {
    const raw = String(name || '').trim();
    if (!raw) return '';
    return raw.replace(/[\\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
  };

  const inferRepoFolderName = (url) => {
    const u = String(url || '').trim();
    if (!u) return 'repo';
    const last = u.split('/').pop() || u.split(':').pop() || 'repo';
    return sanitizeFolderName(last.replace(/\.git$/i, '')) || 'repo';
  };

  const ensureRepo = async (git) => {
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return false;
    }
    return true;
  };

  ipcMain.handle('git:status', (e, cwd) => handleGit(cwd, async (git) => {
    const isRepo = await ensureRepo(git);
    if (!isRepo) return { success: false, error: 'Not a git repository' };
    const status = await git.status();
    return { success: true, status: JSON.parse(JSON.stringify(status)) };
  }));

  ipcMain.handle('git:getRemotes', (e, cwd) => handleGit(cwd, async (git) => {
    const isRepo = await ensureRepo(git);
    if (!isRepo) return { success: false, error: 'Not a git repository' };
    const remotes = await git.getRemotes(true);
    return { success: true, remotes: JSON.parse(JSON.stringify(remotes)) };
  }));

  ipcMain.handle('git:addRemote', (e, { cwd, name, url }) => handleGit(cwd, async (git) => {
    const isRepo = await ensureRepo(git);
    if (!isRepo) return { success: false, error: 'Not a git repository' };
    await git.addRemote(name, url);
    return { success: true };
  }));

  ipcMain.handle('git:stage', (e, { cwd, files }) => handleGit(cwd, async (git) => {
    const isRepo = await ensureRepo(git);
    if (!isRepo) return { success: false, error: 'Not a git repository' };
    await git.add(files);
    return { success: true };
  }));

  ipcMain.handle('git:unstage', (e, { cwd, files }) => handleGit(cwd, async (git) => {
    const isRepo = await ensureRepo(git);
    if (!isRepo) return { success: false, error: 'Not a git repository' };

    const status = await git.status();
    const stagedFiles = status.files
      .filter(f => ['A', 'M', 'D', 'R'].includes(f.index))
      .map(f => f.path);

    if (stagedFiles.length === 0) {
      return { success: true };
    }

    let hasHead = true;
    try {
      await git.raw(['rev-parse', '--verify', 'HEAD']);
    } catch (err) {
      hasHead = false;
    }

    const isAll = files === '.' || files === undefined || files === null;
    const targetList = isAll ? stagedFiles : stagedFiles.filter(p => new Set(Array.isArray(files) ? files : [files]).has(p));

    if (targetList.length === 0) {
      return { success: true };
    }

    if (files === '.') {
      if (hasHead) {
        await git.reset(['HEAD']);
      } else {
        await git.raw(['restore', '--staged', '--', '.']);
      }
    } else {
      if (hasHead) {
        await git.reset(['HEAD', '--', ...targetList]);
      } else {
        await git.raw(['restore', '--staged', '--', ...targetList]);
      }
    }
    return { success: true };
  }));

  ipcMain.handle('git:restore', (e, { cwd, files }) => handleGit(cwd, async (git) => {
    const isRepo = await ensureRepo(git);
    if (!isRepo) return { success: false, error: 'Not a git repository' };
    await git.checkout(files);
    return { success: true };
  }));

  ipcMain.handle('git:commit', (e, { cwd, message }) => handleGit(cwd, async (git) => {
    const isRepo = await ensureRepo(git);
    if (!isRepo) return { success: false, error: 'Not a git repository' };
    const summary = await git.commit(message);
    return { success: true, summary: JSON.parse(JSON.stringify(summary)) };
  }));

  ipcMain.handle('git:push', (e, cwd) => handleGit(cwd, async (git) => {
    const isRepo = await ensureRepo(git);
    if (!isRepo) return { success: false, error: 'Not a git repository' };
    await git.push();
    return { success: true };
  }));

  ipcMain.handle('git:pull', (e, cwd) => handleGit(cwd, async (git) => {
    const isRepo = await ensureRepo(git);
    if (!isRepo) return { success: false, error: 'Not a git repository' };
    await git.pull({ '--rebase': 'true' });
    return { success: true };
  }));

  ipcMain.handle('git:fetch', (e, cwd) => handleGit(cwd, async (git) => {
    const isRepo = await ensureRepo(git);
    if (!isRepo) return { success: false, error: 'Not a git repository' };
    await git.fetch();
    return { success: true };
  }));

  ipcMain.handle('git:branch', (e, cwd) => handleGit(cwd, async (git) => {
    const isRepo = await ensureRepo(git);
    if (!isRepo) return { success: false, error: 'Not a git repository' };
    const branches = await git.branchLocal();
    return { success: true, branches: JSON.parse(JSON.stringify(branches)) };
  }));

  ipcMain.handle('git:createBranch', (e, { cwd, name }) => handleGit(cwd, async (git) => {
    const isRepo = await ensureRepo(git);
    if (!isRepo) return { success: false, error: 'Not a git repository' };
    await git.checkoutLocalBranch(name);
    return { success: true };
  }));

  ipcMain.handle('git:deleteBranch', (e, { cwd, branch }) => handleGit(cwd, async (git) => {
    const isRepo = await ensureRepo(git);
    if (!isRepo) return { success: false, error: 'Not a git repository' };
    try {
      await git.deleteLocalBranch(branch);
      return { success: true };
    } catch (err) {
      // Force delete if needed or return error
      return { success: false, error: err.message };
    }
  }));

  ipcMain.handle('git:checkout', (e, { cwd, branch }) => handleGit(cwd, async (git) => {
    const isRepo = await ensureRepo(git);
    if (!isRepo) return { success: false, error: 'Not a git repository' };
    await git.checkout(branch);
    return { success: true };
  }));

  ipcMain.handle('git:log', (e, cwd) => handleGit(cwd, async (git) => {
    try {
      const isRepo = await ensureRepo(git);
      if (!isRepo) {
        return {
          success: true,
          log: { all: [], latest: null, total: 0 },
        };
      }
      const log = await git.log({
        maxCount: 200,
        format: {
          hash: '%H',
          date: '%ai',
          message: '%s',
          refs: '%D',
          body: '%b',
          author_name: '%an',
          author_email: '%ae',
          parents: '%P',
        },
      });
      return { success: true, log: JSON.parse(JSON.stringify(log)) };
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      if (/does not have any commits yet/i.test(message)) {
        return {
          success: true,
          log: { all: [], latest: null, total: 0 },
        };
      }
      throw err;
    }
  }));

  ipcMain.handle('git:logFile', (e, { cwd, file }) => handleGit(cwd, async (git) => {
    try {
      const isRepo = await ensureRepo(git);
      if (!isRepo) {
        return {
          success: true,
          log: { all: [], latest: null, total: 0 },
        };
      }

      const rawFile = String(file || '').trim();
      if (!rawFile) {
        return {
          success: true,
          log: { all: [], latest: null, total: 0 },
        };
      }

      let target = rawFile;
      if (path.isAbsolute(target)) {
        target = path.relative(cwd, target);
      }
      target = normalizeGitPath(target);

      const log = await git.log({
        file: target,
        maxCount: 200,
        format: {
          hash: '%H',
          date: '%ai',
          message: '%s',
          refs: '%D',
          body: '%b',
          author_name: '%an',
          author_email: '%ae',
          parents: '%P',
        },
      });
      return { success: true, log: JSON.parse(JSON.stringify(log)) };
    } catch (err) {
      const message = err && err.message ? String(err.message) : String(err);
      if (
        /does not have any commits yet/i.test(message) ||
        /unknown revision or path not in the working tree/i.test(message) ||
        /pathspec/i.test(message)
      ) {
        return {
          success: true,
          log: { all: [], latest: null, total: 0 },
        };
      }
      throw err;
    }
  }));

  ipcMain.handle('git:publishBranch', (e, { cwd, branch }) => handleGit(cwd, async (git) => {
    const isRepo = await ensureRepo(git);
    if (!isRepo) return { success: false, error: 'Not a git repository' };
    const targetBranch = String(branch || '').trim();
    if (!targetBranch) return { success: false, error: 'No branch specified' };
    await git.raw(['push', '-u', 'origin', targetBranch]);
    return { success: true };
  }));

  ipcMain.handle('git:setUpstream', (e, { cwd, branch }) => handleGit(cwd, async (git) => {
    const isRepo = await ensureRepo(git);
    if (!isRepo) return { success: false, error: 'Not a git repository' };
    const targetBranch = String(branch || '').trim();
    if (!targetBranch) return { success: false, error: 'No branch specified' };
    await git.raw(['branch', '--set-upstream-to', `origin/${targetBranch}`, targetBranch]);
    return { success: true };
  }));
  
  ipcMain.handle('git:diff', (e, { cwd, file }) => handleGit(cwd, async (git) => {
     const isRepo = await ensureRepo(git);
     if (!isRepo) return { success: false, error: 'Not a git repository' };
     const diff = await git.diff(file ? [file] : []);
     return { success: true, diff: JSON.parse(JSON.stringify(diff)) };
  }));

  ipcMain.handle('git:resolve', (e, { cwd, file, type }) => handleGit(cwd, async (git) => {
    const isRepo = await ensureRepo(git);
    if (!isRepo) return { success: false, error: 'Not a git repository' };
    if (!['ours', 'theirs'].includes(type)) return { success: false, error: 'Invalid resolution type' };
    
    // Use checkout to resolve
    await git.checkout([`--${type}`, file]);
    // After checkout, we usually need to add the file to mark it as resolved
    await git.add([file]);
    
    return { success: true };
  }));

  ipcMain.handle('git:getCommitDetails', (e, { cwd, hash }) => handleGit(cwd, async (git) => {
    const isRepo = await ensureRepo(git);
    if (!isRepo) return { success: false, error: 'Not a git repository' };
    const raw = await git.raw(['show', '--name-status', '--pretty=format:', hash]);
    const lines = raw.trim().split('\n').filter(Boolean);
    const files = lines.map(line => {
      const [status, ...pathParts] = line.split(/\s+/);
      return { status, path: pathParts.join(' ') };
    });
    return { success: true, files };
  }));

  ipcMain.handle('git:getCommitStats', (e, { cwd, hash }) => handleGit(cwd, async (git) => {
    const isRepo = await ensureRepo(git);
    if (!isRepo) return { success: false, error: 'Not a git repository' };
    const raw = await git.raw(['show', '--shortstat', '--format=', hash]);
    const trimmed = raw.trim();
    if (!trimmed) return { success: true, stats: { files: 0, insertions: 0, deletions: 0 } };
    
    const filesMatch = trimmed.match(/(\d+) files? changed/);
    const insertionsMatch = trimmed.match(/(\d+) insertions?\(\+\)/);
    const deletionsMatch = trimmed.match(/(\d+) deletions?\(-\)/);
    
    return {
      success: true,
      stats: {
        files: filesMatch ? parseInt(filesMatch[1], 10) : 0,
        insertions: insertionsMatch ? parseInt(insertionsMatch[1], 10) : 0,
        deletions: deletionsMatch ? parseInt(deletionsMatch[1], 10) : 0
      }
    };
  }));

  ipcMain.handle('git:getCommitFileDiffs', (e, { cwd, hash }) => handleGit(cwd, async (git) => {
      const isRepo = await ensureRepo(git);
      if (!isRepo) return { success: false, error: 'Not a git repository' };
      const raw = await git.raw(['show', '--name-status', '--pretty=format:', hash]);
      const lines = raw.trim().split('\n').filter(Boolean);
      const files = lines.map(line => {
        const [status, ...pathParts] = line.split(/\s+/);
        return { status, path: pathParts.join(' ') };
      });

      // 2. Fetch diffs for each file
      const results = [];
      for (const file of files) {
          try {
              let before = '';
              let after = '';
              // For added files (A), before is empty.
              // For deleted files (D), after is empty.
              // For modified (M), both exist.
              
              if (file.status !== 'A') {
                  try {
                    before = await git.show([`${hash}~1:${file.path}`]);
                  } catch (e) { /* ignore if not found */ }
              }
              if (file.status !== 'D') {
                  try {
                    after = await git.show([`${hash}:${file.path}`]);
                  } catch (e) { /* ignore */ }
              }
              results.push({ ...file, before, after });
          } catch (err) {
              console.error(`Failed to fetch diff for ${file.path}`, err);
              results.push({ ...file, error: err.message });
          }
      }
      return { success: true, files: results };
  }));

  ipcMain.handle('git:getFileContent', (e, { cwd, hash, path }) => handleGit(cwd, async (git) => {
      try {
        const isRepo = await ensureRepo(git);
        if (!isRepo) return { success: false, error: 'Not a git repository' };
        const content = await git.show([`${hash}:${path}`]);
        return { success: true, content };
      } catch (err) {
        return { success: false, error: err.message };
      }
  }));

  ipcMain.handle('git:init', (e, cwd) => handleGit(cwd, async (git) => {
    await git.init();
    return { success: true };
  }));

  ipcMain.handle('git:clone', async (_e, payload) => {
    try {
      const parentDir = payload && payload.parentDir ? String(payload.parentDir) : '';
      const url = payload && payload.url ? String(payload.url) : '';
      const folderName = sanitizeFolderName(payload && payload.folderName ? String(payload.folderName) : '') || inferRepoFolderName(url);
      if (!parentDir) throw new Error('Missing destination folder');
      if (!url) throw new Error('Missing repository URL');
      const targetPath = path.join(parentDir, folderName);
      if (fs.existsSync(targetPath)) {
        throw new Error(`Target folder already exists: ${targetPath}`);
      }
      const git = simpleGit(parentDir);
      await git.clone(url, targetPath, ['--progress']);
      return { success: true, targetPath };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

const { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');
const simpleGit = require('simple-git');
const { registerIpcHandlers } = require('./main/ipcHandlers');

const isDev = process.env.VITE_DEV_SERVER_URL || !app.isPackaged;

const getOverlayColors = (theme = 'light') => {
  const isDark = theme === 'dark';
  return {
    color: isDark ? '#252526' : '#ffffff',
    symbolColor: isDark ? '#e5e7eb' : '#111827',
    height: 40,
  };
};

const applyOverlayTheme = (win, theme) => {
  if (!win?.setTitleBarOverlay) return;
  const overlay = getOverlayColors(theme);
  win.setTitleBarOverlay(overlay);
};

// Remove native application menu
Menu.setApplicationMenu(null);

function createWindow() {
  const initialTheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  const overlay = getOverlayColors(initialTheme);

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    titleBarStyle: 'hidden',
    titleBarOverlay: overlay,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  applyOverlayTheme(win, initialTheme);

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexPath = path.join(__dirname, '../frontend/dist/index.html');
    win.loadFile(indexPath);
  }
}

app.whenReady().then(() => {
  registerIpcHandlers();

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
    applyOverlayTheme(win, nextTheme);
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
      const log = await git.log({ maxCount: 50 });
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

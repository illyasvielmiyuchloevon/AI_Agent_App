const { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme } = require('electron');
const path = require('path');
const simpleGit = require('simple-git');

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
      console.error('[Git] Error:', err);
      return { success: false, error: err.message || String(err) };
    }
  };

  ipcMain.handle('git:status', (e, cwd) => handleGit(cwd, async (git) => {
    const isRepo = await git.checkIsRepo();
    if (!isRepo) return { success: false, error: 'Not a git repository' };
    const status = await git.status();
    return { success: true, status: JSON.parse(JSON.stringify(status)) };
  }));

  ipcMain.handle('git:getRemotes', (e, cwd) => handleGit(cwd, async (git) => {
    const remotes = await git.getRemotes(true);
    return { success: true, remotes: JSON.parse(JSON.stringify(remotes)) };
  }));

  ipcMain.handle('git:addRemote', (e, { cwd, name, url }) => handleGit(cwd, async (git) => {
    await git.addRemote(name, url);
    return { success: true };
  }));

  ipcMain.handle('git:stage', (e, { cwd, files }) => handleGit(cwd, async (git) => {
    await git.add(files);
    return { success: true };
  }));

  ipcMain.handle('git:unstage', (e, { cwd, files }) => handleGit(cwd, async (git) => {
    if (files === '.') {
      await git.reset(['HEAD']); // Unstage all
    } else {
      await git.reset(['HEAD', ...files]);
    }
    return { success: true };
  }));

  ipcMain.handle('git:restore', (e, { cwd, files }) => handleGit(cwd, async (git) => {
    // Discard changes in working directory
    // git checkout -- path/to/file
    await git.checkout(files);
    return { success: true };
  }));

  ipcMain.handle('git:commit', (e, { cwd, message }) => handleGit(cwd, async (git) => {
    const summary = await git.commit(message);
    return { success: true, summary: JSON.parse(JSON.stringify(summary)) };
  }));

  ipcMain.handle('git:push', (e, cwd) => handleGit(cwd, async (git) => {
    await git.push();
    return { success: true };
  }));

  ipcMain.handle('git:pull', (e, cwd) => handleGit(cwd, async (git) => {
    await git.pull();
    return { success: true };
  }));

  ipcMain.handle('git:fetch', (e, cwd) => handleGit(cwd, async (git) => {
    await git.fetch();
    return { success: true };
  }));

  ipcMain.handle('git:branch', (e, cwd) => handleGit(cwd, async (git) => {
    const branches = await git.branchLocal();
    return { success: true, branches: JSON.parse(JSON.stringify(branches)) };
  }));

  ipcMain.handle('git:checkout', (e, { cwd, branch }) => handleGit(cwd, async (git) => {
    await git.checkout(branch);
    return { success: true };
  }));

  ipcMain.handle('git:log', (e, cwd) => handleGit(cwd, async (git) => {
    const log = await git.log({ maxCount: 50 });
    return { success: true, log: JSON.parse(JSON.stringify(log)) };
  }));
  
  ipcMain.handle('git:diff', (e, { cwd, file }) => handleGit(cwd, async (git) => {
     // If file is provided, get diff for that file. If not, get all.
     // We want staged and unstaged changes usually.
     const diff = await git.diff(file ? [file] : []);
     return { success: true, diff: JSON.parse(JSON.stringify(diff)) };
  }));

  ipcMain.handle('git:getCommitDetails', (e, { cwd, hash }) => handleGit(cwd, async (git) => {
    // git show --name-status --pretty=format:"" <hash>
    const raw = await git.raw(['show', '--name-status', '--pretty=format:', hash]);
    const lines = raw.trim().split('\n').filter(Boolean);
    const files = lines.map(line => {
      const [status, ...pathParts] = line.split(/\s+/);
      return { status, path: pathParts.join(' ') };
    });
    return { success: true, files };
  }));

  ipcMain.handle('git:getCommitStats', (e, { cwd, hash }) => handleGit(cwd, async (git) => {
    // git show --shortstat --format="" <hash>
    // Output: " 3 files changed, 15 insertions(+), 5 deletions(-)"
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
      // 1. Get file list
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

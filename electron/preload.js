const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFolder: () => ipcRenderer.invoke('open-folder'),
  recent: {
    list: () => ipcRenderer.invoke('recent:list'),
    remove: (id) => ipcRenderer.invoke('recent:remove', id),
  },
  workspace: {
    pickFolder: () => ipcRenderer.invoke('workspace:pickFolder'),
    pickFile: () => ipcRenderer.invoke('workspace:pickFile'),
    open: (payload) => ipcRenderer.invoke('workspace:open', payload),
    close: () => ipcRenderer.invoke('workspace:close'),
  },
  setTitlebarTheme: (theme) => ipcRenderer.send('renderer-theme-updated', theme),
  git: {
    status: (cwd) => ipcRenderer.invoke('git:status', cwd),
    stage: (cwd, files) => ipcRenderer.invoke('git:stage', { cwd, files }),
    unstage: (cwd, files) => ipcRenderer.invoke('git:unstage', { cwd, files }),
    restore: (cwd, files) => ipcRenderer.invoke('git:restore', { cwd, files }),
    commit: (cwd, message) => ipcRenderer.invoke('git:commit', { cwd, message }),
    push: (cwd) => ipcRenderer.invoke('git:push', cwd),
    pull: (cwd) => ipcRenderer.invoke('git:pull', cwd),
    fetch: (cwd) => ipcRenderer.invoke('git:fetch', cwd),
    branch: (cwd) => ipcRenderer.invoke('git:branch', cwd),
    checkout: (cwd, branch) => ipcRenderer.invoke('git:checkout', { cwd, branch }),
    log: (cwd) => ipcRenderer.invoke('git:log', cwd),
    diff: (cwd, file) => ipcRenderer.invoke('git:diff', { cwd, file }),
    clone: (parentDir, url, folderName) => ipcRenderer.invoke('git:clone', { parentDir, url, folderName }),
    init: (cwd) => ipcRenderer.invoke('git:init', cwd),
    getRemotes: (cwd) => ipcRenderer.invoke('git:getRemotes', cwd),
    addRemote: (cwd, name, url) => ipcRenderer.invoke('git:addRemote', { cwd, name, url }),
    getCommitDetails: (cwd, hash) => ipcRenderer.invoke('git:getCommitDetails', { cwd, hash }),
    getCommitStats: (cwd, hash) => ipcRenderer.invoke('git:getCommitStats', { cwd, hash }),
    getCommitFileDiffs: (cwd, hash) => ipcRenderer.invoke('git:getCommitFileDiffs', { cwd, hash }),
    getFileContent: (cwd, hash, path) => ipcRenderer.invoke('git:getFileContent', { cwd, hash, path }),
  }
});

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFolder: () => ipcRenderer.invoke('open-folder'),
  setTitlebarTheme: (theme) => ipcRenderer.send('renderer-theme-updated', theme),
});

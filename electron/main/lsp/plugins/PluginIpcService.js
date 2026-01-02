function createPluginIpcService({ ipcMain, pluginManager, broadcast, ready } = {}) {
  if (!ipcMain) throw new Error('createPluginIpcService: ipcMain is required');
  if (!pluginManager) throw new Error('createPluginIpcService: pluginManager is required');
  const ensureReady = async () => {
    try {
      await ready;
    } catch {
      // ignore
    }
  };

  const ensureSenderSubscribed = (event) => {
    try {
      const wc = event?.sender;
      if (!wc) return;
      broadcast?.('__subscribeWebContents', wc);
    } catch {
      // ignore
    }
  };

  const emitError = (payload) => {
    try {
      broadcast?.('plugins:error', { ...payload, ts: Date.now() });
    } catch {
      // ignore
    }
  };

  ipcMain.handle('plugins:search', async (event, query, providerIds, options) => {
    ensureSenderSubscribed(event);
    await ensureReady();
    try {
      const items = await pluginManager.search({ query, providerIds, options });
      return { ok: true, items };
    } catch (err) {
      emitError({ action: 'search', message: err?.message || String(err) });
      throw err;
    }
  });

  ipcMain.handle('plugins:listInstalled', async (event) => {
    ensureSenderSubscribed(event);
    await ensureReady();
    try {
      return { ok: true, items: pluginManager.listInstalled() };
    } catch (err) {
      emitError({ action: 'listInstalled', message: err?.message || String(err) });
      throw err;
    }
  });

  ipcMain.handle('plugins:listUpdates', async (event) => {
    ensureSenderSubscribed(event);
    await ensureReady();
    try {
      return { ok: true, items: await pluginManager.listUpdates() };
    } catch (err) {
      emitError({ action: 'listUpdates', message: err?.message || String(err) });
      throw err;
    }
  });

  ipcMain.handle('plugins:install', async (event, ref) => {
    ensureSenderSubscribed(event);
    await ensureReady();
    try {
      const res = await pluginManager.install(ref, {
        onProgress: (p) => broadcast?.('plugins:progress', { ...p, ts: Date.now() }),
      });
      broadcast?.('plugins:changed', { items: pluginManager.listInstalled(), ts: Date.now() });
      return res;
    } catch (err) {
      emitError({ action: 'install', pluginId: ref?.id, message: err?.message || String(err) });
      throw err;
    }
  });

  ipcMain.handle('plugins:uninstall', async (event, id) => {
    ensureSenderSubscribed(event);
    await ensureReady();
    try {
      const res = await pluginManager.uninstall(id);
      broadcast?.('plugins:changed', { items: pluginManager.listInstalled(), ts: Date.now() });
      return res;
    } catch (err) {
      emitError({ action: 'uninstall', pluginId: id, message: err?.message || String(err) });
      throw err;
    }
  });

  ipcMain.handle('plugins:enable', async (event, id, trust) => {
    ensureSenderSubscribed(event);
    await ensureReady();
    try {
      const res = await pluginManager.enable(id, { trust });
      broadcast?.('plugins:changed', { items: pluginManager.listInstalled(), ts: Date.now() });
      return res;
    } catch (err) {
      emitError({ action: 'enable', pluginId: id, message: err?.message || String(err) });
      throw err;
    }
  });

  ipcMain.handle('plugins:disable', async (event, id) => {
    ensureSenderSubscribed(event);
    await ensureReady();
    try {
      const res = await pluginManager.disable(id);
      broadcast?.('plugins:changed', { items: pluginManager.listInstalled(), ts: Date.now() });
      return res;
    } catch (err) {
      emitError({ action: 'disable', pluginId: id, message: err?.message || String(err) });
      throw err;
    }
  });

  ipcMain.handle('plugins:doctor', async (event, id) => {
    ensureSenderSubscribed(event);
    await ensureReady();
    try {
      return pluginManager.doctor(id);
    } catch (err) {
      emitError({ action: 'doctor', pluginId: id, message: err?.message || String(err) });
      throw err;
    }
  });

  ipcMain.handle('plugins:listEnabledLanguages', async (event) => {
    ensureSenderSubscribed(event);
    await ensureReady();
    try {
      return { ok: true, items: pluginManager.listEnabledLanguages() };
    } catch (err) {
      emitError({ action: 'listEnabledLanguages', message: err?.message || String(err) });
      throw err;
    }
  });

  return { pluginManager };
}

module.exports = { createPluginIpcService };

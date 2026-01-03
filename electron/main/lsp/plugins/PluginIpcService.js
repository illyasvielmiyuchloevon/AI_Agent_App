function createPluginIpcService({ ipcMain, pluginManager, broadcast, notify, ready } = {}) {
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

  const notifyIdeBus = (method, params) => {
    try {
      notify?.(String(method || ''), params);
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
    notifyIdeBus('plugins/error', { ...payload, ts: Date.now() });
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

  ipcMain.handle('plugins:getDetails', async (event, id) => {
    ensureSenderSubscribed(event);
    await ensureReady();
    try {
      if (typeof pluginManager.getDetails !== 'function') return { ok: false, error: 'getDetails not supported' };
      return await pluginManager.getDetails(id);
    } catch (err) {
      emitError({ action: 'getDetails', pluginId: id, message: err?.message || String(err) });
      throw err;
    }
  });

  ipcMain.handle('plugins:getDetail', async (event, id, providerId, options) => {
    ensureSenderSubscribed(event);
    await ensureReady();
    try {
      if (typeof pluginManager.getDetail !== 'function') return { ok: false, error: 'getDetail not supported' };

      const resolvedProviderId = typeof providerId === 'string' ? providerId : undefined;
      const resolvedOptions =
        providerId && typeof providerId === 'object' && !Array.isArray(providerId) ? providerId : options && typeof options === 'object' ? options : undefined;

      const pluginId = id != null ? String(id) : '';
      const version = resolvedOptions?.version != null ? String(resolvedOptions.version) : undefined;
      const forceRefresh = !!resolvedOptions?.forceRefresh;

      if (!pluginId) return { ok: false, error: 'plugin id is required' };

      const timeoutMs = 30000;
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('request timeout')), timeoutMs);
      });

      const result = await Promise.race([
        pluginManager.getDetail({ id: pluginId, providerId: resolvedProviderId, version, forceRefresh }),
        timeoutPromise,
      ]);
      return result;
    } catch (err) {
      const message = err?.message || String(err);
      emitError({ action: 'getDetail', pluginId: id, message });
      return { ok: false, error: message };
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
        onProgress: (p) => {
          const payload = { ...p, ts: Date.now() };
          broadcast?.('plugins:progress', payload);
          notifyIdeBus('plugins/progress', payload);
        },
      });
      const changed = { items: pluginManager.listInstalled(), ts: Date.now() };
      broadcast?.('plugins:changed', changed);
      notifyIdeBus('plugins/changed', changed);
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
      const changed = { items: pluginManager.listInstalled(), ts: Date.now() };
      broadcast?.('plugins:changed', changed);
      notifyIdeBus('plugins/changed', changed);
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
      const changed = { items: pluginManager.listInstalled(), ts: Date.now() };
      broadcast?.('plugins:changed', changed);
      notifyIdeBus('plugins/changed', changed);
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
      const changed = { items: pluginManager.listInstalled(), ts: Date.now() };
      broadcast?.('plugins:changed', changed);
      notifyIdeBus('plugins/changed', changed);
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

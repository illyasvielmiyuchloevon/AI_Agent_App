const { LspManager } = require('./LspManager');
const { createLogger } = require('./util/logger');
const path = require('node:path');
const { toFileUri, fromFileUri } = require('./util/uri');

function createLspBroadcaster() {
  const subscribers = new Set();

  const subscribe = (webContents) => {
    if (!webContents) return;
    if (subscribers.has(webContents)) return;
    subscribers.add(webContents);
    try {
      webContents.once('destroyed', () => subscribers.delete(webContents));
    } catch {
      // ignore
    }
  };

  const broadcast = (channel, payload) => {
    if (channel === '__subscribeWebContents') {
      subscribe(payload);
      return;
    }
    for (const wc of Array.from(subscribers)) {
      try {
        wc.send(channel, payload);
      } catch {
        subscribers.delete(wc);
      }
    }
  };

  return { broadcast, subscribe };
}

function createLspMainService({ ipcMain, logger, broadcast, plugins } = {}) {
  if (!ipcMain) throw new Error('createLspMainService: ipcMain is required');

  const sink = (payload) => broadcast?.('lsp:log', payload);
  const log = logger || createLogger({ namespace: 'lsp', enabled: true, sink });

  const isCancelledError = (err) => String(err?.name || '') === 'CancelledError';

  let lastActiveWebContents = null;

  const applyEditPending = new Map(); // requestId -> { resolve, timer }
  let applyEditSeq = 1;
  const APPLY_EDIT_TIMEOUT_MS = 10_000;

  const requestApplyEditInRenderer = async ({ requestId, serverId, workspaceId, label, edit }) => {
    const wc = lastActiveWebContents;
    if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) {
      return { applied: false, failureReason: 'no active renderer window for applyEdit' };
    }

    return await new Promise((resolve) => {
      const id = String(requestId || '');
      const timer = setTimeout(() => {
        applyEditPending.delete(id);
        resolve({ applied: false, failureReason: `applyEdit timed out after ${APPLY_EDIT_TIMEOUT_MS}ms` });
      }, APPLY_EDIT_TIMEOUT_MS);
      applyEditPending.set(id, { resolve, timer });

      try {
        wc.send('lsp:applyEditRequest', { requestId: id, serverId, workspaceId, label, edit });
      } catch (err) {
        clearTimeout(timer);
        applyEditPending.delete(id);
        resolve({ applied: false, failureReason: err?.message || String(err) });
      }
    });
  };

  const manager = new LspManager({
    logger: log,
    onDiagnostics: (payload) => broadcast?.('lsp:diagnostics', payload),
    onLog: (payload) => broadcast?.('lsp:log', payload),
    onProgress: (payload) => broadcast?.('lsp:progress', payload),
    onServerStatus: (payload) => broadcast?.('lsp:serverStatus', payload),
    onCapabilitiesChanged: (payload) => broadcast?.('lsp:serverCapabilities', payload),
    getConfiguration: async () => undefined,
    applyWorkspaceEdit: async ({ serverId, workspaceId, label, edit }) => {
      const requestId = `ae_${Date.now()}_${applyEditSeq++}`;
      return requestApplyEditInRenderer({ requestId, serverId, workspaceId, label, edit });
    },
  });

  const pluginsReady = plugins?.ready;
  const pluginManager = plugins?.manager;

  const normalizeWorkspaceFromRenderer = (workspace) => {
    const ws = workspace && typeof workspace === 'object' ? workspace : {};
    const rootFsPath = String(ws.rootFsPath || '').trim();
    const wid = String(ws.workspaceId || '').trim();
    const foldersRaw = Array.isArray(ws.folders) ? ws.folders : [];
    const folders = foldersRaw
      .map((f) => {
        const name = String(f?.name || '').trim();
        const rawUri = String(f?.uri || '').trim();
        if (rawUri.startsWith('file:')) {
          const fsPath = fromFileUri(rawUri);
          const uri = fsPath ? toFileUri(fsPath) : rawUri;
          return { name, uri };
        }
        return { name, uri: rawUri };
      })
      .filter((f) => f.uri);

    if (!folders.length && rootFsPath) {
      const uri = toFileUri(rootFsPath);
      if (uri) folders.push({ name: path.basename(rootFsPath), uri });
    }

    let rootUri = String(ws.rootUri || '').trim();
    if (rootUri.startsWith('file:')) {
      const fsPath = fromFileUri(rootUri);
      rootUri = fsPath ? toFileUri(fsPath) : rootUri;
    }
    rootUri = rootUri || (rootFsPath ? toFileUri(rootFsPath) : '') || (folders[0]?.uri || '');
    return { workspaceId: wid, rootFsPath, rootUri, folders };
  };

  const resolveFileFsPath = (filePath, rootFsPath) => {
    const fp = String(filePath || '').trim();
    if (!fp) return '';
    if (fp.startsWith('file:')) return fromFileUri(fp);
    if (path.isAbsolute(fp)) return fp;
    const root = String(rootFsPath || '').trim();
    if (!root) return '';
    const rel = fp.replace(/^[\\/]+/, '');
    return path.join(root, rel);
  };

  const pickContainingRoot = (rootsFsPaths, fsPath) => {
    const p = String(fsPath || '').trim();
    if (!p) return '';
    const norm = (x) => {
      const s = String(x || '').trim().replace(/[\\\/]+$/, '');
      return process.platform === 'win32' ? s.toLowerCase() : s;
    };
    const np = norm(p);
    let best = '';
    for (const r of Array.isArray(rootsFsPaths) ? rootsFsPaths : []) {
      const nr = norm(r);
      if (!nr) continue;
      if (!np.startsWith(nr)) continue;
      if (!best || nr.length > norm(best).length) best = r;
    }
    return best;
  };

  const ensureSenderSubscribed = (event) => {
    try {
      const wc = event?.sender;
      if (!wc) return;
      lastActiveWebContents = wc;
      broadcast?.('__subscribeWebContents', wc);
    } catch {
      // ignore
    }
  };

  ipcMain.handle('lsp:ensureServer', async (event, workspaceId, languageId, serverConfig, workspace) => {
    ensureSenderSubscribed(event);
    return manager.ensureServer({ workspaceId, languageId, serverConfig, workspace });
  });

  ipcMain.handle('lsp:ensureServerForDocument', async (event, workspaceId, languageId, filePath, workspace) => {
    ensureSenderSubscribed(event);
    try {
      await pluginsReady;
    } catch {
      // ignore
    }
    if (!pluginManager) throw new Error('language plugins are not available');

    const wid = String(workspaceId || '').trim();
    const lang = String(languageId || '').trim();
    const preferred =
      manager.getWorkspaceSetting(wid, `_client.languagePlugins.${lang}`) ??
      manager.getWorkspaceSetting(wid, `languagePlugins.${lang}`) ??
      '';

    const normalizedWs = normalizeWorkspaceFromRenderer({ ...workspace, workspaceId: wid });
    const absFile = resolveFileFsPath(filePath, normalizedWs.rootFsPath);
    const roots = [
      String(normalizedWs.rootFsPath || '').trim(),
      ...normalizedWs.folders.map((f) => fromFileUri(f.uri)).filter(Boolean),
    ].filter(Boolean);
    const chosenRoot = pickContainingRoot(roots, absFile) || String(normalizedWs.rootFsPath || '').trim();
    const chosenRootUri = chosenRoot ? (toFileUri(chosenRoot) || normalizedWs.rootUri) : normalizedWs.rootUri;
    const workspaceForFile = {
      workspaceId: wid,
      rootFsPath: chosenRoot || normalizedWs.rootFsPath,
      rootUri: chosenRootUri,
      folders: normalizedWs.folders,
    };

    const resolvedMany = typeof pluginManager?.resolveServerConfigs === 'function'
      ? pluginManager.resolveServerConfigs({
          workspaceId: wid,
          languageId: lang,
          filePath: String(filePath || ''),
          preferredPluginId: String(preferred || ''),
        })
      : null;

    const resolvedOne = resolvedMany?.ok
      ? null
      : pluginManager.resolveServerConfig({
          workspaceId: wid,
          languageId: lang,
          filePath: String(filePath || ''),
          preferredPluginId: String(preferred || ''),
        });

    if (resolvedMany?.ok) {
      const configs = Array.isArray(resolvedMany.serverConfigs) ? resolvedMany.serverConfigs : [];
      if (!configs.length) throw new Error('plugin has no matching server');
      const ensured = await Promise.all(configs.map((cfg) => manager.ensureServer({ workspaceId: wid, languageId: lang, serverConfig: cfg, workspace: workspaceForFile })));
      const primaryIdx = Math.max(0, configs.findIndex((c) => String(c?.role || '').toLowerCase() === 'primary'));
      const serverIds = ensured.map((r) => String(r?.serverId || '')).filter(Boolean);
      const serverId = serverIds[primaryIdx] || serverIds[0] || '';
      return {
        serverId,
        serverIds,
        servers: serverIds.map((sid, i) => ({ serverId: sid, serverConfigId: configs[i]?.id, role: configs[i]?.role || '' })),
        plugin: resolvedMany.plugin,
      };
    }

    if (!resolvedOne?.ok) {
      const msg = resolvedOne?.error || 'no matching language plugin';
      try { broadcast?.('plugins:error', { pluginId: preferred || '', message: msg, ts: Date.now() }); } catch {}
      throw new Error(msg);
    }

    const res = await manager.ensureServer({ workspaceId: wid, languageId: lang, serverConfig: resolvedOne.serverConfig, workspace: workspaceForFile });
    return { ...res, serverIds: [res.serverId], servers: [{ serverId: res.serverId, serverConfigId: resolvedOne.serverConfig?.id, role: resolvedOne.serverConfig?.role || '' }], plugin: resolvedOne.plugin, serverConfigId: resolvedOne.serverConfig?.id };
  });

  ipcMain.handle('lsp:openDocument', async (event, serverId, doc) => {
    ensureSenderSubscribed(event);
    await manager.openDocument(serverId, doc);
    return { ok: true };
  });

  ipcMain.handle('lsp:changeDocument', async (event, serverId, change) => {
    ensureSenderSubscribed(event);
    await manager.changeDocument(serverId, change);
    return { ok: true };
  });

  ipcMain.handle('lsp:closeDocument', async (event, serverId, uri) => {
    ensureSenderSubscribed(event);
    await manager.closeDocument(serverId, uri);
    return { ok: true };
  });

  ipcMain.handle('lsp:completion', async (event, serverId, params, options) => {
    ensureSenderSubscribed(event);
    return manager.completion(serverId, params, options || {});
  });

  ipcMain.handle('lsp:completionResolve', async (event, serverId, item, docUri, options) => {
    ensureSenderSubscribed(event);
    return manager.completionResolve(serverId, item, docUri, options || {});
  });

  ipcMain.handle('lsp:hover', async (event, serverId, params, options) => {
    ensureSenderSubscribed(event);
    return manager.hover(serverId, params, options || {});
  });

  ipcMain.handle('lsp:definition', async (event, serverId, params, options) => {
    ensureSenderSubscribed(event);
    return manager.definition(serverId, params, options || {});
  });

  ipcMain.handle('lsp:declaration', async (event, serverId, params, options) => {
    ensureSenderSubscribed(event);
    return manager.declaration(serverId, params, options || {});
  });

  ipcMain.handle('lsp:references', async (event, serverId, params, options) => {
    ensureSenderSubscribed(event);
    return manager.references(serverId, params, options || {});
  });

  ipcMain.handle('lsp:codeAction', async (event, serverId, params, options) => {
    ensureSenderSubscribed(event);
    try {
      return await manager.codeAction(serverId, params, options || {});
    } catch (err) {
      if (isCancelledError(err)) return [];
      throw err;
    }
  });

  ipcMain.handle('lsp:codeActionResolve', async (event, serverId, action, docUri, options) => {
    ensureSenderSubscribed(event);
    try {
      return await manager.codeActionResolve(serverId, action, docUri, options || {});
    } catch (err) {
      if (isCancelledError(err)) return null;
      throw err;
    }
  });

  ipcMain.handle('lsp:signatureHelp', async (event, serverId, params, options) => {
    ensureSenderSubscribed(event);
    return manager.signatureHelp(serverId, params, options || {});
  });

  ipcMain.handle('lsp:rename', async (event, serverId, params, options) => {
    ensureSenderSubscribed(event);
    return manager.rename(serverId, params, options || {});
  });

  ipcMain.handle('lsp:format', async (event, serverId, params, options) => {
    ensureSenderSubscribed(event);
    return manager.format(serverId, params, options || {});
  });

  ipcMain.handle('lsp:rangeFormat', async (event, serverId, params, options) => {
    ensureSenderSubscribed(event);
    return manager.rangeFormat(serverId, params, options || {});
  });

  ipcMain.handle('lsp:executeCommand', async (event, serverId, params, options) => {
    ensureSenderSubscribed(event);
    return manager.executeCommand(serverId, params, options || {});
  });

  ipcMain.handle('lsp:workspaceSymbol', async (event, serverId, params, options) => {
    ensureSenderSubscribed(event);
    return manager.workspaceSymbol(serverId, params, options || {});
  });

  ipcMain.handle('lsp:documentSymbol', async (event, serverId, params, options) => {
    ensureSenderSubscribed(event);
    return manager.documentSymbol(serverId, params, options || {});
  });

  ipcMain.handle('lsp:documentColor', async (event, serverId, params, options) => {
    ensureSenderSubscribed(event);
    return manager.documentColor(serverId, params, options || {});
  });

  ipcMain.handle('lsp:colorPresentation', async (event, serverId, params, options) => {
    ensureSenderSubscribed(event);
    return manager.colorPresentation(serverId, params, options || {});
  });

  ipcMain.handle('lsp:linkedEditingRange', async (event, serverId, params, options) => {
    ensureSenderSubscribed(event);
    return manager.linkedEditingRange(serverId, params, options || {});
  });

  ipcMain.handle('lsp:saveDocument', async (event, serverId, params) => {
    ensureSenderSubscribed(event);
    await manager.saveDocument(serverId, params);
    return { ok: true };
  });

  ipcMain.handle('lsp:documentLink', async (event, serverId, params, options) => {
    ensureSenderSubscribed(event);
    return manager.documentLink(serverId, params, options || {});
  });

  ipcMain.handle('lsp:documentLinkResolve', async (event, serverId, link, docUri, options) => {
    ensureSenderSubscribed(event);
    return manager.documentLinkResolve(serverId, link, docUri, options || {});
  });

  ipcMain.handle('lsp:codeLens', async (event, serverId, params, options) => {
    ensureSenderSubscribed(event);
    return manager.codeLens(serverId, params, options || {});
  });

  ipcMain.handle('lsp:codeLensResolve', async (event, serverId, lens, docUri, options) => {
    ensureSenderSubscribed(event);
    return manager.codeLensResolve(serverId, lens, docUri, options || {});
  });

  ipcMain.handle('lsp:documentHighlight', async (event, serverId, params, options) => {
    ensureSenderSubscribed(event);
    return manager.documentHighlight(serverId, params, options || {});
  });

  ipcMain.handle('lsp:selectionRange', async (event, serverId, params, options) => {
    ensureSenderSubscribed(event);
    return manager.selectionRange(serverId, params, options || {});
  });

  ipcMain.handle('lsp:getServerCapabilities', async (event, serverId) => {
    ensureSenderSubscribed(event);
    return manager.getServerCapabilities(serverId);
  });

  ipcMain.handle('lsp:semanticTokensFull', async (event, serverId, params, options) => {
    ensureSenderSubscribed(event);
    return manager.semanticTokensFull(serverId, params, options || {});
  });

  ipcMain.handle('lsp:semanticTokensFullDelta', async (event, serverId, params, options) => {
    ensureSenderSubscribed(event);
    return manager.semanticTokensFullDelta(serverId, params, options || {});
  });

  ipcMain.handle('lsp:semanticTokensRange', async (event, serverId, params, options) => {
    ensureSenderSubscribed(event);
    return manager.semanticTokensRange(serverId, params, options || {});
  });

  ipcMain.handle('lsp:inlayHint', async (event, serverId, params, options) => {
    ensureSenderSubscribed(event);
    return manager.inlayHint(serverId, params, options || {});
  });

  ipcMain.handle('lsp:foldingRange', async (event, serverId, params, options) => {
    ensureSenderSubscribed(event);
    try {
      return await manager.foldingRange(serverId, params, options || {});
    } catch (err) {
      if (isCancelledError(err)) return [];
      throw err;
    }
  });

  ipcMain.handle('lsp:typeDefinition', async (event, serverId, params, options) => {
    ensureSenderSubscribed(event);
    return manager.typeDefinition(serverId, params, options || {});
  });

  ipcMain.handle('lsp:implementation', async (event, serverId, params, options) => {
    ensureSenderSubscribed(event);
    return manager.implementation(serverId, params, options || {});
  });

  ipcMain.handle('lsp:callHierarchyPrepare', async (event, serverId, params, options) => {
    ensureSenderSubscribed(event);
    return manager.callHierarchyPrepare(serverId, params, options || {});
  });

  ipcMain.handle('lsp:callHierarchyIncoming', async (event, serverId, params, options) => {
    ensureSenderSubscribed(event);
    return manager.callHierarchyIncoming(serverId, params, options || {});
  });

  ipcMain.handle('lsp:callHierarchyOutgoing', async (event, serverId, params, options) => {
    ensureSenderSubscribed(event);
    return manager.callHierarchyOutgoing(serverId, params, options || {});
  });

  ipcMain.handle('lsp:didChangeConfiguration', async (event, workspaceId, settings) => {
    ensureSenderSubscribed(event);
    await manager.didChangeConfiguration(workspaceId, settings);
    return { ok: true };
  });

  ipcMain.handle('lsp:willCreateFiles', async (event, workspaceId, params, options) => {
    ensureSenderSubscribed(event);
    return manager.willCreateFiles(workspaceId, params, options || {});
  });

  ipcMain.handle('lsp:didCreateFiles', async (event, workspaceId, params) => {
    ensureSenderSubscribed(event);
    return manager.didCreateFiles(workspaceId, params);
  });

  ipcMain.handle('lsp:willRenameFiles', async (event, workspaceId, params, options) => {
    ensureSenderSubscribed(event);
    return manager.willRenameFiles(workspaceId, params, options || {});
  });

  ipcMain.handle('lsp:didRenameFiles', async (event, workspaceId, params) => {
    ensureSenderSubscribed(event);
    return manager.didRenameFiles(workspaceId, params);
  });

  ipcMain.handle('lsp:willDeleteFiles', async (event, workspaceId, params, options) => {
    ensureSenderSubscribed(event);
    return manager.willDeleteFiles(workspaceId, params, options || {});
  });

  ipcMain.handle('lsp:didDeleteFiles', async (event, workspaceId, params) => {
    ensureSenderSubscribed(event);
    return manager.didDeleteFiles(workspaceId, params);
  });

  ipcMain.handle('lsp:applyEditResponse', async (event, requestId, result) => {
    ensureSenderSubscribed(event);
    const id = String(requestId || '');
    const pending = applyEditPending.get(id);
    if (!pending) return { ok: false };
    applyEditPending.delete(id);
    try { clearTimeout(pending.timer); } catch {}

    const applied = !!result?.applied;
    const failureReason = result?.failureReason ? String(result.failureReason) : undefined;
    pending.resolve({ applied, failureReason });
    return { ok: true };
  });

  ipcMain.handle('lsp:cancel', async (_event, token) => {
    return { ok: manager.cancel(token) };
  });

  return { manager, logger: log };
}

module.exports = { createLspMainService, createLspBroadcaster };

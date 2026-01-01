import {
  inferLanguageIdFromPath,
  resolveFsPath,
  toFileUri,
  toLspRangeFromMonacoRange,
} from '../adapters/toLsp';
import { guessIsWindows, fileUriToFsPath, toWorkspaceRelativePath } from '../util/fsPath';

export const createModelSync = ({
  bridge,
  supportedLanguageIds,
  ensureServerForLanguage,
  getRootFsPath,
} = {}) => {
  const docByModelPath = new Map();
  const modelPathByUri = new Map();

  const openModelIfNeeded = async (model) => {
    if (!model || !bridge?.isAvailable?.()) return;
    const modelPath = String(model.uri?.toString?.() || '');
    if (!modelPath) return;
    if (modelPath.startsWith('diff-tab-') || modelPath.startsWith('inmemory:')) return;

    const rootFsPath = String(getRootFsPath?.() || '').trim();
    if (!rootFsPath) return;

    const languageId = typeof model.getLanguageId === 'function'
      ? String(model.getLanguageId() || '')
      : inferLanguageIdFromPath(modelPath);
    if (!supportedLanguageIds?.has?.(languageId)) return;
    if (docByModelPath.has(modelPath)) return;

    const info = await ensureServerForLanguage?.(languageId, modelPath);
    const serverId = String(info?.serverId || '');
    const serverIds = Array.isArray(info?.serverIds) ? info.serverIds.map((x) => String(x || '')).filter(Boolean) : (serverId ? [serverId] : []);
    if (!serverId) return;

    const fsPath = resolveFsPath(rootFsPath, modelPath);
    const uri = toFileUri(fsPath);
    if (!uri) return;

    const doc = { uri, languageId, version: 1, text: model.getValue() };
    docByModelPath.set(modelPath, { uri, serverId, serverIds, languageId, version: 1 });
    modelPathByUri.set(uri, modelPath);

    const openTargets = serverIds.length ? serverIds : [serverId];
    for (const sid of openTargets) {
      await bridge.openDocument(sid, doc);
    }

    model.onDidChangeContent((e) => {
      const state = docByModelPath.get(modelPath);
      if (!state) return;
      state.version += 1;
      const contentChanges = (e?.changes || []).map((ch) => ({
        range: toLspRangeFromMonacoRange(ch.range),
        text: String(ch.text || ''),
      }));
      for (const sid of Array.isArray(state.serverIds) && state.serverIds.length ? state.serverIds : [serverId]) {
        void bridge.changeDocument(sid, {
          uri,
          version: state.version,
          contentChanges,
        }).catch(() => {});
      }
    });

    model.onWillDispose(() => {
      docByModelPath.delete(modelPath);
      modelPathByUri.delete(uri);
      for (const sid of serverIds.length ? serverIds : [serverId]) {
        void bridge.closeDocument(sid, uri).catch(() => {});
      }
    });
  };

  const getDocState = (model) => {
    const modelPath = String(model?.uri?.toString?.() || '');
    const state = docByModelPath.get(modelPath);
    if (!state) return null;
    return { modelPath, ...state };
  };

  const clearDocumentsAndClose = () => {
    const docs = Array.from(docByModelPath.values());
    docByModelPath.clear();
    modelPathByUri.clear();

    for (const s of docs) {
      const uri = String(s?.uri || '');
      const serverIds = Array.isArray(s?.serverIds) && s.serverIds.length ? s.serverIds : [String(s?.serverId || '')].filter(Boolean);
      if (!uri) continue;
      for (const sid of serverIds) {
        void bridge?.closeDocument?.(sid, uri).catch(() => {});
      }
    }
  };

  const didSavePath = async (relPath, text) => {
    if (!bridge?.isAvailable?.()) return { ok: false };
    const mp = String(relPath || '').trim();
    if (!mp) return { ok: false };

    const rootFsPath = String(getRootFsPath?.() || '').trim();
    if (!rootFsPath) return { ok: false };

    const direct = docByModelPath.get(mp);
    const state = direct?.uri
      ? direct
      : (() => {
        try {
          const fsPath = resolveFsPath(rootFsPath, mp);
          const uri = toFileUri(fsPath);
          const modelPath = uri ? modelPathByUri.get(uri) : '';
          return modelPath ? docByModelPath.get(modelPath) : null;
        } catch {
          return null;
        }
      })();

    if (!state?.uri) return { ok: true, skipped: true };
    const uri = String(state.uri);
    const serverIds = Array.isArray(state.serverIds) && state.serverIds.length ? state.serverIds : [String(state.serverId || '')].filter(Boolean);
    for (const sid of serverIds) {
      await bridge.saveDocument(sid, { uri, version: state.version, text: typeof text === 'string' ? text : undefined }).catch(() => {});
    }
    return { ok: true };
  };

  const didSaveAll = async () => {
    if (!bridge?.isAvailable?.()) return { ok: false };
    const entries = Array.from(docByModelPath.keys());
    for (const mp of entries) {
      await didSavePath(mp, undefined).catch(() => {});
    }
    return { ok: true };
  };

  const lspUriToModelPath = (uri) => {
    const u = String(uri || '');
    if (!u) return '';
    if (u.startsWith('file://')) {
      const rootFsPath = String(getRootFsPath?.() || '');
      const windows = guessIsWindows(rootFsPath);
      const fsPath = fileUriToFsPath(u, { windows });
      return toWorkspaceRelativePath(fsPath, rootFsPath) || u;
    }
    return u;
  };

  return {
    docByModelPath,
    modelPathByUri,
    openModelIfNeeded,
    getDocState,
    clearDocumentsAndClose,
    didSavePath,
    didSaveAll,
    lspUriToModelPath,
  };
};

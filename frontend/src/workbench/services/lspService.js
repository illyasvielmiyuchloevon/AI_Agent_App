import { LspUiBridge } from '../../lsp/LspUiBridge';
import { applyDiagnosticsToMonaco } from '../../lsp/features/diagnosticsUI';
import {
  inferLanguageIdFromPath,
  resolveFsPath,
  toFileUri,
  toLspPositionFromMonaco,
  toLspRangeFromMonacoRange,
} from '../../lsp/adapters/toLsp';
import { lspRangeToMonacoRange } from '../../lsp/adapters/fromLsp';
import { outputService } from './outputService';
import { applyLspTextEdits } from '../../lsp/util/textEdits';

const supportedLanguageIds = new Set(['typescript', 'javascript', 'python', 'rust', 'json']);

const guessIsWindows = (rootFsPath) => /[a-zA-Z]:\\/.test(String(rootFsPath || '')) || String(rootFsPath || '').includes('\\');

const fileUriToFsPath = (uri, { windows = false } = {}) => {
  const s = String(uri || '');
  if (!s.startsWith('file://')) return '';
  try {
    const u = new URL(s);
    const path = decodeURIComponent(u.pathname || '');
    if (windows) {
      const p = path.replace(/^\//, '').replace(/\//g, '\\');
      return p;
    }
    return path;
  } catch {
    return '';
  }
};

const toWorkspaceRelativePath = (fsPath, rootFsPath) => {
  const root = String(rootFsPath || '').trim();
  const full = String(fsPath || '').trim();
  if (!root || !full) return '';

  const windows = guessIsWindows(root);
  const norm = (p) => windows ? p.replace(/\//g, '\\') : p.replace(/\\/g, '/');
  const a = norm(root).replace(/[\\/]+$/, '');
  const b = norm(full);

  if (windows) {
    const lowerA = a.toLowerCase();
    const lowerB = b.toLowerCase();
    if (!lowerB.startsWith(lowerA)) return '';
    const rest = b.slice(a.length).replace(/^[\\/]+/, '');
    return rest.replace(/\\/g, '/');
  }

  if (!b.startsWith(a)) return '';
  const rest = b.slice(a.length).replace(/^[\\/]+/, '');
  return rest;
};

const lspKindToMonacoKind = (monaco, kind) => {
  const K = monaco?.languages?.CompletionItemKind;
  const k = Number(kind || 0);
  if (!K) return undefined;
  if (k === 2) return K.Method;
  if (k === 3) return K.Function;
  if (k === 4) return K.Constructor;
  if (k === 5) return K.Field;
  if (k === 6) return K.Variable;
  if (k === 7) return K.Class;
  if (k === 8) return K.Interface;
  if (k === 9) return K.Module;
  if (k === 10) return K.Property;
  if (k === 14) return K.Keyword;
  if (k === 15) return K.Snippet;
  if (k === 17) return K.File;
  if (k === 19) return K.Folder;
  return K.Text;
};

const normalizeCompletionItems = (result) => {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  if (Array.isArray(result.items)) return result.items;
  return [];
};

const SEMANTIC_TOKEN_TYPES = [
  'namespace',
  'type',
  'class',
  'enum',
  'interface',
  'struct',
  'typeParameter',
  'parameter',
  'variable',
  'property',
  'enumMember',
  'event',
  'function',
  'method',
  'macro',
  'keyword',
  'modifier',
  'comment',
  'string',
  'number',
  'regexp',
  'operator',
  'decorator',
];

const SEMANTIC_TOKEN_MODIFIERS = [
  'declaration',
  'definition',
  'readonly',
  'static',
  'deprecated',
  'abstract',
  'async',
  'modification',
  'documentation',
  'defaultLibrary',
];

export const lspService = (() => {
  const bridge = new LspUiBridge();

  let attached = false;
  let monacoRef = null;
  let workspaceId = 'default';
  let rootFsPath = '';
  let workspaceFolders = [];
  let uiContext = {
    getFiles: () => [],
    onFileChange: null,
    onOpenFile: null,
    onSyncStructure: null,
    getActiveGroupId: () => 'group-1',
  };

  const serverInfoByKey = new Map(); // `${workspaceId}::${rootFsPath}::${languageId}` -> { serverId, serverIds }
  const docByModelPath = new Map(); // modelPath -> { uri, serverId, languageId, version }
  const modelPathByUri = new Map(); // fileUri -> modelPath
  const serverCapsById = new Map(); // serverId -> capabilities
  const semanticTokenMapByServerId = new Map(); // serverId -> { tokenTypeIndexMap:number[], modifierBitMap:bigint[], supportsDelta:boolean, supportsRange:boolean }

  let cancelSeq = 1;
  let commandsRegistered = false;
  let lastConfigJson = '';

  const normalizeFsPath = (p) => {
    const s = String(p || '').trim().replace(/[\\\/]+$/, '');
    const isWin =
      (typeof process !== 'undefined' && process?.platform === 'win32') ||
      guessIsWindows(s) ||
      guessIsWindows(rootFsPath);
    return isWin ? s.toLowerCase() : s;
  };

  const pickContainingRootFsPath = (roots, fsPath) => {
    const p = String(fsPath || '').trim();
    if (!p) return '';
    const np = normalizeFsPath(p);
    let best = '';
    for (const r of Array.isArray(roots) ? roots : []) {
      const nr = normalizeFsPath(r);
      if (!nr) continue;
      if (!np.startsWith(nr)) continue;
      if (!best || nr.length > normalizeFsPath(best).length) best = r;
    }
    return best;
  };

  const buildWorkspacePayload = ({ chosenRootFsPath = '' } = {}) => {
    const root = String(chosenRootFsPath || rootFsPath || '').trim();
    const foldersFs = (Array.isArray(workspaceFolders) && workspaceFolders.length ? workspaceFolders : [rootFsPath])
      .map((x) => String(x || '').trim())
      .filter(Boolean);
    const seen = new Set();
    const uniq = [];
    for (const f of foldersFs) {
      const key = normalizeFsPath(f);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      uniq.push(f);
    }
    const folders = uniq.map((fsPath) => ({ name: fsPath.split(/[\\\/]/).filter(Boolean).pop() || fsPath, uri: toFileUri(fsPath) })).filter((f) => f.uri);
    return {
      workspaceId,
      rootFsPath: root || rootFsPath,
      rootUri: root ? toFileUri(root) : (rootFsPath ? toFileUri(rootFsPath) : ''),
      folders,
    };
  };

  const getServerCaps = async (serverId) => {
    const id = String(serverId || '');
    if (!id) return {};
    if (serverCapsById.has(id)) return serverCapsById.get(id) || {};
    const caps = await bridge.getServerCapabilities(id).catch(() => ({}));
    serverCapsById.set(id, caps || {});
    return caps || {};
  };

  const getSemanticTokenMap = async (serverId) => {
    const id = String(serverId || '');
    if (!id) return null;
    if (semanticTokenMapByServerId.has(id)) return semanticTokenMapByServerId.get(id);
    const caps = await getServerCaps(id);
    const p = caps?.semanticTokensProvider;
    const legend = p?.legend;
    const tokenTypes = Array.isArray(legend?.tokenTypes) ? legend.tokenTypes : [];
    const tokenModifiers = Array.isArray(legend?.tokenModifiers) ? legend.tokenModifiers : [];
    if (!tokenTypes.length) return null;

    const tokenTypeIndexMap = tokenTypes.map((name) => {
      const idx = SEMANTIC_TOKEN_TYPES.indexOf(String(name || ''));
      return idx >= 0 ? idx : 0;
    });

    const modifierBitMap = tokenModifiers.map((name) => {
      const idx = SEMANTIC_TOKEN_MODIFIERS.indexOf(String(name || ''));
      return idx >= 0 ? (1n << BigInt(idx)) : 0n;
    });

    const full = p?.full;
    const supportsDelta = !!(full && typeof full === 'object' && full.delta);
    const supportsRange = !!p?.range;

    const map = { tokenTypeIndexMap, modifierBitMap, supportsDelta, supportsRange };
    semanticTokenMapByServerId.set(id, map);
    return map;
  };

  const mapSemanticTokenData = (data, map) => {
    const src = Array.isArray(data) ? data : [];
    const out = new Uint32Array(src.length);
    for (let i = 0; i < src.length; i += 1) out[i] = Number(src[i] >>> 0);
    for (let i = 0; i + 4 < out.length; i += 5) {
      const serverType = Number(out[i + 3] >>> 0);
      const mappedType = map?.tokenTypeIndexMap?.[serverType];
      out[i + 3] = Number.isFinite(mappedType) ? mappedType : 0;

      const serverMods = BigInt(out[i + 4] >>> 0);
      let modsOut = 0n;
      for (let bit = 0; bit < (map?.modifierBitMap?.length || 0); bit += 1) {
        if (((serverMods >> BigInt(bit)) & 1n) === 1n) modsOut |= map.modifierBitMap[bit] || 0n;
      }
      out[i + 4] = Number(modsOut & 0xffffffffn);
    }
    return out;
  };

  const ensureServerForLanguage = async (languageId, filePath = '') => {
    const lang = String(languageId || '');
    if (!supportedLanguageIds.has(lang)) return '';

    const abs = filePath ? resolveFsPath(rootFsPath, String(filePath || '')) : String(rootFsPath || '');
    const chosenRoot = pickContainingRootFsPath(workspaceFolders, abs) || String(rootFsPath || '').trim();
    const cacheKey = `${workspaceId}::${chosenRoot}::${lang}`;
    const cached = serverInfoByKey.get(cacheKey);
    if (cached?.serverId) return cached;

    const workspace = buildWorkspacePayload({ chosenRootFsPath: chosenRoot });

    if (bridge?.api?.ensureServerForDocument) {
      const res = await bridge.ensureServerForDocument(workspaceId, lang, String(filePath || ''), workspace).catch((err) => {
        outputService.append('LSP', `[ERROR] ensureServer failed: ${err?.message || String(err)}`);
        return null;
      });
      const primary = String(res?.serverId || '');
      const all = Array.isArray(res?.serverIds) ? res.serverIds.map((x) => String(x || '')).filter(Boolean) : (primary ? [primary] : []);
      const info = { serverId: primary, serverIds: all.length ? all : (primary ? [primary] : []) };
      if (info.serverId) serverInfoByKey.set(cacheKey, info);
      return info;
    }

    // Back-compat fallback (legacy hardcoded server).
    const tslsConfig = {
      id: 'tsls',
      languageId: lang,
      transport: { kind: 'stdio', command: 'typescript-language-server', args: ['--stdio'] },
      fileExtensions: lang === 'typescript' ? ['.ts', '.tsx'] : ['.js', '.jsx'],
    };

    const res = await bridge.ensureServer(workspaceId, lang, tslsConfig, workspace).catch((err) => {
      outputService.append('LSP', `[ERROR] ensureServer (legacy) failed: ${err?.message || String(err)}`);
      return null;
    });
    const serverId = String(res?.serverId || '');
    const info = { serverId, serverIds: serverId ? [serverId] : [] };
    if (serverId) serverInfoByKey.set(cacheKey, info);
    return info;
  };

  const ensureAnyServer = async () => {
    const preferred = 'typescript';
    const info = await ensureServerForLanguage(preferred, '');
    if (info?.serverId) return info.serverId;
    // fallback: any cached server for this workspace
    for (const [key, value] of serverInfoByKey.entries()) {
      if (String(key || '').startsWith(`${workspaceId}::`) && value?.serverId) return value.serverId;
    }
    return '';
  };

  const didChangeConfiguration = async (settings) => {
    if (!bridge.isAvailable()) return { ok: false };
    const wid = String(workspaceId || '').trim();
    if (!wid) return { ok: false };
    const s = settings && typeof settings === 'object' ? settings : {};
    let json = '';
    try { json = JSON.stringify(s); } catch { json = ''; }
    if (json && json === lastConfigJson) return { ok: true, skipped: true };
    lastConfigJson = json;
    return bridge.didChangeConfiguration(wid, s);
  };

  const openModelIfNeeded = async (model) => {
    if (!model || !bridge.isAvailable()) return;
    const modelPath = String(model.uri?.toString?.() || '');
    if (!modelPath) return;
    if (modelPath.startsWith('diff-tab-') || modelPath.startsWith('inmemory:')) return;
    if (!String(rootFsPath || '').trim()) return;

    const languageId = typeof model.getLanguageId === 'function' ? String(model.getLanguageId() || '') : inferLanguageIdFromPath(modelPath);
    if (!supportedLanguageIds.has(languageId)) return;
    if (docByModelPath.has(modelPath)) return;

    const info = await ensureServerForLanguage(languageId, modelPath);
    const serverId = String(info?.serverId || '');
    const serverIds = Array.isArray(info?.serverIds) ? info.serverIds.map((x) => String(x || '')).filter(Boolean) : (serverId ? [serverId] : []);
    if (!serverId) return;

    const fsPath = resolveFsPath(rootFsPath, modelPath);
    const uri = toFileUri(fsPath);
    if (!uri) return;

    const doc = { uri, languageId, version: 1, text: model.getValue() };
    docByModelPath.set(modelPath, { uri, serverId, serverIds, languageId, version: 1 });
    modelPathByUri.set(uri, modelPath);
    for (const sid of serverIds.length ? serverIds : [serverId]) {
      // eslint-disable-next-line no-await-in-loop
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

  const applyWorkspaceEdit = async (edit, { preferOpenModels = true } = {}) => {
    const monaco = monacoRef;
    if (!monaco) return;
    const workspaceEdit = edit || {};

    const windows = guessIsWindows(rootFsPath);
    const fsPathToRel = (fsPath) => toWorkspaceRelativePath(fsPath, rootFsPath) || '';
    const uriToModelPath = (uri) => {
      const u = String(uri || '');
      if (!u) return '';
      if (u.startsWith('file://')) {
        const fsPath = fileUriToFsPath(u, { windows });
        return fsPathToRel(fsPath) || u;
      }
      return u;
    };

    const applyEditsToPath = async (modelPath, edits) => {
      const mp = String(modelPath || '');
      if (!mp) return;
      const resource = monaco.Uri.parse(mp);
      const model = preferOpenModels ? monaco.editor.getModel(resource) : null;
      if (model) {
        const operations = (Array.isArray(edits) ? edits : [])
          .map((e) => ({
            range: lspRangeToMonacoRange(monaco, e.range),
            text: String(e.newText ?? ''),
            forceMoveMarkers: true,
          }));
        try {
          model.pushEditOperations([], operations, () => null);
        } catch {
          // ignore
        }
        return;
      }

      const files = uiContext.getFiles?.() || [];
      const fileEntry = (Array.isArray(files) ? files : []).find((f) => String(f?.path || '') === mp);
      const current = fileEntry ? String(fileEntry.content || '') : '';
      const next = applyLspTextEdits(current, edits);
      const groupId = uiContext.getActiveGroupId?.() || 'group-1';
      if (typeof uiContext.onFileChange === 'function') {
        uiContext.onFileChange(mp, next, { groupId });
      }
    };

    const changes = workspaceEdit.changes && typeof workspaceEdit.changes === 'object' ? workspaceEdit.changes : null;
    if (changes) {
      for (const [uri, edits] of Object.entries(changes)) {
        // eslint-disable-next-line no-await-in-loop
        await applyEditsToPath(uriToModelPath(uri), edits);
      }
    }

    const documentChanges = Array.isArray(workspaceEdit.documentChanges) ? workspaceEdit.documentChanges : null;
    if (documentChanges) {
      for (const dc of documentChanges) {
        const kind = String(dc?.kind || '');
        if (kind) {
          // CreateFile/RenameFile/DeleteFile are ignored in Phase 1 (handled in Phase 2).
          continue;
        }
        const uri = dc?.textDocument?.uri;
        const edits = dc?.edits;
        if (!uri || !Array.isArray(edits)) continue;
        // eslint-disable-next-line no-await-in-loop
        await applyEditsToPath(uriToModelPath(uri), edits);
      }
    }

    if (typeof uiContext.onSyncStructure === 'function') {
      uiContext.onSyncStructure();
    }
  };

  const toLspDiagnosticFromMarker = (marker) => ({
    range: {
      start: { line: Math.max(0, Number(marker?.startLineNumber || 1) - 1), character: Math.max(0, Number(marker?.startColumn || 1) - 1) },
      end: { line: Math.max(0, Number(marker?.endLineNumber || 1) - 1), character: Math.max(0, Number(marker?.endColumn || 1) - 1) },
    },
    severity: marker?.severity === 8 ? 1 : (marker?.severity === 4 ? 2 : (marker?.severity === 2 ? 3 : 4)),
    source: marker?.owner || marker?.source || 'monaco',
    message: String(marker?.message || ''),
  });

  const registerProviders = (monaco) => {
    const languages = Array.from(supportedLanguageIds);
    const disposables = [];
    const completionPendingByKey = new Map(); // key -> { timer, resolve, cancelToken }
    const hoverPendingByKey = new Map(); // key -> { timer, resolve, cancelToken }
    const completionCacheByKey = new Map(); // key -> { ts, versionId, positionKey, value }
    const hoverCacheByKey = new Map(); // key -> { ts, versionId, positionKey, value }
    const COMPLETION_DEBOUNCE_MS = 90;
    const HOVER_DEBOUNCE_MS = 180;
    const COMPLETION_CACHE_MS = 160;
    const HOVER_CACHE_MS = 220;

    disposables.push(monaco.editor.registerEditorOpener({
      openCodeEditor: (_source, resource, selectionOrPosition) => {
        const windows = guessIsWindows(rootFsPath);
        const uri = resource?.toString?.() || '';
        let relPath = '';
        if (String(resource?.scheme || '') === 'file' || uri.startsWith('file://')) {
          const fsPath = fileUriToFsPath(uri, { windows });
          relPath = toWorkspaceRelativePath(fsPath, rootFsPath);
        } else {
          relPath = String(resource?.path || uri || '').replace(/^\//, '');
        }

        if (!relPath) return false;
        try {
          globalThis.window.dispatchEvent(new CustomEvent('workbench:openFile', { detail: { path: relPath } }));
          if (selectionOrPosition?.startLineNumber || selectionOrPosition?.lineNumber) {
            const line = Number(selectionOrPosition?.startLineNumber || selectionOrPosition?.lineNumber);
            const column = Number(selectionOrPosition?.startColumn || selectionOrPosition?.column || 1);
            setTimeout(() => {
              try {
                globalThis.window.dispatchEvent(new CustomEvent('workbench:revealInActiveEditor', { detail: { line, column } }));
              } catch {}
            }, 50);
          }
          return true;
        } catch {
          return false;
        }
      },
    }));

    for (const lang of languages) {
      disposables.push(monaco.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: ['.', '"', '\'', '/', '@', '<'],
        provideCompletionItems: async (model, position, _ctx, token) => {
          const state = getDocState(model);
          if (!state) return { suggestions: [] };

          const key = `${state.serverId}::${state.uri}`;
          const versionId = typeof model?.getVersionId === 'function' ? Number(model.getVersionId()) : 0;
          const positionKey = `${Number(position?.lineNumber || 0)}:${Number(position?.column || 0)}`;
          const cached = completionCacheByKey.get(key);
          if (cached && cached.versionId === versionId && cached.positionKey === positionKey && (Date.now() - cached.ts) <= COMPLETION_CACHE_MS) {
            return cached.value;
          }

          const prev = completionPendingByKey.get(key);
          if (prev) {
            completionPendingByKey.delete(key);
            try { clearTimeout(prev.timer); } catch {}
            try { prev.resolve({ suggestions: [] }); } catch {}
            try { if (prev.cancelToken) void bridge.cancel(prev.cancelToken); } catch {}
          }

          return await new Promise((resolve) => {
            const cancelToken = `c${cancelSeq++}`;
            const word = model.getWordUntilPosition(position);
            const defaultRange = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);

            const finishEmpty = () => resolve({ suggestions: [] });
            const timer = setTimeout(async () => {
              completionPendingByKey.delete(key);
              if (token?.isCancellationRequested) return finishEmpty();
              const nowVersionId = typeof model?.getVersionId === 'function' ? Number(model.getVersionId()) : 0;
              if (nowVersionId !== versionId) return finishEmpty();
              const params = { textDocument: { uri: state.uri }, position: toLspPositionFromMonaco(position) };
              const res = await bridge.completion(state.serverId, params, { timeoutMs: 2000, cancelToken }).catch((err) => {
                outputService.append('LSP', `[ERROR] completion failed: ${err?.message || String(err)}`);
                return null;
              });
              const items = normalizeCompletionItems(res);
              const suggestions = items.map((it) => {
                const insertText = String(it?.insertText || it?.label || '');
                const textEdit = it?.textEdit;
                const usesSnippet = Number(it?.insertTextFormat || 1) === 2;
                const itemRange = textEdit?.range ? lspRangeToMonacoRange(monaco, textEdit.range) : defaultRange;
                const additionalTextEdits = Array.isArray(it?.additionalTextEdits)
                  ? it.additionalTextEdits.map((e) => ({ range: lspRangeToMonacoRange(monaco, e.range), text: String(e.newText || '') }))
                  : undefined;

                const documentation = it?.documentation?.value || it?.documentation || '';
                return {
                  label: String(it?.label || ''),
                  kind: lspKindToMonacoKind(monaco, it?.kind),
                  detail: it?.detail ? String(it.detail) : undefined,
                  documentation: documentation ? String(documentation) : undefined,
                  insertText: textEdit?.newText ? String(textEdit.newText) : insertText,
                  range: itemRange,
                  insertTextRules: usesSnippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
                  additionalTextEdits,
                  data: { serverId: state.serverId, uri: state.uri, lspItem: it },
                };
              }).filter((s) => s.label);
              const value = { suggestions };
              completionCacheByKey.set(key, { ts: Date.now(), versionId, positionKey, value });
              resolve(value);
            }, COMPLETION_DEBOUNCE_MS);

            completionPendingByKey.set(key, { timer, resolve: finishEmpty, cancelToken });
            token?.onCancellationRequested?.(() => {
              const cur = completionPendingByKey.get(key);
              if (cur?.timer === timer) completionPendingByKey.delete(key);
              try { clearTimeout(timer); } catch {}
              try { void bridge.cancel(cancelToken); } catch {}
              finishEmpty();
            });
          });

        },
        resolveCompletionItem: async (item, token) => {
          const data = item?.data || null;
          const serverId = String(data?.serverId || '');
          const uri = String(data?.uri || '');
          const lspItem = data?.lspItem || null;
          if (!serverId || !uri || !lspItem) return item;
          const cancelToken = `cr${cancelSeq++}`;
          token?.onCancellationRequested?.(() => { void bridge.cancel(cancelToken); });
          const resolved = await bridge.completionResolve(serverId, lspItem, uri, { timeoutMs: 2000, cancelToken }).catch(() => null);
          if (!resolved || typeof resolved !== 'object') return item;

          const documentation = resolved?.documentation?.value || resolved?.documentation || '';
          const additionalTextEdits = Array.isArray(resolved?.additionalTextEdits)
            ? resolved.additionalTextEdits.map((e) => ({ range: lspRangeToMonacoRange(monaco, e.range), text: String(e.newText ?? '') }))
            : item.additionalTextEdits;

          return {
            ...item,
            detail: resolved?.detail ? String(resolved.detail) : item.detail,
            documentation: documentation ? String(documentation) : item.documentation,
            additionalTextEdits,
            data: { ...data, lspItem: resolved },
          };
        },
      }));

      disposables.push(monaco.languages.registerHoverProvider(lang, {
        provideHover: async (model, position, token) => {
          const state = getDocState(model);
          if (!state) return null;

          const key = `${state.serverId}::${state.uri}`;
          const versionId = typeof model?.getVersionId === 'function' ? Number(model.getVersionId()) : 0;
          const positionKey = `${Number(position?.lineNumber || 0)}:${Number(position?.column || 0)}`;
          const cached = hoverCacheByKey.get(key);
          if (cached && cached.versionId === versionId && cached.positionKey === positionKey && (Date.now() - cached.ts) <= HOVER_CACHE_MS) {
            return cached.value;
          }

          const prev = hoverPendingByKey.get(key);
          if (prev) {
            hoverPendingByKey.delete(key);
            try { clearTimeout(prev.timer); } catch {}
            try { prev.resolve(null); } catch {}
            try { if (prev.cancelToken) void bridge.cancel(prev.cancelToken); } catch {}
          }

          return await new Promise((resolve) => {
            const cancelToken = `h${cancelSeq++}`;
            const finishEmpty = () => resolve(null);
            const timer = setTimeout(async () => {
              hoverPendingByKey.delete(key);
              if (token?.isCancellationRequested) return finishEmpty();
              const nowVersionId = typeof model?.getVersionId === 'function' ? Number(model.getVersionId()) : 0;
              if (nowVersionId !== versionId) return finishEmpty();
              const params = { textDocument: { uri: state.uri }, position: toLspPositionFromMonaco(position) };
              const res = await bridge.hover(state.serverId, params, { timeoutMs: 2000, cancelToken }).catch((err) => {
                outputService.append('LSP', `[ERROR] hover failed: ${err?.message || String(err)}`);
                return null;
              });
              const contents = res?.contents;
              const markdown =
                typeof contents === 'string' ? contents :
                  (Array.isArray(contents) ? contents.map((c) => c?.value || c).filter(Boolean).join('\n\n') : (contents?.value || ''));

              if (!markdown) return resolve(null);
              const value = { contents: [{ value: String(markdown) }] };
              hoverCacheByKey.set(key, { ts: Date.now(), versionId, positionKey, value });
              resolve(value);
            }, HOVER_DEBOUNCE_MS);

            hoverPendingByKey.set(key, { timer, resolve: finishEmpty, cancelToken });
            token?.onCancellationRequested?.(() => {
              const cur = hoverPendingByKey.get(key);
              if (cur?.timer === timer) hoverPendingByKey.delete(key);
              try { clearTimeout(timer); } catch {}
              try { void bridge.cancel(cancelToken); } catch {}
              finishEmpty();
            });
          });
        },
      }));

      disposables.push(monaco.languages.registerReferenceProvider(lang, {
        provideReferences: async (model, position, context, token) => {
          const state = getDocState(model);
          if (!state) return [];
          const cancelToken = `r${cancelSeq++}`;
          token?.onCancellationRequested?.(() => { void bridge.cancel(cancelToken); });
          const params = {
            textDocument: { uri: state.uri },
            position: toLspPositionFromMonaco(position),
            context: { includeDeclaration: !!context?.includeDeclaration },
          };
          const res = await bridge.references(state.serverId, params, { timeoutMs: 4000, cancelToken }).catch((err) => {
            outputService.append('LSP', `[ERROR] references failed: ${err?.message || String(err)}`);
            return [];
          });
          const list = Array.isArray(res) ? res : (res ? [res] : []);
          const windows = guessIsWindows(rootFsPath);
          return list.map((loc) => {
            const uri = String(loc?.uri || '');
            const range = loc?.range;
            if (!uri || !range) return null;
            const fsPath = fileUriToFsPath(uri, { windows });
            const rel = toWorkspaceRelativePath(fsPath, rootFsPath);
            const targetModelPath = rel || uri;
            return { uri: monaco.Uri.parse(targetModelPath), range: lspRangeToMonacoRange(monaco, range) };
          }).filter(Boolean);
        },
      }));

      disposables.push(monaco.languages.registerRenameProvider(lang, {
        provideRenameEdits: async (model, position, newName, token) => {
          const state = getDocState(model);
          if (!state) return { edits: [] };
          const cancelToken = `n${cancelSeq++}`;
          token?.onCancellationRequested?.(() => { void bridge.cancel(cancelToken); });
          const params = { textDocument: { uri: state.uri }, position: toLspPositionFromMonaco(position), newName: String(newName || '') };
          const res = await bridge.rename(state.serverId, params, { timeoutMs: 5000, cancelToken }).catch(() => null);
          if (!res) return { edits: [] };

          const windows = guessIsWindows(rootFsPath);
          const edits = [];
          const addEditsForUri = (uri, lspEdits) => {
            const fsPath = fileUriToFsPath(uri, { windows });
            const rel = toWorkspaceRelativePath(fsPath, rootFsPath);
            const targetModelPath = rel || uri;
            for (const e of Array.isArray(lspEdits) ? lspEdits : []) {
              edits.push({
                resource: monaco.Uri.parse(targetModelPath),
                edit: { range: lspRangeToMonacoRange(monaco, e.range), text: String(e.newText ?? '') },
              });
            }
          };

          if (res.changes) {
            for (const [uri, lspEdits] of Object.entries(res.changes)) addEditsForUri(uri, lspEdits);
          }
          if (Array.isArray(res.documentChanges)) {
            for (const dc of res.documentChanges) {
              const kind = String(dc?.kind || '');
              if (kind) continue;
              if (dc?.textDocument?.uri && Array.isArray(dc.edits)) addEditsForUri(dc.textDocument.uri, dc.edits);
            }
          }
          return { edits };
        },
      }));

      disposables.push(monaco.languages.registerCodeActionProvider(lang, {
        providedCodeActionKinds: ['quickfix', 'refactor', 'source.organizeImports'],
        provideCodeActions: async (model, range, context, token) => {
          const state = getDocState(model);
          if (!state) return { actions: [], dispose: () => {} };
          const cancelToken = `a${cancelSeq++}`;
          token?.onCancellationRequested?.(() => { void bridge.cancel(cancelToken); });

          const markers = Array.isArray(context?.markers) ? context.markers : [];
          const diagnostics = markers.map(toLspDiagnosticFromMarker);
          const only = context?.only?.value ? String(context.only.value) : (context?.only ? String(context.only) : '');

          const params = {
            textDocument: { uri: state.uri },
            range: toLspRangeFromMonacoRange(range),
            context: { diagnostics, only: only ? [only] : undefined, triggerKind: 1 },
          };
          const res = await bridge.codeAction(state.serverId, params, { timeoutMs: 4000, cancelToken }).catch((err) => {
            outputService.append('LSP', `[ERROR] codeAction failed: ${err?.message || String(err)}`);
            return [];
          });
          const list = Array.isArray(res) ? res : [];
          const actions = list.map((item) => {
            const isCommand = item && item.command && !item.edit && !item.kind && !item.diagnostics;
            const action = isCommand ? { title: item.title, command: item } : item;
            const title = String(action?.title || '');
            if (!title) return null;
            return {
              title,
              kind: action?.kind ? String(action.kind) : undefined,
              isPreferred: !!action?.isPreferred,
              disabled: action?.disabled?.reason ? { reason: String(action.disabled.reason) } : undefined,
              data: { serverId: state.serverId, uri: state.uri, lspAction: action },
              command: {
                id: 'lsp.executeCodeAction',
                title,
                arguments: [{ serverId: state.serverId, action }],
              },
            };
          }).filter(Boolean);

          return { actions, dispose: () => {} };
        },
        resolveCodeAction: async (codeAction, token) => {
          const data = codeAction?.data || null;
          const serverId = String(data?.serverId || '');
          const uri = String(data?.uri || '');
          const lspAction = data?.lspAction || null;
          if (!serverId || !uri || !lspAction) return codeAction;
          const cancelToken = `car${cancelSeq++}`;
          token?.onCancellationRequested?.(() => { void bridge.cancel(cancelToken); });
          const resolved = await bridge.codeActionResolve(serverId, lspAction, uri, { timeoutMs: 4000, cancelToken }).catch(() => null);
          if (!resolved || typeof resolved !== 'object') return codeAction;
          const title = String(resolved?.title || codeAction?.title || '');
          return {
            ...codeAction,
            title,
            data: { ...data, lspAction: resolved },
            command: {
              id: 'lsp.executeCodeAction',
              title,
              arguments: [{ serverId, action: resolved }],
            },
          };
        },
      }));

      disposables.push(monaco.languages.registerSignatureHelpProvider(lang, {
        signatureHelpTriggerCharacters: ['(', ',', '<'],
        provideSignatureHelp: async (model, position, _token, context) => {
          const state = getDocState(model);
          if (!state) return { value: { signatures: [], activeSignature: 0, activeParameter: 0 }, dispose: () => {} };
          const cancelToken = `s${cancelSeq++}`;
          _token?.onCancellationRequested?.(() => { void bridge.cancel(cancelToken); });
          const params = {
            textDocument: { uri: state.uri },
            position: toLspPositionFromMonaco(position),
            context: {
              triggerKind: Number(context?.triggerKind || 1),
              triggerCharacter: context?.triggerCharacter ? String(context.triggerCharacter) : undefined,
              isRetrigger: !!context?.isRetrigger,
            },
          };
          const res = await bridge.signatureHelp(state.serverId, params, { timeoutMs: 2000, cancelToken }).catch(() => null);
          return { value: res || { signatures: [], activeSignature: 0, activeParameter: 0 }, dispose: () => {} };
        },
      }));

      disposables.push(monaco.languages.registerDocumentFormattingEditProvider(lang, {
        provideDocumentFormattingEdits: async (model, _options, token) => {
          const state = getDocState(model);
          if (!state) return [];
          const cancelToken = `f${cancelSeq++}`;
          token?.onCancellationRequested?.(() => { void bridge.cancel(cancelToken); });
          const opts = model.getOptions?.();
          const params = {
            textDocument: { uri: state.uri },
            options: { tabSize: opts?.tabSize || 4, insertSpaces: !!opts?.insertSpaces },
          };
          const res = await bridge.format(state.serverId, params, { timeoutMs: 5000, cancelToken }).catch(() => []);
          return (Array.isArray(res) ? res : []).map((e) => ({
            range: lspRangeToMonacoRange(monaco, e.range),
            text: String(e.newText ?? ''),
          }));
        },
      }));

      disposables.push(monaco.languages.registerDocumentRangeFormattingEditProvider(lang, {
        provideDocumentRangeFormattingEdits: async (model, range, _options, token) => {
          const state = getDocState(model);
          if (!state) return [];
          const cancelToken = `g${cancelSeq++}`;
          token?.onCancellationRequested?.(() => { void bridge.cancel(cancelToken); });
          const opts = model.getOptions?.();
          const params = {
            textDocument: { uri: state.uri },
            range: toLspRangeFromMonacoRange(range),
            options: { tabSize: opts?.tabSize || 4, insertSpaces: !!opts?.insertSpaces },
          };
          const res = await bridge.rangeFormat(state.serverId, params, { timeoutMs: 5000, cancelToken }).catch(() => []);
          return (Array.isArray(res) ? res : []).map((e) => ({
            range: lspRangeToMonacoRange(monaco, e.range),
            text: String(e.newText ?? ''),
          }));
        },
      }));

      disposables.push(monaco.languages.registerDefinitionProvider(lang, {
        provideDefinition: async (model, position, token) => {
          const state = getDocState(model);
          if (!state) return null;
          const cancelToken = `d${cancelSeq++}`;
          token?.onCancellationRequested?.(() => { void bridge.cancel(cancelToken); });
          const params = { textDocument: { uri: state.uri }, position: toLspPositionFromMonaco(position) };
          const res = await bridge.definition(state.serverId, params, { timeoutMs: 2000, cancelToken }).catch((err) => {
            outputService.append('LSP', `[ERROR] definition failed: ${err?.message || String(err)}`);
            return null;
          });
          const windows = guessIsWindows(rootFsPath);

          const toLocationLink = (loc) => {
            const targetUri = String(loc?.uri || loc?.targetUri || '');
            const fullRange = loc?.targetRange || loc?.range || loc?.targetSelectionRange;
            const selectionRange = loc?.targetSelectionRange || loc?.targetRange || loc?.range;
            if (!targetUri || !fullRange) return null;

            const fsPath = fileUriToFsPath(targetUri, { windows });
            const rel = toWorkspaceRelativePath(fsPath, rootFsPath);
            const targetModelPath = rel || targetUri;
            return {
              originSelectionRange: undefined,
              uri: monaco.Uri.parse(targetModelPath),
              range: lspRangeToMonacoRange(monaco, fullRange),
              targetSelectionRange: selectionRange ? lspRangeToMonacoRange(monaco, selectionRange) : undefined,
            };
          };

          const list = Array.isArray(res) ? res : (res ? [res] : []);
          return list.map(toLocationLink).filter(Boolean);
        },
      }));

      if (typeof monaco.languages.registerTypeDefinitionProvider === 'function') {
        disposables.push(monaco.languages.registerTypeDefinitionProvider(lang, {
          provideTypeDefinition: async (model, position, token) => {
            const state = getDocState(model);
            if (!state) return null;
            const cancelToken = `td${cancelSeq++}`;
            token?.onCancellationRequested?.(() => { void bridge.cancel(cancelToken); });
            const params = { textDocument: { uri: state.uri }, position: toLspPositionFromMonaco(position) };
            const res = await bridge.typeDefinition(state.serverId, params, { timeoutMs: 4000, cancelToken }).catch(() => null);
            const windows = guessIsWindows(rootFsPath);

            const toLocationLink = (loc) => {
              const targetUri = String(loc?.uri || loc?.targetUri || '');
              const fullRange = loc?.targetRange || loc?.range || loc?.targetSelectionRange;
              const selectionRange = loc?.targetSelectionRange || loc?.targetRange || loc?.range;
              if (!targetUri || !fullRange) return null;
              const fsPath = fileUriToFsPath(targetUri, { windows });
              const rel = toWorkspaceRelativePath(fsPath, rootFsPath);
              const targetModelPath = rel || targetUri;
              return {
                originSelectionRange: undefined,
                uri: monaco.Uri.parse(targetModelPath),
                range: lspRangeToMonacoRange(monaco, fullRange),
                targetSelectionRange: selectionRange ? lspRangeToMonacoRange(monaco, selectionRange) : undefined,
              };
            };

            const list = Array.isArray(res) ? res : (res ? [res] : []);
            return list.map(toLocationLink).filter(Boolean);
          },
        }));
      }

      if (typeof monaco.languages.registerImplementationProvider === 'function') {
        disposables.push(monaco.languages.registerImplementationProvider(lang, {
          provideImplementation: async (model, position, token) => {
            const state = getDocState(model);
            if (!state) return null;
            const cancelToken = `im${cancelSeq++}`;
            token?.onCancellationRequested?.(() => { void bridge.cancel(cancelToken); });
            const params = { textDocument: { uri: state.uri }, position: toLspPositionFromMonaco(position) };
            const res = await bridge.implementation(state.serverId, params, { timeoutMs: 4000, cancelToken }).catch(() => null);
            const windows = guessIsWindows(rootFsPath);

            const toLocationLink = (loc) => {
              const targetUri = String(loc?.uri || loc?.targetUri || '');
              const fullRange = loc?.targetRange || loc?.range || loc?.targetSelectionRange;
              const selectionRange = loc?.targetSelectionRange || loc?.targetRange || loc?.range;
              if (!targetUri || !fullRange) return null;
              const fsPath = fileUriToFsPath(targetUri, { windows });
              const rel = toWorkspaceRelativePath(fsPath, rootFsPath);
              const targetModelPath = rel || targetUri;
              return {
                originSelectionRange: undefined,
                uri: monaco.Uri.parse(targetModelPath),
                range: lspRangeToMonacoRange(monaco, fullRange),
                targetSelectionRange: selectionRange ? lspRangeToMonacoRange(monaco, selectionRange) : undefined,
              };
            };

            const list = Array.isArray(res) ? res : (res ? [res] : []);
            return list.map(toLocationLink).filter(Boolean);
          },
        }));
      }

      if (typeof monaco.languages.registerFoldingRangeProvider === 'function') {
        disposables.push(monaco.languages.registerFoldingRangeProvider(lang, {
          provideFoldingRanges: async (model, _context, token) => {
            const state = getDocState(model);
            if (!state) return [];
            const cancelToken = `fr${cancelSeq++}`;
            token?.onCancellationRequested?.(() => { void bridge.cancel(cancelToken); });
            const params = { textDocument: { uri: state.uri } };
            const res = await bridge.foldingRange(state.serverId, params, { timeoutMs: 4000, cancelToken }).catch(() => []);
            const list = Array.isArray(res) ? res : [];

            const kindMap = monaco?.languages?.FoldingRangeKind;
            const toKind = (k) => {
              const s = String(k || '');
              if (!kindMap || !s) return undefined;
              if (s === 'comment') return kindMap.Comment;
              if (s === 'imports') return kindMap.Imports;
              if (s === 'region') return kindMap.Region;
              return undefined;
            };

            return list.map((r) => {
              const start = Number(r?.startLine);
              const end = Number(r?.endLine);
              if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
              return {
                start: Math.max(1, start + 1),
                end: Math.max(1, end + 1),
                kind: toKind(r?.kind),
              };
            }).filter(Boolean);
          },
        }));
      }

      if (typeof monaco.languages.registerInlayHintsProvider === 'function') {
        disposables.push(monaco.languages.registerInlayHintsProvider(lang, {
          provideInlayHints: async (model, range, token) => {
            const state = getDocState(model);
            if (!state) return { hints: [], dispose: () => {} };
            const caps = await getServerCaps(state.serverId);
            if (!caps?.inlayHintProvider) return { hints: [], dispose: () => {} };
            const cancelToken = `ih${cancelSeq++}`;
            token?.onCancellationRequested?.(() => { void bridge.cancel(cancelToken); });
            const params = { textDocument: { uri: state.uri }, range: toLspRangeFromMonacoRange(range) };
            const res = await bridge.inlayHint(state.serverId, params, { timeoutMs: 4000, cancelToken }).catch(() => []);
            const list = Array.isArray(res) ? res : [];

            const kindMap = monaco?.languages?.InlayHintKind;
            const toKind = (k) => {
              const n = Number(k || 0);
              if (!kindMap) return undefined;
              if (n === 1) return kindMap.Type;
              if (n === 2) return kindMap.Parameter;
              return undefined;
            };

            const hints = list.map((h) => {
              const pos = h?.position;
              const line0 = Number(pos?.line);
              const ch0 = Number(pos?.character);
              if (!Number.isFinite(line0) || !Number.isFinite(ch0)) return null;
              const lineNumber = Math.max(1, line0 + 1);
              const maxCol = model.getLineMaxColumn(lineNumber);
              const column = Math.max(1, Math.min(maxCol, ch0 + 1));
              const label =
                typeof h?.label === 'string'
                  ? h.label
                  : (Array.isArray(h?.label) ? h.label.map((p) => p?.value || '').join('') : String(h?.label?.value || ''));
              if (!label) return null;

              const tooltip = h?.tooltip?.value || h?.tooltip || '';
              return {
                position: { lineNumber, column },
                label: String(label),
                kind: toKind(h?.kind),
                paddingLeft: !!h?.paddingLeft,
                paddingRight: !!h?.paddingRight,
                tooltip: tooltip ? String(tooltip) : undefined,
              };
            }).filter(Boolean);

            return { hints, dispose: () => {} };
          },
        }));
      }

      if (typeof monaco.languages.registerLinkProvider === 'function') {
        disposables.push(monaco.languages.registerLinkProvider(lang, {
          provideLinks: async (model, token) => {
            const state = getDocState(model);
            if (!state) return { links: [] };
            const caps = await getServerCaps(state.serverId);
            if (!caps?.documentLinkProvider) return { links: [] };
            const cancelToken = `dl${cancelSeq++}`;
            token?.onCancellationRequested?.(() => { void bridge.cancel(cancelToken); });
            const res = await bridge.documentLink(state.serverId, { textDocument: { uri: state.uri } }, { timeoutMs: 4000, cancelToken }).catch(() => []);
            const list = Array.isArray(res) ? res : [];
            const links = list.map((l) => {
              const range = l?.range ? lspRangeToMonacoRange(monaco, l.range) : null;
              const target = l?.target ? String(l.target) : '';
              if (!range) return null;
              return {
                range,
                url: target || undefined,
                tooltip: l?.tooltip ? String(l.tooltip) : undefined,
                data: { serverId: state.serverId, uri: state.uri, lspLink: l },
              };
            }).filter(Boolean);
            return { links };
          },
          resolveLink: async (link, token) => {
            const data = link?.data || null;
            const serverId = String(data?.serverId || '');
            const uri = String(data?.uri || '');
            const lspLink = data?.lspLink || null;
            if (!serverId || !uri || !lspLink) return link;
            const cancelToken = `dlr${cancelSeq++}`;
            token?.onCancellationRequested?.(() => { void bridge.cancel(cancelToken); });
            const resolved = await bridge.documentLinkResolve(serverId, lspLink, uri, { timeoutMs: 4000, cancelToken }).catch(() => null);
            if (!resolved || typeof resolved !== 'object') return link;
            const target = resolved?.target ? String(resolved.target) : '';
            return { ...link, url: target || link.url, data: { ...data, lspLink: resolved } };
          },
        }));
      }

      if (typeof monaco.languages.registerCodeLensProvider === 'function') {
        disposables.push(monaco.languages.registerCodeLensProvider(lang, {
          provideCodeLenses: async (model, token) => {
            const state = getDocState(model);
            if (!state) return { lenses: [], dispose: () => {} };
            const caps = await getServerCaps(state.serverId);
            if (!caps?.codeLensProvider) return { lenses: [], dispose: () => {} };
            const cancelToken = `cl${cancelSeq++}`;
            token?.onCancellationRequested?.(() => { void bridge.cancel(cancelToken); });
            const res = await bridge.codeLens(state.serverId, { textDocument: { uri: state.uri } }, { timeoutMs: 4000, cancelToken }).catch(() => []);
            const list = Array.isArray(res) ? res : [];
            const lenses = list.map((l) => {
              const range = l?.range ? lspRangeToMonacoRange(monaco, l.range) : null;
              if (!range) return null;
              const cmd = l?.command;
              const title = cmd?.title ? String(cmd.title) : '';
              const commandId = cmd?.command ? String(cmd.command) : '';
              return {
                range,
                command: commandId ? { id: 'lsp.executeServerCommand', title: title || commandId, arguments: [{ serverId: state.serverId, command: cmd }] } : undefined,
                data: { serverId: state.serverId, uri: state.uri, lspLens: l },
              };
            }).filter(Boolean);
            return { lenses, dispose: () => {} };
          },
          resolveCodeLens: async (lens, token) => {
            const data = lens?.data || null;
            const serverId = String(data?.serverId || '');
            const uri = String(data?.uri || '');
            const lspLens = data?.lspLens || null;
            if (!serverId || !uri || !lspLens) return lens;
            const cancelToken = `clr${cancelSeq++}`;
            token?.onCancellationRequested?.(() => { void bridge.cancel(cancelToken); });
            const resolved = await bridge.codeLensResolve(serverId, lspLens, uri, { timeoutMs: 4000, cancelToken }).catch(() => null);
            if (!resolved || typeof resolved !== 'object') return lens;
            const cmd = resolved?.command;
            const title = cmd?.title ? String(cmd.title) : '';
            const commandId = cmd?.command ? String(cmd.command) : '';
            return {
              ...lens,
              command: commandId ? { id: 'lsp.executeServerCommand', title: title || commandId, arguments: [{ serverId, command: cmd }] } : lens.command,
              data: { ...data, lspLens: resolved },
            };
          },
        }));
      }

      if (typeof monaco.languages.registerDocumentHighlightProvider === 'function') {
        disposables.push(monaco.languages.registerDocumentHighlightProvider(lang, {
          provideDocumentHighlights: async (model, position, token) => {
            const state = getDocState(model);
            if (!state) return [];
            const caps = await getServerCaps(state.serverId);
            if (!caps?.documentHighlightProvider) return [];
            const cancelToken = `dh${cancelSeq++}`;
            token?.onCancellationRequested?.(() => { void bridge.cancel(cancelToken); });
            const res = await bridge.documentHighlight(state.serverId, { textDocument: { uri: state.uri }, position: toLspPositionFromMonaco(position) }, { timeoutMs: 2000, cancelToken }).catch(() => []);
            const list = Array.isArray(res) ? res : [];
            const kindMap = monaco?.languages?.DocumentHighlightKind;
            return list.map((h) => {
              const range = h?.range ? lspRangeToMonacoRange(monaco, h.range) : null;
              if (!range) return null;
              const k = Number(h?.kind || 0);
              const kind = kindMap ? (k === 2 ? kindMap.Write : (k === 3 ? kindMap.Text : kindMap.Read)) : undefined;
              return { range, kind };
            }).filter(Boolean);
          },
        }));
      }

      if (typeof monaco.languages.registerSelectionRangeProvider === 'function') {
        disposables.push(monaco.languages.registerSelectionRangeProvider(lang, {
          provideSelectionRanges: async (model, positions, token) => {
            const state = getDocState(model);
            if (!state) return [];
            const caps = await getServerCaps(state.serverId);
            if (!caps?.selectionRangeProvider) return [];
            const cancelToken = `srp${cancelSeq++}`;
            token?.onCancellationRequested?.(() => { void bridge.cancel(cancelToken); });
            const params = {
              textDocument: { uri: state.uri },
              positions: (Array.isArray(positions) ? positions : []).map((p) => toLspPositionFromMonaco(p)),
            };
            const res = await bridge.selectionRange(state.serverId, params, { timeoutMs: 2000, cancelToken }).catch(() => []);
            const list = Array.isArray(res) ? res : [];
            const convertOne = (sr) => {
              if (!sr || typeof sr !== 'object' || !sr.range) return null;
              const next = { range: lspRangeToMonacoRange(monaco, sr.range) };
              if (sr.parent) next.parent = convertOne(sr.parent);
              return next;
            };
            return list.map(convertOne).filter(Boolean);
          },
        }));
      }

      if (typeof monaco.languages.registerDocumentSemanticTokensProvider === 'function') {
        const legend = monaco?.languages?.SemanticTokensLegend
          ? new monaco.languages.SemanticTokensLegend(SEMANTIC_TOKEN_TYPES, SEMANTIC_TOKEN_MODIFIERS)
          : { tokenTypes: SEMANTIC_TOKEN_TYPES, tokenModifiers: SEMANTIC_TOKEN_MODIFIERS };

        disposables.push(monaco.languages.registerDocumentSemanticTokensProvider(lang, {
          getLegend: () => legend,
          provideDocumentSemanticTokens: async (model, lastResultId, token) => {
            const state = getDocState(model);
            if (!state) return { data: new Uint32Array() };
            const map = await getSemanticTokenMap(state.serverId);
            if (!map) return { data: new Uint32Array() };

            const cancelToken = `st${cancelSeq++}`;
            token?.onCancellationRequested?.(() => { void bridge.cancel(cancelToken); });

            if (lastResultId && map.supportsDelta) {
              const deltaRes = await bridge.semanticTokensFullDelta(
                state.serverId,
                { textDocument: { uri: state.uri }, previousResultId: String(lastResultId) },
                { timeoutMs: 4000, cancelToken },
              ).catch(() => null);

              if (deltaRes && Array.isArray(deltaRes.edits)) {
                const edits = deltaRes.edits.map((e) => ({
                  start: Number(e?.start || 0),
                  deleteCount: Number(e?.deleteCount || 0),
                  data: Array.isArray(e?.data) ? mapSemanticTokenData(e.data, map) : undefined,
                }));
                return { resultId: deltaRes?.resultId ? String(deltaRes.resultId) : undefined, edits };
              }

              if (deltaRes && Array.isArray(deltaRes.data)) {
                return {
                  resultId: deltaRes?.resultId ? String(deltaRes.resultId) : undefined,
                  data: mapSemanticTokenData(deltaRes.data, map),
                };
              }
            }

            const fullRes = await bridge.semanticTokensFull(
              state.serverId,
              { textDocument: { uri: state.uri } },
              { timeoutMs: 4000, cancelToken },
            ).catch(() => null);

            const data = mapSemanticTokenData(fullRes?.data, map);
            return { resultId: fullRes?.resultId ? String(fullRes.resultId) : undefined, data };
          },
        }));

        if (typeof monaco.languages.registerDocumentRangeSemanticTokensProvider === 'function') {
          disposables.push(monaco.languages.registerDocumentRangeSemanticTokensProvider(lang, {
            getLegend: () => legend,
            provideDocumentRangeSemanticTokens: async (model, range, token) => {
              const state = getDocState(model);
              if (!state) return { data: new Uint32Array() };
              const map = await getSemanticTokenMap(state.serverId);
              if (!map || !map.supportsRange) return { data: new Uint32Array() };
              const cancelToken = `sr${cancelSeq++}`;
              token?.onCancellationRequested?.(() => { void bridge.cancel(cancelToken); });
              const res = await bridge.semanticTokensRange(
                state.serverId,
                { textDocument: { uri: state.uri }, range: toLspRangeFromMonacoRange(range) },
                { timeoutMs: 4000, cancelToken },
              ).catch(() => null);
              return { resultId: res?.resultId ? String(res.resultId) : undefined, data: mapSemanticTokenData(res?.data, map) };
            },
          }));
        }
      }
    }

    if (!commandsRegistered) {
      commandsRegistered = true;
      disposables.push(monaco.editor.registerCommand('lsp.executeCodeAction', async (_accessor, payload) => {
        const serverId = payload?.serverId ? String(payload.serverId) : '';
        const action = payload?.action || null;
        if (!serverId || !action) return;
        if (action.edit) await applyWorkspaceEdit(action.edit);
        if (action.command) {
          try {
            await bridge.executeCommand(serverId, { command: action.command.command, arguments: action.command.arguments || [] }, { timeoutMs: 8000 });
          } catch (err) {
            outputService.append('LSP', `[ERROR] executeCommand failed: ${err?.message || String(err)}`);
          }
        }
      }));

      disposables.push(monaco.editor.registerCommand('lsp.executeServerCommand', async (_accessor, payload) => {
        const serverId = payload?.serverId ? String(payload.serverId) : '';
        const cmd = payload?.command || null;
        if (!serverId || !cmd?.command) return;
        try {
          await bridge.executeCommand(serverId, { command: String(cmd.command), arguments: cmd.arguments || [] }, { timeoutMs: 8000 });
        } catch (err) {
          outputService.append('LSP', `[ERROR] executeCommand failed: ${err?.message || String(err)}`);
        }
      }));
    }

    return () => disposables.forEach((d) => d?.dispose?.());
  };

  const searchWorkspaceSymbols = async (query) => {
    const serverId = await ensureAnyServer();
    if (!serverId) return [];
    const res = await bridge.workspaceSymbol(serverId, { query: String(query || '') }, { timeoutMs: 4000 }).catch(() => []);
    const list = Array.isArray(res) ? res : [];
    const windows = guessIsWindows(rootFsPath);
    return list.map((s) => {
      const name = String(s?.name || '');
      const kind = Number(s?.kind || 0);
      const containerName = s?.containerName ? String(s.containerName) : '';
      const uri = String(s?.location?.uri || '');
      const range = s?.location?.range || null;
      const fsPath = uri.startsWith('file://') ? fileUriToFsPath(uri, { windows }) : '';
      const modelPath = fsPath ? (toWorkspaceRelativePath(fsPath, rootFsPath) || uri) : uri;
      return { name, kind, containerName, uri, range, modelPath };
    }).filter((x) => x.name && x.modelPath && x.range);
  };

  const searchDocumentSymbols = async (modelPath) => {
    const monaco = monacoRef;
    if (!monaco) return [];
    const mp = String(modelPath || '');
    if (!mp) return [];
    const model = monaco.editor.getModel(monaco.Uri.parse(mp));
    if (!model) return [];
    const state = getDocState(model);
    if (!state) return [];
    const res = await bridge.documentSymbol(state.serverId, { textDocument: { uri: state.uri } }, { timeoutMs: 4000 }).catch(() => []);
    const isSymbolInformation = (x) => x && typeof x === 'object' && x.location && x.location.uri && x.location.range;
    const flatten = (nodes, out) => {
      for (const n of Array.isArray(nodes) ? nodes : []) {
        if (!n) continue;
        if (isSymbolInformation(n)) {
          out.push({
            name: String(n.name || ''),
            kind: Number(n.kind || 0),
            containerName: n.containerName ? String(n.containerName) : '',
            uri: String(n.location.uri || ''),
            range: n.location.range,
            modelPath: mp,
          });
          continue;
        }
        out.push({
          name: String(n.name || ''),
          kind: Number(n.kind || 0),
          containerName: '',
          uri: '',
          range: n.selectionRange || n.range,
          modelPath: mp,
        });
        if (Array.isArray(n.children) && n.children.length) flatten(n.children, out);
      }
    };
    const out = [];
    flatten(Array.isArray(res) ? res : [], out);
    return out.filter((x) => x.name && x.modelPath && x.range);
  };

  const lspUriToModelPath = (uri) => {
    const u = String(uri || '');
    if (!u) return '';
    if (u.startsWith('file://')) {
      const windows = guessIsWindows(rootFsPath);
      const fsPath = fileUriToFsPath(u, { windows });
      return toWorkspaceRelativePath(fsPath, rootFsPath) || u;
    }
    return u;
  };

  const prepareCallHierarchy = async (model, position) => {
    const state = getDocState(model);
    if (!state) return { serverId: '', items: [] };
    const cancelToken = `chp${cancelSeq++}`;
    const params = { textDocument: { uri: state.uri }, position: toLspPositionFromMonaco(position) };
    const res = await bridge.callHierarchyPrepare(state.serverId, params, { timeoutMs: 4000, cancelToken }).catch(() => []);
    return { serverId: state.serverId, items: Array.isArray(res) ? res : [] };
  };

  const callHierarchyIncoming = async (serverId, item) => {
    const sid = String(serverId || '').trim();
    if (!sid || !item) return [];
    const cancelToken = `chi${cancelSeq++}`;
    const res = await bridge.callHierarchyIncoming(sid, { item }, { timeoutMs: 4000, cancelToken }).catch(() => []);
    return Array.isArray(res) ? res : [];
  };

  const callHierarchyOutgoing = async (serverId, item) => {
    const sid = String(serverId || '').trim();
    if (!sid || !item) return [];
    const cancelToken = `cho${cancelSeq++}`;
    const res = await bridge.callHierarchyOutgoing(sid, { item }, { timeoutMs: 4000, cancelToken }).catch(() => []);
    return Array.isArray(res) ? res : [];
  };

  const attachMonaco = (monaco, { nextWorkspaceId, nextRootFsPath, nextWorkspaceFolders } = {}, nextUiContext) => {
    if (!bridge.isAvailable()) return;
    if (!monaco || attached) return;
    attached = true;
    monacoRef = monaco;
    if (nextWorkspaceId) workspaceId = String(nextWorkspaceId);
    if (nextRootFsPath) rootFsPath = String(nextRootFsPath);
    if (Array.isArray(nextWorkspaceFolders)) workspaceFolders = nextWorkspaceFolders.map((x) => String(x || '').trim()).filter(Boolean);
    if (nextUiContext) uiContext = { ...uiContext, ...(nextUiContext || {}) };

    const disposeProviders = registerProviders(monaco);
    const disposeDiagnostics = bridge.onDiagnostics((payload) => {
      applyDiagnosticsToMonaco({
        monaco,
        modelPathByUri,
        uri: payload?.uri,
        diagnostics: payload?.diagnostics || [],
        owner: `lsp:${payload?.serverId || 'default'}`,
      });
    });
    outputService.ensureChannel('LSP', 'LSP');
    const disposeLog = bridge.onLog((payload) => {
      const level = String(payload?.level || 'info').toUpperCase();
      const server = payload?.serverId ? ` ${payload.serverId}` : '';
      outputService.append('LSP', `[${level}]${server} ${String(payload?.message || '').trim()}`);
    });
    const disposeApplyEdit = bridge.onApplyEditRequest(async (payload) => {
      const requestId = String(payload?.requestId || '').trim();
      if (!requestId) return;
      try {
        if (!monacoRef) throw new Error('monaco is not ready');
        await applyWorkspaceEdit(payload?.edit);
        await bridge.applyEditResponse(requestId, { applied: true });
      } catch (err) {
        try {
          await bridge.applyEditResponse(requestId, { applied: false, failureReason: err?.message || String(err) });
        } catch {
          // ignore
        }
      }
    });
    const disposeStatus = bridge.onServerStatus((payload) => {
      const server = payload?.serverId ? String(payload.serverId) : 'unknown';
      const status = String(payload?.status || '');
      const parts = [`[STATUS] ${server} ${status}`];
      if (payload?.elapsedMs) parts.push(`${Number(payload.elapsedMs)}ms`);
      if (payload?.timeoutMs) parts.push(`timeout=${Number(payload.timeoutMs)}ms`);
      if (payload?.error) parts.push(`error=${String(payload.error)}`);
      if (payload?.hint) parts.push(`hint=${String(payload.hint)}`);
      outputService.append('LSP', parts.join(' '));
      if (payload?.stderrTail) outputService.append('LSP', `[STDERR] ${server} ${String(payload.stderrTail)}`);
      try {
        globalThis.window.dispatchEvent(new CustomEvent('workbench:lspServerStatus', { detail: payload || {} }));
      } catch {
        // ignore
      }
    });
    const disposeCaps = bridge.onServerCapabilities((payload) => {
      const sid = String(payload?.serverId || '').trim();
      if (!sid) return;
      serverCapsById.set(sid, payload?.capabilities || {});
      semanticTokenMapByServerId.delete(sid);
      try {
        globalThis.window.dispatchEvent(new CustomEvent('workbench:lspServerCapabilities', { detail: payload || {} }));
      } catch {
        // ignore
      }
    });

    monaco.editor.onDidCreateModel((model) => {
      void openModelIfNeeded(model).catch(() => {});
    });

    // Best-effort: open already-existing models (e.g. initial tab).
    try {
      for (const m of monaco.editor.getModels()) {
        void openModelIfNeeded(m).catch(() => {});
      }
    } catch {
      // ignore
    }

    return () => {
      disposeProviders?.();
      disposeDiagnostics?.();
      disposeLog?.();
      disposeApplyEdit?.();
      disposeStatus?.();
      disposeCaps?.();
    };
  };

  const updateWorkspace = ({ nextWorkspaceId, nextRootFsPath, nextWorkspaceFolders } = {}) => {
    const prevWorkspaceId = workspaceId;
    const prevRootFsPath = rootFsPath;
    const prevFolders = Array.isArray(workspaceFolders) ? workspaceFolders.slice() : [];
    if (nextWorkspaceId) workspaceId = String(nextWorkspaceId);
    if (nextRootFsPath) rootFsPath = String(nextRootFsPath);
    if (Array.isArray(nextWorkspaceFolders)) workspaceFolders = nextWorkspaceFolders.map((x) => String(x || '').trim()).filter(Boolean);

    const rootReady = !!String(rootFsPath || '').trim();
    const prevRootReady = !!String(prevRootFsPath || '').trim();
    const sameWid = String(prevWorkspaceId || '') === String(workspaceId || '');
    const sameRoot = normalizeFsPath(prevRootFsPath) === normalizeFsPath(rootFsPath);
    const sameFolders = prevFolders.map(normalizeFsPath).join('|') === workspaceFolders.map(normalizeFsPath).join('|');
    const workspaceChanged = !(sameWid && sameRoot && sameFolders);

    const reopenModels = () => {
      const monaco = monacoRef;
      if (!attached || !rootReady || !monaco?.editor?.getModels) return;
      try {
        for (const m of monaco.editor.getModels()) {
          void openModelIfNeeded(m).catch(() => {});
        }
      } catch {
        // ignore
      }
    };

    if (workspaceChanged) {
      serverInfoByKey.clear();
      serverCapsById.clear();
      semanticTokenMapByServerId.clear();

      const docs = Array.from(docByModelPath.values());
      docByModelPath.clear();
      modelPathByUri.clear();

      for (const s of docs) {
        const uri = String(s?.uri || '');
        const serverIds = Array.isArray(s?.serverIds) && s.serverIds.length ? s.serverIds : [String(s?.serverId || '')].filter(Boolean);
        if (!uri) continue;
        for (const sid of serverIds) {
          void bridge.closeDocument(sid, uri).catch(() => {});
        }
      }

      reopenModels();
      return;
    }

    if (!prevRootReady && rootReady) {
      reopenModels();
    }
  };

  const updateUiContext = (next) => {
    uiContext = { ...uiContext, ...(next || {}) };
  };

  const didSavePath = async (relPath, text) => {
    if (!bridge.isAvailable()) return { ok: false };
    const mp = String(relPath || '').trim();
    if (!mp) return { ok: false };
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
      // eslint-disable-next-line no-await-in-loop
      await bridge.saveDocument(sid, { uri, version: state.version, text: typeof text === 'string' ? text : undefined }).catch(() => {});
    }
    return { ok: true };
  };

  const didSaveAll = async () => {
    if (!bridge.isAvailable()) return { ok: false };
    const entries = Array.from(docByModelPath.entries());
    for (const [mp, s] of entries) {
      // eslint-disable-next-line no-await-in-loop
      await didSavePath(mp, undefined).catch(() => {});
    }
    return { ok: true };
  };

  return {
    attachMonaco,
    updateWorkspace,
    updateUiContext,
    didChangeConfiguration,
    didSavePath,
    didSaveAll,
    searchWorkspaceSymbols,
    searchDocumentSymbols,
    lspUriToModelPath,
    prepareCallHierarchy,
    callHierarchyIncoming,
    callHierarchyOutgoing,
  };
})();

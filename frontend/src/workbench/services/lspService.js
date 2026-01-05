import { LspUiBridge } from '../../lsp/LspUiBridge';
import { applyDiagnosticsToMonaco } from '../../lsp/features/diagnosticsUI';
import {
  inferLanguageIdFromPath,
  resolveFsPath,
  toFileUri,
  toLspPositionFromMonaco,
  toLspRangeFromMonacoRange,
} from '../../lsp/adapters/toLsp';
import { lspDiagnosticToMonacoMarker, lspRangeToMonacoRange } from '../../lsp/adapters/fromLsp';
import { outputService } from './outputService';
import { applyLspTextEdits } from '../../lsp/util/textEdits';
import { guessIsWindows, fileUriToFsPath, fileUriToWorkspaceRelativePath, toWorkspaceRelativePath } from '../../lsp/util/fsPath';
import { createDebouncedCachedRequest } from '../../lsp/util/requestCache';
import { registerEditorOpener } from '../../lsp/monaco/registerEditorOpener';
import { registerLanguageFeatures } from '../../lsp/monaco/providers/registerLanguageFeatures';
import { registerSemanticTokens } from '../../lsp/monaco/providers/registerSemanticTokens';
import { registerLspCommands } from '../../lsp/monaco/commands/registerLspCommands';
import { createModelSync } from '../../lsp/monaco/modelSync';

const supportedLanguageIds = new Set(['typescript', 'javascript', 'python', 'rust', 'json']);

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
    onWorkspaceCreateFile: null,
    onWorkspaceRenamePath: null,
    onWorkspaceDeletePath: null,
    getActiveGroupId: () => 'group-1',
  };

  const serverInfoByKey = new Map(); // `${workspaceId}::${rootFsPath}::${languageId}` -> { serverId, serverIds }
  const ensureFailTsByKey = new Map(); // `${workspaceId}::${rootFsPath}::${languageId}` -> last failure ts
  const serverCapsById = new Map(); // serverId -> capabilities
  const semanticTokenMapByServerId = new Map(); // serverId -> { tokenTypeIndexMap:number[], modifierBitMap:bigint[], supportsDelta:boolean, supportsRange:boolean }

  let cancelSeq = 1;
  let commandsRegistered = false;
  let lastConfigJson = '';

  const normalizeFsPath = (p) => {
    const s = String(p || '').trim().replace(/[\\\/]+$/, '');
    const looksWindows = /^[a-zA-Z]:[\\/]/.test(s) || /^\\\\/.test(s) || s.includes('\\');
    return looksWindows ? s.toLowerCase() : s;
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
    const lastFail = ensureFailTsByKey.get(cacheKey) || 0;
    if (lastFail && Date.now() - lastFail < 15_000) return { serverId: '', serverIds: [] };
    const cached = serverInfoByKey.get(cacheKey);
    if (cached?.serverId) return cached;

    const workspace = buildWorkspacePayload({ chosenRootFsPath: chosenRoot });

    if (bridge?.api?.ensureServerForDocument) {
      const res = await bridge.ensureServerForDocument(workspaceId, lang, String(filePath || ''), workspace).catch((err) => {
        outputService.append('LSP', `[ERROR] ensureServer failed: ${err?.message || String(err)}`);
        return null;
      });
      if (res?.ok === false) {
        ensureFailTsByKey.set(cacheKey, Date.now());
        return { serverId: '', serverIds: [] };
      }
      const primary = String(res?.serverId || '');
      const all = Array.isArray(res?.serverIds) ? res.serverIds.map((x) => String(x || '')).filter(Boolean) : (primary ? [primary] : []);
      const info = { serverId: primary, serverIds: all.length ? all : (primary ? [primary] : []) };
      if (info.serverId) {
        ensureFailTsByKey.delete(cacheKey);
        serverInfoByKey.set(cacheKey, info);
      } else {
        ensureFailTsByKey.set(cacheKey, Date.now());
      }
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

  const modelSync = createModelSync({
    bridge,
    ideBus: globalThis?.window?.electronAPI?.ideBus || null,
    supportedLanguageIds,
    ensureServerForLanguage,
    getRootFsPath: () => rootFsPath,
  });

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

  const pathToFileUri = (relPath) => {
    const p = String(relPath || '').trim();
    if (!p) return '';
    if (!String(rootFsPath || '').trim()) return '';
    const fsPath = resolveFsPath(rootFsPath, p);
    return toFileUri(fsPath);
  };

  const willCreateFiles = async (paths, options = {}) => {
    if (!bridge.isAvailable()) return { ok: false };
    const wid = String(workspaceId || '').trim();
    if (!wid) return { ok: false };
    const files = (Array.isArray(paths) ? paths : [])
      .map((p) => ({ uri: pathToFileUri(p) }))
      .filter((x) => x.uri);
    if (!files.length) return { ok: true, skipped: true };
    return bridge.willCreateFiles(wid, { files }, options);
  };

  const didCreateFiles = async (paths) => {
    if (!bridge.isAvailable()) return { ok: false };
    const wid = String(workspaceId || '').trim();
    if (!wid) return { ok: false };
    const files = (Array.isArray(paths) ? paths : [])
      .map((p) => ({ uri: pathToFileUri(p) }))
      .filter((x) => x.uri);
    if (!files.length) return { ok: true, skipped: true };
    return bridge.didCreateFiles(wid, { files });
  };

  const willRenameFiles = async (pairs, options = {}) => {
    if (!bridge.isAvailable()) return { ok: false };
    const wid = String(workspaceId || '').trim();
    if (!wid) return { ok: false };
    const files = (Array.isArray(pairs) ? pairs : [])
      .map((p) => {
        const oldPath = String(p?.from || p?.oldPath || '').trim();
        const newPath = String(p?.to || p?.newPath || '').trim();
        const oldUri = pathToFileUri(oldPath);
        const newUri = pathToFileUri(newPath);
        if (!oldUri || !newUri) return null;
        return { oldUri, newUri };
      })
      .filter(Boolean);
    if (!files.length) return { ok: true, skipped: true };
    return bridge.willRenameFiles(wid, { files }, options);
  };

  const didRenameFiles = async (pairs) => {
    if (!bridge.isAvailable()) return { ok: false };
    const wid = String(workspaceId || '').trim();
    if (!wid) return { ok: false };
    const files = (Array.isArray(pairs) ? pairs : [])
      .map((p) => {
        const oldPath = String(p?.from || p?.oldPath || '').trim();
        const newPath = String(p?.to || p?.newPath || '').trim();
        const oldUri = pathToFileUri(oldPath);
        const newUri = pathToFileUri(newPath);
        if (!oldUri || !newUri) return null;
        return { oldUri, newUri };
      })
      .filter(Boolean);
    if (!files.length) return { ok: true, skipped: true };
    return bridge.didRenameFiles(wid, { files });
  };

  const willDeleteFiles = async (paths, options = {}) => {
    if (!bridge.isAvailable()) return { ok: false };
    const wid = String(workspaceId || '').trim();
    if (!wid) return { ok: false };
    const files = (Array.isArray(paths) ? paths : [])
      .map((p) => ({ uri: pathToFileUri(p) }))
      .filter((x) => x.uri);
    if (!files.length) return { ok: true, skipped: true };
    return bridge.willDeleteFiles(wid, { files }, options);
  };

  const didDeleteFiles = async (paths) => {
    if (!bridge.isAvailable()) return { ok: false };
    const wid = String(workspaceId || '').trim();
    if (!wid) return { ok: false };
    const files = (Array.isArray(paths) ? paths : [])
      .map((p) => ({ uri: pathToFileUri(p) }))
      .filter((x) => x.uri);
    if (!files.length) return { ok: true, skipped: true };
    return bridge.didDeleteFiles(wid, { files });
  };

  let UndoRedoGroupClass = null;

  const getUndoRedoGroupInstance = async () => {
    if (UndoRedoGroupClass) return new UndoRedoGroupClass();
    try {
      const mod = await import('monaco-editor/esm/vs/platform/undoRedo/common/undoRedo.js');
      UndoRedoGroupClass = mod?.UndoRedoGroup || null;
    } catch {
      UndoRedoGroupClass = null;
    }
    return UndoRedoGroupClass ? new UndoRedoGroupClass() : null;
  };

  const applyWorkspaceEdit = async (edit, { preferOpenModels = true } = {}) => {
    const monaco = monacoRef;
    if (!monaco) return;
    const workspaceEdit = edit || {};

    const getEffectiveRootFsPath = () => {
      const direct = String(rootFsPath || '').trim();
      if (direct) return direct;
      try {
        const w = globalThis?.window;
        const fromWindow = w?.__NODE_AGENT_WORKSPACE_ROOT__ || w?.__NODE_AGENT_WORKSPACE_ROOT;
        return String(fromWindow || '').trim();
      } catch {
        return '';
      }
    };

    const effectiveRootFsPath = getEffectiveRootFsPath();
    const windows = guessIsWindows(effectiveRootFsPath || rootFsPath);

    const normalizeTextEdit = (e) => {
      if (!e || typeof e !== 'object') return null;
      const range = e.range || e.replace || e.insert || null;
      if (!range || !range.start || !range.end) return null;
      const newText = typeof e.newText === 'string' ? e.newText : (typeof e.text === 'string' ? e.text : '');
      return { range, newText };
    };

    const looksAbsolutePath = (p) => {
      const s = String(p || '').trim();
      if (!s) return false;
      if (windows) return /^[a-zA-Z]:[\\/]/.test(s) || s.startsWith('\\\\');
      return s.startsWith('/');
    };

    const uriToModelPath = (uri) => {
      const u = String(uri || '').trim();
      if (!u) return '';
      if (/^file:\/\//i.test(u)) {
        const fsPath = fileUriToFsPath(u, { windows });
        if (!fsPath) return '';
        const roots = (Array.isArray(workspaceFolders) && workspaceFolders.length ? workspaceFolders : [effectiveRootFsPath])
          .map((x) => String(x || '').trim())
          .filter(Boolean);
        const chosenRoot = pickContainingRootFsPath(roots, fsPath) || effectiveRootFsPath;
        const rel = toWorkspaceRelativePath(fsPath, chosenRoot);
        const relOut = String(rel || '').trim();
        if (relOut) return relOut;
        return String(fileUriToWorkspaceRelativePath(u, chosenRoot) || '').trim();
      }
      if (looksAbsolutePath(u)) {
        const roots = (Array.isArray(workspaceFolders) && workspaceFolders.length ? workspaceFolders : [effectiveRootFsPath])
          .map((x) => String(x || '').trim())
          .filter(Boolean);
        const chosenRoot = pickContainingRootFsPath(roots, u) || effectiveRootFsPath;
        const rel = toWorkspaceRelativePath(u, chosenRoot);
        return String(rel || '').trim();
      }
      return u;
    };

    let fileOpsTouched = false;

    const createPathIfSupported = async (modelPath, meta = {}) => {
      const mp = String(modelPath || '').trim();
      if (!mp) return;
      if (typeof uiContext.onWorkspaceCreateFile === 'function') {
        fileOpsTouched = true;
        await uiContext.onWorkspaceCreateFile(mp, meta);
      }
    };

    const renamePathIfSupported = async (fromModelPath, toModelPath, meta = {}) => {
      const from = String(fromModelPath || '').trim();
      const to = String(toModelPath || '').trim();
      if (!from || !to) return;
      if (typeof uiContext.onWorkspaceRenamePath === 'function') {
        fileOpsTouched = true;
        await uiContext.onWorkspaceRenamePath(from, to, meta);
      }
    };

    const deletePathIfSupported = async (modelPath, meta = {}) => {
      const mp = String(modelPath || '').trim();
      if (!mp) return;
      if (typeof uiContext.onWorkspaceDeletePath === 'function') {
        fileOpsTouched = true;
        await uiContext.onWorkspaceDeletePath(mp, meta);
      }
    };

    const undoGroup = await getUndoRedoGroupInstance();

    const applyEditsToPath = async (modelPath, edits) => {
      const mp = String(modelPath || '');
      if (!mp) return;
      const resource = monaco.Uri.parse(mp);
      let model = preferOpenModels ? monaco.editor.getModel(resource) : null;
      const groupId = uiContext.getActiveGroupId?.() || 'group-1';
      const normalizedEdits = (Array.isArray(edits) ? edits : []).map(normalizeTextEdit).filter(Boolean);
      const applyToUi = async (nextContent) => {
        if (typeof uiContext.onWorkspaceWriteFile === 'function') {
          fileOpsTouched = true;
          await uiContext.onWorkspaceWriteFile(mp, nextContent);
          return;
        }
        if (typeof uiContext.onFileChange === 'function') {
          uiContext.onFileChange(mp, nextContent, { groupId });
        }
      };
      let current = '';
      if (typeof uiContext.onWorkspaceReadFile === 'function') {
        const res = await uiContext.onWorkspaceReadFile(mp).catch(() => null);
        if (res && res.exists !== false) current = String(res.content ?? '');
      } else {
        const files = uiContext.getFiles?.() || [];
        const fileEntry = (Array.isArray(files) ? files : []).find((f) => String(f?.path || '') === mp);
        if (!fileEntry) fileOpsTouched = true;
        current = fileEntry ? String(fileEntry.content || '') : '';
      }
      if (!model && typeof monaco.editor.createModel === 'function') {
        const languageId = inferLanguageIdFromPath(mp);
        try {
          model = monaco.editor.createModel(current, languageId, resource);
          void modelSync.openModelIfNeeded(model).catch(() => {});
        } catch {
          model = null;
        }
      }

      const next = applyLspTextEdits(current, normalizedEdits);

      if (model) {
        const operations = (Array.isArray(edits) ? edits : [])
          .map(normalizeTextEdit)
          .filter(Boolean)
          .map((e) => ({
            range: lspRangeToMonacoRange(monaco, e.range),
            text: String(e.newText ?? ''),
            forceMoveMarkers: true,
          }));
        try {
          if (undoGroup) {
            model.pushEditOperations([], operations, () => null, undoGroup);
          } else {
            model.pushEditOperations([], operations, () => null);
          }
        } catch {
        }
      }

      await applyToUi(next);
    };

    const files = uiContext.getFiles?.() || [];
    const originalExistingPaths = new Set((Array.isArray(files) ? files : []).map((f) => String(f?.path || '')).filter(Boolean));
    const knownPaths = new Set(originalExistingPaths);

    const creates = [];
    const renames = [];
    const deletes = [];
    const textEdits = [];

    const documentChanges = Array.isArray(workspaceEdit.documentChanges) ? workspaceEdit.documentChanges : null;
    if (documentChanges) {
      for (const dc of documentChanges) {
        const kind = String(dc?.kind || '');
        if (kind === 'create') {
          const uri = String(dc?.uri || '').trim();
          if (!uri) continue;
          const modelPath = uriToModelPath(uri);
          if (!modelPath) throw new Error(`Unresolvable create uri: ${uri}`);
          if (looksAbsolutePath(modelPath) || modelPath.startsWith('file:')) throw new Error(`Invalid create path: ${modelPath}`);
          creates.push({ modelPath, meta: { uri, options: dc?.options || {} } });
          continue;
        }
        if (kind === 'rename') {
          const oldUri = String(dc?.oldUri || '').trim();
          const newUri = String(dc?.newUri || '').trim();
          if (!oldUri || !newUri) continue;
          const from = uriToModelPath(oldUri);
          const to = uriToModelPath(newUri);
          if (!from || !to) throw new Error(`Unresolvable rename uri: ${oldUri} -> ${newUri}`);
          if (looksAbsolutePath(from) || looksAbsolutePath(to) || from.startsWith('file:') || to.startsWith('file:')) {
            throw new Error(`Invalid rename path: ${from} -> ${to}`);
          }
          renames.push({ from, to, meta: { oldUri, newUri, options: dc?.options || {} } });
          continue;
        }
        if (kind === 'delete') {
          const uri = String(dc?.uri || '').trim();
          if (!uri) continue;
          const modelPath = uriToModelPath(uri);
          if (!modelPath) throw new Error(`Unresolvable delete uri: ${uri}`);
          if (looksAbsolutePath(modelPath) || modelPath.startsWith('file:')) throw new Error(`Invalid delete path: ${modelPath}`);
          deletes.push({ modelPath, meta: { uri, options: dc?.options || {} } });
          continue;
        }
        if (kind) continue;

        const uri = dc?.textDocument?.uri;
        const edits = dc?.edits;
        if (!uri || !Array.isArray(edits)) continue;
        const modelPath = uriToModelPath(uri);
        if (!modelPath) throw new Error(`Unresolvable textDocument uri: ${String(uri)}`);
        if (looksAbsolutePath(modelPath) || modelPath.startsWith('file:')) throw new Error(`Invalid edit path: ${modelPath}`);
        textEdits.push({ modelPath, edits });
      }
    }

    const changes = workspaceEdit.changes && typeof workspaceEdit.changes === 'object' ? workspaceEdit.changes : null;
    if (changes) {
      for (const [uri, edits] of Object.entries(changes)) {
        const modelPath = uriToModelPath(uri);
        if (!modelPath) throw new Error(`Unresolvable changes uri: ${String(uri)}`);
        if (looksAbsolutePath(modelPath) || modelPath.startsWith('file:')) throw new Error(`Invalid edit path: ${modelPath}`);
        textEdits.push({ modelPath, edits });
      }
    }

    for (const op of creates) knownPaths.add(op.modelPath);

    const ensurePaths = new Map();
    for (const op of creates) ensurePaths.set(op.modelPath, op.meta);
    for (const op of textEdits) {
      if (!originalExistingPaths.has(op.modelPath)) ensurePaths.set(op.modelPath, ensurePaths.get(op.modelPath) || {});
    }

    for (const [modelPath, meta] of ensurePaths.entries()) {
      // eslint-disable-next-line no-await-in-loop
      await createPathIfSupported(modelPath, meta);
    }

    const sortedTextEdits = textEdits.slice().sort((a, b) => {
      const aExisting = originalExistingPaths.has(a.modelPath) ? 1 : 0;
      const bExisting = originalExistingPaths.has(b.modelPath) ? 1 : 0;
      return aExisting - bExisting;
    });

    for (const op of sortedTextEdits) {
      // eslint-disable-next-line no-await-in-loop
      await applyEditsToPath(op.modelPath, op.edits);
    }

    for (const op of renames) {
      // eslint-disable-next-line no-await-in-loop
      await renamePathIfSupported(op.from, op.to, op.meta);
      const fromModel = monaco.editor.getModel(monaco.Uri.parse(op.from));
      if (fromModel) {
        const targetUri = monaco.Uri.parse(op.to);
        const existing = monaco.editor.getModel(targetUri);
        if (!existing && typeof monaco.editor.createModel === 'function') {
          const value = fromModel.getValue?.() ?? '';
          const lang = typeof fromModel.getLanguageId === 'function' ? fromModel.getLanguageId() : undefined;
          const nextModel = monaco.editor.createModel(String(value), lang, targetUri);
          void modelSync.openModelIfNeeded(nextModel).catch(() => {});
        }
        try { fromModel.dispose(); } catch {}
      }
    }

    for (const op of deletes) {
      // eslint-disable-next-line no-await-in-loop
      await deletePathIfSupported(op.modelPath, op.meta);
      const model = monaco.editor.getModel(monaco.Uri.parse(op.modelPath));
      if (model) {
        try { model.dispose(); } catch {}
      }
    }

    if (typeof uiContext.onSyncStructure === 'function') {
      if (fileOpsTouched) {
        setTimeout(() => {
          try { uiContext.onSyncStructure(); } catch {}
        }, 350);
      } else {
        uiContext.onSyncStructure();
      }
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
    const completionRequest = createDebouncedCachedRequest({
      debounceMs: 90,
      cacheMs: 160,
      emptyValue: () => ({ suggestions: [] }),
      onCancel: (t) => void bridge.cancel(t),
    });
    const hoverRequest = createDebouncedCachedRequest({
      debounceMs: 180,
      cacheMs: 220,
      emptyValue: null,
      onCancel: (t) => void bridge.cancel(t),
      shouldCache: (v) => v != null,
    });
    const nextCancelToken = (prefix) => `${String(prefix || '')}${cancelSeq++}`;

    const opener = registerEditorOpener(monaco, { rootFsPath });
    if (opener) disposables.push(opener);

    for (const lang of languages) {
      disposables.push(...registerLanguageFeatures(monaco, {
        lang,
        bridge,
        outputService,
        rootFsPath,
        ideBus: globalThis?.window?.electronAPI?.ideBus || null,
        getDocState: modelSync.getDocState,
        completionRequest,
        hoverRequest,
        nextCancelToken,
        toLspPositionFromMonaco,
        toLspRangeFromMonacoRange,
        lspRangeToMonacoRange,
        lspKindToMonacoKind,
        normalizeCompletionItems,
        guessIsWindows,
        fileUriToFsPath,
        toWorkspaceRelativePath,
        getServerCaps,
        toLspDiagnosticFromMarker,
      }));

      disposables.push(...registerSemanticTokens(monaco, {
        lang,
        bridge,
        getDocState: modelSync.getDocState,
        getSemanticTokenMap,
        mapSemanticTokenData,
        toLspRangeFromMonacoRange,
        nextCancelToken,
        tokenTypes: SEMANTIC_TOKEN_TYPES,
        tokenModifiers: SEMANTIC_TOKEN_MODIFIERS,
      }));
    }

    if (!commandsRegistered) {
      commandsRegistered = true;
      disposables.push(...registerLspCommands(monaco, { bridge, outputService, applyWorkspaceEdit }));
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
    const state = modelSync.getDocState(model);
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

  const prepareCallHierarchy = async (model, position) => {
    const state = modelSync.getDocState(model);
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

  const applyExternalDiagnostics = ({ uri, diagnostics, owner } = {}) => {
    const monaco = monacoRef;
    if (!attached || !monaco?.editor?.setModelMarkers) return;
    const u = String(uri || '');
    if (!u) return;
    const modelPath = modelSync.lspUriToModelPath(u);
    if (!modelPath) return;
    const model = monaco.editor.getModel(monaco.Uri.parse(modelPath));
    if (!model) return;
    const list = Array.isArray(diagnostics) ? diagnostics : [];
    const markers = list.map((d) => lspDiagnosticToMonacoMarker(monaco, d)).filter((m) => m.message);
    monaco.editor.setModelMarkers(model, `ext:${String(owner || 'extension')}`, markers);
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
        modelPathByUri: modelSync.modelPathByUri,
        uri: payload?.uri,
        diagnostics: payload?.diagnostics || [],
        owner: `lsp:${payload?.serverId || 'default'}`,
      });
    });
    const disposeExtDiagnostics = globalThis?.window?.electronAPI?.ideBus?.onNotification
      ? globalThis.window.electronAPI.ideBus.onNotification('diagnostics/publish', (payload) => {
        applyExternalDiagnostics(payload || {});
      })
      : null;
    outputService.ensureChannel('LSP', 'LSP');
    const appendLspLines = (lines, prefix = '') => {
      const list = (Array.isArray(lines) ? lines : [lines])
        .flatMap((x) => String(x ?? '').split(/\r?\n/))
        .map((x) => x.trimEnd())
        .filter((x) => x);
      if (!list.length) return;
      outputService.appendMany('LSP', list.map((l) => `${prefix}${l}`));
    };
    const disposeLog = bridge.onLog((payload) => {
      const level = String(payload?.level || 'info').toUpperCase();
      const server = payload?.serverId ? ` ${payload.serverId}` : '';
      appendLspLines(String(payload?.message ?? ''), `[${level}]${server} `);
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
          const label = payload?.label ? ` label=${String(payload.label)}` : '';
          appendLspLines(`${err?.message || String(err)}${label}`, '[ERROR] applyWorkspaceEdit failed: ');
        } catch {
        }
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
      appendLspLines(parts.join(' '));
      if (payload?.stderrTail) appendLspLines(String(payload.stderrTail), `[STDERR] ${server} `);
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

    const ideBus = globalThis?.window?.electronAPI?.ideBus || null;
    const workspaceApi = globalThis?.window?.electronAPI?.workspace || null;
    const disposeConfig = ideBus?.onNotification
      ? ideBus.onNotification('workspace/configurationChanged', (payload) => {
        void didChangeConfiguration(payload?.settings).catch(() => {});
      })
      : null;

    // Best-effort: seed initial LSP configuration snapshot for this workspaceId.
    try {
      if (workspaceApi?.getConfiguration) {
        Promise.resolve(workspaceApi.getConfiguration('', rootFsPath))
          .then((res) => {
            if (res?.ok) return didChangeConfiguration(res.settings);
            return null;
          })
          .catch(() => {});
      }
    } catch {
      // ignore
    }
    const disposeWorkspaceApplyEdit = ideBus?.onNotification
      ? ideBus.onNotification('workspace/applyEditRequest', async (payload) => {
        const requestId = String(payload?.requestId || '').trim();
        if (!requestId) return;
        try {
          if (!monacoRef) throw new Error('monaco is not ready');
          await applyWorkspaceEdit(payload?.edit);
          await ideBus.request('workspace/applyEditResponse', { requestId, result: { applied: true } }, { timeoutMs: 10_000 });
        } catch (err) {
          try {
            const label = payload?.label ? ` label=${String(payload.label)}` : '';
            appendLspLines(`${err?.message || String(err)}${label}`, '[ERROR] applyWorkspaceEdit failed: ');
          } catch {
          }
          try {
            await ideBus.request('workspace/applyEditResponse', { requestId, result: { applied: false, failureReason: err?.message || String(err) } }, { timeoutMs: 10_000 });
          } catch {
            // ignore
          }
        }
      })
      : null;
    const notifyActiveTextEditor = (model) => {
      if (!ideBus?.notify) return;
      const state = modelSync.getDocState?.(model);
      const uri = String(state?.uri || '').trim();
      if (!uri) return;
      try {
        ideBus.notify('editor/activeTextEditorChanged', { uri, ts: Date.now() });
      } catch {
        // ignore
      }
    };

    const editorDisposables = new Set();
    const disposeActiveTracker = typeof monaco.editor?.onDidCreateEditor === 'function'
      ? monaco.editor.onDidCreateEditor((editor) => {
        if (!editor) return;
        const per = [];
        const track = () => {
          const model = editor.getModel?.();
          if (!model) return;
          void modelSync.openModelIfNeeded(model).catch(() => {});
          notifyActiveTextEditor(model);
        };
        try { per.push(editor.onDidFocusEditorWidget?.(track)); } catch {}
        try { per.push(editor.onDidChangeModel?.(track)); } catch {}
        try { if (editor.hasTextFocus?.()) track(); } catch {}
        try {
          editor.onDidDispose?.(() => {
            for (const d of per) {
              try { d?.dispose?.(); } catch {}
            }
            editorDisposables.delete(per);
          });
        } catch {}
        editorDisposables.add(per);
      })
      : null;

    monaco.editor.onDidCreateModel((model) => {
      void modelSync.openModelIfNeeded(model).catch(() => {});
    });

    // Best-effort: open already-existing models (e.g. initial tab).
    try {
      for (const m of monaco.editor.getModels()) {
        void modelSync.openModelIfNeeded(m).catch(() => {});
      }
    } catch {
      // ignore
    }

    return () => {
      disposeProviders?.();
      disposeDiagnostics?.();
      disposeExtDiagnostics?.();
      disposeLog?.();
      disposeApplyEdit?.();
      disposeConfig?.();
      disposeWorkspaceApplyEdit?.();
      disposeStatus?.();
      disposeCaps?.();
      try { disposeActiveTracker?.dispose?.(); } catch {}
      for (const per of Array.from(editorDisposables)) {
        for (const d of Array.isArray(per) ? per : []) {
          try { d?.dispose?.(); } catch {}
        }
      }
      editorDisposables.clear();
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
          void modelSync.openModelIfNeeded(m).catch(() => {});
        }
      } catch {
        // ignore
      }
    };

    if (workspaceChanged) {
      if (prevWorkspaceId) {
        try {
          void bridge.shutdownWorkspace(prevWorkspaceId).catch(() => {});
        } catch {
          // ignore
        }
      }
      serverInfoByKey.clear();
      ensureFailTsByKey.clear();
      serverCapsById.clear();
      semanticTokenMapByServerId.clear();
      modelSync.clearDocumentsAndClose();

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

  const didSavePath = (relPath, text) => modelSync.didSavePath(relPath, text);
  const didSaveAll = () => modelSync.didSaveAll();

  return {
    attachMonaco,
    updateWorkspace,
    updateUiContext,
    didChangeConfiguration,
    willCreateFiles,
    didCreateFiles,
    willRenameFiles,
    didRenameFiles,
    willDeleteFiles,
    didDeleteFiles,
    didSavePath,
    didSaveAll,
    searchWorkspaceSymbols,
    searchDocumentSymbols,
    lspUriToModelPath: modelSync.lspUriToModelPath,
    applyExternalDiagnostics,
    prepareCallHierarchy,
    callHierarchyIncoming,
    callHierarchyOutgoing,
  };
})();

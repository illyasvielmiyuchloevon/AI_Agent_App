export const registerLanguageFeatures = (monaco, {
  lang,
  bridge,
  outputService,
  rootFsPath,
  getDocState,
  completionRequest,
  hoverRequest,
  nextCancelToken,
  toLspPositionFromMonaco,
  toLspRangeFromMonacoRange,
  lspRangeToMonacoRange,
  lspKindToMonacoKind,
  normalizeCompletionItems,
  ideBus,
  guessIsWindows,
  fileUriToFsPath,
  toWorkspaceRelativePath,
  getServerCaps,
  toLspDiagnosticFromMarker,
} = {}) => {
  const disposables = [];
  const languageId = String(lang || '');
  if (!languageId) return disposables;

  disposables.push(monaco.languages.registerCompletionItemProvider(languageId, {
    triggerCharacters: ['.', '"', '\'', '/', '@', '<'],
    provideCompletionItems: async (model, position, _ctx, token) => {
      const state = getDocState?.(model);
      if (!state) return { suggestions: [] };

      const key = `${state.serverId}::${state.uri}`;
      const versionId = typeof model?.getVersionId === 'function' ? Number(model.getVersionId()) : 0;
      const positionKey = `${Number(position?.lineNumber || 0)}:${Number(position?.column || 0)}`;
      const cancelToken = nextCancelToken?.('c') || '';
      return await completionRequest?.({
        key,
        versionId,
        positionKey,
        token,
        cancelToken,
        isStale: () => {
          const nowVersionId = typeof model?.getVersionId === 'function' ? Number(model.getVersionId()) : 0;
          return nowVersionId !== versionId;
        },
        exec: async (ct) => {
          const word = model.getWordUntilPosition(position);
          const defaultRange = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);

          const params = { textDocument: { uri: state.uri }, position: toLspPositionFromMonaco?.(position) };
          const res = await bridge?.completion?.(state.serverId, params, { timeoutMs: 2000, cancelToken: ct }).catch((err) => {
            outputService?.append?.('LSP', `[ERROR] completion failed: ${err?.message || String(err)}`);
            return null;
          });
          const items = normalizeCompletionItems?.(res) || [];
          const suggestions = items.map((it) => {
            const insertText = String(it?.insertText || it?.label || '');
            const textEdit = it?.textEdit;
            const usesSnippet = Number(it?.insertTextFormat || 1) === 2;
            const itemRange = textEdit?.range ? lspRangeToMonacoRange?.(monaco, textEdit.range) : defaultRange;
            const additionalTextEdits = Array.isArray(it?.additionalTextEdits)
              ? it.additionalTextEdits.map((e) => ({ range: lspRangeToMonacoRange?.(monaco, e.range), text: String(e.newText || '') }))
              : undefined;

            const documentation = it?.documentation?.value || it?.documentation || '';
            return {
              label: String(it?.label || ''),
              kind: lspKindToMonacoKind?.(monaco, it?.kind),
              detail: it?.detail ? String(it.detail) : undefined,
              documentation: documentation ? String(documentation) : undefined,
              insertText: textEdit?.newText ? String(textEdit.newText) : insertText,
              range: itemRange,
              insertTextRules: usesSnippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
              additionalTextEdits,
              data: { serverId: state.serverId, uri: state.uri, lspItem: it },
            };
          }).filter((s) => s.label);

          const extItems = await (async () => {
            const bus = ideBus || globalThis?.window?.electronAPI?.ideBus || null;
            if (!bus?.request) return [];
            const pos = params.position;
            if (!pos) return [];
            try {
              const busRes = await bus.request('languages/provideCompletionItems', {
                languageId,
                uri: state.uri,
                text: model.getValue?.() ?? '',
                version: typeof model?.getVersionId === 'function' ? Number(model.getVersionId()) : 1,
                position: pos,
              }, { timeoutMs: 500 });
              const list = Array.isArray(busRes?.items) ? busRes.items : [];
              return list;
            } catch {
              return [];
            }
          })();

          const extSuggestions = extItems.map((it) => {
            const label = it?.label != null ? String(it.label) : '';
            if (!label) return null;
            const insertText = it?.insertText != null ? String(it.insertText) : label;
            const documentation = it?.documentation != null ? String(it.documentation) : '';
            const kind = Number.isFinite(it?.kind) ? it.kind : undefined;
            return {
              label,
              kind: kind != null ? lspKindToMonacoKind?.(monaco, kind) : monaco.languages.CompletionItemKind.Text,
              detail: it?.detail ? String(it.detail) : undefined,
              documentation: documentation ? String(documentation) : undefined,
              insertText,
              range: defaultRange,
              data: { source: 'extension', uri: state.uri },
            };
          }).filter(Boolean);
          return { suggestions: [...suggestions, ...extSuggestions] };
        },
      }) ?? { suggestions: [] };
    },
    resolveCompletionItem: async (item, token) => {
      const data = item?.data || null;
      const serverId = String(data?.serverId || '');
      const uri = String(data?.uri || '');
      const lspItem = data?.lspItem || null;
      if (!serverId || !uri || !lspItem) return item;
      const cancelToken = nextCancelToken?.('cr') || '';
      token?.onCancellationRequested?.(() => { void bridge?.cancel?.(cancelToken); });
      const resolved = await bridge?.completionResolve?.(serverId, lspItem, uri, { timeoutMs: 2000, cancelToken }).catch(() => null);
      if (!resolved || typeof resolved !== 'object') return item;

      const documentation = resolved?.documentation?.value || resolved?.documentation || '';
      const additionalTextEdits = Array.isArray(resolved?.additionalTextEdits)
        ? resolved.additionalTextEdits.map((e) => ({ range: lspRangeToMonacoRange?.(monaco, e.range), text: String(e.newText ?? '') }))
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

  disposables.push(monaco.languages.registerHoverProvider(languageId, {
    provideHover: async (model, position, token) => {
      const state = getDocState?.(model);
      if (!state) return null;

      const key = `${state.serverId}::${state.uri}`;
      const versionId = typeof model?.getVersionId === 'function' ? Number(model.getVersionId()) : 0;
      const positionKey = `${Number(position?.lineNumber || 0)}:${Number(position?.column || 0)}`;
      const cancelToken = nextCancelToken?.('h') || '';
      return await hoverRequest?.({
        key,
        versionId,
        positionKey,
        token,
        cancelToken,
        isStale: () => {
          const nowVersionId = typeof model?.getVersionId === 'function' ? Number(model.getVersionId()) : 0;
          return nowVersionId !== versionId;
        },
        exec: async (ct) => {
          const params = { textDocument: { uri: state.uri }, position: toLspPositionFromMonaco?.(position) };
          const res = await bridge?.hover?.(state.serverId, params, { timeoutMs: 2000, cancelToken: ct }).catch((err) => {
            outputService?.append?.('LSP', `[ERROR] hover failed: ${err?.message || String(err)}`);
            return null;
          });
          const contents = res?.contents;
          const markdown =
            typeof contents === 'string'
              ? contents
              : (Array.isArray(contents) ? contents.map((c) => c?.value || c).filter(Boolean).join('\n\n') : (contents?.value || ''));

          if (!markdown) return null;
          return { contents: [{ value: String(markdown) }] };
        },
      }) ?? null;
    },
  }));

  disposables.push(monaco.languages.registerReferenceProvider(languageId, {
    provideReferences: async (model, position, context, token) => {
      const state = getDocState?.(model);
      if (!state) return [];
      const cancelToken = nextCancelToken?.('r') || '';
      token?.onCancellationRequested?.(() => { void bridge?.cancel?.(cancelToken); });
      const params = {
        textDocument: { uri: state.uri },
        position: toLspPositionFromMonaco?.(position),
        context: { includeDeclaration: !!context?.includeDeclaration },
      };
      const res = await bridge?.references?.(state.serverId, params, { timeoutMs: 4000, cancelToken }).catch((err) => {
        outputService?.append?.('LSP', `[ERROR] references failed: ${err?.message || String(err)}`);
        return [];
      });
      const list = Array.isArray(res) ? res : (res ? [res] : []);
      const windows = guessIsWindows?.(rootFsPath);
      return list.map((loc) => {
        const uri = String(loc?.uri || '');
        const range = loc?.range;
        if (!uri || !range) return null;
        const fsPath = fileUriToFsPath?.(uri, { windows });
        const rel = toWorkspaceRelativePath?.(fsPath, rootFsPath);
        const targetModelPath = rel || uri;
        return { uri: monaco.Uri.parse(targetModelPath), range: lspRangeToMonacoRange?.(monaco, range) };
      }).filter(Boolean);
    },
  }));

  disposables.push(monaco.languages.registerRenameProvider(languageId, {
    provideRenameEdits: async (model, position, newName, token) => {
      const state = getDocState?.(model);
      if (!state) return { edits: [] };
      const cancelToken = nextCancelToken?.('n') || '';
      token?.onCancellationRequested?.(() => { void bridge?.cancel?.(cancelToken); });
      const params = { textDocument: { uri: state.uri }, position: toLspPositionFromMonaco?.(position), newName: String(newName || '') };
      const res = await bridge?.rename?.(state.serverId, params, { timeoutMs: 5000, cancelToken }).catch(() => null);
      if (!res) return { edits: [] };

      const windows = guessIsWindows?.(rootFsPath);
      const edits = [];
      const addEditsForUri = (uri, lspEdits) => {
        const fsPath = fileUriToFsPath?.(uri, { windows });
        const rel = toWorkspaceRelativePath?.(fsPath, rootFsPath);
        const targetModelPath = rel || uri;
        for (const e of Array.isArray(lspEdits) ? lspEdits : []) {
          edits.push({
            resource: monaco.Uri.parse(targetModelPath),
            edit: { range: lspRangeToMonacoRange?.(monaco, e.range), text: String(e.newText ?? '') },
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

  disposables.push(monaco.languages.registerCodeActionProvider(languageId, {
    providedCodeActionKinds: ['quickfix', 'refactor', 'source.organizeImports'],
    provideCodeActions: async (model, range, context, token) => {
      const state = getDocState?.(model);
      if (!state) return { actions: [], dispose: () => {} };
      const cancelToken = nextCancelToken?.('a') || '';
      token?.onCancellationRequested?.(() => { void bridge?.cancel?.(cancelToken); });

      const markers = Array.isArray(context?.markers) ? context.markers : [];
      const diagnostics = markers.map((m) => toLspDiagnosticFromMarker?.(m));
      const only = context?.only?.value ? String(context.only.value) : (context?.only ? String(context.only) : '');

      const params = {
        textDocument: { uri: state.uri },
        range: toLspRangeFromMonacoRange?.(range),
        context: { diagnostics, only: only ? [only] : undefined, triggerKind: 1 },
      };
      const res = await bridge?.codeAction?.(state.serverId, params, { timeoutMs: 4000, cancelToken }).catch((err) => {
        outputService?.append?.('LSP', `[ERROR] codeAction failed: ${err?.message || String(err)}`);
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
      const cancelToken = nextCancelToken?.('car') || '';
      token?.onCancellationRequested?.(() => { void bridge?.cancel?.(cancelToken); });
      const resolved = await bridge?.codeActionResolve?.(serverId, lspAction, uri, { timeoutMs: 4000, cancelToken }).catch(() => null);
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

  disposables.push(monaco.languages.registerSignatureHelpProvider(languageId, {
    signatureHelpTriggerCharacters: ['(', ',', '<'],
    provideSignatureHelp: async (model, position, _token, context) => {
      const state = getDocState?.(model);
      if (!state) return { value: { signatures: [], activeSignature: 0, activeParameter: 0 }, dispose: () => {} };
      const cancelToken = nextCancelToken?.('s') || '';
      _token?.onCancellationRequested?.(() => { void bridge?.cancel?.(cancelToken); });
      const params = {
        textDocument: { uri: state.uri },
        position: toLspPositionFromMonaco?.(position),
        context: {
          triggerKind: Number(context?.triggerKind || 1),
          triggerCharacter: context?.triggerCharacter ? String(context.triggerCharacter) : undefined,
          isRetrigger: !!context?.isRetrigger,
        },
      };
      const res = await bridge?.signatureHelp?.(state.serverId, params, { timeoutMs: 2000, cancelToken }).catch(() => null);
      return { value: res || { signatures: [], activeSignature: 0, activeParameter: 0 }, dispose: () => {} };
    },
  }));

  disposables.push(monaco.languages.registerDocumentFormattingEditProvider(languageId, {
    provideDocumentFormattingEdits: async (model, _options, token) => {
      const state = getDocState?.(model);
      if (!state) return [];
      const cancelToken = nextCancelToken?.('f') || '';
      token?.onCancellationRequested?.(() => { void bridge?.cancel?.(cancelToken); });
      const opts = model.getOptions?.();
      const params = {
        textDocument: { uri: state.uri },
        options: { tabSize: opts?.tabSize || 4, insertSpaces: !!opts?.insertSpaces },
      };
      const res = await bridge?.format?.(state.serverId, params, { timeoutMs: 5000, cancelToken }).catch(() => []);
      return (Array.isArray(res) ? res : []).map((e) => ({
        range: lspRangeToMonacoRange?.(monaco, e.range),
        text: String(e.newText ?? ''),
      }));
    },
  }));

  disposables.push(monaco.languages.registerDocumentRangeFormattingEditProvider(languageId, {
    provideDocumentRangeFormattingEdits: async (model, range, _options, token) => {
      const state = getDocState?.(model);
      if (!state) return [];
      const cancelToken = nextCancelToken?.('g') || '';
      token?.onCancellationRequested?.(() => { void bridge?.cancel?.(cancelToken); });
      const opts = model.getOptions?.();
      const params = {
        textDocument: { uri: state.uri },
        range: toLspRangeFromMonacoRange?.(range),
        options: { tabSize: opts?.tabSize || 4, insertSpaces: !!opts?.insertSpaces },
      };
      const res = await bridge?.rangeFormat?.(state.serverId, params, { timeoutMs: 5000, cancelToken }).catch(() => []);
      return (Array.isArray(res) ? res : []).map((e) => ({
        range: lspRangeToMonacoRange?.(monaco, e.range),
        text: String(e.newText ?? ''),
      }));
    },
  }));

  disposables.push(monaco.languages.registerDefinitionProvider(languageId, {
    provideDefinition: async (model, position, token) => {
      const state = getDocState?.(model);
      if (!state) return null;
      const cancelToken = nextCancelToken?.('d') || '';
      token?.onCancellationRequested?.(() => { void bridge?.cancel?.(cancelToken); });
      const params = { textDocument: { uri: state.uri }, position: toLspPositionFromMonaco?.(position) };
      const res = await bridge?.definition?.(state.serverId, params, { timeoutMs: 2000, cancelToken }).catch((err) => {
        outputService?.append?.('LSP', `[ERROR] definition failed: ${err?.message || String(err)}`);
        return null;
      });
      const windows = guessIsWindows?.(rootFsPath);

      const toLocationLink = (loc) => {
        const targetUri = String(loc?.uri || loc?.targetUri || '');
        const fullRange = loc?.targetRange || loc?.range || loc?.targetSelectionRange;
        const selectionRange = loc?.targetSelectionRange || loc?.targetRange || loc?.range;
        if (!targetUri || !fullRange) return null;

        const fsPath = fileUriToFsPath?.(targetUri, { windows });
        const rel = toWorkspaceRelativePath?.(fsPath, rootFsPath);
        const targetModelPath = rel || targetUri;
        return {
          originSelectionRange: undefined,
          uri: monaco.Uri.parse(targetModelPath),
          range: lspRangeToMonacoRange?.(monaco, fullRange),
          targetSelectionRange: selectionRange ? lspRangeToMonacoRange?.(monaco, selectionRange) : undefined,
        };
      };

      const list = Array.isArray(res) ? res : (res ? [res] : []);
      return list.map(toLocationLink).filter(Boolean);
    },
  }));

  if (typeof monaco.languages.registerDeclarationProvider === 'function') {
    disposables.push(monaco.languages.registerDeclarationProvider(languageId, {
      provideDeclaration: async (model, position, token) => {
        const state = getDocState?.(model);
        if (!state) return null;
        const cancelToken = nextCancelToken?.('dc') || '';
        token?.onCancellationRequested?.(() => { void bridge?.cancel?.(cancelToken); });
        const params = { textDocument: { uri: state.uri }, position: toLspPositionFromMonaco?.(position) };
        const res = await bridge?.declaration?.(state.serverId, params, { timeoutMs: 2000, cancelToken }).catch(() => null);
        const windows = guessIsWindows?.(rootFsPath);

        const toLocationLink = (loc) => {
          const targetUri = String(loc?.uri || loc?.targetUri || '');
          const fullRange = loc?.targetRange || loc?.range || loc?.targetSelectionRange;
          const selectionRange = loc?.targetSelectionRange || loc?.targetRange || loc?.range;
          if (!targetUri || !fullRange) return null;
          const fsPath = fileUriToFsPath?.(targetUri, { windows });
          const rel = toWorkspaceRelativePath?.(fsPath, rootFsPath);
          const targetModelPath = rel || targetUri;
          return {
            originSelectionRange: undefined,
            uri: monaco.Uri.parse(targetModelPath),
            range: lspRangeToMonacoRange?.(monaco, fullRange),
            targetSelectionRange: selectionRange ? lspRangeToMonacoRange?.(monaco, selectionRange) : undefined,
          };
        };

        const list = Array.isArray(res) ? res : (res ? [res] : []);
        return list.map(toLocationLink).filter(Boolean);
      },
    }));
  }

  if (typeof monaco.languages.registerTypeDefinitionProvider === 'function') {
    disposables.push(monaco.languages.registerTypeDefinitionProvider(languageId, {
      provideTypeDefinition: async (model, position, token) => {
        const state = getDocState?.(model);
        if (!state) return null;
        const cancelToken = nextCancelToken?.('td') || '';
        token?.onCancellationRequested?.(() => { void bridge?.cancel?.(cancelToken); });
        const params = { textDocument: { uri: state.uri }, position: toLspPositionFromMonaco?.(position) };
        const res = await bridge?.typeDefinition?.(state.serverId, params, { timeoutMs: 4000, cancelToken }).catch(() => null);
        const windows = guessIsWindows?.(rootFsPath);

        const toLocationLink = (loc) => {
          const targetUri = String(loc?.uri || loc?.targetUri || '');
          const fullRange = loc?.targetRange || loc?.range || loc?.targetSelectionRange;
          const selectionRange = loc?.targetSelectionRange || loc?.targetRange || loc?.range;
          if (!targetUri || !fullRange) return null;
          const fsPath = fileUriToFsPath?.(targetUri, { windows });
          const rel = toWorkspaceRelativePath?.(fsPath, rootFsPath);
          const targetModelPath = rel || targetUri;
          return {
            originSelectionRange: undefined,
            uri: monaco.Uri.parse(targetModelPath),
            range: lspRangeToMonacoRange?.(monaco, fullRange),
            targetSelectionRange: selectionRange ? lspRangeToMonacoRange?.(monaco, selectionRange) : undefined,
          };
        };

        const list = Array.isArray(res) ? res : (res ? [res] : []);
        return list.map(toLocationLink).filter(Boolean);
      },
    }));
  }

  if (typeof monaco.languages.registerImplementationProvider === 'function') {
    disposables.push(monaco.languages.registerImplementationProvider(languageId, {
      provideImplementation: async (model, position, token) => {
        const state = getDocState?.(model);
        if (!state) return null;
        const cancelToken = nextCancelToken?.('im') || '';
        token?.onCancellationRequested?.(() => { void bridge?.cancel?.(cancelToken); });
        const params = { textDocument: { uri: state.uri }, position: toLspPositionFromMonaco?.(position) };
        const res = await bridge?.implementation?.(state.serverId, params, { timeoutMs: 4000, cancelToken }).catch(() => null);
        const windows = guessIsWindows?.(rootFsPath);

        const toLocationLink = (loc) => {
          const targetUri = String(loc?.uri || loc?.targetUri || '');
          const fullRange = loc?.targetRange || loc?.range || loc?.targetSelectionRange;
          const selectionRange = loc?.targetSelectionRange || loc?.targetRange || loc?.range;
          if (!targetUri || !fullRange) return null;
          const fsPath = fileUriToFsPath?.(targetUri, { windows });
          const rel = toWorkspaceRelativePath?.(fsPath, rootFsPath);
          const targetModelPath = rel || targetUri;
          return {
            originSelectionRange: undefined,
            uri: monaco.Uri.parse(targetModelPath),
            range: lspRangeToMonacoRange?.(monaco, fullRange),
            targetSelectionRange: selectionRange ? lspRangeToMonacoRange?.(monaco, selectionRange) : undefined,
          };
        };

        const list = Array.isArray(res) ? res : (res ? [res] : []);
        return list.map(toLocationLink).filter(Boolean);
      },
    }));
  }

  if (typeof monaco.languages.registerColorProvider === 'function') {
    disposables.push(monaco.languages.registerColorProvider(languageId, {
      provideDocumentColors: async (model, token) => {
        const state = getDocState?.(model);
        if (!state) return [];
        const caps = await getServerCaps?.(state.serverId);
        if (!caps?.colorProvider) return [];
        const cancelToken = nextCancelToken?.('cl') || '';
        token?.onCancellationRequested?.(() => { void bridge?.cancel?.(cancelToken); });
        const res = await bridge?.documentColor?.(state.serverId, { textDocument: { uri: state.uri } }, { timeoutMs: 4000, cancelToken }).catch(() => []);
        const list = Array.isArray(res) ? res : [];
        return list.map((ci) => {
          const range = ci?.range ? lspRangeToMonacoRange?.(monaco, ci.range) : null;
          const color = ci?.color || null;
          if (!range || !color) return null;
          return { range, color };
        }).filter(Boolean);
      },
      provideColorPresentations: async (model, colorInfo, token) => {
        const state = getDocState?.(model);
        if (!state) return [];
        const caps = await getServerCaps?.(state.serverId);
        if (!caps?.colorProvider) return [];
        const cancelToken = nextCancelToken?.('cp') || '';
        token?.onCancellationRequested?.(() => { void bridge?.cancel?.(cancelToken); });
        const params = {
          textDocument: { uri: state.uri },
          color: colorInfo?.color,
          range: toLspRangeFromMonacoRange?.(colorInfo?.range),
        };
        const res = await bridge?.colorPresentation?.(state.serverId, params, { timeoutMs: 4000, cancelToken }).catch(() => []);
        const list = Array.isArray(res) ? res : [];
        return list.map((p) => {
          const label = String(p?.label || '');
          if (!label) return null;
          const te = p?.textEdit;
          const textEdit = te?.range ? { range: lspRangeToMonacoRange?.(monaco, te.range), text: String(te.newText ?? '') } : undefined;
          const additionalTextEdits = (Array.isArray(p?.additionalTextEdits) ? p.additionalTextEdits : []).map((e) => {
            if (!e?.range) return null;
            return { range: lspRangeToMonacoRange?.(monaco, e.range), text: String(e.newText ?? '') };
          }).filter(Boolean);
          return { label, textEdit, additionalTextEdits: additionalTextEdits.length ? additionalTextEdits : undefined };
        }).filter(Boolean);
      },
    }));
  }

  if (typeof monaco.languages.registerFoldingRangeProvider === 'function') {
    disposables.push(monaco.languages.registerFoldingRangeProvider(languageId, {
      provideFoldingRanges: async (model, _context, token) => {
        const state = getDocState?.(model);
        if (!state) return [];
        const cancelToken = nextCancelToken?.('fr') || '';
        token?.onCancellationRequested?.(() => { void bridge?.cancel?.(cancelToken); });
        const params = { textDocument: { uri: state.uri } };
        const res = await bridge?.foldingRange?.(state.serverId, params, { timeoutMs: 4000, cancelToken }).catch(() => []);
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
    disposables.push(monaco.languages.registerInlayHintsProvider(languageId, {
      provideInlayHints: async (model, range, token) => {
        const state = getDocState?.(model);
        if (!state) return { hints: [], dispose: () => {} };
        const caps = await getServerCaps?.(state.serverId);
        if (!caps?.inlayHintProvider) return { hints: [], dispose: () => {} };
        const cancelToken = nextCancelToken?.('ih') || '';
        token?.onCancellationRequested?.(() => { void bridge?.cancel?.(cancelToken); });
        const params = { textDocument: { uri: state.uri }, range: toLspRangeFromMonacoRange?.(range) };
        const res = await bridge?.inlayHint?.(state.serverId, params, { timeoutMs: 4000, cancelToken }).catch(() => []);
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
    disposables.push(monaco.languages.registerLinkProvider(languageId, {
      provideLinks: async (model, token) => {
        const state = getDocState?.(model);
        if (!state) return { links: [] };
        const caps = await getServerCaps?.(state.serverId);
        if (!caps?.documentLinkProvider) return { links: [] };
        const cancelToken = nextCancelToken?.('dl') || '';
        token?.onCancellationRequested?.(() => { void bridge?.cancel?.(cancelToken); });
        const res = await bridge?.documentLink?.(state.serverId, { textDocument: { uri: state.uri } }, { timeoutMs: 4000, cancelToken }).catch(() => []);
        const list = Array.isArray(res) ? res : [];
        const links = list.map((l) => {
          const range = l?.range ? lspRangeToMonacoRange?.(monaco, l.range) : null;
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
        const cancelToken = nextCancelToken?.('dlr') || '';
        token?.onCancellationRequested?.(() => { void bridge?.cancel?.(cancelToken); });
        const resolved = await bridge?.documentLinkResolve?.(serverId, lspLink, uri, { timeoutMs: 4000, cancelToken }).catch(() => null);
        if (!resolved || typeof resolved !== 'object') return link;
        const target = resolved?.target ? String(resolved.target) : '';
        return { ...link, url: target || link.url, data: { ...data, lspLink: resolved } };
      },
    }));
  }

  if (typeof monaco.languages.registerCodeLensProvider === 'function') {
    disposables.push(monaco.languages.registerCodeLensProvider(languageId, {
      provideCodeLenses: async (model, token) => {
        const state = getDocState?.(model);
        if (!state) return { lenses: [], dispose: () => {} };
        const caps = await getServerCaps?.(state.serverId);
        if (!caps?.codeLensProvider) return { lenses: [], dispose: () => {} };
        const cancelToken = nextCancelToken?.('cl') || '';
        token?.onCancellationRequested?.(() => { void bridge?.cancel?.(cancelToken); });
        const res = await bridge?.codeLens?.(state.serverId, { textDocument: { uri: state.uri } }, { timeoutMs: 4000, cancelToken }).catch(() => []);
        const list = Array.isArray(res) ? res : [];
        const lenses = list.map((l) => {
          const range = l?.range ? lspRangeToMonacoRange?.(monaco, l.range) : null;
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
        const cancelToken = nextCancelToken?.('clr') || '';
        token?.onCancellationRequested?.(() => { void bridge?.cancel?.(cancelToken); });
        const resolved = await bridge?.codeLensResolve?.(serverId, lspLens, uri, { timeoutMs: 4000, cancelToken }).catch(() => null);
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
    disposables.push(monaco.languages.registerDocumentHighlightProvider(languageId, {
      provideDocumentHighlights: async (model, position, token) => {
        const state = getDocState?.(model);
        if (!state) return [];
        const caps = await getServerCaps?.(state.serverId);
        if (!caps?.documentHighlightProvider) return [];
        const cancelToken = nextCancelToken?.('dh') || '';
        token?.onCancellationRequested?.(() => { void bridge?.cancel?.(cancelToken); });
        const res = await bridge?.documentHighlight?.(state.serverId, { textDocument: { uri: state.uri }, position: toLspPositionFromMonaco?.(position) }, { timeoutMs: 2000, cancelToken }).catch(() => []);
        const list = Array.isArray(res) ? res : [];
        const kindMap = monaco?.languages?.DocumentHighlightKind;
        return list.map((h) => {
          const range = h?.range ? lspRangeToMonacoRange?.(monaco, h.range) : null;
          if (!range) return null;
          const k = Number(h?.kind || 0);
          const kind = kindMap ? (k === 2 ? kindMap.Write : (k === 3 ? kindMap.Text : kindMap.Read)) : undefined;
          return { range, kind };
        }).filter(Boolean);
      },
    }));
  }

  if (typeof monaco.languages.registerSelectionRangeProvider === 'function') {
    disposables.push(monaco.languages.registerSelectionRangeProvider(languageId, {
      provideSelectionRanges: async (model, positions, token) => {
        const state = getDocState?.(model);
        if (!state) return [];
        const caps = await getServerCaps?.(state.serverId);
        if (!caps?.selectionRangeProvider) return [];
        const cancelToken = nextCancelToken?.('srp') || '';
        token?.onCancellationRequested?.(() => { void bridge?.cancel?.(cancelToken); });
        const params = {
          textDocument: { uri: state.uri },
          positions: (Array.isArray(positions) ? positions : []).map((p) => toLspPositionFromMonaco?.(p)),
        };
        const res = await bridge?.selectionRange?.(state.serverId, params, { timeoutMs: 2000, cancelToken }).catch(() => []);
        const list = Array.isArray(res) ? res : [];
        const convertOne = (sr) => {
          if (!sr || typeof sr !== 'object' || !sr.range) return null;
          const next = { range: lspRangeToMonacoRange?.(monaco, sr.range) };
          if (sr.parent) next.parent = convertOne(sr.parent);
          return next;
        };
        return list.map(convertOne).filter(Boolean);
      },
    }));
  }

  if (typeof monaco.languages.registerLinkedEditingRangeProvider === 'function') {
    disposables.push(monaco.languages.registerLinkedEditingRangeProvider(languageId, {
      provideLinkedEditingRanges: async (model, position, token) => {
        const state = getDocState?.(model);
        if (!state) return null;
        const caps = await getServerCaps?.(state.serverId);
        if (!caps?.linkedEditingRangeProvider) return null;
        const cancelToken = nextCancelToken?.('ler') || '';
        token?.onCancellationRequested?.(() => { void bridge?.cancel?.(cancelToken); });
        const params = { textDocument: { uri: state.uri }, position: toLspPositionFromMonaco?.(position) };
        const res = await bridge?.linkedEditingRange?.(state.serverId, params, { timeoutMs: 2000, cancelToken }).catch(() => null);
        const ranges = (Array.isArray(res?.ranges) ? res.ranges : []).map((r) => {
          if (!r) return null;
          return lspRangeToMonacoRange?.(monaco, r);
        }).filter(Boolean);
        if (!ranges.length) return null;
        const pat = res?.wordPattern ? String(res.wordPattern) : '';
        let wordPattern;
        if (pat) {
          try { wordPattern = new RegExp(pat); } catch {}
        }
        return { ranges, wordPattern };
      },
    }));
  }

  return disposables;
};

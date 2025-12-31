const { MessageReader } = require('../transport/MessageReader');
const { MessageWriter } = require('../transport/MessageWriter');
const { offsetAt } = require('../util/position');

const reader = new MessageReader(process.stdin);
const writer = new MessageWriter(process.stdout);

const docs = new Map(); // uri -> { text, version }
let semanticResultId = 1;
let requestSeq = 1;
const pendingRequests = new Map(); // id -> { resolve, reject, timer }
let dynamicRegsSent = false;

const send = (msg) => writer.write(msg);
const respond = (id, result) => send({ jsonrpc: '2.0', id, result });
const notify = (method, params) => send({ jsonrpc: '2.0', method, params });

const sendRequest = (method, params, { timeoutMs = 2000 } = {}) => {
  const id = requestSeq++;
  send({ jsonrpc: '2.0', id, method, params });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`timeout waiting response for ${method}`));
    }, Math.max(10, Number(timeoutMs) || 2000));
    pendingRequests.set(id, { resolve, reject, timer });
  });
};

function applyChange(text, change) {
  if (!change?.range) return String(change?.text || '');
  const start = offsetAt(text, change.range.start);
  const end = offsetAt(text, change.range.end);
  return text.slice(0, start) + String(change.text || '') + text.slice(end);
}

function publishDiagnostics(uri) {
  const doc = docs.get(uri);
  if (!doc) return;
  const idx = doc.text.indexOf('TODO');
  const diagnostics = [];
  if (idx >= 0) {
    diagnostics.push({
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 4 },
      },
      severity: 2,
      source: 'fake',
      message: 'Found TODO',
    });
  }
  notify('textDocument/publishDiagnostics', { uri, diagnostics });
}

function makeWholeDocumentEdit(uri, newText) {
  const doc = docs.get(uri);
  const text = doc ? String(doc.text || '') : '';
  const lines = text.split('\n');
  const lastLine = Math.max(1, lines.length);
  const lastCol = (lines[lastLine - 1] || '').length;
  return [{
    range: { start: { line: 0, character: 0 }, end: { line: lastLine - 1, character: lastCol } },
    newText: String(newText || ''),
  }];
}

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

function makeSimpleSemanticTokens(uri) {
  const doc = docs.get(uri);
  const text = doc ? String(doc.text || '') : '';
  const line0 = text.split('\n')[0] || '';
  const idx = line0.indexOf('function');
  const data = [];
  if (idx >= 0) {
    // deltaLine=0, deltaStart=idx, length=8, tokenType=keyword, modifiers=0
    data.push(0, idx, 8, SEMANTIC_TOKEN_TYPES.indexOf('keyword'), 0);
  }
  const idx2 = line0.indexOf('TODO');
  if (idx2 >= 0) {
    data.push(0, idx2, 4, SEMANTIC_TOKEN_TYPES.indexOf('comment'), 0);
  }
  return { resultId: String(semanticResultId++), data };
}

reader.on('message', async (msg) => {
  if (!msg || msg.jsonrpc !== '2.0') return;

  if (Object.prototype.hasOwnProperty.call(msg, 'id') && !msg.method) {
    const pending = pendingRequests.get(msg.id);
    if (!pending) return;
    pendingRequests.delete(msg.id);
    try { clearTimeout(pending.timer); } catch {}
    if (msg.error) pending.reject(new Error(msg.error?.message || 'response error'));
    else pending.resolve(msg.result);
    return;
  }

  if (msg.method && Object.prototype.hasOwnProperty.call(msg, 'id')) {
    const id = msg.id;
    if (msg.method === 'initialize') {
      respond(id, {
        capabilities: {
          textDocumentSync: { openClose: true, change: 2, save: { includeText: true } },
          workspace: {
            fileOperations: {
              didCreate: true,
              willCreate: true,
              didRename: true,
              willRename: true,
              didDelete: true,
              willDelete: true,
            },
          },
          completionProvider: { triggerCharacters: ['.'], resolveProvider: true },
          hoverProvider: true,
          definitionProvider: true,
          declarationProvider: true,
          typeDefinitionProvider: true,
          implementationProvider: true,
          referencesProvider: true,
          signatureHelpProvider: { triggerCharacters: ['(', ','] },
          codeActionProvider: { resolveProvider: true },
          colorProvider: true,
          renameProvider: true,
          documentFormattingProvider: true,
          documentRangeFormattingProvider: true,
          documentLinkProvider: { resolveProvider: true },
          codeLensProvider: { resolveProvider: true },
          documentHighlightProvider: true,
          selectionRangeProvider: true,
          linkedEditingRangeProvider: true,
          foldingRangeProvider: true,
          inlayHintProvider: true,
          callHierarchyProvider: true,
          semanticTokensProvider: {
            legend: { tokenTypes: SEMANTIC_TOKEN_TYPES, tokenModifiers: SEMANTIC_TOKEN_MODIFIERS },
            full: { delta: true },
            range: true,
          },
          executeCommandProvider: { commands: ['fake.command'] },
        },
      });
      return;
    }

    if (msg.method === 'textDocument/completion') {
      respond(id, {
        isIncomplete: false,
        items: [
          { label: 'hello', kind: 3, detail: 'fake', insertText: 'hello', data: { k: 'hello' } },
          { label: 'world', kind: 3, detail: 'fake', insertText: 'world', data: { k: 'world' } },
        ],
      });
      return;
    }

    if (msg.method === 'completionItem/resolve') {
      const it = msg.params && typeof msg.params === 'object' ? msg.params : msg;
      respond(id, {
        ...it,
        detail: it?.detail ? `${it.detail} (resolved)` : 'resolved',
        documentation: { kind: 'markdown', value: `**resolved** ${String(it?.label || '')}` },
      });
      return;
    }

    if (msg.method === 'textDocument/hover') {
      respond(id, { contents: { kind: 'markdown', value: '**fake hover**' } });
      return;
    }

    if (msg.method === 'textDocument/definition') {
      const uri = msg.params?.textDocument?.uri || '';
      respond(id, { uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } });
      return;
    }

    if (msg.method === 'textDocument/declaration') {
      const uri = msg.params?.textDocument?.uri || '';
      respond(id, { uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } });
      return;
    }

    if (msg.method === 'textDocument/typeDefinition' || msg.method === 'textDocument/implementation') {
      const uri = msg.params?.textDocument?.uri || '';
      respond(id, [{ uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } }]);
      return;
    }

    if (msg.method === 'textDocument/documentColor') {
      respond(id, [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
          color: { red: 1, green: 0, blue: 0, alpha: 1 },
        },
      ]);
      return;
    }

    if (msg.method === 'textDocument/colorPresentation') {
      respond(id, [
        {
          label: 'red',
          textEdit: {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
            newText: '#ff0000',
          },
        },
      ]);
      return;
    }

    if (msg.method === 'textDocument/linkedEditingRange') {
      respond(id, {
        ranges: [
          { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
          { start: { line: 0, character: 5 }, end: { line: 0, character: 9 } },
        ],
        wordPattern: '\\\\w+',
      });
      return;
    }

    if (msg.method === 'textDocument/references') {
      const uri = msg.params?.textDocument?.uri || '';
      respond(id, [{ uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } }]);
      return;
    }

    if (msg.method === 'textDocument/signatureHelp') {
      respond(id, {
        signatures: [
          {
            label: 'fakeFn(a: string, b: number)',
            parameters: [{ label: 'a: string' }, { label: 'b: number' }],
          },
        ],
        activeSignature: 0,
        activeParameter: 0,
      });
      return;
    }

    if (msg.method === 'textDocument/codeAction') {
      const uri = msg.params?.textDocument?.uri || '';
      respond(id, [
        {
          title: 'Fake: remove TODO',
          kind: 'quickfix',
          edit: { changes: { [uri]: makeWholeDocumentEdit(uri, (docs.get(uri)?.text || '').replace(/TODO/g, 'DONE')) } },
          isPreferred: true,
          data: { k: 'removeTodo' },
        },
        {
          title: 'Fake: run command',
          kind: 'quickfix',
          command: { title: 'fake', command: 'fake.command', arguments: [uri] },
          data: { k: 'runCommand' },
        },
      ]);
      return;
    }

    if (msg.method === 'codeAction/resolve') {
      const action = msg.params && typeof msg.params === 'object' ? msg.params : {};
      const uri = action?.edit?.changes ? Object.keys(action.edit.changes)[0] : (action?.command?.arguments?.[0] || '');
      if (action?.data?.k === 'runCommand') {
        respond(id, {
          ...action,
          title: action.title || 'Fake: run command (resolved)',
          command: { title: 'fake', command: 'fake.command', arguments: [uri, 'resolved'] },
        });
        return;
      }
      if (uri) {
        const current = docs.get(uri)?.text || '';
        respond(id, {
          ...action,
          title: action.title || 'Fake: remove TODO (resolved)',
          edit: { changes: { [uri]: makeWholeDocumentEdit(uri, String(current).replace(/TODO/g, 'DONE')) } },
        });
        return;
      }
      respond(id, action);
      return;
    }

    if (msg.method === 'textDocument/rename') {
      const uri = msg.params?.textDocument?.uri || '';
      const newName = String(msg.params?.newName || '');
      const current = docs.get(uri)?.text || '';
      respond(id, { changes: { [uri]: makeWholeDocumentEdit(uri, String(current).replace(/foo/g, newName)) } });
      return;
    }

    if (msg.method === 'textDocument/formatting' || msg.method === 'textDocument/rangeFormatting') {
      const uri = msg.params?.textDocument?.uri || '';
      const current = docs.get(uri)?.text || '';
      respond(id, makeWholeDocumentEdit(uri, String(current)));
      return;
    }

    if (msg.method === 'workspace/executeCommand') {
      respond(id, { ok: true });
      return;
    }

    if (msg.method === 'workspace/willCreateFiles' || msg.method === 'workspace/willRenameFiles' || msg.method === 'workspace/willDeleteFiles') {
      respond(id, { changes: {} });
      return;
    }

    if (msg.method === 'textDocument/documentLink') {
      const uri = msg.params?.textDocument?.uri || '';
      respond(id, [{
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
        tooltip: 'fake link',
        data: { uri },
      }]);
      return;
    }

    if (msg.method === 'documentLink/resolve') {
      const link = msg.params && typeof msg.params === 'object' ? msg.params : {};
      respond(id, { ...link, target: 'https://example.com' });
      return;
    }

    if (msg.method === 'textDocument/codeLens') {
      const uri = msg.params?.textDocument?.uri || '';
      respond(id, [{
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        command: { title: 'Fake Lens', command: 'fake.command', arguments: [uri] },
        data: { uri },
      }]);
      return;
    }

    if (msg.method === 'codeLens/resolve') {
      const lens = msg.params && typeof msg.params === 'object' ? msg.params : {};
      respond(id, { ...lens, command: lens.command || { title: 'Fake Lens', command: 'fake.command', arguments: [lens?.data?.uri || ''] } });
      return;
    }

    if (msg.method === 'textDocument/documentHighlight') {
      respond(id, [{
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
        kind: 1,
      }]);
      return;
    }

    if (msg.method === 'textDocument/selectionRange') {
      const positions = Array.isArray(msg.params?.positions) ? msg.params.positions : [];
      respond(id, positions.map(() => ({
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 8 } },
        parent: { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } } },
      })));
      return;
    }

    if (msg.method === 'textDocument/foldingRange') {
      respond(id, [{ startLine: 0, endLine: 0, kind: 'region' }]);
      return;
    }

    if (msg.method === 'textDocument/inlayHint') {
      respond(id, [{ position: { line: 0, character: 0 }, label: ': fake', kind: 1, paddingRight: true }]);
      return;
    }

    if (msg.method === 'textDocument/semanticTokens/full') {
      const uri = msg.params?.textDocument?.uri || '';
      respond(id, makeSimpleSemanticTokens(uri));
      return;
    }

    if (msg.method === 'textDocument/semanticTokens/full/delta') {
      const uri = msg.params?.textDocument?.uri || '';
      respond(id, makeSimpleSemanticTokens(uri));
      return;
    }

    if (msg.method === 'textDocument/semanticTokens/range') {
      const uri = msg.params?.textDocument?.uri || '';
      respond(id, makeSimpleSemanticTokens(uri));
      return;
    }

    if (msg.method === 'textDocument/prepareCallHierarchy') {
      const uri = msg.params?.textDocument?.uri || '';
      respond(id, [{
        name: 'fakeFn',
        kind: 12,
        uri,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      }]);
      return;
    }

    if (msg.method === 'callHierarchy/incomingCalls') {
      const uri = msg.params?.item?.uri || '';
      respond(id, [{
        from: {
          name: 'caller',
          kind: 12,
          uri,
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        },
        fromRanges: [{ start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }],
      }]);
      return;
    }

    if (msg.method === 'callHierarchy/outgoingCalls') {
      const uri = msg.params?.item?.uri || '';
      respond(id, [{
        to: {
          name: 'callee',
          kind: 12,
          uri,
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        },
        fromRanges: [{ start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }],
      }]);
      return;
    }

    if (msg.method === 'shutdown') {
      respond(id, null);
      return;
    }

    // Unknown request
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
    return;
  }

  if (msg.method && !Object.prototype.hasOwnProperty.call(msg, 'id')) {
    if (msg.method === 'initialized') {
      if (String(process.env.FAKE_LSP_DYNAMIC_REGS || '') === '1' && !dynamicRegsSent) {
        dynamicRegsSent = true;
        void (async () => {
          const regs = [
            {
              id: 'dyn_semantic',
              method: 'textDocument/semanticTokens',
              registerOptions: {
                legend: { tokenTypes: SEMANTIC_TOKEN_TYPES, tokenModifiers: SEMANTIC_TOKEN_MODIFIERS },
                full: { delta: true },
                range: true,
              },
            },
            { id: 'dyn_inlay', method: 'textDocument/inlayHint', registerOptions: true },
            { id: 'dyn_ws_symbol', method: 'workspace/symbol', registerOptions: true },
          ];
          try {
            const res = await sendRequest('client/registerCapability', { registrations: regs }, { timeoutMs: 2000 });
            notify('window/logMessage', { message: `registerCapability response: ${JSON.stringify(res)}` });
          } catch (err) {
            notify('window/logMessage', { message: `registerCapability failed: ${err?.message || String(err)}` });
          }

          await new Promise((r) => setTimeout(r, 30));
          try {
            const res2 = await sendRequest('client/unregisterCapability', {
              unregisterations: [{ id: 'dyn_ws_symbol', method: 'workspace/symbol' }],
            }, { timeoutMs: 2000 });
            notify('window/logMessage', { message: `unregisterCapability response: ${JSON.stringify(res2)}` });
          } catch (err) {
            notify('window/logMessage', { message: `unregisterCapability failed: ${err?.message || String(err)}` });
          }
        })();
      }
      return;
    }
    if (msg.method === 'exit') process.exit(0);

    if (msg.method === 'textDocument/didOpen') {
      const td = msg.params?.textDocument || {};
      const uri = String(td.uri || '');
      docs.set(uri, { text: String(td.text || ''), version: Number(td.version || 1) });
      publishDiagnostics(uri);

      if (String(process.env.FAKE_LSP_CLIENT_REQUESTS || '') === '1') {
        try {
          const current = docs.get(uri)?.text || '';
          const next = String(current).replace(/TODO/g, 'DONE');
          const edit = { changes: { [uri]: makeWholeDocumentEdit(uri, next) } };
          // eslint-disable-next-line no-await-in-loop
          const res = await sendRequest('workspace/applyEdit', { label: 'Fake: applyEdit', edit }, { timeoutMs: 2000 });
          notify('window/logMessage', { message: `applyEdit response: ${JSON.stringify(res)}` });

          const showRes = await sendRequest(
            'window/showMessageRequest',
            { type: 3, message: 'Fake: showMessageRequest', actions: [{ title: 'OK' }] },
            { timeoutMs: 2000 },
          );
          notify('window/logMessage', { message: `showMessageRequest response: ${JSON.stringify(showRes)}` });

          const token = `fakeToken:${Date.now()}`;
          const progRes = await sendRequest('window/workDoneProgress/create', { token }, { timeoutMs: 2000 });
          notify('window/logMessage', { message: `workDoneProgress/create response: ${JSON.stringify(progRes)}` });
        } catch (err) {
          notify('window/logMessage', { message: `client request sequence failed: ${err?.message || String(err)}` });
        }
      }
      return;
    }

    if (msg.method === 'textDocument/didChange') {
      const uri = String(msg.params?.textDocument?.uri || '');
      const doc = docs.get(uri);
      if (!doc) return;
      const changes = Array.isArray(msg.params?.contentChanges) ? msg.params.contentChanges : [];
      let text = doc.text;
      for (const ch of changes) text = applyChange(text, ch);
      doc.text = text;
      doc.version = Number(msg.params?.textDocument?.version || doc.version);
      publishDiagnostics(uri);
      return;
    }

    if (msg.method === 'textDocument/didSave') {
      const uri = String(msg.params?.textDocument?.uri || '');
      const text = typeof msg.params?.text === 'string' ? msg.params.text : '';
      if (uri && text) docs.set(uri, { text, version: docs.get(uri)?.version || 1 });
      notify('window/logMessage', { message: `didSave ${uri}` });
      return;
    }

    if (msg.method === 'textDocument/didClose') {
      const uri = String(msg.params?.textDocument?.uri || '');
      docs.delete(uri);
      return;
    }

    if (msg.method === 'workspace/didCreateFiles' || msg.method === 'workspace/didRenameFiles' || msg.method === 'workspace/didDeleteFiles') {
      notify('window/logMessage', { message: `${msg.method} ${JSON.stringify(msg.params || {})}` });
      return;
    }
  }
});

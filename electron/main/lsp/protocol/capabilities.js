function buildClientCapabilities({
  snippetSupport = true,
  dynamicRegistration = false,
  configuration = true,
  workDoneProgress = true,
  positionEncodings = ['utf-16', 'utf-8', 'utf-32'],
} = {}) {
  const semanticTokenTypes = [
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
  const semanticTokenModifiers = [
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

  return {
    general: {
      positionEncodings: Array.isArray(positionEncodings) && positionEncodings.length ? positionEncodings : ['utf-16'],
    },
    textDocument: {
      synchronization: {
        dynamicRegistration,
        didSave: true,
        willSave: false,
        willSaveWaitUntil: false,
      },
      completion: {
        dynamicRegistration,
        completionItem: {
          snippetSupport: !!snippetSupport,
        },
      },
      hover: { dynamicRegistration },
      definition: { dynamicRegistration },
      references: { dynamicRegistration },
      signatureHelp: { dynamicRegistration, signatureInformation: { documentationFormat: ['markdown', 'plaintext'] } },
      documentSymbol: { dynamicRegistration },
      rename: { dynamicRegistration },
      formatting: { dynamicRegistration },
      rangeFormatting: { dynamicRegistration },
      codeAction: { dynamicRegistration, codeActionLiteralSupport: { codeActionKind: { valueSet: ['quickfix', 'refactor', 'source'] } } },
      foldingRange: { dynamicRegistration, lineFoldingOnly: true },
      implementation: { dynamicRegistration },
      typeDefinition: { dynamicRegistration },
      callHierarchy: { dynamicRegistration },
      inlayHint: { dynamicRegistration },
      semanticTokens: {
        dynamicRegistration,
        requests: {
          range: true,
          full: { delta: true },
        },
        tokenTypes: semanticTokenTypes,
        tokenModifiers: semanticTokenModifiers,
        formats: ['relative'],
        overlappingTokenSupport: false,
        multilineTokenSupport: true,
      },
    },
    workspace: {
      configuration: !!configuration,
      workspaceFolders: true,
      didChangeWatchedFiles: { dynamicRegistration: true },
      symbol: { dynamicRegistration },
    },
    window: {
      workDoneProgress: !!workDoneProgress,
    },
  };
}

function supports(serverCaps, feature, dynamicRegistrationsByMethod) {
  const caps = serverCaps || {};
  const regs = dynamicRegistrationsByMethod;
  const registered = (method) => {
    const map = regs?.get?.(method);
    return !!(map && map instanceof Map && map.size > 0);
  };

  if (feature === 'diagnostics') return true;
  if (feature === 'completion') return !!caps.completionProvider || registered('textDocument/completion');
  if (feature === 'hover') return !!caps.hoverProvider || registered('textDocument/hover');
  if (feature === 'definition') return !!caps.definitionProvider || registered('textDocument/definition');
  if (feature === 'references') return !!caps.referencesProvider || registered('textDocument/references');
  if (feature === 'signatureHelp') return !!caps.signatureHelpProvider || registered('textDocument/signatureHelp');
  if (feature === 'documentSymbol') return !!caps.documentSymbolProvider || registered('textDocument/documentSymbol');
  if (feature === 'workspaceSymbol') return !!caps.workspaceSymbolProvider || registered('workspace/symbol');
  if (feature === 'rename') return !!caps.renameProvider || registered('textDocument/rename');
  if (feature === 'formatting') return !!caps.documentFormattingProvider || registered('textDocument/formatting');
  if (feature === 'rangeFormatting') return !!caps.documentRangeFormattingProvider || registered('textDocument/rangeFormatting');
  if (feature === 'codeAction') return !!caps.codeActionProvider || registered('textDocument/codeAction');
  if (feature === 'executeCommand') return !!caps.executeCommandProvider || registered('workspace/executeCommand');
  if (feature === 'inlayHint') return !!caps.inlayHintProvider || registered('textDocument/inlayHint');
  if (feature === 'semanticTokens') return !!caps.semanticTokensProvider || registered('textDocument/semanticTokens');
  if (feature === 'foldingRange') return !!caps.foldingRangeProvider || registered('textDocument/foldingRange');
  if (feature === 'typeDefinition') return !!caps.typeDefinitionProvider || registered('textDocument/typeDefinition');
  if (feature === 'implementation') return !!caps.implementationProvider || registered('textDocument/implementation');
  if (feature === 'callHierarchy') return !!caps.callHierarchyProvider || registered('textDocument/callHierarchy');
  return false;
}

module.exports = { buildClientCapabilities, supports };

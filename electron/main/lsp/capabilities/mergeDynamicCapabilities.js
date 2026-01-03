function mergeDynamicCapabilities(baseCaps, regsByMethod) {
  const base = (baseCaps && typeof baseCaps === 'object') ? baseCaps : {};
  const regs = regsByMethod;
  if (!regs || !(regs instanceof Map) || regs.size === 0) return base;

  const firstOptions = (method) => {
    const map = regs.get(method);
    if (!map || !(map instanceof Map)) return null;
    for (const r of map.values()) return r?.registerOptions ?? true;
    return null;
  };

  const merged = { ...base };

  const setBoolOrOptions = (key, method) => {
    const opt = firstOptions(method);
    if (!opt) return;
    merged[key] = opt === true ? true : opt;
  };

  setBoolOrOptions('completionProvider', 'textDocument/completion');
  setBoolOrOptions('hoverProvider', 'textDocument/hover');
  setBoolOrOptions('definitionProvider', 'textDocument/definition');
  setBoolOrOptions('referencesProvider', 'textDocument/references');
  setBoolOrOptions('signatureHelpProvider', 'textDocument/signatureHelp');
  setBoolOrOptions('documentSymbolProvider', 'textDocument/documentSymbol');
  setBoolOrOptions('renameProvider', 'textDocument/rename');
  setBoolOrOptions('documentFormattingProvider', 'textDocument/formatting');
  setBoolOrOptions('documentRangeFormattingProvider', 'textDocument/rangeFormatting');
  setBoolOrOptions('codeActionProvider', 'textDocument/codeAction');
  setBoolOrOptions('foldingRangeProvider', 'textDocument/foldingRange');
  setBoolOrOptions('implementationProvider', 'textDocument/implementation');
  setBoolOrOptions('typeDefinitionProvider', 'textDocument/typeDefinition');
  setBoolOrOptions('callHierarchyProvider', 'textDocument/callHierarchy');
  setBoolOrOptions('inlayHintProvider', 'textDocument/inlayHint');
  setBoolOrOptions('semanticTokensProvider', 'textDocument/semanticTokens');
  setBoolOrOptions('workspaceSymbolProvider', 'workspace/symbol');

  try {
    const map = regs.get('workspace/executeCommand');
    if (map && map instanceof Map && map.size) {
      const commands = new Set(Array.isArray(base?.executeCommandProvider?.commands) ? base.executeCommandProvider.commands : []);
      for (const r of map.values()) {
        const opts = r?.registerOptions;
        const list = Array.isArray(opts?.commands) ? opts.commands : [];
        for (const c of list) commands.add(String(c));
      }
      merged.executeCommandProvider = { ...(base.executeCommandProvider || {}), commands: Array.from(commands) };
    }
  } catch {
    // ignore
  }

  return merged;
}

module.exports = { mergeDynamicCapabilities };


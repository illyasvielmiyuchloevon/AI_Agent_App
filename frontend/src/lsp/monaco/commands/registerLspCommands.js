export const registerLspCommands = (monaco, { bridge, outputService, applyWorkspaceEdit } = {}) => {
  if (!monaco?.editor?.registerCommand) return [];
  const disposables = [];

  disposables.push(monaco.editor.registerCommand('lsp.executeCodeAction', async (_accessor, payload) => {
    const serverId = payload?.serverId ? String(payload.serverId) : '';
    const action = payload?.action || null;
    if (!serverId || !action) return;
    if (action.edit) {
      try {
        await applyWorkspaceEdit?.(action.edit);
      } catch (err) {
        outputService?.append?.('LSP', `[ERROR] applyWorkspaceEdit failed: ${err?.message || String(err)}`);
        return;
      }
    }
    if (action.command) {
      try {
        await bridge?.executeCommand?.(serverId, { command: action.command.command, arguments: action.command.arguments || [] }, { timeoutMs: 8000 });
      } catch (err) {
        outputService?.append?.('LSP', `[ERROR] executeCommand failed: ${err?.message || String(err)}`);
      }
    }
  }));

  disposables.push(monaco.editor.registerCommand('lsp.executeServerCommand', async (_accessor, payload) => {
    const serverId = payload?.serverId ? String(payload.serverId) : '';
    const cmd = payload?.command || null;
    if (!serverId || !cmd?.command) return;
    try {
      await bridge?.executeCommand?.(serverId, { command: String(cmd.command), arguments: cmd.arguments || [] }, { timeoutMs: 8000 });
    } catch (err) {
      outputService?.append?.('LSP', `[ERROR] executeCommand failed: ${err?.message || String(err)}`);
    }
  }));

  return disposables;
};


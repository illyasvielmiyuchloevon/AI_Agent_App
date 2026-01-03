const vscode = require('vscode');

function activate(context) {
  const out = vscode.window.createOutputChannel('Demo Extension');
  out.appendLine('demo extension activated');

  const d = vscode.commands.registerCommand('demo.hello', async () => {
    out.appendLine('demo.hello executed');
    await vscode.window.showInformationMessage('Hello from demo extension');
    return true;
  });

  context.subscriptions.push(d);

  const provider = vscode.languages.registerCompletionItemProvider('javascript', {
    provideCompletionItems() {
      return [
        { label: 'demoHello', detail: 'Demo Extension', documentation: 'Completion from demo extension', insertText: 'demoHello', kind: 1 },
        { label: 'demoWorld', detail: 'Demo Extension', documentation: 'Completion from demo extension', insertText: 'demoWorld', kind: 1 },
      ];
    },
  }, '.');
  context.subscriptions.push(provider);

  const onOpen = vscode.workspace.onDidOpenTextDocument((doc) => {
    try { out.appendLine(`opened: ${doc?.uri?.toString?.() || doc?.uri || ''}`); } catch {}
  });
  context.subscriptions.push(onOpen);

  const onActive = vscode.window.onDidChangeActiveTextEditor((editor) => {
    const uri = editor?.document?.uri?.toString?.() || editor?.document?.uri || '';
    try { out.appendLine(`active: ${uri}`); } catch {}
  });
  context.subscriptions.push(onActive);

  const onSave = vscode.workspace.onDidSaveTextDocument((doc) => {
    const uri = doc?.uri?.toString?.() || doc?.uri || '';
    try { out.appendLine(`saved: ${uri}`); } catch {}
  });
  context.subscriptions.push(onSave);

  const promptCmd = vscode.commands.registerCommand('demo.prompt', async () => {
    const name = await vscode.window.showInputBox({ title: 'Demo', prompt: '请输入名字', placeHolder: 'Alice' });
    if (!name) return;
    const choice = await vscode.window.showQuickPick(['One', 'Two', 'Three'], { title: 'Pick', placeHolder: '选择一个' });
    out.appendLine(`prompt result name=${name} choice=${choice || ''}`);
  });
  context.subscriptions.push(promptCmd);
}

module.exports = { activate };

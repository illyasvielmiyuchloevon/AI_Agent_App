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
}

module.exports = { activate };


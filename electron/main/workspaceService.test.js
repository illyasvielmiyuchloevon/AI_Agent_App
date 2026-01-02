const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createWorkspaceService } = require('./workspaceService');

test('workspaceService: loads settings snapshot and emits changes', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ide-ws-'));
  const root = path.join(tmp, 'ws');
  fs.mkdirSync(path.join(root, '.vscode'), { recursive: true });
  fs.writeFileSync(path.join(root, '.vscode', 'settings.json'), JSON.stringify({ editor: { tabSize: 4 } }), 'utf8');

  const svc = createWorkspaceService();
  const seen = [];
  const dispose = svc.onDidChangeConfiguration((s) => seen.push(s));

  await svc.start({ fsPath: root });
  const cfg = svc.getConfiguration();
  assert.equal(cfg.editor.tabSize, 4);
  assert.ok(seen.length >= 1);

  await svc.stop();
  assert.deepEqual(svc.getConfiguration(), {});
  dispose();
});


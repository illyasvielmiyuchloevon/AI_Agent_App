const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { LspManager } = require('../LspManager');
const { toFileUri } = require('../util/uri');

test('LspManager + fake server: didOpen triggers diagnostics', async () => {
  const received = [];
  const manager = new LspManager({
    onDiagnostics: (p) => received.push(p),
  });

  const rootFsPath = path.resolve(__dirname);
  const rootUri = toFileUri(rootFsPath);

  const serverConfig = {
    id: 'fake',
    languageId: 'typescript',
    transport: {
      kind: 'stdio',
      command: process.execPath,
      args: [path.join(__dirname, 'fakeLspServer.js')],
    },
    fileExtensions: ['.ts'],
  };

  const { serverId } = await manager.ensureServer({
    workspaceId: 'w1',
    languageId: 'typescript',
    serverConfig,
    workspace: { workspaceId: 'w1', rootUri, folders: [{ name: 'w1', uri: rootUri }] },
  });

  const uri = `${rootUri.replace(/\/$/, '')}/test.ts`;
  await manager.openDocument(serverId, { uri, languageId: 'typescript', version: 1, text: 'TODO test' });

  await new Promise((r) => setTimeout(r, 50));
  assert.ok(received.some((d) => d.uri === uri));

  await manager.shutdownAll();
});

test('LspManager + fake server: declaration/documentColor/colorPresentation/linkedEditingRange', async () => {
  const manager = new LspManager();

  const rootFsPath = path.resolve(__dirname);
  const rootUri = toFileUri(rootFsPath);

  const serverConfig = {
    id: 'fake',
    languageId: 'typescript',
    transport: {
      kind: 'stdio',
      command: process.execPath,
      args: [path.join(__dirname, 'fakeLspServer.js')],
    },
    fileExtensions: ['.ts'],
  };

  const { serverId } = await manager.ensureServer({
    workspaceId: 'w1',
    languageId: 'typescript',
    serverConfig,
    workspace: { workspaceId: 'w1', rootUri, folders: [{ name: 'w1', uri: rootUri }] },
  });

  const uri = `${rootUri.replace(/\/$/, '')}/test.ts`;
  await manager.openDocument(serverId, { uri, languageId: 'typescript', version: 1, text: 'TODO test' });

  const decl = await manager.declaration(serverId, {
    textDocument: { uri },
    position: { line: 0, character: 0 },
  });
  assert.ok(decl);

  const colors = await manager.documentColor(serverId, { textDocument: { uri } });
  assert.ok(Array.isArray(colors));
  assert.equal(colors.length, 1);
  assert.deepEqual(colors[0]?.color, { red: 1, green: 0, blue: 0, alpha: 1 });

  const presentations = await manager.colorPresentation(serverId, {
    textDocument: { uri },
    color: { red: 1, green: 0, blue: 0, alpha: 1 },
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
  });
  assert.ok(Array.isArray(presentations));
  assert.equal(presentations[0]?.label, 'red');
  assert.equal(presentations[0]?.textEdit?.newText, '#ff0000');

  const ler = await manager.linkedEditingRange(serverId, {
    textDocument: { uri },
    position: { line: 0, character: 0 },
  });
  assert.ok(ler && Array.isArray(ler.ranges) && ler.ranges.length === 2);

  await manager.shutdownAll();
});

test('LspManager + fake server: workspace file operations', async () => {
  const logs = [];
  let applyCalls = 0;

  const manager = new LspManager({
    onLog: (p) => logs.push(String(p?.message || '')),
    applyWorkspaceEdit: async () => {
      applyCalls += 1;
      return { applied: true };
    },
  });

  const rootFsPath = path.resolve(__dirname);
  const rootUri = toFileUri(rootFsPath);

  const serverConfig = {
    id: 'fake',
    languageId: 'typescript',
    transport: {
      kind: 'stdio',
      command: process.execPath,
      args: [path.join(__dirname, 'fakeLspServer.js')],
    },
    fileExtensions: ['.ts'],
  };

  await manager.ensureServer({
    workspaceId: 'w1',
    languageId: 'typescript',
    serverConfig,
    workspace: { workspaceId: 'w1', rootUri, folders: [{ name: 'w1', uri: rootUri }] },
  });

  const a = `${rootUri.replace(/\/$/, '')}/a.ts`;
  const b = `${rootUri.replace(/\/$/, '')}/b.ts`;

  const willCreate = await manager.willCreateFiles('w1', { files: [{ uri: a }] });
  assert.ok(willCreate?.ok);
  const didCreate = await manager.didCreateFiles('w1', { files: [{ uri: a }] });
  assert.ok(didCreate?.ok);

  const willRename = await manager.willRenameFiles('w1', { files: [{ oldUri: a, newUri: b }] });
  assert.ok(willRename?.ok);
  const didRename = await manager.didRenameFiles('w1', { files: [{ oldUri: a, newUri: b }] });
  assert.ok(didRename?.ok);

  const willDelete = await manager.willDeleteFiles('w1', { files: [{ uri: b }] });
  assert.ok(willDelete?.ok);
  const didDelete = await manager.didDeleteFiles('w1', { files: [{ uri: b }] });
  assert.ok(didDelete?.ok);

  await new Promise((r) => setTimeout(r, 60));
  assert.ok(applyCalls >= 3);
  assert.ok(logs.some((m) => m.includes('workspace/didCreateFiles')));
  assert.ok(logs.some((m) => m.includes('workspace/didRenameFiles')));
  assert.ok(logs.some((m) => m.includes('workspace/didDeleteFiles')));

  await manager.shutdownAll();
});

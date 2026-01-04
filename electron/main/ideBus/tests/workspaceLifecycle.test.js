const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');

const { registerIdeBus } = require('../registerIdeBus');
const { createWorkspaceService } = require('../../workspaceService');

function createHarness({ workspaceService, recentStore, extensionHostService, dapService, lspService } = {}) {
  const handlers = new Map();
  const ipcMain = {
    on: (channel, fn) => {
      handlers.set(channel, fn);
    },
  };

  const sent = {
    responses: new Map(),
    notifications: [],
  };

  const sender = {
    id: 1,
    send: (_channel, msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.id != null) {
        const pending = sent.responses.get(msg.id);
        if (pending) {
          sent.responses.delete(msg.id);
          pending.resolve(msg.result);
          return;
        }
      }
      sent.notifications.push(msg);
    },
    once: () => {},
  };

  registerIdeBus({
    ipcMain,
    workspaceService,
    recentStore,
    extensionHostService,
    dapService,
    lspService,
  });

  const sendRequest = (method, params) =>
    new Promise((resolve) => {
      const id = Math.floor(Math.random() * 1e9);
      sent.responses.set(id, { resolve });
      const msg = { jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) };
      const onMsg = handlers.get('idebus:message');
      onMsg({ sender }, msg);
    });

  return {
    sendRequest,
    getNotifications: () => sent.notifications.slice(),
    clearNotifications: () => {
      sent.notifications.length = 0;
    },
  };
}

test('workspace lifecycle: open/switch/close and trust notifications', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'idebus-ws-'));
  const ws1 = path.join(root, 'ws1');
  const ws2 = path.join(root, 'ws2');
  await fsp.mkdir(path.join(ws1, '.vscode'), { recursive: true });
  await fsp.mkdir(path.join(ws2, '.vscode'), { recursive: true });

  const trustByPath = new Map();
  const recentStore = {
    touch: ({ id, fsPath, name }) => ({ id, fsPath, name }),
    getTrustedByFsPath: (fsPath) => !!trustByPath.get(String(fsPath || '')),
    setTrustedByFsPath: (fsPath, trusted) => trustByPath.set(String(fsPath || ''), !!trusted),
  };

  const extensionHostService = {
    restart: async () => ({ ok: true }),
    connection: { sendNotification: () => {} },
  };

  const dapCalls = { stopAll: 0 };
  const dapService = {
    stopAllSessions: async () => {
      dapCalls.stopAll += 1;
      return { ok: true };
    },
  };

  const lspCalls = { shutdown: [], config: [] };
  const lspService = {
    manager: {
      shutdownWorkspace: async (workspaceId) => {
        lspCalls.shutdown.push(String(workspaceId || ''));
      },
      didChangeConfiguration: async (workspaceId, settings) => {
        lspCalls.config.push({ workspaceId: String(workspaceId || ''), settings });
      },
    },
  };

  const workspaceService = createWorkspaceService();
  const h = createHarness({ workspaceService, recentStore, extensionHostService, dapService, lspService });

  const r1 = await h.sendRequest('workspace/open', { id: 'w1', fsPath: ws1, name: 'WS1' });
  assert.equal(r1.ok, true);

  const s1 = await h.sendRequest('workspace/getState');
  assert.equal(s1.ok, true);
  assert.equal(s1.workspace.workspaceId, 'w1');
  assert.equal(s1.workspace.fsPath, ws1);
  assert.equal(s1.trusted, false);

  const n1 = h.getNotifications().filter((m) => m && m.method === 'workspace/stateChanged');
  assert.ok(n1.length >= 1);
  assert.equal(n1[n1.length - 1].params.workspace.workspaceId, 'w1');

  h.clearNotifications();
  const t1 = await h.sendRequest('workspace/setTrust', { fsPath: ws1, trusted: true });
  assert.equal(t1.ok, true);
  assert.equal(t1.trusted, true);
  const nTrust = h.getNotifications().filter((m) => m && m.method === 'workspace/trustChanged');
  assert.ok(nTrust.length >= 1);
  assert.equal(nTrust[nTrust.length - 1].params.workspaceId, 'w1');
  assert.equal(nTrust[nTrust.length - 1].params.trusted, true);

  h.clearNotifications();
  const r2 = await h.sendRequest('workspace/open', { id: 'w2', fsPath: ws2, name: 'WS2' });
  assert.equal(r2.ok, true);
  assert.equal(dapCalls.stopAll, 1);
  assert.deepEqual(lspCalls.shutdown, ['w1']);

  const s2 = await h.sendRequest('workspace/getState');
  assert.equal(s2.ok, true);
  assert.equal(s2.workspace.workspaceId, 'w2');
  assert.equal(s2.workspace.fsPath, ws2);

  const rClose = await h.sendRequest('workspace/close');
  assert.equal(rClose.ok, true);
  assert.ok(lspCalls.shutdown.includes('w2'));
  const nClose = h.getNotifications().filter((m) => m && m.method === 'workspace/stateChanged');
  assert.ok(nClose.some((m) => m?.params?.workspace == null));
});


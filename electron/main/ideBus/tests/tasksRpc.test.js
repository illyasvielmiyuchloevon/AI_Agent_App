const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');
const { registerIdeBus } = require('../registerIdeBus');

function createHarness({ workspaceFsPath, trusted }) {
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

  const workspaceService = {
    getCurrent: () => ({ fsPath: workspaceFsPath }),
    onDidChangeConfiguration: () => {},
  };

  const recentStore = {
    getTrustedByFsPath: () => !!trusted,
  };

  registerIdeBus({ ipcMain, workspaceService, recentStore });

  const sendRequest = (method, params) => {
    const id = (sendRequest._id = (sendRequest._id || 0) + 1);
    const fn = handlers.get('idebus:message');
    assert.equal(typeof fn, 'function');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        sent.responses.delete(id);
        reject(new Error(`timeout waiting for response: ${method}`));
      }, 5000);
      sent.responses.set(id, {
        resolve: (res) => {
          clearTimeout(timer);
          resolve(res);
        },
      });
      fn({ sender }, { jsonrpc: '2.0', id, method, params });
    });
  };

  const waitForOutputText = async (predicate, { timeoutMs = 8000 } = {}) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      for (const msg of sent.notifications) {
        if (msg?.method !== 'output/append') continue;
        const p = msg?.params || {};
        const text = p?.text != null ? String(p.text) : '';
        if (!text) continue;
        if (predicate(text, msg)) return { text, msg };
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('timeout waiting for output');
  };

  return { sendRequest, waitForOutputText };
}

test('tasks/list loads .vscode/tasks.json when present', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'idebus-tasks-'));
  await fsp.mkdir(path.join(root, '.vscode'), { recursive: true });
  await fsp.writeFile(
    path.join(root, '.vscode', 'tasks.json'),
    JSON.stringify({
      version: '2.0.0',
      tasks: [
        { label: 'hello', type: 'process', command: process.execPath, args: ['-e', 'console.log("hi")'] },
      ],
    }),
    'utf8'
  );

  const h = createHarness({ workspaceFsPath: root, trusted: true });
  const res = await h.sendRequest('tasks/list');
  assert.equal(res.ok, true);
  assert.equal(res.exists, true);
  assert.equal(res.version, '2.0.0');
  assert.ok(Array.isArray(res.tasks));
  assert.equal(res.tasks[0].label, 'hello');
});

test('tasks/run is blocked when workspace is not trusted', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'idebus-tasks-'));
  const h = createHarness({ workspaceFsPath: root, trusted: false });
  const res = await h.sendRequest('tasks/run', { command: 'echo hi' });
  assert.equal(res.ok, false);
  assert.ok(String(res.error || '').includes('workspace not trusted'));
});

test('tasks/run executes process task and emits output/append', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'idebus-tasks-'));
  const h = createHarness({ workspaceFsPath: root, trusted: true });

  const res = await h.sendRequest('tasks/run', { command: process.execPath, args: ['-e', 'console.log("hi")'], type: 'process' });
  assert.equal(res.ok, true);
  assert.ok(res.taskId);

  await h.waitForOutputText((text) => text.includes('hi'));
});

test('tasks/terminate terminates a running task', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'idebus-tasks-'));
  const h = createHarness({ workspaceFsPath: root, trusted: true });

  const started = await h.sendRequest('tasks/run', { command: process.execPath, args: ['-e', 'setTimeout(()=>{}, 10000)'], type: 'process', label: 'sleep' });
  assert.equal(started.ok, true);
  assert.ok(started.taskId);

  await new Promise((r) => setTimeout(r, 100));

  const stopped = await h.sendRequest('tasks/terminate', { taskId: started.taskId });
  assert.equal(stopped.ok, true);
  assert.equal(stopped.taskId, started.taskId);
});


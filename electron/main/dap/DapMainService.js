const path = require('path');
const { dialog, app } = require('electron');
const { StdioTransport } = require('../lsp/transport/StdioTransport');
const { DapConnection } = require('./DapConnection');

function createDapMainService({ ipcMain, broadcast, notify, workspaceService, recentStore, logger } = {}) {
  if (!ipcMain) throw new Error('createDapMainService: ipcMain is required');

  let lastActiveWebContents = null;
  const touchSender = (webContents) => {
    try {
      const wc = webContents || null;
      if (!wc) return;
      lastActiveWebContents = wc;
      broadcast?.('__subscribeWebContents', wc);
    } catch {}
  };

  const ensureSenderSubscribed = (event) => {
    try {
      touchSender(event?.sender);
    } catch {}
  };

  const getCurrentWorkspaceFsPath = () => {
    try {
      return String(workspaceService?.getCurrent?.()?.fsPath || '');
    } catch {
      return '';
    }
  };

  const isWorkspaceTrusted = () => {
    const fsPath = getCurrentWorkspaceFsPath();
    if (!fsPath) return false;
    try {
      return !!recentStore?.getTrustedByFsPath?.(fsPath);
    } catch {
      return false;
    }
  };

  const ensureWorkspaceTrustedForHighRisk = async ({ reason = '' } = {}) => {
    if (isWorkspaceTrusted()) return { ok: true, trusted: true };

    const wc = lastActiveWebContents || null;
    const win = (() => {
      try {
        const { BrowserWindow } = require('electron');
        return wc ? BrowserWindow.fromWebContents(wc) : null;
      } catch {
        return null;
      }
    })();

    const msg = reason
      ? `该操作需要信任当前工作区：\n\n${reason}\n\n继续并信任此工作区？`
      : '该操作需要信任当前工作区。\n\n继续并信任此工作区？';

    const res = await dialog.showMessageBox(win || undefined, {
      type: 'warning',
      buttons: ['信任并继续', '取消'],
      defaultId: 0,
      cancelId: 1,
      message: 'Workspace Trust',
      detail: msg,
      noLink: true,
    });

    if (res.response !== 0) return { ok: false, canceled: true, trusted: false };

    const fsPath = getCurrentWorkspaceFsPath();
    if (!fsPath) return { ok: false, error: 'no active workspace', trusted: false };
    try {
      recentStore?.setTrustedByFsPath?.(fsPath, true);
    } catch {}
    return { ok: true, trusted: true };
  };

  const sessions = new Map(); // sessionId -> { transport, conn, startedAt, adapter, name }
  let sessionSeq = 1;

  const broadcastEvent = (sessionId, event) => {
    try {
      const payload = { sessionId, event, ts: Date.now() };
      broadcast?.('dap:event', payload);
      notify?.('debug/event', payload);
    } catch {}
  };

  const broadcastStatus = (sessionId, status, extra) => {
    try {
      const payload = { sessionId, status, ...(extra || {}), ts: Date.now() };
      broadcast?.('dap:status', payload);
      notify?.('debug/status', payload);
    } catch {}
  };

  const normalizeAdapter = (adapter) => {
    const kind = String(adapter?.kind || '').trim();
    const builtinId = String(adapter?.id || '').trim();
    if (kind === 'builtin' && builtinId === 'fake') {
      const entry = resolveBuiltInFakeAdapterEntry();
      return {
        command: process.execPath,
        args: [entry],
        env: { ELECTRON_RUN_AS_NODE: '1' },
        cwd: app.getAppPath(),
      };
    }

    const cmd = String(adapter?.command || '').trim();
    const args = Array.isArray(adapter?.args) ? adapter.args.map((x) => String(x)) : [];
    const env = adapter?.env && typeof adapter.env === 'object' ? adapter.env : undefined;
    const cwd = adapter?.cwd ? String(adapter.cwd) : undefined;
    if (!cmd) throw new Error('dap adapter command is required');
    return { command: cmd, args, env, cwd };
  };

  const startSession = async ({ adapter, name, initialize, request = 'launch', arguments: requestArgs } = {}) => {
    const gate = await ensureWorkspaceTrustedForHighRisk({ reason: '调试适配器会在本机启动一个进程并与之通信。' });
    if (!gate.ok) return gate;

    const normalized = normalizeAdapter(adapter);
    const sessionId = `dap:${Date.now()}:${sessionSeq++}`;
    const t = new StdioTransport({ ...normalized, logger });
    t.start();
    const conn = new DapConnection(t, { logger });

    sessions.set(sessionId, { transport: t, conn, startedAt: Date.now(), adapter: normalized, name: String(name || '') });
    broadcastStatus(sessionId, 'starting', { name: String(name || '') });

    conn.onEvent((evt) => {
      broadcastEvent(sessionId, evt);
      if (evt?.event === 'terminated') {
        broadcastStatus(sessionId, 'terminated');
      }
      if (evt?.event === 'exited') {
        broadcastStatus(sessionId, 'exited', { exitCode: evt?.body?.exitCode });
      }
    });

    conn.on('close', () => {
      broadcastStatus(sessionId, 'closed');
      sessions.delete(sessionId);
    });

    const initArgs = initialize && typeof initialize === 'object'
      ? initialize
      : {
        adapterID: 'fake',
        clientID: 'ai-agent-app',
        clientName: 'AI Agent IDE',
        linesStartAt1: true,
        columnsStartAt1: true,
        supportsVariableType: true,
        supportsVariablePaging: false,
        supportsRunInTerminalRequest: false,
        locale: 'zh-CN',
      };

    const initRes = await conn.sendRequest('initialize', initArgs, { timeoutMs: 20_000 });

    const req = String(request || 'launch');
    if (req !== 'launch' && req !== 'attach') throw new Error(`unsupported dap request: ${req}`);
    await conn.sendRequest(req, requestArgs || {}, { timeoutMs: 30_000 });
    try { await conn.sendRequest('configurationDone', {}, { timeoutMs: 10_000 }); } catch {}

    broadcastStatus(sessionId, 'running', { capabilities: initRes?.body || null });
    return { ok: true, sessionId, initializeResponse: initRes };
  };

  const getSession = (sessionId) => sessions.get(String(sessionId || ''));

  const stopSession = async (sessionId) => {
    const s = getSession(sessionId);
    if (!s) return { ok: true, missing: true };
    try {
      await s.conn.sendRequest('disconnect', { restart: false, terminateDebuggee: true }, { timeoutMs: 8_000 });
    } catch {}
    try { s.conn.dispose(); } catch {}
    try { s.transport.close(); } catch {}
    sessions.delete(String(sessionId || ''));
    return { ok: true };
  };

  const stopAllSessions = async () => {
    for (const id of Array.from(sessions.keys())) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await stopSession(id);
      } catch {}
    }
    return { ok: true };
  };

  const sendRequest = async (sessionId, command, args, options) => {
    const s = getSession(sessionId);
    if (!s) return { ok: false, error: 'session not found' };
    const res = await s.conn.sendRequest(command, args, options || {});
    return { ok: true, response: res };
  };

  ipcMain.handle('dap:startSession', async (event, payload) => {
    ensureSenderSubscribed(event);
    return startSession(payload || {});
  });

  ipcMain.handle('dap:stopSession', async (event, sessionId) => {
    ensureSenderSubscribed(event);
    return stopSession(sessionId);
  });

  ipcMain.handle('dap:sendRequest', async (event, sessionId, command, args, options) => {
    ensureSenderSubscribed(event);
    return sendRequest(sessionId, command, args, options);
  });

  ipcMain.handle('dap:listSessions', async (event) => {
    ensureSenderSubscribed(event);
    const items = Array.from(sessions.entries()).map(([id, s]) => ({
      sessionId: id,
      startedAt: s.startedAt,
      name: s.name,
      adapter: s.adapter,
    }));
    return { ok: true, items };
  });

  return {
    touchSender,
    startSession,
    stopSession,
    stopAllSessions,
    sendRequest,
    listSessions: () => Array.from(sessions.entries()).map(([id, s]) => ({
      sessionId: id,
      startedAt: s.startedAt,
      name: s.name,
      adapter: s.adapter,
    })),
  };
}

function resolveBuiltInFakeAdapterEntry() {
  return path.join(__dirname, 'tests', 'fakeDapServer.js');
}

module.exports = { createDapMainService, resolveBuiltInFakeAdapterEntry };

import type { Server as HttpServer } from 'http';
import { WebSocketServer } from 'ws';
import * as pty from 'node-pty';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

type CreateProfile = 'cmd' | 'powershell' | 'bash';

type ClientMessage =
  | { type: 'create'; requestId?: string; profile?: CreateProfile; cwd?: string; cols?: number; rows?: number; env?: Record<string, string> }
  | { type: 'input'; id: string; data: string }
  | { type: 'resize'; id: string; cols: number; rows: number }
  | { type: 'dispose'; id: string }
  | { type: 'list'; requestId?: string };

type ServerMessage =
  | { type: 'hello'; version: number }
  | { type: 'created'; requestId?: string; id: string; pid: number; profile: CreateProfile; cwd: string; title: string }
  | { type: 'data'; id: string; data: string }
  | { type: 'exit'; id: string; exitCode: number; signal?: number }
  | { type: 'disposed'; id: string }
  | { type: 'list'; requestId?: string; terminals: Array<{ id: string; pid: number; profile: CreateProfile; cwd: string; title: string }> }
  | { type: 'error'; message: string; requestId?: string };

type TerminalSession = {
  id: string;
  profile: CreateProfile;
  cwd: string;
  title: string;
  pty: pty.IPty;
};

function safeNumber(value: unknown, fallback: number) {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.floor(n));
}

function pickShell(profile: CreateProfile): { shell: string; args: string[]; title: string } {
  if (process.platform === 'win32') {
    if (profile === 'powershell') {
      const systemRoot = process.env.SystemRoot || 'C:\\Windows';
      const ps = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      return { shell: fs.existsSync(ps) ? ps : 'powershell.exe', args: ['-NoLogo'], title: 'powershell' };
    }
    if (profile === 'bash') {
      return { shell: 'bash.exe', args: ['--login'], title: 'bash' };
    }
    return { shell: process.env.COMSPEC || 'cmd.exe', args: [], title: 'cmd' };
  }

  if (profile === 'powershell') return { shell: 'pwsh', args: ['-NoLogo'], title: 'pwsh' };
  if (profile === 'bash') return { shell: 'bash', args: ['--login'], title: 'bash' };
  return { shell: 'bash', args: ['--login'], title: 'bash' };
}

function sanitizeCwd(input: unknown): string {
  const raw = String(input || '').trim();
  if (!raw) return process.cwd();
  try {
    const resolved = path.resolve(raw);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) return resolved;
  } catch {}
  return process.cwd();
}

function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    const type = (obj as any).type;
    if (type === 'create') return obj as ClientMessage;
    if (type === 'input' || type === 'resize' || type === 'dispose' || type === 'list') return obj as ClientMessage;
    return null;
  } catch {
    return null;
  }
}

export function registerTerminalWs(server: HttpServer) {
  const wss = new WebSocketServer({ server, path: '/terminal/ws' });

  wss.on('connection', (ws) => {
    const sessions = new Map<string, TerminalSession>();

    const send = (msg: ServerMessage) => {
      if (ws.readyState !== ws.OPEN) return;
      ws.send(JSON.stringify(msg));
    };

    const dispose = (id: string) => {
      const sess = sessions.get(id);
      if (!sess) return;
      sessions.delete(id);
      try {
        sess.pty.kill();
      } catch {}
      send({ type: 'disposed', id });
    };

    const sendList = (requestId?: string) => {
      send({
        type: 'list',
        requestId,
        terminals: Array.from(sessions.values()).map((s) => ({
          id: s.id,
          pid: s.pty.pid,
          profile: s.profile,
          cwd: s.cwd,
          title: s.title,
        })),
      });
    };

    send({ type: 'hello', version: 1 });

    ws.on('message', (data) => {
      const raw = typeof data === 'string' ? data : data.toString('utf8');
      const msg = parseClientMessage(raw);
      if (!msg) {
        send({ type: 'error', message: 'Invalid message' });
        return;
      }

      if (msg.type === 'list') {
        sendList(msg.requestId);
        return;
      }

      if (msg.type === 'create') {
        const profile = (msg.profile === 'powershell' || msg.profile === 'bash' || msg.profile === 'cmd')
          ? msg.profile
          : 'cmd';
        const cwd = sanitizeCwd(msg.cwd);
        const cols = safeNumber(msg.cols, 80);
        const rows = safeNumber(msg.rows, 24);
        const env = { ...(process.env as Record<string, string>), ...(msg.env || {}) };
        env.TERM = env.TERM || 'xterm-256color';

        const { shell, args, title } = pickShell(profile);
        const id = randomUUID();
        let child: pty.IPty;
        try {
          child = pty.spawn(shell, args, {
            name: 'xterm-256color',
            cwd,
            cols,
            rows,
            env,
            ...(process.platform === 'win32' ? { useConpty: process.env.AI_AGENT_TERMINAL_USE_CONPTY === '1' } : {}),
          } as any);
        } catch (e: any) {
          send({ type: 'error', requestId: msg.requestId, message: e?.message || 'Failed to spawn PTY' });
          return;
        }

        const session: TerminalSession = { id, profile, cwd, title, pty: child };
        sessions.set(id, session);

        child.onData((chunk) => send({ type: 'data', id, data: chunk }));
        child.onExit((ev) => {
          send({ type: 'exit', id, exitCode: safeNumber((ev as any)?.exitCode, 0), signal: (ev as any)?.signal });
          sessions.delete(id);
        });

        send({ type: 'created', requestId: msg.requestId, id, pid: child.pid, profile, cwd, title });
        return;
      }

      if (msg.type === 'input') {
        const sess = sessions.get(String(msg.id || ''));
        if (!sess) return;
        const data = typeof msg.data === 'string' ? msg.data : String(msg.data || '');
        try {
          sess.pty.write(data);
        } catch {}
        return;
      }

      if (msg.type === 'resize') {
        const sess = sessions.get(String(msg.id || ''));
        if (!sess) return;
        const cols = safeNumber(msg.cols, 80);
        const rows = safeNumber(msg.rows, 24);
        try {
          sess.pty.resize(cols, rows);
        } catch {}
        return;
      }

      if (msg.type === 'dispose') {
        dispose(String(msg.id || ''));
        return;
      }
    });

    ws.on('close', () => {
      for (const id of Array.from(sessions.keys())) dispose(id);
    });
  });
}

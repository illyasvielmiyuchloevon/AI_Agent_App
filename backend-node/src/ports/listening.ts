import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type ListeningPort = {
  host: string;
  port: number;
  pid?: number;
  process?: string;
};

const parseWindowsHostPort = (token: string) => {
  const s = String(token || "").trim();
  if (!s) return null;
  if (s.startsWith("[")) {
    const idx = s.indexOf("]:");
    if (idx === -1) return null;
    const host = s.slice(1, idx);
    const port = Number.parseInt(s.slice(idx + 2), 10);
    if (!Number.isFinite(port)) return null;
    return { host, port };
  }
  const last = s.lastIndexOf(":");
  if (last === -1) return null;
  const host = s.slice(0, last);
  const port = Number.parseInt(s.slice(last + 1), 10);
  if (!Number.isFinite(port)) return null;
  return { host, port };
};

const uniqPorts = (ports: ListeningPort[]) => {
  const out: ListeningPort[] = [];
  const seen = new Set<string>();
  for (const p of ports) {
    const key = `${p.host}:${p.port}:${p.pid || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
};

async function run(cmd: string, args: string[], timeoutMs = 2000): Promise<string> {
  const { stdout } = await execFileAsync(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 * 8 });
  return String(stdout || "");
}

function parseWindowsNetstat(output: string): ListeningPort[] {
  const lines = String(output || "").split(/\r?\n/);
  const ports: ListeningPort[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!/^TCP\s+/i.test(line)) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 5) continue;
    const local = parseWindowsHostPort(parts[1]);
    const state = String(parts[3] || "").toUpperCase();
    const pid = Number.parseInt(parts[4], 10);
    if (!local) continue;
    if (state !== "LISTENING") continue;
    ports.push({ host: local.host, port: local.port, pid: Number.isFinite(pid) ? pid : undefined });
  }

  return uniqPorts(ports);
}

function parseLinuxSs(output: string): ListeningPort[] {
  const lines = String(output || "").split(/\r?\n/);
  const ports: ListeningPort[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!/^LISTEN\s+/i.test(line)) continue;
    const parts = line.split(/\s+/);
    const local = parts[3] || "";
    const pidMatch = line.match(/pid=(\d+)/);
    const pid = pidMatch ? Number.parseInt(pidMatch[1], 10) : undefined;

    const hp = (() => {
      const s = String(local || "");
      if (s.startsWith("[")) {
        const idx = s.lastIndexOf("]:");
        if (idx === -1) return null;
        const host = s.slice(1, idx);
        const port = Number.parseInt(s.slice(idx + 2), 10);
        if (!Number.isFinite(port)) return null;
        return { host: host || "0.0.0.0", port };
      }
      const last = s.lastIndexOf(":");
      if (last === -1) return null;
      const host = s.slice(0, last) || "0.0.0.0";
      const port = Number.parseInt(s.slice(last + 1), 10);
      if (!Number.isFinite(port)) return null;
      return { host, port };
    })();

    if (!hp) continue;
    ports.push({ host: hp.host, port: hp.port, pid: Number.isFinite(pid as any) ? pid : undefined });
  }

  return uniqPorts(ports);
}

function parseLsof(output: string): ListeningPort[] {
  const lines = String(output || "").split(/\r?\n/);
  const ports: ListeningPort[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("COMMAND")) continue;
    // Example: node 1234 user 22u IPv6 ... TCP *:5173 (LISTEN)
    const m = line.match(/\s+(\d+)\s+.*\sTCP\s+(.+?):(\d+)\s+\(LISTEN\)/i);
    if (!m) continue;
    const pid = Number.parseInt(m[1], 10);
    const host = String(m[2] || "*").trim();
    const port = Number.parseInt(m[3], 10);
    if (!Number.isFinite(port)) continue;
    const normalizedHost = host === "*" ? "0.0.0.0" : host;
    ports.push({ host: normalizedHost, port, pid: Number.isFinite(pid) ? pid : undefined });
  }
  return uniqPorts(ports);
}

export async function listListeningPorts(): Promise<ListeningPort[]> {
  if (process.platform === "win32") {
    const out = await run("netstat", ["-ano", "-p", "tcp"]);
    return parseWindowsNetstat(out);
  }

  try {
    const out = await run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"]);
    const ports = parseLsof(out);
    if (ports.length) return ports;
  } catch {
    // ignore
  }

  try {
    const out = await run("ss", ["-ltnp"]);
    return parseLinuxSs(out);
  } catch {
    return [];
  }
}


import express from "express";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { workspaceContext, getWorkspaceRoot } from "./context";
import * as db from "./db";
import { getProjectStructure, resolveWorkspaceFilePath, SearchInFilesTool } from "./tools/filesystem";
import { takeSnapshot, persistDiffSafely } from "./diffs";
import { workspaceManager } from "./workspace/manager";
import { createWorkspaceRpcEnvelope } from "./workspace/rpc";
import { AiEngine, registerAiEngineRoutes } from "./ai-engine";
import { registerTerminalWs } from "./terminal/ws";
import { listListeningPorts } from "./ports/listening";

const app = express();
app.use(cors());
app.use(express.json());

const aiEngine = new AiEngine();

app.use(async (req, res, next) => {
  const body = req.body && typeof req.body === "object" ? req.body : null;
  const headerId = req.headers["x-workspace-id"];
  const headerRoot = req.headers["x-workspace-root"] || req.headers["x-project-root"];
  const bodyWorkspaceId = body && typeof (body as any).workspaceId === "string" ? String((body as any).workspaceId) : "";
  const bodyWorkspaceRoot = body && typeof (body as any).workspaceRoot === "string" ? String((body as any).workspaceRoot) : "";

  const rootHintRaw = (typeof headerRoot === "string" ? headerRoot : "") || bodyWorkspaceRoot;
  const idHintRaw = (typeof headerId === "string" ? headerId : "") || bodyWorkspaceId;
  const rootHint = String(rootHintRaw || "").trim();
  const idHint = String(idHintRaw || "").trim();

  if (!rootHint && !idHint) {
    next();
    return;
  }
  try {
    const existingById = idHint ? workspaceManager.getWorkspace(idHint) : undefined;
    const openRoot = rootHint || (path.isAbsolute(idHint) ? idHint : "");
    if (!existingById && !openRoot) {
      res.status(400).json({ detail: "Workspace root is required" });
      return;
    }
    const handle = existingById
      ? existingById
      : await workspaceManager.openWorkspace(openRoot);
    const firstFolder = handle.descriptor.folders[0];
    const rootPath = firstFolder ? firstFolder.path : (rootHint || idHint);
    const llmConfig = body && typeof (body as any).llmConfig === "object"
      ? (body as any).llmConfig
      : (body && typeof (body as any).settings?.llmConfig === "object" ? (body as any).settings.llmConfig : undefined);
    aiEngine.ensureWorkspaceIndex(rootPath, llmConfig);
    workspaceContext.run({ id: handle.descriptor.id, root: rootPath }, () => next());
  } catch (e) {
    res.status(400).json({ detail: (e as any)?.message || "Failed to open workspace" });
  }
});

registerAiEngineRoutes(app, aiEngine);

app.post("/health", async (req, res) => {
    console.log("[Health] Checking health...");
    // Check config
  let isHealthy = false;
  let message = "Agent not configured";
  try {
    await db.initDb();
    const config = (req.body && req.body.provider) ? req.body : await db.loadLlmConfig();
    if (config) {
      isHealthy = await aiEngine.checkHealth(config);
      message = isHealthy ? "Connected" : "Health check failed";
    }
  } catch (e: any) {
    message = e.message;
  }
  res.json({ status: isHealthy ? "ok" : "error", connected: isHealthy, message });
});

app.post("/config", async (req, res) => {
  try {
    const config = req.body;
    await db.saveLlmConfig(config);
    res.json({ status: "configured", provider: config.provider, config });
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

app.get("/ports/listening", async (_req, res) => {
  try {
    const ports = await listListeningPorts();
    res.json({ ports });
  } catch (e: any) {
    res.status(500).json({ detail: e?.message || String(e) });
  }
});

app.get("/sessions", async (req, res) => {
  try {
    const sessions = await db.getSessions();
    res.json(sessions);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

app.post("/sessions", async (req, res) => {
  try {
    const { title, mode } = req.body;
    const session = await db.createSession(title, mode);
    res.json(session);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

app.patch("/sessions/:id", async (req, res) => {
  try {
    const { title, mode } = req.body;
    const updated = await db.updateSessionMeta(req.params.id, { title, mode });
    if (!updated) {
      res.status(404).json({ detail: "Session not found" });
      return;
    }
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

app.get("/sessions/:id", async (req, res) => {
  try {
    const session = await db.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ detail: "Session not found" });
      return;
    }
    res.json(session);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

app.get("/sessions/:id/messages", async (req, res) => {
  try {
    const messages = await db.getMessages(req.params.id);
    res.json(messages);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

app.get("/sessions/:id/logs", async (req, res) => {
  try {
    const logs = await db.getLogs(req.params.id);
    res.json(logs);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

app.get("/diffs", async (req, res) => {
  try {
    const { session_id, path: queryPath, limit } = req.query;
    const diffs = await db.getDiffs({
      session_id: typeof session_id === "string" ? session_id : undefined,
      path: typeof queryPath === "string" ? queryPath : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    res.json(diffs);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

app.get("/sessions/:id/diffs", async (req, res) => {
  try {
    const { path: queryPath, limit } = req.query;
    const diffs = await db.getDiffs({
      session_id: req.params.id,
      path: typeof queryPath === "string" ? queryPath : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    res.json(diffs);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

app.get("/diffs/:diffId", async (req, res) => {
  try {
    const diff = await db.getDiffById(Number(req.params.diffId));
    if (!diff) {
      res.status(404).json({ detail: "Diff not found" });
      return;
    }
    res.json(diff);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

app.post("/sessions/:id/chat", async (req, res) => {
  const sessionId = req.params.id;
  const { message, mode, attachments, tool_overrides } = req.body;
  const enabledTools = Array.isArray(tool_overrides)
    ? (tool_overrides as any[]).filter(t => typeof t === "string" && t.trim().length > 0)
    : [];
  const root = typeof req.headers["x-workspace-root"] === "string" ? (req.headers["x-workspace-root"] as string) : "";
  workspaceContext.run({ id: root || sessionId, root }, async () => {
    try {
      const session = await db.getSession(sessionId);
      const resolvedMode = mode || session?.mode;
      if (session) {
        if (resolvedMode && resolvedMode !== session.mode) {
          await db.updateSessionMeta(sessionId, { mode: resolvedMode });
        }
      }
      res.setHeader("Content-Type", "text/plain");
      try {
        const llmConfig = (req.body && typeof req.body === "object" && (req.body as any).llm_config && typeof (req.body as any).llm_config === "object")
          ? (req.body as any).llm_config
          : undefined;
        for await (const chunk of aiEngine.chatStream({
          capability: "chat",
          sessionId,
          message,
          mode: resolvedMode || "chat",
          attachments,
          toolOverrides: enabledTools,
          llmConfig
        } as any)) {
          res.write(chunk);
        }
      } catch (streamError: any) {
        res.write(`\nError: ${streamError.message}`);
      }
      res.end();
    } catch (e: any) {
      if (!res.headersSent) {
        res.status(500).json({ detail: e.message });
      } else {
        res.end();
      }
    }
  });
});

app.get("/workspaces", async (req, res) => {
  try {
    const list = workspaceManager.listWorkspaces();
    res.json(list);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

app.post("/workspaces/close", async (req, res) => {
  try {
    const id = req.body?.id || req.body?.workspaceId || (req.headers["x-workspace-id"] as string);
    if (!id) {
      res.status(400).json({ detail: "Workspace id is required" });
      return;
    }
    const handle = workspaceManager.getWorkspace(String(id));
    await workspaceManager.closeWorkspace(String(id));
    const root = handle?.descriptor?.folders?.[0]?.path;
    if (root) {
      await aiEngine.disposeWorkspaceIndex(root);
    }
    res.json({ id: String(id), status: "closed" });
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

app.post("/workspace/bind-root", async (req, res) => {
  try {
    const { root, settings } = req.body;
    if (!root) {
      res.status(400).json({ detail: "Root path is required" });
      return;
    }
    const handle = await workspaceManager.openWorkspace(root, { settings: settings && typeof settings === "object" ? settings : {} });
    const firstFolder = handle.descriptor.folders[0];
    const appliedRoot = firstFolder ? firstFolder.path : root;
    const dataDir = path.join(appliedRoot, ".aichat");
    const rpc = createWorkspaceRpcEnvelope(handle.descriptor.id, {
      root: appliedRoot,
      data_dir: dataDir,
    });
    res.json({
      root: appliedRoot,
      status: "ok",
      data_dir: dataDir,
      workspace_id: handle.descriptor.id,
      workspace: handle.descriptor,
      rpc,
    });
  } catch (e: any) {
    res.status(400).json({ detail: e.message });
  }
});

app.get("/workspace/structure", async (req, res) => {
  try {
    const root = getWorkspaceRoot();
    const structure = await getProjectStructure(root);
    res.json(structure);
  } catch (e: any) {
    res.status(400).json({ detail: e.message });
  }
});

app.post("/workspace/search", async (req, res) => {
  try {
    const root = getWorkspaceRoot();
    const { query, case_sensitive, regex } = req.body;
    if (!query) {
      res.status(400).json({ detail: "Query is required" });
      return;
    }
    const tool = new SearchInFilesTool();
    const result = await tool.execute({
        query,
        path: '.', 
        case_sensitive: !!case_sensitive,
        regex: !!regex,
        max_results: 500
    });
    
    if (result.status === 'error') {
        throw new Error(result.message);
    }
    
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ detail: e.message });
  }
});

app.post("/workspace/notify-changed", async (req, res) => {
  try {
    const root = getWorkspaceRoot();
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const paths = Array.isArray((body as any).paths) ? (body as any).paths : null;
    const single = typeof (body as any).path === "string" ? (body as any).path : "";
    const list = paths ? paths.filter((p: any) => typeof p === "string" && p.trim().length > 0) : (single ? [single] : []);
    if (list.length === 0) {
      res.status(400).json({ detail: "path or paths is required" });
      return;
    }
    for (const p of list) {
      aiEngine.notifyWorkspaceFileChanged(root, String(p));
    }
    res.json({ status: "ok", count: list.length });
  } catch (e: any) {
    res.status(400).json({ detail: e.message });
  }
});

app.get("/workspace/read", async (req, res) => {
  try {
    const root = getWorkspaceRoot();
    const relativePath = req.query.path as string;
    const allowMissingRaw = String((req.query as any)?.allow_missing ?? (req.query as any)?.allowMissing ?? '').trim().toLowerCase();
    const allowMissing = allowMissingRaw === '1' || allowMissingRaw === 'true' || allowMissingRaw === 'yes';
    if (!relativePath) {
      res.status(400).json({ detail: "Path is required" });
      return;
    }
    const { fullPath } = await resolveWorkspaceFilePath(root, relativePath, { mustExist: !allowMissing });
    try {
      const content = await fs.readFile(fullPath, "utf-8");
      res.json({ path: relativePath, content, truncated: false, exists: true });
    } catch (readErr: any) {
      if (allowMissing && (readErr?.code === 'ENOENT' || readErr?.code === 'ENOTDIR')) {
        res.json({ path: relativePath, content: "", truncated: false, exists: false });
        return;
      }
      throw readErr;
    }
  } catch (e: any) {
    res.status(400).json({ detail: e.message });
  }
});

app.post("/workspace/write", async (req, res) => {
  try {
    const root = getWorkspaceRoot();
    const { path: relativePath, content, create_directories } = req.body;
    if (!relativePath) {
      res.status(400).json({ detail: "Path is required" });
      return;
    }
    const { fullPath } = await resolveWorkspaceFilePath(root, relativePath, { mustExist: false, preferExistingParent: true });
    const beforeSnapshot = await takeSnapshot(relativePath);
    if (create_directories) {
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
    }
    await fs.writeFile(fullPath, content || "", "utf-8");
    aiEngine.notifyWorkspaceFileChanged(root, String(relativePath || ""));
    const afterSnapshot = await takeSnapshot(relativePath);
    try {
      await persistDiffSafely({
        sessionId: typeof req.body.session_id === "string" ? req.body.session_id : "",
        path: relativePath,
        before: beforeSnapshot,
        after: afterSnapshot,
      });
    } catch (e) {
    }
    res.json({ path: relativePath, bytes: (content || "").length });
  } catch (e: any) {
    res.status(400).json({ detail: e.message });
  }
});

app.post("/workspace/mkdir", async (req, res) => {
  try {
    const root = getWorkspaceRoot();
    const rel = req.body?.path;
    if (!rel) {
      res.status(400).json({ detail: "Path is required" });
      return;
    }
    const { fullPath } = await resolveWorkspaceFilePath(root, rel, { mustExist: false, preferExistingParent: true });
    await fs.mkdir(fullPath, { recursive: req.body?.recursive !== false });
    res.json({ status: "ok", path: rel });
  } catch (e: any) {
    res.status(400).json({ detail: e.message });
  }
});

app.post("/workspace/delete", async (req, res) => {
  try {
    const root = getWorkspaceRoot();
    const rel = req.body?.path;
    if (!rel) {
      res.status(400).json({ detail: "Path is required" });
      return;
    }
    const { fullPath } = await resolveWorkspaceFilePath(root, rel, { mustExist: false, preferExistingParent: true });
    let stats: any = null;
    try {
      stats = await fs.stat(fullPath);
    } catch {
      res.json({ status: "ok", path: rel, existed: false });
      return;
    }
    if (stats.isDirectory()) {
      await fs.rm(fullPath, { recursive: req.body?.recursive !== false, force: true });
    } else {
      await fs.unlink(fullPath);
    }
    aiEngine.notifyWorkspaceFileChanged(root, String(rel || ""));
    res.json({ status: "ok", path: rel, existed: true });
  } catch (e: any) {
    res.status(400).json({ detail: e.message });
  }
});

app.post("/workspace/rename", async (req, res) => {
  try {
    const root = getWorkspaceRoot();
    const from = req.body?.from;
    const to = req.body?.to;
    if (!from || !to) {
      res.status(400).json({ detail: "From/To are required" });
      return;
    }
    const { fullPath: fromPath, rootPath } = await resolveWorkspaceFilePath(root, from, { mustExist: true });
    const toPath = path.resolve(rootPath, String(to || ""));
    const rootLower = rootPath.toLowerCase();
    const toLower = toPath.toLowerCase();
    const prefix = rootLower.endsWith(path.sep) ? rootLower : `${rootLower}${path.sep}`;
    if (!(toLower === rootLower || toLower.startsWith(prefix))) {
      throw new Error("Access denied");
    }
    await fs.mkdir(path.dirname(toPath), { recursive: true });
    await fs.rename(fromPath, toPath);
    aiEngine.notifyWorkspaceFileChanged(root, String(from || ""));
    aiEngine.notifyWorkspaceFileChanged(root, String(to || ""));
    res.json({ status: "ok", from, to });
  } catch (e: any) {
    res.status(400).json({ detail: e.message });
  }
});

app.get("/terminal/state", async (_req, res) => {
  try {
    const root = getWorkspaceRoot();
    const statePath = path.join(root, ".ai-agent", "terminal-state.json");
    const raw = await fs.readFile(statePath, "utf8").catch(() => "");
    if (!raw) {
      res.json({});
      return;
    }
    const parsed = JSON.parse(raw);
    res.json(parsed && typeof parsed === "object" ? parsed : {});
  } catch (e: any) {
    res.status(400).json({ detail: e?.message || "Failed to load terminal state" });
  }
});

app.put("/terminal/state", async (req, res) => {
  try {
    const root = getWorkspaceRoot();
    const dir = path.join(root, ".ai-agent");
    const statePath = path.join(dir, "terminal-state.json");
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const raw = JSON.stringify(body);
    if (raw.length > 200_000) {
      res.status(413).json({ detail: "Terminal state payload too large" });
      return;
    }
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(statePath, raw, "utf8");
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ detail: e?.message || "Failed to save terminal state" });
  }
});

function parsePort(value: unknown, fallback: number) {
  const n = typeof value === 'string' ? Number.parseInt(value, 10) : (typeof value === 'number' ? value : NaN);
  if (!Number.isFinite(n)) return fallback;
  const p = Math.floor(n);
  if (p < 1 || p > 65535) return fallback;
  return p;
}

async function isExistingBackend(port: number): Promise<boolean> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 600);
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/ai-engine/metrics`, { method: 'GET', signal: controller.signal });
    if (!resp.ok) return false;
    const data: any = await resp.json().catch(() => null);
    if (!data || typeof data !== 'object') return false;
    return typeof data.counters === 'object' && typeof data.p95LatencyMsByCapability === 'object';
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

const PORT = parsePort(process.env.AI_AGENT_BACKEND_PORT || process.env.PORT, 8000);
const server = app.listen(PORT);
registerTerminalWs(server);

server.once('listening', () => {
  console.log(`Node.js Agent Backend running on http://localhost:${PORT}`);
  aiEngine.init().catch((e) => {
    console.error(`[AIEngine] init failed: ${(e as any)?.message || e}`);
  });
});

server.on('error', (err: any) => {
  if (err && err.code === 'EADDRINUSE') {
    void (async () => {
      const ok = await isExistingBackend(PORT);
      if (ok) {
        console.log(`Node.js Agent Backend already running on http://localhost:${PORT}`);
        setInterval(() => {}, 60_000);
        return;
      }
      console.error(`Error: listen EADDRINUSE: address already in use :::${PORT}`);
      process.exit(1);
    })();
    return;
  }
  console.error(err);
  process.exit(1);
});

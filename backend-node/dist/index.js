"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const context_1 = require("./context");
const db = __importStar(require("./db"));
const filesystem_1 = require("./tools/filesystem");
const diffs_1 = require("./diffs");
const manager_1 = require("./workspace/manager");
const rpc_1 = require("./workspace/rpc");
const ai_engine_1 = require("./ai-engine");
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const aiEngine = new ai_engine_1.AiEngine();
(0, ai_engine_1.registerAiEngineRoutes)(app, aiEngine);
app.use(async (req, res, next) => {
    const headerId = req.headers["x-workspace-id"];
    const headerRoot = req.headers["x-workspace-root"] || req.headers["x-project-root"];
    const hint = (typeof headerId === "string" && headerId) ? headerId : (typeof headerRoot === "string" ? headerRoot : "");
    if (!hint) {
        next();
        return;
    }
    try {
        const handle = await manager_1.workspaceManager.openWorkspace(hint);
        const firstFolder = handle.descriptor.folders[0];
        const rootPath = firstFolder ? firstFolder.path : hint;
        aiEngine.ensureWorkspaceIndex(rootPath);
        context_1.workspaceContext.run({ id: handle.descriptor.id, root: rootPath }, () => next());
    }
    catch (e) {
        res.status(400).json({ detail: e?.message || "Failed to open workspace" });
    }
});
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
    }
    catch (e) {
        message = e.message;
    }
    res.json({ status: isHealthy ? "ok" : "error", connected: isHealthy, message });
});
app.post("/config", async (req, res) => {
    try {
        const config = req.body;
        await db.saveLlmConfig(config);
        res.json({ status: "configured", provider: config.provider, config });
    }
    catch (e) {
        res.status(500).json({ detail: e.message });
    }
});
app.get("/sessions", async (req, res) => {
    try {
        const sessions = await db.getSessions();
        res.json(sessions);
    }
    catch (e) {
        res.status(500).json({ detail: e.message });
    }
});
app.post("/sessions", async (req, res) => {
    try {
        const { title, mode } = req.body;
        const session = await db.createSession(title, mode);
        res.json(session);
    }
    catch (e) {
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
    }
    catch (e) {
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
    }
    catch (e) {
        res.status(500).json({ detail: e.message });
    }
});
app.get("/sessions/:id/messages", async (req, res) => {
    try {
        const messages = await db.getMessages(req.params.id);
        res.json(messages);
    }
    catch (e) {
        res.status(500).json({ detail: e.message });
    }
});
app.get("/sessions/:id/logs", async (req, res) => {
    try {
        const logs = await db.getLogs(req.params.id);
        res.json(logs);
    }
    catch (e) {
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
    }
    catch (e) {
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
    }
    catch (e) {
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
    }
    catch (e) {
        res.status(500).json({ detail: e.message });
    }
});
app.post("/sessions/:id/chat", async (req, res) => {
    const sessionId = req.params.id;
    const { message, mode, attachments, tool_overrides } = req.body;
    const enabledTools = Array.isArray(tool_overrides)
        ? tool_overrides.filter(t => typeof t === "string" && t.trim().length > 0)
        : [];
    const root = typeof req.headers["x-workspace-root"] === "string" ? req.headers["x-workspace-root"] : "";
    context_1.workspaceContext.run({ id: root || sessionId, root }, async () => {
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
                const llmConfig = (req.body && typeof req.body === "object" && req.body.llm_config && typeof req.body.llm_config === "object")
                    ? req.body.llm_config
                    : undefined;
                for await (const chunk of aiEngine.chatStream({
                    capability: "chat",
                    sessionId,
                    message,
                    mode: resolvedMode || "chat",
                    attachments,
                    toolOverrides: enabledTools,
                    llmConfig
                })) {
                    res.write(chunk);
                }
            }
            catch (streamError) {
                res.write(`\nError: ${streamError.message}`);
            }
            res.end();
        }
        catch (e) {
            if (!res.headersSent) {
                res.status(500).json({ detail: e.message });
            }
            else {
                res.end();
            }
        }
    });
});
app.get("/workspaces", async (req, res) => {
    try {
        const list = manager_1.workspaceManager.listWorkspaces();
        res.json(list);
    }
    catch (e) {
        res.status(500).json({ detail: e.message });
    }
});
app.post("/workspaces/close", async (req, res) => {
    try {
        const id = req.body?.id || req.body?.workspaceId || req.headers["x-workspace-id"];
        if (!id) {
            res.status(400).json({ detail: "Workspace id is required" });
            return;
        }
        const handle = manager_1.workspaceManager.getWorkspace(String(id));
        await manager_1.workspaceManager.closeWorkspace(String(id));
        const root = handle?.descriptor?.folders?.[0]?.path;
        if (root) {
            await aiEngine.disposeWorkspaceIndex(root);
        }
        res.json({ id: String(id), status: "closed" });
    }
    catch (e) {
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
        const handle = await manager_1.workspaceManager.openWorkspace(root, { settings: settings && typeof settings === "object" ? settings : {} });
        const firstFolder = handle.descriptor.folders[0];
        const appliedRoot = firstFolder ? firstFolder.path : root;
        aiEngine.ensureWorkspaceIndex(appliedRoot);
        const dataDir = path_1.default.join(appliedRoot, ".aichat");
        const rpc = (0, rpc_1.createWorkspaceRpcEnvelope)(handle.descriptor.id, {
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
    }
    catch (e) {
        res.status(400).json({ detail: e.message });
    }
});
app.get("/workspace/structure", async (req, res) => {
    try {
        const root = (0, context_1.getWorkspaceRoot)();
        const structure = await (0, filesystem_1.getProjectStructure)(root);
        res.json(structure);
    }
    catch (e) {
        res.status(400).json({ detail: e.message });
    }
});
app.post("/workspace/search", async (req, res) => {
    try {
        const root = (0, context_1.getWorkspaceRoot)();
        const { query, case_sensitive, regex } = req.body;
        if (!query) {
            res.status(400).json({ detail: "Query is required" });
            return;
        }
        const tool = new filesystem_1.SearchInFilesTool();
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
    }
    catch (e) {
        res.status(400).json({ detail: e.message });
    }
});
app.post("/workspace/notify-changed", async (req, res) => {
    try {
        const root = (0, context_1.getWorkspaceRoot)();
        const body = req.body && typeof req.body === "object" ? req.body : {};
        const paths = Array.isArray(body.paths) ? body.paths : null;
        const single = typeof body.path === "string" ? body.path : "";
        const list = paths ? paths.filter((p) => typeof p === "string" && p.trim().length > 0) : (single ? [single] : []);
        if (list.length === 0) {
            res.status(400).json({ detail: "path or paths is required" });
            return;
        }
        for (const p of list) {
            aiEngine.notifyWorkspaceFileChanged(root, String(p));
        }
        res.json({ status: "ok", count: list.length });
    }
    catch (e) {
        res.status(400).json({ detail: e.message });
    }
});
app.get("/workspace/read", async (req, res) => {
    try {
        const root = (0, context_1.getWorkspaceRoot)();
        const relativePath = req.query.path;
        if (!relativePath) {
            res.status(400).json({ detail: "Path is required" });
            return;
        }
        const { fullPath } = await (0, filesystem_1.resolveWorkspaceFilePath)(root, relativePath, { mustExist: true });
        const content = await promises_1.default.readFile(fullPath, "utf-8");
        res.json({ path: relativePath, content, truncated: false });
    }
    catch (e) {
        res.status(400).json({ detail: e.message });
    }
});
app.post("/workspace/write", async (req, res) => {
    try {
        const root = (0, context_1.getWorkspaceRoot)();
        const { path: relativePath, content, create_directories } = req.body;
        if (!relativePath) {
            res.status(400).json({ detail: "Path is required" });
            return;
        }
        const { fullPath } = await (0, filesystem_1.resolveWorkspaceFilePath)(root, relativePath, { mustExist: false, preferExistingParent: true });
        const beforeSnapshot = await (0, diffs_1.takeSnapshot)(relativePath);
        if (create_directories) {
            await promises_1.default.mkdir(path_1.default.dirname(fullPath), { recursive: true });
        }
        await promises_1.default.writeFile(fullPath, content || "", "utf-8");
        aiEngine.notifyWorkspaceFileChanged(root, String(relativePath || ""));
        const afterSnapshot = await (0, diffs_1.takeSnapshot)(relativePath);
        try {
            await (0, diffs_1.persistDiffSafely)({
                sessionId: typeof req.body.session_id === "string" ? req.body.session_id : "",
                path: relativePath,
                before: beforeSnapshot,
                after: afterSnapshot,
            });
        }
        catch (e) {
        }
        res.json({ path: relativePath, bytes: (content || "").length });
    }
    catch (e) {
        res.status(400).json({ detail: e.message });
    }
});
app.post("/workspace/mkdir", async (req, res) => {
    try {
        const root = (0, context_1.getWorkspaceRoot)();
        const rel = req.body?.path;
        if (!rel) {
            res.status(400).json({ detail: "Path is required" });
            return;
        }
        const { fullPath } = await (0, filesystem_1.resolveWorkspaceFilePath)(root, rel, { mustExist: false, preferExistingParent: true });
        await promises_1.default.mkdir(fullPath, { recursive: req.body?.recursive !== false });
        res.json({ status: "ok", path: rel });
    }
    catch (e) {
        res.status(400).json({ detail: e.message });
    }
});
app.post("/workspace/delete", async (req, res) => {
    try {
        const root = (0, context_1.getWorkspaceRoot)();
        const rel = req.body?.path;
        if (!rel) {
            res.status(400).json({ detail: "Path is required" });
            return;
        }
        const { fullPath } = await (0, filesystem_1.resolveWorkspaceFilePath)(root, rel, { mustExist: false, preferExistingParent: true });
        let stats = null;
        try {
            stats = await promises_1.default.stat(fullPath);
        }
        catch {
            res.json({ status: "ok", path: rel, existed: false });
            return;
        }
        if (stats.isDirectory()) {
            await promises_1.default.rm(fullPath, { recursive: req.body?.recursive !== false, force: true });
        }
        else {
            await promises_1.default.unlink(fullPath);
        }
        aiEngine.notifyWorkspaceFileChanged(root, String(rel || ""));
        res.json({ status: "ok", path: rel, existed: true });
    }
    catch (e) {
        res.status(400).json({ detail: e.message });
    }
});
app.post("/workspace/rename", async (req, res) => {
    try {
        const root = (0, context_1.getWorkspaceRoot)();
        const from = req.body?.from;
        const to = req.body?.to;
        if (!from || !to) {
            res.status(400).json({ detail: "From/To are required" });
            return;
        }
        const { fullPath: fromPath, rootPath } = await (0, filesystem_1.resolveWorkspaceFilePath)(root, from, { mustExist: true });
        const toPath = path_1.default.resolve(rootPath, String(to || ""));
        const rootLower = rootPath.toLowerCase();
        const toLower = toPath.toLowerCase();
        const prefix = rootLower.endsWith(path_1.default.sep) ? rootLower : `${rootLower}${path_1.default.sep}`;
        if (!(toLower === rootLower || toLower.startsWith(prefix))) {
            throw new Error("Access denied");
        }
        await promises_1.default.mkdir(path_1.default.dirname(toPath), { recursive: true });
        await promises_1.default.rename(fromPath, toPath);
        aiEngine.notifyWorkspaceFileChanged(root, String(from || ""));
        aiEngine.notifyWorkspaceFileChanged(root, String(to || ""));
        res.json({ status: "ok", from, to });
    }
    catch (e) {
        res.status(400).json({ detail: e.message });
    }
});
function parsePort(value, fallback) {
    const n = typeof value === 'string' ? Number.parseInt(value, 10) : (typeof value === 'number' ? value : NaN);
    if (!Number.isFinite(n))
        return fallback;
    const p = Math.floor(n);
    if (p < 1 || p > 65535)
        return fallback;
    return p;
}
async function isExistingBackend(port) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 600);
    try {
        const resp = await fetch(`http://127.0.0.1:${port}/ai-engine/metrics`, { method: 'GET', signal: controller.signal });
        if (!resp.ok)
            return false;
        const data = await resp.json().catch(() => null);
        if (!data || typeof data !== 'object')
            return false;
        return typeof data.counters === 'object' && typeof data.p95LatencyMsByCapability === 'object';
    }
    catch {
        return false;
    }
    finally {
        clearTimeout(t);
    }
}
const PORT = parsePort(process.env.AI_AGENT_BACKEND_PORT || process.env.PORT, 8000);
const server = app.listen(PORT);
server.once('listening', () => {
    console.log(`Node.js Agent Backend running on http://localhost:${PORT}`);
    aiEngine.init().catch((e) => {
        console.error(`[AIEngine] init failed: ${e?.message || e}`);
    });
});
server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
        void (async () => {
            const ok = await isExistingBackend(PORT);
            if (ok) {
                console.log(`Node.js Agent Backend already running on http://localhost:${PORT}`);
                setInterval(() => { }, 60_000);
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

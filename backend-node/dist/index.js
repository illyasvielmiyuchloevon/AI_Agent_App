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
const agent_1 = require("./agent");
const llm_1 = require("./core/llm");
const filesystem_1 = require("./tools/filesystem");
const diffs_1 = require("./diffs");
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Middleware to bind workspace root
app.use((req, res, next) => {
    const root = req.headers['x-workspace-root'] || req.headers['x-project-root'];
    console.log(`[Middleware] Request: ${req.method} ${req.url}`);
    if (root) {
        console.log(`[Middleware] Binding workspace root: ${root}`);
    }
    else {
        console.log(`[Middleware] No workspace root header found.`);
    }
    if (root && typeof root === 'string') {
        context_1.workspaceContext.run({ root }, () => next());
    }
    else {
        // If no root provided, we can still run but DB ops might fail if they require it.
        // For /health or global routes it might be fine.
        next();
    }
});
// Global LLM Client (simplified)
let globalLlmClient = null;
let globalLlmConfig = null;
async function initLlm() {
    // Try to load from DB (requires workspace context, which we might not have globally yet)
    // In actual usage, we load per request or lazily.
}
function buildLlmClient(config) {
    if (config.provider === 'openai') {
        return new llm_1.OpenAIProvider(config.api_key, config.model, config.base_url);
    }
    else if (config.provider === 'anthropic') {
        return new llm_1.AnthropicProvider(config.api_key, config.model, config.base_url);
    }
    throw new Error("Invalid provider");
}
// Routes
app.post('/health', async (req, res) => {
    console.log("[Health] Checking health...");
    // Check config
    let isHealthy = false;
    let message = "Agent not configured";
    // In this simple PoC, we check if we have a bound root and config
    const root = req.headers['x-workspace-root'];
    if (root) {
        try {
            await db.initDb();
            // Prefer config from body if provided (for validation), otherwise load from DB
            if (req.body && req.body.provider) {
                console.log(`[Health] Using config from body:`, JSON.stringify(req.body, null, 2));
            }
            const config = (req.body && req.body.provider) ? req.body : await db.loadLlmConfig();
            if (config) {
                console.log(`[Health] Found config for provider: ${config.provider}`);
                console.log(`[Health] Config details:`, JSON.stringify({ ...config, api_key: '***' }, null, 2));
                const client = buildLlmClient(config);
                isHealthy = await client.checkHealth();
                message = isHealthy ? "Connected" : "Health check failed";
                console.log(`[Health] Check result: ${isHealthy}, Message: ${message}`);
            }
            else {
                console.log("[Health] No config found in DB or body.");
            }
        }
        catch (e) {
            console.error(`[Health] Error: ${e.message}`);
            message = e.message;
        }
    }
    else {
        console.log("[Health] No workspace root, cannot check DB config.");
    }
    res.json({ status: isHealthy ? "ok" : "error", connected: isHealthy, message });
});
app.post('/config', async (req, res) => {
    console.log("[Config] Received new config.");
    try {
        const config = req.body;
        console.log(`[Config] Payload:`, JSON.stringify({ ...config, api_key: '***' }, null, 2));
        // Verify we can build it
        const client = buildLlmClient(config);
        // Save it
        await db.saveLlmConfig(config);
        console.log("[Config] Config saved successfully.");
        res.json({ status: "configured", provider: config.provider, config });
    }
    catch (e) {
        console.error(`[Config] Error saving config: ${e.message}`);
        res.status(500).json({ detail: e.message });
    }
});
app.get('/sessions', async (req, res) => {
    try {
        const sessions = await db.getSessions();
        res.json(sessions);
    }
    catch (e) {
        res.status(500).json({ detail: e.message });
    }
});
app.post('/sessions', async (req, res) => {
    try {
        const { title, mode } = req.body;
        const session = await db.createSession(title, mode);
        res.json(session);
    }
    catch (e) {
        res.status(500).json({ detail: e.message });
    }
});
app.patch('/sessions/:id', async (req, res) => {
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
app.get('/sessions/:id', async (req, res) => {
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
app.get('/sessions/:id/messages', async (req, res) => {
    try {
        const messages = await db.getMessages(req.params.id);
        res.json(messages);
    }
    catch (e) {
        res.status(500).json({ detail: e.message });
    }
});
app.get('/sessions/:id/logs', async (req, res) => {
    try {
        const logs = await db.getLogs(req.params.id);
        res.json(logs);
    }
    catch (e) {
        res.status(500).json({ detail: e.message });
    }
});
// Diff snapshots
app.get('/diffs', async (req, res) => {
    try {
        const { session_id, path: queryPath, limit } = req.query;
        const diffs = await db.getDiffs({
            session_id: typeof session_id === 'string' ? session_id : undefined,
            path: typeof queryPath === 'string' ? queryPath : undefined,
            limit: limit ? Number(limit) : undefined
        });
        res.json(diffs);
    }
    catch (e) {
        res.status(500).json({ detail: e.message });
    }
});
app.get('/sessions/:id/diffs', async (req, res) => {
    try {
        const { path: queryPath, limit } = req.query;
        const diffs = await db.getDiffs({
            session_id: req.params.id,
            path: typeof queryPath === 'string' ? queryPath : undefined,
            limit: limit ? Number(limit) : undefined
        });
        res.json(diffs);
    }
    catch (e) {
        res.status(500).json({ detail: e.message });
    }
});
app.get('/diffs/:diffId', async (req, res) => {
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
app.post('/sessions/:id/chat', async (req, res) => {
    const sessionId = req.params.id;
    const { message, mode, attachments, tool_overrides } = req.body;
    const enabledTools = Array.isArray(tool_overrides)
        ? tool_overrides.filter(t => typeof t === 'string' && t.trim().length > 0)
        : [];
    // We need to access the workspace root inside the async generator
    // contextvars should propagate if we are in the same async chain
    const root = req.headers['x-workspace-root'];
    // Re-wrap in context just to be safe for the async operation if context is lost
    context_1.workspaceContext.run({ root }, async () => {
        try {
            const config = await db.loadLlmConfig();
            if (!config) {
                res.status(400).json({ detail: "Agent not configured" });
                return;
            }
            const llm = buildLlmClient(config);
            const contextMaxLength = config.context_max_length || 128000;
            const agent = new agent_1.Agent(llm, sessionId, contextMaxLength);
            // Set mode
            const session = await db.getSession(sessionId);
            const resolvedMode = mode || session?.mode;
            if (session) {
                agent.setMode(resolvedMode || session.mode, enabledTools);
                if (resolvedMode && resolvedMode !== session.mode) {
                    await db.updateSessionMeta(sessionId, { mode: resolvedMode });
                }
            }
            else {
                agent.setMode(resolvedMode || 'chat', enabledTools);
            }
            const activeTools = agent.getActiveTools();
            const chatOptions = {
                max_tokens: config.output_max_tokens, // OpenAI/Anthropic use max_tokens for output limit
                temperature: config.temperature
            };
            // When tools are available, ask the model to pick and allow parallel tool calls (OpenAI supports it; Anthropic ignores safely)
            if (activeTools.length > 0) {
                chatOptions.tool_choice = 'auto';
                chatOptions.parallel_tool_calls = true;
            }
            console.log(`[Chat] session=${sessionId} mode=${resolvedMode || 'chat'} tools=${activeTools.map(t => t.name).join(', ') || 'none'}`);
            // Stream response
            res.setHeader('Content-Type', 'text/plain');
            try {
                for await (const chunk of agent.chat(message, attachments, chatOptions)) {
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
// --- Workspace Endpoints ---
app.post('/workspace/bind-root', async (req, res) => {
    console.log(`[Workspace] Binding root: ${req.body.root}`);
    try {
        const { root } = req.body;
        if (!root)
            throw new Error("Root path is required");
        // Validate existence
        const stats = await promises_1.default.stat(root);
        if (!stats.isDirectory())
            throw new Error("Path is not a directory");
        // Run inside context to init DB
        await context_1.workspaceContext.run({ root }, async () => {
            await db.initDb();
        });
        console.log(`[Workspace] Root bound successfully: ${root}`);
        res.json({
            root,
            status: "ok",
            data_dir: path_1.default.join(root, ".aichat")
        });
    }
    catch (e) {
        console.error(`[Workspace] Bind error: ${e.message}`);
        res.status(400).json({ detail: e.message });
    }
});
app.get('/workspace/structure', async (req, res) => {
    try {
        // use middleware bound root
        const root = (0, context_1.getWorkspaceRoot)();
        const structure = await (0, filesystem_1.getProjectStructure)(root);
        res.json(structure);
    }
    catch (e) {
        res.status(400).json({ detail: e.message });
    }
});
app.get('/workspace/read', async (req, res) => {
    try {
        const root = (0, context_1.getWorkspaceRoot)();
        const relativePath = req.query.path;
        if (!relativePath)
            throw new Error("Path is required");
        const fullPath = path_1.default.resolve(root, relativePath);
        if (!fullPath.startsWith(root))
            throw new Error("Access denied");
        const content = await promises_1.default.readFile(fullPath, 'utf-8');
        res.json({ path: relativePath, content, truncated: false });
    }
    catch (e) {
        res.status(400).json({ detail: e.message });
    }
});
app.post('/workspace/write', async (req, res) => {
    try {
        const root = (0, context_1.getWorkspaceRoot)();
        const { path: relativePath, content, create_directories } = req.body;
        if (!relativePath)
            throw new Error("Path is required");
        const fullPath = path_1.default.resolve(root, relativePath);
        if (!fullPath.startsWith(root))
            throw new Error("Access denied");
        const beforeSnapshot = await (0, diffs_1.takeSnapshot)(relativePath);
        if (create_directories) {
            await promises_1.default.mkdir(path_1.default.dirname(fullPath), { recursive: true });
        }
        await promises_1.default.writeFile(fullPath, content || "", 'utf-8');
        const afterSnapshot = await (0, diffs_1.takeSnapshot)(relativePath);
        try {
            await (0, diffs_1.persistDiffSafely)({
                sessionId: typeof req.body.session_id === 'string' ? req.body.session_id : '',
                path: relativePath,
                before: beforeSnapshot,
                after: afterSnapshot
            });
        }
        catch (e) {
            console.warn(`[Workspace] Failed to persist diff for ${relativePath}: ${e.message}`);
        }
        res.json({ path: relativePath, bytes: (content || "").length });
    }
    catch (e) {
        res.status(400).json({ detail: e.message });
    }
});
const PORT = 8000;
app.listen(PORT, () => {
    console.log(`Node.js Agent Backend running on http://localhost:${PORT}`);
});

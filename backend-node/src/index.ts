import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { workspaceContext, getWorkspaceRoot } from './context';
import * as db from './db';
import { Agent } from './agent';
import { OpenAIProvider, AnthropicProvider, LLMClient } from './core/llm';
import { getProjectStructure } from './tools/filesystem';

const app = express();
app.use(cors());
app.use(express.json());

// Middleware to bind workspace root
app.use((req, res, next) => {
    const root = req.headers['x-workspace-root'] || req.headers['x-project-root'];
    console.log(`[Middleware] Request: ${req.method} ${req.url}`);
    if (root) {
        console.log(`[Middleware] Binding workspace root: ${root}`);
    } else {
        console.log(`[Middleware] No workspace root header found.`);
    }

    if (root && typeof root === 'string') {
        workspaceContext.run({ root }, () => next());
    } else {
        // If no root provided, we can still run but DB ops might fail if they require it.
        // For /health or global routes it might be fine.
        next();
    }
});

// Global LLM Client (simplified)
let globalLlmClient: LLMClient | null = null;
let globalLlmConfig: any = null;

async function initLlm() {
    // Try to load from DB (requires workspace context, which we might not have globally yet)
    // In actual usage, we load per request or lazily.
}

function buildLlmClient(config: any): LLMClient {
    if (config.provider === 'openai') {
        return new OpenAIProvider(config.api_key, config.model, config.base_url);
    } else if (config.provider === 'anthropic') {
        return new AnthropicProvider(config.api_key, config.model, config.base_url);
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
            } else {
                console.log("[Health] No config found in DB or body.");
            }
        } catch (e: any) {
            console.error(`[Health] Error: ${e.message}`);
            message = e.message;
        }
    } else {
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
    } catch (e: any) {
        console.error(`[Config] Error saving config: ${e.message}`);
        res.status(500).json({ detail: e.message });
    }
});

app.get('/sessions', async (req, res) => {
    try {
        const sessions = await db.getSessions();
        res.json(sessions);
    } catch (e: any) {
        res.status(500).json({ detail: e.message });
    }
});

app.post('/sessions', async (req, res) => {
    try {
        const { title, mode } = req.body;
        const session = await db.createSession(title, mode);
        res.json(session);
    } catch (e: any) {
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
    } catch (e: any) {
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
    } catch (e: any) {
        res.status(500).json({ detail: e.message });
    }
});

app.get('/sessions/:id/messages', async (req, res) => {
    try {
        const messages = await db.getMessages(req.params.id);
        res.json(messages);
    } catch (e: any) {
        res.status(500).json({ detail: e.message });
    }
});

app.get('/sessions/:id/logs', async (req, res) => {
    try {
        const logs = await db.getLogs(req.params.id);
        res.json(logs);
    } catch (e: any) {
        res.status(500).json({ detail: e.message });
    }
});

app.post('/sessions/:id/chat', async (req, res) => {
    const sessionId = req.params.id;
    const { message, mode, attachments, tool_overrides } = req.body;
    const enabledTools = Array.isArray(tool_overrides)
        ? (tool_overrides as any[]).filter(t => typeof t === 'string' && t.trim().length > 0)
        : [];

    // We need to access the workspace root inside the async generator
    // contextvars should propagate if we are in the same async chain
    const root = req.headers['x-workspace-root'] as string;
    
    // Re-wrap in context just to be safe for the async operation if context is lost
    workspaceContext.run({ root }, async () => {
        try {
            const config = await db.loadLlmConfig();
            if (!config) {
                res.status(400).json({ detail: "Agent not configured" });
                return;
            }
            const llm = buildLlmClient(config);
            
            const contextMaxLength = config.context_max_length || 128000;
            const agent = new Agent(llm, sessionId, contextMaxLength);
            
            // Set mode
            const session = await db.getSession(sessionId);
            const resolvedMode = mode || session?.mode;
            if (session) {
                agent.setMode(resolvedMode || session.mode, enabledTools);
                if (resolvedMode && resolvedMode !== session.mode) {
                    await db.updateSessionMeta(sessionId, { mode: resolvedMode });
                }
            } else {
                agent.setMode(resolvedMode || 'chat', enabledTools);
            }

            const activeTools = agent.getActiveTools();
            const chatOptions: any = {
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

// --- Workspace Endpoints ---

app.post('/workspace/bind-root', async (req, res) => {
    console.log(`[Workspace] Binding root: ${req.body.root}`);
    try {
        const { root } = req.body;
        if (!root) throw new Error("Root path is required");
        
        // Validate existence
        const stats = await fs.stat(root);
        if (!stats.isDirectory()) throw new Error("Path is not a directory");

        // Run inside context to init DB
        await workspaceContext.run({ root }, async () => {
             await db.initDb();
        });

        console.log(`[Workspace] Root bound successfully: ${root}`);
        res.json({ 
            root, 
            status: "ok", 
            data_dir: path.join(root, ".aichat") 
        });
    } catch (e: any) {
        console.error(`[Workspace] Bind error: ${e.message}`);
        res.status(400).json({ detail: e.message });
    }
});

app.get('/workspace/structure', async (req, res) => {
    try {
        // use middleware bound root
        const root = getWorkspaceRoot();
        const structure = await getProjectStructure(root);
        res.json(structure);
    } catch (e: any) {
        res.status(400).json({ detail: e.message });
    }
});

app.get('/workspace/read', async (req, res) => {
    try {
        const root = getWorkspaceRoot();
        const relativePath = req.query.path as string;
        if (!relativePath) throw new Error("Path is required");
        
        const fullPath = path.resolve(root, relativePath);
        if (!fullPath.startsWith(root)) throw new Error("Access denied");
        
        const content = await fs.readFile(fullPath, 'utf-8');
        res.json({ path: relativePath, content, truncated: false });
    } catch (e: any) {
         res.status(400).json({ detail: e.message });
    }
});

app.post('/workspace/write', async (req, res) => {
    try {
        const root = getWorkspaceRoot();
        const { path: relativePath, content, create_directories } = req.body;
        if (!relativePath) throw new Error("Path is required");

        const fullPath = path.resolve(root, relativePath);
        if (!fullPath.startsWith(root)) throw new Error("Access denied");

        if (create_directories) {
            await fs.mkdir(path.dirname(fullPath), { recursive: true });
        }
        await fs.writeFile(fullPath, content || "", 'utf-8');
        res.json({ path: relativePath, bytes: (content || "").length });
    } catch (e: any) {
         res.status(400).json({ detail: e.message });
    }
});

const PORT = 8000;
app.listen(PORT, () => {
    console.log(`Node.js Agent Backend running on http://localhost:${PORT}`);
});

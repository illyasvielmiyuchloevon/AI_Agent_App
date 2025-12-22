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
Object.defineProperty(exports, "__esModule", { value: true });
exports.Agent = void 0;
const db = __importStar(require("./db"));
const tool_registry_1 = require("./core/tool_registry");
const prompts_1 = require("./core/prompts");
const filesystem_1 = require("./tools/filesystem");
const shell_1 = require("./tools/shell");
const screen_capture_1 = require("./tools/screen_capture");
const desktop_1 = require("./tools/desktop");
const rag_tools_1 = require("./tools/rag_tools");
let cachedEncoder = null;
let cachedEncoderTried = false;
function getOptionalEncoder() {
    if (cachedEncoderTried)
        return cachedEncoder;
    cachedEncoderTried = true;
    try {
        const mod = require('js-tiktoken');
        if (mod && typeof mod.getEncoding === 'function') {
            cachedEncoder = mod.getEncoding('cl100k_base');
            return cachedEncoder;
        }
        if (mod && typeof mod.encoding_for_model === 'function') {
            cachedEncoder = mod.encoding_for_model('gpt-4');
            return cachedEncoder;
        }
    }
    catch {
    }
    try {
        const mod = require('tiktoken');
        if (mod && typeof mod.getEncoding === 'function') {
            cachedEncoder = mod.getEncoding('cl100k_base');
            return cachedEncoder;
        }
    }
    catch {
    }
    cachedEncoder = null;
    return cachedEncoder;
}
class Agent {
    llm;
    sessionId;
    history = [];
    mode = 'chat';
    tools = [];
    activeToolNames = new Set();
    systemPrompt = (0, prompts_1.getPrompt)('chat');
    systemContext = '';
    contextMaxLength = 128000;
    registry;
    // Toolsets
    fileTools;
    shellTool;
    agentTools;
    ragTool;
    constructor(llm, opts = {}) {
        this.llm = llm;
        this.sessionId = opts.sessionId;
        this.contextMaxLength = opts.contextMaxLength || 128000;
        this.registry = new tool_registry_1.ToolRegistry();
        this.fileTools = [
            new filesystem_1.ReadFileTool(),
            new filesystem_1.WriteFileTool(),
            new filesystem_1.ListFilesTool(),
            new filesystem_1.EditFileTool(),
            new filesystem_1.CreateFolderTool(),
            new filesystem_1.DeleteFileTool(),
            new filesystem_1.RenameFileTool(),
            new filesystem_1.SearchInFilesTool(),
            new filesystem_1.ProjectStructureTool()
        ];
        this.shellTool = new shell_1.ExecuteShellTool();
        if (opts.getRagIndex && opts.getConfig) {
            const cfg = opts.getConfig();
            if (cfg.features?.workspaceSemanticSearch !== false) {
                this.ragTool = new rag_tools_1.WorkspaceSemanticSearchTool(opts.getRagIndex, opts.getConfig);
            }
        }
        // Agent tools include file tools, shell, and desktop control/capture
        this.agentTools = [
            ...this.fileTools,
            this.shellTool,
            new screen_capture_1.ScreenCaptureTool(),
            new desktop_1.KeyboardControlTool(),
            new desktop_1.MouseControlTool()
        ];
        if (this.ragTool) {
            this.agentTools.push(this.ragTool);
        }
        // Register all tools
        this.agentTools.forEach(tool => this.registry.register(tool));
        // Enable verbose logging for debugging tool execution paths
        this.registry.debugMode = true;
        if (this.sessionId) {
            this.loadHistory();
        }
    }
    async loadHistory() {
        if (!this.sessionId)
            return;
        const messages = await db.getMessages(this.sessionId);
        this.history = messages.map(m => ({
            role: m.role,
            content: m.content,
            tool_calls: m.tool_calls,
            tool_call_id: m.tool_call_id,
            name: m.name
        }));
        // In a real implementation, we'd need more robust hydration of tool calls from DB JSON
        // For PoC, we assume mostly text or simple content
        this.ensureSystemPrompt();
        this.trimHistory();
    }
    setMode(mode, enabledTools) {
        // Simple check if mode is valid (could use getPrompt result but let's assume valid if prompt exists)
        // However getPrompt returns default chat prompt if mode invalid, so better check explicitly if needed.
        // For now trusting the caller or just setting prompt.
        this.mode = mode;
        let activeTools = [];
        if (mode === 'agent') {
            activeTools = this.agentTools;
        }
        else if (mode === 'canva') {
            // Canva mode still needs shell for quick builds/verification
            activeTools = [...this.fileTools, this.shellTool];
            if (this.ragTool) {
                activeTools.push(this.ragTool);
            }
        }
        if (enabledTools && enabledTools.length > 0) {
            activeTools = activeTools.filter(t => enabledTools.includes(t.name));
        }
        this.tools = activeTools;
        this.activeToolNames = new Set(activeTools.map(t => t.name));
        const toolNames = Array.from(this.activeToolNames).join(', ');
        const basePrompt = (0, prompts_1.getPrompt)(mode);
        this.systemPrompt = this.activeToolNames.size > 0
            ? `${basePrompt}\n\nActive tools in this mode: ${toolNames}. Prefer taking real actions with these tools instead of only replying in text.`
            : basePrompt;
        console.log(`[Agent] Mode set to ${mode}. Active tools: ${Array.from(this.activeToolNames).join(', ') || 'none'}`);
        this.ensureSystemPrompt();
    }
    ensureSystemPrompt() {
        const existingSystem = this.history.find(m => m.role === 'system');
        const combined = this.systemContext && this.systemContext.trim().length > 0
            ? `${this.systemPrompt}\n\n${this.systemContext}`
            : this.systemPrompt;
        if (existingSystem) {
            existingSystem.content = combined;
        }
        else {
            this.history.unshift({ role: 'system', content: combined });
        }
    }
    setSystemContext(context) {
        this.systemContext = context || '';
        this.ensureSystemPrompt();
    }
    async saveMessage(message) {
        if (!this.sessionId)
            return;
        await db.addMessage(this.sessionId, {
            role: message.role,
            content: message.content || "",
            tool_calls: message.tool_calls,
            tool_call_id: message.tool_call_id,
            name: message.name
        });
    }
    estimateTokens(content) {
        const estimateFromText = (text) => {
            if (!text)
                return 0;
            const enc = getOptionalEncoder();
            if (enc && typeof enc.encode === 'function') {
                try {
                    const out = enc.encode(text);
                    if (Array.isArray(out))
                        return out.length;
                }
                catch {
                }
            }
            let ascii = 0;
            let nonAscii = 0;
            for (let i = 0; i < text.length; i += 1) {
                const code = text.charCodeAt(i);
                if (code <= 0x7f)
                    ascii += 1;
                else
                    nonAscii += 1;
            }
            return Math.ceil(ascii / 4 + nonAscii / 2);
        };
        if (content === null || content === undefined)
            return 0;
        if (typeof content === 'string')
            return estimateFromText(content);
        if (typeof content === 'number' || typeof content === 'boolean')
            return estimateFromText(String(content));
        if (Array.isArray(content)) {
            return content.reduce((acc, part) => {
                if (typeof part === 'string')
                    return acc + estimateFromText(part);
                if (part && typeof part === 'object' && typeof part.text === 'string')
                    return acc + estimateFromText(part.text);
                try {
                    return acc + estimateFromText(JSON.stringify(part));
                }
                catch {
                    return acc;
                }
            }, 0);
        }
        try {
            return estimateFromText(JSON.stringify(content));
        }
        catch {
            return estimateFromText(String(content));
        }
    }
    getActiveTools() {
        return this.tools;
    }
    trimHistory() {
        if (this.history.length === 0)
            return;
        let currentTokens = 0;
        // Always keep system prompt if present
        const systemMsg = this.history.find(m => m.role === 'system');
        const systemTokens = systemMsg ? this.estimateTokens(systemMsg.content) : 0;
        currentTokens += systemTokens;
        // Process other messages in reverse (newest first)
        const otherMessages = this.history.filter(m => m.role !== 'system').reverse();
        const reversedKept = [];
        for (const msg of otherMessages) {
            const tokens = this.estimateTokens(msg.content);
            if (currentTokens + tokens > this.contextMaxLength) {
                break;
            }
            currentTokens += tokens;
            reversedKept.push(msg);
        }
        // Reconstruct history: System (if any) + Oldest...Newest
        this.history = systemMsg
            ? [systemMsg, ...reversedKept.reverse()]
            : reversedKept.reverse();
    }
    async *chat(userInput, attachments = [], options = {}) {
        this.ensureSystemPrompt();
        // Add user message
        const userMsg = { role: 'user', content: userInput };
        // Handle attachments (simplified)
        if (attachments.length > 0) {
            userMsg.content = [
                { type: 'text', text: userInput },
                ...attachments.map(att => ({ type: 'text', text: `[Attachment: ${att.name}]` }))
            ];
        }
        this.history.push(userMsg);
        await this.saveMessage(userMsg);
        while (true) {
            // Trim history before sending
            this.trimHistory();
            // Shallow-clone options so we can tweak per turn
            const callOptions = { ...options };
            // Call LLM with streaming
            let response;
            try {
                const iterator = this.llm.streamChatCompletion(this.history, this.tools, this.sessionId, callOptions);
                let next = await iterator.next();
                while (!next.done) {
                    yield next.value;
                    next = await iterator.next();
                }
                response = next.value;
            }
            catch (e) {
                yield `Error: ${e.message}`;
                return;
            }
            this.history.push(response);
            await this.saveMessage(response);
            // Note: Content was already yielded via stream.
            if (!response.tool_calls || response.tool_calls.length === 0) {
                break;
            }
            // Execute tools
            for (const toolCall of response.tool_calls) {
                yield `\n[Executing ${toolCall.function.name}...]\n`;
                let result = "";
                const toolName = toolCall.function.name;
                let args = toolCall.function.arguments || {};
                // Parse and normalize tool args, with fallbacks for malformed payloads
                if (typeof args === 'string') {
                    const cleaned = this.cleanArgsString(args);
                    const tryParse = (txt) => {
                        try {
                            return JSON.parse(txt);
                        }
                        catch {
                            return undefined;
                        }
                    };
                    // 1) direct parse
                    let parsed = tryParse(cleaned);
                    // 2) wrap key/value snippets without braces (e.g., "\"command\":\"ls\"")
                    if (!parsed && !cleaned.trim().startsWith('{') && cleaned.includes(':')) {
                        parsed = tryParse(`{${cleaned.replace(/^{|}$/g, '')}}`);
                    }
                    if (parsed) {
                        args = parsed;
                    }
                    else if (toolCall.function.name === 'execute_shell') {
                        // 3) shell-specific fallback: treat raw string as command
                        args = { command: cleaned.trim() };
                    }
                }
                try {
                    if (this.activeToolNames.size > 0 && !this.activeToolNames.has(toolCall.function.name)) {
                        throw new Error(`Tool ${toolCall.function.name} is not enabled in ${this.mode} mode`);
                    }
                    console.log(`[Agent] Executing tool_call id=${toolCall.id} name=${toolCall.function.name} args=${JSON.stringify(args)}`);
                    result = await this.registry.execute(toolCall.function.name, args, this.sessionId);
                }
                catch (e) {
                    result = `Error: ${e.message}`;
                }
                // Normalize result and attach diff when possible
                let resultObject;
                if (typeof result === 'string') {
                    try {
                        resultObject = JSON.parse(result);
                    }
                    catch {
                        resultObject = { message: result };
                    }
                }
                else {
                    resultObject = result;
                }
                const serialized = typeof resultObject === 'string' ? resultObject : JSON.stringify(resultObject);
                console.log(`[Agent] Tool result id=${toolCall.id} name=${toolCall.function.name} size=${serialized.length}`);
                const toolMsg = {
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: serialized,
                    name: toolCall.function.name
                };
                this.history.push(toolMsg);
                await this.saveMessage(toolMsg);
            }
        }
    }
    // Sanitizes common malformed argument strings from LLM (e.g., code fences, trailing "null")
    cleanArgsString(raw) {
        let s = raw.trim();
        // Drop trailing "null" artifacts
        s = s.replace(/[,\s]*null\s*$/i, '');
        // Remove surrounding code fences like ```json ... ```
        if (s.startsWith('```')) {
            s = s.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
        }
        // If extra text trails after a closing brace/bracket, cut at the last one
        const lastBrace = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
        if (lastBrace >= 0 && lastBrace < s.length - 1) {
            s = s.slice(0, lastBrace + 1);
        }
        return s;
    }
}
exports.Agent = Agent;

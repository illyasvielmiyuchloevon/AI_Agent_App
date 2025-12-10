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
class Agent {
    llm;
    sessionId;
    history = [];
    mode = 'chat';
    tools = [];
    activeToolNames = new Set();
    systemPrompt = (0, prompts_1.getPrompt)('chat');
    contextMaxLength = 128000;
    registry;
    // Toolsets
    fileTools;
    shellTool;
    agentTools;
    constructor(llm, sessionId, contextMaxLength = 128000) {
        this.llm = llm;
        this.sessionId = sessionId;
        this.contextMaxLength = contextMaxLength;
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
        // Agent tools include file tools, shell, and desktop control/capture
        this.agentTools = [
            ...this.fileTools,
            this.shellTool,
            new screen_capture_1.ScreenCaptureTool(),
            new desktop_1.KeyboardControlTool(),
            new desktop_1.MouseControlTool()
        ];
        // Register all tools
        this.agentTools.forEach(tool => this.registry.register(tool));
        // Enable verbose logging for debugging tool execution paths
        this.registry.debugMode = true;
        if (sessionId) {
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
            activeTools = this.fileTools; // simplified for PoC
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
        if (existingSystem) {
            existingSystem.content = this.systemPrompt;
        }
        else {
            this.history.unshift({ role: 'system', content: this.systemPrompt });
        }
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
        if (typeof content === 'string')
            return Math.ceil(content.length / 4);
        if (Array.isArray(content)) {
            return content.reduce((acc, part) => acc + (part.text ? Math.ceil(part.text.length / 4) : 0), 0);
        }
        return 0;
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
                try {
                    if (this.activeToolNames.size > 0 && !this.activeToolNames.has(toolCall.function.name)) {
                        throw new Error(`Tool ${toolCall.function.name} is not enabled in ${this.mode} mode`);
                    }
                    console.log(`[Agent] Executing tool_call id=${toolCall.id} name=${toolCall.function.name} args=${JSON.stringify(toolCall.function.arguments)}`);
                    result = await this.registry.execute(toolCall.function.name, toolCall.function.arguments, this.sessionId);
                }
                catch (e) {
                    result = `Error: ${e.message}`;
                }
                if (typeof result !== 'string') {
                    result = JSON.stringify(result);
                }
                console.log(`[Agent] Tool result id=${toolCall.id} name=${toolCall.function.name} size=${result.length}`);
                const toolMsg = {
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: result,
                    name: toolCall.function.name
                };
                this.history.push(toolMsg);
                await this.saveMessage(toolMsg);
            }
        }
    }
}
exports.Agent = Agent;

import { LLMClient } from './core/llm';
import { UnifiedMessage, BaseTool, ContentPart } from './core/types';
import * as db from './db';
import { ToolRegistry } from './core/tool_registry';
import { getPrompt } from './core/prompts';
import { ReadFileTool, WriteFileTool, ListFilesTool, EditFileTool, CreateFolderTool, DeleteFileTool, RenameFileTool, SearchInFilesTool, ProjectStructureTool } from './tools/filesystem';
import { ExecuteShellTool } from './tools/shell';
import { ScreenCaptureTool } from './tools/screen_capture';
import { KeyboardControlTool, MouseControlTool } from './tools/desktop';
import { WorkspaceSemanticSearchTool } from './tools/rag_tools';
import { RagIndex } from './ai-engine/rag_index';
import { AiEngineRuntimeConfig } from './ai-engine/runtime_config';

let cachedEncoder: any = null;
let cachedEncoderTried = false;
function getOptionalEncoder() {
    if (cachedEncoderTried) return cachedEncoder;
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
    } catch {
    }
    try {
        const mod = require('tiktoken');
        if (mod && typeof mod.getEncoding === 'function') {
            cachedEncoder = mod.getEncoding('cl100k_base');
            return cachedEncoder;
        }
    } catch {
    }
    cachedEncoder = null;
    return cachedEncoder;
}

export interface AgentOptions {
    sessionId?: string;
    contextMaxLength?: number;
    getRagIndex?: (root: string) => RagIndex;
    getConfig?: () => AiEngineRuntimeConfig;
}

export class Agent {
    private llm: LLMClient;
    private sessionId?: string;
    private history: UnifiedMessage[] = [];
    private mode: string = 'chat';
    private tools: BaseTool[] = [];
    private activeToolNames: Set<string> = new Set();
    private systemPrompt: string = getPrompt('chat');
    private systemContext: string = '';
    private contextMaxLength: number = 128000;
    private registry: ToolRegistry;

    // Toolsets
    private fileTools: BaseTool[];
    private shellTool: BaseTool;
    private agentTools: BaseTool[];
    private ragTool?: WorkspaceSemanticSearchTool;

    constructor(llm: LLMClient, opts: AgentOptions = {}) {
        this.llm = llm;
        this.sessionId = opts.sessionId;
        this.contextMaxLength = opts.contextMaxLength || 128000;
        this.registry = new ToolRegistry();
        
        this.fileTools = [
            new ReadFileTool(),
            new WriteFileTool(),
            new ListFilesTool(),
            new EditFileTool(),
            new CreateFolderTool(),
            new DeleteFileTool(),
            new RenameFileTool(),
            new SearchInFilesTool(),
            new ProjectStructureTool()
        ];
        this.shellTool = new ExecuteShellTool();
        
        if (opts.getRagIndex && opts.getConfig) {
            const cfg = opts.getConfig();
            if (cfg.features?.workspaceSemanticSearch !== false) {
                this.ragTool = new WorkspaceSemanticSearchTool(opts.getRagIndex, opts.getConfig);
            }
        }

        // Agent tools include file tools, shell, and desktop control/capture
        this.agentTools = [
            ...this.fileTools, 
            this.shellTool,
            new ScreenCaptureTool(),
            new KeyboardControlTool(),
            new MouseControlTool()
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
        if (!this.sessionId) return;
        const messages = await db.getMessages(this.sessionId);
        this.history = messages.map(m => ({
            role: m.role as any,
            content: m.content,
            tool_calls: (m as any).tool_calls,
            tool_call_id: (m as any).tool_call_id,
            name: (m as any).name
        }));
        
        // In a real implementation, we'd need more robust hydration of tool calls from DB JSON
        // For PoC, we assume mostly text or simple content
        this.ensureSystemPrompt();
        this.trimHistory();
    }

    setMode(mode: string, enabledTools?: string[]) {
        // Simple check if mode is valid (could use getPrompt result but let's assume valid if prompt exists)
        // However getPrompt returns default chat prompt if mode invalid, so better check explicitly if needed.
        // For now trusting the caller or just setting prompt.
        this.mode = mode;

        let activeTools: BaseTool[] = [];
        if (mode === 'agent') {
            activeTools = this.agentTools;
        } else if (mode === 'canva') {
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
        const basePrompt = getPrompt(mode);
        this.systemPrompt = this.activeToolNames.size > 0
            ? `${basePrompt}\n\nActive tools in this mode: ${toolNames}. Prefer taking real actions with these tools instead of only replying in text.`
            : basePrompt;
        console.log(`[Agent] Mode set to ${mode}. Active tools: ${Array.from(this.activeToolNames).join(', ') || 'none'}`);
        this.ensureSystemPrompt();
    }

    private ensureSystemPrompt() {
        const existingSystem = this.history.find(m => m.role === 'system');
        const combined = this.systemContext && this.systemContext.trim().length > 0
          ? `${this.systemPrompt}\n\n${this.systemContext}`
          : this.systemPrompt;
        if (existingSystem) {
            existingSystem.content = combined;
        } else {
            this.history.unshift({ role: 'system', content: combined });
        }
    }

    setSystemContext(context: string) {
        this.systemContext = context || '';
        this.ensureSystemPrompt();
    }

    private async saveMessage(message: UnifiedMessage) {
        if (!this.sessionId) return;
        await db.addMessage(this.sessionId, {
            role: message.role,
            content: message.content || "",
            tool_calls: message.tool_calls,
            tool_call_id: message.tool_call_id,
            name: message.name
        });
    }

    private estimateTokens(content: any): number {
        const estimateFromText = (text: string): number => {
            if (!text) return 0;
            const enc = getOptionalEncoder();
            if (enc && typeof enc.encode === 'function') {
                try {
                    const out = enc.encode(text);
                    if (Array.isArray(out)) return out.length;
                } catch {
                }
            }
            let ascii = 0;
            let nonAscii = 0;
            for (let i = 0; i < text.length; i += 1) {
                const code = text.charCodeAt(i);
                if (code <= 0x7f) ascii += 1;
                else nonAscii += 1;
            }
            return Math.ceil(ascii / 4 + nonAscii / 2);
        };

        if (content === null || content === undefined) return 0;
        if (typeof content === 'string') return estimateFromText(content);
        if (typeof content === 'number' || typeof content === 'boolean') return estimateFromText(String(content));

        if (Array.isArray(content)) {
            return content.reduce((acc, part) => {
                if (typeof part === 'string') return acc + estimateFromText(part);
                if (part && typeof part === 'object' && typeof (part as any).text === 'string') return acc + estimateFromText((part as any).text);
                try {
                    return acc + estimateFromText(JSON.stringify(part));
                } catch {
                    return acc;
                }
            }, 0);
        }

        try {
            return estimateFromText(JSON.stringify(content));
        } catch {
            return estimateFromText(String(content));
        }
    }

    getActiveTools(): BaseTool[] {
        return this.tools;
    }

    private trimHistory() {
        if (this.history.length === 0) return;
        
        let currentTokens = 0;
        
        // Always keep system prompt if present
        const systemMsg = this.history.find(m => m.role === 'system');
        const systemTokens = systemMsg ? this.estimateTokens(systemMsg.content) : 0;
        currentTokens += systemTokens;

        // Process other messages in reverse (newest first)
        const otherMessages = this.history.filter(m => m.role !== 'system').reverse();
        const reversedKept: UnifiedMessage[] = [];
        
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

    async *chat(userInput: string, attachments: any[] = [], options: any = {}): AsyncGenerator<string, void, unknown> {
        this.ensureSystemPrompt();

        // Add user message
        const userMsg: UnifiedMessage = { role: 'user', content: userInput };
        // Handle attachments (simplified)
        if (attachments.length > 0) {
             userMsg.content = [
                 { type: 'text', text: userInput },
                 ...attachments.map(att => ({ type: 'text', text: `[Attachment: ${att.name}]` }))
             ] as ContentPart[];
        }

        this.history.push(userMsg);
        await this.saveMessage(userMsg);

        while (true) {
            // Trim history before sending
            this.trimHistory();

            // Shallow-clone options so we can tweak per turn
            const callOptions: any = { ...options };

            // Call LLM with streaming
            let response: UnifiedMessage;
            try {
                const iterator = this.llm.streamChatCompletion(this.history, this.tools, this.sessionId, callOptions);
                let next = await iterator.next();
                while (!next.done) {
                    yield next.value;
                    next = await iterator.next();
                }
                response = next.value as UnifiedMessage;
            } catch (e: any) {
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
                
                let result: any = "";
                const toolName = toolCall.function.name;
                let args: any = toolCall.function.arguments || {};

                // Parse and normalize tool args, with fallbacks for malformed payloads
                if (typeof args === 'string') {
                    const cleaned = this.cleanArgsString(args);
                    const tryParse = (txt: string) => {
                        try {
                            return JSON.parse(txt);
                        } catch {
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
                    } else if (toolCall.function.name === 'execute_shell') {
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
                } catch (e: any) {
                    result = `Error: ${e.message}`;
                }

                // Normalize result and attach diff when possible
                let resultObject: any;
                if (typeof result === 'string') {
                    try { resultObject = JSON.parse(result); } catch { resultObject = { message: result }; }
                } else {
                    resultObject = result;
                }

                const serialized = typeof resultObject === 'string' ? resultObject : JSON.stringify(resultObject);
                console.log(`[Agent] Tool result id=${toolCall.id} name=${toolCall.function.name} size=${serialized.length}`);

                const toolMsg: UnifiedMessage = {
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
    private cleanArgsString(raw: string): string {
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

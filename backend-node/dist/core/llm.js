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
exports.AnthropicProvider = exports.OpenAIProvider = exports.LLMClient = void 0;
const openai_1 = __importDefault(require("openai"));
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const db = __importStar(require("../db"));
class LLMClient {
}
exports.LLMClient = LLMClient;
class OpenAIProvider extends LLMClient {
    client;
    model;
    constructor(apiKey, model = "gpt-4-turbo", baseUrl) {
        super();
        const opts = { apiKey: apiKey };
        if (baseUrl && baseUrl.trim().length > 0) {
            // Normalize Base URL: remove surrounding quotes/backticks and whitespace
            let cleaned = baseUrl.trim().replace(/^['"`]+|['"`]+$/g, '');
            if (cleaned.length > 0) {
                opts.baseURL = cleaned;
            }
        }
        console.log(`[OpenAI] Initializing client. BaseURL: ${opts.baseURL || 'default'}`);
        this.client = new openai_1.default(opts);
        this.model = model;
        if (!this.client.chat) {
            console.error("[OpenAI] client.chat is undefined!");
        }
        else if (!this.client.chat.completions) {
            console.error("[OpenAI] client.chat.completions is undefined!");
        }
    }
    async chatCompletion(messages, tools, sessionId, options = {}) {
        const model = options.model || this.model;
        // Convert messages to OpenAI format
        const openAIMessages = messages.map(msg => {
            const m = { role: msg.role };
            if (msg.content)
                m.content = msg.content;
            if (msg.tool_calls) {
                m.tool_calls = msg.tool_calls.map(tc => ({
                    id: tc.id,
                    type: 'function',
                    function: {
                        name: tc.function.name,
                        arguments: JSON.stringify(tc.function.arguments)
                    }
                }));
            }
            if (msg.tool_call_id)
                m.tool_call_id = msg.tool_call_id;
            if (msg.name)
                m.name = msg.name;
            return m;
        });
        const openAITools = tools && tools.length > 0 ? tools.map(t => t.toOpenAISchema()) : undefined;
        const logData = {
            model,
            messages: openAIMessages,
            tools: openAITools,
            kwargs: options
        };
        console.log(`[LLM] Requesting completion for model ${model}`);
        let success = false;
        let responseBody = null;
        let statusCode = 0;
        try {
            const requestBody = {
                model: model,
                messages: openAIMessages,
                ...options
            };
            if (openAITools) {
                requestBody.tools = openAITools;
                requestBody.tool_choice = options.tool_choice || 'auto';
                if (requestBody.parallel_tool_calls === undefined) {
                    requestBody.parallel_tool_calls = true;
                }
            }
            else {
                delete requestBody.tool_choice;
                delete requestBody.parallel_tool_calls;
            }
            const completion = await this.client.chat.completions.create(requestBody);
            success = true;
            statusCode = 200;
            responseBody = completion;
            console.log(`[LLM] Completion success. Tokens: ${completion.usage?.total_tokens}`);
            const choice = completion.choices[0];
            const message = choice.message;
            let toolCalls;
            if (message.tool_calls) {
                console.log(`[LLM] Tool calls received: ${message.tool_calls.length}`);
                toolCalls = message.tool_calls.map((tc) => {
                    let parsedArgs = tc.function.arguments;
                    if (typeof parsedArgs === 'string') {
                        try {
                            parsedArgs = JSON.parse(parsedArgs);
                        }
                        catch { /* keep raw */ }
                    }
                    return {
                        id: tc.id,
                        function: {
                            name: tc.function.name,
                            arguments: parsedArgs
                        }
                    };
                });
            }
            const result = {
                role: 'assistant',
                content: message.content || undefined,
                tool_calls: toolCalls
            };
            // Log success
            if (sessionId) {
                await db.addLog(sessionId, 'openai', 'chat_completion', 'https://api.openai.com/v1/chat/completions', logData, responseBody, statusCode, true, true);
            }
            return result;
        }
        catch (e) {
            console.error(`[LLM] Completion error: ${e.message}`);
            // Log error
            if (sessionId) {
                await db.addLog(sessionId, 'openai', 'chat_completion', 'https://api.openai.com/v1/chat/completions', logData, { error: e.message }, e.status || 500, false, false, e.message);
            }
            throw e;
        }
    }
    async *streamChatCompletion(messages, tools, sessionId, options = {}) {
        const model = options.model || this.model;
        // Convert messages to OpenAI format
        const openAIMessages = messages.map(msg => {
            const m = { role: msg.role };
            if (msg.content)
                m.content = msg.content;
            if (msg.tool_calls) {
                m.tool_calls = msg.tool_calls.map(tc => ({
                    id: tc.id,
                    type: 'function',
                    function: {
                        name: tc.function.name,
                        arguments: JSON.stringify(tc.function.arguments)
                    }
                }));
            }
            if (msg.tool_call_id)
                m.tool_call_id = msg.tool_call_id;
            if (msg.name)
                m.name = msg.name;
            return m;
        });
        const openAITools = tools && tools.length > 0 ? tools.map(t => t.toOpenAISchema()) : undefined;
        const logData = {
            model,
            messages: openAIMessages,
            tools: openAITools,
            kwargs: options,
            stream: true
        };
        console.log(`[LLM] Requesting stream completion for model ${model}`);
        let fullContent = "";
        const toolCallsMap = {};
        try {
            const requestBody = {
                model: model,
                messages: openAIMessages,
                ...options,
                stream: true
            };
            if (openAITools) {
                requestBody.tools = openAITools;
                requestBody.tool_choice = options.tool_choice || 'auto';
                if (requestBody.parallel_tool_calls === undefined) {
                    requestBody.parallel_tool_calls = true;
                }
            }
            else {
                delete requestBody.tool_choice;
                delete requestBody.parallel_tool_calls;
            }
            const stream = await this.client.chat.completions.create(requestBody);
            for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta;
                if (!delta)
                    continue;
                if (delta.content) {
                    fullContent += delta.content;
                    yield delta.content;
                }
                if (delta.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        const idx = tc.index;
                        if (!toolCallsMap[idx]) {
                            toolCallsMap[idx] = {
                                index: idx,
                                id: tc.id || "",
                                function: { name: "", arguments: "" }
                            };
                        }
                        if (tc.id)
                            toolCallsMap[idx].id = tc.id;
                        if (tc.function?.name)
                            toolCallsMap[idx].function.name += tc.function.name;
                        if (tc.function?.arguments !== undefined) {
                            const argChunk = typeof tc.function.arguments === 'string'
                                ? tc.function.arguments
                                : JSON.stringify(tc.function.arguments);
                            if (argChunk.length > 0) {
                                console.log(`[LLM][Stream] tool_call idx=${idx} name=${tc.function?.name || ''} arg_chunk_len=${argChunk.length}`);
                            }
                            toolCallsMap[idx].function.arguments += argChunk;
                        }
                    }
                }
            }
            // Process collected tool calls
            const toolCalls = Object.values(toolCallsMap).map((tc) => {
                let parsedArgs = tc.function.arguments;
                if (typeof parsedArgs === 'string') {
                    try {
                        parsedArgs = JSON.parse(parsedArgs || "{}");
                    }
                    catch { /* keep raw string */ }
                }
                return {
                    id: tc.id,
                    function: {
                        name: tc.function.name,
                        arguments: parsedArgs
                    }
                };
            });
            const result = {
                role: 'assistant',
                content: fullContent || undefined,
                tool_calls: toolCalls.length > 0 ? toolCalls : undefined
            };
            // Log success
            if (sessionId) {
                await db.addLog(sessionId, 'openai', 'chat_completion_stream', 'https://api.openai.com/v1/chat/completions', logData, { content: fullContent, tool_calls: toolCalls }, 200, true, true);
            }
            return result;
        }
        catch (e) {
            console.error(`[LLM] Stream error: ${e.message}`);
            if (sessionId) {
                await db.addLog(sessionId, 'openai', 'chat_completion_stream', 'https://api.openai.com/v1/chat/completions', logData, { error: e.message }, 500, false, false, e.message);
            }
            throw e;
        }
    }
    async checkHealth(model) {
        try {
            const m = model || this.model;
            console.log(`[LLM] Checking health for model ${m}`);
            await this.client.chat.completions.create({
                model: m,
                messages: [{ role: "user", content: "ping" }],
                max_tokens: 5
            });
            console.log(`[LLM] Health check passed`);
            return true;
        }
        catch (e) {
            console.error(`[LLM] Health check failed: ${e.message}`);
            return false;
        }
    }
}
exports.OpenAIProvider = OpenAIProvider;
class AnthropicProvider extends LLMClient {
    client;
    model;
    baseUrl;
    constructor(apiKey, model = "claude-3-opus-20240229", baseUrl) {
        super();
        const opts = { apiKey: apiKey };
        const normalizedBaseUrl = this.normalizeBaseUrl(baseUrl);
        if (normalizedBaseUrl) {
            opts.baseURL = normalizedBaseUrl;
            this.baseUrl = normalizedBaseUrl;
        }
        console.log(`[Anthropic] Initializing client. BaseURL: ${opts.baseURL || 'default'}`);
        this.client = new sdk_1.default(opts);
        this.model = model;
        if (!this.client.messages) {
            console.error("[Anthropic] client.messages is undefined! keys:", Object.keys(this.client));
        }
    }
    normalizeBaseUrl(baseUrl) {
        if (!baseUrl)
            return undefined;
        let cleaned = baseUrl.trim();
        cleaned = cleaned.replace(/^['\"`]+|['\"`]+$/g, ''); // strip surrounding quotes/backticks
        cleaned = cleaned.replace(/\/+$/, ''); // drop trailing slashes
        cleaned = cleaned.replace(/\/v1$/i, ''); // avoid double v1 when SDK appends
        return cleaned.length > 0 ? cleaned : undefined;
    }
    buildAnthropicPayload(messages, tools) {
        const systemMessage = messages.find(m => m.role === 'system');
        const userAssistantMessages = messages.filter(m => m.role !== 'system');
        const anthropicMessages = userAssistantMessages.map(msg => {
            // Map roles: tool -> user (with tool_result)
            if (msg.role === 'tool') {
                return {
                    role: 'user',
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: msg.tool_call_id,
                            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
                        }
                    ]
                };
            }
            if (msg.role === 'assistant' && msg.tool_calls) {
                const content = [];
                if (msg.content)
                    content.push({ type: 'text', text: msg.content });
                msg.tool_calls.forEach(tc => {
                    content.push({
                        type: 'tool_use',
                        id: tc.id,
                        name: tc.function.name,
                        input: tc.function.arguments
                    });
                });
                return { role: 'assistant', content };
            }
            if (Array.isArray(msg.content)) {
                // Normalize OpenAI-like content parts into Anthropic content blocks
                const contentBlocks = msg.content.map(part => {
                    if (part.type === 'text') {
                        return { type: 'text', text: part.text || '' };
                    }
                    if (part.type === 'image_url' && part.image_url?.url) {
                        return {
                            type: 'image',
                            source: { type: 'url', url: part.image_url.url }
                        };
                    }
                    return { type: 'text', text: JSON.stringify(part) };
                });
                return { role: msg.role, content: contentBlocks };
            }
            return {
                role: msg.role,
                content: msg.content
            };
        });
        const anthropicTools = tools?.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.input_schema
        }));
        return { systemMessage, anthropicMessages, anthropicTools };
    }
    parseAnthropicResponse(response) {
        let contentStr = '';
        const toolCalls = [];
        response?.content?.forEach((block) => {
            if (block.type === 'text') {
                contentStr += block.text;
            }
            else if (block.type === 'tool_use') {
                toolCalls.push({
                    id: block.id,
                    function: {
                        name: block.name,
                        arguments: block.input
                    }
                });
            }
        });
        const result = {
            role: 'assistant'
        };
        if (contentStr.length > 0)
            result.content = contentStr;
        if (toolCalls.length > 0)
            result.tool_calls = toolCalls;
        return result;
    }
    async chatCompletion(messages, tools, sessionId, options = {}) {
        const model = options.model || this.model;
        const { systemMessage, anthropicMessages, anthropicTools } = this.buildAnthropicPayload(messages, tools);
        const { tool_choice, parallel_tool_calls, stream: _, ...safeOptions } = options || {};
        const logData = {
            model,
            system: systemMessage?.content,
            messages: anthropicMessages,
            tools: anthropicTools,
            base_url: this.baseUrl,
            ...safeOptions
        };
        try {
            const requestBody = {
                model,
                system: systemMessage?.content,
                messages: anthropicMessages,
                max_tokens: safeOptions.max_tokens ?? 4096,
                temperature: safeOptions.temperature,
                ...safeOptions
            };
            if (anthropicTools && anthropicTools.length > 0) {
                requestBody.tools = anthropicTools;
            }
            const response = await this.client.messages.create(requestBody);
            const result = this.parseAnthropicResponse(response);
            if (sessionId) {
                await db.addLog(sessionId, 'anthropic', 'messages.create', '', logData, response, 200, true, true);
            }
            return result;
        }
        catch (e) {
            if (sessionId) {
                await db.addLog(sessionId, 'anthropic', 'messages.create', '', logData, { error: e.message }, 500, false, false, e.message);
            }
            throw e;
        }
    }
    async *streamChatCompletion(messages, tools, sessionId, options = {}) {
        const model = options.model || this.model;
        const { systemMessage, anthropicMessages, anthropicTools } = this.buildAnthropicPayload(messages, tools);
        const { tool_choice, parallel_tool_calls, stream: _, ...safeOptions } = options || {};
        const logData = {
            model,
            system: systemMessage?.content,
            messages: anthropicMessages,
            tools: anthropicTools,
            base_url: this.baseUrl,
            stream: true,
            ...safeOptions
        };
        let fullContent = '';
        try {
            const requestBody = {
                model,
                system: systemMessage?.content,
                messages: anthropicMessages,
                max_tokens: safeOptions.max_tokens ?? 4096,
                temperature: safeOptions.temperature,
                ...safeOptions
            };
            if (anthropicTools && anthropicTools.length > 0) {
                requestBody.tools = anthropicTools;
            }
            const stream = await this.client.messages.stream(requestBody);
            for await (const event of stream) {
                if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                    const deltaText = event.delta.text;
                    if (deltaText) {
                        fullContent += deltaText;
                        yield deltaText;
                    }
                }
            }
            const finalMessage = await stream.finalMessage();
            const result = this.parseAnthropicResponse(finalMessage);
            if (!result.content && fullContent) {
                result.content = fullContent;
            }
            if (sessionId) {
                await db.addLog(sessionId, 'anthropic', 'messages.stream', '', logData, { content: result.content, tool_calls: result.tool_calls }, 200, true, true);
            }
            return result;
        }
        catch (e) {
            if (sessionId) {
                await db.addLog(sessionId, 'anthropic', 'messages.stream', '', logData, { error: e.message }, e.status || 500, false, false, e.message);
            }
            throw e;
        }
    }
    async checkHealth(model) {
        try {
            if (!this.client.messages) {
                console.error("[Anthropic] client.messages is undefined. SDK might be incompatible or misconfigured.");
                return false;
            }
            await this.client.messages.create({
                model: model || this.model,
                max_tokens: 5,
                messages: [{ role: 'user', content: 'ping' }]
            });
            return true;
        }
        catch (e) {
            console.error(`[Anthropic] Health check failed: ${e.message}`);
            return false;
        }
    }
}
exports.AnthropicProvider = AnthropicProvider;

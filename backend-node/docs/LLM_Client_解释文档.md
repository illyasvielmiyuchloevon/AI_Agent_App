# LLM 客户端解释文档

## 文件概述

**文件路径**: `backend-node/src/core/llm.ts`

**文件大小**: 1,000+ 行代码

**最后更新**: 2025/12/19

### 文件描述

该文件实现了一个**统一的LLM（大语言模型）客户端抽象层**，为AI Agent应用提供与不同LLM提供商（OpenAI和Anthropic）交互的能力。它通过适配器模式将不同提供商的API统一为相同的接口，简化了上层应用的使用。

### 核心目标

1. **统一接口**: 为不同的LLM提供商提供一致的API
2. **工具调用支持**: 完整的function calling实现
3. **流式处理**: 支持实时流式响应
4. **日志记录**: 详细的请求/响应日志用于调试和监控
5. **错误处理**: 完善的错误处理和状态码记录

---

## 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    上层应用层                              │
│  (agent.ts, context.ts, workspace service等)              │
└────────────────────┬────────────────────────────────────┘
                     │ 使用
┌────────────────────▼────────────────────────────────────┐
│                    LLM 客户端层                           │
│  ┌─────────────────┐    ┌─────────────────────────────┐  │
│  │   LLMClient     │    │      ToolRegistry           │  │
│  │   (抽象基类)     │    │   (工具注册和执行)           │  │
│  └─────────────────┘    └─────────────────────────────┘  │
└────────────────────┬────────────────────────────────────┘
                     │ 适配
┌────────────────────▼────────────────────────────────────┐
│                 LLM 提供商层                             │
│  ┌─────────────────┐    ┌─────────────────────────────┐  │
│  │  OpenAIProvider │    │  AnthropicProvider          │  │
│  │   (OpenAI API)  │    │   (Anthropic API)           │  │
│  └─────────────────┘    └─────────────────────────────┘  │
└────────────────────┬────────────────────────────────────┘
                     │ HTTP请求
┌────────────────────▼────────────────────────────────────┐
│                 外部API服务                               │
│  ┌─────────────────┐    ┌─────────────────────────────┐  │
│  │   OpenAI API    │    │   Anthropic API             │  │
│  └─────────────────┘    └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 设计模式

1. **适配器模式 (Adapter Pattern)**
   - 将不同提供商的API适配为统一接口
   - `OpenAIProvider` 和 `AnthropicProvider` 都实现 `LLMClient` 接口

2. **抽象工厂模式 (Abstract Factory Pattern)**
   - `LLMClient` 作为抽象基类定义接口
   - 具体实现类提供不同的提供商支持

3. **观察者模式 (Observer Pattern)**
   - 通过数据库日志记录所有请求和响应
   - 用于监控、调试和审计

---

## 核心类详解

### 1. LLMClient (抽象基类)

```typescript
export abstract class LLMClient {
    abstract chatCompletion(
        messages: UnifiedMessage[],
        tools?: BaseTool[],
        sessionId?: string,
        options?: any
    ): Promise<UnifiedMessage>;

    abstract streamChatCompletion(
        messages: UnifiedMessage[],
        tools?: BaseTool[],
        sessionId?: string,
        options?: any
    ): AsyncGenerator<string, UnifiedMessage, unknown>;

    abstract checkHealth(model?: string): Promise<boolean>;
}
```

**职责**:
- 定义统一的LLM客户端接口
- 强制子类实现核心方法

**方法说明**:

#### chatCompletion (同步聊天完成)
- **功能**: 发送消息到LLM并获取完整响应
- **参数**:
  - `messages`: 消息数组（支持系统、用户、助手、工具角色）
  - `tools`: 可选的工具定义数组
  - `sessionId`: 会话ID（用于日志记录）
  - `options`: 额外选项（模型、温度等）
- **返回**: 完整的助手响应消息

#### streamChatCompletion (流式聊天完成)
- **功能**: 发送消息并以流式方式接收响应
- **参数**: 同 `chatCompletion`
- **返回**: 异步生成器，逐步产生响应片段
- **用途**: 实时显示AI回复，提升用户体验

#### checkHealth (健康检查)
- **功能**: 检查模型是否可用
- **参数**: `model` - 要检查的模型名称
- **返回**: 布尔值，表示模型是否健康

---

### 2. OpenAIProvider

```typescript
export class OpenAIProvider extends LLMClient {
    private client: OpenAI;
    private model: string;
    
    constructor(apiKey: string, model = "gpt-4-turbo", baseUrl?: string)
}
```

**职责**: 实现与OpenAI API的交互

**关键特性**:

#### 构造函数参数
- `apiKey`: OpenAI API密钥
- `model`: 默认模型（默认: "gpt-4-turbo"）
- `baseUrl`: 自定义Base URL（用于代理或私有部署）

#### Base URL 规范化
```typescript
// 清理周围的引号和空格
let cleaned = baseUrl.trim().replace(/^['"`]+|['"`]+$/g, '');
if (cleaned.length > 0) {
    opts.baseURL = cleaned;
}
```

**支持的功能**:
- ✅ 同步聊天完成
- ✅ 流式聊天完成
- ✅ 工具调用（function calling）
- ✅ 并行工具调用 (`parallel_tool_calls`)
- ✅ 多模态内容（文本、图片）
- ✅ 自定义Base URL

#### 消息格式转换

OpenAIProvider 需要将统一的消息格式转换为OpenAI格式：

```typescript
// 统一格式 -> OpenAI格式
const openAIMessages: any[] = messages.map(msg => {
    const m: any = { role: msg.role };
    if (msg.content) m.content = msg.content;
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
    // ... 其他字段
});
```

#### 工具调用处理

```typescript
// 工具调用响应解析
if (message.tool_calls) {
    toolCalls = message.tool_calls.map((tc: any) => {
        let parsedArgs: any = tc.function.arguments;
        if (typeof parsedArgs === 'string') {
            try { parsedArgs = JSON.parse(parsedArgs); } catch { /* keep raw */ }
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
```

---

### 3. AnthropicProvider

```typescript
export class AnthropicProvider extends LLMClient {
    private client: Anthropic;
    private model: string;
    private baseUrl?: string;
    
    constructor(apiKey: string, model = "claude-3-opus-20240229", baseUrl?: string)
}
```

**职责**: 实现与Anthropic API的交互

**关键特性**:

#### Base URL 规范化
```typescript
private normalizeBaseUrl(baseUrl?: string): string | undefined {
    if (!baseUrl) return undefined;
    let cleaned = baseUrl.trim();
    cleaned = cleaned.replace(/^['\"`]+|['\"`]+$/g, ''); // 去除引号
    cleaned = cleaned.replace(/\/+$/, ''); // 去除尾部斜杠
    cleaned = cleaned.replace(/\/v1$/i, ''); // 避免重复的v1
    return cleaned.length > 0 ? cleaned : undefined;
}
```

#### 消息格式转换

Anthropic使用不同的消息格式，特别是工具调用：

```typescript
// 统一格式 -> Anthropic格式
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
    const content: any[] = [];
    if (msg.content) content.push({ type: 'text', text: msg.content });
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
```

**支持的功能**:
- ✅ 同步聊天完成
- ✅ 流式聊天完成
- ✅ 工具调用（tool_use / tool_result）
- ✅ 多模态内容（文本、图片）
- ✅ 自定义Base URL

---

## 消息格式详解

### UnifiedMessage 接口

```typescript
export interface UnifiedMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content?: string | ContentPart[];
    tool_calls?: ToolCall[];
    tool_call_id?: string;
    name?: string;
}
```

**字段说明**:

- `role`: 消息角色
  - `'system'`: 系统消息（设置行为准则）
  - `'user'`: 用户消息
  - `'assistant'`: AI助手消息
  - `'tool'`: 工具调用结果

- `content`: 消息内容
  - 字符串：纯文本
  - `ContentPart[]`: 多模态内容（文本+图片）

- `tool_calls`: 工具调用数组
  - 包含工具ID、名称和参数

- `tool_call_id`: 工具调用ID（用于关联结果）

- `name`: 工具名称（可选）

### ContentPart 接口

```typescript
export interface ContentPart {
    type: 'text' | 'image_url';
    text?: string;
    image_url?: { url: string };
}
```

支持文本和图片URL两种内容类型。

### ToolCall 接口

```typescript
export interface ToolCall {
    id: string;
    function: {
        name: string;
        arguments: any; // 解析后的JSON对象
    };
}
```

---

## 工具调用 (Function Calling)

### 工具定义

工具通过 `BaseTool` 接口定义：

```typescript
export interface BaseTool {
    name: string;
    description: string;
    input_schema: any;
    execute(args: any, context?: { sessionId?: string }): Promise<any>;
    toOpenAISchema(): ToolSchema;
}
```

### OpenAI 工具调用流程

1. **发送工具定义**:
   ```typescript
   const openAITools = tools.map(t => t.toOpenAISchema());
   ```

2. **AI 决定是否调用工具**:
   - 如果需要，返回 `tool_calls` 数组
   - 包含工具ID、名称和参数

3. **执行工具**:
   ```typescript
   const result = await toolRegistry.execute(toolName, args, sessionId);
   ```

4. **发送工具结果**:
   ```typescript
   const toolResultMessage = {
       role: 'tool',
       tool_call_id: toolCall.id,
       content: JSON.stringify(result)
   };
   ```

5. **AI 继续对话**:
   - 基于工具结果生成最终回复

### Anthropic 工具调用流程

Anthropic使用 `tool_use` 和 `tool_result` 类型：

1. **工具使用**:
   ```typescript
   {
       type: 'tool_use',
       id: toolId,
       name: toolName,
       input: toolArgs
   }
   ```

2. **工具结果**:
   ```typescript
   {
       type: 'tool_result',
       tool_use_id: toolId,
       content: toolResult
   }
   ```

---

## 流式处理

### 流式响应的优势

1. **实时反馈**: 用户可以立即看到AI开始回复
2. **更好的用户体验**: 减少等待时间的感知
3. **内存效率**: 不需要等待完整响应

### OpenAI 流式实现

```typescript
async *streamChatCompletion(
    messages: UnifiedMessage[],
    tools?: BaseTool[],
    sessionId?: string,
    options: any = {}
): AsyncGenerator<string, UnifiedMessage, unknown> {
    // 1. 发送流式请求
    const stream = await this.client.chat.completions.create({
        model,
        messages: openAIMessages,
        tools: openAITools,
        stream: true
    }) as unknown as AsyncIterable<any>;

    // 2. 逐步处理响应
    for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
            fullContent += delta.content;
            yield delta.content; // 产出文本片段
        }
        
        // 处理工具调用
        if (delta?.tool_calls) {
            // 收集工具调用信息
        }
    }

    // 3. 返回完整结果
    return result;
}
```

### Anthropic 流式实现

```typescript
const stream = await (this.client as any).messages.stream(requestBody);

for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        const deltaText = event.delta.text;
        if (deltaText) {
            fullContent += deltaText;
            yield deltaText;
        }
    }
}
```

---

## 日志记录

### 日志结构

所有请求和响应都会记录到数据库中：

```typescript
await db.addLog(
    sessionId,           // 会话ID
    'openai',           // 提供商
    'chat_completion',  // 方法
    'https://api.openai.com/v1/chat/completions', // URL
    logData,            // 请求数据
    responseBody,       // 响应数据
    statusCode,         // 状态码
    true,               // 成功标志
    true                // 解析成功标志
);
```

### 日志字段说明

- `session_id`: 关联到特定会话
- `provider`: LLM提供商（openai/anthropic）
- `method`: API方法名称
- `url`: 请求URL
- `request_body`: 完整请求体
- `response_body`: 完整响应体
- `status_code`: HTTP状态码
- `success`: 请求是否成功
- `parsed_success`: 响应解析是否成功
- `parse_error`: 解析错误信息（如果有）
- `created_at`: 时间戳

### 日志用途

1. **调试**: 追踪请求和响应
2. **监控**: 统计成功率和错误率
3. **审计**: 记录所有AI交互
4. **分析**: 了解使用模式

---

## 错误处理

### 错误类型

1. **网络错误**: 连接失败、超时
2. **认证错误**: API密钥无效
3. **模型错误**: 模型不存在或不可用
4. **参数错误**: 请求参数格式错误
5. **解析错误**: 响应格式无法解析

### 错误处理策略

```typescript
try {
    const response = await this.client.chat.completions.create(requestBody);
    // 记录成功日志
    await db.addLog(sessionId, 'openai', 'chat_completion', url, logData, response, 200, true, true);
    return result;
} catch (e: any) {
    console.error(`[LLM] Completion error: ${e.message}`);
    // 记录错误日志
    await db.addLog(sessionId, 'openai', 'chat_completion', url, logData, { error: e.message }, e.status || 500, false, false, e.message);
    throw e;
}
```

### 健康检查

```typescript
async checkHealth(model?: string): Promise<boolean> {
    try {
        await this.client.chat.completions.create({
            model: model || this.model,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 5
        });
        return true;
    } catch (e: any) {
        console.error(`[LLM] Health check failed: ${e.message}`);
        return false;
    }
}
```

---

## 使用示例

### 基本使用

```typescript
import { OpenAIProvider, AnthropicProvider } from './core/llm';

// 创建OpenAI客户端
const openaiClient = new OpenAIProvider(
    process.env.OPENAI_API_KEY!,
    'gpt-4-turbo',
    process.env.OPENAI_BASE_URL
);

// 创建Anthropic客户端
const anthropicClient = new AnthropicProvider(
    process.env.ANTHROPIC_API_KEY!,
    'claude-3-opus-20240229',
    process.env.ANTHROPIC_BASE_URL
);

// 发送消息
const messages = [
    { role: 'user' as const, content: 'Hello, how are you?' }
];

const response = await openaiClient.chatCompletion(messages);
console.log(response.content);
```

### 使用工具

```typescript
import { ToolRegistry } from './core/tool_registry';

// 注册工具
const toolRegistry = new ToolRegistry();
toolRegistry.register(myTool);

// 发送带工具的消息
const response = await client.chatCompletion(
    messages,
    [myTool], // 工具定义
    sessionId,
    { model: 'gpt-4-turbo' }
);

// 如果AI调用了工具
if (response.tool_calls) {
    for (const toolCall of response.tool_calls) {
        const result = await toolRegistry.execute(
            toolCall.function.name,
            toolCall.function.arguments,
            sessionId
        );
        
        // 发送工具结果
        const toolResultMessage = {
            role: 'tool' as const,
            tool_call_id: toolCall.id,
            content: JSON.stringify(result)
        };
        
        // 继续对话
        const finalResponse = await client.chatCompletion(
            [...messages, response, toolResultMessage],
            [],
            sessionId
        );
    }
}
```

### 流式响应

```typescript
const stream = client.streamChatCompletion(messages, tools, sessionId);

let fullResponse = '';
for await (const chunk of stream) {
    fullResponse += chunk;
    console.log('Received:', chunk);
    // 实时显示给用户
}

// 获取完整结果
const finalResult = await stream;
console.log('Final result:', finalResult);
```

---

## 最佳实践

### 1. 错误处理

```typescript
try {
    const response = await client.chatCompletion(messages, tools, sessionId);
    // 处理成功响应
} catch (error) {
    if (error instanceof OpenAI.APIError) {
        // 处理OpenAI特定错误
        console.error('OpenAI API Error:', error.status, error.message);
    } else {
        // 处理其他错误
        console.error('Unexpected error:', error);
    }
}
```

### 2. 重试机制

```typescript
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }
    throw new Error('Max retries exceeded');
}

const response = await withRetry(() => client.chatCompletion(messages));
```

### 3. 会话管理

```typescript
// 使用sessionId关联日志
const sessionId = 'session-123';

// 所有相关请求使用相同的sessionId
const response1 = await client.chatCompletion(messages1, tools, sessionId);
const response2 = await client.chatCompletion(messages2, tools, sessionId);

// 可以通过sessionId查询所有相关日志
const logs = await db.getLogs(sessionId);
```

### 4. 工具调用最佳实践

```typescript
// 1. 清晰的工具描述
{
    name: 'search_files',
    description: 'Search files in the project directory',
    input_schema: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Directory to search' },
            pattern: { type: 'string', description: 'Glob pattern' }
        },
        required: ['path', 'pattern']
    }
}

// 2. 验证工具参数
const validate = ajv.compile(tool.input_schema);
if (!validate(args)) {
    throw new Error(`Invalid arguments: ${JSON.stringify(validate.errors)}`);
}

// 3. 处理工具执行错误
try {
    const result = await tool.execute(args, { sessionId });
    return result;
} catch (error) {
    console.error(`Tool ${tool.name} failed:`, error);
    // 返回错误信息给AI
    return { error: error.message };
}
```

### 5. 性能优化

```typescript
// 1. 使用流式响应提升用户体验
const stream = client.streamChatCompletion(messages);
for await (const chunk of stream) {
    // 实时显示
    updateUI(chunk);
}

// 2. 并行工具调用
const options = {
    parallel_tool_calls: true, // OpenAI默认
};

// 3. 限制上下文长度
const recentMessages = messages.slice(-10); // 只保留最近10条消息
```

---

## 常见问题

### Q1: 如何切换LLM提供商？

**A**: 创建不同提供商的客户端实例：

```typescript
let client: LLMClient;

if (provider === 'openai') {
    client = new OpenAIProvider(apiKey, model, baseUrl);
} else {
    client = new AnthropicProvider(apiKey, model, baseUrl);
}
```

### Q2: 工具调用失败怎么办？

**A**: 检查以下几点：

1. 工具定义是否正确
2. 参数是否符合schema
3. 工具执行是否有权限
4. 返回结果格式是否正确

```typescript
// 调试工具调用
console.log('Tool call:', toolCall);
console.log('Args:', toolCall.function.arguments);

try {
    const result = await toolRegistry.execute(toolCall.function.name, toolCall.function.arguments, sessionId);
    console.log('Tool result:', result);
} catch (error) {
    console.error('Tool execution failed:', error);
    // 返回错误信息
    return { error: error.message };
}
```

### Q3: 如何处理长文本？

**A**: 使用流式响应和分块处理：

```typescript
const stream = client.streamChatCompletion(messages);

let fullText = '';
for await (const chunk of stream) {
    fullText += chunk;
    
    // 如果文本太长，分批处理
    if (fullText.length > 1000) {
        processTextChunk(fullText.slice(0, 1000));
        fullText = fullText.slice(1000);
    }
}

// 处理剩余文本
if (fullText) {
    processTextChunk(fullText);
}
```

### Q4: 如何自定义Base URL？

**A**: 在构造函数中传入baseUrl：

```typescript
// 使用代理或私有部署
const client = new OpenAIProvider(
    apiKey,
    'gpt-4-turbo',
    'https://my-proxy.example.com/v1' // 自定义Base URL
);
```

### Q5: 如何监控API使用情况？

**A**: 通过数据库日志分析：

```typescript
// 查询成功/失败率
const logs = await db.getLogs(sessionId);
const successCount = logs.filter(log => log.success).length;
const totalCount = logs.length;
const successRate = successCount / totalCount;

// 查询错误类型
const errors = logs.filter(log => !log.success);
const errorTypes = errors.map(log => log.parse_error || 'unknown');
```

---

## 扩展指南

### 添加新的LLM提供商

1. **实现LLMClient接口**:

```typescript
export class NewProvider extends LLMClient {
    constructor(apiKey: string, model: string, baseUrl?: string) {
        super();
        // 初始化客户端
    }

    async chatCompletion(
        messages: UnifiedMessage[],
        tools?: BaseTool[],
        sessionId?: string,
        options?: any
    ): Promise<UnifiedMessage> {
        // 实现逻辑
    }

    async streamChatCompletion(
        messages: UnifiedMessage[],
        tools?: BaseTool[],
        sessionId?: string,
        options?: any
    ): AsyncGenerator<string, UnifiedMessage, unknown> {
        // 实现逻辑
    }

    async checkHealth(model?: string): Promise<boolean> {
        // 实现逻辑
    }
}
```

2. **处理消息格式转换**:
   - 将UnifiedMessage转换为提供商特定格式
   - 将提供商响应转换回UnifiedMessage

3. **添加日志记录**:
   - 使用`db.addLog`记录所有请求

4. **测试和验证**:
   - 确保与现有代码兼容
   - 测试工具调用功能

---

## 总结

`llm.ts` 文件是一个设计精良的LLM客户端抽象层，具有以下优点：

1. **统一接口**: 简化了多提供商支持
2. **功能完整**: 支持同步/流式、工具调用、多模态
3. **易于扩展**: 清晰的抽象和接口设计
4. **可观测性**: 完善的日志和监控
5. **错误处理**: 健壮的错误处理机制

该实现为AI Agent应用提供了强大而灵活的LLM交互能力，是整个系统的核心组件之一。

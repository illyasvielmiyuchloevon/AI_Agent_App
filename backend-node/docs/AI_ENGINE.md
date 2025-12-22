# AI Engine（后端统一 AI 能力层）设计与接口文档

本文档面向后续开发者，说明 AI Engine 的目标、运行方式、配置、路由策略、HTTP 接口以及与 Workspace/Session/工具系统的集成点。

## 1. 现状：AI Engine 是否“开发好”？

AI Engine 已实现并在后端启用，且前端已将“健康检查 + 聊天流式输出 + Git 提交信息生成”的模型调用切换为走 AI Engine 接口。

已具备的能力（MVP 可用）：
- 统一入口与能力划分：`chat` / `inline` / `editorAction` / `tools` / `embeddings`（见 `backend-node/src/ai-engine/contracts.ts`）
- 路由与降级：按 capability + 长文本阈值选择 provider/model，支持 fallback（见 `backend-node/src/ai-engine/router.ts`）
- 运行时配置：支持全局配置文件 + 请求级覆盖（见 `backend-node/src/ai-engine/config_store.ts`、`backend-node/src/ai-engine/ai_engine.ts`）
- HTTP 路由：`/ai/*`、`/ai-engine/*`（见 `backend-node/src/ai-engine/http.ts`，注册于 `backend-node/src/index.ts:39`）
- 聊天流式输出：直接输出 `text/plain` 片段；兼容现有前端解析 `[Executing ...]`（见 `backend-node/src/ai-engine/ai_engine.ts:106`、`backend-node/src/agent.ts:229`）
- 工具执行：独立工具执行入口 `POST /ai/tools`，可直接调用 ToolRegistry（见 `backend-node/src/ai-engine/tool_executor.ts`）
- 观测：基础 metrics 采样（见 `backend-node/src/ai-engine/metrics.ts`、`backend-node/src/ai-engine/ai_engine.ts:174`）

尚未覆盖/未完全产品化的部分（后续可迭代）：
- 统一 “session 管理/消息拉取/日志查询”等并入 AI Engine：当前仍由传统 `/sessions/*`、`/sessions/:id/messages`、`/sessions/:id/logs` 提供（见 `backend-node/src/index.ts:69` 起）
- Streaming 协议未做结构化事件（例如 SSE/JSON Lines），目前是 `text/plain` 直出
- tools/agent 运行状态的结构化事件与 UI 映射仍依赖文本标记（`[Executing ...]`）与前端推断
- 权限/多租户/鉴权未纳入设计（本仓库主要是本地 IDE 场景）

结论：AI Engine “核心实现 + 关键路径集成”已完成，可继续扩展成更完整的统一 AI 平台层。

## 2. 模块目标与边界

AI Engine 的目标：
- 前端与上层业务只面对稳定的 `/ai/*` 能力接口，不直接耦合具体 provider SDK、模型选择与路由策略
- 统一处理：模型路由、重试与降级、上下文构建、工具执行、日志与 metrics
- 支持多种能力形态：聊天、编辑器动作、inline 补全、向量 embeddings、独立工具调用

AI Engine 的边界：
- “会话列表/删除/重命名”等属于应用数据层（目前在 `db.ts` + `/sessions/*`），不强制迁入 AI Engine
- Workspace 文件系统/命令执行等由 ToolRegistry 提供，AI Engine 只是编排与统一入口

## 3. 总体架构与请求流

核心类：`AiEngine`（`backend-node/src/ai-engine/ai_engine.ts`）

### 3.1 Chat Stream 请求流

1) HTTP 入口：`POST /ai/chat/stream`（`backend-node/src/ai-engine/http.ts:19`）
2) Engine 处理：`AiEngine.chatStream()`（`backend-node/src/ai-engine/ai_engine.ts:106`）
3) 配置合并：`AiEngineConfigStore.get()` + `llmConfig`（请求体可选）进行合并（`backend-node/src/ai-engine/ai_engine.ts:109-110`）
4) 路由选择：`decideRoute()`（`backend-node/src/ai-engine/router.ts:56`）
5) 上下文构建：
   - 编辑器上下文摘要/outline（可选）
   - Project structure snapshot（可选，依赖 workspace root）
   - Session summary（当历史消息 > 20 时生成并缓存）
   见 `backend-node/src/ai-engine/context_manager.ts:68`
6) Agent 执行：`new Agent(client, sessionId, contextMaxLength)`，根据 mode 设置工具集（`backend-node/src/ai-engine/ai_engine.ts:122-140`、`backend-node/src/agent.ts:83`）
7) 流式输出：对每个 chunk 直接 `yield` 给 HTTP 层写回 `text/plain`
8) 观测落库：`db.addLog(sessionId, 'ai-engine', ...)`（`backend-node/src/ai-engine/ai_engine.ts:182`）

### 3.2 Workspace 绑定与上下文来源

后端在最前置中间件里，根据 Header 自动打开/绑定 workspace（`backend-node/src/index.ts:17-33`）：
- `X-Workspace-Id`：workspace id（可选）
- `X-Workspace-Root`（或兼容 `X-Project-Root`）：工作区根路径（常用）

绑定成功后会将 `{ id, root }` 写入 `workspaceContext`，供：
- `getWorkspaceRoot()`（`backend-node/src/context.ts`）读取
- 工具系统和 AI Engine 的上下文构建使用

### 3.3 上下文系统（Context System）

本项目里的“上下文系统”包含两层含义：
- LLM 的上下文窗口（token window）：由 `context_max_length` 控制，决定“整轮对话 + system prompt + tool 结果 + RAG 片段”等消息历史可保留的上限。
- 业务侧的上下文构建（context building）：将 IDE/Workspace 信息（当前文件、项目结构、RAG 命中片段等）组织到对话消息里，以提升模型对工程环境的感知。

#### 3.3.1 上下文在消息中的位置

不同能力（capability）把“上下文”放到不同的消息位置：

- Chat（`POST /ai/chat/stream` → `AiEngine.chatStream`）
  - system message：`systemPrompt + systemContext`
    - `systemPrompt`：由 mode 决定（`backend-node/src/core/prompts.ts` → `getPrompt()`）
    - `systemContext`：由后端拼接的 addendum（见下文“组成部分”），通过 `Agent.setSystemContext()` 注入（`backend-node/src/agent.ts:178-181`）
  - user message：用户输入 `req.message`
  - tool message：工具执行结果（role=`tool`）以消息形式追加到历史中（`backend-node/src/agent.ts:373-382`）

- Editor Action（`POST /ai/editorAction` → `AiEngine.editorAction`）
  - system message：固定指令（`You are an IDE editor assistant...`）
  - user message：由 `buildSystemContext()` 生成的摘要 + `Visible text:\n${req.editor.visibleText}` 拼接而成（`backend-node/src/ai-engine/ai_engine.ts:819-825`）
  - 说明：这里的“文件可见文本”不是 system context，而是放在 user message 里，避免 system message 过长且更贴近“输入材料”语义。

- Inline（`POST /ai/inline` → `AiEngine.inline`）
  - 与 editorAction 类似，只是 prompt 更偏向补全，并且 `maxChars` 更小（`backend-node/src/ai-engine/ai_engine.ts:785-791`）。

#### 3.3.2 Chat 的 systemContext 组成

Chat 流式链路里，systemContext 由三块拼接（`backend-node/src/ai-engine/ai_engine.ts:693-699`）：
- Session summary：当历史消息超过 20 条时，取“更早的消息”生成摘要并缓存（`backend-node/src/ai-engine/context_manager.ts:100-134`），最终以 `Session summary:\n...` 形式注入到 systemContext。
- RAG addendum：当开启 RAG 时，把向量检索到的代码片段作为“Retrieved snippets”注入到 systemContext（`backend-node/src/ai-engine/ai_engine.ts:669-690`）。
- Context addendum：IDE/Workspace 上下文摘要（`AiContextManager.buildSystemContext`），包含活动文件信息、选择区、selectedText 片段、file outline、project structure snapshot 等（`backend-node/src/ai-engine/context_manager.ts:68-98`）。

最终合成顺序为：Session summary → RAG addendum → Context addendum。

#### 3.3.3 读取的文件内容放在哪里？

取决于“哪一种读取方式”：
- 用户在编辑器里的“可见文本”（`editor.visibleText`）
  - Chat：不会自动把整段 `visibleText` 塞进 system context（`AiContextManager` 只用它生成 outline；`selectedText` 才会以片段形式进入 system context）。
  - EditorAction/Inline：会把 `visibleText` 明确拼到 user message（`backend-node/src/ai-engine/ai_engine.ts:787-791`、`819-825`）。
- 工具读取的文件内容（例如 `read_file`、`search_in_files`、`get_current_project_structure` 的内容片段）
  - 工具输出会作为 role=`tool` 的消息追加到 history（`backend-node/src/agent.ts:373-382`），属于“对话历史上下文”的一部分。
  - Anthropic 兼容：tool message 会被映射成 `tool_result` block（`backend-node/src/core/llm.ts:347-409` 附近）。
- RAG 检索命中的代码片段
  - RAG addendum 是把“片段文本 + file:line range”拼成字符串，再注入 systemContext（`backend-node/src/ai-engine/rag_index.ts:309-321`）。

#### 3.3.4 工具执行结果放在哪里？

工具执行结果不放在 systemContext，而是放在消息历史里：
- LLM 返回 `tool_calls`（OpenAI 风格 function call）后，`Agent` 逐个执行工具（`backend-node/src/agent.ts:318-382`）。
- 每次执行结果都会写入一条 role=`tool` 的消息，字段包含：
  - `tool_call_id`：关联到对应 tool call
  - `name`：工具名
  - `content`：序列化后的 JSON 字符串（`backend-node/src/agent.ts:370-378`）

因此“工具结果”属于可被 `trimHistory()` 管理的历史消息内容（`backend-node/src/agent.ts:242-269`），会随上下文窗口大小被保留/裁剪。

#### 3.3.5 RAG 构建的提示词放在哪里？

这里有两种形态：
- Chat 自动 RAG addendum（非工具调用）
  - `RagIndex.buildAddendum()` 会返回 `Relevant code snippets (retrieved): ...` 的纯文本（`backend-node/src/ai-engine/rag_index.ts:309-321`）
  - 该文本被注入到 systemContext（`backend-node/src/ai-engine/ai_engine.ts:693-699`），因此它是 system message 的一部分。
- Agent 工具式 RAG（Workspace Semantic Search Tool）
  - `WorkspaceSemanticSearchTool` 是一个工具（`backend-node/src/tools/rag_tools.ts`），执行结果以 role=`tool` 形式进入历史消息（同“工具执行结果”）。

#### 3.3.6 上下文预算与裁剪策略

系统主要有两类“预算/裁剪”：
- systemContext 的字符预算（避免 system message 过大）
  - Chat 里 `context_max_length`（tokens）会换算出 `systemContext` 的字符上限：
    - `approxChars = floor(context_max_length * 4 * 0.03)`（约占上下文窗口 3%）
    - 再做夹取：`max(6000, min(60000, approxChars))`
    - 实现：`backend-node/src/ai-engine/ai_engine.ts:getSystemContextMaxChars`
  - `AiContextManager.buildSystemContext()` 内部也会对最终拼接内容 `clip(..., maxChars)`（`backend-node/src/ai-engine/context_manager.ts:19-23`、`68-98`）。
- 历史消息裁剪（保证总 token 不超过窗口）
  - `Agent` 会根据 `contextMaxLength`（来自 `llmConfig.context_max_length`）估算 token 并裁剪历史（`backend-node/src/agent.ts:242-269`）。
  - 裁剪策略是：保留 system message，然后从最新消息向前保留，直到触达上限。

## 4. 配置体系

AI Engine 配置分两层：

### 4.1 全局运行时配置（Config Store）

默认配置文件路径（Windows）：
- `%APPDATA%\.aichat\global\ai_engine_config.json`
- 或 `%LOCALAPPDATA%\.aichat\global\ai_engine_config.json`

读取与热更新：
- 启动时 `loadOnce()`，随后 `watch()` 文件变更（`backend-node/src/ai-engine/config_store.ts:40-55`）

配置字段定义见：
- `backend-node/src/ai-engine/runtime_config.ts`

支持的 provider（见 `backend-node/src/ai-engine/llm_factory.ts:13-15`）：
- OpenAI 兼容：`openai` / `openrouter` / `xai` / `ollama` / `lmstudio`
- 原生：`anthropic`

关键字段示例：
```json
{
  "env": "dev",
  "defaultProvider": "openai",
  "providers": {
    "openai": {
      "defaultPoolId": "default",
      "pools": {
        "default": { "apiKey": "sk-...", "baseUrl": "https://api.openai.com/v1" }
      }
    },
    "anthropic": {
      "defaultPoolId": "default",
      "pools": {
        "default": { "apiKey": "sk-...", "baseUrl": "https://api.anthropic.com" }
      }
    },
    "openrouter": {
      "defaultPoolId": "default",
      "pools": {
        "default": { "apiKey": "sk-...", "baseUrl": "https://openrouter.ai/api/v1" }
      }
    }
  },
  "defaultModels": {
    "general": "gpt-4o-mini",
    "fast": "gpt-4o-mini",
    "reasoning": "gpt-4o",
    "embeddings": "text-embedding-3-small",
    "tools": "gpt-4o-mini"
  },
  "thresholds": { "longTextChars": 12000 },
  "retries": { "maxAttempts": 2, "baseDelayMs": 250 },
  "routing": {
    "chat": [{ "provider": "anthropic", "model": "claude-3-5-sonnet-latest", "tags": ["preferred"] }]
  }
}
```

说明：
- `providers[provider].pools` 支持配置多个“实例池”（例如多账号/多 endpoint），路由目标可用 `poolId` 指定具体池（见 `backend-node/src/ai-engine/llm_factory.ts:20-37`、`backend-node/src/ai-engine/contracts.ts:90-95`）。
- 兼容旧写法：如果全局配置仍使用 `{ "apiKey": "...", "baseUrl": "..." }` 的扁平结构，也会在 `normalizeRuntimeConfig()` 中自动归一化成 `pools.default`（`backend-node/src/ai-engine/runtime_config.ts:39-65`）。

### 4.2 请求级覆盖（llmConfig）

部分接口支持携带 `llmConfig`，用于在本次请求覆盖 provider key/baseUrl/model 等（便于前端从本地设置传入）。

合并逻辑见 `backend-node/src/ai-engine/ai_engine.ts:32-99`，可覆盖：
- `provider`：将其写入 `defaultProvider`
- `pool_id`：将其写入 `providers[provider].defaultPoolId`（当同时提供 `api_key` 时）
- `api_key`、`base_url`：写入到 `providers[provider].pools[pool_id]`
- `model`：写入 `defaultModels.general`
- `check_model`：用于健康检查时的 `model` 覆盖（`backend-node/src/ai-engine/ai_engine.ts:153-161`）
- `default_models`：按能力覆盖 `defaultModels`（`general/fast/reasoning/tools/embeddings`）
- `routing`：按 capability 覆盖 `cfg.routing`（支持 `chat/inline/editorAction/tools/embeddings`，每个 capability 是 `AiRouteTarget[]`）
- 以及聊天请求中的 `context_max_length`、`output_max_tokens`、`temperature`、`top_p` 等参数（由 `Agent` 传给 LLM client）

### 4.3 前端 Provider/模型设置与 llmConfig 映射

前端的 Provider 与模型设置主要由两部分组成：
- 工作区级配置：保存于工作区根目录的 `.aichat/config.json`（写入逻辑：`frontend/src/App.jsx:1202-1213`）
- UI 临时/全局配置：保存于 `localStorage`（`GLOBAL_CONFIG_STORAGE_KEY`，见 `frontend/src/App.jsx:92-126`）

核心映射函数是 `getBackendConfig()`（`frontend/src/App.jsx:595-639`），它会把“当前选中的 Provider + 活动实例（instance）”转换成请求级 `llmConfig`：
- `provider`：当前 provider id
- `pool_id`：当前实例 id（等价后端的 poolId）
- `api_key`、`base_url`：来自当前实例（用于本次请求覆盖/补齐后端 Config Store）
- `default_models`：从 UI 的“按能力默认模型”生成，缺省会从 `model/check_model` 兜底
- `routing`：将 UI 的 routing map 归一化为 `routing[capability] = [AiRouteTarget]`

所有 AI Engine 的前端调用最终都把该 `llmConfig` 透传给后端（例如 `frontend/src/utils/aiEngineClient.js:67-133`）。

## 5. 路由策略（provider/model 选择）

入口：`decideRoute(req, cfg)`（`backend-node/src/ai-engine/router.ts:56`）

优先级：
1) `cfg.routing[capability]` 显式指定（可配置多个，作为 primary + fallbacks）
2) 否则使用 `cfg.defaultProvider` + `pickModelForCapability()` 推导的 model role
3) 若文本很长（`sizeHint >= thresholds.longTextChars`），优先切到 anthropic（若配置了 key），并把原 primary 作为 fallback

capability 到模型 role 的映射（默认）：
- `inline` -> `fast`
- `editorAction` -> `reasoning`
- `embeddings` -> `embeddings`
- `tools` -> `tools`
- 其他 -> `general`

## 6. HTTP 接口（/ai/* 与 /ai-engine/*）

说明：
- 这些路由由 `registerAiEngineRoutes()` 注册（`backend-node/src/ai-engine/http.ts`）
- 当前实现为本地 IDE 场景，未增加鉴权

### 6.1 `POST /ai-engine/models/list`

用途：拉取某个 provider 的“可选模型列表”，用于前端下拉选择与联调校验。

请求体：
```json
{
  "provider": "openai | openrouter | xai | ollama | lmstudio | anthropic",
  "api_key": "optional",
  "base_url": "optional"
}
```

响应：
```json
{ "ok": true, "models": ["..."] }
```
失败时：
```json
{ "ok": false, "detail": "..." }
```

行为差异（实现：`backend-node/src/ai-engine/http.ts:11-51`）：
- `anthropic`：不支持 model listing，返回空列表并提示手动配置
- `ollama`：请求 `http://<host>:11434/api/tags` 获取已拉取的模型名称
  - 如果 `base_url` 形如 `http://localhost:11434/v1`，会自动剥离 `/v1` 后再请求 `/api/tags`
- 其他 OpenAI 兼容 provider：需要 `api_key`，使用 OpenAI SDK `client.models.list()` 返回 `id` 列表

前端调用入口：`frontend/src/utils/aiEngineClient.js:58-65`。

### 6.2 `POST /ai-engine/health`

用途：检查当前配置下模型可用性。

请求体：可选，传运行时覆盖配置（`llmConfig` 形式的扁平字段也可；内部会按 `mergeRuntimeConfig` 解析）

响应：
```json
{ "ok": true }
```
失败时：
```json
{ "ok": false, "detail": "..." }
```

对应实现：`backend-node/src/ai-engine/http.ts:10`、`backend-node/src/ai-engine/ai_engine.ts:97`

### 6.3 `POST /ai/chat/stream`

用途：聊天/Agent 模式统一流式接口。

请求体（字段来自 `AiChatRequest`，见 `backend-node/src/ai-engine/contracts.ts:34`）：
```json
{
  "requestId": "optional",
  "sessionId": "optional but recommended",
  "workspaceRoot": "optional",
  "message": "user text",
  "mode": "chat | plan | canva | agent",
  "attachments": [{ "name": "a.txt", "contentType": "text/plain", "size": 123 }],
  "toolOverrides": ["read_file", "execute_shell"],
  "editor": {
    "filePath": "src/App.jsx",
    "languageId": "javascript",
    "visibleText": "..."
  },
  "llmConfig": { "provider": "openai", "api_key": "...", "model": "..." }
}
```

响应：
- `Content-Type: text/plain`
- Body 为流式文本片段（chunk），可包含工具执行标记：
  - `\n[Executing <tool_name>...]\n`
  - 该标记由 `Agent` 在调用工具时输出（`backend-node/src/agent.ts:229-231`）

对应实现：`backend-node/src/ai-engine/http.ts:19`、`backend-node/src/ai-engine/ai_engine.ts:106`

### 6.4 `POST /ai/inline`

用途：IDE inline completion。

请求体：`AiInlineRequest`（`backend-node/src/ai-engine/contracts.ts:44`）

响应：`AiInlineResponse`，形如：
```json
{
  "requestId": "...",
  "capability": "inline",
  "route": { "provider": "openai", "model": "gpt-4o-mini" },
  "latencyMs": 12,
  "suggestions": [{ "text": "..." , "kind": "insert" }]
}
```

### 6.5 `POST /ai/editor-action`

用途：编辑器动作（重构/解释/优化等）。

请求体：`AiEditorActionRequest`（`backend-node/src/ai-engine/contracts.ts:53`）
- `action`: `refactor | explain | optimize`
- `instruction`: 指令文本
- `editor.visibleText`: 必填（当前实现以可见文本为主要上下文）

响应：`AiEditorActionResponse`（当前实现主要返回 `content`，未生成结构化 edits）

### 6.6 `POST /ai/tools`

用途：直接调用工具系统（不经 Agent 编排）。

请求体：`AiToolsRequest`（`backend-node/src/ai-engine/contracts.ts:61`）
```json
{ "toolName": "read_file", "args": { "path": "..." }, "sessionId": "..." }
```

响应：`AiToolsResponse`：
```json
{ "requestId": "...", "capability": "tools", "route": { "provider": "openai" }, "latencyMs": 3, "result": { } }
```

工具注册表见：`backend-node/src/ai-engine/tool_executor.ts`

### 6.7 `POST /ai/embeddings`

用途：文本向量化。

请求体：`AiEmbeddingsRequest`（`backend-node/src/ai-engine/contracts.ts:67`）

响应：`AiEmbeddingsResponse`：
```json
{ "vectors": [[0.1, 0.2, ...]] }
```

## 7. 兼容旧接口（/sessions/:id/chat）

历史接口仍存在：`POST /sessions/:id/chat`（`backend-node/src/index.ts:174`）
- 内部直接调用 `aiEngine.chatStream(...)`
- 因此旧接口与新 `/ai/chat/stream` 在能力上等价（但路径不同）

建议：后续逐步让前端只依赖 `/ai/*`；保留旧接口用于兼容或过渡。

## 8. 日志与 metrics

### 8.1 DB 日志

当 `sessionId` 存在时，AI Engine 会写入日志：
- provider：`ai-engine`
- method：`chat`
- 额外信息：requestId、route、decision

实现：`backend-node/src/ai-engine/ai_engine.ts:182-195`

### 8.2 Metrics

指标接口：`GET /ai-engine/metrics`（`backend-node/src/ai-engine/http.ts:6`）
- 输出为 `engine.getMetrics()` 的快照

## 9. 开发与测试

后端构建：
- `npm run build`（TypeScript 编译）

后端自检：
- `npm test`
  - `src/verify_tools.ts`
  - `src/verify_ai_engine.ts`（路由决策、配置读取、性能基准）

前端联调（Dev Server）：
- 通过 Vite proxy 将 `/api/*` 转发到后端，并 rewrite 去掉 `/api`
- 因此前端请求 `/api/ai/chat/stream` 实际命中后端 `/ai/chat/stream`

## 10. 后续扩展建议（Roadmap）

建议优先级：
1) Streaming 协议结构化（SSE/JSON Lines），替代 `[Executing ...]` 文本标记
2) 增加 `editorAction` 返回 `edits[]` 并与前端编辑器/工作区应用联动
3) 将 session/消息/日志接口封装为 “AI Engine Session API” 层（避免业务层直连 db）
4) 将 toolOverrides 与权限策略统一：按 workspace、mode、用户设置做白名单与审计

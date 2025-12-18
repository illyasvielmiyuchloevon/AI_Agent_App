# IDE 软件架构与设计文档

本文档详细介绍了当前 IDE 的软件架构、核心组件设计以及数据流向。

## 1. 架构概览

当前 IDE 采用 **Electron + React** 的架构模式，正在经历从"后端绑定模式"向"本地优先 (Local-First)" 模式的转型。

*   **前端 (Renderer Process)**: 基于 React构建，负责所有 UI 渲染、状态管理和业务逻辑。
*   **中间层 (Electron Preload/Main)**: 提供系统级能力（文件系统访问、Git 命令执行、Shell 交互）。
*   **后端 (Node.js Server - Legacy)**: 旧架构中的核心组件，目前仅作为辅助或逐渐废弃，核心能力已迁移至前端和 Electron 层。

### 架构分层图

```mermaid
graph TD
    subgraph "Renderer Process (Frontend)"
        App[App.jsx (Root Orchestrator)]
        WSM[Workbench State Machine]
        WC[Workspace Controller]
        UI[UI Components]
        Driver[LocalWorkspaceDriver]
    end

    subgraph "Bridge (Preload API)"
        E_FS[electronAPI.fs]
        E_Git[electronAPI.git]
        E_Shell[electronAPI.shell]
    end

    subgraph "Main Process (Electron)"
        NativeFS[Node.js FS]
        NativeGit[Git Executable]
        NativePty[Node-Pty]
    end

    UI --> WC
    WC --> WSM
    WC --> Driver
    Driver -->|Browser Native| FileSystemAccessAPI
    Driver -->|System Ops| E_FS
    UI -->|Git Ops| E_Git
    E_Git --> NativeGit
```

## 2. 核心组件设计

### 2.1 根协调器 (App.jsx)
`App.jsx` 是整个应用的入口和状态协调中心。它不直接处理复杂的业务逻辑，而是将职责委托给专门的控制器和组件。
*   **职责**: 布局管理 (`WorkbenchShell`)、全局状态分发、顶层事件处理。
*   **主要子组件**: `NavSidebar`, `SessionDrawer`, `ExplorerPanel`, `EditorArea`, `TitleBar`。

### 2.2 工作区控制器 (Workspace Controller)
`workbench/workspace/workspaceController.js` 封装了工作区生命周期的核心逻辑。
*   **职责**:
    *   打开/关闭工作区。
    *   管理 "Welcome" 页面的显示逻辑。
    *   同步最近打开的项目列表。
    *   在 `LocalWorkspaceDriver` 和 `BackendWorkspaceDriver` 之间进行调度（目前优先使用 Local）。

### 2.3 工作区驱动 (Workspace Drivers)
驱动层实现了标准化的文件系统操作接口，屏蔽了底层存储差异。
*   **LocalWorkspaceDriver**: 核心驱动。利用浏览器 `FileSystemAccessAPI` (或 Electron 桥接) 直接操作用户本地文件。
*   **BackendWorkspaceDriver**: 遗留驱动。通过 HTTP 请求与后端服务通信（正在逐步淘汰）。

### 2.4 状态机 (Workbench State Machine)
`workbench/workbenchStateMachine.js` 使用 Reducer 模式管理 IDE 的生命周期状态。
*   **状态枚举**:
    *   `BOOTING`: 启动中。
    *   `NO_WORKSPACE`: 无打开项目。
    *   `OPENING_WORKSPACE`: 正在加载项目。
    *   `WORKSPACE_READY`: 项目加载完成，IDE 可用。
    *   `WORKSPACE_ERROR`: 加载失败。

## 3. 关键模块实现

### 3.1 Git 版本控制
Git 功能完全由前端驱动，通过 Electron IPC 调用底层 Git 命令。
*   **UI 层**: `SourceControlPanel.jsx` 提供可视化界面（暂存、提交、推送、历史图谱）。
*   **逻辑层**: `GitDriver.js` 封装具体的 Git 命令调用（`git status`, `git commit` 等）。
*   **通信层**: `window.electronAPI.git` 暴露给前端的安全接口。

### 3.2 国际化 (I18n)
`utils/i18n.js` 提供简单的多语言支持。
*   支持语言: English (en), 中文 (zh), 日语 (ja)。
*   实现方式: 简单的键值对映射，UI 组件通过 `language` 属性获取当前语言并渲染对应文本。

### 3.3 布局系统
*   **WorkbenchShell**: 提供基础的主题容器。
*   **Flex 布局**: `App.jsx` 使用 Flexbox 管理侧边栏、编辑器区域和面板的自适应排列。
*   **Resize**: 支持面板拖拽调整大小。

### 3.4 编辑器 AI 集成（Monaco）

编辑器内 AI 主要覆盖两类能力：
1) **Editor Action（编辑器动作）**：解释/审阅/重写/优化/生成测试/按指令修改等，面向“当前文件或选区”输出结果，并可一键应用到编辑器。
2) **Inline（行内补全）**：基于可见文本的续写式补全（当前实现由后端提供统一能力，前端可按需接入）。

#### 3.4.1 触发入口

编辑器动作通过 Monaco Action 注册到右键菜单与快捷键（`frontend/src/components/Workspace.jsx:568-593`）：
- `Ctrl/Cmd + Alt + E`：解释（`explain`）
- `Ctrl/Cmd + Alt + T`：生成单元测试（`generateTests`）
- `Ctrl/Cmd + Alt + O`：优化（`optimize`）
- `Ctrl/Cmd + Alt + C`：生成注释（`generateComments`）
- `Ctrl/Cmd + Alt + R`：审阅（`review`）
- `Ctrl/Cmd + Alt + W`：重写（`rewrite`）
- `Ctrl/Cmd + Alt + M`：按指令修改（`modify`，会先弹出输入框）
- `Ctrl/Cmd + Alt + D`：生成文档（`generateDocs`）

当用户产生“非空选区”时，会计算光标位置并显示一个轻量的 Inline AI 触发按钮（用于交互入口与可发现性），逻辑在 `frontend/src/components/Workspace.jsx:604-633`。

#### 3.4.2 上下文快照（Editor Snapshot）

前端对 Monaco 的运行态进行一次“轻量快照”，并将快照作为请求体的一部分传给后端：
- `filePath`、`languageId`、光标位置
- `selection`（起止行列）
- `selectedText`（裁剪到 8000 字符）
- `visibleText`（裁剪到 14000 字符，作为主要上下文来源）

实现见 `getEditorSnapshot()`：`frontend/src/components/Workspace.jsx:354-392`。

之所以以 `visibleText` 为主，是为了降低 token 成本并尽量让模型聚焦用户当前视窗范围；后端会基于该上下文补充“文件 outline / 项目结构摘要”等系统上下文（见 `backend-node/src/ai-engine/context_manager.ts:68-98`）。

#### 3.4.3 指令构建（Instruction Builder）

前端根据动作类型与是否存在选区，生成稳定且可预期的中文指令模板（`frontend/src/components/Workspace.jsx:394-438`）。其中：
- 选区存在时：要求“输出可直接替换选中代码的新实现”
- 无选区时：要求“输出修改后的完整文件内容”
- `modify` 动作为开放指令：会拼接用户输入的自然语言约束

这套约束是为了让“可应用（apply）”的结果尽量稳定：选区替换使用代码块/纯文本，文件替换要求全量输出。

#### 3.4.4 调用链与协议

调用链（前端 -> 后端）：
- `Workspace` 组装 `instruction + editor snapshot + llmConfig` 后发起请求：`frontend/src/components/Workspace.jsx:440-517`
- 统一 HTTP client：`frontend/src/utils/aiEngineClient.js:52-134`
- 后端路由入口：`POST /ai/editor-action`（Vite 会通过 `/api` 代理）：`backend-node/src/ai-engine/http.ts:86-94`
- 请求/响应契约：`AiEditorActionRequest`、`AiEditorActionResponse`：`backend-node/src/ai-engine/contracts.ts:62-136`

请求体的关键字段：
- `action`: 动作类型（如 `rewrite`/`review`/`modify`）
- `instruction`: 前端构建的动作指令
- `editor.visibleText`: 必填（后端将其作为核心上下文）
- `llmConfig`: 可选（承载 Provider/模型/路由/实例池等设置，详见 Provider 文档）

后端的 `editorAction()` 当前返回形态以 `content` 为主（`backend-node/src/ai-engine/ai_engine.ts:291-317`）。契约里虽然预留了 `edits?: AiEditorEdit[]`，但当前实现未生成结构化 edits。

#### 3.4.5 结果展示与应用（Apply）

前端会将 AI 返回内容展示在一个可操作的面板中（`aiPanel`），并根据动作 + 是否选区决定是否允许“应用到选区/应用到文件”（`frontend/src/components/Workspace.jsx:457-506`）。

应用策略：
- 仅对 `optimize`、`generateComments`、`rewrite`、`modify` 这类“会产出可替换代码”的动作提供 Apply（`applyActions` 集合，见 `frontend/src/components/Workspace.jsx:339`）
- 应用前会尝试提取响应中的第一个 Markdown 代码块；如果没有代码块，则使用原文本（`extractFirstCodeBlock()`：`frontend/src/components/Workspace.jsx:347-352`）
- 应用到选区：以 Monaco `executeEdits` 替换选区范围（`frontend/src/components/Workspace.jsx:539-551`）
- 应用到文件：构造整文件 range 并替换（`frontend/src/components/Workspace.jsx:553-566`）

当前设计的关键取舍：
- 以“文本替换”作为 MVP，避免引入复杂的结构化 patch 协议与冲突处理
- 结构化 `edits[]` 已在后端契约预留，未来可升级为“多处编辑/跨文件 edits”，并与工作区文件系统联动

### 3.5 Provider 与模型配置（前端）

前端的 Provider 与模型配置需要同时满足两个目标：
1) 面向用户：在 UI 中可编辑、可持久化、支持多个实例（多账号/多 endpoint）。
2) 面向后端：每次调用 AI Engine 时，都能把“当前生效的 provider/实例/模型/路由”映射成请求级 `llmConfig` 并透传。

#### 3.5.1 存储位置与作用域

- **全局（跨工作区）**：`localStorage`（`GLOBAL_CONFIG_STORAGE_KEY`，见 `frontend/src/App.jsx:92-126`）
  - 用于记住用户常用的 Provider 设置与 UI 偏好（例如 Settings 显示方式）。
- **工作区级（跟随项目）**：工作区根目录 `.aichat/config.json`（自动保存逻辑见 `frontend/src/App.jsx:1202-1213`）
  - 用于项目相关的配置（例如 `backendRoot`、`workspaceId`、`toolSettings` 等）以及当前项目默认采用的 provider/模型。

#### 3.5.2 多实例（Instance）与当前生效实例

每个 provider 的配置支持 `instances[]` 与 `active_instance_id`：
- `instances[]`：多个 endpoint/账号组合（`api_key` + `base_url`）
- `active_instance_id`：指向当前生效的实例 id

UI 与编辑逻辑在 `frontend/src/components/ConfigPanel.jsx`；初始化与归一化逻辑在 `frontend/src/App.jsx:371-436`。

#### 3.5.3 默认模型（按能力）与路由（Routing）

除了 provider 的 `model/check_model`，前端还维护一份按能力划分的默认模型 `default_models`（`general/fast/reasoning/tools/embeddings`），并支持 `routing` 针对不同 capability 指定 provider/model/pool。

关键映射在 `getBackendConfig()`（`frontend/src/App.jsx:595-639`）：
- 组合当前 provider + 活动实例，输出 `provider/pool_id/api_key/base_url`
- 将 `default_models` 透传为后端可合并的 `default_models`
- 将前端的 `routing` map 归一化成后端需要的 `routing[capability] = [AiRouteTarget]`（数组形式）

#### 3.5.4 模型列表获取（Model List）

Settings 中可通过按钮触发模型列表获取并下拉选择（`frontend/src/components/ConfigPanel.jsx`）：
- 前端调用：`aiEngineClient.listModels()`（`frontend/src/utils/aiEngineClient.js:58-65`）
- 后端入口：`POST /ai-engine/models/list`（`backend-node/src/ai-engine/http.ts:11-51`）
- 行为差异：Ollama 走 `/api/tags`；OpenAI 兼容 provider 走 `models.list()`；Anthropic 需要手动配置

## 4. 数据流向

1.  **用户操作**: 用户点击 "打开文件夹"。
2.  **Controller**: `workspaceController` 接收请求，调用 `LocalWorkspaceDriver.pickFolder()`。
3.  **Driver**: 唤起系统文件选择器，获取文件句柄。
4.  **State Machine**: 状态流转 `NO_WORKSPACE` -> `OPENING_WORKSPACE` -> `WORKSPACE_READY`。
5.  **UI Update**: `App.jsx` 监听到状态变化，渲染 `ExplorerPanel` 和 `EditorArea`。
6.  **Persistence**: 工作区配置（如最近打开的文件）通过 `useEffect` 自动保存到 `.aichat/config.json` 或 `localStorage`。

## 5. 功能对比与状态矩阵 (Benchmark vs VS Code)

下表对比了本 IDE 与主流编辑器 (VS Code / Xcode) 的核心功能实现情况。

| 功能模块 | 细分功能 | 状态 | 说明 |
| :--- | :--- | :--- | :--- |
| **核心编辑器** | 语法高亮 | ✅ 已实现 | 基于 Monaco Editor，支持主流语言 |
| | 智能补全 (IntelliSense) | ⚠️ 基础支持 | 仅包含 Monaco 内置的 JS/TS 基础补全，无完整 LSP 支持 |
| | 多标签页 (Tabs) | ✅ 已实现 | 支持多文件同时打开与切换 |
| | 拆分视图 (Split View) | ⚠️ 部分实现 | 仅在 Diff 模式下支持双栏对比，常规编辑暂不支持自定义拆分 |
| | 小地图 (Minimap) | ✅ 已实现 | |
| **文件管理** | 资源管理器 | ✅ 已实现 | 支持文件/文件夹的增删改名操作 |
| | 全局搜索 (Find in Files) | ❌ 未实现 | 目前仅支持文件名过滤，不支持全文检索 |
| | 文件监听 (File Watcher) | ✅ 已实现 | 自动同步外部对文件的更改 |
| **版本控制** | 基础操作 (Commit/Stage) | ✅ 已实现 | 支持暂存、提交、撤销等核心流 |
| | 历史记录 (Git Graph) | ✅ 已实现 | 可视化提交图谱 |
| | 分支管理 | ⚠️ 待完善 | 目前仅显示当前分支，不支持分支切换/创建 |
| | 冲突解决 | ❌ 未实现 | 缺乏 3-way Merge 界面 |
| **集成终端** | 内置终端 (Terminal) | ❌ 未开发 | 无内置 Shell 交互界面 |
| **调试能力** | 断点/单步调试 | ❌ 未开发 | 不支持 DAP (Debug Adapter Protocol) |
| **扩展系统** | 插件市场 | ❌ 未开发 | 不支持第三方扩展 |
| **AI 能力** | 对话/Agent | ✅ 核心优势 | 深度集成的 Chat/Plan/Agent 模式，优于传统 IDE 插件 |

## 6. 设计原则

*   **本地优先 (Local-First)**: 用户数据（代码、配置）主要存储在本地文件系统，而非云端或后端数据库。
*   **组件化**: UI 拆分为独立的 React 组件，职责单一。
*   **解耦**: 业务逻辑（Controller）与 UI 展示分离，文件操作（Driver）与业务逻辑分离。

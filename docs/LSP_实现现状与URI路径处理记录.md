# LSP 实现现状与 URI/路径处理问题记录（AI Agent App / Electron）

本文档包含三部分内容：

1. **URI 转换与路径处理的历史问题与修复方案**（包含根因、复现形态、修复点与建议实践）
2. **LSP 技术与本仓库实现的关键概念**（协议、能力协商、取消、动态注册、多根工作区等）
3. **当前 IDE 的 LSP 实现对标分析**（与 VS Code 的差距、插件安装/启动/使用是否可靠、已支持能力与缺失清单）

---

## 1. URI 转换与路径处理：问题与解决方案

本仓库同时存在两类“路径”表示：

- **文件系统路径（fsPath）**：Windows 下例如 `C:\Users\me\project\src\index.ts`；POSIX 下例如 `/Users/me/project/src/index.ts`
- **文件 URI（file URI）**：例如 `file:///C:/Users/me/project/src/index.ts`（Windows）、`file:///Users/me/project/src/index.ts`（POSIX）

此外还会出现 **Monaco/URL 的字符串化差异**，导致 `file:/...`（单斜杠）等非规范表现。

### 1.1 问题 A：语言服务器用 Electron.exe 启动导致 “Connection closed”

**现象**

- 启动 LSP Server 时，日志里 command 变成 Electron 自身（`electron.exe`），随后 stdio 连接在初始化阶段被关闭：
  - 典型错误：`server closed stdio connection during startup (exited early)`

**根因**

- 插件 manifest 里常用 `${NODE}` 表示“Node 可执行文件路径”（例如运行 `typescript-language-server`、`pyright`）。
- 在 Electron 主进程中，`process.execPath` 是 `electron.exe`，不是 node.exe。
- 如果用 Electron 当作 Node 启动子进程，需要注入环境变量 `ELECTRON_RUN_AS_NODE=1`，否则 Electron 以 GUI 模式启动，stdio/入口脚本行为不符合预期。

**修复方案**

- 在语言插件解析 transport 时，如果在 Electron 环境下发现 command 解析为 `process.execPath`（或 `node`），则自动注入 `ELECTRON_RUN_AS_NODE=1` 并确保 command 使用 `process.execPath`。

**对应实现**

- 解析与注入逻辑在：
  - `electron/main/lsp/plugins/LanguagePluginManager.js`
    - `resolveServerConfigs()` 内对 Electron 的兼容处理（注入 `ELECTRON_RUN_AS_NODE`）
- 官方 catalog 的 TSLS/pyright 都通过 `${NODE}` + `${PLUGIN_DIR}` 组合指定启动入口：
  - `electron/main/lsp/plugins/officialCatalog.json`

### 1.2 问题 B：`file:/...` 混入 fsPath 拼接导致 “Path contains invalid characters”

**现象**

- JSON-RPC `workspace/executeCommand`（以及一些编辑/跳转场景）报错：
  - `Path contains invalid characters: c:/Users/.../1112/file:/todo-app/src`
- 可以看出 **根路径** `c:/Users/.../1112` 与一个 **URI 字符串** `file:/todo-app/src` 被错误拼接成了一个“伪路径”。

**根因**

- 前端的 `resolveFsPath(rootFsPath, modelPath)` 负责把 Monaco 的 `modelPath` 转换成磁盘路径。
- 但 `modelPath` 在某些场景下可能是 `file:` URI（例如 `file:/todo-app/src`），而不是工作区相对路径。
- 旧逻辑把 `modelPath` 当相对路径直接拼接到 `rootFsPath`，导致出现 `.../file:/...` 这类非法字符路径。

**修复方案**

- `resolveFsPath` 需要识别 `file:` URI 并先转换为 fsPath，再返回真实路径，避免拼接。
- 同时，前端 `fileUriToFsPath` 与 Electron 主进程侧的 workspace normalize 也需要接受 `file:`（不只是 `file://`），并尽量 canonicalize 为规范 `file:///...`。

**对应实现**

- 前端：
  - `frontend/src/lsp/adapters/toLsp.js`
    - `resolveFsPath()`：新增对 `file:` URI 的识别与转换（含 Windows/UNC 处理）
  - `frontend/src/workbench/services/lspService.js`
    - `fileUriToFsPath()`：改为接受所有 `file:` 开头的 URI，并支持 `file://hostname/...` → UNC
- Electron 主进程：
  - `electron/main/lsp/LspMainService.js`
    - `normalizeWorkspaceFromRenderer()`：将传入的 `file:` rootUri/folder.uri canonicalize
    - `resolveFileFsPath()`：接受 `file:`（不只是 `file://`）

### 1.3 问题 C：LSP Cancel 是正常行为，但被当作“错误栈”打印

**现象**

- 出现类似日志：
  - `Error occurred in handler for 'lsp:codeAction': CancelledError: textDocument/codeAction cancelled`
- 这通常发生在用户继续输入/移动光标，Monaco 取消了上一次尚未返回的请求。

**根因**

- Monaco 的 provider token 会触发取消，前端会调用 `bridge.cancel(cancelToken)`。
- Electron 主进程 IPC handler 未对 `CancelledError` 做降噪处理，导致取消也被当成错误输出。

**修复方案**

- Electron IPC handler 对 `CancelledError` 做吞掉处理：
  - `lsp:codeAction` 被取消时返回 `[]`
  - `lsp:codeActionResolve` 被取消时返回 `null`

**对应实现**

- `electron/main/lsp/LspMainService.js`：`isCancelledError()` + try/catch 包裹 `manager.codeAction` / `manager.codeActionResolve`

---

## 2. LSP 技术要点（结合本仓库实现）

### 2.1 LSP 是什么

Language Server Protocol（LSP）是一个 **编辑器（客户端）** 与 **语言服务器（服务端）** 之间的协议：

- 传输层通常是 `stdio`、`socket`、`pipe` 等
- 应用层是 JSON-RPC 2.0
- 两端通过 `initialize` / `initialized` 协商 capabilities，然后通过 `textDocument/*`、`workspace/*` 等方法交互

### 2.2 本仓库的分层结构

**Electron 主进程（LSP Client Core）**

- `electron/main/lsp/LspMainService.js`
  - Electron IPC 入口（`lsp:*`）与 renderer 通信
  - 负责：
    - workspace/root/folder normalize
    - 将请求路由到 `LspManager`
    - 将 server->client 事件广播回 renderer（diagnostics/log/progress/status/capabilities/applyEdit）
- `electron/main/lsp/LspManager.js`
  - 维护 server 生命周期、workspace settings、URI 映射、多根目录、动态注册、watch files
  - 将 client 参数转换为 server 参数（路径/URI、position encoding）
  - 将 server 返回再转换回 client 侧语义（例如位置编码与 URI 映射）
- `electron/main/lsp/LspServerProcess.js`
  - 单个 language server 的进程与 JSON-RPC 连接
  - 负责初始化握手、能力集缓存、处理 server->client 请求（例如 applyEdit、registerCapability）
- `electron/main/lsp/jsonrpc/*`
  - JSON-RPC 连接、pending request、取消与超时
- `electron/main/lsp/transport/StdioTransport.js`
  - 目前仅实现 **stdio transport**（通过 `spawn` 启动）

**Renderer（Monaco 集成层）**

- `frontend/src/lsp/LspUiBridge.js`
  - 对 `window.electronAPI.lsp` 的薄封装（renderer -> main）
- `frontend/src/workbench/services/lspService.js`
  - 将 Monaco 的 language feature provider 与 LSP 请求绑定
  - 负责：
    - `didOpen/didChange/didClose/didSave` 等文档同步
    - completion/hover/definition/... 等 provider 的实现
    - 将 LSP WorkspaceEdit 应用到 Monaco model / UI 文件系统
- `frontend/src/lsp/adapters/*`
  - `toLsp.js` / `fromLsp.js`：Monaco ↔︎ LSP 的结构转换（range/position/URI）

### 2.3 取消（Cancellation）

本仓库有两层取消机制：

- **Monaco token 取消**：provider 的 `token.onCancellationRequested` 触发
- **LSP `$/cancelRequest`**：通过 JSON-RPC 通知 server 取消指定 request id

实现路径：

- 前端 provider 在 token 取消时调用 `bridge.cancel(cancelToken)`（`frontend/src/workbench/services/lspService.js`）
- 主进程 `lsp:cancel` 调用 `LspManager.cancel(token)`（`electron/main/lsp/LspMainService.js` / `electron/main/lsp/LspManager.js`）
- `JsonRpcConnection` 收到 cancelToken 时会发送 `$/cancelRequest` 并 reject 为 `CancelledError`（`electron/main/lsp/jsonrpc/JsonRpcConnection.js`）

### 2.4 动态注册（Dynamic Registration）

服务器在运行时可请求客户端注册/注销能力（`client/registerCapability` / `client/unregisterCapability`）。

本仓库将动态注册结果合并到“有效 capabilities”，并在变化时通知 renderer：

- `LspManager._onRegisterCapability()` / `_onUnregisterCapability()`
  - 保存 registrations
  - 更新 effective capabilities，并触发 `onCapabilitiesChanged`（最终广播为 `lsp:serverCapabilities`）
- 对 `workspace/didChangeWatchedFiles` 注册选项，额外建立 chokidar watcher 并向 server 发送 `workspace/didChangeWatchedFiles`（`LspManager` 内实现）

### 2.5 多根工作区与 URI 映射（multi-root + uriMap）

VS Code 的多根工作区常见于 monorepo。此仓库支持：

- 以 `workspaceId + rootKey + languageId + serverConfigId` 生成 serverId（避免不同 root 复用同一 server）
- `clientUri <-> serverUri` 映射：用于“server 在另一套 root 下运行”时，确保返回的 URI 能映射回 renderer 的模型路径

实现集中在：

- `electron/main/lsp/LspManager.js`
  - `serverKey()`、`_mapClientUriToServerUri()`、`_mapServerUriToClientUri()`、`_workspaceFolderRootsFsPaths()`

---

## 3. IDE 的 LSP 实现情况分析与对标

### 3.1 是否已经对标 VS Code 级别“完整实现”？

结论：**没有对标到 VS Code 级别的完整实现**，属于“可用的轻量 LSP Client + Monaco 集成”。

原因（结构性差异）：

- VS Code 的语言特性体系包含：
  - 完整的 Extension Host（VS Code extension API）
  - 丰富的协议边界与兼容层（多 transport、多 workspace、复杂配置、权限与安全沙箱）
  - 更完整的 LSP feature 覆盖与 UI 交互（例如 CodeAction UI、Diagnostics 面板、Symbol Tree、Outline、CodeLens 呈现、重命名预览、引用视图等）
- 本仓库的实现更聚焦于：
  - **stdio + JSON-RPC** 的 LSP 请求/响应与基础 feature
  - 与 Monaco 的基础语言能力打通
  - 插件安装/启用与 server 启动的最小闭环

### 3.2 LSP 插件是否能被正确安装、启动并正确使用？

**安装**

- 支持通过 `plugins:*` IPC 调用插件管理：
  - `electron/main/lsp/plugins/PluginIpcService.js`
  - renderer 侧封装：`frontend/src/workbench/services/pluginsService.js`
- 支持安装来源：
  - `npm`（官方 catalog 使用该方式安装 tsls/pyright）
  - `archive/vsix`（PluginInstaller 支持解压与校验）
- 安装后会写入 `language-plugin.json` manifest 到安装目录：
  - `electron/main/lsp/plugins/PluginInstaller.js`

**启动**

- LSP server 由 Electron 主进程通过 `spawn` + stdio 启动：
  - `electron/main/lsp/transport/StdioTransport.js`
- 插件 manifest 的 server transport 会被解析并做变量替换：
  - `${PLUGIN_DIR}`、`${NODE}`、`${EXE}`、`${WORKSPACE_ID}` 等
  - `electron/main/lsp/plugins/LanguagePluginManager.js`
- Electron 环境下若用 `process.execPath` 作为 node，会注入 `ELECTRON_RUN_AS_NODE=1`（避免 Electron 以 GUI 模式启动）

**使用**

- 是否“正确使用”依赖两个条件：
  1) 插件已启用并能匹配当前语言/扩展名（`LanguagePluginManager.resolveServerConfigs()`）
  2) renderer 的 `lspService` 允许该语言注册 Monaco providers

当前 renderer 侧 `supportedLanguageIds` 默认只包含：

- `typescript`, `javascript`, `python`, `rust`, `json`
  - `frontend/src/workbench/services/lspService.js`

因此：**即使插件系统支持安装更多语言 server，前端也不会自动对其它 languageId 附加 LSP providers**（需要扩展前端支持列表与 UI/Monaco languageId 绑定）。

### 3.3 当前已支持的 LSP 能力（按 Monaco provider 映射）

以下是当前 renderer（Monaco）已挂载、且主进程具备对应 IPC/manager 实现的能力（具体会根据 server capabilities 决定是否生效）：

- Completion（含 resolve）
- Hover
- Definition
- References
- Rename
- CodeAction（含 resolve）
- SignatureHelp
- DocumentFormatting / RangeFormatting
- TypeDefinition
- Implementation
- FoldingRange
- InlayHints
- DocumentLink（Monaco 的 `registerLinkProvider`）
- CodeLens（含 resolve，命令通过 `lsp.executeServerCommand` 执行）
- DocumentHighlight
- SelectionRange
- SemanticTokens（full / delta / range，取决于 server 支持与 Monaco API 存在）
- WorkspaceSymbol / DocumentSymbol（用于 UI 层搜索/展示）
- CallHierarchy（prepare/incoming/outgoing）

关键实现位置：

- Monaco providers：`frontend/src/workbench/services/lspService.js`
- IPC handlers：`electron/main/lsp/LspMainService.js`
- 真实 LSP request：`electron/main/lsp/LspManager.js`

### 3.4 缺失功能清单（与 VS Code 对标）

下面的“缺失”以 VS Code 常见能力为参照，分为两类：**协议侧缺失** 与 **UI/产品侧缺失**。

#### 3.4.1 协议/能力覆盖缺失（LSP feature gaps）

- 工作区文件操作类能力（部分 server 依赖）
  - `workspace/willCreateFiles`、`workspace/didCreateFiles`
  - `workspace/willRenameFiles`、`workspace/didRenameFiles`
  - `workspace/willDeleteFiles`、`workspace/didDeleteFiles`
- Diagnostics Pull Model（新模型）
  - `textDocument/diagnostic`、`workspace/diagnostic`（若要对齐 VS Code 的诊断刷新策略）
- 语义能力扩展
  - `textDocument/documentColor` / `colorPresentation`
  - `textDocument/documentSymbol` 的层级展示与 outline 同步（当前更多是数据获取，产品呈现未对齐）
  - `textDocument/inlineValue`、`textDocument/linkedEditingRange`
- 搜索/跳转增强
  - `textDocument/declaration`（当前有 definition/typeDefinition/implementation，但 declaration 未见实现）
  - `textDocument/prepareTypeHierarchy` / typeHierarchy（未见实现）
- CodeAction/Command 生态对齐
  - `workspace/executeCommand` 已支持，但缺少 VS Code 式命令路由/贡献点体系
- Transport 支持
  - 目前仅 stdio；缺少 socket/pipe 等传输方式，以及自动探测/重连策略的完整覆盖

#### 3.4.2 UI/体验层缺失（VS Code 产品级差距）

- 完整的 LSP “Capabilities → UI 呈现”覆盖
  - 例如 CodeAction 灯泡、CodeLens UI、Outline 视图、Symbol Tree、Peek Definition 等的成熟交互
- 诊断体验对齐
  - VS Code 的 Problems 面板、过滤、分组、与 LSP diagnostics 的一致性策略
- 多工作区/多文件夹管理体验
  - workspaceFolders 的增删改与 UI 同步（协议支持需要与产品层打通）
- 配置体系对齐
  - VS Code 的 settings 贡献、作用域（user/workspace/folder）、与 server settingsSection 深度整合
  - 本仓库已有 `didChangeConfiguration`，但整体 settings 管理与 UI 仍偏轻量
- Extension 体系缺失
  - VS Code 最核心的生态能力来自扩展（不仅是 LSP server）
  - 本仓库的“LSP 插件”更接近 “language server launcher + manifest”，不等价于 VS Code extension API
- 调试协议（DAP）与任务系统
  - Debug Adapter Protocol、launch 配置、断点、调试 UI 等（当前不在 LSP 范畴，但 VS Code 级体验必备）

### 3.5 当前支持情况与缺失情况汇总（表格）

| 类别 | 能力 | 当前状态 | 备注 |
|---|---|---|---|
| 基础 | stdio + JSON-RPC | ✅ 已实现 | `StdioTransport` + `JsonRpcConnection` |
| 初始化 | initialize / capabilities | ✅ 已实现 | `LspServerProcess` |
| 文档同步 | didOpen/didChange/didClose/didSave | ✅ 已实现 | `lspService` + `LspManager` |
| Completion/Hover/Definition/References | ✅ 已实现 | 受 server caps 影响 |
| Rename/Formatting/RangeFormatting | ✅ 已实现 | 受 server caps 影响 |
| CodeAction/Resolve | ✅ 已实现 | 取消已降噪处理 |
| SemanticTokens | ✅ 已实现 | full/delta/range（取决于 server + Monaco API） |
| DocumentLink/CodeLens/Highlight/SelectionRange | ✅ 已实现 | 取决于 caps |
| CallHierarchy/Implementation/TypeDefinition | ✅ 已实现 | 取决于 caps |
| Declaration | ❌ 未实现 | `textDocument/declaration` 未见实现 |
| TypeHierarchy | ❌ 未实现 | `textDocument/prepareTypeHierarchy` / typeHierarchy 未见实现 |
| DocumentColor | ❌ 未实现 | `textDocument/documentColor` / `colorPresentation` 未见实现 |
| InlineValue / LinkedEditingRange | ❌ 未实现 | `textDocument/inlineValue`、`textDocument/linkedEditingRange` 未见实现 |
| DocumentSymbol（层级/Outline 同步） | ✅ 部分实现 | 有数据获取，但产品呈现未对齐 VS Code |
| 插件安装 | npm / vsix / archive | ✅ 已实现 | `PluginInstaller` |
| 插件启用/选择 | ✅ 已实现 | `LspSettingsPage` 可绑定 language→plugin |
| 多根工作区 | ✅ 部分实现 | 有 serverKey 与 uriMap，但 UI/工作区管理未对齐 VS Code |
| workspace file ops | ❌ 未实现 | `workspace/will*Files` / `workspace/did*Files` 未实现 |
| diagnostics pull model | ❌ 未实现 | 仅 push（publishDiagnostics），无 `textDocument/diagnostic` |
| transport 多样性 | ❌ 未实现 | 目前仅 stdio，缺 socket/pipe 等 |
| Capabilities → UI 覆盖 | ❌ 未实现 | CodeAction 灯泡、Outline、Peek 等交互未对齐 |
| Problems/诊断 UI | ❌ 未实现 | VS Code 风格 Problems 面板与分组/过滤策略缺失 |
| Settings/配置体系 | ✅ 部分实现 | 有 `didChangeConfiguration`，但 settings 作用域与 UI 偏轻量 |
| VS Code Extension Host | ❌ 未实现 | 不对标 VS Code 扩展 API |
| DAP 调试 | ❌ 未实现 | 非 LSP，但 VS Code 级必备 |

---

## 4. 建议的工程实践（防止 URI/路径回归）

- 明确约束：跨进程、跨层传递的“文件定位”字段必须是 **file URI** 或 **fsPath** 二者之一，避免混合。
- 入口统一 normalize：
  - renderer→main：对 `workspace.rootUri`、`folders[].uri` 做 `file:` canonicalize
  - main→server：对所有 `textDocument.uri` 做映射/转换
- `resolveFsPath` 必须具备 `file:` 识别能力，且不可把 URI 字符串直接 join 到 fsPath 上。
- 取消不应视为错误：对 `CancelledError` 统一降噪，避免污染日志与误导排查。

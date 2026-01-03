# PRD：统一扩展中心（语言插件 LSP + VS Code 扩展 VSIX）与产品级安装/启用链路

**版本**：v1.0  
**日期**：2026-01-04  
**范围**：本仓库自研 IDE（Electron + React）  

---

## 1. 背景

当前 IDE 已完成本地优先（Local-First）主体验，并具备：

- Electron Preload 暴露 `electronAPI.ideBus`，以 JSON-RPC 方式与主进程通信（见 [preload.js](file:///d:/Copilot/v0.1.07%20dev01/electron/preload.js#L150-L255)）。
- 主进程已注册 `extensions/*`、`plugins/*` 等总线方法（见 [registerIdeBus.js](file:///d:/Copilot/v0.1.07%20dev01/electron/main/ideBus/registerIdeBus.js#L642-L739)）。
- 语言插件（LSP）已经形成“搜索/安装/启用/更新”的链路（见 [PluginInstaller.js](file:///d:/Copilot/v0.1.07%20dev01/electron/main/lsp/plugins/PluginInstaller.js#L232-L356) 与 [officialCatalog.json](file:///d:/Copilot/v0.1.07%20dev01/electron/main/lsp/plugins/officialCatalog.json)）。
- VS Code 扩展宿主（Extension Host）已能在独立 Node 进程运行，并提供少量 `vscode.*` API 桥接（见 [ExtensionHostService.js](file:///d:/Copilot/v0.1.07%20dev01/electron/main/extensions/ExtensionHostService.js#L189-L227) 与 [extensionHostMain.js](file:///d:/Copilot/v0.1.07%20dev01/electron/main/extensions/extensionHostMain.js#L808-L813)）。

但目前存在明显体验与能力缺口：

- 扩展页面体验不统一：语言插件与 VS Code 扩展链路割裂，用户无法理解“搜索到的东西能不能安装/是否会生效”。
- VS Code 扩展仅加载 demo，缺少“VSIX 安装 → 启用 → 激活 → 贡献点 → 运行时管理”的产品级闭环（见 [ExtensionHostService.js](file:///d:/Copilot/v0.1.07%20dev01/electron/main/extensions/ExtensionHostService.js#L642-L656)）。
- 缺少主题/图标主题等 VS Code 生态中高频扩展类别的落地路径（见 [MISSING_FEATURES.md](file:///d:/Copilot/v0.1.07%20dev01/docs/MISSING_FEATURES.md#L56-L59)）。

本 PRD 的目标是：把“扩展”做成 VS Code 风格的统一入口，同时在技术上沿用本仓库的 IDE Bus 规划（见 [IDE_Data_Exchange_Plan.md](file:///d:/Copilot/v0.1.07%20dev01/docs/IDE_Data_Exchange_Plan.md#L32-L245)），完成产品级链路。

---

## 2. 目标与非目标

### 2.1 产品目标（必须达成）

- **统一扩展中心**：一个页面统一搜索、展示、安装与管理所有扩展/插件。
- **明确分层但统一体验**：搜索结果与详情明确标识
  - 语言插件（LSP）：语言服务/诊断/格式化等
  - VS Code 扩展：主题、Git 工具、Python 等 VSIX/Registry 扩展
- **产品级闭环**：
  - Registry 搜索（Open VSX 等）/本地 VSIX 导入
  - 下载/校验/解压/落盘
  - 解析 extension manifest（`package.json`）
  - 依赖处理、启用/禁用/卸载、更新与回滚
  - activationEvents 激活
  - contributes 贡献点（至少 commands + themes/iconThemes + configuration）
  - 宿主管理（状态、重启、日志、崩溃统计）
- **安全与信任（Workspace Trust）**：不信任工作区默认限制高危能力，并在 UI 明示、可审计。

### 2.2 非目标（本 PRD v1 不承诺）

- 使用微软官方 Marketplace（许可/接口策略复杂，优先 Open VSX 或自建源）。
- 100% VS Code API 全量兼容（采用“扩展驱动的 API 子集迭代”）。
- Remote Development / WSL / Containers / Codespaces 级能力。

---

## 3. 术语

- **语言插件（LSP Plugin）**：本仓库现有 `electron/main/lsp/plugins` 体系，用于安装与管理语言服务器能力。
- **VS Code 扩展（VS Code Extension）**：以 VSIX 分发，含 `package.json` manifest，运行在 Extension Host。
- **Extension Host**：独立 Node.js 进程，注入 `require('vscode')` 兼容层，通过 JSON-RPC 与主进程通信。
- **IDE Bus**：统一 JSON-RPC 2.0 通信总线（Renderer/Main/Extension Host/Tooling）。
- **Workspace Trust**：工作区信任模型，限制高危 API（见 [IDE_Data_Exchange_Plan.md](file:///d:/Copilot/v0.1.07%20dev01/docs/IDE_Data_Exchange_Plan.md#L158-L180)）。

---

## 4. 用户画像与核心场景

### 4.1 用户画像

- **普通开发者**：希望像 VS Code 一样搜索并安装主题、Git 工具、语言扩展。
- **团队/企业用户**：希望离线导入 VSIX，固定版本，能回滚与审计。
- **扩展作者**：希望把自己打包出的 VSIX 安装到 IDE 中进行验证。

### 4.2 核心场景（必须支持）

1. 搜索并安装主题扩展（VS Code 扩展）
2. 搜索并安装语言插件（LSP）
3. 从本地选择 VSIX 文件离线安装
4. 启用/禁用扩展，必要时重启宿主
5. 不信任工作区：安装可进行，但执行高危能力被限制并提示“信任后启用全部功能”

---

## 5. 现状盘点（基于代码）

### 5.1 已有能力

- Renderer ↔ Main：`electronAPI.ideBus` + `tryBus` fallback（见 [preload.js](file:///d:/Copilot/v0.1.07%20dev01/electron/preload.js#L150-L192)）。
- Extension Host 启动与 RPC：主进程用 stdio 启动 `extensionHostMain.js`（见 [ExtensionHostService.js](file:///d:/Copilot/v0.1.07%20dev01/electron/main/extensions/ExtensionHostService.js#L189-L217)）。
- `vscode` 注入与少量 API：`makeVscodeApi()`（见 [extensionHostMain.js](file:///d:/Copilot/v0.1.07%20dev01/electron/main/extensions/extensionHostMain.js#L808-L846)）。
- Workspace Trust 初步：扩展命令执行受 trust 限制（见 [ExtensionHostService.js](file:///d:/Copilot/v0.1.07%20dev01/electron/main/extensions/ExtensionHostService.js#L155-L167)）。
- 语言插件市场链路：`plugins/search/install/enable/disable` 已在 ideBus 暴露（见 [registerIdeBus.js](file:///d:/Copilot/v0.1.07%20dev01/electron/main/ideBus/registerIdeBus.js#L695-L739)）。

### 5.2 主要缺口（v1 要补齐）

- VS Code 扩展：
  - 缺少 “已安装扩展 registry”
  - 缺少 VSIX manifest 解析与安装落盘规范
  - 缺少 activationEvents 与 contributes 的消费
  - 缺少扩展依赖、更新、回滚、隔离/坏扩展熔断
- UI：
  - 统一扩展中心体验与分类标签
  - 宿主状态/日志/错误可视化与引导

---

## 6. 需求清单

### 6.1 统一扩展中心（UI）

**功能**
- 搜索：支持关键字、来源（All/OpenVSX/Official/GitHub）、类型过滤（全部/语言插件/VS Code 扩展）、安装态过滤（已安装/可更新/已启用）。
- 详情页：展示名称、发布者、版本、描述、README、权限/信任提示、依赖、变更日志、错误与诊断。
- 操作：安装/卸载/启用/禁用/更新/回滚（回滚 v1 可延后到 Phase 2/3）。
- 离线安装：选择 `.vsix` 文件安装（必做）。
- 宿主管理：查看 Extension Host 运行状态、重启、崩溃次数/退避、输出日志（基于 `extensions/getStatus` 与 output channel）。

**交互原则**
- 搜索结果统一卡片样式，但必须显示类型标识（LSP / VS Code Extension）。
- 安装按钮根据类型呈现不同语义：
  - LSP：安装后提示“语言能力将由 LSP 提供”
  - VS Code：安装后提示“需要启用并可能触发工作区信任要求”

### 6.2 VS Code 扩展安装与管理（Core/Main）

**安装来源（v1）**
- 本地 VSIX 文件导入
- Open VSX Registry 下载（优先；Marketplace 兼容端点可作为后续）

**安装流程（必须具备）**
- 下载（支持断点续传可后置）、校验（sha256 可选）、解压到专用目录
- 解析扩展 manifest：读取 `extension/package.json` 并校验核心字段
  - `name / publisher / version / engines.vscode`
  - `main`（Node 扩展入口）
  - `activationEvents`
  - `contributes`（至少 commands/themes/iconThemes/configuration）
  - `extensionDependencies / extensionPack`（解析并提示/后续安装）
  - `capabilities.untrustedWorkspaces`（配合 trust 策略）
- 维护本地 registry：已安装版本、启用态、来源、时间、错误态

**启用/禁用**
- 启用：进入“待激活”状态，必要时提示重启宿主
- 禁用：不删除文件，仅禁止加载/激活
- 卸载：删除版本目录并更新 registry

**更新与回滚（v1 MVP）**
- 更新检查：显示可更新列表
- 更新安装：默认“先下载后切换版本”，失败可回退
- 回滚：保留前一版本或支持再次下载旧版本（Phase 3 完整化）

### 6.3 扩展激活与贡献点（Core + Host）

**activationEvents（MVP）**
- `onCommand:<id>`
- `onLanguage:<languageId>`
- `workspaceContains:<glob>`
- `*`（仅对可信来源/明确提示；默认不自动）

**contributes（MVP）**
- `commands`：注册命令到命令面板，并可触发激活
- `configuration`：配置 schema 与默认值，支持读取与更新（至少工作区范围）
- `themes` / `iconThemes`：主题资源的安装与切换

**宿主加载模型**
- Main 维护“启用扩展列表”并在宿主启动/重启时下发
- 宿主按需激活扩展，不再仅加载 demo

### 6.4 安全与权限（Workspace Trust）

- 工作区不信任时：
  - 禁止扩展触发高危能力（文件写入、进程执行等），返回明确错误
  - UI 显示“信任此工作区以启用全部功能”
- 扩展来源标识：
  - 官方/可信（official） vs 第三方（openvsx/local）
  - 可配置“仅允许可信来源自动激活”

### 6.5 可观测与性能（Non-Functional）

**可观测**
- 扩展：安装耗时、激活耗时、失败原因、最近错误
- 宿主：崩溃次数、重启退避、输出日志通道

**性能目标（阶段目标，逐步收敛）**
- 扩展激活：p95 < 800ms（参考计划目标）
- 命令触发激活：p95 < 200ms（不含网络下载）
- 主题切换：p95 < 150ms（UI 可接受范围）

---

## 7. 系统方案（对齐 IDE Bus）

### 7.1 进程与职责

- Renderer：统一扩展中心 UI、交互、状态展示
- Main/Core：扩展 registry、安装器、贡献点注册、激活管理、信任策略
- Extension Host：运行扩展代码，`vscode.*` API → JSON-RPC → Main/Core

### 7.2 总线 API（建议新增/扩展）

现有：
- `extensions/getStatus`、`extensions/restart`、`extensions/listExtensions`（见 [registerIdeBus.js](file:///d:/Copilot/v0.1.07%20dev01/electron/main/ideBus/registerIdeBus.js#L642-L661)）
- `plugins/*`（语言插件链路）

建议新增（VS Code 扩展专用命名空间，避免与 LSP 插件混淆）：

- `vscodeExtensions/search`（Open VSX 等）
- `vscodeExtensions/install`（url 或本地文件路径）
- `vscodeExtensions/listInstalled`
- `vscodeExtensions/enable` / `vscodeExtensions/disable`
- `vscodeExtensions/uninstall`
- `vscodeExtensions/listUpdates` / `vscodeExtensions/update`
- `vscodeExtensions/getDetail`（含 README/manifest/依赖/权限）
- `vscodeExtensions/setPinnedVersion`（可选）
- `vscodeExtensions/rollback`（Phase 3）

宿主侧（Main → Host）建议协议：
- `extHost/loadExtensions`：传入启用扩展列表（当前已有 demo 调用，需改为真实列表）
- `extHost/activateByEvent`：按 activationEvents 触发激活
- `extHost/deactivateExtension`：禁用/卸载时调用（可选）

---

## 8. 数据模型（本地 registry）

### 8.1 VS Code 扩展记录（建议字段）

- `id`: `${publisher}.${name}`
- `publisher`, `name`, `version`
- `installDir`
- `enabled`: boolean
- `source`: `{ providerId, namespace, name, url }`
- `installedAt`, `updatedAt`
- `manifest`: 解析后的 `package.json` 关键字段（裁剪存储）
- `state`: `installed | enabled | disabled | error`
- `lastError`: `{ message, at }`
- `pinnedVersion`: string | null

### 8.2 目录布局（建议）

- 扩展根目录：`<appData>/extensions/`
- 单扩展多版本：
  - `<appData>/extensions/ms-python.python/2026.1.0/extension/...`
- registry 文件：
  - `<appData>/extensions/registry.json`

---

## 9. 验收标准（Definition of Done）

### v1（MVP）必须通过

- 统一扩展中心可同时搜索/展示 LSP 插件与 VS Code 扩展（类型清晰）。
- 本地 VSIX 安装后可在“已安装”列表中管理启用/禁用/卸载。
- 至少跑通 3 类扩展：
  - 主题扩展（themes/iconThemes 之一）
  - 命令扩展（commands + onCommand 激活）
  - 基础语言扩展（能注册 completion provider 或调用 workspace API）
- 不信任工作区：
  - 扩展命令执行被拒绝且 UI 有明确提示（可引用现有行为）。
- 宿主状态与日志可在 UI 查看，宿主可一键重启。

---

## 10. 风险与对策

- **VS Code API 面过大**：以“目标扩展清单”驱动 API 子集迭代，避免无止境。
- **性能与稳定性**：引入宿主 watchdog、崩溃熔断、慢扩展统计。
- **安全风险**：默认不信任工作区限制高危 API，扩展来源分级与提示。
- **生态兼容差异**：优先支持 Open VSX，避免 Marketplace 合规风险。

---

## 11. 里程碑（对应开发计划）

- M0：统一扩展中心 UI + VSIX 离线安装（可见、可控）
- M1：扩展 registry + 启用/禁用 + 宿主加载真实扩展列表
- M2：activationEvents + contributes（commands/themes/configuration）闭环
- M3：Open VSX 在线搜索/下载/更新 + 回滚与坏扩展隔离


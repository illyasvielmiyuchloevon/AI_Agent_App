# 开发计划：对标 VS Code 的功能与性能（分阶段详细路线图）

**版本**：v1.0  
**日期**：2026-01-04  
**范围**：本仓库自研 IDE（Electron + React）  
**依赖约束**：沿用 IDE Bus（JSON-RPC）与进程隔离规划（见 [IDE_Data_Exchange_Plan.md](file:///d:/Copilot/v0.1.07%20dev01/docs/IDE_Data_Exchange_Plan.md#L32-L245)）  

---

## 0. 总体策略

### 0.1 对标方法（避免“做全量 API”陷阱）

以“目标扩展清单 + 目标工作流”驱动能力建设，而不是按 VS Code API 名称表硬抄：

- 扩展清单（示例）：主题、GitLens（或同类 SCM 增强）、Python、ESLint、Prettier、Markdown、Docker（后置）
- 工作流清单（示例）：编辑/搜索/跳转、Git、调试、终端、扩展安装与启用、配置与快捷键

### 0.2 关键技术底座（已存在雏形）

- Renderer ↔ Main：`electronAPI.ideBus`（见 [preload.js](file:///d:/Copilot/v0.1.07%20dev01/electron/preload.js#L150-L184)）
- Main ↔ Extension Host：stdio + JSON-RPC（见 [ExtensionHostService.js](file:///d:/Copilot/v0.1.07%20dev01/electron/main/extensions/ExtensionHostService.js#L189-L227)）
- LSP 插件体系：具备搜索/安装/启用/更新（见 [PluginInstaller.js](file:///d:/Copilot/v0.1.07%20dev01/electron/main/lsp/plugins/PluginInstaller.js#L232-L356)）

### 0.3 性能/体验硬指标（按阶段收敛）

基础目标参考 IDE Bus 计划中的示例（见 [IDE_Data_Exchange_Plan.md](file:///d:/Copilot/v0.1.07%20dev01/docs/IDE_Data_Exchange_Plan.md#L184-L198)），并补充 UI 指标：

- 扩展激活：p95 < 800ms（本地无下载条件）
- 补全：p95 < 60ms（LSP/扩展提供时，不含网络）
- 诊断刷新：p95 < 200ms
- 主题切换：p95 < 150ms
- 全文搜索：p95 < 500ms（10万文件工作区，后期）

---

## Phase 0（第 1–3 周）：可观测基线与工程地基

### 0.1 目标

- 建立“像 IDE 一样做工程”的观测与质量基线：日志、trace、性能指标、崩溃与错误归因。

### 0.2 交付物

- RPC tracing：为 ideBus 与 extHost RPC 注入 traceId/spanId，并记录耗时与超时。
- 宿主健康度：记录启动/退出/崩溃/重启退避，输出到 UI 可见。
- 扩展安装流水线日志：下载/校验/解压/解析/落盘各阶段可观测。
- 基准场景脚本（可手动运行）：启动、打开工作区、打开大文件、触发补全、安装扩展。

### 0.3 验收标准

- 任意一次扩展激活失败，能从 UI 或日志定位到“扩展 id + 阶段 + 错误栈”。
- ideBus/extHost 的 p95 耗时可统计输出（至少本地日志）。

---

## Phase 1（第 4–6 周）：统一扩展中心 1.0（体验先统一）

### 1.1 目标

- 把用户感知最强的割裂点先抹平：一个扩展页，同时管理 LSP 插件与 VS Code 扩展。
- 完成 VSIX 离线安装 MVP，让“能安装”成为确定事实。

### 1.2 阶段划分

#### 1.2.1 扩展中心 UI 重构（第 4 周）

- 统一列表与详情组件
- 类型标识：语言插件（LSP）/VS Code 扩展（VSIX）
- 安装态展示：Installed/Enabled/Updates
- 宿主状态面板：复用 `extensions/getStatus`（见 [registerIdeBus.js](file:///d:/Copilot/v0.1.07%20dev01/electron/main/ideBus/registerIdeBus.js#L642-L661)）

验收：
- 同一个搜索框可以同时展示两类结果，并且用户不会误解“无法安装”。

#### 1.2.2 VSIX 离线安装管线（第 5 周）

- 新增 VS Code 扩展安装器（独立于 LSP 插件安装器）
- 支持选择 `.vsix` 文件 → 解压 → 读取 `extension/package.json` → 写入 registry
- UI 操作：安装/卸载/启用/禁用（启用先只影响 registry）

验收：
- 安装后出现在已安装列表，卸载后清理目录与 registry。

#### 1.2.3 扩展 registry 与宿主加载改造（第 6 周）

- 新增 VS Code 扩展 registry 存储（registry.json）
- Extension Host 启动后从 registry 读取“启用扩展列表”，替换掉 demo 固定加载（见 [ExtensionHostService.js](file:///d:/Copilot/v0.1.07%20dev01/electron/main/extensions/ExtensionHostService.js#L647-L656)）

验收：
- 启用一个扩展后，重启宿主可加载该扩展入口文件（不要求完整激活事件）。

---

## Phase 2（第 7–12 周）：VSIX → Host 运行闭环（产品级 MVP）

### 2.1 目标

- 把“安装只是落盘”升级为“安装可用、启用可用、按需激活可用”。
- 先覆盖扩展生态高频类别：主题、命令、基础语言增强。

### 2.2 阶段划分

#### 2.2.1 manifest 解析与兼容层（第 7–8 周）

- 完整解析扩展 `package.json` 关键字段：
  - `publisher/name/version/engines.vscode`
  - `main/activationEvents/contributes`
  - `extensionDependencies/extensionPack`
  - `capabilities.untrustedWorkspaces`
- 规范安装目录布局（单扩展多版本）
- 安装校验：阻止路径穿越、非法入口文件、缺失字段

验收：
- 安装一个标准 VSIX 后能展示其贡献点与激活事件摘要。

#### 2.2.2 activationEvents MVP（第 9–10 周）

实现至少：
- `onCommand:<id>`：命令面板/按钮触发激活
- `onLanguage:<languageId>`：打开文档触发
- `workspaceContains:<glob>`：打开工作区触发

验收：
- 扩展不再“启动就全激活”，而是事件驱动按需激活。
- 激活耗时可观测，失败不影响主进程。

#### 2.2.3 contributes MVP（第 11–12 周）

至少落地：
- `contributes.commands`：命令面板可见、可执行、可触发激活
- `contributes.configuration`：配置可读写（含工作区范围），并通知宿主配置变更
- `contributes.themes` / `contributes.iconThemes`：主题安装与切换（UI + Monaco）

验收：
- 主题扩展安装后可切换并立即生效。
- 命令扩展可从命令面板执行并能调用 `vscode.workspace` 基础能力。

---

## Phase 3（第 13–20 周）：支撑“真实扩展”（终端 / DAP / 搜索 / SCM 深水区）

### 3.1 目标

- 让 Python、GitLens/同类扩展真正可用所需的底座能力逐步齐全。
- 补齐 VS Code 作为 IDE 的关键工具链：终端、调试、全文搜索、基础索引。

### 3.2 阶段划分

#### 3.2.1 终端能力（第 13–15 周）

- 集成终端 UI 与主进程 PTY（或先做最小终端）
- 提供 `vscode.window.createTerminal`/`sendText`/输出事件的最小桥接

验收：
- 扩展可创建终端并执行命令，输出能在 UI 呈现。

#### 3.2.2 DAP 调试（第 16–18 周）

- 选择 1 条主线：Node 或 Python（建议 Node 先跑通，再扩 Python）
- 断点/单步/变量/调用栈 UI
- DAP client 稳定性：断线重连、进程退出处理

验收：
- 基础调试工作流可用：设置断点 → 启动 → 单步 → 查看变量。

#### 3.2.3 全文搜索与基础索引（第 19–20 周）

- 集成 ripgrep 或等价方案（后续可加索引加速）
- 与扩展 API 对接：`workspace.findFiles`/搜索结果展示

验收：
- 10万文件工作区，搜索 p95 < 500ms（设备差异可调）。

---

## Phase 4（第 21–32 周）：生态规模化（更新/回滚/依赖/隔离/测试体系）

### 4.1 目标

- 从“能用几个扩展”升级为“能长期稳定地用很多扩展”。

### 4.2 阶段划分

#### 4.2.1 Open VSX 在线市场（第 21–24 周）

- 接入 Open VSX 搜索/详情/下载
- 支持更新检查与一键更新
- 下载失败重试与断点续传（如需要）

验收：
- 用户可搜索并安装 Open VSX 上的扩展，且更新列表可用。

#### 4.2.2 依赖与扩展包（第 25–27 周）

- 处理 `extensionDependencies`：提示/自动安装（可配置）
- 处理 `extensionPack`：一键安装组合扩展

验收：
- 安装一个依赖型扩展时，能给出明确依赖处理结果。

#### 4.2.3 回滚与坏扩展隔离（第 28–30 周）

- 回滚到上个版本（保留版本目录或重新下载）
- “安全模式”启动：跳过全部第三方扩展
- 坏扩展熔断：连续崩溃/激活失败 → 自动禁用并提示

验收：
- 扩展导致宿主崩溃时，IDE 可自愈并给出用户操作路径。

#### 4.2.4 自动化兼容回归（第 31–32 周）

- 扩展冒烟测试集：安装/启用/激活/执行命令/卸载
- 性能回归：激活 p95、RPC p95、搜索 p95

验收：
- 每次发布前可自动跑完核心扩展测试集并输出报告。

---

## Phase 5（第 33 周起持续）：高阶 VS Code 体验对齐（UI 扩展、Webview、Remote 等）

### 5.1 建议优先级

高价值但高复杂：
- Webview（大量扩展依赖）
- TreeView/Views/Menus/Keybindings 的完整贡献点系统
- Remote Development（SSH/Docker/WSL）
- 设置同步、扩展同步（账号体系）

### 5.2 验收方式

- 用 10–20 个真实扩展作为“兼容基准套件”，按版本持续回归。

---

## 6. 资源与团队建议（按最小可行配置）

- Core/Main（2）：扩展 registry/installer/activation/contributes
- Extension Host（1）：vscode API 兼容层与协议实现
- Frontend（2）：扩展中心 UI、主题系统、终端/调试 UI
- QA/Automation（1）：扩展兼容回归、性能回归

---

## 7. 与现有文档的关系

- 本计划会覆盖并扩展现有总览性路线图（见 [DEVELOPMENT_PLAN.md](file:///d:/Copilot/v0.1.07%20dev01/docs/DEVELOPMENT_PLAN.md)），并把“扩展生态”前置到可交付闭环的阶段。
- 对扩展/宿主/权限/性能的通信与分层，遵循 IDE Bus 方案（见 [IDE_Data_Exchange_Plan.md](file:///d:/Copilot/v0.1.07%20dev01/docs/IDE_Data_Exchange_Plan.md#L32-L245)）。


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

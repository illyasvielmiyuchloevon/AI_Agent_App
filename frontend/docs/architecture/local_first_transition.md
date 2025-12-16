# 架构演进：从后端绑定到本地优先 (Local-First) / Electron 模式

## 背景与挑战

早期版本的 IDE 采用了 **B/S (Browser/Server)** 架构，依赖一个 Python/Node.js 后端服务来处理所有的文件系统操作、Git 操作和工作区管理。这种 "Backend Binding" (后端绑定) 模式带来了以下挑战：

1.  **部署复杂性**：用户需要安装和启动本地服务器，配置环境（Python/Node依赖），导致“上手”门槛高。
2.  **延迟与性能**：所有的文件读写都需要通过 HTTP 请求 (`/api/workspace/...`) 传输，引入了不必要的网络延迟，特别是在处理大文件或频繁保存时。
3.  **状态同步问题**：前端状态与后端文件系统状态需要复杂的同步机制（如 `syncWorkspaceFromDisk`），容易出现状态不一致。
4.  **体验割裂**：用户感觉像是在操作远程服务器，而非本地应用。

## 新架构：本地优先 (Local-First) + Electron

为了解决上述问题，我们转向了 **Local-First** 架构，并利用 **Electron** 提供原生能力。这一转变的核心思想是：**浏览器（前端）直接拥有数据的主权，仅在必要时请求系统级能力。**

### 核心组件变化

#### 1. 文件系统访问：File System Access API
我们不再依赖后端 API 读写文件，而是采用了浏览器原生的 [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)。

*   **驱动层**：`LocalWorkspaceDriver` (`frontend/src/utils/localWorkspaceDriver.js`) 取代了 `BackendWorkspaceDriver`。
*   **机制**：
    *   通过 `window.showDirectoryPicker()` 获取用户文件夹的句柄 (`FileSystemDirectoryHandle`)。
    *   直接在浏览器上下文中通过 `FileSystemFileHandle` 读取和写入文件。
    *   **优势**：零网络延迟，原生性能，无需后台服务进程。

#### 2. 系统能力桥接：Electron IPC
对于浏览器沙箱无法完成的任务（如 Git 操作、原生菜单、系统级对话框），我们通过 Electron 的 **IPC (Inter-Process Communication)** 暴露能力。

*   **桥接对象**：`window.electronAPI`
*   **主要功能模块**：
    *   **Git**：`window.electronAPI.git` (Clone, Status, Commit, Push, Pull 等)。
    *   **Workspace**：`window.electronAPI.workspace` (打开文件夹对话框 `pickFolder`，关闭窗口等)。
    *   **System**：最近打开的项目 (`recent`)，剪贴板等。

### 架构对比

| 特性 | 旧架构 (Backend Binding) | 新架构 (Local-First / Electron) |
| :--- | :--- | :--- |
| **文件读写** | HTTP POST/GET `/api/workspace/*` | 原生 `FileSystemHandle` (Direct I/O) |
| **Git 操作** | 后端 Shell 执行 -> HTTP 返回 | Electron Main Process -> IPC -> Frontend |
| **配置存储** | 后端数据库或 JSON 文件 | 本地文件 (`.aichat/config.json`) + `localStorage` |
| **启动依赖** | 必须启动 Python/Node Server | 无需额外服务，点击即用 |
| **数据流** | Frontend <-> Network <-> Backend <-> Disk | Frontend <-> Disk (via Browser API & IPC) |

## 迁移现状

*   **已完成**：
    *   `App.jsx` 已移除大部分对 `/api/config` 和 `/api/workspace` 的强依赖。
    *   `LocalWorkspaceDriver` 已成为默认的工作区驱动。
    *   Git 功能已完全重构为使用 `GitDriver` (基于 Electron IPC)。
    *   配置管理 (`ConfigPanel`) 已改为直接读写本地配置文件 (`.aichat/config.json`)。

*   **废弃接口**：
    *   `/api/config` (后端配置持久化)
    *   `/api/workspace/bind-root` (工作区绑定)
    *   `/api/workspace/structure` (文件树获取 - 现由前端递归扫描句柄生成)

## 未来规划

*   **纯 Web 版支持**：由于核心文件操作基于标准 Web API，IDE 理论上可以直接部署在静态 Web 服务器上（Git 功能除外，需 fallback 或使用 WASM 方案）。
*   **性能优化**：针对超大项目（node_modules），`LocalWorkspaceDriver` 的递归扫描需要进一步优化（如 Worker 线程处理）。

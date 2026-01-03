# Frontend UI Components & Design Architecture / 前端 UI 组件与设计架构

This document provides an overview of the frontend UI components, their roles, and the underlying design philosophy of the IDE.
本文档提供了前端 UI 组件的概览、它们的作用以及 IDE 的底层设计理念。

---

## 1. Design Philosophy / 设计理念

The interface follows a **"Floating Card"** pattern, designed to feel lightweight and modular.
界面遵循 **“悬浮卡片 (Floating Card)”** 模式，旨在营造轻量且模块化的视觉体验。

### Key Design Tokens / 核心设计规范
- **Floating Cards / 悬浮卡片**: Core containers use `background: var(--panel)`, `border: 1px solid var(--border)`, and `box-shadow: var(--shadow-soft)`.
  核心容器使用 `background: var(--panel)`，`border: 1px solid var(--border)` 和 `box-shadow: var(--shadow-soft)`。
- **Corner Radius / 圆角**: Standard `6px` radius (`--radius`) for cards and interactive elements.
  卡片和交互元素的标准圆角为 `6px` (`--radius`)。
- **Spacing / 间距**: A uniform `2px` margin is applied to major floating shells to create a "floating" effect against the background (`--bg`).
  主要外壳组件之间应用统一的 `2px` 外边距，从而在背景层 (`--bg`) 上产生“悬浮”效果。
- **Shadows / 阴影**: Soft shadows (`--shadow-soft`) provide depth without visual clutter.
  使用柔和阴影 (`--shadow-soft`) 提供深度感，避免视觉干扰。

---

## 2. Core Layout Shells / 核心布局外壳

The IDE is structured into several top-level "shells" that manage the primary workspace layout.
IDE 结构由几个顶级“外壳 (Shells)”组成，负责管理主要的工作区布局。

### `TitleBar` / 标题栏
- **Role / 作用**: The top-most bar containing menus, project info, global actions, and window controls.
  IDE 的最顶部栏，包含菜单、项目信息、全局操作和窗口控制。
- **Component / 组件**: `TitleBar.jsx`
- **Key Features / 核心功能**:
    - **Menu System / 菜单系统**: File, Edit, View, Window, Help. / 文件、编辑、视图、窗口、帮助。
    - **Project Info / 项目信息**: Displays current workspace name; click to switch projects, clone repositories, or connect to remote hosts. / 显示当前工作区名称，点击可切换项目、克隆仓库或连接远程主机。
    - **Quick Search / 快速搜索**: Integrated search button supporting `Ctrl+P` to quickly open files. / 集成的搜索按钮，支持 `Ctrl+P` 快速打开文件。
    - **Quick Actions / 快捷操作**: Theme toggle, view toggle (Code/Preview), new file/folder, sync, refresh preview. / 主题切换、视图切换（代码/预览）、新建文件/文件夹、同步、刷新预览。
    - **Window Controls / 窗口控制**: Minimize, maximize/restore, close (Electron environment). / 最小化、最大化/还原、关闭（Electron 环境）。

### `NavSidebar` (Activity Bar) / 活动栏 (侧边导航栏)
- **Role / 作用**: The leftmost vertical strip for switching between primary views.
  最左侧的垂直条，用于切换主要视图。
- **Component / 组件**: `NavSidebar.jsx`
- **Design / 设计**: Fixed width (`48px`), containing icons for Sessions, Chat, Explorer, Search, Git, etc.
  固定宽度 (`48px`)，包含会话、聊天、资源管理器、搜索、Git 等图标。
- **Interaction / 交互**: Controls the `activeSidebarPanel` state and sidebar collapse status. Includes settings entry and API status indicator at the bottom.
  控制 `activeSidebarPanel` 状态和侧边栏的折叠/展开。底部包含设置入口和 API 状态指示灯。

### `.sidebar-panel-shell` / 侧边栏面板外壳
- **Role / 作用**: A resizable container for functional panels (Explorer, Chat, Search, Git).
  侧边功能面板（资源管理器、聊天、搜索、Git）的可调宽度容器。
- **Design / 设计**: A floating card with `2px` margins. Supports width transition and can collapse to `0px`.
  具有 `2px` 外边距的悬浮卡片。支持宽度调整动画，可折叠至 `0px`。
- **Background / 背景**: Switches dynamically based on content (e.g., `var(--bg)` for Chat, `var(--panel)` for Explorer).
  根据内容动态切换（如聊天面板使用 `var(--bg)`，资源管理器使用 `var(--panel)`）。
- **Overflow / 溢出管理**: Uses `overflow: hidden` to ensure internal content (like virtualized file trees) respects corner radius.
  使用 `overflow: hidden` 确保内部内容（如虚拟文件树）尊重圆角边界。

### `.workspace-shell` / 工作区外壳
- **Role / 作用**: The central area hosting editors, previews, and settings.
  中央主要区域，承载编辑器、预览和设置等。
- **Design / 设计**: Synchronized with the sidebar's floating style (2px margin, 6px radius).
  与侧边栏的悬浮风格同步（2px 外边距，6px 圆角）。
- **Content / 内容**: Usually hosts the `Workspace.jsx` component, including the tab system and preview pane.
  通常托管 `Workspace.jsx` 组件，包含代码编辑器、标签页系统和预览面板。

### `.log-panel` / 日志面板
- **Role / 作用**: A sliding panel on the right for system logs and terminal output.
  右侧的滑动面板，用于显示系统日志和终端输出。
- **Design / 设计**: 
    - **Floating Card Design / 悬浮卡片设计**: Updated `.log-panel` to a "Floating Card" style, adding a 6px border radius and soft shadow to make it appear as an independent container floating over the background, consistent with the design language of the Floating Toolbar.
      将 `.log-panel` 的样式改为了“悬浮卡片”风格，增加了 6px 的圆角和柔和的阴影，使其看起来更像是一个独立悬浮在背景上的容器，与 Floating Toolbar 的设计语言保持一致。
    - **Positioning / 定位**: Absolute-positioned over the workspace when visible.
      可见时绝对定位在工作区上方。
- **Transition / 过渡**: Slides in/out based on the `showLogs` state.
  根据 `showLogs` 状态滑入/滑出。

---

## 3. Functional Panels & Components / 功能面板与组件

### `ExplorerPanel` / 资源管理器
- **Role / 作用**: Manages and navigates project file structures.
  管理和导航项目文件结构。
- **Component / 组件**: `ExplorerPanel.jsx`
- **Features / 功能**:
    - **Virtualized List / 虚拟滚动列表**: Efficiently renders large-scale file trees.
      高效渲染大规模文件树。
    - **Git Integration / Git 状态集成**: Displays Git status colors (M-Modified, A-Added, D-Deleted) next to filenames.
      文件名旁显示 Git 状态颜色（如 M-修改, A-新增, D-删除）。
    - **Context Menu / 右键菜单**: Supports New File, Rename, Move, Delete, etc.
      支持新建、重命名、移动、删除等操作。

### `SourceControlPanel` / 源代码控制 (Git)
- **Role / 作用**: Integrated Git operation interface.
  集成 Git 操作界面。
- **Component / 组件**: `SourceControlPanel.jsx`
- **Features / 功能**:
    - **Commit Management / 提交管理**: Stage/unstage changes, enter commit messages.
      暂存/取消暂存更改，输入提交信息。
    - **Sync Operations / 同步操作**: Pull, Push, Sync changes.
      拉取、推送、同步更改。
    - **Branch Management / 分支管理**: Switch, create, or delete branches.
      切换、新建、删除分支。
    - **Commit Graph / 提交图谱**: View historical commits and diffs.
      查看历史提交记录和差异。

### `Workspace` & `Monaco Editor` / 编辑器
- **Role / 作用**: The central code authoring and preview area.
  核心代码编写与预览区域。
- **Component / 组件**: `Workspace.jsx`
- **Architecture & Layout / 架构与布局**:
    - **Tab System / 标签页系统 (`.tab-row`)**: 
        - **Dynamic Tabs / 动态标签**: Supports multiple open files, special tabs (Settings, Welcome), and Diff views.
          支持多文件打开、特殊标签页（设置、欢迎页）以及差异视图。
        - **Visual Indicators / 视觉指示**: Includes file icons (`EXT_ICONS`), dirty state circles (unsaved changes), and close buttons.
          包含文件图标 (`EXT_ICONS`)、未保存状态圆点及关闭按钮。
    - **Breadcrumbs / 面包屑导航 (`.editor-breadcrumbs`)**: Displays the current project label and hierarchical file path for orientation.
      显示当前项目标签和层级文件路径，用于定位。
    - **Editor Shell / 编辑器外壳 (`.monaco-shell`)**:
        - **Monaco Editor**: Lazy-loaded integration of the VS Code editor core. Configured with custom themes (`vs-dark`, `vs`, `hc-black`) and optimized font settings (Cascadia Code).
          延迟加载的 VS Code 编辑器核心集成。配置了自定义主题（深色、浅色、高对比度）和优化的字体设置。
        - **Diff Editor / 差异编辑器**: Specialized mode for side-by-side or inline code comparison, used for reviewing AI changes or Git diffs.
          用于侧边或行内代码比较的专用模式，常用于审查 AI 改动或 Git 差异。
    - **AI Enhancements / AI 增强功能**:
        - **Context Menu / 右键菜单**: Integrated AI actions like Explain, Optimize, Review, and Rewrite.
          集成的 AI 操作，如解释、优化、审阅和重写。
        - **Inline AI Button / 行内 AI 按钮**: A floating action button that appears upon text selection for quick AI task triggering.
          文本选中时显示的悬浮操作按钮，用于快速触发 AI 任务。
        - **Undo/Redo Patching / 撤销/重放补丁**: Custom logic to ensure AI-applied edits are correctly tracked in the undo history.
          自定义逻辑，确保 AI 应用的编辑能正确追踪在撤销历史中。

### `ConfigPanel` / 设置页面
- **Role / 作用**: Global configuration and preferences.
  全局配置和偏好设置。
- **Component / 组件**: `ConfigPanel.jsx`
- **Design / 设计**: Supports opening as a Modal or an Editor Tab.
  支持弹窗 (Modal) 或在编辑器标签页 (Editor Tab) 中打开。
- **Categories / 分类**:
    - **General / 通用**: Language, settings/diff location, editor limits. / 语言、设置/Diff 显示位置、编辑器限制。
    - **Appearance / 外观**: Theme mode (Light, Dark, System). / 主题模式（浅色、深色、系统）。
    - **LLM & Session / 模型与会话**: Provider config, API keys, model selection, context window. / LLM 供应商配置、API Key、模型选择、上下文窗口。
    - **Shortcuts / 快捷键**: Custom global and editor shortcuts. / 自定义全局和编辑器快捷键。
    - **Tools / 工具管理**: Toggle tools for Agent and Canva modes. / 智能体 (Agent) 和对话流 (Canva) 模式下的工具开关。

### `ChatArea` / 聊天区域
- **Role / 作用**: The primary interface for AI interaction and multi-mode tasking.
  与 AI 交互及执行多模式任务的主要界面。
- **Component / 组件**: `ChatArea.jsx`
- **Architecture & Layout / 架构与布局**:
    - **Header / 头部**: Displays session title, log status indicators, and session action buttons (History, Delete, New Chat).
      显示会话标题、日志状态指示灯以及会话操作按钮（历史、删除、新建对话）。
    - **Message List / 消息列表 (`.chat-messages`)**: 
        - **Bubble Design / 气泡设计**: User messages are right-aligned with accent background (`var(--accent)`); Assistant messages are left-aligned with panel background (`var(--bg)`).
          用户消息右对齐并使用强调色背景 (`var(--accent)`)；助手消息左对齐并使用面板背景 (`var(--bg)`)。
        - **Content Types / 内容类型**: Supports Markdown rendering, image/file attachments, and specialized Tool Call components.
          支持 Markdown 渲染、图片/文件附件以及专门的工具调用组件。
    - **Composer (Input Area) / 输入组合区**:
        - **Input Shell (`.input-shell`)**: A multi-functional container for text input, file dragging, and toolbars.
          用于文本输入、文件拖拽和工具栏的多功能容器。
        - **Floating Toolbar (`.chat-composer-toolbar`)**: Contains attachment triggers, mode selector, and mic input.
          包含附件触发器、模式选择器和语音输入。
        - **Mode Selector (`.mode-selector`)**: 
            - **Design / 设计**: Floating menu with 20px blur backdrop, 12px radius, and soft shadows.
              悬浮菜单，具有 20px 模糊背景、12px 圆角和柔和阴影。
            - **Logic / 逻辑**: Prevents clipping by using `overflow: visible` on the parent shell and `right: 0` alignment for the dropdown.
              通过在父级 Shell 上设置 `overflow: visible` 以及下拉菜单 `right: 0` 对齐来防止内容被遮挡。
    - **Task Review Shell (`.task-review-shell`)**: 
        - **Interaction / 交互**: Anchored above the input area, expanding upwards to review file changes without interrupting the chat flow.
          锚定在输入区域上方，向上展开以审查文件更改，不中断聊天流程。

---

## 4. UI Style Files / UI 样式文件参考

The system styling is centralized to ensure consistency across components.
系统样式采用集中管理，以确保组件间的一致性。

- **`frontend/src/index.css`**: The **Single Source of Truth** for global styles. Contains:
  全局样式的**唯一事实来源**。包含：
    - **Design Tokens**: Variables for colors, shadows, radius, and spacing.
      设计令牌：颜色、阴影、圆角和间距变量。
    - **Layout Shells**: Styles for `.sidebar-panel-shell`, `.workspace-shell`, `.log-panel`, etc.
      布局外壳：各种主要容器的样式。
    - **Component Patterns**: Definitions for Floating Cards, Tool Chips, Mode Selectors, and Task Review UI.
      组件模式：悬浮卡片、工具芯片、模式选择器和任务审核 UI 的定义。
    - **Animations**: Keyframes for fade-ins, sliding panels, and transitions.
      动画：淡入、面板滑动和过渡的帧动画。
- **`frontend/src/App.css`**: Root container layout and high-level structural overrides.
  根容器布局和高级结构覆盖。
- **`frontend/src/workbench/editors/WelcomeEditor.module.css`**: Scoped CSS Module for the "Welcome" start page, handling complex grid layouts and interactive cards.
  “欢迎”启动页的局部 CSS 模块，处理复杂的网格布局和交互卡片。

---

## 5. Specialized UI Components / 特殊交互组件

### `.task-review-shell` / 任务改动审核列表
- **Role / 作用**: Lists file changes proposed by AI for user approval, located above chat input.
  位于聊天输入框上方，列出 AI 建议的文件改动。
- **Design / 设计**:
    - **Upward Expansion / 向上展开**: Uses `flex-direction: column-reverse` to grow upwards.
      使用 `flex-direction: column-reverse` 向上生长，不遮挡输入区。
    - **States / 状态**: Collapsed (summary) and Expanded (detailed list).
      折叠（摘要）和展开（详细列表）。
    - **Interaction / 交互**: Keep All, Revert All, or per-file approval.
      支持全部保留、全部撤销或逐个文件审核。

### `.tool-run-chip` / 工具调用卡片
- **Role / 作用**: Visualizes AI tool calls (e.g., read file, run command).
  可视化 AI 调用工具（如读取文件、执行命令）的过程。
- **Design / 设计**: Aligned with the **Floating Toolbar** style.
  与 **Floating Toolbar** 风格一致。
- **Features / 特征**: Status indicators, expandable detail area, action buttons (e.g., View Diff).
  状态指示（运行中、完成、错误）、可展开的参数和结果详情、操作按钮（如查看 Diff）。

---

## 6. Layout Logic & State Management / 布局逻辑与状态管理

### Resizer Logic / 调整大小逻辑
- **Mechanism / 机制**: Managed via `sidebar-resizer`. Uses a larger transparent "hit area" (`sidebar-resizer-hit`) for better accessibility.
  通过 `sidebar-resizer` 管理。使用比视觉指示器更大的透明点击区域 (`sidebar-resizer-hit`)，提升拖拽易用性。
- **State / 状态**: `activeResizeTarget` tracks the boundary being dragged.
  `activeResizeTarget` 记录当前正在调整大小的边界。

### Height Calculations / 高度计算
- **Dynamic Sizing / 动态尺寸**: Many shells use `height: calc(100% - 4px)` to account for `2px` margins, ensuring perfect fit within the viewport.
  许多外壳使用 `height: calc(100% - 4px)` 来补偿上下各 `2px` 的边距，确保在不溢出的情况下完美适配视口。

### Internationalization (I18n) / 国际化支持
- **Implementation / 实现**: Managed via `utils/i18n.js`. Components respond to the `language` prop (English, Chinese, Japanese).
  通过 `utils/i18n.js` 管理多语言文本。组件通过 `language` 属性响应语言切换（中文、英文、日文）。

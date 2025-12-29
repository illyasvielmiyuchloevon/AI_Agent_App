# 项目缺失功能分析报告 (Gap Analysis Report)

## 1. 引言
本报告旨在详细分析当前 IDE 项目与成熟商业 IDE（如 VS Code, Cursor, JetBrains 系列）之间的差距，涵盖基础编辑器功能、调试能力、AI Native 特色以及生态系统等维度。

## 2. 核心编辑器功能 (Core Editor Gaps)
### 2.1 视图与窗口管理
- **分屏编辑 (Split Editors)**: 目前不支持水平或垂直拆分编辑器窗口。
- **多窗口支持 (Multi-window Support)**: 无法将特定文件或面板拖出主窗口作为独立窗口。
- **浮动面板 (Floating Panels)**: 终端、输出等面板无法脱离主布局浮动。

### 2.2 导航与结构
- **面包屑导航 (Breadcrumbs)**: 顶部缺少基于路径和符号的快速导航。
- **大纲视图 (Outline View)**: 侧边栏缺少对当前文件类、方法、变量的结构化展示。
- **符号跳转 (Go to Symbol)**: 缺乏工作区级别的符号搜索 (`Ctrl+T`)。
- **引用查找 (Find All References)**: 虽然有 LSP 支持，但 UI 层面的展示和交互尚不完善。

### 2.3 任务系统 (Task System)
- **自定义任务定义**: 缺乏类似 `tasks.json` 的机制来定义构建、测试或部署脚本。
- **任务自动化**: 无法配置在特定事件（如保存文件、打开项目）时自动运行任务。

## 3. 语言支持与调试能力 (Language & Debugging Gaps)
### 3.1 调试协议 (DAP) 集成
- **核心缺失**: 目前仅有 [debugService.js](file:///d:/Copilot/v0.1.07%20dev01/frontend/src/workbench/services/debugService.js) 实现的简单日志控制台。
- **断点管理**: 缺乏行内断点设置、条件断点和断点列表视图。
- **执行控制**: 缺失单步跳过 (Step Over)、单步进入 (Step Into)、单步退出 (Step Out) 等交互。
- **状态观测**: 缺失变量观察 (Watch)、调用栈 (Call Stack) 和内存查看器。

### 3.2 语言服务增强
- **语义高亮 (Semantic Highlighting)**: 部分复杂语言的语义着色支持不足。
- **重构支持**: 缺失高级重构操作（如提取方法、移动符号、更改签名等）的可视化引导。

## 4. AI Native 特色功能 (AI Native Gaps)
### 4.1 智能补全与预测
- **行内预测 (Inline Prediction/Ghost Text)**: 缺失基于上下文的实时代码续写预览。
- **光标跳转预测**: 无法预测用户下一步可能移动到的代码位置。

### 4.2 AI Agent 自治
- **闭环执行能力**: 虽然具备 AI 引擎，但 Agent 尚不能自主完成“运行测试 -> 捕获错误 -> 修复代码 -> 重新验证”的完整闭环。
- **终端交互**: AI 对终端输出的实时感知和响应能力较弱。

### 4.3 知识库与 RAG
- **深度上下文关联**: RAG 索引 [rag_index.ts](file:///d:/Copilot/v0.1.07%20dev01/backend-node/src/ai-engine/rag_index.ts) 尚未充分整合 Git 历史记录、Pull Requests 或外部技术文档。
- **项目级理解**: 缺乏对项目整体架构、模块间依赖关系的结构化图谱理解。

## 5. 版本控制与协作 (VCS & Collaboration Gaps)
### 5.1 高级 Git 集成
- **冲突解决**: 缺乏图形化的三方合并 (Three-way merge) 界面。
- **历史回溯**: 缺乏行级的 Git Blame 悬浮窗和文件历史时间轴视图。
- **暂存区管理**: 缺乏对文件内特定行/块 (Hunk) 的部分暂存支持。

### 5.2 远程与协作
- **远程开发 (Remote Development)**: 不支持 SSH、Docker 或 WSL 远程环境连接。
- **实时协作**: 缺乏类似 Live Share 的多人实时协同编辑功能。

## 6. 扩展性与生态 (Extensibility Gaps)
- **UI 扩展能力**: 插件系统目前仅限于语言服务，无法让第三方开发者贡献新的 UI 组件、图标或视图。
- **主题系统**: 缺乏完整的颜色主题和图标主题自定义及市场支持。
- **配置同步**: 用户的偏好设置、插件列表无法在不同设备间同步。

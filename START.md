# AI Agent App 启动指南

## 📋 前置要求
- Node.js 18+ (推荐 v20)
- npm 或 yarn

## 🚀 快速启动（推荐）

### Windows 一键启动
直接运行项目根目录下的批处理脚本：
```cmd
.\start_app.bat
```

此脚本会自动：
1. 检查并安装后端依赖
2. 检查并安装前端依赖
3. 启动 Node.js 后端服务 (端口 8000)
4. 启动 Electron 桌面应用

---

## 📝 手动启动步骤

### 步骤 1: 启动后端 (Node.js)

```bash
# 进入后端目录
cd backend-node

# 安装依赖 (首次运行)
npm install

# 启动服务
npm start
```

✅ 后端运行在: http://localhost:8000

### 步骤 2: 启动前端 (Electron/React)

```bash
# 进入前端目录
cd frontend

# 安装依赖 (首次运行)
npm install

# 启动开发模式 (Electron)
npm run electron:dev

# 或者仅启动网页版
npm run dev
```

---

## 📌 配置指南

### 1. LLM 配置 (模型设置)
应用启动后，进入 **设置 (Settings)** 页面：
- **Provider**: 选择 `OpenAI` 或 `Anthropic`
  - **OpenAI**: 适用于官方 API 或兼容 OpenAI 格式的第三方服务 (如 ModelScope, DeepSeek 等)
  - **Anthropic**: 适用于 Claude 系列模型
- **API Key**: 填入您的 API 密钥
- **Base URL**: 
  - 官方 OpenAI: `https://api.openai.com/v1` (默认)
  - 官方 Anthropic: `https://api.anthropic.com/v1` (默认)
  - 第三方/中转服务: 请填入相应的 Base URL (例如 `https://api.example.com/v1`)

### 2. 工作区绑定
首次使用时，需要绑定一个本地目录作为工作区。Agent 将在该目录下读取和修改文件。

---

## 📂 项目结构 (最新)

```
AI_Agent_App/
├── backend-node/          # Node.js 后端 (当前版本)
│   ├── src/
│   │   ├── index.ts       # Express 服务器入口
│   │   ├── core/          # Agent 核心逻辑
│   │   └── tools/         # 工具实现 (文件系统, 搜索等)
│   └── package.json
├── frontend/              # React + Electron 前端
├── _legacy/               # 旧版本归档 (Python 后端等)
├── start_app.bat          # Windows 一键启动脚本
└── START.md               # 本文档
```

## ❓ 常见问题

**Q: 启动时提示端口 8000 被占用？**
A: 请检查是否有旧的后端进程未关闭。可以使用 `taskkill /F /IM node.exe` 尝试清理，或者手动查找占用端口的进程。

**Q: 选择 Anthropic 但调用了 OpenAI 接口？**
A: 请检查配置是否保存成功。可以在设置页面重新保存一次配置。注意 Base URL 的格式不要包含多余的引号。

**Q: 无法连接到 LLM？**
A: 
1. 检查 API Key 是否正确。
2. 检查 Base URL 是否正确 (去除多余的空格或引号)。
3. 检查网络连接或代理设置。

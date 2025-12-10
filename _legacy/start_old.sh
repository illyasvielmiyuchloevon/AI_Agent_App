#!/bin/bash

# 一键启动脚本 - AI Agent App (Linux/Mac)

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "========================================"
echo "🚀 AI Agent App - 一键启动"
echo "========================================"
echo ""

# --- 检查依赖 ---
echo "📋 检查依赖环境..."

# 检查 Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 未安装"
    exit 1
fi
PYTHON_VERSION=$(python3 --version)
echo "✅ $PYTHON_VERSION"

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js 未安装"
    exit 1
fi
NODE_VERSION=$(node --version)
echo "✅ Node.js $NODE_VERSION"

# --- 启动后端 ---
echo ""
echo "========================================"
echo "📦 启动后端 (FastAPI)"
echo "========================================"

BACKEND_DIR="$PROJECT_DIR/backend"
cd "$BACKEND_DIR"

echo "📥 安装后端依赖..."
pip install -q -r requirements.txt
if [ $? -ne 0 ]; then
    echo "❌ 后端依赖安装失败"
    exit 1
fi
echo "✅ 后端依赖安装完成"

echo "🔄 启动后端服务 (端口 8000)..."
python3 -m uvicorn main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
echo "✅ 后端已启动 (PID: $BACKEND_PID)"
echo "   http://localhost:8000"
echo "   API 文档: http://localhost:8000/docs"

sleep 3

# --- 启动前端 ---
echo ""
echo "========================================"
echo "🎨 启动前端 (Vite + React)"
echo "========================================"

FRONTEND_DIR="$PROJECT_DIR/frontend"
cd "$FRONTEND_DIR"

echo "📥 安装前端依赖..."
npm install --quiet 2>/dev/null
echo "✅ 前端依赖检查完成"

echo "🔄 启动前端服务 (端口 5173)..."
npm run dev &
FRONTEND_PID=$!
echo "✅ 前端已启动 (PID: $FRONTEND_PID)"
echo "   http://localhost:5173"

# --- 完成 ---
echo ""
echo "========================================"
echo "✨ 启动完成！"
echo "========================================"
echo ""
echo "📌 访问地址："
echo "   前端: http://localhost:5173"
echo "   后端: http://localhost:8000"
echo "   API文档: http://localhost:8000/docs"
echo ""
echo "⚙️  首次使用需要配置 LLM:"
echo "   1. 打开 http://localhost:5173"
echo "   2. 点击右上角齿轮 (⚙️) 进入配置"
echo "   3. 填入 OpenAI 或 Anthropic API Key"
echo "   4. 点击保存"
echo ""
echo "📖 查看完整指南: START.md"
echo ""
echo "🛑 要停止所有服务，按 Ctrl+C"
echo ""

# 等待所有后台进程
wait

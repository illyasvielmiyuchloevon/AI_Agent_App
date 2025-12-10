# 一键启动脚本 - AI Agent App

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "🚀 AI Agent App - 一键启动" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# --- 检查依赖 ---
Write-Host "📋 检查依赖环境..." -ForegroundColor Yellow

# 检查 Python
$pythonCheck = python --version 2>$null
if (-not $pythonCheck) {
    Write-Host "❌ Python 未安装或未在 PATH 中" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Python: $pythonCheck" -ForegroundColor Green

# 检查 Node.js
$nodeCheck = node --version 2>$null
if (-not $nodeCheck) {
    Write-Host "❌ Node.js 未安装或未在 PATH 中" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Node.js: $nodeCheck" -ForegroundColor Green

# --- 启动后端 ---
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "📦 启动后端 (FastAPI)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan

$backendDir = Join-Path $projectDir "backend"
Set-Location $backendDir

# 安装后端依赖
Write-Host "📥 安装后端依赖..."
pip install -q -r requirements.txt
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ 后端依赖安装失败" -ForegroundColor Red
    exit 1
}
Write-Host "✅ 后端依赖安装完成" -ForegroundColor Green

# 启动后端
Write-Host "🔄 启动后端服务 (端口 8000)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit -Command `"Set-Location '$backendDir'; python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000`"" -WindowStyle Normal

Write-Host "✅ 后端已启动: http://localhost:8000" -ForegroundColor Green
Write-Host "   API 文档: http://localhost:8000/docs" -ForegroundColor Green

Start-Sleep -Seconds 3

# --- 启动前端 ---
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "🖥️  启动桌面版（Electron + Vite）" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan

$electronDir = Join-Path $projectDir "electron"
$frontendDir = Join-Path $projectDir "frontend"
Set-Location $electronDir

# 安装 Electron 壳依赖
Write-Host "📥 安装桌面壳依赖..."
npm install --quiet 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️  npm install 返回非零状态，但继续尝试启动..." -ForegroundColor Yellow
}
Write-Host "✅ 桌面壳依赖检查完成" -ForegroundColor Green

# 启动桌面版（会自动启动前端 Dev Server）
Write-Host "🔄 启动桌面版 (Electron + 前端 dev) ..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit -Command `"Set-Location '$electronDir'; npm run dev`"" -WindowStyle Normal

Write-Host "✅ 桌面版已启动：Electron 窗口将自动打开（前端 dev: http://localhost:5173）" -ForegroundColor Green

# --- 完成 ---
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "✨ 启动完成！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "📌 访问地址：" -ForegroundColor Cyan
Write-Host "   前端: http://localhost:5173" -ForegroundColor White
Write-Host "   后端: http://localhost:8000" -ForegroundColor White
Write-Host "   API文档: http://localhost:8000/docs" -ForegroundColor White
Write-Host ""
Write-Host "⚙️  首次使用需要配置 LLM:" -ForegroundColor Yellow
Write-Host "   1. 打开 http://localhost:5173" -ForegroundColor White
Write-Host "   2. 点击右上角齿轮 (⚙️) 进入配置" -ForegroundColor White
Write-Host "   3. 填入 OpenAI 或 Anthropic API Key" -ForegroundColor White
Write-Host "   4. 点击保存" -ForegroundColor White
Write-Host ""
Write-Host "📖 查看完整指南: START.md" -ForegroundColor Cyan
Write-Host ""

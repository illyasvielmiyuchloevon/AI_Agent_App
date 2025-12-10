@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo       Starting AI Agent Application
echo ==========================================

echo.
echo [1/3] Checking Backend (Node.js)...
if not exist "backend-node\node_modules" (
    echo Installing backend dependencies...
    cd backend-node
    call npm install
    cd ..
)
echo Starting Backend Server...
start "AI Agent Backend" cmd /k "cd backend-node && npm start"

echo.
echo [2/3] Checking Frontend...
if not exist "frontend\node_modules" (
    echo Installing frontend dependencies...
    cd frontend
    call npm install
    cd ..
)

echo.
echo [3/3] Checking Desktop App (Electron)...
if not exist "electron\node_modules" (
    echo Installing electron dependencies...
    cd electron
    call npm install
    cd ..
)

echo Starting Desktop Application...
cd electron
start "AI Agent Desktop" cmd /k "npm run dev"

echo.
echo ==========================================
echo       Application Startup Initiated
echo ==========================================
echo Backend: http://localhost:8000
echo Desktop: Loading...
echo.
echo You can close this window, but keep the other windows open.
pause

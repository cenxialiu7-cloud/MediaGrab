@echo off
chcp 65001 >nul
title MediaGrab

set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR=%SCRIPT_DIR%.."
set "PORT=9800"

cd /d "%PROJECT_DIR%"

:: Check if node_modules exist
if not exist "node_modules" (
    echo First run detected. Installing dependencies...
    call "%SCRIPT_DIR%install-windows.bat"
)

:: Check if client is built
if not exist "client\dist" (
    echo Building client...
    cd /d "%PROJECT_DIR%\client"
    call npx vite build
    cd /d "%PROJECT_DIR%"
)

:: Create download directory
if not exist "%USERPROFILE%\Downloads\MediaGrab" mkdir "%USERPROFILE%\Downloads\MediaGrab"

echo.
echo ======================================
echo      MediaGrab Starting...
echo      http://localhost:%PORT%
echo ======================================
echo.

:: Set production mode
set NODE_ENV=production

:: Start server and open browser after delay
echo MediaGrab is running. Close this window to stop.
echo.

:: Open browser after a short delay using a background cmd
start "" /B cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:%PORT%"

:: Run server in foreground (keeps window open)
node server/index.js

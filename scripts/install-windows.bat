@echo off
chcp 65001 >nul
echo.
echo =========================================
echo   MediaGrab - Windows Dependency Installer
echo =========================================
echo.

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] Node.js not found. Please install from https://nodejs.org/
    echo     Download and install, then re-run this script.
    pause
    exit /b 1
) else (
    echo [OK] Node.js found
)

:: Check Python
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] Python not found. Please install from https://python.org/
    pause
    exit /b 1
) else (
    echo [OK] Python found
)

:: Install yt-dlp
where yt-dlp >nul 2>nul
if %errorlevel% neq 0 (
    echo [+] Installing yt-dlp...
    pip install yt-dlp
) else (
    echo [OK] yt-dlp installed
)

:: Install FFmpeg
where ffmpeg >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] FFmpeg not found.
    echo     Install via: winget install FFmpeg
    echo     Or download from https://ffmpeg.org/download.html
    echo     Please install and re-run this script.
) else (
    echo [OK] FFmpeg installed
)

:: Install aria2
where aria2c >nul 2>nul
if %errorlevel% neq 0 (
    echo [+] aria2 not found.
    echo     Install via: winget install aria2
) else (
    echo [OK] aria2 installed
)

:: Install streamlink
where streamlink >nul 2>nul
if %errorlevel% neq 0 (
    echo [+] Installing streamlink...
    pip install streamlink
) else (
    echo [OK] streamlink installed
)

:: Get script directory
set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR=%SCRIPT_DIR%.."

:: Install node deps
echo.
echo [+] Installing Node.js dependencies...
cd /d "%PROJECT_DIR%"
call npm install

echo.
echo [+] Installing client dependencies...
cd /d "%PROJECT_DIR%\client"
call npm install

echo.
echo [+] Building client...
call npx vite build

echo.
echo [+] Installing Playwright browsers...
cd /d "%PROJECT_DIR%"
call npx playwright install chromium

:: Create download directory
if not exist "%USERPROFILE%\Downloads\MediaGrab" mkdir "%USERPROFILE%\Downloads\MediaGrab"

echo.
echo =========================================
echo   Installation Complete!
echo   Double-click start-windows.bat to launch
echo =========================================
echo.
pause

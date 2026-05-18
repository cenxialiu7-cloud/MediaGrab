#!/bin/bash
set -e

echo ""
echo "========================================="
echo "  MediaGrab - Mac Dependency Installer"
echo "========================================="
echo ""

# Check for Homebrew
if ! command -v brew &>/dev/null; then
  echo "[!] Homebrew not found. Installing..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

# Check for Node.js
if ! command -v node &>/dev/null; then
  echo "[+] Installing Node.js..."
  brew install node
else
  echo "[OK] Node.js: $(node --version)"
fi

# Check for Python3
if ! command -v python3 &>/dev/null; then
  echo "[+] Installing Python3..."
  brew install python3
else
  echo "[OK] Python3: $(python3 --version)"
fi

# Install yt-dlp
if ! command -v yt-dlp &>/dev/null; then
  echo "[+] Installing yt-dlp..."
  pip3 install yt-dlp
else
  echo "[OK] yt-dlp installed"
fi

# Install FFmpeg
if ! command -v ffmpeg &>/dev/null; then
  echo "[+] Installing FFmpeg..."
  brew install ffmpeg
else
  echo "[OK] FFmpeg installed"
fi

# Install aria2
if ! command -v aria2c &>/dev/null; then
  echo "[+] Installing aria2..."
  brew install aria2
else
  echo "[OK] aria2 installed"
fi

# Install streamlink
if ! command -v streamlink &>/dev/null; then
  echo "[+] Installing streamlink..."
  pip3 install streamlink
else
  echo "[OK] streamlink installed"
fi

# Install project dependencies
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo ""
echo "[+] Installing Node.js dependencies..."
cd "$PROJECT_DIR"
npm install

echo ""
echo "[+] Installing client dependencies..."
cd "$PROJECT_DIR/client"
npm install

echo ""
echo "[+] Building client..."
npx vite build

echo ""
echo "[+] Installing Playwright browsers..."
cd "$PROJECT_DIR"
npx playwright install chromium

# Create download directory
mkdir -p "$HOME/Downloads/MediaGrab"

echo ""
echo "========================================="
echo "  Installation Complete!"
echo "  Run ./scripts/start-mac.command to launch"
echo "========================================="
echo ""

#!/bin/bash
# MediaGrab Launcher for macOS
# Double-click this file to start MediaGrab

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PORT=${PORT:-9800}

# Ensure Python user bin and Homebrew are in PATH
export PATH="$HOME/Library/Python/3.9/bin:$HOME/Library/Python/3.11/bin:$HOME/Library/Python/3.12/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

cd "$PROJECT_DIR"

# Check if node_modules exist
if [ ! -d "node_modules" ]; then
  echo "First run detected. Installing dependencies..."
  bash "$SCRIPT_DIR/install-mac.sh"
fi

# Check if client is built
if [ ! -d "client/dist" ]; then
  echo "Building client..."
  cd client && npx vite build && cd ..
fi

# Create download directory
mkdir -p "$HOME/Downloads/MediaGrab"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║         MediaGrab Starting...        ║"
echo "║   http://localhost:$PORT              ║"
echo "╚══════════════════════════════════════╝"
echo ""

# Start server and open browser
export NODE_ENV=production
node server/index.js &
SERVER_PID=$!

sleep 2
open "http://localhost:$PORT"

echo "MediaGrab is running. Press Ctrl+C to stop."
echo ""

cleanup() {
  echo ""
  echo "Shutting down MediaGrab..."
  kill $SERVER_PID 2>/dev/null
  exit 0
}
trap cleanup INT TERM

wait $SERVER_PID

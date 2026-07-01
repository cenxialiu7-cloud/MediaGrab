#!/bin/bash
# MediaGrab — Build script for .app and .pkg installer (arm64 only)
# Run from the packaging/ directory: ./build-pkg.sh

set -e

# ── Paths ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
APP="$SCRIPT_DIR/MediaGrab.app"
RESOURCES="$APP/Contents/Resources"
VENDOR="$SCRIPT_DIR/vendor"
DIST="$SCRIPT_DIR/dist"
BUILD="$SCRIPT_DIR/build"

VERSION="1.0.0"
BUNDLE_ID="com.mediagrab.app"
PKG_NAME="MediaGrab-${VERSION}-arm64.pkg"

mkdir -p "$DIST" "$BUILD" "$RESOURCES"

echo "=========================================="
echo "  Building MediaGrab ${VERSION} for arm64"
echo "=========================================="
echo ""

# ── Step 1: Rebuild the client to make sure dist/ is fresh ─────────────────────
echo "[1/6] Building React client..."
cd "$PROJECT_ROOT/client"
npx vite build 2>&1 | tail -3
cd "$SCRIPT_DIR"

# ── Step 2: Copy app source (server + client/dist + production node_modules) ──
echo ""
echo "[2/6] Copying app source into Resources/app/..."
rm -rf "$RESOURCES/app"
mkdir -p "$RESOURCES/app"

# Copy server, client/dist, package.json, package-lock.json
cp -R "$PROJECT_ROOT/server"          "$RESOURCES/app/"
cp -R "$PROJECT_ROOT/client/dist"     "$RESOURCES/app/client-dist-tmp"
mkdir -p "$RESOURCES/app/client"
mv "$RESOURCES/app/client-dist-tmp"   "$RESOURCES/app/client/dist"
cp     "$PROJECT_ROOT/package.json"   "$RESOURCES/app/"
cp     "$PROJECT_ROOT/package-lock.json" "$RESOURCES/app/" 2>/dev/null || true

# Companion browser extension + native messaging host (staged out of the bundle
# at runtime so Chrome's "Load unpacked" can reach it). Must match build-mac.yml.
cp -R "$PROJECT_ROOT/extension"       "$RESOURCES/app/extension"
cp -R "$PROJECT_ROOT/native-host"     "$RESOURCES/app/native-host"

# Install only PRODUCTION dependencies into the bundle (smaller than copying full node_modules)
echo "  Installing production deps..."
cd "$RESOURCES/app"
"$VENDOR/node/bin/npm" install --omit=dev --omit=optional --no-audit --no-fund --silent
# Drop playwright's bundled browsers (we provide our own at ms-playwright/) and dev-only stuff
rm -rf node_modules/playwright/.local-browsers 2>/dev/null || true
rm -rf node_modules/playwright-core/.local-browsers 2>/dev/null || true
cd "$SCRIPT_DIR"

# ── Step 3: Copy Node runtime, binaries, Playwright browsers ───────────────────
echo ""
echo "[3/6] Copying Node.js, yt-dlp, ffmpeg, Chromium..."
rm -rf "$RESOURCES/node" "$RESOURCES/bin" "$RESOURCES/ms-playwright"
cp -R "$VENDOR/node"            "$RESOURCES/node"
cp -R "$VENDOR/bin"             "$RESOURCES/bin"
cp -R "$VENDOR/ms-playwright"   "$RESOURCES/ms-playwright"

# ── Step 4: Make sure binaries are executable & strip xattrs ───────────────────
echo ""
echo "[4/6] Setting permissions and stripping quarantine xattrs..."
chmod +x "$RESOURCES/node/bin/node" "$RESOURCES/bin/yt-dlp" "$RESOURCES/bin/ffmpeg"
chmod +x "$APP/Contents/MacOS/MediaGrab"

# Remove macOS quarantine attribute (so the app opens without "from internet" warning on this Mac)
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

# Self-sign with ad-hoc signature so binaries can run on Apple Silicon
# (Without this, downloaded binaries may be killed by Gatekeeper on first run)
echo ""
echo "[5/6] Ad-hoc signing the bundle..."
codesign --force --deep --sign - "$RESOURCES/node/bin/node" 2>/dev/null || true
codesign --force --deep --sign - "$RESOURCES/bin/yt-dlp"   2>/dev/null || true
codesign --force --deep --sign - "$RESOURCES/bin/ffmpeg"   2>/dev/null || true
find "$RESOURCES/ms-playwright" -name "*.dylib" -exec codesign --force --sign - {} \; 2>/dev/null || true
find "$RESOURCES/ms-playwright" -type f -perm +111 -exec codesign --force --sign - {} \; 2>/dev/null || true
codesign --force --deep --sign - "$APP" 2>/dev/null || true

echo ""
echo "  App size: $(du -sh "$APP" | awk '{print $1}')"

# ── Step 6: Build the .pkg installer ──────────────────────────────────────────
echo ""
echo "[6/6] Building .pkg installer..."
rm -rf "$BUILD"
mkdir -p "$BUILD/payload/Applications"
cp -R "$APP" "$BUILD/payload/Applications/"

pkgbuild \
  --root "$BUILD/payload" \
  --identifier "$BUNDLE_ID" \
  --version "$VERSION" \
  --install-location "/" \
  "$DIST/$PKG_NAME"

echo ""
echo "=========================================="
echo "  ✓ Build complete!"
echo ""
echo "  Output: $DIST/$PKG_NAME"
echo "  Size:   $(du -sh "$DIST/$PKG_NAME" | awk '{print $1}')"
echo "=========================================="
echo ""
echo "  Recipient should:"
echo "  1. Double-click the .pkg to install"
echo "  2. If macOS blocks it, go to System Settings → Privacy &amp; Security → 'Open Anyway'"
echo "  3. After install, run MediaGrab from Launchpad"
echo ""

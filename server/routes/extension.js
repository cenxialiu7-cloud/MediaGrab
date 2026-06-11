/**
 * Companion-extension info — powers the "Browser Extension" setup card in the
 * app. Returns the real on-disk paths (which vary by install location), the
 * derived extension ID, and whether the native host / capture token are in place,
 * so the UI can show accurate, copy-pasteable install steps.
 */

import { Router } from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';

const router = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const extensionDir = path.join(repoRoot, 'extension');
const nativeHostDir = path.join(repoRoot, 'native-host');
const installScript = path.join(nativeHostDir, 'install.js');

// In the packaged app a portable node sits next to the app dir
// (Resources/node on macOS, payload\node on Windows). Prefer it so users
// without a system `node` can still run the installer.
function resolveNodeBin() {
  const candidates = process.platform === 'win32'
    ? [path.join(repoRoot, '..', 'node', 'node.exe')]
    : [path.join(repoRoot, '..', 'node', 'bin', 'node')];
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch {} }
  return 'node';
}

// Extension ID = first 16 bytes of sha256(SPKI DER public key) mapped 0-f → a-p.
function computeExtensionId() {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf-8'));
    if (!manifest.key) return null;
    const hash = crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest();
    let id = '';
    for (let i = 0; i < 16; i++) {
      id += String.fromCharCode(97 + (hash[i] >> 4));
      id += String.fromCharCode(97 + (hash[i] & 0x0f));
    }
    return id;
  } catch { return null; }
}

// Is the native messaging host registered in any Chromium-family browser?
function nativeHostRegistered() {
  const home = os.homedir();
  const dirs = process.platform === 'darwin'
    ? ['Google/Chrome', 'Chromium', 'Microsoft Edge', 'BraveSoftware/Brave-Browser']
        .map(b => path.join(home, 'Library', 'Application Support', b, 'NativeMessagingHosts'))
    : ['google-chrome', 'chromium', 'microsoft-edge', 'BraveSoftware/Brave-Browser']
        .map(b => path.join(home, '.config', b, 'NativeMessagingHosts'));
  return dirs.some(d => {
    try { return fs.existsSync(path.join(d, 'com.mediagrab.host.json')); } catch { return false; }
  });
}

router.get('/info', (req, res) => {
  const nodeBin = resolveNodeBin();
  const installCmd = nodeBin === 'node'
    ? `node "${installScript}"`
    : `"${nodeBin}" "${installScript}"`;
  res.json({
    available: fs.existsSync(path.join(extensionDir, 'manifest.json')),
    extensionDir,
    installScript,
    installCmd,
    extensionId: computeExtensionId(),
    nativeHostRegistered: nativeHostRegistered(),
    tokenPresent: fs.existsSync(path.join(os.homedir(), '.mediagrab', 'capture-token')),
    readme: path.join(extensionDir, 'README.md'),
  });
});

export default router;

/**
 * Companion-extension info + install helpers — powers the "Browser Extension"
 * setup card in the app. Returns the real on-disk paths (which vary by install
 * location), the derived extension ID, and whether the native host / capture
 * token are in place, so the UI can show accurate, copy-pasteable steps.
 *
 * In the packaged app the extension is staged OUT of the .app bundle to the
 * writable data dir (see utils/extensionStaging.js) so Chrome's "Load unpacked"
 * picker can reach it — /info returns that navigable path.
 */

import { Router } from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { resolveExtensionDir } from '../utils/extensionStaging.js';

const router = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
// The native-host installer is RUN (not loaded by Chrome), so it can stay in the
// bundle — its extension ID / allowed_origins come from the manifest key, which
// is identical in the bundled and staged copies.
const nativeHostDir = path.join(repoRoot, 'native-host');
const installScript = path.join(nativeHostDir, 'install.js');

// The folder the user must point Chrome's "Load unpacked" at — staged copy when
// packaged (navigable), repo copy in dev.
function currentExtensionDir() {
  try { return resolveExtensionDir(); } catch { return { dir: path.join(repoRoot, 'extension'), staged: false }; }
}

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
function computeExtensionId(extensionDir) {
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

// ── CSRF guard for the state-changing POST endpoints below ──────────────────
// The server binds 127.0.0.1, but a web page the user is visiting can still
// POST to localhost. cors() reflects all origins, so we cannot rely on it.
// Same-origin POSTs from OUR SPA always carry Origin: http://localhost:<port>
// (browsers always send Origin on POST). Require it to be exactly a local
// origin — this rejects cross-site pages (Origin: https://evil.com),
// sandboxed iframes (Origin: null) AND Origin-less requests. The launcher's
// curl POST to /api/quit is unaffected — that route is intentionally NOT gated.
const PORT = process.env.PORT || 9800;
const LOCAL_ORIGINS = new Set([
  `http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`,
]);
function localOnly(req, res, next) {
  const origin = req.headers.origin;
  if (!origin || !LOCAL_ORIGINS.has(origin)) {
    return res.status(403).json({ error: 'local origin required' });
  }
  next();
}

router.get('/info', (req, res) => {
  const { dir: extensionDir, staged } = currentExtensionDir();
  const nodeBin = resolveNodeBin();
  const installCmd = nodeBin === 'node'
    ? `node "${installScript}"`
    : `"${nodeBin}" "${installScript}"`;
  res.json({
    available: fs.existsSync(path.join(extensionDir, 'manifest.json')),
    extensionDir,
    staged,
    platform: process.platform,
    installScript,
    installCmd,
    extensionId: computeExtensionId(extensionDir),
    nativeHostRegistered: nativeHostRegistered(),
    tokenPresent: fs.existsSync(path.join(os.homedir(), '.mediagrab', 'capture-token')),
    readme: path.join(extensionDir, 'README.md'),
  });
});

// POST /api/extension/reveal — open a file-manager window at the (server-known)
// extension folder so the user can drag it into chrome://extensions or paste
// its path. The path is NEVER taken from the request (would be an "open Finder
// anywhere" primitive); it's the server-computed staged dir.
router.post('/reveal', localOnly, (req, res) => {
  const { dir: extensionDir } = currentExtensionDir();
  if (!fs.existsSync(extensionDir)) return res.status(404).json({ error: 'extension folder not found' });
  let cmd, args;
  if (process.platform === 'darwin') { cmd = 'open'; args = ['-R', extensionDir]; }        // reveal, folder selected
  else if (process.platform === 'win32') { cmd = 'explorer'; args = ['/select,', extensionDir]; }
  else { cmd = 'xdg-open'; args = [extensionDir]; }
  try {
    // Array args (no shell) → the space in "Application Support" is one argv item.
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});   // don't crash if the file manager is missing
    child.unref();
    res.json({ ok: true, dir: extensionDir });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

// POST /api/extension/install-host — run the native-host installer (the step-1
// terminal command) with the bundled node, so the user never opens a terminal.
router.post('/install-host', localOnly, (req, res) => {
  const nodeBin = resolveNodeBin();
  let out = '';
  try {
    const child = spawn(nodeBin, [installScript], { env: process.env });   // array args, no shell
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('error', (e) => res.status(500).json({ ok: false, error: String(e && e.message || e) }));
    child.on('close', (code) => {
      if (res.headersSent) return;
      res.json({
        ok: code === 0,
        exitCode: code,
        registered: nativeHostRegistered(),
        output: out.slice(0, 4000),
      });
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
});

export default router;

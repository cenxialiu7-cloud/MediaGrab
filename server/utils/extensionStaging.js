/**
 * Stage the companion extension OUT of the read-only .app bundle so Chrome's
 * "Load unpacked" folder picker can actually reach it.
 *
 * WHY: in the packaged app the extension sits at
 *   /Applications/MediaGrab.app/Contents/Resources/app/extension
 * Finder treats a .app as an opaque PACKAGE, so on other users' Macs the
 * NSOpenPanel used by "Load unpacked" cannot navigate into it (and Finder
 * search doesn't index inside bundles). Copying it to a normal folder under the
 * user-writable data dir fixes that.
 *
 * SAFE because the extension ID is derived from manifest.json's "key" (not the
 * load path), so loading from the staged copy keeps the SAME id
 * (kpbhgcoabnkeapehoekebbjangfphjfn) and the native-messaging host's
 * allowed_origins still matches. We copy manifest.json verbatim to preserve it.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/utils -> repo/app root -> extension
const bundledExtensionDir = path.resolve(__dirname, '..', '..', 'extension');

export function isPackaged() {
  return process.env.NODE_ENV === 'production';
}

// Same writable location the launcher already creates (mirrors userDataDir() in
// server/index.js). macOS: ~/Library/Application Support/MediaGrab.
export function userDataDir() {
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || os.homedir(), 'MediaGrab');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'MediaGrab');
  return path.join(os.homedir(), '.local', 'share', 'MediaGrab');
}

export function stagedExtensionDir() {
  return path.join(userDataDir(), 'extension');
}

function manifestVersion(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8')).version || ''; }
  catch { return null; }
}

/**
 * In dev (NODE_ENV!=='production') → use the repo's extension/ (already navigable).
 * In prod → copy the bundled extension into the writable dir and return that path.
 * Never throws: on any failure returns the best path that actually has a manifest,
 * so the caller (and /api/extension/info) degrade gracefully.
 *
 * Returns { dir, staged }.
 */
export function stageExtension() {
  if (!isPackaged()) return { dir: bundledExtensionDir, staged: false };

  const src = bundledExtensionDir;
  const dest = stagedExtensionDir();
  const srcHasManifest = fs.existsSync(path.join(src, 'manifest.json'));
  const destHasManifest = () => fs.existsSync(path.join(dest, 'manifest.json'));

  // Locally-built pkgs (build-pkg.sh historically) may not bundle extension/ —
  // fall back to whatever exists rather than failing.
  if (!srcHasManifest) {
    return { dir: destHasManifest() ? dest : src, staged: destHasManifest() };
  }

  try {
    const srcVer = manifestVersion(src);
    const destVer = manifestVersion(dest);
    // Up to date → DON'T touch the folder (Chrome may have it loaded; avoid a
    // pointless in-place churn / reload prompt).
    if (destHasManifest() && srcVer && srcVer === destVer) {
      return { dir: dest, staged: true };
    }

    // Copy into a temp sibling, then swap into place with renames (atomic on the
    // same volume) so Chrome never sees a half-written extension dir.
    const tmp = dest + '.tmp-' + process.pid;
    const old = dest + '.old-' + process.pid;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(old, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, tmp, { recursive: true });
    if (destHasManifest()) { fs.renameSync(dest, old); }
    fs.renameSync(tmp, dest);
    fs.rmSync(old, { recursive: true, force: true });
    return { dir: dest, staged: true };
  } catch (e) {
    console.warn('[mediagrab] stageExtension failed:', e && e.message);
    return { dir: destHasManifest() ? dest : src, staged: destHasManifest() };
  }
}

/**
 * Resolve which extension dir /api/extension/info should point at WITHOUT
 * copying (staging already ran at startup). Prod → staged if present, else
 * bundled; dev → bundled.
 */
export function resolveExtensionDir() {
  if (!isPackaged()) return { dir: bundledExtensionDir, staged: false };
  const dest = stagedExtensionDir();
  if (fs.existsSync(path.join(dest, 'manifest.json'))) return { dir: dest, staged: true };
  return { dir: bundledExtensionDir, staged: false };
}

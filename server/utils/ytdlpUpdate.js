/**
 * Keep yt-dlp fresh without touching the (read-only) bundled binary.
 *
 * yt-dlp's extractors break constantly as sites change; a months-old binary
 * silently fails on Twitter/X, Instagram, etc. `yt-dlp -U` can't help in the
 * packaged app because the bundled binary lives in a read-only location
 * (/Applications/…). So instead we download the latest official standalone
 * binary into a USER-WRITABLE dir (~/.mediagrab/bin) and prepend that dir to
 * PATH — every spawn('yt-dlp') then prefers the fresh copy. First run still uses
 * the bundled/system yt-dlp; subsequent runs use the updated one.
 *
 * Best-effort and non-blocking: any failure leaves the existing yt-dlp in place.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

const BIN_DIR = path.join(os.homedir(), '.mediagrab', 'bin');
const MARKER = path.join(BIN_DIR, '.last-check');
const DAY_MS = 24 * 60 * 60 * 1000;

// Platform → (release asset name, local binary name).
function assetInfo() {
  if (process.platform === 'win32') return { asset: 'yt-dlp.exe', bin: 'yt-dlp.exe' };
  if (process.platform === 'darwin') return { asset: 'yt-dlp_macos', bin: 'yt-dlp' };
  return { asset: 'yt-dlp', bin: 'yt-dlp' };   // linux
}

/** Prepend the writable bin dir to PATH so a downloaded yt-dlp wins. Idempotent. */
export function prependBinToPath() {
  try {
    fs.mkdirSync(BIN_DIR, { recursive: true });
    const sep = process.platform === 'win32' ? ';' : ':';
    const parts = (process.env.PATH || '').split(sep);
    if (!parts.includes(BIN_DIR)) process.env.PATH = BIN_DIR + sep + (process.env.PATH || '');
  } catch {}
}

function dueForCheck() {
  try {
    const t = Number(fs.readFileSync(MARKER, 'utf-8').trim());
    if (Number.isFinite(t) && Date.now() - t < DAY_MS) return false;
  } catch {}
  return true;
}

/**
 * Download the latest yt-dlp into ~/.mediagrab/bin, at most once per day.
 * Non-blocking, best-effort — resolves (never rejects) so startup is unaffected.
 */
export async function maybeUpdateYtdlp() {
  try {
    if (!dueForCheck()) return;
    fs.mkdirSync(BIN_DIR, { recursive: true });
    // Stamp the marker up-front so a slow/looping failure can't re-download all day.
    try { fs.writeFileSync(MARKER, String(Date.now())); } catch {}

    const { asset, bin } = assetInfo();
    const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`;
    const res = await fetch(url, { redirect: 'follow' });
    if (!res || !res.ok) return;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1_000_000) return;   // sanity: real binary is tens of MB

    const dest = path.join(BIN_DIR, bin);
    const tmp = dest + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, buf);
    if (process.platform !== 'win32') { try { fs.chmodSync(tmp, 0o755); } catch {} }
    fs.renameSync(tmp, dest);   // atomic swap

    // Verify it actually runs; if not, remove it so we fall back to the old one.
    const ok = await runsOk(dest);
    if (!ok) { try { fs.unlinkSync(dest); } catch {} return; }
    console.log('[mediagrab] yt-dlp updated →', dest);
  } catch {
    /* best-effort */
  }
}

function runsOk(binPath) {
  return new Promise((resolve) => {
    try {
      const p = spawn(binPath, ['--version'], { timeout: 15000 });
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.on('error', () => resolve(false));
      p.on('close', (code) => resolve(code === 0 && /\d{4}\.\d/.test(out)));
    } catch { resolve(false); }
  });
}

/**
 * Shared secret for the companion-extension capture endpoint.
 *
 * The native messaging host reads this token and includes it on its localhost
 * POST to /api/capture/download. A random web page can reach localhost but
 * CANNOT read this file, so the token blocks web-origin CSRF against the
 * capture endpoint. Generated once, persisted in ~/.mediagrab/capture-token.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const TOKEN_FILE = path.join(os.homedir(), '.mediagrab', 'capture-token');

let cached = null;

export function getCaptureToken() {
  if (cached) return cached;
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const t = fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
      if (t) { cached = t; return cached; }
    }
  } catch {}
  // Generate + persist (0600 so only this user can read it).
  const token = crypto.randomBytes(24).toString('hex');
  try {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
    try { fs.chmodSync(TOKEN_FILE, 0o600); } catch {}
  } catch {}
  cached = token;
  return cached;
}

/** Constant-time compare to avoid timing leaks on the token check. */
export function isValidCaptureToken(provided) {
  if (!provided) return false;
  const expected = getCaptureToken();
  const a = Buffer.from(String(provided));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

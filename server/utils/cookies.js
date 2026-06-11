/**
 * Shared cookie configuration — single source of truth for "logged-in" downloads.
 *
 * Both yt-dlp and the Playwright pipeline read the user's cookie choice from
 * ~/.mediagrab/settings.json here, so the whole download chain stays authenticated
 * without every route/frontend call having to thread cookies through.
 *
 * Two cookie sources are supported (file takes precedence):
 *   - cookiesFile   : path to a Netscape-format cookies.txt (exported via a browser
 *                     extension like "Get cookies.txt"). Works for BOTH yt-dlp
 *                     (--cookies <file>) and Playwright (parsed → context.addCookies),
 *                     so it's the only source that reaches login-gated streaming /
 *                     course sites that go through the Playwright/m3u8 path.
 *   - cookies       : a browser name (chrome/firefox/safari/edge). Maps to yt-dlp's
 *                     --cookies-from-browser. Playwright has no equivalent, so this
 *                     source only authenticates the yt-dlp path.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const SETTINGS_FILE = path.join(os.homedir(), '.mediagrab', 'settings.json');

const VALID_BROWSERS = new Set(['chrome', 'firefox', 'safari', 'edge', 'brave', 'chromium', 'opera', 'vivaldi']);

// Playwright rejects (throws for the WHOLE addCookies batch) any cookie whose
// expires exceeds this — kMaxCookieExpiresDateInSeconds (year 9999). Many
// cookies.txt exporters write far-future / out-of-unit expiries, so we clamp.
const MAX_COOKIE_EXPIRES = 253402300799;

/**
 * Read the current cookie configuration from settings.json.
 * Returns { cookiesFile, cookiesBrowser } — either may be '' / null.
 */
export function getCookieConfig() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      const cookiesFile = typeof s.cookiesFile === 'string' ? s.cookiesFile.trim() : '';
      const cookiesBrowser = typeof s.cookies === 'string' ? s.cookies.trim().toLowerCase() : '';
      return {
        cookiesFile: cookiesFile && fs.existsSync(cookiesFile) ? cookiesFile : '',
        cookiesBrowser: VALID_BROWSERS.has(cookiesBrowser) ? cookiesBrowser : '',
      };
    }
  } catch {}
  return { cookiesFile: '', cookiesBrowser: '' };
}

/**
 * yt-dlp CLI args for the configured cookie source.
 * @param {string} [overrideBrowser] explicit browser name from a request — wins
 *   over settings when provided (kept for backward compatibility / per-call use).
 * @param {object} [opts]
 * @param {boolean} [opts.fileOnly] when true, ONLY use a cookies.txt file and
 *   ignore the browser-name source. Use this on latency-sensitive paths (e.g. the
 *   probe, which has a tight 15s budget): reading a file is instant, but
 *   --cookies-from-browser does a cold read of the whole browser cookie DB on
 *   macOS that can blow past the timeout and spuriously fail an otherwise-public
 *   probe. Downloads (no/loose timeout) still use the full source.
 * @returns {string[]} e.g. ['--cookies', '/path/cookies.txt'] or
 *   ['--cookies-from-browser', 'chrome'] or [].
 */
export function ytdlpCookieArgs(overrideBrowser, opts = {}) {
  const { cookiesFile, cookiesBrowser } = getCookieConfig();
  // A cookies.txt file is the most reliable source — prefer it.
  if (cookiesFile) return ['--cookies', cookiesFile];
  if (opts.fileOnly) return [];
  const browser = (overrideBrowser && VALID_BROWSERS.has(String(overrideBrowser).toLowerCase()))
    ? String(overrideBrowser).toLowerCase()
    : cookiesBrowser;
  if (browser) return ['--cookies-from-browser', browser];
  return [];
}

/**
 * Parse a Netscape-format cookies.txt into Playwright cookie objects suitable
 * for context.addCookies(). Returns [] on any problem (never throws).
 *
 * Netscape line format (tab-separated):
 *   domain  includeSubdomains  path  secure  expiry  name  value
 * Lines beginning with '#' are comments, except the '#HttpOnly_' prefix which
 * marks an http-only cookie (used by yt-dlp and most exporters).
 */
export function parseNetscapeCookies(text) {
  const out = [];
  if (!text) return out;
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine;
    if (!line || !line.trim()) continue;

    let httpOnly = false;
    if (line.startsWith('#HttpOnly_')) {
      httpOnly = true;
      line = line.slice('#HttpOnly_'.length);
    } else if (line.startsWith('#')) {
      continue; // real comment
    }

    const parts = line.split('\t');
    if (parts.length < 7) continue;

    const [domain, , cookiePath, secure, expiry, name, ...valueParts] = parts;
    const value = valueParts.join('\t'); // value may legitimately contain tabs? keep safe
    if (!domain || !name) continue;

    const expires = Number(expiry);
    out.push({
      name,
      value,
      domain,
      path: cookiePath || '/',
      // 0 / missing expiry = session cookie → -1 (Playwright's session sentinel).
      // Clamp far-future expiries so they don't make addCookies throw the batch.
      expires: Number.isFinite(expires) && expires > 0 ? Math.min(expires, MAX_COOKIE_EXPIRES) : -1,
      httpOnly,
      secure: secure === 'TRUE',
    });
  }
  return out;
}

/**
 * Load cookies for the Playwright browser context (context.addCookies(...)).
 * Only the cookies.txt file source is usable here — a browser NAME can't be fed
 * to Playwright. Returns [] when no file is configured or parsing fails.
 */
export function loadCookiesForPlaywright() {
  const { cookiesFile } = getCookieConfig();
  if (!cookiesFile) return [];
  try {
    const text = fs.readFileSync(cookiesFile, 'utf-8');
    return parseNetscapeCookies(text);
  } catch {
    return [];
  }
}

/**
 * Apply the configured cookies.txt to a Playwright BrowserContext, if any.
 * Safe to call on every context — no-op when no file is configured.
 */
export async function applyCookiesToContext(context) {
  const cookies = loadCookiesForPlaywright();
  if (cookies.length === 0) return 0;
  try {
    await context.addCookies(cookies);
    return cookies.length;
  } catch {
    // addCookies is all-or-nothing: one malformed entry throws the whole batch
    // and we'd silently load ZERO cookies (incl. the session token). Fall back
    // to loading them one-by-one so the good ones still authenticate.
    let ok = 0;
    for (const c of cookies) {
      try { await context.addCookies([c]); ok++; } catch {}
    }
    if (ok < cookies.length) {
      // Count only — never log cookie names/values.
      console.warn(`[cookies] loaded ${ok}/${cookies.length} cookies (${cookies.length - ok} rejected by browser)`);
    }
    return ok;
  }
}

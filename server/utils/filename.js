/**
 * Shared output-filename sanitizer.
 *
 * Turns an arbitrary source string (usually a web page <title>, often a CJK
 * course name) into a safe cross-platform filename base (NO extension):
 *   - NFC-normalize so decomposed CJK / combining marks don't render as 亂碼
 *   - replace filesystem-illegal chars (\ / : * ? " < > | and control chars)
 *   - collapse whitespace, trim, drop trailing dots/spaces (Windows won't keep them)
 *   - truncate by CODE POINT (not UTF-16 unit) so a multibyte char is never cut in half
 *   - reject Windows reserved device names (CON, NUL, COM1…)
 *   - optional de-dup against a `used` Set (appends " (2)", " (3)"…)
 *
 * Pure function, no I/O. Callers append their own extension.
 */

const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function sanitizeFilename(name, { maxLen = 150, used } = {}) {
  let s = name == null ? '' : String(name);
  try { s = s.normalize('NFC'); } catch {}

  s = s
    .replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, ' ')  // illegal → space
    .replace(/\s+/g, ' ')                          // collapse runs of whitespace
    .trim()
    .replace(/[. ]+$/g, '');                       // no trailing dot/space

  // Truncate by code point so surrogate pairs / CJK never split.
  const cp = [...s];
  if (cp.length > maxLen) s = cp.slice(0, maxLen).join('').trim().replace(/[. ]+$/g, '');
  while (Buffer.byteLength(s,'utf8') > 180) s = [...s].slice(0,-1).join('');

  s = s.replace(/[. ]+$/g, '');
  if (!s) s = 'video';
  else if (WIN_RESERVED.test(s.split('.')[0])) s = `_${s}`;

  if (used) {
    const base = s;
    let n = 2;
    while (used.has(s.toLowerCase())) s = `${base} (${n++})`;
    used.add(s.toLowerCase());
  }
  return s;
}

/**
 * Sanitize a filename that already carries an extension (e.g. "課程.mp4"):
 * splits off a short trailing extension, sanitizes the base, rejoins.
 */
export function sanitizeWithExt(nameWithExt, opts = {}) {
  const s = nameWithExt == null ? '' : String(nameWithExt);
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(s);
  const ext = m ? m[0] : '';
  const base = ext ? s.slice(0, -ext.length) : s;
  return sanitizeFilename(base, opts) + ext.toLowerCase();
}

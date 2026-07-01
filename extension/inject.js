/**
 * MediaGrab page hook — injected into the page's MAIN world at document_start.
 *
 * Pure network sniffing (webRequest, in background.js) misses two big cases on
 * modern course players:
 *   - manifests fetched by the player's own JS (fetch/XHR) — common.
 *   - MSE players that feed segments straight into a SourceBuffer and expose
 *     only a blob: URL, so no manifest is ever requested over the network.
 *
 * This script (running in the page context) hooks fetch / XHR to surface hidden
 * manifest URLs, hooks navigator.requestMediaKeySystemAccess to flag DRM, and —
 * as a last resort — wraps MediaSource/SourceBuffer.appendBuffer to siphon the
 * raw media segments so they can be reassembled and downloaded ("record mode").
 *
 * It cannot use chrome.* (MAIN world) — it talks to the extension via
 * window.postMessage, relayed by bridge.js (ISOLATED world).
 */
(() => {
  if (window.__mediagrabHooked) return;
  window.__mediagrabHooked = true;

  const post = (msg) => { try { window.postMessage({ __mediagrab: 1, ...msg }, '*'); } catch {} };
  const MEDIA_RE = /\.m3u8(\?|$)|\.mpd(\?|$)|\.ism(\/|\?|$)|\.f4m(\?|$)|\/master\.json|\/playlist\.json|\/manifest(\/|\.|\?)/i;
  const abs = (u) => { try { return new URL(u, location.href).href; } catch { return null; } };
  const isMedia = (u) => typeof u === 'string' && MEDIA_RE.test(u);
  const seen = new Set();
  const reportMedia = (u) => { const a = abs(u); if (a && isMedia(a) && !seen.has(a)) { seen.add(a); post({ type: 'media', url: a }); } };

  // ── P2: hook fetch ──────────────────────────────────────────────────────
  const _fetch = window.fetch;
  if (typeof _fetch === 'function') {
    window.fetch = function (input) {
      try { reportMedia(typeof input === 'string' ? input : (input && input.url)); } catch {}
      return _fetch.apply(this, arguments);
    };
  }

  // ── P2: hook XMLHttpRequest ─────────────────────────────────────────────
  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { reportMedia(url); } catch {}
    return _open.apply(this, arguments);
  };

  // ── P3: DRM detection (EME) ─────────────────────────────────────────────
  const _rmksa = navigator.requestMediaKeySystemAccess;
  if (typeof _rmksa === 'function') {
    navigator.requestMediaKeySystemAccess = function (keySystem) {
      try { post({ type: 'drm', keySystem: String(keySystem || '') }); } catch {}
      return _rmksa.apply(this, arguments);
    };
  }

  // ── P4: MSE capture ("record mode") ─────────────────────────────────────
  // Wrap addSourceBuffer + appendBuffer to keep a copy of every media chunk.
  // HARD byte ceiling so a long video can't exhaust the tab's memory and crash.
  const MSE_CAP = 1500 * 1024 * 1024;   // 1.5 GB across all tracks
  const recorders = [];          // [{ id, mime, chunks:[ArrayBuffer], bytes }]
  let recId = 0;
  let mseTotal = 0;
  let mseTruncated = false;
  let lastReport = 0;
  const reportMse = () => {
    const now = Date.now();
    if (now - lastReport < 700 && !mseTruncated) return;   // throttle (but always report truncation)
    lastReport = now;
    post({ type: 'mse', tracks: recorders.length, bytes: mseTotal, truncated: mseTruncated });
  };

  const _addSB = window.MediaSource && MediaSource.prototype.addSourceBuffer;
  if (_addSB) {
    MediaSource.prototype.addSourceBuffer = function (mime) {
      const sb = _addSB.apply(this, arguments);
      try {
        const rec = { id: ++recId, mime: String(mime || ''), chunks: [], bytes: 0 };
        recorders.push(rec);
        const _append = sb.appendBuffer;
        sb.appendBuffer = function (data) {
          try {
            let buf = null;
            if (data instanceof ArrayBuffer) buf = data.slice(0);
            else if (data && data.buffer) buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
            if (buf && buf.byteLength) {
              if (mseTotal + buf.byteLength <= MSE_CAP) {
                rec.chunks.push(buf); rec.bytes += buf.byteLength; mseTotal += buf.byteLength; reportMse();
              } else if (!mseTruncated) {
                mseTruncated = true; reportMse();         // hit ceiling — stop hoarding
              }
            }
          } catch {}
          return _append.apply(this, arguments);
        };
      } catch {}
      return sb;
    };
  }

  // Assemble captured segments and download in-page (last resort). fMP4 streams
  // are usually playable as-is; TS may need a remux (noted in the UI).
  function extFor(mime) {
    if (/mp4|avc|mp4a/i.test(mime)) return 'mp4';
    if (/webm|vp8|vp9|opus/i.test(mime)) return 'webm';
    if (/mp2t|mpeg-ts/i.test(mime)) return 'ts';
    return 'bin';
  }
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || !d.__mediagrabCmd) return;
    if (d.cmd === 'recordDownload') {
      const title = (d.title || 'recording').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'recording';
      const live = recorders.filter((r) => r.bytes > 0);
      if (!live.length) { post({ type: 'recordResult', ok: false, error: 'no captured data' }); return; }
      try {
        live.forEach((r, i) => {
          const blob = new Blob(r.chunks, { type: r.mime || 'application/octet-stream' });
          const suffix = live.length > 1 ? `.track${i + 1}` : '';
          downloadBlob(blob, `${title}${suffix}.${extFor(r.mime)}`);
        });
        post({ type: 'recordResult', ok: true, tracks: live.length });
      } catch (err) {
        post({ type: 'recordResult', ok: false, error: String(err && err.message || err) });
      }
    }
  });

  post({ type: 'ready' });
})();

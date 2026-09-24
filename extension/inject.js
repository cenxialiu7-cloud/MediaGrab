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

  // Raw MSE append buffers are not complete recordings (seek, track changes,
  // DRM and missing init segments). Do not retain copies or promise an export.
  post({type:'ready'});
})();

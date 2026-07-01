/**
 * MediaGrab Companion — background service worker (MV3).
 *
 * Observes network requests (incl. those made from Web Workers and cross-origin
 * CDN iframes) in tabs the user has opted into, and remembers the media URLs +
 * the request headers (Referer / Cookie / User-Agent) the browser used. The
 * popup then hands the chosen stream to the MediaGrab app via the native host.
 *
 * Privacy: only fires for hosts the user explicitly granted (optional host
 * permissions). Captured headers live in chrome.storage.session (cleared when
 * the browser closes) and never leave the machine except via the native host
 * to the local MediaGrab server.
 */

// Media-host CDNs we request alongside a page's own origin when the user opts
// in, so cross-origin segments (e.g. Vimeo serves sat.cool's video from
// vimeocdn.com) are visible. The page's own origin is added dynamically.
// Media-host CDNs requested alongside a page's own origin on opt-in, so
// cross-origin segments are visible to webRequest. Covers the major course-video
// hosting platforms. The page's own origin is added dynamically; for any site
// these don't cover, the popup offers a one-click "grant broad access" upgrade.
const KNOWN_MEDIA_HOSTS = [
  '*://*.vimeo.com/*', '*://*.vimeocdn.com/*',
  '*://*.akamaized.net/*', '*://*.akamaihd.net/*',
  '*://*.cloudfront.net/*', '*://*.fastly.net/*',
  '*://*.cdn77.com/*', '*://*.cdn77.org/*',
  '*://*.wistia.com/*', '*://*.wistia.net/*', '*://*.wistia.io/*',
  '*://*.mux.com/*',
  '*://*.brightcove.net/*', '*://*.boltdns.net/*',
  '*://*.kaltura.com/*',
  '*://*.jwplayer.com/*', '*://*.jwpcdn.com/*', '*://*.jwplatform.com/*',
  '*://*.cloudflarestream.com/*', '*://*.videodelivery.net/*',
  '*://*.b-cdn.net/*', '*://*.bunnycdn.com/*', '*://*.mediadelivery.net/*'
];

// Bare domains derived from the host patterns — used to sanity-check URLs that
// the in-page hook reports (a hostile page could forge a media message).
const KNOWN_MEDIA_DOMAINS = KNOWN_MEDIA_HOSTS.map((p) => p.replace(/^\*:\/\/\*\./, '').replace(/\/\*$/, ''));
function hostAllowedForTab(url, tabOrigin) {
  try {
    if (broadGranted) return true;      // broad mode → trust media from any host
    const h = new URL(url).hostname.toLowerCase();
    if (tabOrigin) { try { if (h === new URL(tabOrigin).hostname.toLowerCase()) return true; } catch {} }
    return KNOWN_MEDIA_DOMAINS.some((d) => h === d || h.endsWith('.' + d));
  } catch { return false; }
}

// Generic stream patterns — no CDN names hardcoded. Content-Type matching (below)
// complements this for manifests whose URL has no recognizable extension.
const MANIFEST_RE = /\.m3u8(\?|$)|\.mpd(\?|$)|\.ism(\/|\?|$)|\.f4m(\?|$)|master\.json|playlist\.json/i;
const SEGMENT_RE  = /\/range\/prot\/|\.ts(\?|$)|\.m4s(\?|$)|\.aac(\?|$)|[\/_-]seg(ment)?[-_\d]|\/frag(ment)?[-_\d]/i;
const MEDIA_RE    = /\.m3u8(\?|$)|\.mpd(\?|$)|\.ism(\/|\?|$)|\.f4m(\?|$)|master\.json|playlist\.json|\.ts(\?|$)|\.m4s(\?|$)|\/range\/prot\/|vimeocdn\.com|\.mp4(\?|$)/i;

// Content-Type → kind. Catches manifests/segments served from any host even when
// the URL has no tell-tale extension (how all universal sniffers work). We do NOT
// classify a bare video/mp4 by content-type alone — that matches ad/background
// clips and floods the list; progressive .mp4 is still caught by URL pattern.
function classifyCt(ct) {
  if (!ct) return null;
  ct = ct.toLowerCase();
  if (/mpegurl|dash\+xml|\/f4m|sstr\+xml/.test(ct)) return 'manifest';
  if (/mp2t/.test(ct)) return 'segment';
  return null;
}

const SEG_CAP = 8000; // safety cap on stored segment URLs per tab

function classify(url) {
  if (MANIFEST_RE.test(url)) return 'manifest';
  if (SEGMENT_RE.test(url)) return 'segment';
  if (/vimeocdn\.com/i.test(url)) return 'segment';      // Vimeo v2 ranged mp4 chunks
  if (/\.mp4(\?|$)/i.test(url)) return 'mp4';
  return null;
}

// Identify the PRIMARY master manifest of a video (ignoring its signature) so we
// can detect when the page swaps to a different video — e.g. an SPA course site
// (sat.cool) switching lessons without changing the page URL. Variant playlists
// (per-quality) return null so they don't count as a new video.
function masterIdentity(url) {
  const v = /player\.vimeo\.com\/external\/(\d+)\.m3u8/i.exec(url);
  if (v) return 'vimeo:' + v[1];
  if (/\/master\.(m3u8|mpd|json)(\?|$)/i.test(url)) {
    try { const u = new URL(url); return u.origin + u.pathname; } catch { return url; }
  }
  return null;
}

const capKey = (tabId) => 'cap:' + tabId;

// ── opt-in gating ───────────────────────────────────────────────────────────
// Two modes:
//  - Per-site (default): only capture on sites the user explicitly enabled.
//  - Broad: once the user grants <all_urls>, capture on ANY site (like the
//    general-purpose sniffers) — the "comprehensive" mode.
let broadGranted = false;   // cached; refreshed on permission changes
function refreshBroad() {
  chrome.permissions.getAll((p) => {
    const o = (p && p.origins) || [];
    broadGranted = o.includes('<all_urls>') || o.includes('*://*/*');
  });
}
async function getEnabledOrigins() {
  const o = await chrome.storage.local.get('enabledOrigins');
  return o.enabledOrigins || [];
}
async function addEnabledOrigin(origin) {
  const set = new Set(await getEnabledOrigins());
  set.add(origin);
  await chrome.storage.local.set({ enabledOrigins: [...set] });
}
async function isEnabledTab(tabId) {
  try {
    const t = await chrome.tabs.get(tabId);
    if (!t || !t.url || !/^https?:/i.test(t.url)) return false;
    if (broadGranted) return true;                  // broad mode → any site
    const origin = new URL(t.url).origin;
    return (await getEnabledOrigins()).includes(origin);
  } catch { return false; }
}

// Derive enabled PAGE origins from the granted host permissions. This is the
// reliable path: chrome.permissions.request() (from the popup) opens a prompt
// that CLOSES the popup, so any popup code after the await never runs — but the
// host permission IS granted, and permissions.onAdded fires in the background.
// We treat every granted concrete site (not a wildcard CDN pattern) as enabled.
function patternToOrigin(p) {
  const m = /^(https?):\/\/([^*/][^/]*)\/?/.exec(p);   // concrete scheme + host, no '*'
  return m ? `${m[1]}://${m[2]}` : null;
}
async function syncEnabledFromPermissions() {
  let origins = [];
  try { origins = (await chrome.permissions.getAll()).origins || []; } catch {}
  for (const p of origins) {
    if (KNOWN_MEDIA_HOSTS.includes(p)) continue;        // shared CDN wildcard, not a site
    if (p.startsWith('*://') || /\/\/\*/.test(p)) continue;  // wildcard scheme/host
    const o = patternToOrigin(p);
    if (o) await addEnabledOrigin(o);
  }
}

async function getCap(tabId) {
  const k = capKey(tabId);
  const o = await chrome.storage.session.get(k);
  return o[k] || { manifests: [], segments: [], headers: {}, count: 0, primaryId: null, primaryManifestUrl: null, drm: null, mse: null };
}
async function setCap(tabId, c) {
  await chrome.storage.session.set({ [capKey(tabId)]: c });
}
async function patchCap(tabId, patch) {
  const c = await getCap(tabId);
  Object.assign(c, patch);
  await setCap(tabId, c);
}

async function updateBadge(tabId, c) {
  const n = (c.manifests.length || 0) + (c.segments.length ? 1 : 0);
  try {
    await chrome.action.setBadgeText({ tabId, text: n ? String(c.manifests.length || '•') : '' });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#16a34a' });
  } catch {}
}

// Shared capture — records a media URL (+ optional headers) into the tab's
// capture. Used by both webRequest listeners and the in-page fetch/XHR hook.
async function captureUrl(tabId, url, kind, headers) {
  if (!(await isEnabledTab(tabId))) return;             // only opted-in sites
  const c = await getCap(tabId);
  if (headers) c.headers = { ...c.headers, ...headers };
  if (kind === 'manifest') {
    const id = masterIdentity(url);
    if (id && id !== c.primaryId) {
      // New video's master manifest — page switched videos (e.g. SPA lesson
      // change, no URL change). Start fresh so the download targets THIS video.
      c.manifests = []; c.segments = [];
      c.primaryId = id; c.primaryManifestUrl = url;
    } else if (id && id === c.primaryId) {
      c.primaryManifestUrl = url;                        // same video → refresh signed URL
    }
    if (!c.manifests.includes(url)) c.manifests.push(url);
  } else {
    if (c.segments.length < SEG_CAP && !c.segments.includes(url)) c.segments.push(url);
  }
  c.count = c.manifests.length + c.segments.length;
  await setCap(tabId, c);
  updateBadge(tabId, c);
}

function pickHeaders(list) {
  const hdr = {};
  for (const h of list || []) {
    const n = h.name.toLowerCase();
    if (n === 'referer') hdr.Referer = h.value;
    else if (n === 'cookie') hdr.Cookie = h.value;
    else if (n === 'user-agent') hdr['User-Agent'] = h.value;
    else if (n === 'origin') hdr.Origin = h.value;
  }
  return hdr;
}

// A. Request side — capture URL (by pattern) + the request headers (Cookie/Referer/UA).
function onSendHeadersCapture(details) {
  if (details.tabId < 0 || !MEDIA_RE.test(details.url)) return;
  const kind = classify(details.url);
  if (!kind) return;
  captureUrl(details.tabId, details.url, kind, pickHeaders(details.requestHeaders));
}

// B. Response side — capture URL by Content-Type, so manifests served from any
// host with no tell-tale extension are still caught (headers come from A).
function onHeadersReceivedCapture(details) {
  if (details.tabId < 0) return;
  let ct = '';
  for (const h of details.responseHeaders || []) {
    if (h.name.toLowerCase() === 'content-type') { ct = h.value || ''; break; }
  }
  const kind = classifyCt(ct) || (MEDIA_RE.test(details.url) ? classify(details.url) : null);
  if (!kind) return;
  captureUrl(details.tabId, details.url, kind, null);
}

const WR_FILTER = { urls: ['<all_urls>'] };
const WR_REQ_EXTRA = ['requestHeaders', 'extraHeaders'];
const WR_RES_EXTRA = ['responseHeaders'];   // Content-Type is a plain header — no extraHeaders needed

// Register the webRequest listeners ONLY while we hold a host permission.
// Registering with zero host permissions makes Chrome warn and the listener
// can't fire anyway. Per-site opt-in grants host perms at runtime — so
// (un)register on permission changes and on service-worker wake.
function hasHostPerms(perms) {
  return !!(perms && Array.isArray(perms.origins) && perms.origins.length > 0);
}
function ensureCaptureListeners() {
  if (!chrome.webRequest.onSendHeaders.hasListener(onSendHeadersCapture))
    chrome.webRequest.onSendHeaders.addListener(onSendHeadersCapture, WR_FILTER, WR_REQ_EXTRA);
  if (!chrome.webRequest.onHeadersReceived.hasListener(onHeadersReceivedCapture))
    chrome.webRequest.onHeadersReceived.addListener(onHeadersReceivedCapture, WR_FILTER, WR_RES_EXTRA);
}
function removeCaptureListeners() {
  if (chrome.webRequest.onSendHeaders.hasListener(onSendHeadersCapture))
    chrome.webRequest.onSendHeaders.removeListener(onSendHeadersCapture);
  if (chrome.webRequest.onHeadersReceived.hasListener(onHeadersReceivedCapture))
    chrome.webRequest.onHeadersReceived.removeListener(onHeadersReceivedCapture);
}
function syncCaptureListener() {
  chrome.permissions.getAll((perms) => {
    if (hasHostPerms(perms)) ensureCaptureListeners();
    else removeCaptureListeners();
  });
}

// Inject the page hook (fetch/XHR/MSE/EME) + bridge into the sites the user
// enabled — catches hidden manifests fetched by the player's JS and, as a last
// resort, MSE segments that never hit the network as a manifest.
async function syncContentScripts() {
  // Broad mode → inject into EVERY site (all frames), like the general sniffers.
  // Per-site mode → only the enabled origins.
  const matches = broadGranted
    ? ['<all_urls>']
    : (await getEnabledOrigins()).map((o) => o + '/*').filter((m) => /^https?:\/\//.test(m));
  const ids = ['mg-inject', 'mg-bridge'];
  try {
    // Always clear then re-register — avoids the "update requires an existing id"
    // trap and any half-registered state from an earlier partial failure.
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids }).catch(() => []);
    if (existing.length) {
      try { await chrome.scripting.unregisterContentScripts({ ids: existing.map((s) => s.id) }); } catch {}
    }
    if (!matches.length) return;
    await chrome.scripting.registerContentScripts([
      { id: 'mg-inject', matches, js: ['inject.js'], runAt: 'document_start', world: 'MAIN', allFrames: true },
      { id: 'mg-bridge', matches, js: ['bridge.js'], runAt: 'document_start', allFrames: true },
    ]);
  } catch (e) {
    console.warn('[mediagrab] content-script registration failed:', e && e.message);
  }
}

// Registered content scripts only apply to FUTURE page loads — inject into the
// currently-open enabled tab too, so the hooks go live without a manual reload
// (a reload still catches the earliest manifest most reliably).
async function injectIntoActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || !tab.url || !/^https?:/i.test(tab.url)) return;
    if (!(await isEnabledTab(tab.id))) return;
    const target = { tabId: tab.id, allFrames: true };
    chrome.scripting.executeScript({ target, world: 'MAIN', files: ['inject.js'] }).catch(() => {});
    chrome.scripting.executeScript({ target, files: ['bridge.js'] }).catch(() => {});
  } catch {}
}

function onPermsChanged() {
  refreshBroad();
  syncCaptureListener();
  syncEnabledFromPermissions().then(syncContentScripts);
}

onPermsChanged();                                        // on SW startup / wake
chrome.permissions.onAdded.addListener(() => { onPermsChanged(); setTimeout(injectIntoActiveTab, 300); });
chrome.permissions.onRemoved.addListener(() => { onPermsChanged(); });
chrome.runtime.onInstalled.addListener(onPermsChanged);
chrome.runtime.onStartup.addListener(onPermsChanged);

// Reset a tab's capture when it navigates to a new page.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    chrome.storage.session.remove(capKey(tabId));
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(capKey(tabId)).catch(() => {});
});

// Popup asks for the current tab's capture / triggers download via native host.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === 'getCapture') {
      sendResponse(await getCap(msg.tabId));
    } else if (msg.type === 'diag') {
      let granted = [];
      try { granted = (await chrome.permissions.getAll()).origins || []; } catch {}
      sendResponse({
        listenerActive: chrome.webRequest.onSendHeaders.hasListener(onSendHeadersCapture),
        grantedOrigins: granted,
        enabledOrigins: await getEnabledOrigins(),
      });
    } else if (msg.type === 'enableSite') {
      if (msg.origin && /^https?:\/\//.test(msg.origin)) await addEnabledOrigin(msg.origin);
      sendResponse({ ok: true });
    } else if (msg.type === 'clearCapture') {
      await chrome.storage.session.remove(capKey(msg.tabId));
      sendResponse({ ok: true });
    } else if (msg.type === 'injected') {
      // From the in-page hook (via bridge.js): hidden manifests, DRM flag, MSE bytes.
      const tabId = _sender.tab && _sender.tab.id;
      const p = msg.payload || {};
      if (tabId != null && await isEnabledTab(tabId)) {
        if (p.type === 'media' && p.url) {
          // Guard against a hostile page forging a media URL: only accept the
          // page's own origin or a known media CDN.
          let tabOrigin = '';
          try { const t = await chrome.tabs.get(tabId); tabOrigin = (t && t.url) ? new URL(t.url).origin : ''; } catch {}
          if (hostAllowedForTab(p.url, tabOrigin)) await captureUrl(tabId, p.url, classify(p.url) || 'manifest', null);
        }
        else if (p.type === 'drm' && p.keySystem) await patchCap(tabId, { drm: p.keySystem });
        else if (p.type === 'mse') await patchCap(tabId, { mse: { tracks: p.tracks || 0, bytes: p.bytes || 0, truncated: !!p.truncated } });
      }
      sendResponse({ ok: true });
    } else if (msg.type === 'recordDownload') {
      // Tell the in-page hook to assemble captured MSE segments and save them.
      try { chrome.tabs.sendMessage(msg.tabId, { type: 'toPage', cmd: { cmd: 'recordDownload', title: msg.title } }); } catch {}
      sendResponse({ ok: true });
    } else if (msg.type === 'nativeDownload') {
      chrome.runtime.sendNativeMessage('com.mediagrab.host', msg.payload, (resp) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse(resp || { ok: false, error: 'no response from native host' });
        }
      });
    } else {
      sendResponse({ ok: false, error: 'unknown message' });
    }
  })();
  return true; // async sendResponse
});

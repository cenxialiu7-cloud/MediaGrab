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
const KNOWN_MEDIA_HOSTS = [
  '*://*.vimeo.com/*',        // player.vimeo.com (HLS .m3u8 manifest), captions.cloud.vimeo.com
  '*://*.vimeocdn.com/*',
  '*://*.akamaized.net/*',
  '*://*.cloudfront.net/*',
  '*://*.cdn77.com/*',
  '*://*.bunnycdn.com/*',
  '*://*.b-cdn.net/*',
  '*://*.fastly.net/*'
];

const MANIFEST_RE = /master\.json|\/playlist\.json|\.m3u8(\?|$)|\.mpd(\?|$)/i;
const SEGMENT_RE  = /\/range\/prot\/|\.ts(\?|$)|\.m4s(\?|$)|[\/_-]seg(ment)?[-_\d]/i;
const MEDIA_RE    = /\.m3u8(\?|$)|\.mpd(\?|$)|master\.json|playlist\.json|\.ts(\?|$)|\.m4s(\?|$)|\/range\/prot\/|vimeocdn\.com|\.mp4(\?|$)/i;

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
// Host permission for shared CDNs (vimeocdn…) is necessarily broad, so we
// SECOND-gate on the tab's page origin: only capture when the user explicitly
// enabled that exact site. Keeps the "per-site opt-in" promise real.
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
    if (!t || !t.url) return false;                 // url unreadable → not an opted-in site
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
  return o[k] || { manifests: [], segments: [], headers: {}, count: 0, primaryId: null, primaryManifestUrl: null };
}
async function setCap(tabId, c) {
  await chrome.storage.session.set({ [capKey(tabId)]: c });
}

async function updateBadge(tabId, c) {
  const n = (c.manifests.length || 0) + (c.segments.length ? 1 : 0);
  try {
    await chrome.action.setBadgeText({ tabId, text: n ? String(c.manifests.length || '•') : '' });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#16a34a' });
  } catch {}
}

// Capture request headers — needs 'extraHeaders' to read Cookie/Referer.
function onSendHeadersCapture(details) {
  if (details.tabId < 0) return;
  if (!MEDIA_RE.test(details.url)) return;
  const kind = classify(details.url);
  if (!kind) return;

  const hdr = {};
  for (const h of details.requestHeaders || []) {
    const n = h.name.toLowerCase();
    if (n === 'referer') hdr.Referer = h.value;
    else if (n === 'cookie') hdr.Cookie = h.value;
    else if (n === 'user-agent') hdr['User-Agent'] = h.value;
    else if (n === 'origin') hdr.Origin = h.value;
  }

  // Fire-and-forget async update (listener itself is non-blocking).
  (async () => {
    if (!(await isEnabledTab(details.tabId))) return;   // only opted-in sites
    const c = await getCap(details.tabId);
    c.headers = { ...c.headers, ...hdr };
    if (kind === 'manifest') {
      const id = masterIdentity(details.url);
      if (id && id !== c.primaryId) {
        // A new video's master manifest — the page switched videos (e.g. an SPA
        // lesson change with no URL change). Start fresh so the download targets
        // THIS video, not an accumulated pile from previously-viewed ones.
        c.manifests = [];
        c.segments = [];
        c.primaryId = id;
        c.primaryManifestUrl = details.url;
      } else if (id && id === c.primaryId) {
        c.primaryManifestUrl = details.url;   // same video → refresh signed URL
      }
      if (!c.manifests.includes(details.url)) c.manifests.push(details.url);
    } else {
      if (c.segments.length < SEG_CAP && !c.segments.includes(details.url)) c.segments.push(details.url);
    }
    c.count = c.manifests.length + c.segments.length;
    await setCap(details.tabId, c);
    updateBadge(details.tabId, c);
  })();
}

const WR_FILTER = { urls: ['<all_urls>'] };
const WR_EXTRA = ['requestHeaders', 'extraHeaders'];

// Register the webRequest listener ONLY while we actually hold a host permission.
// Registering it with zero host permissions makes Chrome warn ("You need to
// request host permissions … webRequest") and the listener can't fire anyway.
// With per-site opt-in, host perms arrive at runtime — so (un)register on
// permission changes, and re-register on service-worker wake if any are granted.
function hasHostPerms(perms) {
  return !!(perms && Array.isArray(perms.origins) && perms.origins.length > 0);
}
function ensureCaptureListener() {
  if (!chrome.webRequest.onSendHeaders.hasListener(onSendHeadersCapture)) {
    chrome.webRequest.onSendHeaders.addListener(onSendHeadersCapture, WR_FILTER, WR_EXTRA);
  }
}
function syncCaptureListener() {
  chrome.permissions.getAll((perms) => {
    if (hasHostPerms(perms)) ensureCaptureListener();
    else if (chrome.webRequest.onSendHeaders.hasListener(onSendHeadersCapture)) {
      chrome.webRequest.onSendHeaders.removeListener(onSendHeadersCapture);
    }
  });
}

function onPermsChanged() { syncCaptureListener(); syncEnabledFromPermissions(); }

onPermsChanged();                                        // on SW startup / wake
chrome.permissions.onAdded.addListener(onPermsChanged);
chrome.permissions.onRemoved.addListener(syncCaptureListener);
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
      if (msg.origin) await addEnabledOrigin(msg.origin);
      sendResponse({ ok: true });
    } else if (msg.type === 'clearCapture') {
      await chrome.storage.session.remove(capKey(msg.tabId));
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

/* MediaGrab Companion — popup logic */

// Must match KNOWN_MEDIA_HOSTS in background.js — the major course-video CDNs.
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

const $ = (id) => document.getElementById(id);
const setStatus = (msg, cls = '') => { const s = $('status'); s.textContent = msg; s.className = 'status ' + cls; };

let tab = null;
let origin = null;

function originPattern(url) {
  try { const u = new URL(url); return `${u.protocol}//${u.hostname}/*`; } catch { return null; }
}

function pickManifest(manifests) {
  if (!manifests || !manifests.length) return null;
  const score = (u) =>
    /wistia\.(com|net)\/(embed\/)?(iframe|medias)\/[a-z0-9]{10}/i.test(u) ? 6 : // Wistia id → yt-dlp extractor
    /player\.vimeo\.com\/external\/\d+\.m3u8/i.test(u) ? 5 :   // Vimeo HLS master
    /master\.json/i.test(u) ? 4 : /\.m3u8/i.test(u) ? 3 :
    /\.mpd/i.test(u) ? 2 : /playlist\.json/i.test(u) ? 1 : 0;
  return [...manifests].sort((a, b) => score(b) - score(a))[0];
}
function mediaTypeOf(url) {
  if (/\.m3u8/i.test(url)) return 'hls';
  if (/\.mpd/i.test(url)) return 'dash';
  if (/master\.json|playlist\.json/i.test(url)) return 'vimeo-v2';
  return 'manifest';
}

async function render() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !/^https?:/i.test(tab.url)) {
    $('siteName').textContent = '這個分頁不是可擷取的網頁';
    return;
  }
  origin = originPattern(tab.url);
  let host = '';
  try { host = new URL(tab.url).hostname; } catch {}
  $('siteName').textContent = host;

  // YouTube fast-path: yt-dlp resolves watch/shorts/youtu.be URLs natively, so
  // skip the whole permission + stream-sniff dance and just hand it the page URL.
  if (/(^|\.)(youtube\.com|youtu\.be)$/i.test(host) && /[?&]v=|youtu\.be\/|\/shorts\/|\/live\//.test(tab.url)) {
    $('youtubeBox').style.display = 'block';
    $('enableBtn').style.display = 'none';
    $('detected').style.display = 'none';
    setStatus('YouTube 影片可直接下載，無需授權（需 MediaGrab App 開著）。', 'muted');
    return;
  }
  $('youtubeBox').style.display = 'none';

  const fullSet = [origin, ...KNOWN_MEDIA_HOSTS];
  const originGranted = await chrome.permissions.contains({ origins: [origin] });
  const fullGranted = await chrome.permissions.contains({ origins: fullSet });
  $('siteState').textContent = fullGranted ? '已啟用' : (originGranted ? '需補授權' : '未啟用');
  $('siteState').className = 'pill ' + (fullGranted ? 'on' : '');

  if (!fullGranted) {
    $('enableBtn').style.display = 'block';
    $('enableBtn').textContent = originGranted ? '補齊影片來源權限（player.vimeo.com 等）' : '允許在此站擷取影片';
    $('detected').style.display = 'none';
    setStatus(originGranted
      ? '需補授權影片來源（含 player.vimeo.com）才能抓到 HLS 清單。'
      : '在此站按「允許擷取」後，播放影片即會偵測串流。', 'muted');
    return;
  }

  $('enableBtn').style.display = 'none';
  $('detected').style.display = 'block';

  const cap = await chrome.runtime.sendMessage({ type: 'getCapture', tabId: tab.id });
  const manifests = cap.manifests || [];
  const segCount = (cap.segments || []).length;
  const mseBytes = (cap.mse && cap.mse.bytes) || 0;
  $('counts').textContent = `${manifests.length} manifest · ${segCount} 片段`;

  const list = $('manifestList');
  list.innerHTML = '';
  // Lock onto the CURRENT video's master manifest (background resets it on each
  // lesson/video switch) — not a "best of accumulated pile".
  const best = cap.primaryManifestUrl || pickManifest(manifests);
  if (best) {
    for (const m of manifests.slice(0, 6)) {
      const d = document.createElement('div');
      d.textContent = (m === best ? '★ ' : '  ') + m.split('?')[0].slice(0, 70);
      list.appendChild(d);
    }
  }

  const hardDrm = /widevine|playready|\bfps\b|fairplay/i.test(cap.drm || '');
  $('drmBanner').style.display = cap.drm ? 'block' : 'none';
  if (cap.drm) $('drmKs').textContent = cap.drm;

  if (mseBytes > 0) {
    $('mseSection').style.display = 'block';
    $('mseBytes').textContent = (mseBytes / 1048576).toFixed(1) + ' MB' + (cap.mse && cap.mse.truncated ? '（已達上限 1.5GB）' : '');
  } else $('mseSection').style.display = 'none';

  // Offer the broad-permission upgrade only when nothing's been detected.
  const nothing = !best && segCount === 0 && mseBytes === 0;
  $('broadBtn').style.display = nothing ? 'block' : 'none';

  const btn = $('downloadBtn');
  if (hardDrm) {
    btn.disabled = true; btn.textContent = '🔒 受 DRM 保護，無法下載';
    setStatus('此影片受 DRM（' + cap.drm + '）保護，無法下載。', 'err');
  } else if (best) {
    btn.disabled = false; btn.textContent = '用 MediaGrab 下載';
    setStatus(cap.drm ? '偵測到 manifest（DRM 訊號不明，下載可能失敗）。' : '已偵測到可下載的 manifest。', cap.drm ? '' : 'ok');
  } else if (segCount > 0) {
    btn.disabled = false; btn.textContent = `下載（僅 ${segCount} 片段，無 manifest）`;
    setStatus('只偵測到片段、沒有 manifest — 伺服器可能無法重組（需 manifest）。', '');
  } else {
    btn.disabled = true; btn.textContent = '用 MediaGrab 下載';
    setStatus(mseBytes > 0
      ? '此串流無明文 manifest — 可用下方「錄製模式」下載。'
      : '尚未偵測到串流 — 請在此分頁播放影片幾秒，再開此視窗。', 'muted');
  }
}

async function enableAndReload(origins) {
  const granted = await chrome.permissions.request({ origins });
  if (!granted) { setStatus('未授權。', 'err'); return false; }
  let bareOrigin = '';
  try { bareOrigin = new URL(tab.url).origin; } catch {}
  await chrome.runtime.sendMessage({ type: 'enableSite', origin: bareOrigin });
  // The stream's master manifest is usually fetched at page load, BEFORE our
  // hooks exist — so reload once so the detector sees it from the start.
  setStatus('已啟用，正在重新整理頁面…播放影片即會偵測。', 'ok');
  try { await chrome.tabs.reload(tab.id); } catch {}
  setTimeout(() => window.close(), 400);
  return true;
}

$('enableBtn').addEventListener('click', async () => {
  try { await enableAndReload([origin, ...KNOWN_MEDIA_HOSTS]); }
  catch (e) { setStatus('授權失敗：' + e.message, 'err'); }
});

$('clearBtn').addEventListener('click', async () => {
  if (!tab) return;
  await chrome.runtime.sendMessage({ type: 'clearCapture', tabId: tab.id });
  setStatus('已清除偵測 — 重新播放當前影片即可重新偵測。', 'muted');
  render();
});

$('downloadBtn').addEventListener('click', async () => {
  const btn = $('downloadBtn');
  btn.disabled = true;
  setStatus('傳送給 MediaGrab…', 'muted');

  const cap = await chrome.runtime.sendMessage({ type: 'getCapture', tabId: tab.id });
  const best = cap.primaryManifestUrl || pickManifest(cap.manifests || []);
  const payload = {
    type: 'download',
    payload: {
      manifestUrl: best || undefined,
      segmentUrls: best ? undefined : (cap.segments || []).slice(0, 8000),
      mediaType: best ? mediaTypeOf(best) : 'segments',
      headers: cap.headers || {},
      referer: (cap.headers && (cap.headers.Referer || cap.headers.referer)) || tab.url,
      title: (tab.title || 'Captured Video').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120),
      pageUrl: tab.url
    }
  };

  const resp = await chrome.runtime.sendMessage({ type: 'nativeDownload', payload });
  if (resp && resp.ok) {
    setStatus('✓ 已加入 MediaGrab 下載佇列' + (resp.taskId ? `（${resp.taskId.slice(0, 8)}）` : ''), 'ok');
  } else {
    const err = (resp && resp.error) || '未知錯誤';
    setStatus('✗ ' + err, 'err');
    btn.disabled = false;
  }
});

// Broad-permission upgrade — for sites whose media CDN isn't in the known list.
// Grants <all_urls>: background flips to "broad mode" (capture on ANY site).
$('broadBtn').addEventListener('click', async () => {
  try { await enableAndReload(['<all_urls>']); }
  catch (e) { setStatus('授權失敗：' + e.message, 'err'); }
});

// YouTube fast-path — hand the page URL straight to yt-dlp via the app.
$('ytBtn').addEventListener('click', async () => {
  const btn = $('ytBtn');
  btn.disabled = true;
  setStatus('傳送給 MediaGrab…', 'muted');
  const payload = {
    type: 'download',
    payload: {
      manifestUrl: tab.url,
      mediaType: 'youtube',
      headers: {},
      referer: tab.url,
      title: (tab.title || 'YouTube Video').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120),
      pageUrl: tab.url,
    },
  };
  const resp = await chrome.runtime.sendMessage({ type: 'nativeDownload', payload });
  if (resp && resp.ok) {
    setStatus('✓ 已加入 MediaGrab 下載佇列' + (resp.taskId ? `（${resp.taskId.slice(0, 8)}）` : ''), 'ok');
  } else {
    setStatus('✗ ' + ((resp && resp.error) || '未知錯誤（確認 MediaGrab App 已開啟）'), 'err');
    btn.disabled = false;
  }
});

// MSE "record mode" — assembles captured segments and saves them via the page.
$('recordBtn').addEventListener('click', async () => {
  if (!tab) return;
  setStatus('組合錄製資料中…', 'muted');
  await chrome.runtime.sendMessage({
    type: 'recordDownload',
    tabId: tab.id,
    title: (tab.title || 'recording').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80),
  });
  setStatus('已觸發下載（若無反應，代表尚未擷取到資料）。', 'muted');
});

render();

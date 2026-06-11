/* MediaGrab Companion — popup logic */

const KNOWN_MEDIA_HOSTS = [
  '*://*.vimeo.com/*',   // player.vimeo.com HLS manifest + captions
  '*://*.vimeocdn.com/*', '*://*.akamaized.net/*', '*://*.cloudfront.net/*',
  '*://*.cdn77.com/*', '*://*.bunnycdn.com/*', '*://*.b-cdn.net/*', '*://*.fastly.net/*'
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
  $('counts').textContent = `${manifests.length} manifest · ${segCount} 片段`;

  const list = $('manifestList');
  list.innerHTML = '';
  // Lock onto the CURRENT video's master manifest (tracked by background as it
  // resets on each lesson/video switch) — not a "best of accumulated pile".
  const best = cap.primaryManifestUrl || pickManifest(manifests);
  if (best) {
    for (const m of manifests.slice(0, 6)) {
      const d = document.createElement('div');
      d.textContent = (m === best ? '★ ' : '  ') + m.split('?')[0].slice(0, 70);
      list.appendChild(d);
    }
  }

  const btn = $('downloadBtn');
  if (best) {
    btn.disabled = false;
    btn.textContent = '用 MediaGrab 下載';
    setStatus('已偵測到可下載的 manifest。', 'ok');
  } else if (segCount > 0) {
    btn.disabled = false;
    btn.textContent = `下載（僅 ${segCount} 片段，無 manifest）`;
    setStatus('只偵測到片段、沒有 manifest — 伺服器可能無法重組（需 manifest）。', '');
  } else {
    btn.disabled = true;
    btn.textContent = '用 MediaGrab 下載';
    setStatus('尚未偵測到串流 — 請在此分頁播放影片幾秒，再開此視窗。', 'muted');
  }
}

$('enableBtn').addEventListener('click', async () => {
  try {
    const granted = await chrome.permissions.request({ origins: [origin, ...KNOWN_MEDIA_HOSTS] });
    if (granted) {
      // Record the bare page origin so background only captures on this site.
      let bareOrigin = '';
      try { bareOrigin = new URL(tab.url).origin; } catch {}
      await chrome.runtime.sendMessage({ type: 'enableSite', origin: bareOrigin });
      setStatus('已啟用，請播放影片以偵測串流。', 'ok');
      render();
    } else setStatus('未授權。', 'err');
  } catch (e) { setStatus('授權失敗：' + e.message, 'err'); }
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

render();

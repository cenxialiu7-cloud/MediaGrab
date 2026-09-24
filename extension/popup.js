/* MediaGrab Companion — popup logic */

// Must match KNOWN_MEDIA_HOSTS in background.js — the major course-video CDNs.
const KNOWN_MEDIA_HOSTS = [
  "*://*.vimeo.com/*",
  "*://*.vimeocdn.com/*",
  "*://*.akamaized.net/*",
  "*://*.akamaihd.net/*",
  "*://*.cloudfront.net/*",
  "*://*.fastly.net/*",
  "*://*.cdn77.com/*",
  "*://*.cdn77.org/*",
  "*://*.wistia.com/*",
  "*://*.wistia.net/*",
  "*://*.wistia.io/*",
  "*://*.mux.com/*",
  "*://*.brightcove.net/*",
  "*://*.boltdns.net/*",
  "*://*.kaltura.com/*",
  "*://*.jwplayer.com/*",
  "*://*.jwpcdn.com/*",
  "*://*.jwplatform.com/*",
  "*://*.cloudflarestream.com/*",
  "*://*.videodelivery.net/*",
  "*://*.b-cdn.net/*",
  "*://*.bunnycdn.com/*",
  "*://*.mediadelivery.net/*",
];

const $ = (id) => document.getElementById(id);
const setStatus = (msg, cls = "") => {
  const s = $("status");
  s.textContent = msg;
  s.className = "status " + cls;
};

let tab = null;
let origin = null;

function originPattern(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

function pickManifest(manifests) {
  if (!manifests || !manifests.length) return null;
  const score = (u) =>
    /wistia\.(com|net)\/(embed\/)?(iframe|medias)\/[a-z0-9]{10}/i.test(u)
      ? 6 // Wistia id → yt-dlp extractor
      : /player\.vimeo\.com\/external\/\d+\.m3u8/i.test(u)
        ? 5 // Vimeo HLS master
        : /master\.json/i.test(u)
          ? 4
          : /\.m3u8/i.test(u)
            ? 3
            : /\.mpd/i.test(u)
              ? 2
              : /playlist\.json/i.test(u)
                ? 1
                : 0;
  return [...manifests].sort((a, b) => score(b) - score(a))[0];
}
function mediaTypeOf(url) {
  if (/\.m3u8/i.test(url)) return "hls";
  if (/\.mpd/i.test(url)) return "dash";
  if (/master\.json|playlist\.json/i.test(url)) return "vimeo-v2";
  return "manifest";
}

async function render() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !/^https?:/i.test(tab.url)) {
    $("siteName").textContent = "這個分頁不是可擷取的網頁";
    return;
  }
  origin = originPattern(tab.url);
  let host = "";
  try {
    host = new URL(tab.url).hostname;
  } catch {}
  $("siteName").textContent = host;

  // YouTube fast-path: yt-dlp resolves watch/shorts/youtu.be URLs natively, so
  // skip the whole permission + stream-sniff dance and just hand it the page URL.
  if (
    /(^|\.)(youtube\.com|youtu\.be)$/i.test(host) &&
    /[?&]v=|youtu\.be\/|\/shorts\/|\/live\//.test(tab.url)
  ) {
    $("youtubeBox").style.display = "block";
    $("enableBtn").style.display = "none";
    $("detected").style.display = "none";
    setStatus(
      "YouTube 影片可直接下載，將使用 App 設定中的登入來源（需 App 開著）。",
      "muted",
    );
    return;
  }
  $("youtubeBox").style.display = "none";

  const fullSet = [origin, ...KNOWN_MEDIA_HOSTS];
  const originGranted = await chrome.permissions.contains({
    origins: [origin],
  });
  const fullGranted = await chrome.permissions.contains({ origins: fullSet });
  $("siteState").textContent = fullGranted
    ? "已啟用"
    : originGranted
      ? "需補授權"
      : "未啟用";
  $("siteState").className = "pill " + (fullGranted ? "on" : "");

  if (!fullGranted) {
    $("enableBtn").style.display = "block";
    $("enableBtn").textContent = originGranted
      ? "補齊影片來源權限（player.vimeo.com 等）"
      : "允許在此站擷取影片";
    $("detected").style.display = "none";
    setStatus(
      originGranted
        ? "需補授權影片來源（含 player.vimeo.com）才能抓到 HLS 清單。"
        : "在此站按「允許擷取」後，播放影片即會偵測串流。",
      "muted",
    );
    return;
  }

  $("enableBtn").style.display = "none";
  $("detected").style.display = "block";

  const cap = await chrome.runtime.sendMessage({
    type: "getCapture",
    tabId: tab.id,
  });
  const resources = cap.resources || [];
  $("counts").textContent =
    `${resources.length} 個媒體 · ${cap.segmentCount || 0} 片段`;
  const list = $("manifestList");
  list.innerHTML = "";
  const select = document.createElement("select");
  select.id = "resourcePick";
  select.style.width = "100%";
  for (const r of resources) {
    const option = document.createElement("option");
    option.value = r.id;
    option.textContent = `${select.options.length + 1}. ${r.kind} ${r.label}`;
    select.appendChild(option);
  }
  list.appendChild(select);
  $("drmBanner").style.display = cap.drm ? "block" : "none";
  if (cap.drm) $("drmKs").textContent = cap.drm;
  $("downloadBtn").disabled = !!cap.drm || !resources.length;
  $("mseSection").style.display = "none";
  $("broadBtn").style.display = resources.length ? "none" : "block";
  setStatus(
    cap.drm
      ? "受 DRM 保護，請使用官方離線功能。"
      : resources.length
        ? "選擇要下載的媒體；不同播放清單可能屬於同一影片。"
        : "請播放影片後重新開啟外掛；只有片段時不能確定完整性。",
    cap.drm ? "err" : "muted",
  );
}

async function enableAndReload(origins) {
  const granted = await chrome.permissions.request({
    origins,
    permissions: ["cookies"],
  });
  if (!granted) {
    setStatus("未授權。", "err");
    return false;
  }
  let bareOrigin = "";
  try {
    bareOrigin = new URL(tab.url).origin;
  } catch {}
  await chrome.runtime.sendMessage({ type: "enableSite", origin: bareOrigin });
  // The stream's master manifest is usually fetched at page load, BEFORE our
  // hooks exist — so reload once so the detector sees it from the start.
  setStatus("已啟用，正在重新整理頁面…播放影片即會偵測。", "ok");
  try {
    await chrome.tabs.reload(tab.id);
  } catch {}
  setTimeout(() => window.close(), 400);
  return true;
}

$("enableBtn").addEventListener("click", async () => {
  try {
    await enableAndReload([origin, ...KNOWN_MEDIA_HOSTS]);
  } catch (e) {
    setStatus("授權失敗：" + e.message, "err");
  }
});

$("clearBtn").addEventListener("click", async () => {
  if (!tab) return;
  await chrome.runtime.sendMessage({ type: "clearCapture", tabId: tab.id });
  setStatus("已清除偵測 — 重新播放當前影片即可重新偵測。", "muted");
  render().catch((e) => setStatus(e.message, "err"));
});

$("downloadBtn").addEventListener("click", async () => {
  const btn = $("downloadBtn");
  btn.disabled = true;
  setStatus("傳送給 MediaGrab…", "muted");

  const resp = await chrome.runtime.sendMessage({
    type: "nativeDownload",
    tabId: tab.id,
    resourceId: $("resourcePick").value,
  });
  if (resp && resp.ok) {
    setStatus(
      "✓ 已加入 MediaGrab 下載佇列" +
        (resp.taskId ? `（${resp.taskId.slice(0, 8)}）` : ""),
      "ok",
    );
  } else {
    const err = (resp && resp.error) || "未知錯誤";
    setStatus("✗ " + err, "err");
    btn.disabled = false;
  }
});

// Broad-permission upgrade — for sites whose media CDN isn't in the known list.
// Grants <all_urls>: background flips to "broad mode" (capture on ANY site).
$("broadBtn").addEventListener("click", async () => {
  try {
    await enableAndReload(["<all_urls>"]);
  } catch (e) {
    setStatus("授權失敗：" + e.message, "err");
  }
});

// YouTube fast-path — hand the page URL straight to yt-dlp via the app.
$("ytBtn").addEventListener("click", async () => {
  const btn = $("ytBtn");
  btn.disabled = true;
  setStatus("傳送給 MediaGrab…", "muted");
  const resp = await chrome.runtime.sendMessage({
    type: "nativeDownload",
    tabId: tab.id,
    page: true,
  });
  if (resp && resp.ok) {
    setStatus(
      "✓ 已加入 MediaGrab 下載佇列" +
        (resp.taskId ? `（${resp.taskId.slice(0, 8)}）` : ""),
      "ok",
    );
  } else {
    setStatus(
      "✗ " + ((resp && resp.error) || "未知錯誤（確認 MediaGrab App 已開啟）"),
      "err",
    );
    btn.disabled = false;
  }
});

// MSE "record mode" — assembles captured segments and saves them via the page.
$("recordBtn").addEventListener("click", async () => {
  if (!tab) return;
  setStatus("組合錄製資料中…", "muted");
  await chrome.runtime.sendMessage({
    type: "recordDownload",
    tabId: tab.id,
    title: (tab.title || "recording")
      .replace(/[\\/:*?"<>|]/g, "_")
      .slice(0, 80),
  });
  setStatus("已觸發下載（若無反應，代表尚未擷取到資料）。", "muted");
});

render().catch((e) => setStatus(e.message, "err"));

document.querySelector("header b").textContent =
  "MediaGrab v" + chrome.runtime.getManifest().version;

chrome.runtime
  .sendMessage({ type: "ping" })
  .then((r) => {
    const el = document.createElement("div");
    el.className = "muted";
    el.textContent = r?.ok
      ? `App v${r.appVersion} · Host v${r.hostVersion}`
      : "尚未連上 App／Native Host";
    document.querySelector("header").after(el);
  })
  .catch(() => {});

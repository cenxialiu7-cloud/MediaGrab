export const platforms = [
  {
    id: "youtube",
    name: "YouTube",
    hosts: /(^|\.)(youtube\.com|youtu\.be)$/,
    route: "extractor",
    help: "影片、Shorts、頻道與清單使用 yt-dlp。登入內容使用設定的 Cookie 來源；需可用的 JS runtime。",
  },
  {
    id: "facebook",
    name: "Facebook",
    hosts: /(^|\.)(facebook\.com|fb\.watch)$/,
    route: "extractor",
    help: "使用影片或 Reels 分享網址。私人社團／登入內容改用已登入分頁擷取；觀看權限仍需有效。",
  },
  {
    id: "instagram",
    name: "Instagram",
    hosts: /(^|\.)instagram\.com$/,
    route: "extractor",
    help: "使用單篇貼文或 Reels；登入、限流或私人帳號需要有效的登入來源。",
  },
  {
    id: "tiktok",
    name: "TikTok",
    hosts: /(^|\.)tiktok\.com$/,
    route: "extractor",
    help: "使用影片分享網址；與中國抖音分開處理。",
  },
  {
    id: "douyin",
    name: "抖音 Douyin",
    hosts: /(^|\.)douyin\.com$/,
    route: "extractor",
    help: "使用抖音分享連結。網站簽章／登入要求變動時可在有權限的 Chrome 分頁擷取。",
  },
  {
    id: "vimeo",
    name: "Vimeo",
    hosts: /(^|\.)vimeo\.com$/,
    route: "extractor",
    help: "公開影片使用專用解析器；課程嵌入影片優先擷取完整 HLS/DASH，保留原始 Referer。",
  },
  {
    id: "wistia",
    name: "Wistia",
    hosts: /(^|\.)wistia\.(com|net)$/,
    route: "extractor",
    help: "公開嵌入頁使用解析器；受限課程保留簽章 HLS，勿用固定 media ID 取代授權網址。",
  },
  {
    id: "gimy",
    name: "Gimy",
    hosts: /(^|\.)gimy(ai|tv|plus)?\.(tw|ai|com|net|cc|bot)$/,
    route: "browser",
    help: "解析來源與集數，開始下載時重新解析避免簽章過期；不同網域／播放器需另行驗證。",
  },
  {
    id: "xiaoya",
    name: "小鴨",
    hosts: /(^|\.)(777tv|xiaoya?\d*)\.(ai|tv|cc|com|net)$/,
    route: "browser",
    help: "選擇劇集與來源，逐集重新解析。只處理可取得的非 DRM 串流。",
  },
  {
    id: "missav",
    name: "MissAV",
    hosts: /(^|\.)missav\d*\.(ws|com|to|ai|tv)$/,
    route: "browser",
    help: "瀏覽器觀察完整清單並排除已知廣告來源；受登入／CDN 檢查限制時使用外掛擷取。",
  },
  {
    id: "course",
    name: "教育／課程平台",
    route: "capture",
    help: "先在有觀看權限的分頁播放，再選取完整影音資源。支援非 DRM HLS、DASH、MP4；DRM 與只有片段的情況使用官方離線功能。",
  },
];
export function platformFor(url) {
  const host = new URL(url).hostname;
  const p = platforms.find((p) => p.hosts?.test(host));
  return p ? { id: p.id, name: p.name, route: p.route, help: p.help } : null;
}
export function publicPlatforms() {
  return platforms.map(({ hosts, ...p }) => ({
    ...p,
    verification: "需按內容與帳號驗收，非全平台保證",
  }));
}
export function explainFailure(error) {
  const text = String(error?.message || error);
  const matches = [
    [
      "DRM",
      /drm|widevine|playready|fairplay|protected content|受保護|不支援的加密/i,
      "請使用平台官方離線功能。",
    ],
    [
      "AUTH_REQUIRED",
      /login|sign in|cookies|authentication|unauthorized|private video|登入/i,
      "請確認登入與觀看權限，設定 Cookie 來源或重新用 Chrome 擷取。",
    ],
    [
      "RATE_LIMITED",
      /429|rate.limit|too many requests/i,
      "平台限流，請稍後再試並降低同時下載數。",
    ],
    [
      "EXPIRED_OR_FORBIDDEN",
      /403|410|expired|forbidden/i,
      "來源可能過期或受限；回到已登入分頁播放，再重新擷取。",
    ],
    [
      "GEO_RESTRICTED",
      /not available in your|geo.restrict|country/i,
      "此內容有地區限制，請使用平台允許的觀看方式。",
    ],
    [
      "UNSUPPORTED",
      /unsupported url|no video|未找到/i,
      "可嘗試網頁掃描或擴充；沒有完整清單時不能保證下載。",
    ],
  ];
  for (const [code, re, suggestion] of matches)
    if (re.test(text)) return { code, suggestion };
  return {
    code: "DOWNLOAD_FAILED",
    suggestion: "檢查網路、來源有效性與下載引擎版本。",
  };
}

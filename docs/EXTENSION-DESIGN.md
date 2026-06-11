# MediaGrab Companion Extension — 架構設計

> 目的：讓 MediaGrab 能下載「登入牆 + Web Worker 隱藏串流」這一類站（例：sat.cool
> 嵌入的 Vimeo 私有影片）。現有後端 page-scanner 跑在 headless Playwright、用全新無痕
> context，**看不到 worker 流量、也沒有使用者的登入**。瀏覽器擴充跑在使用者已登入的
> Chrome 裡、用 `webRequest` 看得到全部流量 → 補上這個缺口。
>
> ⚠️ 本擴充為**獨立實作**，未複製任何第三方專有擴充（如 Video DownloadHelper）的程式碼。
> 採用的是公開技術（MV3 `webRequest` 觀察 + Native Messaging）。

## 已定案決策（2026-06-11）

| # | 決策 | 選擇 |
|---|------|------|
| 1 | host 權限範圍 | **逐站 opt-in**（預設零 host 權限，使用者對該站按一下才授權 optional host permission）|
| 2 | 擴充 ↔ 本機通訊 | **Native Messaging**（非 localhost HTTP；無 web 頁面可觸及的 CSRF 面）|
| 3 | 設計文件 | 存成本檔 `docs/EXTENSION-DESIGN.md` |
| 4 | 實作範圍 | **整套**（擴充 + native host + server 端點 + 安裝流程）|

## 資料流

```
你的 Chrome（已登入 sat.cool；使用者已對 sat.cool opt-in）
  └─ 分頁播放 → Web Worker 抓 Vimeo manifest + 片段
        ▲ chrome.webRequest 觀察（背景 service worker）
        │   命中 master.json/.m3u8/.mpd/vimeocdn → 收集 URL + headers(Referer/Cookie/UA)
        │   依 tabId 存進 chrome.storage.session
  └─ popup：列出該分頁偵測到的影片 →「用 MediaGrab 下載」
        │ chrome.runtime.connectNative('com.mediagrab.host')  ← Native Messaging（stdio）
        ▼
  Native host（mediagrab-host.js，Chrome 啟動的本機 Node 程序）
        │ 讀 ~/.mediagrab/capture-token
        │ POST http://127.0.0.1:9800/api/capture/download  + X-MediaGrab-Token
        ▼
  MediaGrab server（已隨 App 啟動）
        /api/capture/download → 驗 token → 建 task → 走既有下載引擎
          • 有 manifest → yt-dlp <manifest> --referer --add-header(Cookie/UA)（reuse）
          • 只有片段 → 自行下載 + concat + ffmpeg（後備）
        進度走既有 WebSocket 佇列，App UI 直接顯示
```

## 為什麼 Native Messaging 比 localhost HTTP 安全

- 若用 localhost HTTP，**任何網頁**都能 `fetch('http://127.0.0.1:9800/...')`（CSRF / DNS rebinding）。
- Native Messaging 的通道是 Chrome ↔ 本機程序（stdio），**網頁無法觸及**。
- 仍然加一層防護：native host → server 的那段 localhost 呼叫需帶 `capture-token`（存在
  `~/.mediagrab/capture-token`，網頁讀不到該檔），server 綁 127.0.0.1。

## 元件清單（本次實作）

| 元件 | 路徑 | 說明 |
|------|------|------|
| 擴充 manifest | `extension/manifest.json` | MV3；權限 `webRequest`/`storage`/`nativeMessaging`；`optional_host_permissions` 逐站授權；內含 `key` 以固定 extension ID |
| 背景 SW | `extension/background.js` | 動態為已授權站掛 webRequest listener、捕捉媒體 URL+headers、管理 native port |
| popup | `extension/popup.html` + `popup.js` | 列出本分頁影片、「授權此站」、「用 MediaGrab 下載」 |
| native host | `native-host/mediagrab-host.js` | stdio 收訊 → 帶 token POST 到 server |
| host manifest 範本 | `native-host/com.mediagrab.host.json` | `allowed_origins` = 我們固定的 extension ID |
| 安裝器 | `native-host/install.js` | 算 extension ID、寫 host manifest 到 Chrome NativeMessagingHosts 目錄、產生 capture-token |
| server 端點 | `server/routes/capture.js` | `POST /api/capture/download`（token 保護）→ 建 task |
| yt-dlp header 支援 | `server/services/ytdlp.js` | startDownload 支援 `task.headers` / `task.referer`（reuse 給 capture）|

## MV3 重點 / 注意事項

- `webRequest` **觀察版在 MV3 仍可用**（我們不需 blocking 版）→ 能讀 URL + headers ✓
- `webRequest` 看得到 **worker / 跨域 iframe** 請求 → 抓 sat.cool 的關鍵 ✓
- 讀 `Cookie`/`Referer` 需在 `addListener` 的 `extraInfoSpec` 加 `'extraHeaders'` ✓
- 背景 SW 會被回收：listener 在 top-level 註冊（喚醒自動重掛）；捕捉狀態存 `storage.session` ✓
- Vimeo 簽章 URL 約 90 分過期、可能綁 IP：localhost server 與瀏覽器同台同公網 IP，及時下載即可 ✓
- 固定 extension ID：manifest 內放 `key`（公鑰），讓 unpacked 載入也得到穩定 ID，native host 的 `allowed_origins` 才對得上 ✓

## 安全與隱私

- 預設**零 host 權限**；逐站 `chrome.permissions.request({origins:[...]})`，使用者可隨時移除。
- cookie 僅用於該媒體下載請求、僅經 native messaging → localhost、**絕不外傳、絕不寫 log**。
- server `/api/capture/download` 需 `capture-token`；只綁 127.0.0.1。
- 定位維持「個人備份你**有觀看權限**的內容」；sat.cool 等站的 ToS 仍約束使用者（帳號風險自負）。

## 分階段（整套）

- **P1**：擴充攔 manifest → native host → server → yt-dlp。驗證 sat.cool 一集可下。
- **P2**：popup UI（多影片/畫質）、逐站授權 UX、token、badge。
- **P3**：DASH 支援、純片段重組後備、打包進安裝流程與 CI。

## 已知限制

- 純片段重組（無 manifest）對 Vimeo v2 `range/prot` 仍脆弱；平台改版可能失效。
- 端到端需使用者在 Chrome 載入 unpacked 擴充、執行一次安裝器、對目標站 opt-in。

# MediaGrab Companion 擴充 — 安裝與使用

擷取「登入牆 + Web Worker 隱藏串流」這類站（例：sat.cool 的 Vimeo 影片）的串流，
交給 MediaGrab App 下載。架構與原理見 [`docs/EXTENSION-DESIGN.md`](../docs/EXTENSION-DESIGN.md)。

> ⚠️ 只用於你**有觀看權限**的內容（個人備份）。目標站的服務條款可能禁止下載，帳號風險自負。

## 安裝（一次性）

```bash
# 1. 註冊 native messaging host（算出 extension ID、寫入 Chrome 設定）
cd "$HOME/Claude Code/MediaGrab"
node native-host/install.js
```

```text
# 2. 載入擴充
chrome://extensions → 右上「開發人員模式」開 → 「載入未封裝項目」→ 選 extension/ 資料夾
   確認顯示的 ID = kpbhgcoabnkeapehoekebbjangfphjfn（與 install.js 印出的相同）
```

```text
# 3. 開啟 MediaGrab App（啟動本機 server :9800）
```

> 固定 extension ID 由 `manifest.json` 的 `key` 決定，所以 native host 的 `allowed_origins`
> 對得上。若你改了 key 或搬動 repo，重跑 `node native-host/install.js`。

## 使用

1. 開啟課程／串流頁，點工具列的 **MediaGrab** 圖示。
2. 按 **「允許在此站擷取影片」**（會請求此站 + 常見媒體 CDN 如 vimeocdn 的權限）。
   → 授權後**會自動重新整理頁面**（串流的 master manifest 通常在頁面載入時就抓完了，
   必須從頭載入才攔得到；這是「0 manifest」最常見的原因）。
3. **播放影片**幾秒，讓播放器去抓 manifest / 片段。
4. 再開一次 popup → 按 **「用 MediaGrab 下載」**。下載會出現在 MediaGrab App 的佇列。

**抓不到？（非常見 CDN 的站）** popup 會出現 **「授予廣域權限再試」**。授權後進入
**廣域模式**：對**任何網站的任何影片主機**都會偵測擷取（原理同 CocoCut/cat-catch 這類
通用嗅探器）。同樣會自動重整頁面。

**YouTube**：在 `youtube.com/watch`、Shorts、`youtu.be` 頁面直接顯示
**「用 MediaGrab 下載此 YouTube 影片」**，一鍵把網址交給 yt-dlp（最佳畫質＋音訊自動合併），
不需授權、不需嗅探。

## 運作原理（通用偵測，v0.2.0）

三層偵測，通用於各課程平台（Vimeo / Wistia / Mux / Brightcove / Kaltura / JW Player /
Cloudflare Stream / Bunny…），不綁單一站：

1. **webRequest**（在你已登入的瀏覽器）觀察流量，用**副檔名 + Content-Type** 比對 HLS/DASH，
   看得到 Web Worker / 跨域 CDN 的請求。
2. **頁面注入 hook**（`inject.js`，MAIN world）攔 `fetch`/`XHR` → 撈**播放器 JS 內請求的
   隱藏 manifest**（現代播放器大宗）。
3. **MSE 錄製模式**：hook `MediaSource.appendBuffer` 虹吸 segment，處理只有 `blob:`、
   完全沒有明文 manifest 的串流（有 1.5GB 上限防記憶體爆掉）。
4. **DRM 偵測**：hook `requestMediaKeySystemAccess`，偵測到 Widevine/PlayReady/FairPlay
   即標示且停用下載（受保護內容無法下載）。

擷取到的 manifest URL + 請求 headers（含 live session Cookie）經 **Native Messaging** 交給
本機 host，POST 到 server `/api/capture/download`，優先交 yt-dlp 下載。錄製模式則在瀏覽器
內組合並存檔。

## 隱私

- 預設零 host 權限，**逐站 opt-in**，可隨時在 chrome://extensions 移除某站權限。
- 擷取的 Cookie / 簽章 URL 只用於該下載請求、只走 localhost，**不外傳、不寫進前端/log**；
  task 廣播到前端前會剝除 headers/cookies 並把簽章 manifest URL 換成 `[captured stream]`。
- server 端點需 `capture-token`（存 `~/.mediagrab/capture-token`，網頁讀不到），且 server 只綁 127.0.0.1。
- **CDN 權限說明**：啟用一站時，為了看到跨域影片片段（如 sat.cool 的影片在 vimeocdn.com），
  會一併授權幾個常見媒體 CDN 萬用域。但**擷取只在你明確啟用的頁面來源上發生**——背景會
  二次比對分頁的頁面 origin 是否在已啟用清單，未啟用的站即使用同一 CDN 也不會被擷取。

## 解除安裝

```bash
# 移除 native host 註冊（各瀏覽器）
rm -f ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.mediagrab.host.json
rm -f ~/Library/Application\ Support/Chromium/NativeMessagingHosts/com.mediagrab.host.json
rm -f ~/Library/Application\ Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.mediagrab.host.json
# chrome://extensions → 移除 MediaGrab Companion
```

## 已知限制

- 若某站的串流**沒有單一 yt-dlp 可解析的 manifest**（只有逐段簽章片段，如 Vimeo v2
  `range/prot`），server 目前回 501（片段重組尚未實作）。sat.cool 是否可行，載入後播放
  即知 popup 有沒有抓到 manifest。
- 擴充工具列沒有自訂圖示（用 Chrome 預設拼圖圖示）；功能不受影響。

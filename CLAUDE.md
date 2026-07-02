# MediaGrab — 開發者 / AI 接續指南

跨平台（macOS / Windows）影片下載器：Node/Express 後端 + React/Vite/Tailwind 前端，
外加一個 Chromium MV3 companion 擴充（含 native messaging host）用來擷取登入牆／課程站的
串流。以自帶相依的原生安裝檔（.pkg / .exe）發佈，安裝檔由 GitHub Actions CI 建置。

> 這份檔案是給「新環境 clone 下來後要接續開發」的人（含 AI 助手）看的單一入口。
> 讀完這份就能不靠外部記憶接續除錯與開發。

---

## 架構總覽

```
瀏覽器 UI (React/Vite)  ──HTTP/WS──►  本機 server (Express, 127.0.0.1:9800)
                                          │  spawn
                                          ├─► yt-dlp（核心下載引擎）
                                          ├─► ffmpeg（合併/remux）
                                          └─► Playwright（Smart 解析 page-scan）

companion 擴充 (MV3)  ──native messaging──►  native host (~/.mediagrab/run-host.sh)
   在你已登入的瀏覽器擷取串流 URL+headers        └─► POST http://127.0.0.1:9800/api/capture/download
```

- **server**：只綁 `127.0.0.1`。`/api/*` 提供解析、下載佇列（WebSocket 推進度）、設定、
  擷取端點、擴充資訊。版本號從 `package.json` 讀，走 `/api/status`。
- **client**：`client/src`，build 到 `client/dist`（server 靜態託管）。
- **extension**：`extension/`（MV3，固定 ID `kpbhgcoabnkeapehoekebbjangfphjfn`，由 manifest
  `key` 決定，與載入路徑無關）。原理見 `docs/EXTENSION-DESIGN.md`、`extension/README.md`。
- **native-host**：`native-host/`，`install.js` 註冊 host（Mac 寫 NativeMessagingHosts 目錄、
  Windows 寫 HKCU 登錄檔），launcher 放 `~/.mediagrab`（app 在唯讀 /Applications 也能用）。
- **打包**：`.github/workflows/build-mac.yml` / `build-windows.yml`（推 `v*` tag 觸發），
  本機腳本 `packaging/build-pkg.sh`、`packaging-windows/`。

## 目錄

| 路徑 | 內容 |
|---|---|
| `server/` | Express 後端（routes / services / utils / ws） |
| `client/` | React 前端（`src/`；`dist/` 為 build 產物，git 忽略） |
| `extension/` | MV3 擴充（background/inject/bridge/popup + manifest） |
| `native-host/` | native messaging host + `install.js` |
| `packaging/`, `packaging-windows/` | 安裝檔打包腳本與 .app 骨架 |
| `.github/workflows/` | Mac / Windows CI build |
| `docs/` | 公開網頁（GitHub Pages）+ 設計文件 |

## 開發環境設定

```bash
# 前置（macOS）：實際下載需要 yt-dlp / ffmpeg 在 PATH
brew install node git yt-dlp ffmpeg aria2

git clone https://github.com/cenxialiu7-cloud/MediaGrab.git
cd MediaGrab
npm install
cd client && npm install && cd ..

npm run dev          # server :9800 + vite 前端，熱重載
# 或分開：npm run server / npm run client
```

擴充開發：`node native-host/install.js` → `chrome://extensions` 開發人員模式 →
「載入未封裝項目」選 repo 的 `extension/`。改了擴充程式碼要在該頁按 🔄 重新載入才生效。

> **dev vs packaged**：唯一訊號是 `NODE_ENV`。launcher 設 `NODE_ENV=production`；dev 未設。
> 例如擴充 staging（見下）只在 production 觸發，dev 直接用 repo 的 `extension/`。

## 建置與發佈

安裝檔**全在 CI 建**（本機不需要 `packaging/vendor/` 那些大二進位檔）：

```bash
# 1. 改版號：package.json（app）、extension/manifest.json（擴充，若擴充有改）
# 2. commit（見下方 commit 慣例）
# 3. 打 tag 觸發 CI（同時建 Mac arm64 + Windows x64，附到 GitHub Release）
git tag -a v1.6.9 -m "v1.6.9 — ..." && git push origin main v1.6.9
# 4. 監看：gh run watch <id> --exit-status ；gh release view v1.6.9
```

- Mac tag build 只出 **arm64**（GitHub 的 Intel runner 實務上排不到）；要 Intel 手動
  `workflow_dispatch` 指定 `arch=x64`。
- `.pkg` 用 `pkgbuild --component-plist BundleIsRelocatable=false`（不然 app 會被
  relocate 到既有 dev 副本、裝完不出現）。

## 協作慣例（沿用）

- 回應用**繁體中文**；比較用**表格**。
- **先問再做**：破壞性/大改動先確認；**最小修改**；**明確失敗不要假裝成功**；有 token 預算意識。
- 大改前打 git tag 當回復點；破壞性動作前先驗證目標。
- **只有使用者要求時才 commit/push**。commit 訊息：首行 `feat/fix/chore: …`，空行，
  條列細節，必要時附 Why/Tested；**不要 Co-Authored-By**。
- 外部系統（CDN/CI）延遲時**誠實回報**，不要瞎猜成功。
- **安全**：cookies / session token 絕不外洩到前端/log/WebSocket；下載僅限使用者有觀看
  權限的內容（個人備份）；不繞過 DRM。公開前先掃機密、憑證輪換只有使用者能做。

## 目前狀態（截至 v1.6.8 / 擴充 0.2.2）

**能用**：一般網站/課程站串流擷取；Vimeo、JW Player、Wistia（Teachable/Thinkific/Kajabi/
Podia）等；廣域模式（授 `<all_urls>` 後對任意站擷取，同 CocoCut/cat-catch）；YouTube 一鍵
交 yt-dlp；擴充 staging 出 bundle（`~/Library/Application Support/MediaGrab/extension`）解決
「載入未封裝」選不到 .app 內路徑；一鍵安裝橋接 + 在 Finder 中顯示。

**待實測（未驗證）**：特定 Teachable 帳號若開 Wistia 網域限制/密碼保護；Skilljar 廣域模式
實抓；reveal/install-host 的實機副作用；Windows native host 登錄檔註冊。

## 踩過的雷（改動前務必知道）

- **擴充 staging**：`server/utils/extensionStaging.js`，production 才把 `extension/` 複製到
  可導覽的 userData 目錄；用暫存目錄+原子 rename、版本相同不動、失敗不擋啟動。
- **新增會動系統的 POST 端點**（`/api/extension/reveal`、`/install-host`）要加 `localOnly`
  守門：**只放行 Origin 為本機**，擋跨站/sandboxed iframe(`Origin: null`)/無 Origin。
  **但 `/api/quit` 不可加**——launcher 用 `curl`（無 Origin）呼叫它做更新接管。
- **擷取任務必須 `type:'capture'`**，否則 `taskManager.publicTask()` 不會遮蔽 URL，
  簽章串流 URL / referer 會經 WebSocket 外洩。
- **Wistia（課程站）**：真串流是 `fast.wistia.com/embed/medias/{id}.m3u8` + `.bin`，不是 `.mp4`。
  擷取 10 碼 media id 交 yt-dlp 內建 Wistia extractor；正規化成 `embed/medias/{id}`（**不要**
  帶 `.json`，yt-dlp 不吃）；**強制用課程頁 pageUrl 當 Referer**（Wistia 網域限制看上層頁）；
  **不要**廣抓 `.bin`（每個是完整替代畫質非片段，會洗版+挑錯畫質）。yt-dlp Teachable extractor
  上游已壞，別丟 Teachable 頁面 URL。
- **擷取下載格式**用 `-f 'bv*+ba/b' --remux-video mp4`（mp4-only 選擇器會 format not available）。
- 擷取後才 hook 的頁面抓不到最初的 manifest → 啟用/授權後**自動重整頁面**。

## 給接手的 AI 助手

先讀本檔 →（要動擴充/擷取邏輯）讀 `extension/background.js`、`server/routes/capture.js`、
`server/services/ytdlp.js` →（要動打包/發佈）讀對應 workflow。動手前確認要不要發佈；
發佈是推 tag 觸發 CI。回應繁中、先問再做、最小修改。

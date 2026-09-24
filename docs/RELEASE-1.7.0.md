# MediaGrab 1.7.0 — 下載正確性與登入安全修復

發布條件：同一提交的 Mac arm64 與 Windows x64 CI 均成功後，才公開 GitHub Release。乾淨系統安裝與私人平台驗收仍須分別執行。

- App、client、companion extension 同步為 1.7.0。App 顯示本機、GitHub 最新 Release、外掛包與引擎版本；官網下載版沿用同一 GitHub Release API。版號不同會明確提示。
- 移除 App 的遠端可執行廣告，保留靜態贊助連結。所有本機敏感 API／WebSocket 共用 session 與 Origin／Host 驗證。
- 掃描結果只回 opaque resourceId。Cookie 依 domain、host-only、path、secure、expiry 匹配；憑證不出現在任務列表、WS 或一般錯誤訊息。恢復佇列以 AES-GCM 加密、同帳號 0600 金鑰保存。
- MP4、HLS、DASH 改用共用 yt-dlp 下載、可取消的程序群組與 ffprobe 驗證；缺片段／必要音軌不得完成。取消後不再寫入；重啟後待使用者恢復。
- HLS 使用成熟解析器處理 AES-128／KEY rotation／NONE／sequence IV、byte-range、分離音軌。DRM 明確拒絕。
- Chrome 外掛逐 requestId 保存 context、逐分頁序列化寫入，支援多資源選擇、無副檔名 MIME 偵測。Cookie 權限為選用，允許時才讀匹配的 Cookie 屬性。Native handshake 回報 App／host／實際外掛版本。
- 不再把零散 TS 片段合成「完整影片」。移除自動複製 1.5 GB MSE buffer 與未驗證的逐軌匯出；沒有完整串流時說明限制。此版**沒有提供通用螢幕錄影或 DRM 繞過**。
- 支援音訊 M4A、來源有提供時的中英文字幕、多音軌 MKV 選項。課程按實際播放器判斷，沒有「所有課程都可下載」承諾。
- 固定 Node 24.21.0、yt-dlp 2026.08.19。Mac FFmpeg/ffprobe 7.1.1、Windows BtbN FFmpeg 8.1.3；`packaging/engines.lock.json` 保存固定 URL 與 SHA-256。更新器預設關閉，驗證 hash 與執行後才替換，保留上一版。
- Windows 安裝器不再自動加入 Defender 排除項目；解除安裝只透過驗證 token 關閉 MediaGrab，不再終止所有 node.exe。
- 使用 npm ci；新增版本、媒體回歸、瀏覽器 smoke、runtime inventory 與 CycloneDX SBOM 產生步驟。移除下載對 aria2 daemon 的依賴，legacy `/aria2` 路由交由共用下載器。

## 驗證範圍

`npm run check` 執行來源版本檢查、合成安全／媒體／佇列／外掛測試與前端 production build。
`npm run test:browser` 使用獨立瀏覽器與臨時資料，檢查 UI、iframe/audio 掃描及敏感資料回傳。

目前合成驗證涵蓋 MP4 位元一致、實際解碼影格一致、HLS/DASH、加密 key rotation＋非零序號＋NONE、fMP4 byte-range、分離音軌、缺段／缺音軌、DRM、跨來源重新導向、100 筆外掛併發、Native handshake、staging hash、加密恢復、取消後停止寫入。

合成測試不代表 FB／IG／TikTok／Douyin／Gimy／小鴨／MissAV／付費課程實站通過。私人與課程頁須有觀看權限的樣本，另驗證登入失效、換課程與完整播放。Windows 編譯成功也不等於 Windows 安裝與瀏覽器 native host E2E；須在 CI 與乾淨 VM 驗收。

## 升級

1. 啟動新版 App；舊版仍占用連接埠時，先從舊版 UI 正常關閉。launcher 不再終止任意 port owner。
2. 在 App 設定重新安裝 Native Host。
3. Chrome 的 `chrome://extensions` 對 MediaGrab 按「重新載入」。外掛視窗應顯示 1.7.0，並顯示 App／Host 版本。
4. 重新開啟要擷取的頁面並播放。需要登入時，可授予所需站點與選用 Cookie 權限；不需要將密碼或 Cookie 貼給他人。
5. 下載失敗時先看分類提示。需要特定 UA／TLS fingerprint／PO token 的平台不保證靠擷取 URL 就能解決。

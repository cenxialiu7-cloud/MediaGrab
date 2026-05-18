# MediaGrab 安裝指南 (Windows 版)

通用影音下載工具，可下載 YouTube、Facebook、Instagram、抖音、Gimy、小鴨影音等網站的影片。

## 系統需求

- **Windows 10 或 Windows 11** (64 位元)
- 約 **600 MB** 可用磁碟空間
- 不需要 admin 權限（安裝到 `%LOCALAPPDATA%\Programs\MediaGrab`）

## 安裝步驟

### 1. 雙擊 `MediaGrab-Setup-1.0.0-win-x64.exe`

### 2. 若跳出藍色「Windows 已保護您的電腦」警告

這是因為這個程式沒有付費的微軟簽章認證。**這是正常現象，並非病毒**。

**繞過方法**：
1. 在藍色警告畫面，**先不要按「不要執行」**
2. 點擊左上方小小的「**其他資訊**」(More info) 連結
3. 視窗會展開顯示「應用程式：MediaGrab-Setup...」
4. 點擊右下方出現的「**仍要執行**」(Run anyway) 按鈕

### 3. 安裝精靈

1. 同意授權 → 下一步
2. 確認安裝位置（預設不用改）→ 下一步
3. 勾選「**建立桌面捷徑**」→ 下一步
4. 點「**安裝**」開始解壓縮
5. 完成時勾選「**立即啟動 MediaGrab**」→ 完成

### 4. 安裝完成

- 桌面會出現 **MediaGrab** 圖示
- 開始功能表也會有 MediaGrab

## 使用方式

**啟動**：雙擊桌面的 MediaGrab 圖示

啟動後會發生：
1. 程式在背景啟動下載伺服器（不會跳視窗，看不到 cmd 黑視窗）
2. 自動開啟你的預設瀏覽器（Chrome / Edge / Firefox）
3. 進入 `http://localhost:9800` 開始使用

### 介面介紹

- **「下載」分頁**：貼上 YouTube、FB、IG、抖音影片網址，按下載
- **「劇集解析」分頁**：貼上 Gimy 影集、YouTube 播放清單、YouTube 頻道網址，批次下載
- **「直播錄製」分頁**：貼上 Twitch、YouTube Live 直播網址，即時錄製
- **「設定」分頁**：調整下載資料夾、同時下載數量等

下載的影片預設儲存在 `C:\Users\你的使用者名稱\Downloads\MediaGrab\`

## 關閉 MediaGrab

關閉瀏覽器分頁**不會**停止背景下載伺服器（你也可能還想繼續下載）。

要完全關閉：
- 工作管理員 (Ctrl+Shift+Esc) → 找到 `node.exe` 或 `MediaGrab.exe` → 結束工作
- 或：重新開機

## 移除 MediaGrab

- 「設定」→「應用程式」→ 找到「MediaGrab」→ 解除安裝
- 已下載的影片在 `Downloads\MediaGrab\`，不會被刪除

## 疑難排解

### 雙擊圖示後沒反應 / 瀏覽器沒打開

- 等 10-15 秒，第一次啟動較慢
- 手動打開瀏覽器，輸入 `http://localhost:9800`
- 還是不行 → 看伺服器日誌：
  ```
  C:\Users\你的使用者名稱\AppData\Local\MediaGrab\server.log
  ```

### Windows Defender 把 yt-dlp.exe 當成病毒刪除了

這是已知的誤判問題（PyInstaller 打包的 Python 程式常被誤判）。安裝程式已嘗試自動將 MediaGrab 資料夾加入 Defender 排除清單，若失敗請手動加入：

1. 設定 → 隱私權與安全性 → Windows 安全性 → 病毒與威脅防護
2. 病毒與威脅防護設定 → 管理設定
3. 排除項目 → 新增或移除排除項目 → 新增資料夾
4. 選擇 `C:\Users\你的使用者名稱\AppData\Local\Programs\MediaGrab`
5. 重新安裝 MediaGrab

### 部分串流網站下載失敗

- 串流網站經常更新反爬蟲機制
- 看伺服器日誌找錯誤原因
- 嘗試切換到別條「線路」

## 內含的工具版本

| 工具 | 版本 | 用途 |
|------|------|------|
| Node.js | 20.18.0 | 伺服器運行環境 |
| yt-dlp | 最新版 | YouTube/FB/IG/抖音 下載引擎 |
| ffmpeg | 最新 GPL 版 | 影片合併處理 |
| Playwright Chromium | 1.48 | 解析串流影集網站 |

全部自帶，**不需要再安裝 Python、Node.js、Chrome 任何東西**。

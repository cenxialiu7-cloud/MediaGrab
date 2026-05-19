# MediaGrab 安裝指南（Mac 版）

通用影音下載工具 — 可下載 YouTube、Facebook、Instagram、抖音、Twitch、Gimy、小鴨影音等網站的影片與直播。

## 系統需求

- **macOS 11 (Big Sur) 或更新**
- 約 **600 MB** 磁碟空間
- **不需要**安裝 Homebrew、Python、Node.js — 全部都已內建

## 你的 Mac 是哪一種？

打開「**關於這台 Mac**」（左上 Apple 選單 → 關於這台 Mac）查看「晶片」欄位：

| 你看到的 | 該下載哪個檔案 |
|---------|--------------|
| 含 **Apple M1 / M2 / M3 / M4** 字樣 | `MediaGrab-X.Y.Z-mac-arm64.pkg` |
| 含 **Intel** 字樣 | `MediaGrab-X.Y.Z-mac-x64.pkg` |

> 💡 2020 年底之後買的 Mac 幾乎都是 Apple Silicon (arm64)。

## 安裝步驟

### 1. 雙擊下載好的 `.pkg` 檔案

### 2. 處理 macOS 安全警告

這個程式沒有付費的 Apple 開發者認證（每年要 $99 美金），所以 macOS 會擋下安裝。**這不是病毒，是 Apple 的預設保護機制**。

#### 方法 A：系統設定（推薦給一般使用者）

第一次雙擊 .pkg → 會跳出警告：

> **"MediaGrab-X.Y.Z-mac-arm64.pkg" cannot be opened because it is from an unidentified developer.**

按「**好**」關閉警告，然後：

1. 打開「**系統設定**」(System Settings)
2. 點左側「**隱私權與安全性**」(Privacy & Security)
3. 滾到最下面「**安全性**」(Security) 區塊
4. 會看到「**"MediaGrab-X.Y.Z-mac-arm64.pkg" 已遭封鎖**」訊息
5. 點右邊的「**仍要打開**」(Open Anyway) 按鈕
6. 系統會跳出第二次確認 → 點「**打開**」(Open) → 輸入 Mac 開機密碼

接著正常的安裝精靈就會跑起來。

#### 方法 B：終端機一行指令（如果你會用終端機）

如果你看到的訊息是「**"MediaGrab" is damaged and can't be opened**」（更嚴重，方法 A 不一定能解決）：

打開「**終端機**」(Terminal)，輸入：

```bash
sudo xattr -dr com.apple.quarantine ~/Downloads/MediaGrab-1.2.0-mac-arm64.pkg
```

> 把 `1.2.0` 和 `arm64` 換成你實際下載的版本。

輸入 Mac 密碼後，再雙擊 .pkg 就不會跳警告了。

#### 方法 C：USB 隨身碟（給你的朋友）

如果你是要轉傳給家人朋友 — 把 .pkg 放到 **格式化為 FAT32 或 exFAT 的 USB 隨身碟**，對方插入後直接從 USB 雙擊執行 — **完全不會跳任何警告**（因為 FAT/exFAT 不儲存 macOS 的 quarantine 標記）。

### 3. 完成安裝精靈

1. 安裝精靈打開後一直「**繼續**」就好
2. 安裝位置會自動是 `/Applications/MediaGrab.app`
3. 完成後可關閉精靈

## 啟動 MediaGrab

打開 **Launchpad**（F4 鍵或拖四指）→ 找到 **MediaGrab** 圖示 → 點擊。

啟動後會發生：
1. 程式在背景啟動下載伺服器（看不到任何視窗，正常）
2. 約 3-5 秒後自動打開你的預設瀏覽器（Safari / Chrome / Edge / Firefox）
3. 進入 `http://localhost:9800` 開始使用

### 首次啟動如果再次被擋

第一次啟動 .app 時，可能再跳一次「**"MediaGrab" cannot be opened**」警告 — 解決方法：

- 在 Finder 找到 `/Applications/MediaGrab.app`
- **按住 Control 點擊**（或右鍵）→ 選「**打開**」
- 跳出警告後選「**打開**」
- 之後就不會再問了

## 使用方式

打開瀏覽器介面後，預設在「**✨ 智能 Smart**」分頁：

1. 貼上**任何影音網址**（YouTube / Twitch / Gimy / 抖音 等）
2. 按「**解析 Parse**」
3. 程式自動判斷是哪種內容，並顯示對應的操作介面：
   - 一般影片 → 選擇畫質下載
   - YouTube 播放清單 / 頻道 → 勾選要下載的影片
   - Gimy / 小鴨影集 → 選擇線路 + 集數
   - Twitch / YouTube 直播 → 開始錄製
4. 下載中的進度會出現在底下「下載佇列」

下載的影片預設儲存在 `~/Downloads/MediaGrab/` 資料夾。

## 關閉 MediaGrab

關掉瀏覽器分頁 **不會**停止背景下載伺服器（你可能還想繼續下載）。

要完全關閉：
- 開啟「**活動監視器**」(Activity Monitor) → 搜尋 `node` → 選擇 → 按上方「✕」結束
- 或：重新開機
- 或：終端機輸入 `lsof -ti tcp:9800 | xargs kill`

## 移除 MediaGrab

1. 把 `/Applications/MediaGrab.app` 拖到垃圾桶
2. 刪除設定檔：`~/Library/Application Support/MediaGrab/`（含日誌）
3. 已下載的影片在 `~/Downloads/MediaGrab/`，自行決定要不要保留

## 疑難排解

### 雙擊圖示後過了 10 秒瀏覽器沒打開

- 再等一下（首次啟動較慢）
- 手動打開瀏覽器，輸入 `http://localhost:9800`
- 還是不行 → 看伺服器日誌：
  ```
  ~/Library/Application Support/MediaGrab/server.log
  ```

### 跳出「"MediaGrab" is damaged」訊息

這是 macOS 的 quarantine 標記造成。用上面的「**方法 B 終端機指令**」就能解決。

### 下載特定網站失敗

- 串流網站（如 Gimy）經常更新反爬蟲機制
- 看日誌找錯誤訊息
- 可以嘗試切換「線路」

## 內含的工具版本

| 工具 | 用途 |
|------|------|
| Node.js 20 | 伺服器運行環境 |
| yt-dlp (最新) | YouTube/FB/IG/抖音 下載引擎 |
| ffmpeg 7 (靜態版) | 影片合併處理 |
| Playwright Chromium | 解析串流影集網站 |

**全部都已自帶在 .pkg 裡，不需要再安裝任何東西**。

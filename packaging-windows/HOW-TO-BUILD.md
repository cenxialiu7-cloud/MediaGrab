# 如何用 GitHub Actions 打包 Windows 版

這份指南教你（操作者）如何把 MediaGrab 推到 GitHub，讓 GitHub Actions 自動在 Windows 機器上幫你打包出 `.exe` 安裝程式，然後下載下來給對方。

---

## 一次性設定（只做一次）

### 1. 建立 GitHub 帳號 & 安裝 GitHub CLI

如果還沒有 GitHub 帳號：
- 前往 https://github.com/signup 註冊（免費）

安裝 GitHub CLI（讓你在終端機可以直接操作 GitHub）：
```bash
brew install gh
```

登入：
```bash
gh auth login
# 選擇：GitHub.com → HTTPS → Login with a web browser → 跟著螢幕指示完成
```

### 2. 建立 GitHub repository 並推上去

從專案資料夾執行（**已經幫你 init 過 git 了**）：

```bash
cd "$HOME/Claude Code/MediaGrab"

# 把目前所有檔案加入 git
git add .
git commit -m "Initial commit: MediaGrab v1.0"

# 建立 GitHub repo（private 比較好，因為 yt-dlp 屬於灰色地帶）
gh repo create MediaGrab --private --source=. --push

# 完成！你的程式碼現在在 https://github.com/你的帳號/MediaGrab
```

---

## 每次打包新版本（重複操作）

### 方法 A：手動觸發（最簡單，推薦）

1. 把任何想改的程式碼修改完，commit + push：
   ```bash
   git add . && git commit -m "改了什麼" && git push
   ```

2. 前往 GitHub → 你的 MediaGrab repo → 上方點「**Actions**」分頁
3. 左側選「**Build Windows Installer**」
4. 右上「**Run workflow**」按鈕 → 輸入版本號（如 `1.0.1`）→ 綠色 **Run workflow** 按鈕
5. 等約 **5-10 分鐘**（畫面會顯示進度，每個步驟一個勾勾）
6. 完成後，下方會出現 **Artifacts** 區塊 → 點 `MediaGrab-Windows-Installer-1.0.1` 下載 `.zip`
7. 解壓縮 → 裡面就是 `MediaGrab-Setup-1.0.1-win-x64.exe`（約 220 MB）

### 方法 B：用 git tag 自動觸發 + 自動建立 Release

```bash
# 打版本標籤
git tag v1.0.1
git push origin v1.0.1
```

這會：
- 自動跑 build workflow
- 完成後自動在 GitHub Releases 頁面建立一個發布項目，附帶 `.exe`
- 對方可以直接從 `https://github.com/你的帳號/MediaGrab/releases` 下載

---

## 把 .exe 給對方

下載到 `MediaGrab-Setup-X.Y.Z-win-x64.exe` 後，三種傳遞方式：

| 方式 | 對方體驗 | SmartScreen 警告？ |
|------|---------|-------------------|
| **USB 隨身碟** ⭐ | 完美 | **不會** (FAT/exFAT 不帶 MOTW) |
| GitHub Release 連結 | 對方點連結下載 | 會（教對方點「其他資訊→仍要執行」） |
| LINE / WhatsApp / Email 傳檔 | 對方下載解壓 | 會 |
| 雲端硬碟（Google Drive / Dropbox） | 對方下載 | 會 |

連同附上 `README-給Windows使用者.md`，對方就知道怎麼處理 SmartScreen。

---

## 疑難排解

### Actions 跑到一半失敗怎麼辦？

點進失敗的那一步看紅色錯誤訊息。常見原因：
- **網路逾時下載 yt-dlp / ffmpeg** → 重跑 workflow
- **某個套件版本不相容** → 改 package.json 後重 push

### 想看每個步驟的 log

Actions → 進入失敗的 run → 點任一步驟左邊的 `>` 展開即可看到完整輸出。

### 我修改了 server/ 或 client/ 的程式碼

只要 `git push` 後重跑 workflow（方法 A）即可。Vite client 會自動重 build、production 依賴會重新安裝。

### 想自訂版本號規則

修改 `.github/workflows/build-windows.yml` 開頭的 `workflow_dispatch.inputs.version.default`。

---

## GitHub Actions 用量

GitHub 對免費帳號的 Windows runner 額度是 **每月 2000 分鐘**（私人 repo），公開 repo 完全免費無限。
- 這個 workflow 跑一次約 **8-12 分鐘**
- 等於每月可打包 ~150 次以上，足夠了

如果擔心額度：把 repo 設為 **public** 即可無限免費（但 yt-dlp 屬灰色地帶，建議 private）。

---

## 一鍵指令範例

```bash
# 推上 GitHub & 第一次打包
cd "$HOME/Claude Code/MediaGrab"
git add . && git commit -m "v1.0.0 release" && git push
gh workflow run build-windows.yml -f version=1.0.0

# 等 workflow 跑完，下載產出
gh run list --workflow=build-windows.yml --limit 1
gh run download <RUN_ID>      # 把 ID 換成上一行顯示的數字
```

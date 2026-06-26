# 如何用 GitHub Actions 打包並分發 Mac 版

## 一次性設定（已完成）

GitHub Actions workflow 已建立在 `.github/workflows/build-mac.yml`，會自動在 GitHub 的 Mac runner 上：

1. 下載 Node.js / yt-dlp / ffmpeg / Playwright Chromium
2. 組裝 `.app` bundle
3. 用 `pkgbuild` 產出 `.pkg` 安裝程式
4. 同時建構 **arm64**（M 系列晶片）和 **x64**（Intel Mac）兩個版本
5. 推 git tag 時自動建立 GitHub Release 並掛上 `.pkg` 下載連結

## 每次打包新版本

### 方法 A：手動觸發（最常用）

```bash
# 推程式碼改動
git add . && git commit -m "改了什麼" && git push

# 觸發打包
gh workflow run build-mac.yml -f version=1.2.0 -f arch=arm64
```

`arch` 參數可選：
- `arm64` — 只打 Apple Silicon（M1/M2/M3/M4），約 7 分鐘
- `x64` — 只打 Intel Mac，約 7 分鐘
- `both` — 兩個都打（並行），約 8 分鐘

等完成後下載：

```bash
gh run list --workflow=build-mac.yml --limit 1
gh run download <RUN_ID> --dir packaging/dist/
ls -lh packaging/dist/
```

### 方法 B：git tag 自動觸發 + 自動發布

```bash
git tag v1.3.0
git push origin v1.3.0
```

這會：
- 同時觸發 Mac CI（兩種架構都建）+ Windows CI
- 完成後自動在 GitHub Releases 頁面建立 v1.3.0 發布項目
- 附帶三個下載：
  - `MediaGrab-1.3.0-mac-arm64.pkg`
  - `MediaGrab-1.3.0-mac-x64.pkg`
  - `MediaGrab-1.3.0-win-x64.exe`

對方可以直接從 `https://github.com/cenxialiu7-cloud/MediaGrab/releases` 自選下載。

## 給對方的分發方式

下載完 `.pkg` 之後，依對方科技程度選最合適的方式：

| 對方類型 | 建議方式 | 對方體驗 |
|---------|---------|---------|
| 完全新手家人 | **USB 隨身碟（FAT/exFAT 格式）** | ✅ 零警告，雙擊就裝 |
| 一般朋友 | LINE / Messenger / Email 傳檔 + 附上 README-給Mac使用者.md | ⚠️ 會跳 Gatekeeper 警告，照 README 步驟即可 |
| 技術朋友 | GitHub Release 連結 + 終端機 xattr 指令 | ✅ 一行指令繞過 |

### USB 隨身碟方式（推薦給長輩、家人）

```bash
# 假設 USB 在 /Volumes/隨身碟
cp packaging/dist/MediaGrab-1.2.0-mac-arm64.pkg "/Volumes/隨身碟/"
cp packaging/README-給Mac使用者.md            "/Volumes/隨身碟/"
diskutil eject "/Volumes/隨身碟"
```

> ⚠️ USB 必須是 **FAT32 或 exFAT** 格式（隨身碟預設大多是）。**不要用 APFS / Mac OS Extended**，否則會帶 quarantine 標記。

對方插入 USB → 雙擊 .pkg → 直接走完安裝精靈 → 完全沒有任何「未識別的開發者」警告。

## 完整一次到位指令

例如要發布 v1.3.0：

```bash
cd "$HOME/Claude Code/MediaGrab"

# 1. 提交所有改動
git add . && git commit -m "Release v1.3.0"

# 2. 打 tag 觸發 Mac+Windows 一起 build
git tag v1.3.0 && git push origin main v1.3.0

# 3. 等所有 build 完成（約 10 分鐘）
gh run watch

# 4. 看 Release 頁面確認 3 個檔案都掛上去了
gh release view v1.3.0
```

## 疑難排解

### Mac CI build 失敗怎麼辦

```bash
# 查看哪一步壞了
gh run view <RUN_ID> --log-failed | tail -50
```

常見問題：
- **ffmpeg 下載 URL 改變** → 改 workflow 的 `FFMPEG_ARM64_URL` / `FFMPEG_X64_URL`
- **Playwright Chromium 下載逾時** → 重跑（GH runner 偶爾網路慢）
- **pkgbuild 簽章警告** → 正常，我們用 ad-hoc 簽章不影響功能

### GitHub Actions 用量

私人 repo 在免費帳號：
- **Linux runner: 2000 分鐘/月** （免費）
- **macOS runner: 用量 ×10**（一個 mac 分鐘算 10 個 linux 分鐘）
- 也就是說 macOS 有效額度約 **200 分鐘/月**

這個 workflow 跑一次（單一架構）約 **7-10 分鐘**，等於每月可打包 **約 20-25 次**。

如果想無限制：把 repo 設為 **public** 即可（但 yt-dlp 屬灰色地帶，建議 private）。

## 回復點

如果這套 CI 流程出問題，可以退回到加入 Mac CI 之前的狀態：

```bash
git reset --hard v1.2.0-before-mac-ci
```

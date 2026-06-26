# 如何發布下載頁 + 埋圖像/影片廣告

這份指南教你：(1) 把 `docs/` 變成公開的 GitHub Pages 下載頁、(2) 在頁面埋入會計費的圖像/影片廣告。

---

## Part 1：啟用 GitHub Pages

### ⚠️ 先決定：repo 要公開還是私有？

下載頁要能讓人**下載安裝檔**，而安裝檔放在 GitHub Releases。這牽涉到一個關鍵選擇：

| 方案 | Pages 能否免費 | 安裝檔能否公開下載 | 廣告能否計費 |
|------|--------------|------------------|------------|
| **A. repo 設為 public** | ✅ 免費 | ✅ Release 直接公開下載 | ✅ 公開網域可計費 |
| **B. repo 保持 private** | ❌ 需 GitHub Pro 付費 | ❌ Release 需登入才能下載 | — |

**建議走方案 A（設為 public）**，因為：
- 這是 yt-dlp、Stacher 等同類工具的標準做法（純桌面工具公開原始碼風險極低）
- 法律研究顯示：風險在於「經營託管服務」，而非「公開一個桌面工具的原始碼」
- 安裝檔能公開下載，下載頁的 JS 才能自動抓最新版本連結
- GitHub Pages 對 public repo 免費

如果你堅持 private，下載頁仍可建立，但安裝檔要另外傳（USB／雲端），且 Pages 需付費。

### 啟用步驟（方案 A）

1. 把 repo 設為 public：
   ```bash
   gh repo edit cenxialiu7-cloud/MediaGrab --visibility public --accept-visibility-change-consequences
   ```
2. 到 GitHub repo → **Settings** → **Pages**
3. **Source** 選 `Deploy from a branch`
4. **Branch** 選 `main`，資料夾選 **`/docs`**，按 **Save**
5. 等 1-2 分鐘，你的下載頁就會在：
   ```
   https://cenxialiu7-cloud.github.io/MediaGrab/
   ```

> 之後每次 `git push` 改動 `docs/`，Pages 會自動重新部署。

---

## Part 2：在下載頁埋圖像/影片廣告

下載頁有 **3 個廣告位置**，都用 HTML 註解標好了：

| 位置 | HTML 標記 | 適合格式 |
|------|----------|---------|
| `<head>` 全站腳本 / 驗證 | `AD_VERIFY_META_PLACEHOLDER` | 廣告網路的網站驗證 meta、全站 push 腳本 |
| Hero 下方橫幅 | `AD_ZONE_LEADERBOARD_PLACEHOLDER` | 728×90 圖片橫幅 / 影片 |
| Features 下方方塊 | `AD_ZONE_RECTANGLE_PLACEHOLDER` | 300×250 圖片 / 影片 |

### 步驟：在 Monetag 建立顯示廣告

1. 到 https://publishers.monetag.com → **Websites** → **Add new website**
2. 網址填你的 GitHub Pages 網址：`https://cenxialiu7-cloud.github.io/MediaGrab/`
3. 等審核通過（通常數小時到 1 天）
4. 建立 **Ad Unit**，選格式：
   - **Banner 728×90** 或 **300×250**（圖片廣告）
   - **Vignette Banner**（全螢幕圖片/影片，換頁時出現）
   - **In-Page Push**（圖文卡片）
5. 複製 Monetag 給你的廣告碼（通常是一段 `<script>...</script>`）

### 步驟：把廣告碼貼進頁面

打開 `docs/index.html`，找到對應的 placeholder 註解，把廣告碼貼在它的位置。例如：

```html
<!-- 找到這行： -->
<div id="ad-zone-leaderboard" class="ad-zone ad-leaderboard">
  <!-- AD_ZONE_LEADERBOARD_PLACEHOLDER -->
</div>

<!-- 改成（把 Monetag 廣告碼貼進去）： -->
<div id="ad-zone-leaderboard" class="ad-zone ad-leaderboard">
  <script type="text/javascript">
    /* Monetag 給你的廣告碼貼這裡 */
  </script>
</div>
```

網站驗證的 meta tag 則貼在 `<head>` 的 `AD_VERIFY_META_PLACEHOLDER` 註解處。

### 推送上線

```bash
cd "$HOME/Claude Code/MediaGrab"
git add docs/index.html
git commit -m "chore: add Monetag display ad zones to landing page"
git push
# GitHub Pages 會自動重新部署（1-2 分鐘）
```

---

## Part 3：為什麼這比 App 內嵌廣告好

| | App 內嵌廣告 (localhost) | GitHub Pages 下載頁廣告 |
|---|---|---|
| 廣告網路驗證 | ❌ 無法驗證 localhost | ✅ 公開網域可驗證 |
| 圖像/影片廣告計費 | ⚠️ 可能不計費 / 被當無效流量 | ✅ 正常計費 |
| 觸及對象 | 已安裝的使用者 | 所有來下載的訪客（更多人） |
| 風險 | 帳號可能被封 | 低 |

**策略**：下載頁放圖像/影片廣告（賺曝光/點擊）+ App 內保留 VPN 聯盟連結（賺高價轉換）。兩邊互補。

---

## Part 4：提升廣告核准率的建議

廣告網路審核網站時，會希望看到「真實內容」而非純下載牆。本下載頁已包含：
- ✅ 功能介紹區（Features）
- ✅ 使用教學（How to Use）
- ✅ 常見問題（FAQ）
- ✅ 隱私政策頁（`privacy.html`）— **這是 Monetag/Adsterra 核准的必要條件**
- ✅ 頁尾免責聲明

這些都會增加核准機率。

---

## 疑難排解

### GitHub Pages 顯示 404
- 確認 Settings → Pages 的 Source 設為 `main` branch + `/docs` 資料夾
- 等 2 分鐘讓部署完成
- 確認 `docs/index.html` 存在

### 下載按鈕點了沒反應 / 連到舊版
- `docs/app.js` 會用 GitHub API 抓最新 Release
- 確認你已經有發布 Release（用 `git tag vX.Y.Z && git push origin vX.Y.Z` 觸發 CI 自動建立）
- 若 API 失敗，按鈕會 fallback 到 Releases 頁面

### 廣告不顯示
- 確認 Monetag 已審核通過你的網站
- 確認廣告碼貼在正確的 placeholder 位置
- 用無痕視窗測試（你自己的瀏覽器可能裝了 adblock）
- 廣告需要時間開始填充（fill），剛上線可能空白

---

## 回復點

- 加下載頁之前的 tag：`v1.3.2`
- 移除下載頁：刪掉 `docs/` 資料夾 + 關閉 Settings → Pages

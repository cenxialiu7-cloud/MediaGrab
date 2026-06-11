# MediaGrab — Monetization Configuration Guide

> ⚠️ **2026-06 更新：VPN 聯盟管道已證實無法取得**（NordVPN / Surfshark / ExpressVPN
> 申請皆無法通過 / 不開放本案類型）。VPN 已從變現策略移除，**主收入改為顯示廣告**
> （Adsterra / Monetag），抖內為輔。程式內 `VPN_OFFERS` url 留空 → SponsorBar 自動隱藏，
> 無需改碼；本文件中 VPN 相關段落僅保留作歷史紀錄。

## 概覽 / Overview

MediaGrab 全功能免費，透過以下方式支援開發成本：

1. **顯示廣告（主收入）** — Adsterra / Monetag 等可接受影音工具的聯播網（banner + Smartlink/Direct Link）
2. **抖內（次收入）** — Ko-fi / Buy Me a Coffee
3. ~~**VPN 聯盟**~~ — ❌ 已證實無法取得，停止投入（見上方更新）

**所有變現元素都尊重使用者**：
- 設定頁面有「關閉廣告」開關，一鍵全部關掉
- SponsorBar 可單獨關閉並記住偏好
- 不追蹤使用者下載歷史
- 不傳送任何資料到第三方分析服務（廣告 script 例外，由聯播網控制）

---

## 設定步驟（站長 / 維護者）

### 1. ~~註冊 VPN 聯盟帳號~~ ❌ 已證實無法取得

> 2026-06：以下 VPN 聯盟管道皆無法取得（申請未通過 / 不開放本案類型），**不要再投入時間嘗試**。
> 此表僅保留作歷史紀錄。主收入改走「2. 廣告聯播網」。

| 聯盟 | 註冊網址 | 狀態 | （原）單次轉換獎金 |
|------|---------|------|-----------|
| ~~NordVPN~~ | https://nordvpn.com/affiliate/ | ❌ 無法取得 | $22-36 |
| ~~Surfshark~~ | https://surfshark.com/affiliates | ❌ 無法取得 | $20-30 |
| ~~ExpressVPN~~ | https://www.expressvpn.com/affiliates | ❌ 無法取得 | $13-36 |

### 2. 註冊廣告聯播網

| 聯播網 | 註冊網址 | 審核時間 | 主要產品 |
|--------|---------|---------|---------|
| PropellerAds | https://propellerads.com/publishers/ | 24h | SmartLink、In-Page Push、Banner |
| Adsterra | https://adsterra.com/publisher/ | 24-48h | Native Ads、Social Bar、Direct Link |
| HilltopAds | https://hilltopads.com/ | 24h | Banner、Push（備援） |

⚠️ **絕對不要申請** Google AdSense / Media.net / Ezoic / Mediavine — 政策明文禁止下載類網站，浪費時間。

### 3. 修改設定檔

編輯 `client/src/monetization.js`：

```js
export const VPN_OFFERS = [
  {
    name: 'NordVPN',
    url:  'https://go.nordvpn.net/aff_c?offer_id=15&aff_id=YOUR_REAL_ID',
    headline: '解鎖地區限制影片 · Unlock region-restricted videos',
    subtext:  'NordVPN 限時 68% 折扣',
    badge:    '⚡ 限時優惠',
  },
];

export const AD_ZONES = {
  'smart-welcome': {
    network: 'adsterra',
    scriptSrc: '//pl12345678.profitableratecpm.com/abc.../invoke.js',  // 從 Adsterra dashboard 拿
    containerId: 'ad-smart-welcome',
    height: 90,
  },
  // ... 其他 zone 同理
};

export const SUPPORT_LINKS = {
  kofi: 'https://ko-fi.com/yourusername',
  // ...
};
```

### 4. 重 build + 重打包

```bash
# 本機測試
cd client && npx vite build && cd ..
node server/index.js

# 觸發 CI 重 build Mac + Windows .pkg/.exe
git add client/src/monetization.js
git commit -m "chore: add real affiliate URLs and ad zone scripts"
git push
gh workflow run build-mac.yml -f version=1.3.0 -f arch=both
gh workflow run build-windows.yml -f version=1.3.0
```

---

## 元件位置（哪裡會顯示廣告/聯盟連結）

| 元件 | 檔案 | 顯示位置 | 內容 |
|------|------|---------|------|
| ~~**SponsorBar**~~ | `client/src/components/SponsorBar.jsx` | 所有分頁的 header 下方 | ~~VPN affiliate 橫幅~~ → VPN 下架後 `VPN_OFFERS` url 留空，**此橫幅已自動隱藏**（程式碼保留待未來換其他聯盟） |
| **AdSlot: smart-welcome** | 用在 `SmartInput.jsx` | 智能分頁初始畫面 | 廣告 banner |
| **AdSlot: queue-empty** | 用在 `DownloadQueue.jsx` | 下載佇列空白時 | 廣告 banner |
| **AdSlot: settings-bottom** | 用在 `Settings.jsx` | 設定分頁底部 | 廣告 banner |
| **Support section** | `Settings.jsx` | 設定分頁中段 | Ko-fi 連結（VPN 推薦已下架，url 留空自動隱藏） |

**所有元件都會在以下情況自動隱藏**：
- `monetization.js` 對應的 URL/scriptSrc 為空字串
- 使用者勾選「關閉廣告」設定
- SponsorBar 額外：使用者點 ✕ 關閉（記在 localStorage）

---

## 隱私聲明範本（要放進 README 與 App 內）

```markdown
## 隱私 / Privacy

MediaGrab 是免費開源工具。為支援開發成本，本程式會：

- 載入第三方廣告腳本（Adsterra / Monetag）— 這些腳本可能放置 cookies 並追蹤瀏覽行為
- 不收集、不傳送你的下載歷史或檔案內容到任何伺服器

**你可以在「設定」分頁勾選「關閉廣告」一鍵停用所有第三方腳本與聯盟連結。**

MediaGrab itself does not track downloads, store filenames, or send any
personal data anywhere. Third-party ad networks loaded when ads are enabled
operate under their own privacy policies (see PropellerAds / Adsterra).
```

---

## 收入追蹤建議

### 每週固定看的數據

1. **Adsterra dashboard** → Impressions / RPM / Earnings（主收入）
2. **Monetag dashboard** → Impressions / RPM / Earnings
3. **Ko-fi page** → Tip count
4. ~~NordVPN dashboard~~ → VPN 聯盟已下架

### UTM 追蹤已內建

所有 outbound 聯盟/抖內 URL 都會自動附加：
- `utm_source=mediagrab`
- `utm_medium=app`
- `utm_campaign=v1.3`
- `utm_content=sponsorbar` 或 `settings`（依位置）

讓你能在 Adsterra / Monetag dashboard 看出**哪個位置/版位表現最好**。

---

## A/B 測試建議

> ~~原針對 `VPN_OFFERS` 的 A/B 流程~~ — VPN 管道下架後不適用。
> 改測顯示廣告時，可在 `CLICK_OFFERS`（Adsterra Smartlink / Direct Link、Monetag Direct Link）
> 之間切換主力，用 `pickClickOffer()` 已內建的隨機分流比較各網路 fill / RPM。

---

## 法律姿態強化

App 內所有文案、README、產品說明都應使用：

- ✅ 「個人影音備份」「Personal video backup」
- ✅ 「儲存你自己的 / Creative Commons / 公開直播」
- ✅ 「Users are responsible for complying with source site ToS and copyright law」

避免：

- ❌ 「下載 Netflix / Disney+ / 院線片」
- ❌ 「破解地區限制看正版」
- ❌ 任何具體版權內容名稱

這是台灣著作權法 §87(1)(7) 安寶箱條款的關鍵防線：**有沒有「以營利為目的、廣告/誘使侵權」**。文案中性 + 廣告為一般聯播網顯示廣告（非侵權服務、與下載標的無關）→ 安寶箱條款很難套用。

> 註：VPN 聯盟下架後，廣告改為 Adsterra / Monetag 一般顯示廣告。法律姿態核心不變——
> 關鍵仍是「文案中性、不誘使侵權」，而非廣告賣什麼。

---

## 撤回路徑（萬一需要把廣告/聯盟全砍掉）

如果某天決定回到純 FOSS（沒廣告、沒聯盟）：

```bash
# 把 monetization.js 全部欄位清空，UI 元件會自動隱藏
git revert <commit-hash-of-monetization>
# 或直接編輯 monetization.js 把所有 url / scriptSrc 改成 ''
git push
gh workflow run build-mac.yml -f version=1.3.x -f arch=both
gh workflow run build-windows.yml -f version=1.3.x
```

回復點 tag：`v1.2.0-before-monetize`

---

## 回顧研究依據

整套變現策略源自 `/Users/yoyo/.claude/plans/1-2-starry-widget*.md` 的研究：

- AdSense / 主流聯播網政策禁止 → 改走 PropellerAds / Adsterra
- 桌面 App 模式 vs 架站 → 桌面 App 法律風險低 99%
- ~~VPN 聯盟單次 $22-36 → 每 1000 訪客 $10-70~~ → **VPN 管道 2026-06 證實無法取得，此估算作廢**
- Yout v. RIAA、Gimy 案 → 不接受付款 = 不像「販賣服務」 = 訴訟風險 < 1%

預期年收：原估算大幅依賴 VPN 聯盟單次高獎金；VPN 下架後，收入主軸轉為顯示廣告 RPM
（Adsterra / Monetag，每 1000 曝光約 $0.5-3，視地區/版位），**年收預期需依實際廣告數據重估**。

import React, { useState, useEffect } from 'react';
import AdSlot from './AdSlot';
import { VPN_OFFERS, SUPPORT_LINKS, getActiveClickOffers, pickClickOffer, withUtm } from '../monetization';

export default function Settings({ deps, settings: parentSettings, onSettingsChange }) {
  const [settings, setSettings] = useState(parentSettings || null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [extInfo, setExtInfo] = useState(null);
  const [copied, setCopied] = useState('');
  const [hostBusy, setHostBusy] = useState(false);
  const [hostMsg, setHostMsg] = useState('');

  useEffect(() => {
    if (!settings) {
      fetch('/api/settings')
        .then(r => r.json())
        .then(s => {
          setSettings(s);
          if (onSettingsChange) onSettingsChange(prev => ({ ...prev, ...s }));
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    fetch('/api/extension/info').then(r => r.json()).then(setExtInfo).catch(() => {});
  }, []);

  const copy = (text, key) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(''), 1500);
    }).catch(() => {});
  };

  const refreshExtInfo = () =>
    fetch('/api/extension/info').then(r => r.json()).then(setExtInfo).catch(() => {});

  // Open Finder/Explorer at the (server-known) staged extension folder so the
  // user can drag it into chrome://extensions — the reliable alternative to
  // navigating the picker into a hidden ~/Library path.
  const revealExtension = () => {
    setHostMsg('');
    fetch('/api/extension/reveal', { method: 'POST' })
      .then(r => r.json())
      .then(d => { if (!d.ok) setHostMsg('✗ 無法開啟資料夾：' + (d.error || '')); })
      .catch(() => setHostMsg('✗ 無法開啟資料夾'));
  };

  // One-click native-host install — runs native-host/install.js via the bundled
  // node so the user doesn't need a terminal.
  const installHost = () => {
    setHostBusy(true); setHostMsg('');
    fetch('/api/extension/install-host', { method: 'POST' })
      .then(r => r.json())
      .then(d => {
        setHostBusy(false);
        if (d.ok) {
          setHostMsg('✓ 已安裝橋接' + (d.registered ? '' : '（尚未偵測到瀏覽器，開啟 Chrome 後可重按）'));
          refreshExtInfo();
        } else {
          setHostMsg('✗ 安裝失敗：' + (d.error || ('exit ' + d.exitCode)) + ' — 可改用下方終端機指令');
        }
      })
      .catch(() => { setHostBusy(false); setHostMsg('✗ 安裝失敗，請改用下方終端機指令'); });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const updated = await res.json();
      setSaved(true);
      if (onSettingsChange) onSettingsChange(prev => ({ ...prev, ...updated }));
      setTimeout(() => setSaved(false), 2000);
    } catch {} finally {
      setSaving(false);
    }
  };

  if (!settings) return <div className="text-dark-300">載入設定中... · Loading settings...</div>;

  // Filter VPN offers to only those with real URLs configured
  const activeOffers = VPN_OFFERS.filter(o => o.url && o.url.trim().length > 0);
  // Pick one ad link (rotates across Adsterra / Monetag each render to split traffic)
  const sponsoredLink = pickClickOffer();
  const hasSupport = SUPPORT_LINKS.kofi || activeOffers.length > 0 || sponsoredLink;

  return (
    <div className="space-y-6">
      <div className="bg-dark-800 rounded-xl p-6 border border-dark-600">
        <h2 className="text-lg font-semibold mb-4">下載設定 · Download Settings</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-dark-200 mb-1">下載目錄 · Download Directory</label>
            <input
              type="text"
              value={settings.outputDir}
              onChange={e => setSettings(s => ({ ...s, outputDir: e.target.value }))}
              className="w-full bg-dark-700 border border-dark-500 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-accent transition-colors"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-dark-200 mb-1">同時下載數量 · Max Concurrent Downloads</label>
              <input
                type="number"
                value={settings.maxConcurrent}
                onChange={e => setSettings(s => ({ ...s, maxConcurrent: parseInt(e.target.value) || 3 }))}
                min="1" max="10"
                className="w-full bg-dark-700 border border-dark-500 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-accent transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm text-dark-200 mb-1">每任務線程數 · Threads per Task</label>
              <input
                type="number"
                value={settings.threadsPerTask}
                onChange={e => setSettings(s => ({ ...s, threadsPerTask: parseInt(e.target.value) || 8 }))}
                min="1" max="32"
                className="w-full bg-dark-700 border border-dark-500 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-accent transition-colors"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-dark-200 mb-1">cookies.txt 檔案（需登入的串流／課程站）· cookies.txt File</label>
            <input
              type="text"
              value={settings.cookiesFile || ''}
              onChange={e => setSettings(s => ({ ...s, cookiesFile: e.target.value }))}
              placeholder="/path/to/cookies.txt"
              className="w-full bg-dark-700 border border-dark-500 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-accent transition-colors"
            />
            <p className="text-xs text-dark-400 mt-1">
              用瀏覽器擴充（如「Get cookies.txt LOCALLY」）匯出 Netscape 格式 cookies.txt，填入路徑。
              這是唯一能讓「登入後才看得到的串流／課程影片」下載的方式（同時餵 yt-dlp 與內建串流引擎）。
              <br />
              <span className="opacity-70">Export a Netscape cookies.txt from your logged-in browser; this is what unlocks login-gated streaming / course videos.</span>
            </p>
          </div>
          <div>
            <label className="block text-sm text-dark-200 mb-1">瀏覽器 Cookie（僅 YouTube／FB 等 yt-dlp 站）· Browser Cookies</label>
            <select
              value={settings.cookies}
              onChange={e => setSettings(s => ({ ...s, cookies: e.target.value }))}
              className="w-full bg-dark-700 border border-dark-500 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-accent transition-colors"
            >
              <option value="">不使用 None</option>
              <option value="chrome">Chrome</option>
              <option value="firefox">Firefox</option>
              <option value="safari">Safari</option>
              <option value="edge">Edge</option>
            </select>
            <p className="text-xs text-dark-400 mt-1">
              直接讀取瀏覽器 cookie，免匯出檔案，但只對 yt-dlp 支援的站（YouTube／FB／IG…）有效，串流／課程站請改用上方 cookies.txt。
              若同時設定，以 cookies.txt 優先。
            </p>
          </div>

          {/* Disable Ads toggle — important for ePrivacy compliance */}
          <div className="flex items-center justify-between p-3 bg-dark-700 rounded-lg">
            <div className="flex-1">
              <div className="text-sm text-white">關閉廣告與贊助橫幅 · Disable ads &amp; sponsor banner</div>
              <div className="text-xs text-dark-300 mt-0.5">
                MediaGrab 完全免費。廣告與 VPN 贊助連結幫助維持開發，但你可以關閉它們。
                <br />
                <span className="opacity-70">MediaGrab is free. Ads &amp; affiliate links support development, but you can turn them off.</span>
              </div>
            </div>
            <label className="ml-3 inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={!!settings.disableAds}
                onChange={e => setSettings(s => ({ ...s, disableAds: e.target.checked }))}
                className="sr-only peer"
              />
              <div className="relative w-11 h-6 bg-dark-500 peer-focus:ring-2 peer-focus:ring-accent rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-transform peer-checked:bg-accent"></div>
            </label>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-3 bg-accent hover:bg-accent-hover text-white rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {saved ? '已儲存！ Saved!' : saving ? '儲存中... Saving...' : '儲存設定 · Save Settings'}
          </button>
        </div>
      </div>

      {/* Browser Extension setup — only shown when the extension files are present
          (dev/repo, or a build that bundles them); hidden otherwise. */}
      {extInfo?.available && (
      <div className="bg-dark-800 rounded-xl p-6 border border-dark-600">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">瀏覽器擴充 · Browser Extension</h2>
          {extInfo && (
            <span className={`text-xs px-2 py-1 rounded-full ${extInfo.nativeHostRegistered ? 'bg-green-900/50 text-green-400' : 'bg-dark-600 text-dark-300'}`}>
              {extInfo.nativeHostRegistered ? '✓ 已安裝橋接' : '尚未安裝'}
            </span>
          )}
        </div>
        <p className="text-sm text-dark-300 mb-4">
          下載「需登入的串流／線上課程」影片（例如用 Vimeo 嵌入的課程站）。後端掃描器看不到、登入後才有的串流，由擴充在你<b>已登入的瀏覽器</b>裡擷取後交給 MediaGrab 下載。
          <br /><span className="text-dark-400">Capture login-gated / worker-hidden streams from your logged-in browser and download them here.</span>
        </p>

        <div className="space-y-4">
          <div>
            <div className="text-sm font-medium mb-1">1. 安裝 native 橋接（一次性）· Install native host</div>
            <button
              onClick={installHost}
              disabled={hostBusy}
              className="w-full text-sm px-3 py-2 mb-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg font-medium"
            >
              {hostBusy ? '安裝中…' : (extInfo?.nativeHostRegistered ? '✓ 已安裝 — 重新安裝橋接（一鍵）' : '⚡ 一鍵安裝橋接')}
            </button>
            {hostMsg && <div className="text-xs mb-2 text-dark-200">{hostMsg}</div>}
            <div className="text-xs text-dark-400 mb-1">或在終端機手動執行（等效）：</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-dark-900 px-3 py-2 rounded-lg overflow-x-auto whitespace-nowrap">{extInfo?.installCmd || 'node native-host/install.js'}</code>
              <button onClick={() => copy(extInfo?.installCmd || '', 'cmd')} className="text-xs px-3 py-2 bg-dark-700 hover:bg-dark-600 rounded-lg shrink-0">{copied === 'cmd' ? '已複製' : '複製'}</button>
            </div>
          </div>

          <div>
            <div className="text-sm font-medium mb-1">2. 載入擴充 · Load the extension</div>
            <div className="text-xs text-dark-300 mb-1">chrome://extensions → 開「開發人員模式」→「載入未封裝項目」→ 選這個資料夾：</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-dark-900 px-3 py-2 rounded-lg overflow-x-auto whitespace-nowrap">{extInfo?.extensionDir || '…/extension'}</code>
              <button onClick={() => copy(extInfo?.extensionDir || '', 'dir')} className="text-xs px-3 py-2 bg-dark-700 hover:bg-dark-600 rounded-lg shrink-0">{copied === 'dir' ? '已複製' : '複製路徑'}</button>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <button onClick={revealExtension} className="text-xs px-3 py-2 bg-dark-700 hover:bg-dark-600 rounded-lg shrink-0">
                📂 {extInfo?.platform === 'win32' ? '在檔案總管中顯示' : '在 Finder 中顯示'}
              </button>
              <span className="text-xs text-dark-400">開啟後把 <b>extension</b> 資料夾直接拖進 Chrome 視窗即可載入</span>
            </div>
            {extInfo?.platform !== 'win32' && (
              <div className="text-xs text-dark-400 mt-1">
                💡 或在選取視窗按 <code className="bg-dark-700 px-1 rounded">⌘⇧G</code>，貼上上面的路徑最快（避免手動找隱藏的 ~/Library）。
              </div>
            )}
            {extInfo?.extensionId && (
              <div className="text-xs text-dark-400 mt-1">載入後確認 Extension ID：<code className="bg-dark-700 px-1.5 py-0.5 rounded">{extInfo.extensionId}</code></div>
            )}
          </div>

          <div>
            <div className="text-sm font-medium mb-1">3. 使用 · Use it</div>
            <div className="text-xs text-dark-300">到課程／串流頁，點工具列的 MediaGrab 圖示 → <b>允許在此站擷取</b> → 播放影片幾秒 → <b>用 MediaGrab 下載</b>。下載會出現在「下載佇列」。</div>
          </div>
        </div>

        <div className="mt-4 text-xs text-dark-500 border-t border-dark-700 pt-3">
          ⚠️ 僅用於你<b>有觀看權限</b>的內容（個人備份）。目標站的服務條款可能禁止下載，帳號風險自負。
        </div>
      </div>
      )}

      <div className="bg-dark-800 rounded-xl p-6 border border-dark-600">
        <h2 className="text-lg font-semibold mb-4">相依套件狀態 · Dependencies Status</h2>
        <div className="space-y-3">
          {[
            { key: 'yt-dlp', name: 'yt-dlp', desc: '核心影片下載引擎 · Core video downloader', install: 'pip install yt-dlp' },
            { key: 'ffmpeg', name: 'FFmpeg', desc: '影片處理與合併 · Video processing & merging', install: 'brew install ffmpeg' },
            { key: 'aria2c', name: 'aria2', desc: '多線程下載器 · Multi-threaded downloader', install: 'brew install aria2' },
          ].map(dep => (
            <div key={dep.key} className="flex items-center justify-between p-3 bg-dark-700 rounded-lg">
              <div className="flex items-center gap-3">
                <span className={`w-3 h-3 rounded-full ${deps?.[dep.key] ? 'bg-green-500' : 'bg-red-500'}`} />
                <div>
                  <span className="font-medium">{dep.name}</span>
                  <span className="text-xs text-dark-400 ml-2">{dep.desc}</span>
                </div>
              </div>
              {deps?.[dep.key] ? (
                <span className="text-xs text-green-400">已安裝 Installed</span>
              ) : (
                <code className="text-xs bg-dark-600 px-2 py-1 rounded">{dep.install}</code>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Support development section — only renders if at least one link is configured */}
      {hasSupport && !settings.disableAds && (
        <div className="bg-dark-800 rounded-xl p-6 border border-dark-600">
          <h2 className="text-lg font-semibold mb-2">支持開發 · Support Development</h2>
          <p className="text-sm text-dark-300 mb-4">
            MediaGrab 永遠免費。以下連結幫助維持開發與伺服器成本，沒有任何強制。
            <br />
            <span className="text-dark-400">MediaGrab will always be free. These optional links help cover development &amp; server costs.</span>
          </p>

          <div className="space-y-3">
            {SUPPORT_LINKS.kofi && (
              <a
                href={withUtm(SUPPORT_LINKS.kofi, { utm_content: 'settings' })}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-3 bg-dark-700 hover:bg-dark-600 rounded-lg transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">☕</span>
                  <div>
                    <div className="text-sm font-medium">請開發者喝杯咖啡 · Buy me a coffee</div>
                    <div className="text-xs text-dark-300">Ko-fi 一次性小額抖內 · One-time small tip</div>
                  </div>
                </div>
                <span className="text-accent opacity-0 group-hover:opacity-100 transition-opacity">→</span>
              </a>
            )}

            {activeOffers.map(offer => (
              <a
                key={offer.name}
                href={withUtm(offer.url, { utm_content: 'settings' })}
                target="_blank"
                rel="noopener noreferrer sponsored"
                className="flex items-center justify-between p-3 bg-dark-700 hover:bg-dark-600 rounded-lg transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🛡️</span>
                  <div>
                    <div className="text-sm font-medium">{offer.headline}</div>
                    <div className="text-xs text-dark-300">{offer.name} — {offer.subtext}</div>
                  </div>
                </div>
                <span className="text-accent text-xs opacity-0 group-hover:opacity-100 transition-opacity">聯盟連結 →</span>
              </a>
            ))}

            {sponsoredLink && (
              <a
                href={sponsoredLink}
                target="_blank"
                rel="noopener noreferrer sponsored"
                className="flex items-center justify-between p-3 bg-dark-700 hover:bg-dark-600 rounded-lg transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🎁</span>
                  <div>
                    <div className="text-sm font-medium flex items-center gap-2">
                      看一則贊助廣告支持我們
                      <span className="px-1.5 py-0.5 bg-dark-600 text-dark-300 rounded text-[10px]">廣告 Sponsored</span>
                    </div>
                    <div className="text-xs text-dark-300">點一下幫助維持伺服器運作 · One click helps keep this free</div>
                  </div>
                </div>
                <span className="text-accent text-xs opacity-0 group-hover:opacity-100 transition-opacity">→</span>
              </a>
            )}

            <p className="text-xs text-dark-400 pt-2">
              💡 透過上方連結購買 VPN 時，MediaGrab 會收到聯盟分潤，但不影響你的價格。
              廣告連結會打開贊助商頁面。你可隨時在上方「關閉廣告」開關裡停用全部連結。
            </p>
          </div>
        </div>
      )}

      {/* Bottom ad slot — invisible without ad zone config */}
      <AdSlot name="settings-bottom" disableAds={settings.disableAds} />
    </div>
  );
}

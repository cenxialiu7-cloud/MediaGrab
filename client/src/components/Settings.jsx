import React, { useState, useEffect } from 'react';
import AdSlot from './AdSlot';
import { VPN_OFFERS, SUPPORT_LINKS, getActiveClickOffers, pickClickOffer, withUtm } from '../monetization';

export default function Settings({ deps, settings: parentSettings, onSettingsChange }) {
  const [settings, setSettings] = useState(parentSettings || null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

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
            <label className="block text-sm text-dark-200 mb-1">瀏覽器 Cookie（用於需登入的下載）· Browser Cookies</label>
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

      <div className="bg-dark-800 rounded-xl p-6 border border-dark-600">
        <h2 className="text-lg font-semibold mb-4">相依套件狀態 · Dependencies Status</h2>
        <div className="space-y-3">
          {[
            { key: 'yt-dlp', name: 'yt-dlp', desc: '核心影片下載引擎 · Core video downloader', install: 'pip install yt-dlp' },
            { key: 'ffmpeg', name: 'FFmpeg', desc: '影片處理與合併 · Video processing & merging', install: 'brew install ffmpeg' },
            { key: 'aria2c', name: 'aria2', desc: '多線程下載器 · Multi-threaded downloader', install: 'brew install aria2' },
            { key: 'streamlink', name: 'Streamlink', desc: '直播錄製器 · Live stream recorder', install: 'pip install streamlink' },
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

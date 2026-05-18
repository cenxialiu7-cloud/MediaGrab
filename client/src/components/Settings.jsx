import React, { useState, useEffect } from 'react';

export default function Settings({ deps }) {
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(setSettings)
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      await res.json();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {} finally {
      setSaving(false);
    }
  };

  if (!settings) return <div className="text-dark-300">載入設定中... · Loading settings...</div>;

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
    </div>
  );
}

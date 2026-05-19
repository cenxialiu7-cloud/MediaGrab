import React, { useState, useEffect } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import SmartInput from './components/SmartInput';
import UrlInput from './components/UrlInput';
import DownloadQueue from './components/DownloadQueue';
import SeriesSelector from './components/SeriesSelector';
import LiveRecorder from './components/LiveRecorder';
import Settings from './components/Settings';
import DepsCheck from './components/DepsCheck';
import SponsorBar from './components/SponsorBar';

const TABS = [
  { id: 'smart',    label: '智能 Smart',              icon: '✨' },
  { id: 'queue',    label: '下載佇列 Queue',          icon: '📥' },
  { id: 'download', label: '進階下載 Adv. Download',  icon: '🔧' },
  { id: 'series',   label: '進階劇集 Adv. Series',    icon: '📺' },
  { id: 'live',     label: '進階直播 Adv. Live',      icon: '🔴' },
  { id: 'settings', label: '設定 Settings',           icon: '⚙️' },
];

export default function App() {
  const { tasks, connected } = useWebSocket();
  const [activeTab, setActiveTab] = useState('smart');
  const [deps, setDeps] = useState(null);
  const [settings, setSettings] = useState({ disableAds: false });

  // Backwards-compat shim — old child components call onSwitchTab('download')
  // expecting the queue view; we now have 'queue' for that.
  const switchTab = (tabId) => {
    if (tabId === 'download') setActiveTab('queue');
    else setActiveTab(tabId);
  };

  useEffect(() => {
    fetch('/api/settings/dependencies')
      .then(r => r.json())
      .then(setDeps)
      .catch(() => {});

    // Load user settings (including disableAds preference)
    fetch('/api/settings')
      .then(r => r.json())
      .then(s => setSettings(prev => ({ ...prev, ...s })))
      .catch(() => {});
  }, []);

  const activeTasks = tasks.filter(t => t.status === 'downloading' || t.status === 'merging');
  const globalSpeed = activeTasks.reduce((sum, t) => {
    const match = (t.speed || '').match(/([\d.]+)\s*(MB|KB|GB|B)/i);
    if (!match) return sum;
    const val = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    if (unit === 'GB') return sum + val * 1024;
    if (unit === 'MB') return sum + val;
    if (unit === 'KB') return sum + val / 1024;
    return sum + val / 1048576;
  }, 0);

  return (
    <div className="min-h-screen bg-dark-900 text-white">
      <header className="bg-dark-800 border-b border-dark-600 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-3xl">📥</span>
            <div>
              <h1 className="text-xl font-bold">MediaGrab</h1>
              <p className="text-xs text-dark-200">通用影音下載器 · Universal Video Downloader</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-sm text-dark-200">
              {activeTasks.length > 0 && (
                <span className="text-accent">
                  ↓ {globalSpeed.toFixed(1)} MB/s
                </span>
              )}
              <span className="mx-2">|</span>
              <span>進行中 Active: {activeTasks.length}</span>
              <span className="mx-2">|</span>
              <span>等待中 Queue: {tasks.filter(t => t.status === 'queued').length}</span>
            </div>
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}
              title={connected ? '已連線 Connected' : '已斷線 Disconnected'} />
          </div>
        </div>
      </header>

      {/* VPN affiliate banner — auto-hides if no offer URL is configured or user dismissed */}
      <SponsorBar disableAds={settings.disableAds} />

      <nav className="bg-dark-800 border-b border-dark-700">
        <div className="max-w-6xl mx-auto flex">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-6 py-3 text-sm font-medium transition-colors border-b-2 ${
                activeTab === tab.id
                  ? 'border-accent text-accent'
                  : 'border-transparent text-dark-200 hover:text-white hover:border-dark-400'
              }`}
            >
              <span className="mr-2">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {deps && !deps['yt-dlp'] && activeTab !== 'settings' && <DepsCheck deps={deps} />}

      <main className="max-w-6xl mx-auto p-6">
        {activeTab === 'smart' && (
          <div className="space-y-6">
            <SmartInput onSwitchTab={switchTab} disableAds={settings.disableAds} />
            {/* Always show queue below smart input so user can see progress */}
            {tasks.length > 0 && <DownloadQueue tasks={tasks} />}
          </div>
        )}
        {activeTab === 'queue' && (
          <div className="space-y-6">
            <DownloadQueue tasks={tasks} disableAds={settings.disableAds} />
          </div>
        )}
        {activeTab === 'download' && (
          <div className="space-y-6">
            <UrlInput />
            <DownloadQueue tasks={tasks} disableAds={settings.disableAds} />
          </div>
        )}
        {activeTab === 'series' && <SeriesSelector onSwitchTab={switchTab} />}
        {activeTab === 'live' && <LiveRecorder onSwitchTab={switchTab} />}
        {activeTab === 'settings' && (
          <Settings deps={deps} settings={settings} onSettingsChange={setSettings} />
        )}
      </main>
    </div>
  );
}

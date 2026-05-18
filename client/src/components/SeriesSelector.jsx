import React, { useState } from 'react';

// Detect what kind of URL this is
function detectUrlType(url) {
  const u = url.trim().toLowerCase();
  if (/youtube\.com|youtu\.be/.test(u)) {
    if (/[?&]list=/.test(u) || /\/playlist\?/.test(u)) return 'youtube-playlist';
    if (/youtube\.com\/(@[\w.-]+|channel\/|c\/|user\/)/.test(u)) return 'youtube-channel';
    return 'youtube-video';
  }
  return 'streaming';
}

const SUPPORTED_SITES = [
  { name: 'Gimy 劇迷', domains: 'gimyai.tw / gimytv.ai / gimyplus.com', type: '影集 / 電影 串流站', note: '自動解析所有播放線路與集數' },
  { name: '小鴨影音', domains: '777tv.ai', type: '影集 / 電影 串流站', note: '自動解析所有播放線路與集數' },
  { name: 'YouTube 播放清單', domains: 'youtube.com/playlist?list=...', type: '影片清單', note: '貼上含 list= 參數的網址即可批次下載整個清單' },
  { name: 'YouTube 頻道', domains: 'youtube.com/@頻道名稱', type: '頻道影片', note: '貼上頻道網址即可列出該頻道所有影片' },
  { name: '通用 MacCMS 影視站', domains: '多數採用 MacCMS / stui / 模組化主題的站點', type: '影集 / 電影', note: '自動偵測 6 種常見頁面結構' },
];

export default function SeriesSelector({ onSwitchTab }) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);            // { title, kind, routes? , entries? }
  const [selectedRoute, setSelectedRoute] = useState(0);
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [queueing, setQueueing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showSites, setShowSites] = useState(false);

  const handleParse = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError('');
    setSuccess('');
    setData(null);
    setSelectedItems(new Set());

    const kind = detectUrlType(url);

    try {
      if (kind === 'youtube-playlist' || kind === 'youtube-channel') {
        // Fetch YouTube playlist/channel video list
        const res = await fetch('/api/parse/youtube-list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url.trim() }),
        });
        const result = await res.json();
        if (result.error) throw new Error(result.error);
        if (!result.entries || result.entries.length === 0) {
          throw new Error('找不到影片 · No videos found');
        }
        setData({
          title: result.title,
          kind: 'youtube',
          subKind: result.type, // 'playlist' or 'channel'
          entries: result.entries,
        });
      } else if (kind === 'youtube-video') {
        throw new Error('這是單一影片網址，請改用「下載」分頁。若要批次下載清單，請貼上含 list= 參數或頻道網址。\nSingle video — use the Download tab instead.');
      } else {
        // Streaming site
        const res = await fetch('/api/parse/streaming', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url.trim() }),
        });
        const result = await res.json();
        if (result.error) throw new Error(result.error);
        if (!result.routes || result.routes.length === 0) {
          throw new Error('此頁面找不到集數 · No episodes found on this page');
        }
        setData({
          title: result.title,
          kind: 'streaming',
          routes: result.routes,
        });
        setSelectedRoute(0);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Get the current list of items (episodes or YouTube videos)
  const getItems = () => {
    if (!data) return [];
    if (data.kind === 'streaming') return data.routes[selectedRoute]?.episodes || [];
    if (data.kind === 'youtube') return data.entries || [];
    return [];
  };

  const items = getItems();

  const toggleItem = (idx) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedItems.size === items.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(items.map((_, i) => i)));
    }
  };

  const handleQueueDownloads = async () => {
    const selected = Array.from(selectedItems).sort((a, b) => a - b).map(i => items[i]);
    if (selected.length === 0) return;

    setQueueing(true);
    setError('');
    try {
      let episodes;
      if (data.kind === 'youtube') {
        episodes = selected.map(v => ({
          title: v.title,
          url: v.url,                         // YouTube watch URL → yt-dlp handles it
          filename: undefined,                // yt-dlp will use %(title)s
        }));
      } else {
        episodes = selected.map(ep => ({
          title: ep.title,
          episodeUrl: ep.url,                 // streaming episode page → lazy m3u8 extract
          filename: `${data.title} - ${ep.title}.mp4`,
        }));
      }

      const res = await fetch('/api/download/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodes, seriesTitle: data.kind === 'youtube' ? undefined : data.title }),
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error);

      setSuccess(`已加入 ${result.count} 個項目到下載佇列，即將切換到「下載」分頁... · Queued ${result.count} items.`);
      setSelectedItems(new Set());
      setTimeout(() => {
        if (onSwitchTab) onSwitchTab('download');
        setSuccess('');
      }, 1200);
    } catch (err) {
      setError(err.message);
    } finally {
      setQueueing(false);
    }
  };

  const formatDuration = (secs) => {
    if (!secs) return '';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6">
      {/* Parser input */}
      <div className="bg-dark-800 rounded-xl p-6 border border-dark-600">
        <h2 className="text-lg font-semibold mb-1">劇集 / 清單解析 · Series & Playlist Parser</h2>
        <p className="text-sm text-dark-300 mb-4">
          貼上影視串流站影集網址（Gimy、小鴨等），或 YouTube 播放清單 / 頻道網址，即可批次選集下載。
          <br />
          <span className="text-dark-400">Paste a streaming-site series URL, or a YouTube playlist / channel URL, to batch-download.</span>
        </p>
        <div className="flex gap-3">
          <input
            type="text"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleParse()}
            placeholder="例如 https://gimyai.tw/detail/430098.html 或 https://www.youtube.com/@頻道名稱"
            className="flex-1 bg-dark-700 border border-dark-500 rounded-lg px-4 py-3 text-white placeholder-dark-300 focus:outline-none focus:border-accent transition-colors"
            disabled={loading}
          />
          <button
            onClick={handleParse}
            disabled={loading || !url.trim()}
            className="px-6 py-3 bg-accent hover:bg-accent-hover text-white rounded-lg font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                解析中 Parsing...
              </span>
            ) : '解析 Parse'}
          </button>
        </div>

        <button
          onClick={() => setShowSites(s => !s)}
          className="mt-3 text-xs text-accent hover:text-accent-hover transition-colors"
        >
          {showSites ? '▼' : '▶'} 目前支援的網站與網址格式 · Supported sites & URL formats
        </button>

        {showSites && (
          <div className="mt-3 bg-dark-700/50 rounded-lg p-4 border border-dark-600 animate-slide-in">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-dark-300 border-b border-dark-600">
                  <th className="text-left py-2 pr-3">網站 Site</th>
                  <th className="text-left py-2 pr-3">網址範例 URL Example</th>
                  <th className="text-left py-2 pr-3">類型 Type</th>
                  <th className="text-left py-2">說明 Note</th>
                </tr>
              </thead>
              <tbody className="text-dark-200">
                {SUPPORTED_SITES.map((s, i) => (
                  <tr key={i} className="border-b border-dark-600/40 last:border-0">
                    <td className="py-2 pr-3 font-medium whitespace-nowrap">{s.name}</td>
                    <td className="py-2 pr-3 text-dark-300 break-all">{s.domains}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{s.type}</td>
                    <td className="py-2 text-dark-400">{s.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-dark-400 mt-3 text-xs">
              YouTube 播放清單範例：<code className="bg-dark-600 px-1 rounded">https://www.youtube.com/watch?v=...&amp;list=PLxxxx</code>（含 list= 參數即可）<br />
              YouTube 頻道範例：<code className="bg-dark-600 px-1 rounded">https://www.youtube.com/@頻道名稱</code> 或 <code className="bg-dark-600 px-1 rounded">/channel/UCxxxx</code>
            </p>
          </div>
        )}

        {error && (
          <div className="mt-3 p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-sm whitespace-pre-line">
            {error}
          </div>
        )}
        {success && (
          <div className="mt-3 p-3 bg-green-900/30 border border-green-800 rounded-lg text-green-300 text-sm">
            {success}
          </div>
        )}
      </div>

      {/* Parsed result */}
      {data && (
        <div className="bg-dark-800 rounded-xl p-6 border border-dark-600 animate-slide-in">
          <div className="flex items-center gap-3 mb-4">
            <h3 className="text-lg font-semibold">{data.title}</h3>
            {data.kind === 'youtube' && (
              <span className="px-2 py-1 bg-red-900/30 text-red-300 text-xs rounded-full">
                YouTube {data.subKind === 'channel' ? '頻道 Channel' : '播放清單 Playlist'} · {data.entries.length} 部影片
              </span>
            )}
            {data.kind === 'streaming' && (
              <span className="px-2 py-1 bg-accent/20 text-accent text-xs rounded-full">
                串流影集 · {data.routes.length} 條線路
              </span>
            )}
          </div>

          {/* Route selector (streaming only) */}
          {data.kind === 'streaming' && data.routes.length > 1 && (
            <div className="mb-4">
              <p className="text-sm text-dark-300 mb-2">選擇播放線路 · Select Route / Source:</p>
              <div className="flex flex-wrap gap-2">
                {data.routes.map((route, idx) => (
                  <button
                    key={idx}
                    onClick={() => { setSelectedRoute(idx); setSelectedItems(new Set()); }}
                    className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                      selectedRoute === idx ? 'bg-accent text-white' : 'bg-dark-700 text-dark-200 hover:bg-dark-600'
                    }`}
                  >
                    {route.name}
                    <span className="ml-2 text-xs opacity-70">({route.episodes.length} 集)</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Item list */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-dark-300">
                選擇要下載的{data.kind === 'youtube' ? '影片' : '集數'} · Select items ({selectedItems.size} / {items.length}):
              </p>
              <button onClick={toggleAll} className="text-sm text-accent hover:text-accent-hover transition-colors">
                {selectedItems.size === items.length ? '取消全選 Deselect All' : '全選 Select All'}
              </button>
            </div>

            {data.kind === 'youtube' ? (
              // YouTube videos: list view (titles can be long)
              <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
                {items.map((v, idx) => (
                  <button
                    key={idx}
                    onClick={() => toggleItem(idx)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-3 ${
                      selectedItems.has(idx) ? 'bg-accent text-white' : 'bg-dark-700 text-dark-200 hover:bg-dark-600'
                    }`}
                  >
                    <span className="w-5 text-center text-xs opacity-60">{idx + 1}</span>
                    <span className="flex-1 truncate">{v.title}</span>
                    {v.duration > 0 && <span className="text-xs opacity-60">{formatDuration(v.duration)}</span>}
                  </button>
                ))}
              </div>
            ) : (
              // Streaming episodes: grid view (short titles like "第N集")
              <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 gap-2 max-h-64 overflow-y-auto p-1">
                {items.map((ep, idx) => (
                  <button
                    key={idx}
                    onClick={() => toggleItem(idx)}
                    className={`px-2 py-2 rounded-lg text-sm transition-colors text-center ${
                      selectedItems.has(idx) ? 'bg-accent text-white' : 'bg-dark-700 text-dark-200 hover:bg-dark-600'
                    }`}
                    title={ep.title}
                  >
                    {ep.title}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={handleQueueDownloads}
            disabled={selectedItems.size === 0 || queueing}
            className="w-full px-6 py-3 bg-accent hover:bg-accent-hover text-white rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {queueing ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                加入佇列中 Adding to queue...
              </span>
            ) : (
              <>加入下載佇列 · Queue Download — {selectedItems.size} {data.kind === 'youtube' ? '部影片' : '集'}</>
            )}
          </button>

          <p className="text-xs text-dark-400 mt-2 text-center">
            {data.kind === 'youtube'
              ? 'YouTube 影片將由 yt-dlp 下載最佳畫質 · Videos downloaded via yt-dlp at best quality.'
              : '串流網址會在輪到該集下載時才即時解析，因此不需要長時間等待 · Stream URLs are extracted just-in-time per episode.'}
          </p>
        </div>
      )}
    </div>
  );
}

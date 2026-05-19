import React, { useState } from 'react';

/**
 * SmartInput — Unified URL input that auto-classifies via /api/parse/probe
 * and renders the right action card based on what kind of content was found.
 *
 * Replaces the manual choice between 「下載」/「劇集解析」/「直播錄製」 tabs
 * for the common case. Advanced tabs are still available as fallback.
 *
 * Flow:
 *   1. User pastes URL → presses [解析 Parse] or Enter
 *   2. POST /api/parse/probe → ProbeResult { kind, isLive, entries, ... }
 *   3. Render one of:
 *      - VideoCard       (single video — format picker + download)
 *      - LiveCard        (currently live — record button)
 *      - UpcomingCard    (scheduled live — countdown info)
 *      - EpisodePicker   (playlist / channel / streaming aggregator — multi-select)
 *      - PastLiveCard    (was live, now VOD — download)
 *      - DirectStreamCard (raw .m3u8 — record/download)
 *      - UnknownCard     (couldn't classify — error + manual fallback hint)
 */
export default function SmartInput({ onSwitchTab }) {
  const [url, setUrl] = useState('');
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState(null);
  const [error, setError] = useState('');

  const handleProbe = async () => {
    if (!url.trim()) return;
    setProbing(true);
    setError('');
    setProbe(null);
    try {
      const res = await fetch('/api/parse/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (data.error && data.kind !== 'unknown') throw new Error(data.error);

      // For aggregator URLs (Gimy/777tv), also fetch series data so we can show episodes
      if (data.kind === 'aggregator') {
        try {
          const seriesRes = await fetch('/api/parse/streaming', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: url.trim() }),
          });
          const seriesData = await seriesRes.json();
          if (seriesData.routes) {
            data.aggregatorData = seriesData;
          }
        } catch {}
      }

      setProbe(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setProbing(false);
    }
  };

  const handleReset = () => {
    setUrl('');
    setProbe(null);
    setError('');
  };

  return (
    <div className="space-y-6">
      <div className="bg-dark-800 rounded-xl p-6 border border-dark-600">
        <h2 className="text-lg font-semibold mb-1">智能網址辨識 · Smart URL Detection</h2>
        <p className="text-sm text-dark-300 mb-4">
          貼上任何網址，自動判斷該下載、批次解析劇集，還是錄製直播。
          <br />
          <span className="text-dark-400">
            Paste any URL — we'll detect if it's a video, playlist, live stream, or streaming site and pick the right tool automatically.
          </span>
        </p>
        <div className="flex gap-3">
          <input
            type="text"
            value={url}
            onChange={e => { setUrl(e.target.value); if (probe) setProbe(null); }}
            onKeyDown={e => e.key === 'Enter' && handleProbe()}
            placeholder="YouTube、Twitch、Gimy、抖音... 任何網址都可以貼上"
            className="flex-1 bg-dark-700 border border-dark-500 rounded-lg px-4 py-3 text-white placeholder-dark-300 focus:outline-none focus:border-accent transition-colors"
            disabled={probing}
            autoFocus
          />
          <button
            onClick={handleProbe}
            disabled={probing || !url.trim()}
            className="px-6 py-3 bg-accent hover:bg-accent-hover text-white rounded-lg font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {probing ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                解析中 Probing...
              </span>
            ) : '解析 Parse'}
          </button>
          {(probe || error) && (
            <button
              onClick={handleReset}
              className="px-4 py-3 bg-dark-600 hover:bg-dark-500 text-white rounded-lg text-sm whitespace-nowrap"
            >
              清除 Clear
            </button>
          )}
        </div>

        {error && (
          <div className="mt-3 p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}
      </div>

      {probe && <ResultRouter probe={probe} url={url} onSwitchTab={onSwitchTab} onReset={handleReset} />}

      {!probe && !probing && (
        <div className="bg-dark-800/50 rounded-xl p-6 border border-dark-700 text-sm text-dark-300">
          <h3 className="font-medium text-dark-200 mb-3">💡 支援的內容類型 · Supported content types</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            <div>📹 <strong>單一影片</strong>：YouTube、FB、IG、抖音/TikTok、Twitter、Bilibili 等</div>
            <div>📃 <strong>YouTube 播放清單</strong>：含 <code className="bg-dark-700 px-1 rounded">list=</code> 參數的網址</div>
            <div>📺 <strong>YouTube 頻道</strong>：<code className="bg-dark-700 px-1 rounded">youtube.com/@頻道</code></div>
            <div>🎬 <strong>串流影集站</strong>：Gimy（gimyai.tw、gimytv.ai、gimyplus.com）、小鴨 777tv</div>
            <div>🔴 <strong>直播</strong>：Twitch、YouTube Live、Facebook Live、TikTok Live</div>
            <div>⏰ <strong>預定直播</strong>：未開始的 YouTube/Twitch 排程直播</div>
            <div>🎥 <strong>HLS 直連</strong>：以 .m3u8 結尾的直接串流網址</div>
            <div>📼 <strong>直播重播 (VOD)</strong>：已結束的直播自動辨識為一般影片下載</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// ResultRouter — picks the right card based on probe.kind
// ───────────────────────────────────────────────────────────────────────────
function ResultRouter({ probe, url, onSwitchTab, onReset }) {
  switch (probe.kind) {
    case 'live':
      return <LiveCard probe={probe} url={url} onReset={onReset} onSwitchTab={onSwitchTab} />;
    case 'upcoming':
      return <UpcomingCard probe={probe} />;
    case 'playlist':
    case 'channel':
      return <EpisodePicker probe={probe} url={url} mode="youtube" onReset={onReset} onSwitchTab={onSwitchTab} />;
    case 'aggregator':
      return <EpisodePicker probe={probe} url={url} mode="aggregator" onReset={onReset} onSwitchTab={onSwitchTab} />;
    case 'past_live':
      return <VideoCard probe={probe} url={url} onReset={onReset} onSwitchTab={onSwitchTab} pastLive />;
    case 'direct_stream':
    case 'direct_media':
      return <DirectStreamCard probe={probe} url={url} onReset={onReset} onSwitchTab={onSwitchTab} />;
    case 'video':
      return <VideoCard probe={probe} url={url} onReset={onReset} onSwitchTab={onSwitchTab} />;
    case 'unknown':
    default:
      return <UnknownCard probe={probe} onSwitchTab={onSwitchTab} />;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Shared header with classification badge
// ───────────────────────────────────────────────────────────────────────────
function ResultHeader({ probe, kindLabel, kindColor }) {
  return (
    <div className="flex flex-wrap items-start gap-3 mb-4">
      <span className={`px-2 py-1 rounded-full text-xs ${kindColor}`}>{kindLabel}</span>
      {probe.extractor && (
        <span className="px-2 py-1 bg-dark-700 text-dark-200 rounded-full text-xs">{probe.extractor}</span>
      )}
      <div className="basis-full">
        <h3 className="font-semibold">{probe.title || '(無標題)'}</h3>
        {probe.uploader && <p className="text-xs text-dark-300 mt-0.5">{probe.uploader}</p>}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// VideoCard — single video (or past live) download with format options
// ───────────────────────────────────────────────────────────────────────────
function VideoCard({ probe, url, onReset, onSwitchTab, pastLive = false }) {
  const [info, setInfo] = useState(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  React.useEffect(() => {
    let cancelled = false;
    setLoadingInfo(true);
    fetch('/api/download/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }).then(r => r.json()).then(data => {
      if (!cancelled && !data.error) setInfo(data);
    }).catch(() => {}).finally(() => { if (!cancelled) setLoadingInfo(false); });
    return () => { cancelled = true; };
  }, [url]);

  const startDownload = async (format = null) => {
    setDownloading(true);
    setError('');
    try {
      const res = await fetch('/api/download/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, format }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      onReset();
      if (onSwitchTab) onSwitchTab('download');
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="bg-dark-800 rounded-xl p-6 border border-dark-600 animate-slide-in">
      <ResultHeader
        probe={probe}
        kindLabel={pastLive ? '📼 已結束直播 (VOD)' : '📹 單一影片 Video'}
        kindColor={pastLive ? 'bg-purple-600/20 text-purple-300' : 'bg-blue-600/20 text-blue-300'}
      />

      {probe.thumbnail && (
        <img src={probe.thumbnail} alt="" className="w-48 h-auto rounded-lg mb-4 border border-dark-600" />
      )}

      {pastLive && (
        <div className="mb-3 p-2 bg-purple-900/20 border border-purple-800/50 rounded text-xs text-purple-200">
          此網址原為直播，現在已結束。將以一般影片方式下載重播。
        </div>
      )}

      {loadingInfo && <p className="text-sm text-dark-300 mb-3">載入畫質列表中... · Loading format list...</p>}

      {info && info.formats && info.formats.length > 0 && (
        <div className="mb-3">
          <p className="text-sm text-dark-200 mb-2">選擇畫質 · Select format:</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-48 overflow-y-auto">
            {info.formats
              .filter(f => f.resolution && f.resolution !== '?x?')
              .slice(0, 12)
              .map(f => (
                <button
                  key={f.id}
                  onClick={() => startDownload(f.id)}
                  disabled={downloading}
                  className="text-left p-2 bg-dark-700 hover:bg-dark-600 rounded-lg text-sm transition-colors disabled:opacity-50"
                >
                  <div className="font-medium">{f.resolution}</div>
                  <div className="text-xs text-dark-300">
                    {f.ext} {f.filesize ? `(${(f.filesize / 1048576).toFixed(0)}MB)` : ''}
                  </div>
                </button>
              ))}
          </div>
        </div>
      )}

      <button
        onClick={() => startDownload(null)}
        disabled={downloading}
        className="w-full px-6 py-3 bg-accent hover:bg-accent-hover text-white rounded-lg font-medium transition-colors disabled:opacity-50"
      >
        {downloading ? '加入下載中... Adding...' : '下載最佳畫質 · Download Best Quality'}
      </button>

      {error && (
        <div className="mt-3 p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// LiveCard — currently broadcasting live stream, record button
// ───────────────────────────────────────────────────────────────────────────
function LiveCard({ probe, url, onReset, onSwitchTab }) {
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState('');
  const [error, setError] = useState('');

  const startRecording = async () => {
    setRecording(true);
    setError('');
    try {
      const res = await fetch('/api/live/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          duration: duration ? parseInt(duration) * 60 : undefined,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      onReset();
      if (onSwitchTab) onSwitchTab('download');
    } catch (err) {
      setError(err.message);
    } finally {
      setRecording(false);
    }
  };

  return (
    <div className="bg-dark-800 rounded-xl p-6 border border-red-700/40 animate-slide-in">
      <ResultHeader
        probe={probe}
        kindLabel="🔴 直播中 LIVE"
        kindColor="bg-red-600/20 text-red-300"
      />

      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        <span className="px-2 py-1 bg-dark-700 rounded">使用工具: <strong className="text-accent">{probe.recorder}</strong></span>
        {probe.recorder === 'streamlink' && (
          <span className="px-2 py-1 bg-green-900/30 text-green-300 rounded">Twitch 廣告自動過濾</span>
        )}
        <span className="px-2 py-1 bg-green-900/30 text-green-300 rounded">Crash-safe .ts 錄製</span>
        <span className="px-2 py-1 bg-green-900/30 text-green-300 rounded">自動轉 .mp4</span>
      </div>

      {probe.thumbnail && (
        <img src={probe.thumbnail} alt="" className="w-48 h-auto rounded-lg mb-4 border border-dark-600" />
      )}

      <div className="mb-3">
        <label className="block text-sm text-dark-200 mb-1">
          錄製時長（分鐘，0 = 直到手動停止）· Duration (min, 0 = until stopped)
        </label>
        <input
          type="number"
          value={duration}
          onChange={e => setDuration(e.target.value)}
          placeholder="0"
          min="0"
          className="w-full bg-dark-700 border border-dark-500 rounded-lg px-4 py-2 text-white placeholder-dark-300 focus:outline-none focus:border-accent transition-colors"
        />
      </div>

      <button
        onClick={startRecording}
        disabled={recording}
        className="w-full px-6 py-3 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
      >
        {recording ? '啟動中 Starting...' : (
          <span className="flex items-center justify-center gap-2">
            <span className="w-3 h-3 bg-white rounded-full animate-pulse" />
            開始錄製 · Start Recording
          </span>
        )}
      </button>

      {error && (
        <div className="mt-3 p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// UpcomingCard — scheduled live, not yet started
// ───────────────────────────────────────────────────────────────────────────
function UpcomingCard({ probe }) {
  const scheduled = probe.scheduledAt
    ? new Date(probe.scheduledAt * 1000).toLocaleString('zh-TW', { dateStyle: 'full', timeStyle: 'short' })
    : null;

  return (
    <div className="bg-dark-800 rounded-xl p-6 border border-yellow-700/40 animate-slide-in">
      <ResultHeader
        probe={probe}
        kindLabel="⏰ 預定直播 UPCOMING"
        kindColor="bg-yellow-600/20 text-yellow-300"
      />

      {probe.thumbnail && (
        <img src={probe.thumbnail} alt="" className="w-48 h-auto rounded-lg mb-4 border border-dark-600" />
      )}

      <div className="p-4 bg-yellow-900/20 border border-yellow-800/50 rounded-lg text-sm">
        <p className="text-yellow-200 font-medium mb-1">這場直播尚未開始</p>
        {scheduled && (
          <p className="text-dark-200">
            預計開始時間：<strong className="text-yellow-300">{scheduled}</strong>
          </p>
        )}
        <p className="text-xs text-dark-400 mt-2">
          請等直播開始後再回來點「解析」即可錄製。
        </p>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// EpisodePicker — playlist / channel / streaming aggregator multi-select
// ───────────────────────────────────────────────────────────────────────────
function EpisodePicker({ probe, url, mode, onReset, onSwitchTab }) {
  const [items, setItems] = useState([]);          // for youtube mode
  const [routes, setRoutes] = useState([]);        // for aggregator mode
  const [selectedRoute, setSelectedRoute] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [error, setError] = useState('');

  // Initial data loading
  React.useEffect(() => {
    if (mode === 'youtube' && probe.entries) {
      setItems(probe.entries);
    } else if (mode === 'aggregator') {
      if (probe.aggregatorData && probe.aggregatorData.routes) {
        setRoutes(probe.aggregatorData.routes);
      } else {
        // Fetch streaming site data if not already pre-fetched
        setLoading(true);
        fetch('/api/parse/streaming', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        }).then(r => r.json()).then(data => {
          if (data.routes) setRoutes(data.routes);
          else if (data.error) setError(data.error);
        }).catch(e => setError(e.message)).finally(() => setLoading(false));
      }
    }
  }, [mode, url]);

  const currentList = mode === 'aggregator' ? (routes[selectedRoute]?.episodes || []) : items;

  const toggleItem = (idx) => {
    setSelectedIdx(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIdx.size === currentList.length) setSelectedIdx(new Set());
    else setSelectedIdx(new Set(currentList.map((_, i) => i)));
  };

  const handleQueue = async () => {
    const selected = Array.from(selectedIdx).sort((a, b) => a - b).map(i => currentList[i]);
    if (selected.length === 0) return;

    setQueueing(true);
    setError('');
    try {
      const seriesTitle = mode === 'aggregator' ? probe.aggregatorData?.title : null;
      const episodes = mode === 'youtube'
        ? selected.map(v => ({ title: v.title, url: v.url }))   // yt-dlp will handle
        : selected.map(ep => ({                                  // aggregator → lazy m3u8 extract
            title: ep.title,
            episodeUrl: ep.url,
            filename: `${seriesTitle} - ${ep.title}.mp4`,
          }));

      const res = await fetch('/api/download/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodes, seriesTitle }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      onReset();
      if (onSwitchTab) onSwitchTab('download');
    } catch (err) {
      setError(err.message);
    } finally {
      setQueueing(false);
    }
  };

  const formatDur = (s) => {
    if (!s) return '';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60), h = Math.floor(m / 60);
    if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  const kindLabel = mode === 'youtube'
    ? (probe.kind === 'channel' ? '📺 YouTube 頻道' : '📃 YouTube 播放清單')
    : '🎬 串流影集站';
  const kindColor = mode === 'youtube' ? 'bg-red-600/20 text-red-300' : 'bg-orange-600/20 text-orange-300';

  return (
    <div className="bg-dark-800 rounded-xl p-6 border border-dark-600 animate-slide-in">
      <div className="flex flex-wrap items-start gap-3 mb-4">
        <span className={`px-2 py-1 rounded-full text-xs ${kindColor}`}>{kindLabel}</span>
        <div className="basis-full">
          <h3 className="font-semibold">
            {mode === 'aggregator' ? (probe.aggregatorData?.title || probe.title) : probe.title}
          </h3>
        </div>
      </div>

      {loading && <p className="text-sm text-dark-300">載入集數中... · Loading episodes...</p>}

      {mode === 'aggregator' && routes.length > 1 && (
        <div className="mb-4">
          <p className="text-sm text-dark-300 mb-2">選擇播放線路 · Select Route / Source:</p>
          <div className="flex flex-wrap gap-2">
            {routes.map((route, idx) => (
              <button
                key={idx}
                onClick={() => { setSelectedRoute(idx); setSelectedIdx(new Set()); }}
                className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                  selectedRoute === idx ? 'bg-accent text-white' : 'bg-dark-700 text-dark-200 hover:bg-dark-600'
                }`}
              >
                {route.name}<span className="ml-2 text-xs opacity-70">({route.episodes.length} 集)</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {currentList.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-dark-300">
              選擇{mode === 'youtube' ? '影片' : '集數'} · Select items ({selectedIdx.size} / {currentList.length}):
            </p>
            <button onClick={toggleAll} className="text-sm text-accent hover:text-accent-hover transition-colors">
              {selectedIdx.size === currentList.length ? '取消全選' : '全選 Select All'}
            </button>
          </div>

          {mode === 'youtube' ? (
            <div className="space-y-1 max-h-80 overflow-y-auto pr-1 mb-4">
              {currentList.map((v, idx) => (
                <button
                  key={idx}
                  onClick={() => toggleItem(idx)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-3 ${
                    selectedIdx.has(idx) ? 'bg-accent text-white' : 'bg-dark-700 text-dark-200 hover:bg-dark-600'
                  }`}
                >
                  <span className="w-5 text-center text-xs opacity-60">{idx + 1}</span>
                  <span className="flex-1 truncate">{v.title}</span>
                  {v.duration > 0 && <span className="text-xs opacity-60">{formatDur(v.duration)}</span>}
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 gap-2 max-h-64 overflow-y-auto p-1 mb-4">
              {currentList.map((ep, idx) => (
                <button
                  key={idx}
                  onClick={() => toggleItem(idx)}
                  title={ep.title}
                  className={`px-2 py-2 rounded-lg text-sm transition-colors text-center ${
                    selectedIdx.has(idx) ? 'bg-accent text-white' : 'bg-dark-700 text-dark-200 hover:bg-dark-600'
                  }`}
                >
                  {ep.title}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={handleQueue}
            disabled={selectedIdx.size === 0 || queueing}
            className="w-full px-6 py-3 bg-accent hover:bg-accent-hover text-white rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {queueing
              ? '加入佇列中 Adding...'
              : `加入下載佇列 · Queue Download — ${selectedIdx.size} ${mode === 'youtube' ? '部影片' : '集'}`}
          </button>
          <p className="text-xs text-dark-400 mt-2 text-center">
            {mode === 'youtube'
              ? 'YouTube 影片由 yt-dlp 下載最佳畫質'
              : '串流網址會在輪到該集下載時才即時解析，不會卡住'}
          </p>
        </>
      )}

      {error && (
        <div className="mt-3 p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// DirectStreamCard — raw .m3u8 / .mp4 / etc.
// ───────────────────────────────────────────────────────────────────────────
function DirectStreamCard({ probe, url, onReset, onSwitchTab }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const isStream = probe.kind === 'direct_stream';

  const action = async () => {
    setWorking(true);
    setError('');
    try {
      const endpoint = isStream ? '/api/live/record' : '/api/download/m3u8';
      const body = isStream ? { url } : { m3u8Url: url, title: probe.title };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      onReset();
      if (onSwitchTab) onSwitchTab('download');
    } catch (err) {
      setError(err.message);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="bg-dark-800 rounded-xl p-6 border border-dark-600 animate-slide-in">
      <ResultHeader
        probe={probe}
        kindLabel={isStream ? '🎥 HLS 串流' : '🎥 直接媒體連結'}
        kindColor="bg-cyan-600/20 text-cyan-300"
      />
      <p className="text-sm text-dark-300 mb-4">
        {isStream
          ? '這是 HLS 直接串流網址，會使用 FFmpeg 直接錄製/下載。'
          : '這是直接的媒體檔案連結，會用 FFmpeg 直接下載。'}
      </p>
      <button
        onClick={action}
        disabled={working}
        className="w-full px-6 py-3 bg-accent hover:bg-accent-hover text-white rounded-lg font-medium transition-colors disabled:opacity-50"
      >
        {working ? '處理中 Working...' : (isStream ? '開始錄製 · Start Recording' : '開始下載 · Start Download')}
      </button>
      {error && (
        <div className="mt-3 p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-sm">{error}</div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// UnknownCard — couldn't classify
// ───────────────────────────────────────────────────────────────────────────
function UnknownCard({ probe, onSwitchTab }) {
  return (
    <div className="bg-dark-800 rounded-xl p-6 border border-dark-600 animate-slide-in">
      <ResultHeader
        probe={probe}
        kindLabel="❓ 無法辨識"
        kindColor="bg-gray-600/20 text-gray-300"
      />
      <p className="text-sm text-dark-300 mb-2">
        無法自動判斷這個網址的內容類型。
      </p>
      {probe.error && (
        <p className="text-xs text-red-300 mb-3 bg-red-900/20 p-2 rounded">{probe.error}</p>
      )}
      <p className="text-sm text-dark-200 mb-3">可以嘗試以下進階分頁手動處理：</p>
      <div className="flex flex-wrap gap-2">
        {onSwitchTab && (
          <>
            <button onClick={() => onSwitchTab('download')}
              className="px-4 py-2 bg-dark-700 hover:bg-dark-600 rounded-lg text-sm">
              📥 進階下載
            </button>
            <button onClick={() => onSwitchTab('series')}
              className="px-4 py-2 bg-dark-700 hover:bg-dark-600 rounded-lg text-sm">
              📺 進階劇集解析
            </button>
            <button onClick={() => onSwitchTab('live')}
              className="px-4 py-2 bg-dark-700 hover:bg-dark-600 rounded-lg text-sm">
              🔴 進階直播錄製
            </button>
          </>
        )}
      </div>
    </div>
  );
}

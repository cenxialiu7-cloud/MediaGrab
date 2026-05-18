import React, { useState } from 'react';

export default function LiveRecorder({ onSwitchTab }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState('');
  const [loading, setLoading] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Pre-flight URL check — classify the URL before showing the record button
  const handleProbe = async () => {
    if (!url.trim()) return;
    setProbing(true);
    setError('');
    setSuccess('');
    setProbe(null);
    try {
      const res = await fetch('/api/parse/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setProbe(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setProbing(false);
    }
  };

  const handleRecord = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/live/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url.trim(),
          title: title.trim() || undefined,
          duration: duration ? parseInt(duration) * 60 : undefined,
        }),
      });
      const data = await res.json();
      if (data.error) {
        // If server suggests a different tab, offer to switch
        if (data.suggestion && data.suggestion.includes('下載')) {
          throw new Error(`${data.error}\n建議：${data.suggestion}`);
        }
        if (data.suggestion && data.suggestion.includes('劇集')) {
          throw new Error(`${data.error}\n建議：${data.suggestion}`);
        }
        throw new Error(data.error + (data.suggestion ? `\n${data.suggestion}` : ''));
      }
      setSuccess(`已開始錄製（${data.method}）— ${data.title}。請到「下載」分頁查看進度與停止。\nRecording started.`);
      setUrl('');
      setTitle('');
      setDuration('');
      setProbe(null);
      if (onSwitchTab) {
        setTimeout(() => { onSwitchTab('download'); setSuccess(''); }, 1500);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Format probe result for display
  const renderProbeResult = () => {
    if (!probe) return null;

    const STATUS_BADGES = {
      live:        { color: 'bg-red-600/20 text-red-300',     label: '🔴 直播中 LIVE' },
      upcoming:    { color: 'bg-yellow-600/20 text-yellow-300', label: '⏰ 預定直播 UPCOMING' },
      video:       { color: 'bg-blue-600/20 text-blue-300',   label: '📹 一般影片 VOD' },
      past_live:   { color: 'bg-purple-600/20 text-purple-300', label: '📼 已結束直播 (VOD)' },
      playlist:    { color: 'bg-green-600/20 text-green-300', label: '📃 播放清單' },
      channel:     { color: 'bg-green-600/20 text-green-300', label: '📺 YouTube 頻道' },
      aggregator:  { color: 'bg-orange-600/20 text-orange-300', label: '🎬 串流影集站' },
      direct_stream:{ color: 'bg-cyan-600/20 text-cyan-300',  label: '🎥 HLS 直播串流' },
      direct_media:{ color: 'bg-cyan-600/20 text-cyan-300',   label: '🎥 直接媒體連結' },
      unknown:     { color: 'bg-gray-600/20 text-gray-300',   label: '❓ 未知' },
    };
    const badge = STATUS_BADGES[probe.kind] || STATUS_BADGES.unknown;
    const canRecord = probe.recommendedAction === 'record';

    return (
      <div className="mt-3 p-4 bg-dark-700/50 border border-dark-600 rounded-lg animate-slide-in">
        <div className="flex items-start gap-3 mb-2">
          <span className={`px-2 py-1 rounded-full text-xs ${badge.color}`}>{badge.label}</span>
          {probe.extractor && (
            <span className="px-2 py-1 bg-dark-600 text-dark-200 rounded-full text-xs">
              {probe.extractor}
            </span>
          )}
          {probe.recorder && canRecord && (
            <span className="px-2 py-1 bg-accent/20 text-accent rounded-full text-xs">
              工具：{probe.recorder}
            </span>
          )}
        </div>

        {probe.title && <div className="text-sm font-medium mb-1">{probe.title}</div>}
        {probe.uploader && <div className="text-xs text-dark-300">頻道：{probe.uploader}</div>}
        {probe.scheduledAt && (
          <div className="text-xs text-yellow-300 mt-1">
            預定開始時間：{new Date(probe.scheduledAt * 1000).toLocaleString('zh-TW')}
          </div>
        )}
        {probe.hint && <div className="text-xs text-dark-300 mt-1">提示：{probe.hint}</div>}

        {/* Action hints based on kind */}
        {probe.kind === 'video' || probe.kind === 'past_live' ? (
          <div className="mt-3 p-2 bg-blue-900/20 border border-blue-800/50 rounded text-xs text-blue-200">
            這是 VOD 影片，不是直播。建議切到「下載」分頁。
            {onSwitchTab && (
              <button onClick={() => onSwitchTab('download')}
                className="ml-2 px-2 py-0.5 bg-blue-600 hover:bg-blue-500 rounded text-white">
                前往下載分頁
              </button>
            )}
          </div>
        ) : null}
        {(probe.kind === 'playlist' || probe.kind === 'channel' || probe.kind === 'aggregator') && (
          <div className="mt-3 p-2 bg-orange-900/20 border border-orange-800/50 rounded text-xs text-orange-200">
            這是清單/影集網址。建議切到「劇集 / 清單解析」分頁。
            {onSwitchTab && (
              <button onClick={() => onSwitchTab('series')}
                className="ml-2 px-2 py-0.5 bg-orange-600 hover:bg-orange-500 rounded text-white">
                前往劇集解析
              </button>
            )}
          </div>
        )}
        {probe.kind === 'upcoming' && (
          <div className="mt-3 p-2 bg-yellow-900/20 border border-yellow-800/50 rounded text-xs text-yellow-200">
            這場直播尚未開始，請等開始後再回來錄製。
          </div>
        )}
      </div>
    );
  };

  const canRecord = !probe || probe.kind === 'live' || probe.kind === 'direct_stream' || probe.kind === 'direct_media';

  return (
    <div className="space-y-6">
      <div className="bg-dark-800 rounded-xl p-6 border border-dark-600">
        <h2 className="text-lg font-semibold mb-2">直播錄製 · Live Stream Recorder</h2>
        <p className="text-sm text-dark-300 mb-6">
          錄製 Twitch、YouTube Live 或任何 HLS / RTMP 直播串流。
          <br />
          <span className="text-dark-400">貼上網址後可先按「檢查狀態」確認是直播中再開始錄製。Records to .ts (crash-safe) and auto-converts to .mp4 when stopped.</span>
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-dark-200 mb-1">直播網址 · Stream URL</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={url}
                onChange={e => { setUrl(e.target.value); setProbe(null); }}
                onKeyDown={e => e.key === 'Enter' && handleProbe()}
                placeholder="https://twitch.tv/頻道 或 https://youtube.com/watch?v=..."
                className="flex-1 bg-dark-700 border border-dark-500 rounded-lg px-4 py-3 text-white placeholder-dark-300 focus:outline-none focus:border-accent transition-colors"
              />
              <button
                onClick={handleProbe}
                disabled={probing || !url.trim()}
                className="px-4 py-3 bg-dark-600 hover:bg-dark-500 text-white rounded-lg transition-colors disabled:opacity-50 text-sm whitespace-nowrap"
              >
                {probing ? '檢查中...' : '檢查狀態 Check'}
              </button>
            </div>
          </div>

          {renderProbeResult()}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-dark-200 mb-1">名稱（選填）· Title (optional)</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="錄影檔名"
                className="w-full bg-dark-700 border border-dark-500 rounded-lg px-4 py-3 text-white placeholder-dark-300 focus:outline-none focus:border-accent transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm text-dark-200 mb-1">時長（分鐘，0 = 直到手動停止）</label>
              <input
                type="number"
                value={duration}
                onChange={e => setDuration(e.target.value)}
                placeholder="0"
                min="0"
                className="w-full bg-dark-700 border border-dark-500 rounded-lg px-4 py-3 text-white placeholder-dark-300 focus:outline-none focus:border-accent transition-colors"
              />
            </div>
          </div>

          <button
            onClick={handleRecord}
            disabled={loading || !url.trim() || !canRecord}
            className="w-full px-6 py-3 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                啟動中 Starting...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <span className="w-3 h-3 bg-white rounded-full animate-pulse" />
                {probe && probe.kind === 'live' ? `開始錄製 · 錄製${probe.recorder || ''}直播` : '開始錄製 · Start Recording'}
              </span>
            )}
          </button>

          {error && (
            <div className="p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-sm whitespace-pre-line">
              {error}
            </div>
          )}
          {success && (
            <div className="p-3 bg-green-900/30 border border-green-800 rounded-lg text-green-300 text-sm whitespace-pre-line">
              {success}
            </div>
          )}
        </div>
      </div>

      <div className="bg-dark-800 rounded-xl p-6 border border-dark-600">
        <h3 className="font-semibold mb-3">支援的直播平台 · Supported Platforms</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { name: 'Twitch 直播',  method: 'Streamlink (自動過濾廣告)', status: 'green' },
            { name: 'YouTube Live', method: 'yt-dlp --live-from-start', status: 'green' },
            { name: 'Facebook Live', method: 'yt-dlp',  status: 'green' },
            { name: 'TikTok Live',  method: 'yt-dlp',  status: 'yellow' },
            { name: 'HLS / RTMP 串流', method: 'FFmpeg 直連',  status: 'green' },
            { name: 'Instagram Live', method: '需登入 Cookie', status: 'yellow' },
          ].map(p => (
            <div key={p.name} className="flex items-center gap-2 p-2 bg-dark-700 rounded-lg text-sm">
              <span className={`w-2 h-2 rounded-full ${p.status === 'green' ? 'bg-green-500' : 'bg-yellow-500'}`} />
              <span>{p.name}</span>
              <span className="text-xs text-dark-400 ml-auto">{p.method}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-dark-400 mt-3">
          💡 錄製過程中檔案以 <code className="bg-dark-700 px-1 rounded">.ts</code> 格式即時寫入（每段獨立可播放），停止時會自動轉換為 .mp4。
          <br />
          按下「停止錄製」會以優雅方式（SIGINT）收尾，確保檔案完整可播放。
        </p>
      </div>
    </div>
  );
}

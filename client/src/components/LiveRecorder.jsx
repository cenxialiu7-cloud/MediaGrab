import React, { useState } from 'react';

export default function LiveRecorder() {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

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
      if (data.error) throw new Error(data.error);
      setSuccess(`已開始錄製（${data.method}）。請到「下載」分頁查看進度。 · Recording started.`);
      setUrl('');
      setTitle('');
      setDuration('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-dark-800 rounded-xl p-6 border border-dark-600">
        <h2 className="text-lg font-semibold mb-2">直播錄製 · Live Stream Recorder</h2>
        <p className="text-sm text-dark-300 mb-6">
          錄製 Twitch、YouTube Live 或任何 HLS / RTMP 直播串流。WebRTC 直播（如 Zoom 網頁版）會嘗試以瀏覽器頁面錄製方式處理。
          <br />
          <span className="text-dark-400">Record live streams from Twitch, YouTube Live, or any HLS/RTMP stream.</span>
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-dark-200 mb-1">直播網址 · Stream URL</label>
            <input
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://twitch.tv/頻道 或 HLS 串流網址"
              className="w-full bg-dark-700 border border-dark-500 rounded-lg px-4 py-3 text-white placeholder-dark-300 focus:outline-none focus:border-accent transition-colors"
            />
          </div>

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
              <label className="block text-sm text-dark-200 mb-1">時長（分鐘，0 = 直到手動停止）· Duration (min, 0 = until stopped)</label>
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
            disabled={loading || !url.trim()}
            className="w-full px-6 py-3 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                啟動中 Starting...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <span className="w-3 h-3 bg-white rounded-full" />
                開始錄製 · Start Recording
              </span>
            )}
          </button>

          {error && (
            <div className="p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-sm">
              {error}
            </div>
          )}
          {success && (
            <div className="p-3 bg-green-900/30 border border-green-800 rounded-lg text-green-300 text-sm">
              {success}
            </div>
          )}
        </div>
      </div>

      <div className="bg-dark-800 rounded-xl p-6 border border-dark-600">
        <h3 className="font-semibold mb-3">支援的直播平台 · Supported Platforms</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { name: 'Twitch', method: 'Streamlink', status: 'green' },
            { name: 'YouTube Live 直播', method: 'Streamlink / yt-dlp', status: 'green' },
            { name: 'Facebook Live 直播', method: 'yt-dlp', status: 'green' },
            { name: 'HLS 串流', method: 'FFmpeg', status: 'green' },
            { name: 'RTMP 串流', method: 'FFmpeg', status: 'green' },
            { name: 'Zoom 網頁版 (WebRTC)', method: '頁面錄製', status: 'yellow' },
          ].map(p => (
            <div key={p.name} className="flex items-center gap-2 p-2 bg-dark-700 rounded-lg text-sm">
              <span className={`w-2 h-2 rounded-full ${p.status === 'green' ? 'bg-green-500' : 'bg-yellow-500'}`} />
              <span>{p.name}</span>
              <span className="text-xs text-dark-400 ml-auto">{p.method}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

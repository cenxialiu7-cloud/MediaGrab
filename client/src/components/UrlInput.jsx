import React, { useState } from 'react';

export default function UrlInput() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');

  const handleDetect = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError('');
    setInfo(null);
    try {
      const res = await fetch('/api/parse/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();

      if (data.method === 'streaming') {
        setInfo({ ...data, isStreaming: true });
      } else {
        try {
          const infoRes = await fetch('/api/download/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: url.trim() }),
          });
          const videoInfo = await infoRes.json();
          setInfo({ ...data, ...videoInfo, isStreaming: false });
        } catch {
          setInfo({ ...data, isStreaming: false });
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (format) => {
    setLoading(true);
    try {
      const res = await fetch('/api/download/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), format }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setUrl('');
      setInfo(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickDownload = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/download/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setUrl('');
      setInfo(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-dark-800 rounded-xl p-6 border border-dark-600">
      <div className="flex gap-3">
        <input
          type="text"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleQuickDownload()}
          placeholder="貼上影片網址... (YouTube、Facebook、Instagram、抖音/TikTok 等) · Paste video URL here..."
          className="flex-1 bg-dark-700 border border-dark-500 rounded-lg px-4 py-3 text-white placeholder-dark-300 focus:outline-none focus:border-accent transition-colors"
          disabled={loading}
        />
        <button
          onClick={handleDetect}
          disabled={loading || !url.trim()}
          className="px-4 py-3 bg-dark-600 hover:bg-dark-500 text-white rounded-lg transition-colors disabled:opacity-50 text-sm whitespace-nowrap"
        >
          {loading ? '...' : '解析 Parse'}
        </button>
        <button
          onClick={handleQuickDownload}
          disabled={loading || !url.trim()}
          className="px-6 py-3 bg-accent hover:bg-accent-hover text-white rounded-lg font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
              處理中 Processing
            </span>
          ) : '下載 Download'}
        </button>
      </div>

      {error && (
        <div className="mt-3 p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      {info && (
        <div className="mt-4 animate-slide-in">
          {info.platform && (
            <div className="flex items-center gap-2 mb-3">
              <span className="px-2 py-1 bg-accent/20 text-accent text-xs rounded-full">
                {info.platform}
              </span>
              {info.isStreaming && (
                <span className="px-2 py-1 bg-yellow-900/30 text-yellow-300 text-xs rounded-full">
                  串流網站 — 請改用「劇集 / 清單解析」分頁 · Use Series tab
                </span>
              )}
            </div>
          )}

          {info.title && (
            <h3 className="font-medium mb-2">{info.title}</h3>
          )}

          {info.thumbnail && (
            <img src={info.thumbnail} alt="" className="w-48 h-auto rounded-lg mb-3" />
          )}

          {info.formats && info.formats.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-dark-200">選擇畫質 · Select format:</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                {info.formats
                  .filter(f => f.resolution && f.resolution !== '?x?')
                  .slice(0, 12)
                  .map(f => (
                    <button
                      key={f.id}
                      onClick={() => handleDownload(f.id)}
                      className="text-left p-2 bg-dark-700 hover:bg-dark-600 rounded-lg text-sm transition-colors"
                    >
                      <div className="font-medium">{f.resolution}</div>
                      <div className="text-xs text-dark-300">
                        {f.ext} {f.filesize ? `(${(f.filesize / 1048576).toFixed(0)}MB)` : ''}
                      </div>
                    </button>
                  ))}
              </div>
              <button
                onClick={() => handleDownload(null)}
                className="w-full mt-2 px-4 py-2 bg-accent hover:bg-accent-hover rounded-lg text-sm transition-colors"
              >
                下載最佳畫質 · Download Best Quality
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

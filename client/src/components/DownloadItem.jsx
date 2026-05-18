import React from 'react';

const STATUS_CONFIG = {
  queued:      { label: '等待中 Queued',      color: 'text-dark-300',  bg: 'bg-dark-500' },
  downloading: { label: '下載中 Downloading', color: 'text-accent',    bg: 'bg-accent' },
  merging:     { label: '合併中 Merging',     color: 'text-yellow-400',bg: 'bg-yellow-500' },
  paused:      { label: '已暫停 Paused',      color: 'text-yellow-400',bg: 'bg-yellow-500' },
  completed:   { label: '已完成 Completed',   color: 'text-green-400', bg: 'bg-green-500' },
  error:       { label: '錯誤 Error',         color: 'text-red-400',   bg: 'bg-red-500' },
  cancelled:   { label: '已取消 Cancelled',   color: 'text-dark-300',  bg: 'bg-dark-500' },
};

export default function DownloadItem({ task }) {
  // Detect "Extracting" phase (downloading state but no real progress yet, speed shows extraction message)
  const isExtracting = task.status === 'downloading'
    && (task.progress || 0) < 0.5
    && /extract|refresh|loading/i.test(task.speed || '');

  let displayStatus = task.status;
  if (isExtracting) displayStatus = 'extracting';

  const EXTRA_CONFIG = {
    extracting: { label: '解析中 Extracting', color: 'text-blue-400', bg: 'bg-blue-500' },
  };
  const config = EXTRA_CONFIG[displayStatus] || STATUS_CONFIG[task.status] || STATUS_CONFIG.queued;
  const isActive = task.status === 'downloading' || task.status === 'merging';
  const isPaused = task.status === 'paused';

  const handleAction = async (action) => {
    try {
      // For live recordings, "cancel" should send a graceful stop (SIGINT)
      // so the .ts file is flushed and remuxed to .mp4 properly.
      if (action === 'cancel' && task.type === 'live') {
        await fetch(`/api/live/stop/${task.id}`, { method: 'POST' });
        return;
      }
      await fetch(`/api/download/${action}/${task.id}`, { method: 'POST' });
    } catch {}
  };

  const handleRemove = async () => {
    try {
      await fetch(`/api/download/${task.id}`, { method: 'DELETE' });
    } catch {}
  };

  return (
    <div className={`bg-dark-800 rounded-xl p-4 border border-dark-600 animate-slide-in ${
      isActive ? 'animate-pulse-glow' : ''
    }`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0 mr-4">
          <h3 className="font-medium truncate">{task.title}</h3>
          <p className="text-xs text-dark-400 truncate mt-0.5">{task.url}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs px-2 py-1 rounded-full ${config.color} bg-dark-700`}>
            {config.label}
          </span>
          <div className="flex gap-1">
            {isActive && (
              <button onClick={() => handleAction('pause')}
                className="p-1.5 hover:bg-dark-600 rounded-lg transition-colors" title="Pause">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M5 4h3v12H5V4zm7 0h3v12h-3V4z"/>
                </svg>
              </button>
            )}
            {isPaused && (
              <button onClick={() => handleAction('resume')}
                className="p-1.5 hover:bg-dark-600 rounded-lg transition-colors" title="Resume">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M6 4l10 6-10 6V4z"/>
                </svg>
              </button>
            )}
            {(isActive || isPaused || task.status === 'queued') && (
              <button onClick={() => handleAction('cancel')}
                className="p-1.5 hover:bg-red-900/50 text-dark-300 hover:text-red-400 rounded-lg transition-colors" title="Cancel">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"/>
                </svg>
              </button>
            )}
            {(task.status === 'completed' || task.status === 'error' || task.status === 'cancelled') && (
              <button onClick={handleRemove}
                className="p-1.5 hover:bg-dark-600 text-dark-400 hover:text-white rounded-lg transition-colors" title="Remove">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"/>
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {(isActive || isPaused) && (
        <>
          <div className="w-full bg-dark-700 rounded-full h-2 mb-2 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                isActive ? 'progress-bar-animated' : config.bg
              }`}
              style={{ width: `${Math.min(100, task.progress || 0)}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-dark-300">
            <div className="flex gap-4">
              <span className="text-white font-medium">{(task.progress || 0).toFixed(1)}%</span>
              {task.speed && <span>速度 Speed: <span className="text-accent">{task.speed}</span></span>}
              {task.downloaded && <span>已下載 Downloaded: {task.downloaded}{task.total ? ` / ${task.total}` : ''}</span>}
            </div>
            <div className="flex gap-4">
              {task.eta && <span>剩餘 ETA: {task.eta}</span>}
              {task.threads > 0 && <span>線程 Threads: {task.threads}</span>}
            </div>
          </div>
        </>
      )}

      {task.status === 'completed' && (
        <div className="text-xs text-green-400 mt-1">
          已儲存 Saved: {task.outputPath || '下載完成'}
        </div>
      )}

      {task.status === 'error' && (
        <div className="text-xs text-red-400 mt-1 truncate" title={task.error}>
          {task.error}
        </div>
      )}
    </div>
  );
}

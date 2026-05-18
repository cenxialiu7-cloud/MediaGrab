import React, { useState } from 'react';
import DownloadItem from './DownloadItem';

export default function DownloadQueue({ tasks }) {
  const [clearing, setClearing] = useState(false);

  const handleClearFinished = async () => {
    setClearing(true);
    try {
      await fetch('/api/download/clear-finished', { method: 'POST' });
    } catch {} finally {
      setClearing(false);
    }
  };

  if (!tasks || tasks.length === 0) {
    return (
      <div className="bg-dark-800 rounded-xl p-12 border border-dark-600 text-center">
        <div className="text-4xl mb-4">📭</div>
        <p className="text-dark-300">尚無下載任務 · No downloads yet</p>
        <p className="text-dark-400 text-sm mt-1">在上方貼上網址即可開始下載 · Paste a URL above to start</p>
      </div>
    );
  }

  const active = tasks.filter(t => ['downloading', 'merging'].includes(t.status));
  const queued = tasks.filter(t => t.status === 'queued');
  const paused = tasks.filter(t => t.status === 'paused');
  const completed = tasks.filter(t => t.status === 'completed');
  const failed = tasks.filter(t => ['error', 'cancelled'].includes(t.status));
  const finishedCount = completed.length + failed.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">下載佇列 · Download Queue</h2>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-accent">{active.length} 進行中</span>
          <span className="text-dark-300">{queued.length} 等待中</span>
          <span className="text-green-400">{completed.length} 已完成</span>
          {failed.length > 0 && <span className="text-red-400">{failed.length} 失敗</span>}
          {finishedCount > 0 && (
            <button
              onClick={handleClearFinished}
              disabled={clearing}
              className="ml-2 px-3 py-1 bg-dark-600 hover:bg-dark-500 text-dark-100 rounded-lg text-xs transition-colors disabled:opacity-50"
              title="清除所有已完成、失敗、已取消的項目"
            >
              {clearing ? '清除中...' : `清除已結束項目 · Clear Finished (${finishedCount})`}
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {active.map(task => <DownloadItem key={task.id} task={task} />)}
        {paused.map(task => <DownloadItem key={task.id} task={task} />)}
        {queued.map(task => <DownloadItem key={task.id} task={task} />)}
        {completed.map(task => <DownloadItem key={task.id} task={task} />)}
        {failed.map(task => <DownloadItem key={task.id} task={task} />)}
      </div>
    </div>
  );
}

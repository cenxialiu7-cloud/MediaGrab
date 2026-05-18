import React, { useState } from 'react';

export default function DepsCheck({ deps }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const missing = Object.entries(deps || {}).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length === 0) return null;

  return (
    <div className="max-w-6xl mx-auto px-6 pt-4">
      <div className="p-4 bg-yellow-900/30 border border-yellow-800 rounded-xl flex items-start justify-between">
        <div>
          <p className="text-yellow-300 font-medium text-sm">缺少相依套件 · Missing Dependencies</p>
          <p className="text-yellow-200/70 text-xs mt-1">
            以下工具尚未安裝：<strong>{missing.join(', ')}</strong>。請到「設定」分頁查看安裝指令。
            <br />
            <span className="opacity-70">Some tools are not installed. See install instructions in the Settings tab.</span>
          </p>
        </div>
        <button onClick={() => setDismissed(true)} className="text-yellow-400 hover:text-yellow-200 ml-4 shrink-0">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

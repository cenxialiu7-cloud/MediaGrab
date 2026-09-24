import React, { useEffect, useState } from "react";
import { apiFetch } from "../api";
export default function PlatformHelp() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    apiFetch("/api/platforms")
      .then((r) => r.json())
      .then(setItems)
      .catch(() => {});
  }, []);
  return (
    <details className="bg-dark-800 border border-dark-600 rounded-xl p-4 text-sm text-dark-200">
      <summary className="cursor-pointer font-medium">
        各平台下載方式與限制
      </summary>
      <p className="mt-3 text-dark-300">
        支援度取決於實際影片、登入權限與平台變更；下列是處理路徑，不代表每個網址都已通過實站驗收。
      </p>
      <div className="grid md:grid-cols-2 gap-4 mt-4">
        {items.map((p) => (
          <div key={p.id}>
            <strong>{p.name}</strong>
            <p className="text-dark-300 mt-1">{p.help}</p>
          </div>
        ))}
      </div>
    </details>
  );
}

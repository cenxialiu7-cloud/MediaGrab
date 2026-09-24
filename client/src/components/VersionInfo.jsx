import React, { useEffect, useState } from "react";
import { apiFetch } from "../api";
export default function VersionInfo() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    apiFetch("/api/version")
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => {});
  }, []);
  return (
    <div className="text-xs text-dark-300 mt-1" aria-label="版本資訊">
      <span>本機 v{info?.app || "…"} · </span>
      <a
        href="https://github.com/cenxialiu7-cloud/MediaGrab/releases/latest"
        target="_blank"
        rel="noreferrer"
        className="text-accent"
      >
        GitHub {info?.github ? "v" + info.github : "尚未確認"}
      </a>
      {info && (
        <span>
          {" "}
          ·{" "}
          {info.aligned
            ? "版本已對齊"
            : info.github
              ? "版本不同"
              : "無法確認遠端"}{" "}
          · 外掛包 v{info.extension}
        </span>
      )}
      <a
        href="https://cenxialiu7-cloud.github.io/MediaGrab/"
        target="_blank"
        rel="noreferrer"
        className="ml-2 text-accent"
      >
        官網
      </a>
      {info && (
        <div title="下載引擎診斷">
          引擎 {info.ytdlp || "未安裝"} · Node {info.node}
        </div>
      )}
    </div>
  );
}

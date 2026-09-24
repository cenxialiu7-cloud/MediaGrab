import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = new URL("../../", import.meta.url);
const read = (relative) =>
  JSON.parse(fs.readFileSync(new URL(relative, root), "utf8"));
export const appVersion = read("package.json").version;
let cache, pending;
export async function versionInfo() {
  const local = {
    app: appVersion,
    extension: read("extension/manifest.json").version,
    node: process.versions.node,
    releaseUrl: "https://github.com/cenxialiu7-cloud/MediaGrab/releases/latest",
    website: "https://cenxialiu7-cloud.github.io/MediaGrab/",
    ytdlp:
      spawnSync("yt-dlp", ["--version"], {
        encoding: "utf8",
        timeout: 5000,
      }).stdout?.trim() || null,
  };
  if (!cache || Date.now() - cache.checkedAt > 15 * 60 * 1000) {
    pending ||= (async () => {
      try {
        const res = await fetch(
          "https://api.github.com/repos/cenxialiu7-cloud/MediaGrab/releases/latest",
          {
            headers: { Accept: "application/vnd.github+json" },
            signal: AbortSignal.timeout(5000),
          },
        );
        if (!res.ok) throw new Error("release unavailable");
        const release = await res.json();
        cache = {
          github: String(release.tag_name || "").replace(/^v/, ""),
          checkedAt: Date.now(),
          remoteStatus: "verified",
        };
      } catch {
        cache = {
          github: null,
          checkedAt: Date.now(),
          remoteStatus: "unavailable",
        };
      } finally {
        pending = null;
      }
    })();
    await pending;
  }
  return {
    ...local,
    ...cache,
    aligned: cache.github === local.app && local.extension === local.app,
  };
}

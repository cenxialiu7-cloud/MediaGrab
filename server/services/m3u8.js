// Use yt-dlp's tested HLS/DASH implementation for keys, sequences, byte ranges,
// separate audio and discontinuities. Never synthesize a complete playlist.
import { extractM3u8 } from "./playwright.js";
import { startDownload } from "./ytdlp.js";
export async function downloadM3u8(task) {
  if (task.controller?.signal.aborted) return;
  if (task.episodeUrl) {
    const fresh = await extractM3u8(task.episodeUrl, {
      signal: task.controller?.signal,
    });
    const url = fresh.m3u8[0] || fresh.mp4[0];
    if (!url)
      throw new Error(
        "未找到完整串流。請登入後使用擴充擷取，或使用官方離線功能。",
      );
    task.m3u8Url = url;
    task.headers = fresh.headersByUrl?.[url] || fresh.headers;
    task.contexts = fresh.contexts;
    task.capturedCookies = fresh.capturedCookies;
  }
  task.url = task.m3u8Url || task.url;
  task.useCapturedHeaders = true;
  return startDownload(task);
}

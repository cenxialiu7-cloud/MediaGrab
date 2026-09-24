import fs from "node:fs";
import { spawn } from "node:child_process";
export async function verifyMedia(
  file,
  { duration, requireAudio = false, audioOnly = false } = {},
) {
  if (!file || !fs.existsSync(file) || fs.statSync(file).size === 0)
    throw new Error("沒有產生有效影音檔");
  const info = await new Promise((resolve, reject) => {
    const p = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type",
        "-of",
        "json",
        file,
      ],
      { timeout: 20000 },
    );
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("error", () => reject(new Error("缺少 ffprobe，無法驗證下載完整性")));
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error("輸出檔無法讀取"));
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error("輸出檔驗證失敗"));
      }
    });
  });
  const types = info.streams?.map((s) => s.codec_type) || [];
  if (!types.includes("audio") && !types.includes("video"))
    throw new Error("輸出沒有影音軌");
  if ((requireAudio || audioOnly) && !types.includes("audio"))
    throw new Error("缺少必要音軌，下載不完整");
  const actual = Number(info.format?.duration);
  if (
    duration > 0 &&
    (!Number.isFinite(actual) ||
      actual < duration - Math.max(1, duration * 0.02))
  )
    throw new Error("影片時長不足，下載不完整");
  return { duration: actual, streams: types };
}

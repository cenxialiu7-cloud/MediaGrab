import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { taskManager } from "../utils/taskManager.js";
import { sanitizeFilename } from "../utils/filename.js";
import { ytdlpCookieArgs } from "../utils/cookies.js";
import { verifyMedia } from "../utils/mediaValidation.js";
import { createMediaGateway } from "./mediaGateway.js";
import { getInfo } from "./ytdlp.js";
export const getStreamInfo = getInfo;
export const recordStream = (task) => recordWithYtdlp(task);
export const recordWithFFmpeg = (task) => recordWithYtdlp(task);
export async function recordWithYtdlp(task) {
  let gateway, timer;
  const filename = `${sanitizeFilename(task.title)} [${task.id.slice(0, 8)}].ts`;
  const output = path.join(task.outputDir, filename);
  try {
    fs.mkdirSync(task.outputDir, { recursive: true });
    if (/\.(m3u8|mpd)(\?|$)/i.test(task.url))
      gateway = await createMediaGateway({
        url: task.url,
        headers: task.headers,
      });
    const args = [
      "--ignore-config",
      "--js-runtimes",
      `node:${process.execPath}`,
      "--no-playlist",
      "--no-part",
      "--no-warnings",
      "--hls-use-mpegts",
      "--retries",
      "3",
      "--fragment-retries",
      "3",
      "--abort-on-unavailable-fragments",
      "--socket-timeout",
      "30",
      "-f",
      "best/bv*+ba/b",
      "-o",
      output,
    ];
    if (!gateway) args.push(...ytdlpCookieArgs(task.cookies));
    args.push("--", gateway?.url || task.url);
    if (task.controller?.signal.aborted) return;
    const code = await new Promise((resolve, reject) => {
      const proc = spawn("yt-dlp", args, {
        detached: process.platform !== "win32",
      });
      task.process = proc;
      let error = "";
      proc.stderr.on("data", (d) => (error = (error + d).slice(-4000)));
      proc.stdout.on("data", () => {});
      proc.on("error", reject);
      proc.on("close", (c) => {
        task.lastError = error;
        resolve(c);
      });
      taskManager.updateTask(task.id, {
        outputPath: output,
        recordingMethod: "yt-dlp",
        resumable: false,
      });
      if (task.duration)
        timer = setTimeout(
          () => stopGracefully(task),
          Number(task.duration) * 1000,
        );
    });
    if (task.status === "cancelled") return;
    await verifyMedia(output);
    if (code !== 0 && !task.stopRequested) {
      taskManager.finish(task.id, "incomplete", {
        error: "錄製中斷，保留部分檔案；請重新錄製",
        outputPath: output,
      });
      return;
    }
    taskManager.completeTask(task.id, output);
  } catch (e) {
    taskManager.failTask(task.id, e);
  } finally {
    clearTimeout(timer);
    await gateway?.close();
    task.process = null;
  }
}
export function stopGracefully(task) {
  if (!task.process) {
    if (task.status === "queued") return taskManager.cancelTask(task.id);
    return;
  }
  task.stopRequested = true;
  // Windows has no portable SIGINT delivery to a hidden console process.
  // Terminate its process tree; TS is retained and verified, never claim full VOD.
  if (process.platform === "win32")
    spawn("taskkill", ["/PID", String(task.process.pid), "/T", "/F"], {
      stdio: "ignore",
    }).on("error", () => {});
  else
    try {
      process.kill(-task.process.pid, "SIGINT");
    } catch {
      task.process.kill("SIGINT");
    }
}

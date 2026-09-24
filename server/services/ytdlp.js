import { DATA_DIR } from "../utils/config.js";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { taskManager } from "../utils/taskManager.js";
import { sanitizeFilename } from "../utils/filename.js";
import { createMediaGateway } from "./mediaGateway.js";
import { verifyMedia } from "../utils/mediaValidation.js";
import { httpUrl, cleanHeaders, publicUrl } from "../utils/security.js";
import { ytdlpCookieArgs } from "../utils/cookies.js";

const DEFAULT_OUTPUT = path.join(os.homedir(), "Downloads", "MediaGrab");

export async function getInfo(url, cookieArgs = ytdlpCookieArgs()) {
  await publicUrl(url);
  return new Promise((resolve, reject) => {
    const args = [
      "--ignore-config",
      "--js-runtimes",
      `node:${process.execPath}`,
      "--dump-json",
      "--no-playlist",
      "--no-warnings",
      ...cookieArgs,
      "--",
      httpUrl(url),
    ];
    const proc = spawn("yt-dlp", args, { timeout: 30000 });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err += d));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0)
        return reject(new Error(err || `yt-dlp exited with code ${code}`));
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error("Failed to parse yt-dlp output"));
      }
    });
  });
}

export function getPlaylistInfo(url) {
  return new Promise((resolve, reject) => {
    const args = [
      "--ignore-config",
      "--js-runtimes",
      `node:${process.execPath}`,
      "--dump-json",
      "--flat-playlist",
      "--no-warnings",
      ...ytdlpCookieArgs(),
      "--",
      httpUrl(url),
    ];
    const proc = spawn("yt-dlp", args, { timeout: 60000 });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err += d));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0)
        return reject(new Error(err || `yt-dlp exited with code ${code}`));
      try {
        const entries = out
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l));
        resolve(entries);
      } catch {
        reject(new Error("Failed to parse playlist"));
      }
    });
  });
}

/**
 * List all videos in a YouTube playlist or channel.
 * For channels, automatically appends /videos if not present.
 * Returns { title, type, entries: [{ id, title, url, duration, uploader }] }
 */
export function listYoutubeVideos(url) {
  return new Promise((resolve, reject) => {
    let target = url.trim();
    const isChannel = /youtube\.com\/(@[\w.-]+|channel\/|c\/|user\/)/.test(
      target,
    );
    const isPlaylist = /[?&]list=/.test(target);

    // For channel URLs without a specific tab, default to the videos tab
    if (
      isChannel &&
      !/\/(videos|streams|shorts|playlists)\b/.test(target) &&
      !isPlaylist
    ) {
      target = target.replace(/\/$/, "") + "/videos";
    }

    // If it's a watch URL with a list= param, use the playlist
    if (isPlaylist && /watch\?/.test(target)) {
      const m = target.match(/[?&]list=([^&]+)/);
      if (m) target = `https://www.youtube.com/playlist?list=${m[1]}`;
    }

    const args = [
      "--ignore-config",
      "--js-runtimes",
      `node:${process.execPath}`,
      "--dump-json",
      "--flat-playlist",
      "--no-warnings",
      "--playlist-end",
      "500", // safety cap
      ...ytdlpCookieArgs(),
      "--",
      httpUrl(target),
    ];
    const proc = spawn("yt-dlp", args, { timeout: 90000 });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err += d));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0 && !out.trim()) {
        return reject(
          new Error(
            err.split("\n").filter(Boolean).pop() ||
              `yt-dlp exited with code ${code}`,
          ),
        );
      }
      try {
        const lines = out.trim().split("\n").filter(Boolean);
        const entries = [];
        let playlistTitle = "";
        for (const line of lines) {
          const j = JSON.parse(line);
          if (j._type === "playlist" && j.title) {
            playlistTitle = j.title;
            continue;
          }
          // Skip entries that aren't actual videos
          if (!j.id) continue;
          entries.push({
            id: j.id,
            title: j.title || j.id,
            url: j.url || `https://www.youtube.com/watch?v=${j.id}`,
            duration: j.duration || 0,
            uploader: j.uploader || j.channel || "",
          });
          if (!playlistTitle && j.playlist_title)
            playlistTitle = j.playlist_title;
          if (!playlistTitle && j.channel) playlistTitle = j.channel;
        }
        if (entries.length === 0) {
          return reject(
            new Error("No videos found. The URL may be private or invalid."),
          );
        }
        resolve({
          title:
            playlistTitle ||
            (isChannel ? "YouTube Channel" : "YouTube Playlist"),
          type: isChannel ? "channel" : "playlist",
          entries,
        });
      } catch (e) {
        reject(new Error("Failed to parse video list: " + e.message));
      }
    });
  });
}

export async function startDownload(task) {
  if (["paused", "cancelled"].includes(task.status)) return;
  const outputDir = task.outputDir || DEFAULT_OUTPUT;
  fs.mkdirSync(outputDir, { recursive: true });
  const name = sanitizeFilename(
    (task.filename || task.pageTitle || task.title || "video").replace(
      /\.(mp4|mkv|webm|m4a)$/i,
      "",
    ),
  );
  const template = path.join(
    outputDir,
    `${name.replace(/%/g, "%%")} [${task.id.slice(0, 8)}].%(ext)s`,
  );
  let gateway, temporaryCookies;
  try {
    let url = await publicUrl(task.url);
    const captured =
      task.useCapturedHeaders &&
      !task.providerPage &&
      !/^(www\.)?(youtube\.com|youtu\.be)$/.test(new URL(url).hostname);
    if (captured)
      gateway = await createMediaGateway({
        url,
        headers: {
          ...cleanHeaders(task.headers),
          ...(task.referer ? { referer: task.referer } : {}),
        },
        contexts: task.contexts,
        cookies: task.capturedCookies,
      });
    if (task.controller?.signal.aborted) return;
    const args = [
      "--ignore-config",
      "--js-runtimes",
      `node:${process.execPath}`,
      "--no-playlist",
      "--no-warnings",
      "--newline",
      "--no-simulate",
      "--progress",
      "--continue",
      "--no-overwrites",
      "--abort-on-unavailable-fragments",
      "--fragment-retries",
      "3",
      "--retries",
      "3",
      "--socket-timeout",
      "30",
      "--concurrent-fragments",
      String(task.threads || 4),
      "-o",
      template,
      "--print",
      "after_move:MGFILE:%(filepath)j",
      "--progress-template",
      "download:MGPROGRESS:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s",
      "-f",
      task.format ||
        (task.type === "audio"
          ? "ba/b"
          : task.allAudio
            ? "bv+mergeall[vcodec=none]"
            : "bv*+ba/b"),
    ];
    if (task.allAudio)
      args.push("--audio-multistreams", "--merge-output-format", "mkv");
    if (task.subtitles)
      args.push(
        "--write-subs",
        "--write-auto-subs",
        "--sub-langs",
        task.subtitleLanguages || "zh.*,en",
        "--embed-subs",
      );
    if (task.type === "audio") args.push("-x", "--audio-format", "m4a");
    if (!gateway) {
      if (task.providerPage && task.capturedCookies?.length) {
        fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
        temporaryCookies = path.join(DATA_DIR, `cookies-${task.id}.txt`);
        const lines = ["# Netscape HTTP Cookie File"];
        for (const c of task.capturedCookies) {
          if (
            [c.domain, c.path, c.name, c.value].some(
              (v) => typeof v !== "string" || /[\r\n\t]/.test(v),
            )
          )
            continue;
          lines.push(
            [
              c.domain,
              c.hostOnly ? "FALSE" : "TRUE",
              c.path,
              c.secure ? "TRUE" : "FALSE",
              Math.floor(c.expirationDate || 0),
              c.name,
              c.value,
            ].join("\t"),
          );
        }
        fs.writeFileSync(temporaryCookies, lines.join("\n"), { mode: 0o600 });
        args.push("--cookies", temporaryCookies);
      } else args.push(...ytdlpCookieArgs(task.cookies));
      if (task.providerPage && task.referer)
        args.push("--referer", httpUrl(task.referer));
    }
    args.push("--", gateway?.url || url);
    let output = "",
      error = "",
      finalPath = "";
    await new Promise((resolve, reject) => {
      const proc = spawn("yt-dlp", args, {
        detached: process.platform !== "win32",
      });
      task.process = proc;
      proc.on("error", reject);
      const line = (l) => {
        if (l.startsWith("MGFILE:")) {
          try {
            finalPath = JSON.parse(l.slice(7));
          } catch {}
        }
        const m = l.match(/MGPROGRESS:\s*([\d.]+)%\|([^|]*)\|([^|]*)/);
        if (m && !["paused", "cancelled"].includes(task.status))
          taskManager.updateTask(task.id, {
            progress: Math.min(99, Number(m[1])),
            speed: m[2],
            eta: m[3],
          });
      };
      proc.stdout.on("data", (d) => {
        output += d;
        let i;
        while ((i = output.indexOf("\n")) >= 0) {
          line(output.slice(0, i).trim());
          output = output.slice(i + 1);
        }
      });
      proc.stderr.on("data", (d) => {
        error = (error + d).slice(-12000);
      });
      proc.on("close", (code) => {
        line(output.trim());
        if (["paused", "cancelled"].includes(task.status)) return resolve();
        code === 0
          ? resolve()
          : reject(new Error(error || `下載引擎結束：${code}`));
      });
    });
    if (["paused", "cancelled"].includes(task.status)) return;
    if (!finalPath) throw new Error("下載引擎未回報輸出檔案");
    taskManager.updateTask(task.id, {
      status: "verifying",
      outputPath: finalPath,
    });
    await verifyMedia(finalPath, {
      duration: gateway?.expectedDuration || task.duration,
      requireAudio: gateway?.expectedAudio || task.requireAudio,
      audioOnly: task.type === "audio",
    });
    taskManager.completeTask(task.id, finalPath);
  } catch (e) {
    if (!["paused", "cancelled"].includes(task.status))
      taskManager.failTask(task.id, gateway?.error || e);
  } finally {
    await gateway?.close();
    if (temporaryCookies) fs.rmSync(temporaryCookies, { force: true });
    task.process = null;
  }
}

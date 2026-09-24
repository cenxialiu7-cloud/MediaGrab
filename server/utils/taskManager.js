import { explainFailure } from "./platforms.js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { broadcast } from "../ws.js";
import { DATA_DIR, loadSettings } from "./config.js";
import { safeError } from "./security.js";
function killTree(proc, signal) {
  if (!proc?.pid) return;
  try {
    if (process.platform === "win32")
      spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], {
        stdio: "ignore",
        timeout: 5000,
      });
    else process.kill(-proc.pid, signal);
  } catch {
    try {
      proc.kill(signal);
    } catch {}
  }
}
const terminal = new Set(["completed", "cancelled", "error", "incomplete"]);
const allowed = [
  "id",
  "title",
  "type",
  "status",
  "progress",
  "speed",
  "downloaded",
  "total",
  "eta",
  "threads",
  "outputPath",
  "createdAt",
  "duration",
  "recordingMethod",
  "resumable",
];
export function publicTask(task) {
  const value = {};
  for (const key of allowed)
    if (task[key] !== undefined) value[key] = task[key];
  if (task.error) Object.assign(value, explainFailure(task.error));
  value.error = task.error ? safeError(task.error) : null;
  value.url = "";
  return value;
}
function serialTask(t) {
  const {
    process,
    startFn,
    controller,
    pauseHook,
    cancelHook,
    cleanupHook,
    runDone,
    ...r
  } = t;
  return r;
}
export class TaskManager {
  constructor({ persist = true } = {}) {
    this.tasks = new Map();
    this.queue = [];
    this.active = new Set();
    this.maxConcurrent = loadSettings().maxConcurrent || 3;
    this.persist = persist;
    this.stopping = false;
    this.restore();
  }
  get activeCount() {
    return this.active.size;
  }
  restore() {
    if (!this.persist) return;
    try {
      const key = fs.readFileSync(path.join(DATA_DIR, "tasks.key"));
      const b = fs.readFileSync(path.join(DATA_DIR, "tasks.enc"));
      const d = crypto.createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
      d.setAuthTag(b.subarray(12, 28));
      const items = JSON.parse(
        Buffer.concat([d.update(b.subarray(28)), d.final()]),
      );
      for (const t of items) {
        if (!terminal.has(t.status)) {
          t.status = "paused";
          t.error = "程式重啟，請繼續下載；登入來源過期時需重新擷取";
        }
        t.startFn = this.restarter(t);
        this.tasks.set(t.id, t);
      }
    } catch {}
  }
  restarter(t) {
    return async () => {
      if (t.type === "live") throw new Error("直播中斷，請重新建立錄製");
      const mod = await import(
        t.m3u8Url || t.episodeUrl
          ? "../services/m3u8.js"
          : "../services/ytdlp.js"
      );
      return mod.downloadM3u8 ? mod.downloadM3u8(t) : mod.startDownload(t);
    };
  }
  persistNow() {
    if (!this.persist) return;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
      const k = path.join(DATA_DIR, "tasks.key");
      let key;
      try {
        key = fs.readFileSync(k);
      } catch {
        key = crypto.randomBytes(32);
        fs.writeFileSync(k, key, { mode: 0o600, flag: "wx" });
      }
      const iv = crypto.randomBytes(12),
        c = crypto.createCipheriv("aes-256-gcm", key, iv);
      const data = Buffer.concat([
        c.update(
          JSON.stringify([...this.tasks.values()].slice(-1000).map(serialTask)),
        ),
        c.final(),
      ]);
      const p = path.join(DATA_DIR, "tasks.enc");
      fs.writeFileSync(p + ".tmp", Buffer.concat([iv, c.getAuthTag(), data]), {
        mode: 0o600,
      });
      fs.renameSync(p + ".tmp", p);
    } catch {}
  }
  createTask(info) {
    if (this.tasks.size >= 1000)
      throw new Error("任務上限 1000，請清除已完成任務");
    const s = loadSettings();
    const task = {
      id: crypto.randomUUID(),
      title: info.title || "Video",
      type: "video",
      status: s.autoStartQueue ? "queued" : "paused",
      progress: 0,
      speed: "",
      downloaded: "",
      total: "",
      eta: "",
      error: null,
      outputPath: "",
      createdAt: Date.now(),
      resumable: true,
      ...info,
      outputDir: info.outputDir || s.outputDir,
      threads: info.threads || s.threadsPerTask,
    };
    this.tasks.set(task.id, task);
    if (task.status === "queued") this.queue.push(task.id);
    this.persistNow();
    broadcast("task:created", publicTask(task));
    return task;
  }
  updateTask(id, updates) {
    const t = this.tasks.get(id);
    if (!t) return null;
    if (terminal.has(t.status) && updates.status && updates.status !== t.status)
      return t;
    Object.assign(t, updates);
    broadcast("task:updated", publicTask(t));
    if (updates.status || updates.outputPath) this.persistNow();
    return t;
  }
  finish(id, status, extra) {
    const t = this.tasks.get(id);
    if (!t || terminal.has(t.status) || t.status === "paused") return;
    this.active.delete(id);
    if (terminal.has(status)) {
      delete t.headers;
      delete t.contexts;
      delete t.capturedCookies;
    }
    this.updateTask(id, { status, ...extra });
    this.processQueue();
  }
  completeTask(id, outputPath) {
    this.finish(id, "completed", { progress: 100, error: null, outputPath });
  }
  failTask(id, error) {
    this.finish(id, "error", { error: safeError(error) });
  }
  async stop(id, status) {
    const t = this.tasks.get(id);
    if (!t || terminal.has(t.status)) return;
    if (status === "paused" && t.type === "live")
      throw new Error("直播請使用停止錄製");
    this.updateTask(id, { status });
    this.queue = this.queue.filter((x) => x !== id);
    t.controller?.abort();
    try {
      await t.cancelHook?.();
    } catch {}
    const p = t.process;
    if (p && p.exitCode == null) {
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          try {
            killTree(p, "SIGKILL");
          } catch {}
          resolve();
        }, 2500);
        p.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
        try {
          killTree(p, "SIGTERM");
        } catch {
          clearTimeout(timer);
          resolve();
        }
      });
    }
    if (t.runDone) await t.runDone.catch(() => {});
    this.active.delete(id);
    t.process = null;
    this.persistNow();
    this.processQueue();
  }
  cancelTask(id) {
    return this.stop(id, "cancelled");
  }
  pauseTask(id) {
    return this.stop(id, "paused");
  }
  resumeTask(id) {
    const t = this.tasks.get(id);
    if (!t || t.status !== "paused") return;
    this.updateTask(id, {
      status: "queued",
      error: null,
      process: null,
      controller: null,
    });
    if (!t.startFn) t.startFn = this.restarter(t);
    this.queue.push(id);
    this.processQueue();
  }
  canStartNext() {
    return !this.stopping && this.active.size < this.maxConcurrent;
  }
  markActive(id) {
    if (this.active.has(id)) return;
    this.active.add(id);
    this.queue = this.queue.filter((x) => x !== id);
    this.updateTask(id, { status: "downloading" });
  }
  processQueue() {
    while (this.canStartNext() && this.queue.length) {
      const id = this.queue.shift(),
        t = this.tasks.get(id);
      if (!t || t.status !== "queued") continue;
      this.markActive(id);
      t.controller = new AbortController();
      t.runDone = Promise.resolve()
        .then(() => (t.startFn ? t.startFn(t) : this.restarter(t)()))
        .catch((e) => this.failTask(id, e));
    }
  }
  setMaxConcurrent(n) {
    if (!Number.isInteger(n) || n < 1 || n > 10)
      throw new Error("maxConcurrent must be 1–10");
    this.maxConcurrent = n;
    this.processQueue();
  }
  getAllTasks() {
    return [...this.tasks.values()].map(publicTask);
  }
  async shutdown() {
    this.stopping = true;
    await Promise.all(
      [...this.active].map((id) =>
        this.pauseTask(id).catch(() => this.cancelTask(id)),
      ),
    );
    this.persistNow();
  }
  async removeTask(id) {
    await this.cancelTask(id);
    this.tasks.delete(id);
    this.persistNow();
    broadcast("task:removed", { id });
  }
  clearFinished() {
    let n = 0;
    for (const [id, t] of this.tasks)
      if (terminal.has(t.status)) {
        this.tasks.delete(id);
        broadcast("task:removed", { id });
        n++;
      }
    this.persistNow();
    return n;
  }
  getDependencyStatus() {
    const exists = (cmd) =>
      !spawnSync(cmd, [cmd.startsWith("ff") ? "-version" : "--version"], {
        stdio: "ignore",
        timeout: 5000,
      }).error;
    return {
      "yt-dlp": exists("yt-dlp"),
      ffmpeg: exists("ffmpeg"),
      ffprobe: exists("ffprobe"),
      node: Number(process.versions.node.split(".")[0]) >= 24,
    };
  }
}
export const taskManager = new TaskManager();

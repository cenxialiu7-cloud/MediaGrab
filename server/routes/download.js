import { Router } from "express";
import { taskManager } from "../utils/taskManager.js";
import * as ytdlp from "../services/ytdlp.js";
import { ytdlpCookieArgs } from "../utils/cookies.js";
import * as m3u8Service from "../services/m3u8.js";
import { getResource } from "../utils/resources.js";

const router = Router();

// yt-dlp errors that mean "the source needs auth / has no downloadable media"
// — for these we must NOT create a doomed task (which used to run yt-dlp again
// and leave a few-KB ghost file, e.g. Instagram reels behind the login wall).
const AUTH_OR_EMPTY =
  /login required|log ?in|requires? (a )?login|empty media response|use --cookies|cookies? (are )?required|sign in|private (video|account)|not available in your|rate[- ]?limit|restricted video|age[- ]?restrict|no video (could be )?found|account you are using/i;

router.post("/start", async (req, res) => {
  try {
    const {
      url,
      format,
      outputDir,
      cookies,
      type,
      pageTitle,
      subtitles,
      subtitleLanguages,
      allAudio,
    } = req.body;

    if (!url) return res.status(400).json({ error: "URL is required" });

    const cookieChoice = cookies || null;
    const info = await ytdlp.getInfo(url, ytdlpCookieArgs(cookieChoice));

    const task = taskManager.createTask({
      title: info.title || "Video Download",
      pageTitle:
        typeof pageTitle === "string" && pageTitle.trim()
          ? pageTitle.trim()
          : undefined,
      url,
      type: type || "video",
      subtitles: !!subtitles,
      subtitleLanguages,
      allAudio: !!allAudio,
      format: format || null,
      outputDir: outputDir || undefined,
      cookies: cookieChoice,
      requireAudio: (info.formats || []).some(
        (f) => f.acodec && f.acodec !== "none",
      ),
      duration: info.duration || 0,
      startFn: (t) => ytdlp.startDownload(t),
    });

    taskManager.processQueue();

    res.json({ taskId: task.id, title: info.title });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/m3u8", async (req, res) => {
  try {
    const {
      m3u8Url,
      episodeUrl,
      title,
      filename,
      headers,
      outputDir,
      threads,
    } = req.body;

    // Need at least one source: a direct m3u8 URL, or an episode page URL
    // that the m3u8 service will lazy-extract (e.g. missav single-video sites).
    if (!m3u8Url && !episodeUrl) {
      return res
        .status(400)
        .json({ error: "m3u8Url or episodeUrl is required" });
    }

    const task = taskManager.createTask({
      title: title || "Stream Download",
      url: m3u8Url || episodeUrl,
      m3u8Url: m3u8Url || null,
      episodeUrl: episodeUrl || null,
      type: "m3u8",
      filename,
      headers,
      outputDir,
      threads: threads,
      startFn: (t) => m3u8Service.downloadM3u8(t),
    });

    taskManager.processQueue();

    res.json({ taskId: task.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/batch", async (req, res) => {
  try {
    const { episodes, outputDir, threads, seriesTitle } = req.body;

    if (!episodes || !Array.isArray(episodes)) {
      return res.status(400).json({ error: "episodes array is required" });
    }

    const taskIds = [];

    for (const ep of episodes) {
      // Determine task type:
      // - If only episodeUrl given (no m3u8Url), use m3u8 service which will lazy-extract
      // - If m3u8Url given, use it directly with optional refresh
      const hasStreamUrl = !!ep.m3u8Url;
      const hasEpisodeUrl = !!ep.episodeUrl;
      const willLazyExtract = !hasStreamUrl && hasEpisodeUrl;

      const filename =
        ep.filename ||
        (seriesTitle
          ? `${seriesTitle} - ${ep.title}.mp4`
          : `${ep.title || "video"}.mp4`);

      const task = taskManager.createTask({
        title: ep.title || `Episode`,
        url: ep.url || ep.m3u8Url || ep.episodeUrl,
        m3u8Url: ep.m3u8Url || null,
        episodeUrl: ep.episodeUrl || null,
        type: willLazyExtract ? "streaming" : ep.m3u8Url ? "m3u8" : "video",
        filename,
        headers: ep.headers || undefined,
        outputDir: outputDir || undefined,
        threads: threads,
        startFn: (t) => {
          // m3u8 service handles both: has m3u8Url, or lazy-extract via episodeUrl
          if (t.m3u8Url || t.episodeUrl) return m3u8Service.downloadM3u8(t);
          return ytdlp.startDownload(t);
        },
      });
      taskIds.push(task.id);
    }

    taskManager.processQueue();
    res.json({ taskIds, count: taskIds.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/aria2", async (req, res) => {
  try {
    const { url, filename, headers, outputDir, threads } = req.body;

    if (!url) return res.status(400).json({ error: "URL is required" });

    const task = taskManager.createTask({
      title: filename || url.split("/").pop() || "Download",
      url,
      downloadUrl: url,
      type: "direct",
      useCapturedHeaders: true,
      startFn: (t) => ytdlp.startDownload(t),
      filename,
      headers,
      outputDir,
      threads: threads,
    });

    taskManager.processQueue();

    res.json({ taskId: task.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/cancel/:id", async (req, res, next) => {
  try {
    await taskManager.cancelTask(req.params.id);
  } catch (e) {
    return next(e);
  }
  res.json({ ok: true });
});

router.post("/pause/:id", async (req, res, next) => {
  try {
    await taskManager.pauseTask(req.params.id);
  } catch (e) {
    return next(e);
  }
  res.json({ ok: true });
});

router.post("/resume/:id", async (req, res, next) => {
  try {
    await taskManager.resumeTask(req.params.id);
  } catch (e) {
    return next(e);
  }
  res.json({ ok: true });
});

router.delete("/:id", async (req, res, next) => {
  try {
    await taskManager.removeTask(req.params.id);
  } catch (e) {
    return next(e);
  }
  res.json({ ok: true });
});

// Clear all finished tasks (completed, cancelled, error)
router.post("/clear-finished", (req, res) => {
  const removed = taskManager.clearFinished();
  res.json({ ok: true, removed });
});

router.get("/tasks", (req, res) => {
  res.json(taskManager.getAllTasks());
});

router.post("/info", async (req, res) => {
  try {
    const { url } = req.body;
    const info = await ytdlp.getInfo(url);
    res.json({
      title: info.title,
      thumbnail: info.thumbnail,
      duration: info.duration,
      formats: (info.formats || [])
        .filter((f) => f.vcodec !== "none" || f.acodec !== "none")
        .map((f) => ({
          id: f.format_id,
          ext: f.ext,
          resolution: f.resolution || `${f.width || "?"}x${f.height || "?"}`,
          filesize: f.filesize || f.filesize_approx,
          vcodec: f.vcodec,
          acodec: f.acodec,
          note: f.format_note,
        })),
      webpage_url: info.webpage_url,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/resource", (req, res, next) => {
  try {
    const r = getResource(req.body.resourceId);
    const task = taskManager.createTask({
      url: r.url,
      title: r.title,
      type: r.type,
      headers: r.headers,
      contexts: r.contexts,
      capturedCookies: r.cookies,
      useCapturedHeaders: true,
      startFn: (t) => ytdlp.startDownload(t),
    });
    taskManager.processQueue();
    res.json({ taskId: task.id });
  } catch (e) {
    next(e);
  }
});
export default router;

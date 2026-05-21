import { Router } from 'express';
import { taskManager } from '../utils/taskManager.js';
import * as ytdlp from '../services/ytdlp.js';
import * as m3u8Service from '../services/m3u8.js';
import * as aria2 from '../services/aria2.js';

const router = Router();

router.post('/start', async (req, res) => {
  try {
    const { url, format, outputDir, cookies, type } = req.body;

    if (!url) return res.status(400).json({ error: 'URL is required' });

    let info;
    try {
      info = await ytdlp.getInfo(url);
    } catch {
      info = { title: url.split('/').pop() || 'Video', formats: [] };
    }

    const task = taskManager.createTask({
      title: info.title || 'Video Download',
      url,
      type: type || 'video',
      format: format || null,
      outputDir: outputDir || undefined,
      cookies: cookies || null,
      thumbnail: info.thumbnail || '',
      duration: info.duration || 0,
      startFn: (t) => ytdlp.startDownload(t),
    });

    if (taskManager.canStartNext()) {
      taskManager.markActive(task.id);
      ytdlp.startDownload(task);
    }

    res.json({ taskId: task.id, title: info.title });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/m3u8', async (req, res) => {
  try {
    const { m3u8Url, episodeUrl, title, filename, headers, outputDir, threads } = req.body;

    // Need at least one source: a direct m3u8 URL, or an episode page URL
    // that the m3u8 service will lazy-extract (e.g. missav single-video sites).
    if (!m3u8Url && !episodeUrl) {
      return res.status(400).json({ error: 'm3u8Url or episodeUrl is required' });
    }

    const task = taskManager.createTask({
      title: title || 'Stream Download',
      url: m3u8Url || episodeUrl,
      m3u8Url: m3u8Url || null,
      episodeUrl: episodeUrl || null,
      type: 'm3u8',
      filename,
      headers,
      outputDir,
      threads: threads || 8,
      startFn: (t) => m3u8Service.downloadM3u8(t),
    });

    if (taskManager.canStartNext()) {
      taskManager.markActive(task.id);
      m3u8Service.downloadM3u8(task);
    }

    res.json({ taskId: task.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/batch', async (req, res) => {
  try {
    const { episodes, outputDir, threads, seriesTitle } = req.body;

    if (!episodes || !Array.isArray(episodes)) {
      return res.status(400).json({ error: 'episodes array is required' });
    }

    const taskIds = [];

    for (const ep of episodes) {
      // Determine task type:
      // - If only episodeUrl given (no m3u8Url), use m3u8 service which will lazy-extract
      // - If m3u8Url given, use it directly with optional refresh
      const hasStreamUrl = !!ep.m3u8Url;
      const hasEpisodeUrl = !!ep.episodeUrl;
      const willLazyExtract = !hasStreamUrl && hasEpisodeUrl;

      const filename = ep.filename || (seriesTitle ? `${seriesTitle} - ${ep.title}.mp4` : `${ep.title || 'video'}.mp4`);

      const task = taskManager.createTask({
        title: ep.title || `Episode`,
        url: ep.url || ep.m3u8Url || ep.episodeUrl,
        m3u8Url: ep.m3u8Url || null,
        episodeUrl: ep.episodeUrl || null,
        type: willLazyExtract ? 'streaming' : (ep.m3u8Url ? 'm3u8' : 'video'),
        filename,
        headers: ep.headers || undefined,
        outputDir: outputDir || undefined,
        threads: threads || 8,
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

router.post('/aria2', async (req, res) => {
  try {
    const { url, filename, headers, outputDir, threads } = req.body;

    if (!url) return res.status(400).json({ error: 'URL is required' });

    const available = await aria2.startAria2Daemon();
    if (!available) {
      return res.status(500).json({ error: 'aria2 is not available. Please install aria2.' });
    }

    const task = taskManager.createTask({
      title: filename || url.split('/').pop() || 'Download',
      url,
      downloadUrl: url,
      type: 'direct',
      filename,
      headers,
      outputDir,
      threads: threads || 8,
    });

    taskManager.markActive(task.id);
    await aria2.addDownload(task);

    res.json({ taskId: task.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/cancel/:id', (req, res) => {
  taskManager.cancelTask(req.params.id);
  res.json({ ok: true });
});

router.post('/pause/:id', (req, res) => {
  taskManager.pauseTask(req.params.id);
  res.json({ ok: true });
});

router.post('/resume/:id', (req, res) => {
  taskManager.resumeTask(req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  taskManager.removeTask(req.params.id);
  res.json({ ok: true });
});

// Clear all finished tasks (completed, cancelled, error)
router.post('/clear-finished', (req, res) => {
  const removed = taskManager.clearFinished();
  res.json({ ok: true, removed });
});

router.get('/tasks', (req, res) => {
  res.json(taskManager.getAllTasks());
});

router.post('/info', async (req, res) => {
  try {
    const { url } = req.body;
    const info = await ytdlp.getInfo(url);
    res.json({
      title: info.title,
      thumbnail: info.thumbnail,
      duration: info.duration,
      formats: (info.formats || []).filter(f => f.vcodec !== 'none' || f.acodec !== 'none').map(f => ({
        id: f.format_id,
        ext: f.ext,
        resolution: f.resolution || `${f.width || '?'}x${f.height || '?'}`,
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

export default router;

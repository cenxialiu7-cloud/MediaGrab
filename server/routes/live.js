import { Router } from 'express';
import { taskManager } from '../utils/taskManager.js';
import * as streamlink from '../services/streamlink.js';
import * as playwright from '../services/playwright.js';
import { probeUrl } from '../services/probe.js';

const router = Router();

/**
 * POST /api/live/record
 *
 * Records a live stream. Picks the right tool automatically:
 *   - Twitch       → Streamlink (best in 2026 — auto ad-filtering)
 *   - YouTube/FB/  → yt-dlp --live-from-start --hls-use-mpegts
 *   - raw .m3u8    → ffmpeg direct
 *   - others       → tries yt-dlp first, falls back to playwright m3u8 extraction
 */
router.post('/record', async (req, res) => {
  try {
    const { url, quality, duration, outputDir, title } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    // Pre-flight probe: classify URL and decide which recorder to use
    let probe;
    try {
      probe = await probeUrl(url);
    } catch (err) {
      // Probe failed entirely — let user know
      return res.status(400).json({ error: `URL 探測失敗: ${err.message}` });
    }

    // Friendly errors for non-live URLs so we don't waste time
    if (probe.kind === 'upcoming') {
      return res.status(400).json({
        error: '此直播尚未開始',
        scheduledAt: probe.scheduledAt,
        suggestion: probe.scheduledAt
          ? `預計開始時間: ${new Date(probe.scheduledAt * 1000).toLocaleString('zh-TW')}`
          : '請等待直播開始後再試',
      });
    }
    if (probe.kind === 'video' || probe.kind === 'past_live') {
      return res.status(400).json({
        error: '此網址是 VOD 影片而非直播',
        suggestion: '請改用「下載」分頁',
      });
    }
    if (probe.kind === 'playlist' || probe.kind === 'channel') {
      return res.status(400).json({
        error: '此網址是播放清單 / 頻道',
        suggestion: '請改用「劇集 / 清單解析」分頁',
      });
    }
    if (probe.kind === 'aggregator') {
      return res.status(400).json({
        error: '此網站需要「劇集 / 清單解析」分頁處理',
      });
    }
    if (probe.kind === 'unknown' && !url.includes('.m3u8')) {
      return res.status(400).json({
        error: `無法解析此網址: ${probe.error || '未知格式'}`,
      });
    }

    const recorder = probe.recorder || 'yt-dlp';
    const displayTitle = title || probe.title || 'Live Recording';

    const task = taskManager.createTask({
      title: displayTitle,
      url,
      type: 'live',
      quality: quality || 'best',
      duration,
      outputDir,
      headers: probe.headers || undefined,
    });

    taskManager.markActive(task.id);

    let proc;
    if (recorder === 'streamlink') {
      proc = streamlink.recordStream(task);
    } else if (recorder === 'ffmpeg') {
      // For direct .m3u8 URLs
      task.streamUrl = url;
      proc = streamlink.recordWithFFmpeg(task);
    } else {
      proc = streamlink.recordWithYtdlp(task);
    }

    res.json({
      taskId: task.id,
      method: recorder,
      title: displayTitle,
      isLive: probe.isLive,
      extractor: probe.extractor,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/live/stop/:id
 * Gracefully stop a live recording (SIGINT → file flushed → remux to .mp4)
 */
router.post('/stop/:id', (req, res) => {
  const task = taskManager.getAllTasks().find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  // Send SIGINT first (graceful); taskManager's cancelTask will SIGTERM after timeout
  const fullTask = taskManager.tasks.get(req.params.id);
  if (fullTask) {
    streamlink.stopGracefully(fullTask);
    taskManager.updateTask(req.params.id, { status: 'merging', speed: '正在收尾錄製...' });
  }

  res.json({ ok: true });
});

/**
 * POST /api/live/stream-info — quick probe for stream metadata via streamlink
 */
router.post('/stream-info', async (req, res) => {
  try {
    const { url } = req.body;
    const info = await streamlink.getStreamInfo(url);
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

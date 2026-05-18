import { Router } from 'express';
import { taskManager } from '../utils/taskManager.js';
import * as streamlink from '../services/streamlink.js';
import * as playwright from '../services/playwright.js';

const router = Router();

router.post('/record', async (req, res) => {
  try {
    const { url, quality, duration, outputDir, title } = req.body;

    if (!url) return res.status(400).json({ error: 'URL is required' });

    const isStreamlinkSupported = await checkStreamlinkSupport(url);

    if (isStreamlinkSupported) {
      const task = taskManager.createTask({
        title: title || 'Live Recording',
        url,
        type: 'live',
        quality: quality || 'best',
        duration,
        outputDir,
        startFn: (t) => streamlink.recordStream(t),
      });

      taskManager.markActive(task.id);
      streamlink.recordStream(task);

      return res.json({ taskId: task.id, method: 'streamlink' });
    }

    const m3u8Result = await playwright.extractM3u8(url);

    if (m3u8Result.m3u8.length > 0) {
      const task = taskManager.createTask({
        title: title || 'Live Recording',
        url,
        streamUrl: m3u8Result.m3u8[0],
        type: 'live',
        duration,
        outputDir,
        startFn: (t) => streamlink.recordWithFFmpeg(t),
      });

      taskManager.markActive(task.id);
      streamlink.recordWithFFmpeg(task);

      return res.json({ taskId: task.id, method: 'ffmpeg' });
    }

    res.status(400).json({
      error: 'Could not find a recordable stream',
      suggestion: 'Try using the browser recording feature for WebRTC streams'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/stop/:id', (req, res) => {
  taskManager.cancelTask(req.params.id);
  res.json({ ok: true });
});

router.post('/stream-info', async (req, res) => {
  try {
    const { url } = req.body;
    const info = await streamlink.getStreamInfo(url);
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function checkStreamlinkSupport(url) {
  try {
    await streamlink.getStreamInfo(url);
    return true;
  } catch {
    return false;
  }
}

export default router;

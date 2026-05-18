import { Router } from 'express';
import * as playwright from '../services/playwright.js';
import * as flaresolverr from '../services/flaresolverr.js';
import * as ytdlp from '../services/ytdlp.js';

const router = Router();

// List videos in a YouTube playlist or channel
router.post('/youtube-list', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const result = await ytdlp.listYoutubeVideos(url);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/streaming', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    let result;
    try {
      result = await playwright.parseStreamingSite(url);
    } catch (err) {
      const flareAvailable = await flaresolverr.isAvailable();
      if (flareAvailable) {
        try {
          const solution = await flaresolverr.solveChallenge(url);
          result = await playwright.parseStreamingSite(url);
        } catch (flareErr) {
          throw new Error(`Both direct and FlareSolverr attempts failed: ${err.message}`);
        }
      } else {
        throw err;
      }
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/extract-m3u8', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const result = await playwright.extractM3u8(url);

    if (result.m3u8.length === 0 && result.mp4.length === 0) {
      return res.status(404).json({
        error: 'No video streams found',
        suggestion: 'The site may require login or have stronger protection'
      });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/batch-extract', async (req, res) => {
  try {
    const { episodes } = req.body;
    if (!episodes || !Array.isArray(episodes)) {
      return res.status(400).json({ error: 'episodes array is required' });
    }

    const results = [];
    for (const ep of episodes) {
      try {
        const result = await playwright.extractM3u8(ep.url);
        results.push({
          title: ep.title,
          url: ep.url,
          episodeUrl: ep.url,        // store episode page URL for lazy re-extraction
          m3u8: result.m3u8[0] || null,
          mp4: result.mp4[0] || null,
          allStreams: result.all,
          headers: result.headers || {},
          success: result.all.length > 0,
        });
      } catch (err) {
        results.push({
          title: ep.title,
          url: ep.url,
          m3u8: null,
          success: false,
          error: err.message,
        });
      }
    }

    res.json({ results, successCount: results.filter(r => r.success).length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/detect', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const urlLower = url.toLowerCase();

    const directPlatforms = [
      { pattern: /youtube\.com|youtu\.be/, name: 'YouTube', method: 'ytdlp' },
      { pattern: /facebook\.com|fb\.watch/, name: 'Facebook', method: 'ytdlp' },
      { pattern: /instagram\.com/, name: 'Instagram', method: 'ytdlp' },
      { pattern: /tiktok\.com|douyin\.com/, name: 'TikTok/Douyin', method: 'ytdlp' },
      { pattern: /twitter\.com|x\.com/, name: 'Twitter/X', method: 'ytdlp' },
      { pattern: /bilibili\.com/, name: 'Bilibili', method: 'ytdlp' },
      { pattern: /twitch\.tv/, name: 'Twitch', method: 'streamlink' },
      { pattern: /vimeo\.com/, name: 'Vimeo', method: 'ytdlp' },
      { pattern: /reddit\.com/, name: 'Reddit', method: 'ytdlp' },
      { pattern: /dailymotion\.com/, name: 'Dailymotion', method: 'ytdlp' },
    ];

    const streamingSites = [
      { pattern: /gimytv|gimy/, name: 'Gimy', method: 'streaming' },
      { pattern: /777tv|xiaoya|小鴨/, name: '小鴨影音', method: 'streaming' },
      { pattern: /dramaq|dramasq/, name: 'DramaQ', method: 'streaming' },
      { pattern: /movieffm/, name: 'MovieFFM', method: 'streaming' },
      { pattern: /bimibimi/, name: 'BiMiBiMi', method: 'streaming' },
    ];

    for (const p of directPlatforms) {
      if (p.pattern.test(urlLower)) {
        return res.json({ platform: p.name, method: p.method, supported: true });
      }
    }

    for (const s of streamingSites) {
      if (s.pattern.test(urlLower)) {
        return res.json({ platform: s.name, method: s.method, supported: true });
      }
    }

    if (urlLower.includes('.m3u8')) {
      return res.json({ platform: 'Direct M3U8', method: 'm3u8', supported: true });
    }

    res.json({ platform: 'Unknown', method: 'auto', supported: true, note: 'Will try yt-dlp first, then streaming parser' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

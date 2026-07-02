/**
 * Capture endpoint — receives media URLs captured by the companion browser
 * extension (via the native messaging host) and downloads them through the
 * normal task queue, replicating the browser's request context (referer +
 * headers incl. the live session Cookie).
 *
 * Security: token-protected (X-MediaGrab-Token). The native host reads the
 * token from ~/.mediagrab/capture-token, which web pages cannot read — so a
 * random web origin can't drive this endpoint. Server binds 127.0.0.1.
 */

import { Router } from 'express';
import { taskManager } from '../utils/taskManager.js';
import * as ytdlp from '../services/ytdlp.js';
import { getCaptureToken, isValidCaptureToken } from '../utils/captureToken.js';

const router = Router();

// Extract a Wistia 10-char hashedId from an embed/iframe/medias/config/m3u8 URL
// (or a wmediaid query param). Used to hand yt-dlp's Wistia extractor the id form.
function wistiaId(u) {
  if (typeof u !== 'string') return null;
  let m = /\/(?:iframe|medias)\/([a-z0-9]{10})(?:[./?]|$)/i.exec(u);
  if (m && /wistia/i.test(u)) return m[1];
  m = /[?&](?:wmediaid|wvideoid?|wvideo)=([a-z0-9]{10})/i.exec(u);
  return m ? m[1] : null;
}

// Generate/persist the capture token at startup (not lazily) so the native
// messaging host can read ~/.mediagrab/capture-token as soon as the app runs.
getCaptureToken();

// Token gate for every route in this module.
router.use((req, res, next) => {
  if (!isValidCaptureToken(req.get('X-MediaGrab-Token'))) {
    return res.status(403).json({ error: 'invalid or missing capture token' });
  }
  next();
});

/**
 * POST /api/capture/download
 * body: {
 *   manifestUrl?  : string   — preferred: a master.json / .m3u8 / .mpd the worker fetched
 *   segmentUrls?  : string[] — fallback when no single manifest is available
 *   mediaType?    : 'hls' | 'dash' | 'vimeo-v2' | 'mp4'
 *   headers?      : { Referer, Cookie, 'User-Agent', ... }  — captured request headers
 *   referer?      : string
 *   title?        : string
 *   outputDir?    : string
 * }
 */
router.post('/download', (req, res) => {
  const { manifestUrl, segmentUrls, mediaType, headers, referer, title, outputDir, pageUrl } = req.body || {};

  const hasManifest = typeof manifestUrl === 'string' && /^https?:\/\//i.test(manifestUrl);
  const hasSegments = Array.isArray(segmentUrls) && segmentUrls.length > 0;
  if (!hasManifest && !hasSegments) {
    return res.status(400).json({ error: 'manifestUrl or segmentUrls is required' });
  }

  // Preferred path: hand the captured manifest to yt-dlp with the browser's
  // request context. yt-dlp handles HLS (.m3u8), DASH (.mpd) and Vimeo
  // master.json — so a single path covers the common cases.
  if (hasManifest) {
    const reqHeaders = headers && typeof headers === 'object' ? headers : {};
    let dlUrl = manifestUrl;
    let dlReferer = referer || reqHeaders.Referer || reqHeaders.referer || '';

    // Wistia (Teachable/Thinkific/Kajabi/Podia course video): normalize to the
    // id form yt-dlp's Wistia extractor accepts (NOT the .json), and force the
    // lesson page as Referer — Wistia enforces domain restriction on the TOP
    // page's referer, but the captured request's Referer is the wistia iframe.
    const wid = wistiaId(manifestUrl);
    if (wid) {
      if (!/\.m3u8(\?|$)/i.test(manifestUrl)) dlUrl = `https://fast.wistia.com/embed/medias/${wid}`;
      if (pageUrl && /^https?:\/\//i.test(pageUrl) && !/[\r\n]/.test(pageUrl)) dlReferer = pageUrl;
    }

    const task = taskManager.createTask({
      title: title || 'Captured Video',
      url: dlUrl,
      type: 'capture',
      mediaType: mediaType || 'manifest',
      useCapturedHeaders: true,
      headers: reqHeaders,
      referer: dlReferer,
      outputDir: outputDir || undefined,
      startFn: (t) => ytdlp.startDownload(t),
    });

    if (taskManager.canStartNext()) {
      taskManager.markActive(task.id);
      ytdlp.startDownload(task);
    }
    return res.json({ taskId: task.id, engine: 'yt-dlp', via: 'manifest' });
  }

  // Segment-only fallback is genuinely hard for per-range signed formats
  // (e.g. Vimeo v2 range/prot). Fail loudly rather than produce a broken file.
  return res.status(501).json({
    error: 'segment-only reassembly is not implemented yet',
    hint: 'capture the manifest (master.json / .m3u8 / .mpd) — the extension prefers it automatically',
    segmentCount: segmentUrls.length,
  });
});

export default router;

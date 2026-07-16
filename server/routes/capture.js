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
import fs from 'fs';
import os from 'os';
import path from 'path';
import { taskManager } from '../utils/taskManager.js';
import * as ytdlp from '../services/ytdlp.js';
import { getCaptureToken, isValidCaptureToken } from '../utils/captureToken.js';

const router = Router();

// A .mp4 URL that looks like an HLS/DASH fragment rather than a whole file.
const SEGMENT_HINT = /(?:^|\/)(?:seg|frag|chunk|init)[-_.]?\d*|[_-]seg\d|\/range\/|\.m4s(\?|$)|_\d{2,}\.mp4(\?|$)/i;

// Synthesize a minimal VOD m3u8 from an ordered list of ABSOLUTE .ts segment
// URLs (segment-only capture, no manifest). yt-dlp reads a local .m3u8 whose
// segment lines are absolute URLs and downloads them with the captured headers.
// Returns the temp file path.
function writeSynthPlaylist(segs) {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:10', '#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-PLAYLIST-TYPE:VOD'];
  for (const s of segs) { lines.push('#EXTINF:10.0,'); lines.push(s); }
  lines.push('#EXT-X-ENDLIST');
  const file = path.join(os.tmpdir(), `mg-synth-${Date.now()}-${Math.floor(Math.random() * 1e6)}.m3u8`);
  fs.writeFileSync(file, lines.join('\n'));
  return file;
}

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
  const reqHeaders = headers && typeof headers === 'object' ? headers : {};

  const hasManifest = typeof manifestUrl === 'string' && /^https?:\/\//i.test(manifestUrl);
  const segs = Array.isArray(segmentUrls)
    ? segmentUrls.filter(u => typeof u === 'string' && /^https?:\/\//i.test(u))
    : [];
  if (!hasManifest && segs.length === 0) {
    return res.status(400).json({ error: 'manifestUrl or segmentUrls is required' });
  }

  // Decide what to actually hand yt-dlp:
  //   1. a real manifest (preferred — HLS/DASH/Vimeo master.json)
  //   2. a progressive .mp4 captured as a "segment" → download it directly
  //   3. ≥2 plain .ts media segments (no manifest) → synthesize a local m3u8
  let dlUrl = null, via = null, synthFile = null;
  if (hasManifest) {
    dlUrl = manifestUrl; via = 'manifest';
  } else {
    const mp4 = segs.find(u => /\.mp4(\?|$)/i.test(u) && !SEGMENT_HINT.test(u));
    if (mp4) {
      dlUrl = mp4; via = 'progressive-mp4';
    } else {
      const tsSegs = segs.filter(u => /\.(ts|aac)(\?|$)/i.test(u));
      if (tsSegs.length >= 2) {
        try { synthFile = writeSynthPlaylist(tsSegs); dlUrl = 'file://' + synthFile; via = 'synth-hls'; } catch {}
      }
    }
  }

  if (!dlUrl) {
    // Only per-range signed fragments (e.g. Vimeo v2 range/prot) or fMP4 without
    // an init segment reach here — reassembly would produce a broken file.
    return res.status(501).json({
      error: '只擷取到片段、無法安全重組（缺少播放清單或初始化段）。請改用有 manifest 的播放器，或用擴充的「錄製模式」下載。',
      hint: 'the extension prefers a manifest (master.json / .m3u8 / .mpd) automatically',
      segmentCount: segs.length,
    });
  }

  let dlReferer = referer || reqHeaders.Referer || reqHeaders.referer || '';

  // Wistia (Teachable/Thinkific/Kajabi/Podia course video): normalize to the id
  // form yt-dlp's Wistia extractor accepts (NOT the .json), and force the lesson
  // page as Referer — Wistia enforces domain restriction on the TOP page's
  // referer, but the captured request's Referer is the wistia iframe.
  if (via === 'manifest') {
    const wid = wistiaId(manifestUrl);
    if (wid) {
      if (!/\.m3u8(\?|$)/i.test(manifestUrl)) dlUrl = `https://fast.wistia.com/embed/medias/${wid}`;
      if (pageUrl && /^https?:\/\//i.test(pageUrl) && !/[\r\n]/.test(pageUrl)) dlReferer = pageUrl;
    }
  }

  const task = taskManager.createTask({
    title: title || 'Captured Video',
    // Name the output file after the source lesson/page title (the extension
    // sends the sanitized <title>), instead of yt-dlp's media-id default.
    pageTitle: (typeof title === 'string' && title.trim()) ? title.trim() : undefined,
    url: dlUrl,
    type: 'capture',
    mediaType: mediaType || via,
    useCapturedHeaders: true,
    headers: reqHeaders,
    referer: dlReferer,
    outputDir: outputDir || undefined,
    synthFile,   // temp playlist to clean up after the task ends
    startFn: (t) => ytdlp.startDownload(t),
  });

  if (taskManager.canStartNext()) {
    taskManager.markActive(task.id);
    ytdlp.startDownload(task);
  }
  return res.json({ taskId: task.id, engine: 'yt-dlp', via });
});

export default router;

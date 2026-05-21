/**
 * Universal URL probe — classifies any pasted URL into a kind + recommended action.
 *
 * Strategy:
 *   1. Domain-list match for known streaming aggregators (Gimy, 777tv, etc.) → Playwright parser
 *   2. yt-dlp -J --flat-playlist probe for everything else
 *   3. Classify result based on yt-dlp's metadata fields:
 *        - `is_live` / `live_status` → live or upcoming or past_live
 *        - `_type === 'playlist'` + entries → playlist or channel
 *        - else → single video
 *   4. Pick recommended recorder/downloader based on extractor:
 *        - twitch:* → streamlink
 *        - youtube live, fb live, etc. → yt-dlp
 *        - direct .m3u8 → ffmpeg
 *
 * Public API:
 *   probeUrl(url) → { kind, title, ..., recommendedAction, recorder, ... }
 */

import { spawn } from 'child_process';

// ────────────────────────────────────────────────────────────────────────────
// Aggregator domain list — these sites need Playwright, not yt-dlp
// ────────────────────────────────────────────────────────────────────────────
const AGGREGATOR_DOMAINS = [
  // Gimy family
  /(^|\.)gimy(ai|tv|plus)?\.(tw|ai|com|net|bot)$/,
  /(^|\.)gimy\.cc$/,
  // 小鴨 family
  /(^|\.)777tv\.(ai|tv|cc|com|net)$/,
  /(^|\.)xiaoya?\d*\.(com|net|tv)$/,
  // Other common Chinese streaming aggregators
  /(^|\.)dramaq(la)?\.(com|net|tv)$/,
  /(^|\.)dramasq\.(com|net|tv)$/,
  /(^|\.)movieffm\.(net|com|tv)$/,
  /(^|\.)bimibimi\.(net|tv|com)$/,
  /(^|\.)8maple\.(tv|ru|com)$/,
  /(^|\.)iyf\.(tv|com)$/,
];

function isAggregator(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return AGGREGATOR_DOMAINS.some(re => re.test(host));
  } catch {
    return false;
  }
}

// Single-video streaming sites that yt-dlp doesn't support but whose page
// embeds a real HLS stream we can extract via Playwright. Unlike aggregators
// (which list episodes/routes), these are one video per page → download directly.
const SINGLE_VIDEO_SITES = [
  /(^|\.)missav\.(ws|com|to|ai|tv)$/,
  /(^|\.)missav\d*\.(ws|com|to)$/,
  /(^|\.)njav\.(tv|com)$/,
  /(^|\.)supjav\.(com|tv)$/,
];

function isSingleVideoSite(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return SINGLE_VIDEO_SITES.some(re => re.test(host));
  } catch {
    return false;
  }
}

function isDirectMediaUrl(url) {
  return /\.(m3u8|mp4|webm|mov|mkv|flv|ts)(\?|$)/i.test(url);
}

// ────────────────────────────────────────────────────────────────────────────
// Run yt-dlp -J (dump single JSON) — single-shot probe
// ────────────────────────────────────────────────────────────────────────────
function ytdlpProbe(url, { flatPlaylist = true, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      '-J',                  // --dump-single-json
      '--no-warnings',
      '--skip-download',
      '--socket-timeout', '10',
      '--extractor-retries', '1',
    ];
    if (flatPlaylist) args.push('--flat-playlist');
    args.push(url);

    const proc = spawn('yt-dlp', args);
    let out = '';
    let err = '';
    let timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch {}
      reject(new Error('Probe timed out (15s)'));
    }, timeoutMs);

    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => err += d);
    proc.on('error', e => { clearTimeout(timer); reject(e); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 || !out.trim()) {
        // Pull the last informative error line
        const lastErr = err.split('\n').filter(l => l.trim() && !l.startsWith('WARNING')).pop();
        return reject(new Error(lastErr || `yt-dlp exited with code ${code}`));
      }
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        reject(new Error(`Failed to parse yt-dlp JSON: ${e.message}`));
      }
    });
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Classify yt-dlp JSON output into our normalized shape
// ────────────────────────────────────────────────────────────────────────────
function classifyYtdlp(data, originalUrl) {
  const extractor = data.extractor || data.extractor_key || '';
  const liveStatus = data.live_status;
  const isLive = data.is_live === true || liveStatus === 'is_live';

  // Pick recorder based on extractor family.
  // yt-dlp handles Twitch live well in 2026, so we no longer require the
  // separate streamlink binary (which can't be cleanly bundled on macOS).
  let recorder = 'yt-dlp';
  if (isDirectMediaUrl(originalUrl)) recorder = 'ffmpeg';

  const baseResult = {
    url: originalUrl,
    title: data.title || data.id || 'Untitled',
    thumbnail: data.thumbnail || null,
    uploader: data.uploader || data.channel || data.uploader_id || null,
    duration: data.duration || null,
    extractor,
    raw: { id: data.id, webpage_url: data.webpage_url },
  };

  // Live stream
  if (isLive) {
    return {
      ...baseResult,
      kind: 'live',
      isLive: true,
      liveStatus: liveStatus || 'is_live',
      recommendedAction: 'record',
      recorder,
    };
  }

  // Upcoming / scheduled
  if (liveStatus === 'is_upcoming') {
    return {
      ...baseResult,
      kind: 'upcoming',
      isLive: false,
      liveStatus,
      scheduledAt: data.release_timestamp || null,
      recommendedAction: 'wait_for_start',
      recorder,
    };
  }

  // Past live — completed live, now VOD
  if (liveStatus === 'was_live') {
    return {
      ...baseResult,
      kind: 'past_live',
      isLive: false,
      liveStatus,
      recommendedAction: 'download',
      recorder: 'yt-dlp',
    };
  }

  // Playlist / channel
  if (data._type === 'playlist' && Array.isArray(data.entries) && data.entries.length > 0) {
    const isChannel = /channel|user|home$/i.test(extractor) || /youtube:tab/i.test(extractor);
    return {
      ...baseResult,
      kind: isChannel ? 'channel' : 'playlist',
      isLive: false,
      entries: data.entries.map(e => ({
        id: e.id,
        title: e.title || e.id,
        url: e.url || (e.id ? `https://www.youtube.com/watch?v=${e.id}` : null),
        duration: e.duration || 0,
        uploader: e.uploader || e.channel,
      })).filter(e => e.url),
      recommendedAction: 'select_episodes',
      recorder: 'yt-dlp',
    };
  }

  // Single video (VOD)
  return {
    ...baseResult,
    kind: 'video',
    isLive: false,
    liveStatus: liveStatus || 'not_live',
    recommendedAction: 'download',
    recorder: 'yt-dlp',
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Main entry: probe a URL → normalized ProbeResult
// ────────────────────────────────────────────────────────────────────────────
export async function probeUrl(rawUrl) {
  const url = (rawUrl || '').trim();
  if (!url) throw new Error('URL is required');

  // Streaming aggregator — don't even try yt-dlp, defer to Playwright parser
  if (isAggregator(url)) {
    return {
      url,
      kind: 'aggregator',
      isLive: false,
      recommendedAction: 'parse_aggregator',
      recorder: null,
      title: '影集網站 / 串流站',
      hint: '此網站需要透過劇集解析功能來抓取播放線路與集數',
    };
  }

  // Single-video streaming site (e.g. missav) — yt-dlp can't, but the page
  // embeds an HLS stream we extract via Playwright. One video → download directly.
  if (isSingleVideoSite(url)) {
    return {
      url,
      episodeUrl: url,                  // m3u8 service will lazy-extract from this page
      kind: 'stream_video',
      isLive: false,
      recommendedAction: 'download_stream',
      recorder: 'm3u8',
      title: url.split('/').filter(Boolean).pop() || 'Video',
      hint: '此頁面的影片串流會即時解析後下載',
    };
  }

  // Direct media URL (raw .m3u8 / .mp4 etc.)
  if (isDirectMediaUrl(url)) {
    return {
      url,
      kind: url.includes('.m3u8') ? 'direct_stream' : 'direct_media',
      isLive: false, // we can't tell without fetching the manifest
      recommendedAction: url.includes('.m3u8') ? 'record' : 'download',
      recorder: 'ffmpeg',
      title: url.split('/').pop().split('?')[0] || 'Direct Stream',
    };
  }

  // yt-dlp probe for everything else
  try {
    const data = await ytdlpProbe(url, { flatPlaylist: true, timeoutMs: 15000 });
    return classifyYtdlp(data, url);
  } catch (err) {
    // yt-dlp couldn't handle it — return unknown so frontend can offer fallback
    return {
      url,
      kind: 'unknown',
      isLive: false,
      recommendedAction: 'try_anyway',
      recorder: null,
      title: '無法解析',
      error: err.message,
      hint: 'yt-dlp 無法識別此網址，可嘗試「劇集解析」分頁或直接下載',
    };
  }
}

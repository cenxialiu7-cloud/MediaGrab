import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { taskManager } from '../utils/taskManager.js';
import { extractM3u8, fetchInBrowserContext } from './playwright.js';

const DEFAULT_OUTPUT = path.join(os.homedir(), 'Downloads', 'MediaGrab');
const TEMP_DIR = path.join(os.tmpdir(), 'mediagrab-temp');

export async function downloadM3u8(task) {
  const outputDir = task.outputDir || DEFAULT_OUTPUT;
  fs.mkdirSync(outputDir, { recursive: true });

  const filename = task.filename || `${task.title || 'video'}.mp4`;
  const outputPath = path.join(outputDir, filename);

  try {
    // Lazy extraction: if we have an episode page URL, extract m3u8 fresh at download time.
    // This avoids expired single-use signed URLs AND skips slow pre-extraction step.
    if (task.episodeUrl && (!task.m3u8Url || !task.skipRefresh)) {
      const isFirstExtract = !task.m3u8Url;
      taskManager.updateTask(task.id, {
        speed: isFirstExtract ? 'Extracting stream URL...' : 'Refreshing stream URL...',
        progress: 0,
      });
      try {
        const fresh = await extractM3u8(task.episodeUrl);
        if (fresh.m3u8 && fresh.m3u8.length > 0) {
          task.m3u8Url = fresh.m3u8[0];
          task.headers = fresh.headers;
        }
      } catch (err) {
        if (!task.m3u8Url) {
          taskManager.failTask(task.id, `Extraction failed: ${err.message}`);
          return;
        }
      }
    }

    if (!task.m3u8Url) {
      taskManager.failTask(task.id, 'No m3u8 URL available');
      return;
    }

    return await downloadSmart(task, outputPath);
  } catch (err) {
    taskManager.failTask(task.id, err.message);
  }
}

/**
 * Fetch a URL trying multiple Referer strategies on 403.
 * Some CDNs reject long Referer values with query strings (anti-bot rule).
 * Tries: captured Referer → Referer origin only → playable page → empty → no Referer.
 * Returns { res, headers } where headers is the set that actually worked (to reuse for segments).
 */
async function fetchWithRefererFallback(url, headers, task) {
  const original = headers.Referer || '';
  const refererVariants = [];

  // 1) Original captured Referer
  refererVariants.push(original);

  // 2) Just the origin (e.g. https://player.gimy.bot/) — strip path/query
  if (original) {
    try {
      const u = new URL(original);
      const originOnly = u.origin + '/';
      if (originOnly !== original) refererVariants.push(originOnly);
    } catch {}
  }

  // 3) The episode page URL (if available)
  if (task && task.episodeUrl && task.episodeUrl !== original) {
    refererVariants.push(task.episodeUrl);
  }

  // 4) Origin of m3u8 URL itself
  try {
    const m3u8Origin = new URL(url).origin + '/';
    if (!refererVariants.includes(m3u8Origin)) refererVariants.push(m3u8Origin);
  } catch {}

  // 5) Empty / no Referer
  refererVariants.push('');

  let lastRes = null;
  let lastError = null;
  for (const ref of refererVariants) {
    const tryHeaders = { ...headers };
    if (ref) tryHeaders.Referer = ref;
    else delete tryHeaders.Referer;

    try {
      const res = await fetchInBrowserContext(url, tryHeaders);
      lastRes = res;
      if (res.status === 200) {
        return { res, headers: tryHeaders };
      }
      // Any 2xx is acceptable
      if (res.status >= 200 && res.status < 300) {
        return { res, headers: tryHeaders };
      }
    } catch (err) {
      lastError = err;
    }
  }
  return lastRes ? { res: lastRes, headers } : (lastError ? { error: lastError } : null);
}

async function downloadSmart(task, outputPath) {
  // Step 1: Fetch m3u8 using Playwright's browser context (shares TLS/cookies/IP)
  // Try multiple Referer strategies on 403 — some CDNs block long query-string referers.
  taskManager.updateTask(task.id, { speed: 'Loading playlist...' });

  let m3u8Content;
  let m3u8BaseUrl;
  let workingHeaders = null;
  try {
    const fetchRes = await fetchWithRefererFallback(task.m3u8Url, task.headers || {}, task);
    if (!fetchRes || !fetchRes.res || fetchRes.res.status !== 200) {
      const status = fetchRes && fetchRes.res ? fetchRes.res.status : null;
      const errMsg = fetchRes && fetchRes.error ? fetchRes.error.message : null;
      // Re-extract once if URL truly expired and we haven't tried yet
      if ((status === 403 || status === 404) && task.episodeUrl && !task._retried) {
        task._retried = true;
        taskManager.updateTask(task.id, { speed: 'URL expired, re-extracting...' });
        const fresh = await extractM3u8(task.episodeUrl);
        if (fresh.m3u8 && fresh.m3u8.length > 0) {
          task.m3u8Url = fresh.m3u8[0];
          task.headers = fresh.headers;
          return downloadSmart(task, outputPath);
        }
      }
      const desc = status ? `HTTP ${status}` : (errMsg || 'no response');
      throw new Error(`Failed to fetch m3u8: ${desc}`);
    }
    m3u8Content = fetchRes.res.body;
    m3u8BaseUrl = task.m3u8Url;
    workingHeaders = fetchRes.headers;  // Save the headers that actually worked
    // Update task.headers so segment downloads use the same working Referer
    task.headers = workingHeaders;
  } catch (err) {
    taskManager.failTask(task.id, `Playlist fetch failed: ${err.message}`);
    return;
  }

  // Step 2: Parse m3u8 — handle master playlists by following the first variant
  const parsed = parseM3u8(m3u8Content, m3u8BaseUrl);

  if (parsed.isMaster) {
    // Master playlist — follow the highest quality variant
    const variant = parsed.variants[0];
    if (!variant) {
      taskManager.failTask(task.id, 'No variants found in master playlist');
      return;
    }
    task.m3u8Url = variant.url;
    return downloadSmart(task, outputPath);
  }

  if (parsed.segments.length === 0) {
    taskManager.failTask(task.id, 'No segments found in playlist');
    return;
  }

  // Step 3: Download segments with PNG/wrapper handling
  return await downloadSegments(task, outputPath, parsed);
}

// Parse a BYTERANGE attribute value ("length[@offset]"). When the offset is
// omitted, HLS says it continues immediately after the previous sub-range of
// the same resource (tracked via prevEndByUrl).
function parseByteRange(spec, url, prevEndByUrl) {
  const m = /^(\d+)(?:@(\d+))?/.exec(spec.trim());
  if (!m) return null;
  const length = parseInt(m[1], 10);
  const start = m[2] != null ? parseInt(m[2], 10) : (prevEndByUrl.get(url) || 0);
  const end = start + length - 1;   // inclusive (HTTP Range is inclusive)
  prevEndByUrl.set(url, end + 1);
  return { start, end, length };
}

function parseM3u8(content, baseUrl) {
  const lines = content.split('\n').map(l => l.trim());
  const result = {
    isMaster: false,
    variants: [],
    segments: [],        // { url, range: {start,end,length}|null }
    initSegment: null,   // fMP4 #EXT-X-MAP → { url, range|null }
    isFmp4: false,
    encryption: null,
  };

  const base = new URL(baseUrl);
  const prevEndByUrl = new Map();   // url → next byte offset (for offset-less ranges)
  let pendingRange = null;          // range from a preceding #EXT-X-BYTERANGE line

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    if (line.startsWith('#EXT-X-STREAM-INF')) {
      result.isMaster = true;
      const next = lines[i + 1];
      if (next && !next.startsWith('#')) {
        const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
        result.variants.push({
          url: resolveUrl(next, base),
          bandwidth: bandwidthMatch ? parseInt(bandwidthMatch[1]) : 0,
        });
      }
    } else if (line.startsWith('#EXT-X-MAP')) {
      // fMP4 initialization segment (contains moov). Required to play CMAF.
      const uriMatch = line.match(/URI="([^"]+)"/);
      const brMatch = line.match(/BYTERANGE="([^"]+)"/);
      if (uriMatch) {
        const url = resolveUrl(uriMatch[1], base);
        result.initSegment = { url, range: brMatch ? parseByteRange(brMatch[1], url, prevEndByUrl) : null };
      }
    } else if (line.startsWith('#EXT-X-BYTERANGE')) {
      const spec = line.slice(line.indexOf(':') + 1);
      // Resolved against the *next* media line's URL — stash and apply below.
      pendingRange = spec;
    } else if (line.startsWith('#EXT-X-KEY')) {
      const methodMatch = line.match(/METHOD=([^,]+)/);
      const uriMatch = line.match(/URI="([^"]+)"/);
      const ivMatch = line.match(/IV=0x([0-9A-Fa-f]+)/);
      if (methodMatch && methodMatch[1] !== 'NONE') {
        result.encryption = {
          method: methodMatch[1],
          keyUri: uriMatch ? resolveUrl(uriMatch[1], base) : null,
          iv: ivMatch ? ivMatch[1] : null,
        };
      }
    } else if (!line.startsWith('#') && line.length > 0) {
      const url = resolveUrl(line, base);
      const range = pendingRange ? parseByteRange(pendingRange, url, prevEndByUrl) : null;
      pendingRange = null;
      result.segments.push({ url, range });
    }
  }

  // Treat as fMP4/CMAF (binary-concat path) only when there's an init segment
  // or byte-range segments — NOT merely because segments are .mp4. A playlist
  // of whole .mp4 files must still go through the ffmpeg concat demuxer.
  result.isFmp4 = !!result.initSegment || result.segments.some(s => s.range);

  // Sort variants by bandwidth (highest first)
  result.variants.sort((a, b) => b.bandwidth - a.bandwidth);

  return result;
}

function resolveUrl(url, base) {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

async function downloadSegments(task, outputPath, parsed) {
  const segments = parsed.segments;
  const encryption = parsed.encryption;
  const isFmp4 = parsed.isFmp4;
  const initSegment = parsed.initSegment;

  const taskDir = path.join(TEMP_DIR, task.id);
  fs.mkdirSync(taskDir, { recursive: true });

  const totalSegments = segments.length;
  const headers = task.headers || {};
  const concurrency = task.threads || 8;
  const tsFiles = new Array(totalSegments);
  const ext = isFmp4 ? 'm4s' : 'ts';
  let downloadedBytes = 0;
  let completedCount = 0;
  let lastSpeedUpdate = Date.now();
  let bytesSinceLastUpdate = 0;
  let failedSegments = [];

  // Encryption key (if HLS AES-128 is used)
  let aesKey = null;
  if (encryption && encryption.method === 'AES-128' && encryption.keyUri) {
    try {
      const keyRes = await fetchInBrowserContext(encryption.keyUri, headers);
      aesKey = keyRes.bodyBuffer;
    } catch (err) {
      taskManager.failTask(task.id, `Key fetch failed: ${err.message}`);
      return;
    }
  }

  // Build the per-request header set for a segment, adding a byte-range header
  // for fMP4/CMAF playlists that pack multiple segments into one resource.
  const headersFor = (range) => {
    if (!range) return headers;
    return { ...headers, Range: `bytes=${range.start}-${range.end}` };
  };

  // Fetch one media part (init segment or media segment) into a Buffer.
  const fetchPart = async (url, range) => {
    const h = headersFor(range);
    let res = await fetchInBrowserContext(url, h);
    if (res.status === 403 || res.status === 404) {
      const fallback = await fetchWithRefererFallback(url, h, task);
      if (fallback && fallback.res && fallback.res.status >= 200 && fallback.res.status < 300) {
        res = fallback.res;
        Object.assign(headers, fallback.headers);
      }
    }
    // 206 Partial Content is the expected success for ranged requests.
    if (res.status !== 200 && res.status !== 206) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.bodyBuffer;
  };

  // Download the fMP4 initialization segment once — it carries the moov box
  // without which the concatenated fragments are unplayable.
  let initFile = null;
  if (isFmp4 && initSegment) {
    try {
      const buf = await fetchPart(initSegment.url, initSegment.range);
      initFile = path.join(taskDir, 'init.mp4');
      fs.writeFileSync(initFile, buf);
      downloadedBytes += buf.length;
    } catch (err) {
      taskManager.failTask(task.id, `Init segment fetch failed: ${err.message}`);
      return;
    }
  }

  // Process segments with concurrency
  const downloadOne = async (idx, seg, retries = 2) => {
    const tsPath = path.join(taskDir, `seg_${String(idx).padStart(6, '0')}.${ext}`);

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (task.status === 'cancelled') return false;

      try {
        let buffer = await fetchPart(seg.url, seg.range);

        // AES-128 decryption
        if (aesKey) {
          buffer = await decryptAES128(buffer, aesKey, encryption.iv, idx);
        }

        // TS streams are sometimes wrapped in a fake image header; fMP4
        // fragments are raw and must not be touched.
        const tsData = isFmp4 ? buffer : stripImageWrapper(buffer);

        fs.writeFileSync(tsPath, tsData);
        tsFiles[idx] = tsPath;
        downloadedBytes += tsData.length;
        bytesSinceLastUpdate += tsData.length;
        completedCount++;
        return true;
      } catch (err) {
        if (attempt === retries) {
          failedSegments.push({ idx, url: seg.url, status: err.status, error: err.message });
          return false;
        }
        await sleep(500 * (attempt + 1));
      }
    }
    return false;
  };

  // Concurrency pool
  let nextIdx = 0;
  const workers = [];
  const updateProgress = setInterval(() => {
    const now = Date.now();
    const elapsed = (now - lastSpeedUpdate) / 1000;
    if (elapsed > 0.5) {
      const speed = bytesSinceLastUpdate / elapsed;
      const speedStr = formatSpeed(speed);
      const progress = Math.min(95, (completedCount / totalSegments) * 95);
      const totalMb = (downloadedBytes / (1024 * 1024)).toFixed(1);
      const remaining = totalSegments - completedCount;
      const etaSecs = speed > 0 && completedCount > 0
        ? Math.round(((downloadedBytes / completedCount) * remaining) / speed)
        : 0;

      taskManager.updateTask(task.id, {
        progress: Math.round(progress * 10) / 10,
        speed: speedStr,
        downloaded: `${totalMb} MB`,
        eta: formatEta(etaSecs) + ` (${completedCount}/${totalSegments} segs)`,
        threads: workers.filter(Boolean).length,
      });

      bytesSinceLastUpdate = 0;
      lastSpeedUpdate = now;
    }
  }, 500);

  const worker = async (workerIdx) => {
    workers[workerIdx] = true;
    while (true) {
      if (task.status === 'cancelled') break;
      const idx = nextIdx++;
      if (idx >= totalSegments) break;
      await downloadOne(idx, segments[idx]);
    }
    workers[workerIdx] = false;
  };

  // Start workers
  await Promise.all(
    Array.from({ length: concurrency }, (_, i) => worker(i))
  );

  clearInterval(updateProgress);

  if (task.status === 'cancelled') {
    cleanupDir(taskDir);
    return;
  }

  // Auto-retry failed segments with re-extracted URL once
  if (failedSegments.length > 0 && task.episodeUrl && !task._retriedSegments) {
    task._retriedSegments = true;
    taskManager.updateTask(task.id, {
      speed: `Retrying ${failedSegments.length} failed segments...`,
    });
    try {
      const fresh = await extractM3u8(task.episodeUrl);
      if (fresh.m3u8 && fresh.m3u8.length > 0) {
        const freshRes = await fetchInBrowserContext(fresh.m3u8[0], fresh.headers);
        const freshParsed = parseM3u8(freshRes.body, fresh.m3u8[0]);

        for (const failed of failedSegments) {
          if (freshParsed.segments[failed.idx]) {
            await downloadOne(failed.idx, freshParsed.segments[failed.idx], 1);
          }
        }
      }
    } catch {}
  }

  const validFiles = tsFiles.filter(Boolean);
  if (validFiles.length === 0) {
    cleanupDir(taskDir);
    taskManager.failTask(task.id, 'All segments failed to download');
    return;
  }

  if (validFiles.length < totalSegments) {
    console.warn(`Only ${validFiles.length}/${totalSegments} segments downloaded for task ${task.id}`);
  }

  // Concatenate and remux with FFmpeg
  taskManager.updateTask(task.id, {
    speed: 'Merging segments...',
    status: 'merging',
    progress: 96,
  });

  let proc;
  if (isFmp4) {
    // fMP4/CMAF: the init segment + fragments are contiguous parts of one
    // file, so a binary concat (init first) reconstructs a valid fragmented
    // MP4. Remux with -c copy to finalize the container (no aac_adtstoasc —
    // that bitstream filter is for MPEG-TS only).
    const mergedRaw = path.join(taskDir, 'merged.mp4');
    const ws = fs.createWriteStream(mergedRaw);
    const appendFile = (f) => new Promise((res, rej) => {
      const rs = fs.createReadStream(f);
      rs.on('error', rej); rs.on('end', res); rs.pipe(ws, { end: false });
    });
    if (initFile) await appendFile(initFile);
    for (const f of validFiles) await appendFile(f);
    await new Promise(r => ws.end(r));

    proc = spawn('ffmpeg', [
      '-i', mergedRaw,
      '-c', 'copy',
      '-movflags', '+faststart',
      '-y',
      outputPath,
    ]);
  } else {
    const concatFile = path.join(taskDir, 'concat.txt');
    fs.writeFileSync(concatFile, validFiles.map(f => `file '${f}'`).join('\n'));

    proc = spawn('ffmpeg', [
      '-f', 'concat',
      '-safe', '0',
      '-i', concatFile,
      '-c', 'copy',
      '-bsf:a', 'aac_adtstoasc',
      '-movflags', '+faststart',
      '-y',
      outputPath,
    ]);
  }

  task.process = proc;

  let ffmpegErr = '';
  proc.stderr.on('data', (d) => { ffmpegErr += d.toString(); });

  return new Promise((resolve) => {
    proc.on('close', (code) => {
      cleanupDir(taskDir);
      if (code === 0) {
        taskManager.completeTask(task.id, outputPath);
      } else if (task.status !== 'cancelled') {
        const lastErr = ffmpegErr.split('\n').filter(l => l.toLowerCase().includes('error')).pop();
        taskManager.failTask(task.id, `Merge failed: ${lastErr || `code ${code}`}`);
      }
      resolve();
    });
  });
}

// Robust wrapper stripper — finds MPEG-TS sync byte pattern (0x47 every 188 bytes)
export function stripImageWrapper(buffer) {
  // Already TS?
  if (buffer.length > 376 && buffer[0] === 0x47 && buffer[188] === 0x47 && buffer[376] === 0x47) {
    return buffer;
  }

  // Search first 8KB for TS sync pattern
  const searchLimit = Math.min(buffer.length - 376, 8192);
  for (let i = 0; i < searchLimit; i++) {
    if (buffer[i] === 0x47 && buffer[i + 188] === 0x47 && buffer[i + 376] === 0x47) {
      return buffer.subarray(i);
    }
  }

  // Fallback: known wrappers
  // PNG
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    const iendIdx = buffer.indexOf(Buffer.from('IEND'));
    if (iendIdx >= 0 && iendIdx + 8 < buffer.length) {
      return buffer.subarray(iendIdx + 8);
    }
  }
  // JPEG
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
    for (let i = 2; i < Math.min(buffer.length - 1, 4096); i++) {
      if (buffer[i] === 0xFF && buffer[i + 1] === 0xD9) {
        return buffer.subarray(i + 2);
      }
    }
  }

  return buffer;
}

async function decryptAES128(buffer, key, ivHex, segIdx) {
  const crypto = await import('crypto');
  let iv;
  if (ivHex) {
    iv = Buffer.from(ivHex, 'hex');
  } else {
    iv = Buffer.alloc(16);
    iv.writeUInt32BE(segIdx, 12);
  }
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([decipher.update(buffer), decipher.final()]);
}

function formatSpeed(bytesPerSec) {
  if (bytesPerSec >= 1048576) return `${(bytesPerSec / 1048576).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  return `${bytesPerSec.toFixed(0)} B/s`;
}

function formatEta(seconds) {
  if (!seconds || seconds <= 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

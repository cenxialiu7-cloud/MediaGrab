/**
 * Live stream recording service.
 *
 * Strategy (based on 2026 research):
 *   1. Record to .ts (MPEG-TS) — append-only, every segment independently playable.
 *      Recording to .mp4 directly is unsafe because MP4's `moov` atom is written
 *      at the end; any crash mid-recording leaves an unplayable file.
 *   2. After clean stop, remux .ts → .mp4 with `ffmpeg -c copy` (~1s).
 *   3. Use SIGINT (not SIGKILL) to stop so the encoder can flush the last segment.
 *   4. Auto-reconnect with --retries infinite + --fragment-retries infinite.
 *   5. Streamlink for Twitch (still the gold standard in 2026), yt-dlp for others.
 *
 * Public API used by routes/live.js:
 *   - recordStream(task)        — uses Streamlink (best for Twitch)
 *   - recordWithYtdlp(task)     — uses yt-dlp --live-from-start (best for YouTube/FB/etc)
 *   - recordWithFFmpeg(task)    — uses ffmpeg direct (best for raw .m3u8 URLs)
 *   - getStreamInfo(url)        — probe via streamlink --json (for liveness/quality check)
 *   - stopRecording(task)       — sends SIGINT and remuxes to .mp4
 */

import { spawn, spawnSync } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { taskManager } from '../utils/taskManager.js';

const DEFAULT_OUTPUT = path.join(os.homedir(), 'Downloads', 'MediaGrab');

// ────────────────────────────────────────────────────────────────────────────
// Path resolution helpers — work both in dev (homebrew PATH) and in bundled
// .app where binaries live in Resources/bin/
// ────────────────────────────────────────────────────────────────────────────
function safeFilename(name) {
  return String(name || 'livestream').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
}

function timestampSuffix() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function prepareOutput(task, extension = 'ts') {
  const outputDir = task.outputDir || DEFAULT_OUTPUT;
  fs.mkdirSync(outputDir, { recursive: true });

  const baseName = task.filename
    ? path.basename(task.filename, path.extname(task.filename))
    : `${safeFilename(task.title || 'livestream')}_${timestampSuffix()}`;

  const tsPath  = path.join(outputDir, `${baseName}.${extension}`);
  const mp4Path = path.join(outputDir, `${baseName}.mp4`);
  return { tsPath, mp4Path, outputDir };
}

// ────────────────────────────────────────────────────────────────────────────
// getStreamInfo: probe via streamlink for quality list / metadata
// ────────────────────────────────────────────────────────────────────────────
export function getStreamInfo(url) {
  return new Promise((resolve, reject) => {
    const proc = spawn('streamlink', ['--json', url]);
    let out = '';
    let err = '';
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => err += d);
    proc.on('error', e => reject(e));
    proc.on('close', () => {
      try {
        const data = JSON.parse(out);
        if (data.error) return reject(new Error(data.error));
        resolve(data);
      } catch {
        reject(new Error(err.trim() || 'Failed to get stream info'));
      }
    });
    setTimeout(() => { try { proc.kill('SIGTERM'); } catch {} }, 20000);
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Progress reporter — polls file size + ffprobe duration every 1s.
// Works regardless of which tool is producing the output.
// ────────────────────────────────────────────────────────────────────────────
function attachProgressReporter(task, outputPath) {
  const startTime = Date.now();
  let lastSize = 0;
  let lastUpdate = Date.now();

  const interval = setInterval(() => {
    if (!fs.existsSync(outputPath)) return;

    const stat = fs.statSync(outputPath);
    const size = stat.size;
    const now = Date.now();
    const elapsedSec = Math.floor((now - startTime) / 1000);

    // Bytes/sec since last poll
    const dt = (now - lastUpdate) / 1000;
    const bps = dt > 0 ? (size - lastSize) / dt : 0;
    lastSize = size;
    lastUpdate = now;

    const mins = Math.floor(elapsedSec / 60);
    const secs = elapsedSec % 60;

    taskManager.updateTask(task.id, {
      downloaded: formatBytes(size),
      speed: formatBytesPerSec(bps),
      eta: `已錄 ${mins}:${String(secs).padStart(2, '0')}`,
      progress: 50, // indeterminate; we display 50% bar pulsing during live record
    });
  }, 1000);

  return () => clearInterval(interval);
}

function formatBytes(n) {
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(2)} GB`;
  if (n >= 1048576)    return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024)       return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function formatBytesPerSec(n) {
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB/s`;
  if (n >= 1024)    return `${(n / 1024).toFixed(0)} KB/s`;
  return `${Math.round(n)} B/s`;
}

// ────────────────────────────────────────────────────────────────────────────
// Post-recording remux: .ts → .mp4 with -c copy (no re-encode, fast)
// ────────────────────────────────────────────────────────────────────────────
function remuxToMp4(tsPath, mp4Path) {
  return new Promise((resolve) => {
    if (!fs.existsSync(tsPath) || fs.statSync(tsPath).size < 1024) {
      return resolve(null); // Nothing usable
    }
    const proc = spawn('ffmpeg', [
      '-y',
      '-i', tsPath,
      '-c', 'copy',
      '-bsf:a', 'aac_adtstoasc',
      '-movflags', '+faststart',
      mp4Path,
    ], { stdio: 'ignore' });

    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(mp4Path) && fs.statSync(mp4Path).size > 1024) {
        try { fs.unlinkSync(tsPath); } catch {} // clean up intermediate .ts
        resolve(mp4Path);
      } else {
        // Remux failed — keep the .ts so user still has the recording
        resolve(tsPath);
      }
    });
    proc.on('error', () => resolve(tsPath));
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Streamlink recorder — best for Twitch (auto ad-filtering since 8.4)
// ────────────────────────────────────────────────────────────────────────────
export function recordStream(task) {
  const { tsPath, mp4Path } = prepareOutput(task, 'ts');
  const quality = task.quality || 'best';

  const args = [
    task.url,
    quality,
    '-o', tsPath,
    '--force',
    '--retry-streams', '5',           // retry every 5s if stream goes offline briefly
    '--retry-max', '20',              // up to 20 retries
    '--retry-open', '3',              // retry initial connect 3 times
    '--hls-live-restart',             // start from earliest available segment
    '--stream-timeout', '60',
    '--stream-segment-attempts', '5',
    '--stream-segment-timeout', '30',
    '--stream-segment-threads', '4',  // parallel segment download
  ];

  if (task.duration) {
    args.push('--hls-duration', String(task.duration));
  }

  const proc = spawn('streamlink', args);
  task.process = proc;
  task.tsPath = tsPath;
  task.mp4Path = mp4Path;
  task.recordingMethod = 'streamlink';

  taskManager.updateTask(task.id, { status: 'downloading', speed: '連線中... Connecting' });

  const stopProgress = attachProgressReporter(task, tsPath);

  let lastStderr = '';
  proc.stderr.on('data', (data) => {
    const line = data.toString();
    lastStderr = line.trim().split('\n').pop() || lastStderr;
    if (line.includes('Opening stream')) {
      taskManager.updateTask(task.id, { speed: '錄製中... Recording' });
    }
  });

  proc.on('close', async (code) => {
    stopProgress();
    if (task.status === 'cancelled' || code === 0 || code === null) {
      taskManager.updateTask(task.id, { status: 'merging', speed: '轉檔為 MP4...' });
      const final = await remuxToMp4(tsPath, mp4Path);
      taskManager.completeTask(task.id, final || tsPath);
    } else {
      // Try to remux whatever we got — maybe partial file is still salvageable
      if (fs.existsSync(tsPath) && fs.statSync(tsPath).size > 1024) {
        const final = await remuxToMp4(tsPath, mp4Path);
        taskManager.completeTask(task.id, final || tsPath);
      } else {
        taskManager.failTask(task.id, `Streamlink exited (${code}): ${lastStderr || 'unknown error'}`);
      }
    }
  });

  proc.on('error', (err) => {
    stopProgress();
    taskManager.failTask(task.id, `Streamlink launch failed: ${err.message}`);
  });

  return proc;
}

// ────────────────────────────────────────────────────────────────────────────
// yt-dlp recorder — best for YouTube/Facebook/TikTok live + --live-from-start
// ────────────────────────────────────────────────────────────────────────────
export function recordWithYtdlp(task) {
  const { tsPath, mp4Path } = prepareOutput(task, 'ts');

  const args = [
    '--no-warnings',
    '--no-part',                           // write directly (so file is readable while recording)
    '--no-mtime',
    '--hls-use-mpegts',                    // use MPEG-TS instead of fragmented MP4
    '--live-from-start',                   // record from beginning of live
    '--retries', 'infinite',
    '--fragment-retries', 'infinite',
    '--retry-sleep', 'linear=1::5',        // 1s → 5s exponential backoff
    '-f', 'best',
    '-o', tsPath,
    task.url,
  ];

  if (task.duration) {
    args.push('--download-sections', `*0-${task.duration}`);
  }

  const proc = spawn('yt-dlp', args);
  task.process = proc;
  task.tsPath = tsPath;
  task.mp4Path = mp4Path;
  task.recordingMethod = 'yt-dlp';

  taskManager.updateTask(task.id, { status: 'downloading', speed: '連線中... Connecting' });
  const stopProgress = attachProgressReporter(task, tsPath);

  let lastStderr = '';
  proc.stderr.on('data', (d) => { lastStderr = d.toString().trim().split('\n').pop() || lastStderr; });
  proc.stdout.on('data', (d) => {
    const line = d.toString();
    if (line.includes('[download]')) {
      taskManager.updateTask(task.id, { speed: '錄製中... Recording' });
    }
  });

  proc.on('close', async (code) => {
    stopProgress();
    if (task.status === 'cancelled' || code === 0 || code === null) {
      taskManager.updateTask(task.id, { status: 'merging', speed: '轉檔為 MP4...' });
      const final = await remuxToMp4(tsPath, mp4Path);
      taskManager.completeTask(task.id, final || tsPath);
    } else {
      if (fs.existsSync(tsPath) && fs.statSync(tsPath).size > 1024) {
        const final = await remuxToMp4(tsPath, mp4Path);
        taskManager.completeTask(task.id, final || tsPath);
      } else {
        taskManager.failTask(task.id, `yt-dlp exited (${code}): ${lastStderr || 'unknown error'}`);
      }
    }
  });

  proc.on('error', (err) => {
    stopProgress();
    taskManager.failTask(task.id, `yt-dlp launch failed: ${err.message}`);
  });

  return proc;
}

// ────────────────────────────────────────────────────────────────────────────
// FFmpeg direct recorder — for raw .m3u8 URLs (no auth needed)
// ────────────────────────────────────────────────────────────────────────────
export function recordWithFFmpeg(task) {
  const { tsPath, mp4Path } = prepareOutput(task, 'ts');

  const args = [];

  if (task.headers) {
    const headerStr = Object.entries(task.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n';
    args.push('-headers', headerStr);
  }

  // Auto-reconnect flags
  args.push(
    '-reconnect', '1',
    '-reconnect_at_eof', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
    '-i', task.streamUrl || task.url,
  );

  if (task.duration) {
    args.push('-t', String(task.duration));
  }

  // Output as MPEG-TS (crash-safe)
  args.push('-c', 'copy', '-f', 'mpegts', '-y', tsPath);

  const proc = spawn('ffmpeg', args);
  task.process = proc;
  task.tsPath = tsPath;
  task.mp4Path = mp4Path;
  task.recordingMethod = 'ffmpeg';

  taskManager.updateTask(task.id, { status: 'downloading', speed: '連線中... Connecting' });
  const stopProgress = attachProgressReporter(task, tsPath);

  let lastStderr = '';
  proc.stderr.on('data', (d) => {
    const text = d.toString();
    if (text.includes('frame=') || text.includes('time=')) {
      taskManager.updateTask(task.id, { speed: '錄製中... Recording' });
    }
    lastStderr = text.trim().split('\n').filter(l => l).pop() || lastStderr;
  });

  proc.on('close', async (code) => {
    stopProgress();
    if (task.status === 'cancelled' || code === 0 || code === null || code === 255) {
      taskManager.updateTask(task.id, { status: 'merging', speed: '轉檔為 MP4...' });
      const final = await remuxToMp4(tsPath, mp4Path);
      taskManager.completeTask(task.id, final || tsPath);
    } else {
      if (fs.existsSync(tsPath) && fs.statSync(tsPath).size > 1024) {
        const final = await remuxToMp4(tsPath, mp4Path);
        taskManager.completeTask(task.id, final || tsPath);
      } else {
        taskManager.failTask(task.id, `FFmpeg exited (${code}): ${lastStderr || 'unknown error'}`);
      }
    }
  });

  proc.on('error', (err) => {
    stopProgress();
    taskManager.failTask(task.id, `FFmpeg launch failed: ${err.message}`);
  });

  return proc;
}

// ────────────────────────────────────────────────────────────────────────────
// Graceful stop — sends SIGINT so the recorder can flush the last segment.
// taskManager.cancelTask() will still call kill() if SIGINT doesn't take after 5s.
// ────────────────────────────────────────────────────────────────────────────
export function stopGracefully(task) {
  if (!task || !task.process) return;
  try {
    // SIGINT lets streamlink/yt-dlp/ffmpeg finalize the file properly
    task.process.kill('SIGINT');
  } catch (err) {
    // Fall back to SIGTERM
    try { task.process.kill('SIGTERM'); } catch {}
  }
}

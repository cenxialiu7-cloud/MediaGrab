import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import { taskManager } from '../utils/taskManager.js';

const DEFAULT_OUTPUT = path.join(os.homedir(), 'Downloads', 'MediaGrab');

export function getInfo(url) {
  return new Promise((resolve, reject) => {
    const args = ['--dump-json', '--no-playlist', '--no-warnings', url];
    const proc = spawn('yt-dlp', args, { timeout: 30000 });
    let out = '';
    let err = '';
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => err += d);
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(err || `yt-dlp exited with code ${code}`));
      try { resolve(JSON.parse(out)); }
      catch { reject(new Error('Failed to parse yt-dlp output')); }
    });
  });
}

export function getPlaylistInfo(url) {
  return new Promise((resolve, reject) => {
    const args = ['--dump-json', '--flat-playlist', '--no-warnings', url];
    const proc = spawn('yt-dlp', args, { timeout: 60000 });
    let out = '';
    let err = '';
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => err += d);
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(err || `yt-dlp exited with code ${code}`));
      try {
        const entries = out.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
        resolve(entries);
      } catch { reject(new Error('Failed to parse playlist')); }
    });
  });
}

/**
 * List all videos in a YouTube playlist or channel.
 * For channels, automatically appends /videos if not present.
 * Returns { title, type, entries: [{ id, title, url, duration, uploader }] }
 */
export function listYoutubeVideos(url) {
  return new Promise((resolve, reject) => {
    let target = url.trim();
    const isChannel = /youtube\.com\/(@[\w.-]+|channel\/|c\/|user\/)/.test(target);
    const isPlaylist = /[?&]list=/.test(target);

    // For channel URLs without a specific tab, default to the videos tab
    if (isChannel && !/\/(videos|streams|shorts|playlists)\b/.test(target) && !isPlaylist) {
      target = target.replace(/\/$/, '') + '/videos';
    }

    // If it's a watch URL with a list= param, use the playlist
    if (isPlaylist && /watch\?/.test(target)) {
      const m = target.match(/[?&]list=([^&]+)/);
      if (m) target = `https://www.youtube.com/playlist?list=${m[1]}`;
    }

    const args = [
      '--dump-json',
      '--flat-playlist',
      '--no-warnings',
      '--playlist-end', '500',  // safety cap
      target,
    ];
    const proc = spawn('yt-dlp', args, { timeout: 90000 });
    let out = '';
    let err = '';
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => err += d);
    proc.on('close', code => {
      if (code !== 0 && !out.trim()) {
        return reject(new Error(err.split('\n').filter(Boolean).pop() || `yt-dlp exited with code ${code}`));
      }
      try {
        const lines = out.trim().split('\n').filter(Boolean);
        const entries = [];
        let playlistTitle = '';
        for (const line of lines) {
          const j = JSON.parse(line);
          if (j._type === 'playlist' && j.title) { playlistTitle = j.title; continue; }
          // Skip entries that aren't actual videos
          if (!j.id) continue;
          entries.push({
            id: j.id,
            title: j.title || j.id,
            url: j.url || `https://www.youtube.com/watch?v=${j.id}`,
            duration: j.duration || 0,
            uploader: j.uploader || j.channel || '',
          });
          if (!playlistTitle && j.playlist_title) playlistTitle = j.playlist_title;
          if (!playlistTitle && j.channel) playlistTitle = j.channel;
        }
        if (entries.length === 0) {
          return reject(new Error('No videos found. The URL may be private or invalid.'));
        }
        resolve({
          title: playlistTitle || (isChannel ? 'YouTube Channel' : 'YouTube Playlist'),
          type: isChannel ? 'channel' : 'playlist',
          entries,
        });
      } catch (e) {
        reject(new Error('Failed to parse video list: ' + e.message));
      }
    });
  });
}

export function startDownload(task) {
  const outputDir = task.outputDir || DEFAULT_OUTPUT;
  const outputTemplate = path.join(outputDir, '%(title)s.%(ext)s');

  const args = [
    '-o', outputTemplate,
    '--newline',
    '--no-warnings',
    '--progress-template', '%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress._downloaded_bytes_str)s|%(progress._total_bytes_str)s',
  ];

  if (task.format) {
    args.push('-f', task.format);
  } else {
    args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best');
  }

  if (task.cookies) {
    args.push('--cookies-from-browser', task.cookies);
  }

  args.push(task.url);

  const proc = spawn('yt-dlp', args);
  task.process = proc;

  proc.stdout.on('data', (data) => {
    const line = data.toString().trim();
    const progressMatch = line.match(/([\d.]+)%\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)/);
    if (progressMatch) {
      taskManager.updateTask(task.id, {
        progress: parseFloat(progressMatch[1]) || 0,
        speed: progressMatch[2]?.trim() || '',
        eta: progressMatch[3]?.trim() || '',
        downloaded: progressMatch[4]?.trim() || '',
        total: progressMatch[5]?.trim() || '',
      });
    }
    const destMatch = line.match(/\[download\] Destination: (.+)/);
    if (destMatch) {
      taskManager.updateTask(task.id, { outputPath: destMatch[1] });
    }
    const mergeMatch = line.match(/\[Merger\] Merging formats into "(.+)"/);
    if (mergeMatch) {
      taskManager.updateTask(task.id, { outputPath: mergeMatch[1], status: 'merging' });
    }
  });

  proc.stderr.on('data', (data) => {
    const line = data.toString().trim();
    if (line.includes('ERROR')) {
      taskManager.updateTask(task.id, { error: line });
    }
  });

  proc.on('close', (code) => {
    if (code === 0) {
      taskManager.completeTask(task.id, task.outputPath || outputDir);
    } else if (task.status !== 'cancelled') {
      taskManager.failTask(task.id, task.error || `Process exited with code ${code}`);
    }
  });

  return proc;
}

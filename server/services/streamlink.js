import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { taskManager } from '../utils/taskManager.js';

const DEFAULT_OUTPUT = path.join(os.homedir(), 'Downloads', 'MediaGrab');

export function getStreamInfo(url) {
  return new Promise((resolve, reject) => {
    const proc = spawn('streamlink', ['--json', url], { timeout: 20000 });
    let out = '';
    let err = '';
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => err += d);
    proc.on('close', code => {
      try {
        const data = JSON.parse(out);
        resolve(data);
      } catch {
        reject(new Error(err || 'Failed to get stream info'));
      }
    });
  });
}

export function recordStream(task) {
  const outputDir = task.outputDir || DEFAULT_OUTPUT;
  fs.mkdirSync(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = task.filename || `${task.title || 'livestream'}_${timestamp}.mp4`;
  const outputPath = path.join(outputDir, filename);

  const quality = task.quality || 'best';
  const args = [task.url, quality, '-o', outputPath, '--force'];

  if (task.duration) {
    args.push('--hls-duration', String(task.duration));
  }

  const proc = spawn('streamlink', args);
  task.process = proc;
  const startTime = Date.now();

  proc.stdout.on('data', (data) => {
    const line = data.toString().trim();
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    taskManager.updateTask(task.id, {
      eta: `Recording: ${mins}:${String(secs).padStart(2, '0')}`,
      status: 'downloading',
    });

    if (fs.existsSync(outputPath)) {
      const stat = fs.statSync(outputPath);
      const mb = (stat.size / (1024 * 1024)).toFixed(1);
      taskManager.updateTask(task.id, { downloaded: `${mb} MB` });
    }
  });

  proc.stderr.on('data', (data) => {
    const line = data.toString().trim();
    if (line.includes('Opening stream')) {
      taskManager.updateTask(task.id, { status: 'downloading', speed: 'Recording...' });
    }
  });

  proc.on('close', (code) => {
    if (code === 0 || task.status === 'cancelled') {
      taskManager.completeTask(task.id, outputPath);
    } else {
      taskManager.failTask(task.id, `Streamlink exited with code ${code}`);
    }
  });

  return proc;
}

export function recordWithFFmpeg(task) {
  const outputDir = task.outputDir || DEFAULT_OUTPUT;
  fs.mkdirSync(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = task.filename || `${task.title || 'livestream'}_${timestamp}.mp4`;
  const outputPath = path.join(outputDir, filename);

  const args = ['-i', task.streamUrl];

  if (task.headers) {
    const headerStr = Object.entries(task.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n');
    args.unshift('-headers', headerStr);
  }

  if (task.duration) {
    args.push('-t', String(task.duration));
  }

  args.push('-c', 'copy', '-y', outputPath);

  const proc = spawn('ffmpeg', args);
  task.process = proc;
  const startTime = Date.now();

  const updateInterval = setInterval(() => {
    if (fs.existsSync(outputPath)) {
      const stat = fs.statSync(outputPath);
      const mb = (stat.size / (1024 * 1024)).toFixed(1);
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      taskManager.updateTask(task.id, {
        downloaded: `${mb} MB`,
        eta: `Recording: ${mins}:${String(secs).padStart(2, '0')}`,
      });
    }
  }, 1000);

  proc.on('close', (code) => {
    clearInterval(updateInterval);
    if (code === 0 || task.status === 'cancelled') {
      taskManager.completeTask(task.id, outputPath);
    } else {
      taskManager.failTask(task.id, `FFmpeg exited with code ${code}`);
    }
  });

  return proc;
}

import { spawn, execSync } from 'child_process';
import fetch from 'node-fetch';
import path from 'path';
import os from 'os';
import { taskManager } from '../utils/taskManager.js';

const RPC_URL = 'http://localhost:6800/jsonrpc';
const DEFAULT_OUTPUT = path.join(os.homedir(), 'Downloads', 'MediaGrab');
let aria2Process = null;
let rpcToken = 'mediagrab';

export function isAria2Available() {
  try {
    execSync('which aria2c 2>/dev/null || where aria2c 2>nul', { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

export async function startAria2Daemon() {
  if (!isAria2Available()) return false;

  try {
    await rpcCall('aria2.getVersion');
    return true;
  } catch {}

  return new Promise((resolve) => {
    aria2Process = spawn('aria2c', [
      '--enable-rpc',
      '--rpc-listen-all=false',
      '--rpc-listen-port=6800',
      `--rpc-secret=${rpcToken}`,
      '--max-concurrent-downloads=5',
      '--split=8',
      '--max-connection-per-server=8',
      '--min-split-size=1M',
      '--continue=true',
      '--auto-file-renaming=false',
      '--allow-overwrite=true',
      `--dir=${DEFAULT_OUTPUT}`,
      '--daemon=false',
      '--quiet=true',
    ], { stdio: 'ignore', detached: true });

    aria2Process.unref();

    setTimeout(async () => {
      try {
        await rpcCall('aria2.getVersion');
        resolve(true);
      } catch {
        resolve(false);
      }
    }, 1500);
  });
}

async function rpcCall(method, params = []) {
  const body = {
    jsonrpc: '2.0',
    id: Date.now().toString(),
    method,
    params: [`token:${rpcToken}`, ...params],
  };

  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

export async function addDownload(task) {
  const outputDir = task.outputDir || DEFAULT_OUTPUT;
  const options = {
    dir: outputDir,
    split: String(task.threads || 8),
    'max-connection-per-server': String(task.threads || 8),
  };

  if (task.filename) {
    options.out = task.filename;
  }

  if (task.headers) {
    options.header = Object.entries(task.headers).map(([k, v]) => `${k}: ${v}`);
  }

  try {
    const gid = await rpcCall('aria2.addUri', [[task.downloadUrl || task.url], options]);
    task.aria2Gid = gid;
    taskManager.updateTask(task.id, { aria2Gid: gid });

    pollAria2Progress(task.id, gid);
    return gid;
  } catch (err) {
    taskManager.failTask(task.id, `aria2 error: ${err.message}`);
    throw err;
  }
}

async function pollAria2Progress(taskId, gid) {
  const interval = setInterval(async () => {
    try {
      const status = await rpcCall('aria2.tellStatus', [gid]);
      const completed = parseInt(status.completedLength) || 0;
      const total = parseInt(status.totalLength) || 0;
      const speed = parseInt(status.downloadSpeed) || 0;
      const connections = parseInt(status.connections) || 0;

      const progress = total > 0 ? (completed / total) * 100 : 0;
      const speedStr = formatSpeed(speed);
      const etaStr = speed > 0 ? formatEta((total - completed) / speed) : '';

      taskManager.updateTask(taskId, {
        progress: Math.round(progress * 10) / 10,
        speed: speedStr,
        downloaded: formatBytes(completed),
        total: formatBytes(total),
        eta: etaStr,
        threads: connections,
      });

      if (status.status === 'complete') {
        clearInterval(interval);
        const filePath = status.files?.[0]?.path || '';
        taskManager.completeTask(taskId, filePath);
      } else if (status.status === 'error') {
        clearInterval(interval);
        taskManager.failTask(taskId, status.errorMessage || 'Download failed');
      } else if (status.status === 'removed') {
        clearInterval(interval);
      }
    } catch {
      clearInterval(interval);
    }
  }, 500);
}

function formatSpeed(bytesPerSec) {
  if (bytesPerSec >= 1048576) return `${(bytesPerSec / 1048576).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${bytesPerSec} B/s`;
}

function formatBytes(bytes) {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatEta(seconds) {
  if (!seconds || seconds <= 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export async function pauseDownload(gid) {
  return rpcCall('aria2.pause', [gid]);
}

export async function resumeDownload(gid) {
  return rpcCall('aria2.unpause', [gid]);
}

export async function cancelDownload(gid) {
  return rpcCall('aria2.remove', [gid]);
}

export async function getGlobalStat() {
  return rpcCall('aria2.getGlobalStat');
}

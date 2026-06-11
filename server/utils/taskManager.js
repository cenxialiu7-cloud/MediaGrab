import { v4 as uuid } from 'uuid';
import { broadcast } from '../ws.js';
import { execSync } from 'child_process';

function checkCommand(cmd) {
  try {
    execSync(`which ${cmd} 2>/dev/null || where ${cmd} 2>nul`, { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

// Redact secrets from a free-text error line before it leaves the server. yt-dlp
// stderr can echo the signed media URL (itself a credential) or a Cookie/auth
// header value; those must not reach the WebSocket / frontend DOM.
function redactError(s) {
  if (typeof s !== 'string') return s;
  return s
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/((?:cookie|authorization|x-mediagrab-token)\s*[:=]\s*)\S+/gi, '$1[redacted]')
    .slice(0, 300);
}

// Strip non-serializable (process, startFn) and sensitive (captured headers/
// cookies — may contain a live session Cookie) fields, and redact the error
// text, before a task ever leaves the server over WebSocket or the REST API.
function publicTask(task) {
  const { process, startFn, headers, referer, cookies, useCapturedHeaders, ...rest } = task;
  if (rest.error) rest.error = redactError(rest.error);
  // A captured manifest URL is itself a credential (signed token lives in the
  // path or query, e.g. Vimeo's exp/hmac/psid) — never expose it. The user
  // identifies the download by its title.
  if (rest.type === 'capture' && rest.url) rest.url = '[captured stream]';
  return rest;
}

class TaskManager {
  constructor() {
    this.tasks = new Map();
    this.maxConcurrent = 3;
    this.queue = [];
    this.activeCount = 0;
  }

  createTask(info) {
    const task = {
      id: uuid(),
      title: info.title || 'Untitled',
      url: info.url || '',
      type: info.type || 'video',
      status: 'queued',
      progress: 0,
      speed: '',
      downloaded: '',
      total: '',
      eta: '',
      threads: 0,
      error: null,
      outputPath: '',
      createdAt: Date.now(),
      ...info
    };
    this.tasks.set(task.id, task);
    this.queue.push(task.id);
    broadcast('task:created', publicTask(task));
    return task;
  }

  updateTask(id, updates) {
    const task = this.tasks.get(id);
    if (!task) return null;
    Object.assign(task, updates);
    broadcast('task:updated', publicTask(task));
    return task;
  }

  completeTask(id, outputPath) {
    this.activeCount = Math.max(0, this.activeCount - 1);
    this.updateTask(id, { status: 'completed', progress: 100, outputPath });
    this.processQueue();
  }

  failTask(id, error) {
    this.activeCount = Math.max(0, this.activeCount - 1);
    this.updateTask(id, { status: 'error', error: String(error) });
    this.processQueue();
  }

  cancelTask(id) {
    const task = this.tasks.get(id);
    if (!task) return;
    if (task.process) {
      try { task.process.kill('SIGTERM'); } catch {}
    }
    if (task.status === 'downloading') {
      this.activeCount = Math.max(0, this.activeCount - 1);
    }
    this.updateTask(id, { status: 'cancelled' });
    this.queue = this.queue.filter(qid => qid !== id);
    this.processQueue();
  }

  pauseTask(id) {
    const task = this.tasks.get(id);
    if (!task || task.status !== 'downloading') return;
    if (task.process) {
      try { task.process.kill('SIGSTOP'); } catch {}
    }
    this.updateTask(id, { status: 'paused' });
  }

  resumeTask(id) {
    const task = this.tasks.get(id);
    if (!task || task.status !== 'paused') return;
    if (task.process) {
      try { task.process.kill('SIGCONT'); } catch {}
    }
    this.updateTask(id, { status: 'downloading' });
  }

  canStartNext() {
    return this.activeCount < this.maxConcurrent;
  }

  markActive(id) {
    this.activeCount++;
    this.queue = this.queue.filter(qid => qid !== id);
    this.updateTask(id, { status: 'downloading' });
  }

  processQueue() {
    while (this.canStartNext() && this.queue.length > 0) {
      const nextId = this.queue.shift();
      const task = this.tasks.get(nextId);
      if (task && task.status === 'queued' && task.startFn) {
        this.markActive(nextId);
        task.startFn(task);
      }
    }
  }

  setMaxConcurrent(n) {
    this.maxConcurrent = Math.max(1, Math.min(10, n));
    this.processQueue();
  }

  getAllTasks() {
    return Array.from(this.tasks.values()).map(publicTask);
  }

  removeTask(id) {
    this.cancelTask(id);
    this.tasks.delete(id);
    broadcast('task:removed', { id });
  }

  clearFinished() {
    const finishedStatuses = ['completed', 'cancelled', 'error'];
    const toRemove = [];
    for (const [id, task] of this.tasks) {
      if (finishedStatuses.includes(task.status)) {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      this.tasks.delete(id);
      broadcast('task:removed', { id });
    }
    return toRemove.length;
  }

  getDependencyStatus() {
    // streamlink dropped — yt-dlp now handles Twitch live too, so it's no
    // longer a required dependency (and can't be cleanly bundled on macOS).
    return {
      'yt-dlp': checkCommand('yt-dlp'),
      ffmpeg: checkCommand('ffmpeg'),
      aria2c: checkCommand('aria2c'),
    };
  }
}

export const taskManager = new TaskManager();

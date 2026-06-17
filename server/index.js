import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import path from 'path';
import os from 'os';
import fs from 'fs';
import cors from 'cors';
import { setupWebSocket } from './ws.js';
import downloadRoutes from './routes/download.js';
import parseRoutes from './routes/parse.js';
import liveRoutes from './routes/live.js';
import settingsRoutes from './routes/settings.js';
import captureRoutes from './routes/capture.js';
import extensionRoutes from './routes/extension.js';
import { taskManager } from './utils/taskManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 9800;

// App version — exposed in /api/status so a newer launcher can tell an older
// running instance apart and take over the port on update.
let APP_VERSION = '';
try {
  APP_VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8')).version || '';
} catch {}

// The launcher writes server.pid here (matches the Mac/Windows launchers).
function userDataDir() {
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || os.homedir(), 'MediaGrab');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'MediaGrab');
  return path.join(os.homedir(), '.local', 'share', 'MediaGrab');
}

app.use(cors());
app.use(express.json());

const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));

app.use('/api/download', downloadRoutes);
app.use('/api/parse', parseRoutes);
app.use('/api/live', liveRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/capture', captureRoutes);
app.use('/api/extension', extensionRoutes);

app.get('/api/status', (req, res) => {
  res.json({
    status: 'running',
    version: APP_VERSION,
    tasks: taskManager.getAllTasks(),
    dependencies: taskManager.getDependencyStatus()
  });
});

// Graceful shutdown — lets the "Quit" button (and a newer launcher taking over
// the port on update) stop the background server cleanly. Kills in-progress
// downloads so they don't orphan, removes the pid file, then exits.
app.post('/api/quit', (req, res) => {
  res.json({ ok: true, message: 'MediaGrab is shutting down' });
  setTimeout(() => {
    try { taskManager.shutdown(); } catch {}
    try {
      const pidFile = path.join(userDataDir(), 'server.pid');
      if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
    } catch {}
    process.exit(0);
  }, 250);   // let the HTTP response flush first
});

app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

setupWebSocket(server);

// Bind loopback only — the API + WebSocket carry task data and the capture
// endpoint; they must not be reachable from the local network.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  MediaGrab Server running at http://127.0.0.1:${PORT}\n`);
});

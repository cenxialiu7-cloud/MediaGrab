import {closeBrowser} from './services/playwright.js';
import {publicPlatforms,explainFailure} from './utils/platforms.js';
import {versionInfo} from './utils/version.js';
import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { apiGuard, boundedBody, safeError } from './utils/security.js';
import { loadSettings } from './utils/config.js';
import { setupWebSocket } from './ws.js';
import downloadRoutes from './routes/download.js';
import parseRoutes from './routes/parse.js';
import liveRoutes from './routes/live.js';
import settingsRoutes from './routes/settings.js';
import captureRoutes from './routes/capture.js';
import extensionRoutes from './routes/extension.js';
import { taskManager } from './utils/taskManager.js';
import { stageExtension } from './utils/extensionStaging.js';
import { prependBinToPath, maybeUpdateYtdlp } from './utils/ytdlpUpdate.js';

// Prefer a user-writable, auto-updated yt-dlp over the bundled one (extractors
// break often; the bundled binary is read-only). Must run before any download.
prependBinToPath();

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

app.disable('x-powered-by');
app.use((req,res,next)=>{
 res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
 res.setHeader('X-Content-Type-Options','nosniff');
 next();
});
app.use('/api', apiGuard);
app.use(express.json({limit:'2mb'}));
app.use('/api', boundedBody);
app.use('/api', (req,res,next)=>{const json=res.json.bind(res);res.json=(value)=>{if(value?.error)value={...value,...explainFailure(value.error),error:safeError(value.error),detail:undefined};return json(value);};next();});

const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));

app.use('/api/download', downloadRoutes);
app.use('/api/parse', parseRoutes);
app.use('/api/live', liveRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/capture', captureRoutes);
app.use('/api/extension', extensionRoutes);

app.get('/api/platforms',(req,res)=>res.json(publicPlatforms()));
app.get('/api/version',async(req,res,next)=>{try{res.json(await versionInfo());}catch(e){next(e);}});

app.get('/api/status', (req, res) => {
  res.json({
    status: 'running',
    version: APP_VERSION,
    service: 'mediagrab'
  });
});

// Graceful shutdown — lets the "Quit" button (and a newer launcher taking over
// the port on update) stop the background server cleanly. Kills in-progress
// downloads so they don't orphan, removes the pid file, then exits.
app.post('/api/quit', (req, res) => {
  res.json({ ok: true, message: 'MediaGrab is shutting down' });
  setTimeout(async () => {
    try { await taskManager.shutdown(); await closeBrowser(); } catch {}
    try {
      const pidFile = path.join(userDataDir(), 'server.pid');
      if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
    } catch {}
    process.exit(0);
  }, 250);   // let the HTTP response flush first
});

app.use('/api',(req,res)=>res.status(404).json({error:'API not found'}));
app.use('/api',(err,req,res,next)=>res.status(400).json({error:safeError(err)}));

app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

setupWebSocket(server);

// Bind loopback only — the API + WebSocket carry task data and the capture
// endpoint; they must not be reachable from the local network.
// Copy the companion extension out of the read-only .app bundle into the
// writable data dir BEFORE we start serving, so /api/extension/info can hand
// the browser a folder its "Load unpacked" picker can actually navigate to.
// Non-fatal: a staging failure must never stop the server from starting.
try {
  const staged = stageExtension();
  if (staged.staged) console.log(`  Companion extension staged at: ${staged.dir}`);
} catch (e) { console.warn('[mediagrab] extension staging skipped:', e && e.message); }

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  MediaGrab Server running at http://127.0.0.1:${PORT}\n`);
  // Refresh yt-dlp in the background (throttled to once/day). Non-blocking so it
  // never delays startup; the fresh binary is picked up on the next launch.
  if(loadSettings().autoUpdateEngine) maybeUpdateYtdlp();
});

for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await taskManager.shutdown();await closeBrowser();process.exit(0);});

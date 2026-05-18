import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import path from 'path';
import cors from 'cors';
import { setupWebSocket } from './ws.js';
import downloadRoutes from './routes/download.js';
import parseRoutes from './routes/parse.js';
import liveRoutes from './routes/live.js';
import settingsRoutes from './routes/settings.js';
import { taskManager } from './utils/taskManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 9800;

app.use(cors());
app.use(express.json());

const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));

app.use('/api/download', downloadRoutes);
app.use('/api/parse', parseRoutes);
app.use('/api/live', liveRoutes);
app.use('/api/settings', settingsRoutes);

app.get('/api/status', (req, res) => {
  res.json({
    status: 'running',
    tasks: taskManager.getAllTasks(),
    dependencies: taskManager.getDependencyStatus()
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

setupWebSocket(server);

server.listen(PORT, () => {
  console.log(`\n  MediaGrab Server running at http://localhost:${PORT}\n`);
});

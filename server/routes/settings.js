import { Router } from 'express';
import { taskManager } from '../utils/taskManager.js';
import path from 'path';
import os from 'os';
import fs from 'fs';

const router = Router();

const SETTINGS_FILE = path.join(os.homedir(), '.mediagrab', 'settings.json');

const defaultSettings = {
  outputDir: path.join(os.homedir(), 'Downloads', 'MediaGrab'),
  maxConcurrent: 3,
  threadsPerTask: 8,
  language: 'zh-TW',
  theme: 'dark',
  autoStartQueue: true,
  cookies: '',
};

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      return { ...defaultSettings, ...data };
    }
  } catch {}
  return { ...defaultSettings };
}

function saveSettings(settings) {
  const dir = path.dirname(SETTINGS_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

router.get('/', (req, res) => {
  const settings = loadSettings();
  res.json(settings);
});

router.post('/', (req, res) => {
  const current = loadSettings();
  const updated = { ...current, ...req.body };
  saveSettings(updated);

  if (updated.maxConcurrent !== current.maxConcurrent) {
    taskManager.setMaxConcurrent(updated.maxConcurrent);
  }

  res.json(updated);
});

router.get('/dependencies', (req, res) => {
  res.json(taskManager.getDependencyStatus());
});

export default router;

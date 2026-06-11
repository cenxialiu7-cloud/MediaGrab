import { Router } from 'express';
import { taskManager } from '../utils/taskManager.js';
import { resetFetchContext } from '../services/playwright.js';
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
  cookies: '',       // browser name for yt-dlp --cookies-from-browser (yt-dlp path only)
  cookiesFile: '',   // path to a Netscape cookies.txt — feeds BOTH yt-dlp and Playwright
  // Monetization opt-out — hides SponsorBar, AdSlot, and donation links.
  // Default false (= ads/affiliate visible) but user can flip in Settings.
  disableAds: false,
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

  // Cookie source changed → drop the cached segment-fetch context so the next
  // download re-reads the new cookies.txt instead of the stale cached cookies.
  if (updated.cookiesFile !== current.cookiesFile || updated.cookies !== current.cookies) {
    resetFetchContext().catch(() => {});
  }

  res.json(updated);
});

router.get('/dependencies', (req, res) => {
  res.json(taskManager.getDependencyStatus());
});

export default router;

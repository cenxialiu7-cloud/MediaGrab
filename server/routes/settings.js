import { Router } from 'express';
import { taskManager } from '../utils/taskManager.js';
import path from 'path';
import os from 'os';
import fs from 'fs';

const router = Router();

import { loadSettings, saveSettings, validateSettings } from '../utils/config.js';

router.get('/', (req, res) => {
  const settings = loadSettings();
  res.json(settings);
});

router.post('/', (req, res) => {
  const current = loadSettings();
  const updated = { ...current, ...validateSettings(req.body) };
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

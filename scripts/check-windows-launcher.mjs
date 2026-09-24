// Test the actual Windows launcher against an isolated local server and fake token.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-launcher-'));
const token = 'synthetic-launcher-test-token';
fs.mkdirSync(path.join(home, '.mediagrab'));
fs.writeFileSync(path.join(home, '.mediagrab', 'capture-token'), token);
const sentinel = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
let mode = 'reject', quits = 0;
const server = http.createServer((req, res) => {
  if (req.url === '/api/status') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(mode === 'foreign' ? { service: 'unrelated' } : { version: '1.7.0' }));
  } else if (req.url === '/api/quit') {
    quits++;
    assert.equal(req.method, 'POST');
    assert.equal(req.headers['x-mediagrab-token'], token);
    res.statusCode = mode === 'reject' ? 403 : 200;
    res.end('{}');
    if (mode === 'accept') { server.close(); server.closeIdleConnections(); }
  } else { res.writeHead(404); res.end(); }
});
const run = () => new Promise((resolve, reject) => {
  const child = spawn(path.resolve(process.argv[2]), ['--quit'], {
    env: { ...process.env, USERPROFILE: home, HOME: home }, stdio: 'ignore', timeout: 15000,
  });
  child.on('error', reject);
  child.on('close', (code) => resolve(code));
});
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(9800, '127.0.0.1', resolve); });
  assert.equal(await run(), 1, 'rejected quit must fail');
  assert.equal(quits, 1);
  mode = 'foreign';
  assert.equal(await run(), 1, 'unrelated server must not be stopped');
  assert.equal(quits, 1);
  mode = 'accept';
  assert.equal(await run(), 0, 'authenticated quit must succeed');
  assert.equal(quits, 2);
  process.kill(sentinel.pid, 0);
  console.log(JSON.stringify({ authenticatedQuit: true, rejectedQuitFails: true, unrelatedServerUntouched: true, unrelatedNodeSurvives: true }));
} finally {
  server.close(); server.closeAllConnections();
  sentinel.kill();
  fs.rmSync(home, { recursive: true, force: true });
}

#!/usr/bin/env node
/**
 * MediaGrab native messaging host.
 *
 * Launched by Chrome (one process per connection). Speaks the native-messaging
 * stdio protocol — each message is a 4-byte little-endian length header followed
 * by UTF-8 JSON — and bridges the extension to the local MediaGrab server.
 *
 * It reads the capture token from ~/.mediagrab/capture-token and forwards
 * download requests to http://127.0.0.1:9800/api/capture/download. Nothing other
 * than framed messages may be written to stdout (or Chrome drops the host), so
 * all diagnostics go to stderr.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';

const TOKEN_FILE = path.join(os.homedir(), '.mediagrab', 'capture-token');
const HOST = '127.0.0.1';
const PORT = Number(process.env.MEDIAGRAB_PORT) || 9800;

const logErr = (...a) => { try { process.stderr.write('[mediagrab-host] ' + a.join(' ') + '\n'); } catch {} };

function readToken() {
  try { return fs.readFileSync(TOKEN_FILE, 'utf-8').trim(); } catch { return ''; }
}

// ── native-messaging framing ────────────────────────────────────────────────
function sendMessage(obj) {
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  process.stdout.write(header);
  process.stdout.write(json);
}

// ── local server calls ──────────────────────────────────────────────────────
function serverRequest(method, urlPath, bodyObj) {
  return new Promise((resolve) => {
    const body = bodyObj ? Buffer.from(JSON.stringify(bodyObj), 'utf8') : null;
    const headers = { 'Content-Type': 'application/json' };
    if (body) headers['Content-Length'] = body.length;
    if (method === 'POST') headers['X-MediaGrab-Token'] = readToken();
    const req = http.request({ host: HOST, port: PORT, path: urlPath, method, headers, timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => {
        let j = null; try { j = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, body: j });
      });
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'server timeout' }); });
    if (body) req.write(body);
    req.end();
  });
}

const serverUp = async () => (await serverRequest('GET', '/api/status')).status === 200;

async function handle(msg) {
  if (!msg || typeof msg !== 'object') return sendMessage({ ok: false, error: 'bad message' });

  if (msg.type === 'ping') {
    return sendMessage({ type: 'pong', serverUp: await serverUp() });
  }

  if (msg.type === 'download') {
    if (!(await serverUp())) {
      return sendMessage({ ok: false, error: `MediaGrab app not running (server :${PORT})` });
    }
    const r = await serverRequest('POST', '/api/capture/download', msg.payload || {});
    if (r.status === 200 && r.body) {
      return sendMessage({ ok: true, taskId: r.body.taskId, engine: r.body.engine, via: r.body.via });
    }
    return sendMessage({ ok: false, status: r.status, error: (r.body && (r.body.error || r.body.hint)) || r.error || 'download failed' });
  }

  return sendMessage({ ok: false, error: 'unknown message type: ' + msg.type });
}

// ── read framed messages from stdin ─────────────────────────────────────────
let buf = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0);
    if (buf.length < 4 + len) break;
    const json = buf.subarray(4, 4 + len).toString('utf8');
    buf = buf.subarray(4 + len);
    let msg = null;
    try { msg = JSON.parse(json); } catch { logErr('bad json'); continue; }
    handle(msg);
  }
});
process.stdin.on('end', () => process.exit(0));
process.on('uncaughtException', (e) => { logErr('uncaught', e.message); });

import { WebSocketServer } from 'ws';
import { authorizeWs } from './utils/security.js';

let wss;
const clients = new Set();

export function setupWebSocket(server) {
  wss = new WebSocketServer({ server, path: '/ws', maxPayload:4096, verifyClient:({req})=>authorizeWs(req) });

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });
}

export function broadcast(type, data) {
  const message = JSON.stringify({ type, data, timestamp: Date.now() });
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(message);
    }
  }
}

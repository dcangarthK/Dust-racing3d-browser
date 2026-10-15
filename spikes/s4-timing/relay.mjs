#!/usr/bin/env node
// Localhost WebSocket relay around SessionHub. Spike only: no auth, no persistence.
import http from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { SessionHub } from './lib/hub.mjs';

const PORT = Number(process.env.PORT ?? 8787);
const here = fileURLToPath(new URL('.', import.meta.url));
const hub = new SessionHub();
const isFile = (f) => { try { return statSync(f).isFile(); } catch { return false; } };
const MIME = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/sessions') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(hub.sessionIds()));
  }
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = rel.startsWith('lib/') ? join(here, rel) : join(here, 'public', rel);
  if (!isFile(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});

const wss = new WebSocketServer({ server });
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const sessionId = url.searchParams.get('session');
  if (!sessionId) return ws.close(1008, 'session required');

  if (url.pathname === '/produce') {
    ws.send(JSON.stringify(hub.producerHello(sessionId)));
    ws.on('message', (data) => {
      try {
        hub.ingest(JSON.parse(data.toString()));
      } catch (e) {
        console.error('relay: bad message', e.message);
      }
    });
  } else if (url.pathname === '/watch') {
    const fromSeq = Number(url.searchParams.get('from') ?? -1);
    const consumer = {
      send: (s) => ws.readyState === ws.OPEN && ws.send(s),
      get bufferedAmount() { return ws.bufferedAmount; },
    };
    const detach = hub.attach(sessionId, consumer, fromSeq);
    ws.on('close', detach);
  } else {
    ws.close(1008, 'unknown path');
  }
});

server.listen(PORT, () => console.log(`relay: http://localhost:${PORT}  (ws /produce, /watch)`));

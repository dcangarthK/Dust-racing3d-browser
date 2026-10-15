#!/usr/bin/env node
// Plays an NDJSON race into the relay in real time. Reconnects and resumes from relay's lastSeq.
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const speed = Number(opt('speed', 1));
const relay = opt('relay', 'ws://localhost:8787');
const msgs = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const sessionId = msgs[0].sessionId;
let next = 0;

function connect() {
  const ws = new WebSocket(`${relay}/produce?session=${sessionId}`);
  let timer = null;
  ws.on('message', (data) => {
    const hello = JSON.parse(data.toString());
    if (hello.type !== 'hello') return;
    next = msgs.findIndex((m) => m.seq > hello.lastSeq);
    if (next < 0) { console.log('replay: relay already has everything'); return ws.close(); }
    console.log(`replay: session ${sessionId} resuming at seq ${msgs[next].seq}`);
    const t0Wall = Date.now();
    const t0Sim = msgs[next].tMs;
    const pump = () => {
      while (next < msgs.length && (msgs[next].tMs - t0Sim) / speed <= Date.now() - t0Wall) {
        ws.send(JSON.stringify({ ...msgs[next], wallMs: Date.now() }));
        next++;
      }
      if (next >= msgs.length) { console.log('replay: done'); return ws.close(); }
      timer = setTimeout(pump, 5);
    };
    pump();
  });
  ws.on('close', () => {
    clearTimeout(timer);
    if (next < msgs.length) { console.log('replay: connection lost, retrying in 1 s'); setTimeout(connect, 1000); }
  });
  ws.on('error', () => {});
}

console.log(`replay: ${msgs.length} messages, session ${sessionId}. Tower: http://localhost:8787/?session=${sessionId}`);
connect();

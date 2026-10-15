import { GapTracker } from '/lib/gap.mjs';

const params = new URLSearchParams(location.search);
const sessionId = params.get('session');
const statusEl = document.getElementById('status');
const rowsEl = document.getElementById('rows');
const gaps = new GapTracker();
const lastLapMs = new Map();
const seenEvents = new Set();
const state = { lastSeq: -1, eventsSeen: 0, latencies: [], snapshots: 0 };
window.__tower = state;
let latest = null;

const fmt = (ms) => (ms == null ? '—' : (ms / 1000).toFixed(3));

function onMessage(msg) {
  if (msg.seq <= state.lastSeq && msg.type !== 'event') return;
  state.lastSeq = Math.max(state.lastSeq, msg.seq);
  if (msg.wallMs) state.latencies.push(Date.now() - msg.wallMs);
  if (msg.type === 'event') {
    if (seenEvents.has(msg.eventId)) return; // dedupe across resumes
    seenEvents.add(msg.eventId);
    state.eventsSeen++;
    if (msg.eventType === 'lap') lastLapMs.set(msg.carId, msg.data.lapMs);
  } else if (msg.type === 'snapshot') {
    state.snapshots++;
    for (const car of msg.cars) gaps.record(car.id, GapTracker.distance(car), msg.tMs);
    latest = msg;
  }
}

function render() {
  if (latest) {
    const cars = [...latest.cars].sort((a, b) => a.pos - b.pos);
    rowsEl.innerHTML = cars.map((c, i) => {
      const gap = i === 0 ? null : gaps.gapMs(c.id, cars[i - 1].id);
      return `<tr><td class="pos">${c.pos}</td><td>#${c.id}</td><td>${c.lap}</td><td>${fmt(lastLapMs.get(c.id))}</td><td>${i === 0 ? 'Leader' : '+' + fmt(gap)}</td><td>${Math.round(c.speedKmh)}</td></tr>`;
    }).join('');
    const l = state.latencies.slice(-200).sort((a, b) => a - b);
    const p50 = l[Math.floor(l.length * 0.5)] ?? '—', p95 = l[Math.floor(l.length * 0.95)] ?? '—';
    statusEl.textContent = `session ${sessionId} · seq ${state.lastSeq} · events ${state.eventsSeen} · latency p50 ${p50} ms p95 ${p95} ms`;
  }
  requestAnimationFrame(render);
}

function connect() {
  const ws = new WebSocket(`ws://${location.host}/watch?session=${sessionId}&from=${state.lastSeq}`);
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  ws.onclose = () => { statusEl.textContent = 'disconnected — retrying'; setTimeout(connect, 1000); };
}

if (!sessionId) statusEl.textContent = 'add ?session=<id> to the URL (see replay output)';
else { connect(); requestAnimationFrame(render); }

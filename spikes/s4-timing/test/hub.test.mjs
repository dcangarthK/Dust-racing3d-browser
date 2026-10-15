import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionHub } from '../lib/hub.mjs';

const S = 'sess-1';
const ev = (seq, id = `e${seq}`) => ({ type: 'event', sessionId: S, seq, tick: seq, tMs: seq * 16, eventId: id, eventType: 'lap', data: {} });
const snap = (seq) => ({ type: 'snapshot', sessionId: S, seq, tick: seq, tMs: seq * 16, phase: 'racing', cars: [] });
const fakeConsumer = (bufferedAmount = 0) => {
  const got = [];
  return { got, bufferedAmount, send: (s) => got.push(JSON.parse(s)) };
};

test('producerHello reports -1 for new session, last seq after ingest', () => {
  const hub = new SessionHub();
  assert.deepEqual(hub.producerHello(S), { type: 'hello', sessionId: S, lastSeq: -1 });
  hub.ingest(ev(0)); hub.ingest(snap(1));
  assert.equal(hub.producerHello(S).lastSeq, 1);
});

test('duplicates (seq <= lastSeq) are dropped and not forwarded', () => {
  const hub = new SessionHub();
  const c = fakeConsumer();
  hub.attach(S, c);
  assert.equal(hub.ingest(ev(0)), true);
  assert.equal(hub.ingest(ev(1)), true);
  assert.equal(hub.ingest(ev(1)), false);
  assert.equal(hub.ingest(ev(0)), false);
  assert.deepEqual(c.got.map((m) => m.seq), [0, 1]);
});

test('live consumer receives messages in seq order', () => {
  const hub = new SessionHub();
  const c = fakeConsumer();
  hub.attach(S, c);
  [ev(0), snap(1), snap(2), ev(3)].forEach((m) => hub.ingest(m));
  assert.deepEqual(c.got.map((m) => m.seq), [0, 1, 2, 3]);
});

test('attach with fromSeq replays only missed events then latest snapshot', () => {
  const hub = new SessionHub();
  [ev(0), snap(1), ev(2), snap(3), ev(4), snap(5)].forEach((m) => hub.ingest(m));
  const c = fakeConsumer();
  hub.attach(S, c, 2);
  assert.deepEqual(c.got.map((m) => `${m.type}:${m.seq}`), ['event:4', 'snapshot:5']);
});

test('backpressured consumer gets events but not snapshots', () => {
  const hub = new SessionHub({ highWaterBytes: 100 });
  const slow = fakeConsumer(10_000);
  const fast = fakeConsumer(0);
  hub.attach(S, slow); hub.attach(S, fast);
  [snap(0), ev(1), snap(2), ev(3)].forEach((m) => hub.ingest(m));
  assert.deepEqual(slow.got.map((m) => m.seq), [1, 3]);
  assert.deepEqual(fast.got.map((m) => m.seq), [0, 1, 2, 3]);
});

test('relay restart: producer resends everything, consumer resumes without loss or dupes', () => {
  const all = [ev(0), snap(1), ev(2), snap(3), ev(4)];
  const hub1 = new SessionHub();
  all.slice(0, 3).forEach((m) => hub1.ingest(m));
  const c1 = fakeConsumer(); hub1.attach(S, c1);
  const lastSeenByConsumer = Math.max(...c1.got.map((m) => m.seq)); // 2

  const hub2 = new SessionHub(); // relay restarted, empty
  const { lastSeq } = hub2.producerHello(S); // -1
  all.filter((m) => m.seq > lastSeq).forEach((m) => hub2.ingest(m));
  const c2 = fakeConsumer(); hub2.attach(S, c2, lastSeenByConsumer);
  assert.deepEqual(c2.got.map((m) => `${m.type}:${m.seq}`), ['snapshot:3', 'event:4']);
});

test('detach stops delivery', () => {
  const hub = new SessionHub();
  const c = fakeConsumer();
  const detach = hub.attach(S, c);
  hub.ingest(ev(0)); detach(); hub.ingest(ev(1));
  assert.deepEqual(c.got.map((m) => m.seq), [0]);
});

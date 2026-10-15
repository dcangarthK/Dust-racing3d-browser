import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateRace } from '../bin/gen-mock.mjs';
import { validateLines } from '../lib/validate.mjs';
import { mulberry32 } from '../lib/rng.mjs';

test('mulberry32 is deterministic per seed', () => {
  const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
  const sa = [a(), a(), a()], sb = [b(), b(), b()], sc = [c(), c(), c()];
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
});

test('mock race validates and has expected structure', () => {
  const msgs = generateRace({ cars: 4, laps: 2, seed: 1, hz: 20 });
  const errs = validateLines(msgs.map((m) => JSON.stringify(m)));
  assert.deepEqual(errs, []);
  assert.equal(msgs[0].type, 'event');
  assert.equal(msgs[0].eventType, 'lightsOut');
  assert.equal(msgs.at(-1).type, 'result');
  assert.equal(msgs.at(-1).classification.length, 4);
  const lapEvents = msgs.filter((m) => m.type === 'event' && m.eventType === 'lap');
  assert.equal(lapEvents.length, 4 * 2);
  const finishEvents = msgs.filter((m) => m.type === 'event' && m.eventType === 'finish');
  assert.equal(finishEvents.length, 4);
});

test('telemetry snapshots are ~20 Hz and tMs = tick * 16', () => {
  const snaps = generateRace({ cars: 2, laps: 1, seed: 1, hz: 20 }).filter((m) => m.type === 'snapshot');
  for (const s of snaps) assert.equal(s.tMs, s.tick * 16);
  const gaps = snaps.slice(1).map((s, i) => s.tMs - snaps[i].tMs);
  for (const g of gaps) assert.ok(g === 48 || g === 64, `gap ${g}`);
});

test('tick feed (hz 0) has a snapshot every tick', () => {
  const snaps = generateRace({ cars: 2, laps: 1, seed: 1, hz: 0 }).filter((m) => m.type === 'snapshot');
  snaps.slice(1).forEach((s, i) => assert.equal(s.tick - snaps[i].tick, 1));
});

test('last snapshot before the result is phase finished (hz 20 and hz 0)', () => {
  for (const hz of [20, 0]) {
    const msgs = generateRace({ cars: 3, laps: 2, seed: 1, hz });
    const resultIdx = msgs.findIndex((m) => m.type === 'result');
    const lastSnap = msgs.slice(0, resultIdx).filter((m) => m.type === 'snapshot').at(-1);
    assert.equal(lastSnap.phase, 'finished', `hz ${hz}`);
  }
});

test('final snapshot pos matches classification pos for every car', () => {
  for (const hz of [20, 0]) {
    const msgs = generateRace({ cars: 12, laps: 3, seed: 42, hz });
    const lastSnap = msgs.filter((m) => m.type === 'snapshot').at(-1);
    const result = msgs.at(-1);
    for (const car of lastSnap.cars) {
      const entry = result.classification.find((c) => c.carId === car.id);
      assert.equal(car.pos, entry.pos, `hz ${hz} car ${car.id}`);
    }
  }
});

test('no positionChange for a car after its finish event', () => {
  const msgs = generateRace({ cars: 12, laps: 3, seed: 42, hz: 20 });
  for (const finish of msgs.filter((m) => m.type === 'event' && m.eventType === 'finish')) {
    const late = msgs.filter((m) => m.type === 'event' && m.eventType === 'positionChange' && m.carId === finish.carId && m.seq > finish.seq);
    assert.deepEqual(late.map((m) => m.seq), [], `car ${finish.carId}`);
  }
});

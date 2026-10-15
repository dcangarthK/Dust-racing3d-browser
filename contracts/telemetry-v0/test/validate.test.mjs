import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLines } from '../lib/validate.mjs';

const SID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const base = (over) => ({ sessionId: SID, schemaVersion: '0.1.0', tick: 0, tMs: 0, ...over });
const car = (over = {}) => ({ id: 0, x: 1, y: 2, heading: 0, vx: 0, vy: 0, speedKmh: 0, throttle: 0, brake: 0, steer: 0, gear: 1, lap: 0, progress: 0, pos: 1, ...over });
const line = (o) => JSON.stringify(o);

test('valid snapshot, event and result pass', () => {
  const errs = validateLines([
    line(base({ type: 'snapshot', seq: 0, phase: 'racing', cars: [car()] })),
    line(base({ type: 'event', seq: 1, eventId: 'e1', eventType: 'lightsOut', data: {} })),
    line(base({ type: 'result', seq: 2, classification: [{ carId: 0, pos: 1, laps: 3, totalMs: 1000, bestLapMs: 300 }] })),
  ]);
  assert.deepEqual(errs, []);
});

test('blank and trailing lines are ignored', () => {
  const errs = validateLines(['', line(base({ type: 'event', seq: 0, eventId: 'e', eventType: 'lap', data: {} })), '   ', '']);
  assert.deepEqual(errs, []);
});

test('missing required car field is reported with line number', () => {
  const bad = car(); delete bad.heading;
  const errs = validateLines([line(base({ type: 'snapshot', seq: 0, phase: 'racing', cars: [bad] }))]);
  assert.equal(errs.length > 0, true);
  assert.equal(errs[0].line, 1);
  assert.match(errs[0].message, /heading/);
});

test('non-increasing seq is reported', () => {
  const errs = validateLines([
    line(base({ type: 'event', seq: 5, eventId: 'a', eventType: 'lap', data: {} })),
    line(base({ type: 'event', seq: 5, eventId: 'b', eventType: 'lap', data: {} })),
  ]);
  assert.deepEqual(errs.map((e) => e.line), [2]);
  assert.match(errs[0].message, /seq/);
});

test('duplicate eventId is reported', () => {
  const errs = validateLines([
    line(base({ type: 'event', seq: 0, eventId: 'dup', eventType: 'lap', data: {} })),
    line(base({ type: 'event', seq: 1, eventId: 'dup', eventType: 'lap', data: {} })),
  ]);
  assert.deepEqual(errs.map((e) => e.line), [2]);
  assert.match(errs[0].message, /eventId/);
});

test('mixed sessionId is reported', () => {
  const errs = validateLines([
    line(base({ type: 'event', seq: 0, eventId: 'a', eventType: 'lap', data: {} })),
    line({ ...base({ type: 'event', seq: 1, eventId: 'b', eventType: 'lap', data: {} }), sessionId: '00000000-0000-4000-8000-000000000000' }),
  ]);
  assert.deepEqual(errs.map((e) => e.line), [2]);
  assert.match(errs[0].message, /sessionId/);
});

test('invalid JSON is reported, not thrown', () => {
  const errs = validateLines(['{not json']);
  assert.equal(errs[0].line, 1);
  assert.match(errs[0].message, /JSON/);
});

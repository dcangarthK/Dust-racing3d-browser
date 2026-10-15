import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerpAngle, sampleAt } from '../src/playback.mjs';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('lerpAngle takes the short way across 2π', () => {
  const r = lerpAngle(6.2, 0.1, 0.5); // ~0.18 rad apart via 2π, not 6.1 the long way
  const expected = (6.2 + ((0.1 + 2 * Math.PI - 6.2) / 2)) % (2 * Math.PI);
  close(r, expected);
});

test('lerpAngle handles negative direction', () => {
  close(lerpAngle(0.1, 6.2, 0.5), lerpAngle(6.2, 0.1, 0.5));
});

test('sampleAt interpolates position and heading', () => {
  const frames = [
    { tMs: 0, cars: [{ id: 1, x: 0, y: 0, heading: 0, speedKmh: 0 }] },
    { tMs: 100, cars: [{ id: 1, x: 10, y: 20, heading: 1, speedKmh: 100 }] },
  ];
  const s = sampleAt(frames, 25).get(1);
  close(s.x, 2.5); close(s.y, 5); close(s.heading, 0.25); close(s.speedKmh, 25);
});

test('sampleAt clamps before first and after last frame', () => {
  const frames = [
    { tMs: 100, cars: [{ id: 1, x: 1, y: 1, heading: 0, speedKmh: 0 }] },
    { tMs: 200, cars: [{ id: 1, x: 2, y: 2, heading: 0, speedKmh: 0 }] },
  ];
  assert.equal(sampleAt(frames, 0).get(1).x, 1);
  assert.equal(sampleAt(frames, 999).get(1).x, 2);
});

test('sampleAt keeps cars missing from the next frame at their last pose', () => {
  const frames = [
    { tMs: 0, cars: [{ id: 1, x: 0, y: 0, heading: 0, speedKmh: 0 }, { id: 2, x: 5, y: 5, heading: 0, speedKmh: 0 }] },
    { tMs: 100, cars: [{ id: 1, x: 10, y: 0, heading: 0, speedKmh: 0 }] },
  ];
  const s = sampleAt(frames, 50);
  close(s.get(1).x, 5);
  assert.equal(s.get(2).x, 5);
});

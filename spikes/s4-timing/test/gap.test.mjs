import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GapTracker } from '../lib/gap.mjs';

// Two cars at the same constant speed (0.01 lap per 100 ms), car 1 starting 1000 ms behind car 0.
function constantSpeed(tracker, untilMs) {
  for (let t = 0; t <= untilMs; t += 100) {
    tracker.record(0, (t / 100) * 0.01, t);
    if (t >= 1000) tracker.record(1, ((t - 1000) / 100) * 0.01, t);
  }
}

test('constant speed, 1 s apart → gap 1000 ms', () => {
  const g = new GapTracker();
  constantSpeed(g, 5000);
  assert.equal(Math.round(g.gapMs(1, 0)), 1000);
});

test('interpolates between samples', () => {
  const g = new GapTracker();
  g.record(0, 0.0, 0);
  g.record(0, 0.1, 1000);
  g.record(1, 0.05, 1200); // car 0 was at 0.05 at t=500 → gap 700
  assert.equal(Math.round(g.gapMs(1, 0)), 700);
});

test('gap reflects braking ahead (time-at-position, not distance/speed)', () => {
  const g = new GapTracker();
  // Car 0 passes distance 0.5 at t=5000, then slows down.
  g.record(0, 0.4, 4000); g.record(0, 0.5, 5000); g.record(0, 0.52, 6000);
  g.record(1, 0.5, 5600); // car 1 reaches 0.5 at 5600 → gap 600 regardless of car 0's current speed
  assert.equal(Math.round(g.gapMs(1, 0)), 600);
});

test('null when behind car is actually further along', () => {
  const g = new GapTracker();
  g.record(0, 0.2, 1000);
  g.record(1, 0.3, 1000);
  assert.equal(g.gapMs(1, 0), null);
});

test('null when ahead car history does not reach back (lapped / evicted)', () => {
  const g = new GapTracker({ capacity: 4 });
  for (let i = 0; i < 10; i++) g.record(0, 1 + i * 0.1, 1000 + i * 100); // only last 4 kept: 1.6..1.9
  g.record(1, 1.2, 2000);
  assert.equal(g.gapMs(1, 0), null);
});

test('null for unknown car ids', () => {
  const g = new GapTracker();
  g.record(0, 0.1, 100);
  assert.equal(g.gapMs(1, 0), null);
  assert.equal(g.gapMs(0, 9), null);
});

test('distance helper is lap + progress', () => {
  assert.equal(GapTracker.distance({ lap: 2, progress: 0.25 }), 2.25);
});

#!/usr/bin/env node
// Mock race on a circular track in contract v0 format. Used by S3/S4 before S1 produces real data.
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mulberry32 } from '../lib/rng.mjs';

const TICK_MS = 16;
const LAP_M = 1000;
const RADIUS = LAP_M / (2 * Math.PI);
const CENTER = { x: 400, y: 300 };

/** Finish order: earlier finishedTick first, ties broken by car id. */
const byFinish = (a, b) => a.finishedTick - b.finishedTick || a.id - b.id;

/**
 * Running order. Finished cars rank ahead of all unfinished cars, in finish order and
 * frozen there. Unfinished cars follow, sorted by distance travelled.
 */
function rankOrder(field) {
  const done = field.filter((c) => c.finishedTick !== null).sort(byFinish);
  const running = field.filter((c) => c.finishedTick === null).sort((a, b) => b.dist - a.dist);
  return [...done, ...running].map((c) => c.id);
}

export function generateRace({ cars, laps, seed, hz }) {
  const rand = mulberry32(seed);
  const sessionId = randomUUID();
  const out = [];
  let seq = 0;
  let eventN = 0;
  const common = (tick) => ({ sessionId, schemaVersion: '0.1.0', seq: seq++, tick, tMs: tick * TICK_MS });
  const event = (tick, eventType, carId, data = {}) =>
    out.push({ type: 'event', ...common(tick), eventId: `e${eventN++}`, eventType, ...(carId === undefined ? {} : { carId }), data });

  const field = Array.from({ length: cars }, (_, id) => ({
    id,
    speed: 40 + rand() * 5, // m/s
    dist: -id * 8,          // staggered grid, metres behind the line
    lap: 0,
    lastLapTick: 0,
    bestLapMs: null,
    finishedTick: null,
  }));
  const periodMs = hz > 0 ? 1000 / hz : 0;
  let lastBucket = -1;
  let order = field.map((c) => c.id);

  event(0, 'lightsOut');
  for (let tick = 1; field.some((c) => c.finishedTick === null); tick++) {
    // Lap/finish events are buffered so positionChange for this tick can go out first:
    // a car's positionChange must never follow its own finish event.
    const pending = [];
    for (const c of field) {
      if (c.finishedTick !== null) continue;
      c.dist += c.speed * (TICK_MS / 1000);
      const lapNow = Math.max(0, Math.floor(c.dist / LAP_M));
      if (lapNow > c.lap) {
        const lapMs = (tick - c.lastLapTick) * TICK_MS;
        c.bestLapMs = c.bestLapMs === null ? lapMs : Math.min(c.bestLapMs, lapMs);
        c.lap = lapNow;
        c.lastLapTick = tick;
        pending.push(['lap', c, { lap: c.lap, lapMs }]);
        if (c.lap >= laps) {
          c.finishedTick = tick;
          pending.push(['finish', c, {}]);
        }
      }
    }
    const newOrder = rankOrder(field);
    newOrder.forEach((id, i) => {
      if (order[i] !== id) event(tick, 'positionChange', id, { pos: i + 1 });
    });
    order = newOrder;
    for (const [eventType, c, data] of pending) event(tick, eventType, c.id, data);

    const allDone = field.every((c) => c.finishedTick !== null);
    const bucket = periodMs > 0 ? Math.floor((tick * TICK_MS) / periodMs) : tick;
    // The final tick always gets a snapshot so the last snapshot carries phase 'finished'.
    if (bucket !== lastBucket || allDone) {
      lastBucket = bucket;
      out.push({
        type: 'snapshot',
        ...common(tick),
        phase: allDone ? 'finished' : 'racing',
        cars: field.map((c) => {
          const lapFrac = (((c.dist % LAP_M) + LAP_M) % LAP_M) / LAP_M;
          const theta = lapFrac * 2 * Math.PI;
          const done = c.finishedTick !== null;
          return {
            id: c.id,
            x: CENTER.x + RADIUS * Math.cos(theta),
            y: CENTER.y + RADIUS * Math.sin(theta),
            heading: (theta + Math.PI / 2) % (2 * Math.PI),
            vx: done ? 0 : -c.speed * Math.sin(theta),
            vy: done ? 0 : c.speed * Math.cos(theta),
            speedKmh: done ? 0 : c.speed * 3.6,
            throttle: done ? 0 : 1,
            brake: 0,
            steer: done ? 0 : 0.2,
            gear: done ? 0 : 5,
            lap: Math.min(c.lap, laps),
            progress: lapFrac,
            pos: order.indexOf(c.id) + 1,
          };
        }),
      });
    }
  }
  const lastTick = out.at(-1).tick;
  const classified = [...field].sort(byFinish);
  out.push({
    type: 'result',
    ...common(lastTick),
    classification: classified.map((c, i) => ({ carId: c.id, pos: i + 1, laps, totalMs: c.finishedTick * TICK_MS, bestLapMs: c.bestLapMs })),
  });
  return out;
}

function parseArgs(argv) {
  const args = { cars: 12, laps: 3, seed: 42, hz: 20 };
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = Number(argv[i + 1]);
  return args;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const m of generateRace(parseArgs(process.argv.slice(2)))) process.stdout.write(JSON.stringify(m) + '\n');
}

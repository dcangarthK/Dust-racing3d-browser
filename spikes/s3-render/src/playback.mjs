const TAU = 2 * Math.PI;

/** Interpolate between angles a→b (radians) along the shortest arc. Result in [0, 2π). */
export function lerpAngle(a, b, t) {
  let d = ((b - a) % TAU + TAU) % TAU;
  if (d > Math.PI) d -= TAU;
  return (((a + d * t) % TAU) + TAU) % TAU;
}

function upperIndex(frames, tMs) {
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].tMs < tMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Pose of every car at tMs, interpolated between the bracketing snapshots. */
export function sampleAt(frames, tMs) {
  const out = new Map();
  if (frames.length === 0) return out;
  if (tMs <= frames[0].tMs) { for (const c of frames[0].cars) out.set(c.id, { ...c }); return out; }
  const last = frames[frames.length - 1];
  if (tMs >= last.tMs) { for (const c of last.cars) out.set(c.id, { ...c }); return out; }
  const i1 = upperIndex(frames, tMs);
  const f0 = frames[i1 - 1], f1 = frames[i1];
  const t = (tMs - f0.tMs) / (f1.tMs - f0.tMs);
  const next = new Map(f1.cars.map((c) => [c.id, c]));
  for (const a of f0.cars) {
    const b = next.get(a.id);
    if (!b) { out.set(a.id, { ...a }); continue; }
    out.set(a.id, {
      ...b,
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      heading: lerpAngle(a.heading, b.heading, t),
      speedKmh: a.speedKmh + (b.speedKmh - a.speedKmh) * t,
    });
  }
  return out;
}

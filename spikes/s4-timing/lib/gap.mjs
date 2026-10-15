/**
 * Time-at-position gaps, after apex-gp src/game/race.js:134: "how long ago was the car ahead
 * where I am now?" — robust under braking, unlike distance / speed.
 * Each car keeps a ring buffer of (distance, tMs); distance = lap + progress (monotonic).
 */
export class GapTracker {
  constructor({ capacity = 2048 } = {}) {
    this.capacity = capacity;
    this.buffers = new Map(); // carId -> { d: Float64Array, t: Float64Array, start, size }
  }

  static distance(car) {
    return car.lap + car.progress;
  }

  record(carId, distance, tMs) {
    // Ignore non-finite samples and backward distances: gapMs relies on distance being sorted.
    if (!Number.isFinite(distance) || !Number.isFinite(tMs)) return;
    let b = this.buffers.get(carId);
    if (!b) {
      b = { d: new Float64Array(this.capacity), t: new Float64Array(this.capacity), start: 0, size: 0 };
      this.buffers.set(carId, b);
    }
    if (b.size > 0 && distance < this.#at(b, b.size - 1)[0]) return;
    const idx = (b.start + b.size) % this.capacity;
    b.d[idx] = distance;
    b.t[idx] = tMs;
    if (b.size < this.capacity) b.size++;
    else b.start = (b.start + 1) % this.capacity;
  }

  #at(b, i) {
    const k = (b.start + i) % this.capacity;
    return [b.d[k], b.t[k]];
  }

  gapMs(behindId, aheadId) {
    const behind = this.buffers.get(behindId);
    const ahead = this.buffers.get(aheadId);
    if (!behind?.size || !ahead?.size) return null;
    const [dNow, tNow] = this.#at(behind, behind.size - 1);
    if (!Number.isFinite(dNow)) return null;
    const [dFirst] = this.#at(ahead, 0);
    const [dLast] = this.#at(ahead, ahead.size - 1);
    if (dNow > dLast || dNow < dFirst) return null;
    // Binary search for the first sample with distance >= dNow.
    let lo = 0, hi = ahead.size - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.#at(ahead, mid)[0] < dNow) lo = mid + 1;
      else hi = mid;
    }
    const [d1, t1] = this.#at(ahead, lo);
    let tCross = t1;
    if (lo > 0 && d1 !== dNow) {
      const [d0, t0] = this.#at(ahead, lo - 1);
      tCross = t0 + ((dNow - d0) / (d1 - d0)) * (t1 - t0);
    }
    const gap = tNow - tCross;
    return gap >= 0 ? gap : null;
  }
}

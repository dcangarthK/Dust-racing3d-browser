/**
 * In-memory telemetry session hub. Pure (no network) so resume/dedupe/backpressure are unit-testable.
 * Stores all events/results (small) and only the latest snapshot (superseded snapshots are worthless live).
 */
export class SessionHub {
  constructor({ highWaterBytes = 256 * 1024 } = {}) {
    this.highWaterBytes = highWaterBytes;
    this.sessions = new Map(); // id -> { lastSeq, log: msg[], latestSnapshot, consumers: Map<consumer, floorSeq> }
  }

  #session(id) {
    let s = this.sessions.get(id);
    if (!s) {
      s = { lastSeq: -1, log: [], latestSnapshot: null, consumers: new Map() };
      this.sessions.set(id, s);
    }
    return s;
  }

  sessionIds() {
    return [...this.sessions.keys()];
  }

  producerHello(sessionId) {
    return { type: 'hello', sessionId, lastSeq: this.#session(sessionId).lastSeq };
  }

  ingest(msg) {
    const s = this.#session(msg.sessionId);
    if (msg.seq <= s.lastSeq) return false;
    s.lastSeq = msg.seq;
    if (msg.type === 'snapshot') s.latestSnapshot = msg;
    else s.log.push(msg);
    const raw = JSON.stringify(msg);
    for (const [c, floor] of s.consumers) {
      // Floor = highest seq already sent to this consumer (or its fromSeq). Skips re-sent
      // messages after a relay restart when the consumer attached before the producer re-sent.
      if (msg.seq <= floor) continue;
      if (msg.type === 'snapshot' && c.bufferedAmount > this.highWaterBytes) continue;
      c.send(raw);
      s.consumers.set(c, msg.seq);
    }
    return true;
  }

  attach(sessionId, consumer, fromSeq = -1) {
    const s = this.#session(sessionId);
    const replay = s.log.filter((m) => m.seq > fromSeq);
    if (s.latestSnapshot && s.latestSnapshot.seq > fromSeq) replay.push(s.latestSnapshot);
    replay.sort((a, b) => a.seq - b.seq);
    let floor = fromSeq;
    for (const m of replay) {
      consumer.send(JSON.stringify(m));
      floor = m.seq;
    }
    s.consumers.set(consumer, floor);
    return () => s.consumers.delete(consumer);
  }
}

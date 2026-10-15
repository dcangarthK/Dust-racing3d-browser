# Telemetry v0 samples

- `mock-12car-3lap.telemetry.ndjson`: synthetic feed from `bin/gen-mock.mjs` (cars on a constant-speed circle).
- `s1-monza-1car.telemetry.ndjson`, `s1-monza-12car.telemetry.ndjson`: real output of the Phase 0 S1 headless harness (Monza, 3 laps, telemetry-rate feed of about 20 Hz; no tick-feed sample is committed).

All three validate against `schema.json`, but they are **not golden fixtures**. The S1 files carry known defects (details in `docs/phase0/findings/s1.md` and `docs/phase0/findings.md`, decision 6):

- `pos` is clamped: `Race::position()` is 0 until a car reaches checkpoint 0, so every car reports `pos` 1 in the early ticks.
- Grid order is reversed against the driving direction: car 0 starts at the rear but is labelled pole.
- Both S1 files share one `sessionId`, so a relay that already holds the session ignores a replay of the other.
- `speedKmh` is the game's display speed and reads about 12 % low against `|(vx, vy)|`.
- `lap` events carry no `lapMs`.
- Also: tick labels lag one step, and `progress` skips the last ~4 % of each lap.

Phase 1/2 golden tests must record fresh output from the fixed emitter, not these files.

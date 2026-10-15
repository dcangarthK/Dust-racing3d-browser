# Phase 1 — Simulation Stabilization — Design

**Date:** 2026-10-15
**Status:** Design approved section by section (CI host, interpolation scope, parity sign-off, test-harness approach, §3–§8). Awaiting written-spec review.
**Parent:** [DustRacing2D Upgrade — Scope & Phased Plan (rev 3)](2026-10-15-dustracing2d-upgrade-scope.md), Phase 1.
**Inputs:** [Phase 0 findings](../../phase0/findings.md) (decisions 2, 3, 6; open items), [S1](../../phase0/findings/s1.md), [dependency map and hack log](../../phase0/dependency-map.md).

---

## 1. Purpose

Make the existing DustRacing2D desktop game's simulation deterministic and guarded by tests, without changing how it feels, so that Phase 2 can extract it into `libdustsim` against a golden baseline.

Concretely:

1. The desktop game steps the simulation on a **16 ms fixed tick** with an integer tick counter, a 5-tick catch-up cap and render interpolation.
2. The simulation draws from a **seeded, portable sim RNG**, split from the cosmetic RNG **before** any golden test is recorded.
3. Collision and contact processing follow **per-world stable object IDs**, not heap addresses.
4. A **characterisation suite**, **golden-race hash tests** and **track/asset validation** run in CI on macOS arm64 and Ubuntu x86-64.
5. Desktop collision behaviour and feel are shown to be unchanged: a statistical **parity gate** plus the user's drive test.

### Non-goals

- No `SimConfig` refactor, Qt-signal removal or link-time MiniCore split (Phase 2). `Game`, `Database` and number plates are stubbed in tests only.
- No telemetry emitter and no change to `contracts/telemetry-v0` (Phase 2; see §7.3).
- No sectors, gaps or timing-model work (Phase 2).
- No start-light rework (Phase 5): the desktop countdown stays on its wall-clock `QTimer`.
- No 120 Hz, no WASM build, no x86-64 vs arm64 equality.

---

## 2. Findings that shape this design

Read from `main` (upstream DustRacing2D v2.2.0) during brainstorming, in addition to Phase 0:

| # | Finding | Consequence |
|---|---|---|
| F1 | No CI runs. The only workflow is `DustRacing2D/.github/workflows/ci.yml`, inside the subtree, which GitHub never runs. The monorepo has no `origin` remote. | Root workflow plus a GitHub remote the user creates (§3). |
| F2 | `MCRandom` fills its LUT with `std::uniform_real_distribution`, whose output is implementation-defined: libc++ (macOS, Emscripten) and libstdc++ (Ubuntu) differ. | Sim RNG converts raw bits to floats itself (§5.1). |
| F3 | `MCRandom::setSeed` is never called (seed is always 0). AI (`ai.cpp:61`), particles, `CarParticleEffectManager`, `Tree`, `TrackObjectFactory` tree parameters and menu text all draw from the one global stream. | RNG split (§5.1). |
| F4 | `Race::moveCarOntoPreviousCheckPoint` (`race.cpp:645`) constructs a default-seeded `std::mt19937` on every call, so every stuck car gets the same "random" offset (upstream bug), through the same non-portable distribution. | Draws from the sim RNG; intentional behaviour change (§5.1, risk 5). |
| F5 | Start lights run on a wall-clock `QTimer` (`startlights.cpp:33`), so the desktop race-start tick is not deterministic. | Tests skip the countdown and call `Race::start()` at tick 0, as S1 did (§4.3). |
| F6 | Particles are physics objects in `MCWorld` with `bypassCollisions`. Tree branches are non-physics child objects whose count and offsets come from `MCRandom`. | Stable IDs only for objects that collide (§5.2). |
| F7 | `MCImpulseGenerator::resolvePositions` and `generateImpulsesFromDeepestContacts` iterate `MCWorld::m_objects` in vector order, and `removeObjectFromIntegration` swap-removes. Particle churn (driven by the cosmetic RNG) therefore reorders the impulse and resolve passes. | Those passes iterate an ID-ordered collidable list (§5.2). S1's rows 39–42 did not cover this. |
| F8 | `MCSurface` construction needs a GL context unless S1's `MC_HEADLESS` guards (rows 1–23) are present. | Tests use the headless build of MiniCore (§3.2). |
| F9 | Upstream `DustRacing2D/.gitignore` ignores `unittests/`, `test/`, `*.json`, `build*`, `*__*`. The existing `src/game/unittests/gearboxtest` is tracked only because it was force-added upstream. | Ignore-rule negations (§3.1). |
| F10 | `Scene::setActiveTrack` calls `m_world.clear()` and re-adds the same `Car` objects for each race. | IDs are scoped to a world generation (§5.2). |
| F11 | `Tree`'s collision shape is a fixed `treeBodyRadius` circle; the random parameters only affect branch visuals. | Tree randomness is genuinely cosmetic (§5.1). |

---

## 3. Infrastructure and harness

### 3.1 Repository and CI

- **Ignore rules.** Add negations to `DustRacing2D/.gitignore` (after the existing patterns):
  ```gitignore
  !src/game/unittests/
  !src/game/simtests/
  !src/game/simtests/**
  !src/game/simtests/**/*.json
  ```
  Verify with `git check-ignore -v` on a sample fixture before the first fixture commit. The negation is a deliberate local divergence from upstream and is recorded in the plan.
- **GitHub remote.** The user creates the GitHub repository and adds it as `origin`. That step is outward-facing, so the plan asks the user to do it; the agent does not push to a new remote.
- **Root workflow** `.github/workflows/sim.yml`:
  - Triggers: `push` and `pull_request` on `main`; `workflow_dispatch` with an input that runs the parity gate.
  - Jobs: `ubuntu-24.04` (x86-64, apt Qt 6.4, OpenAL, vorbis, `QT_QPA_PLATFORM=offscreen`) and `macos-14` (arm64, Homebrew Qt 6, OpenAL Soft, libvorbis, using the extra flags from `docs/phase0/desktop-build.md`).
  - Each job configures RelWithDebInfo with `-DDUST_SIM_TESTS=ON`, builds the desktop game and `simtests`, and runs `ctest`.
  - Upstream's subtree workflow stays untouched and inert.

### 3.2 Build targets

- **`MC_HEADLESS`.** Adopt S1 hack rows 1–23 (tag `phase0-spikes`, branch `spike/s1-headless`) as real code. Every guard is `#ifdef MC_HEADLESS`, so behaviour with the macro undefined is unchanged. Phase 2 replaces these guards with the link-time MiniCore split.
- **CMake option `DUST_SIM_TESTS`** (default `ON` when building tests). When on:
  - `minicore_headless`: MiniCore compiled with `MC_HEADLESS`, `__MC_NO_GLEW__`, without `contrib/glew`.
  - `dustsim_headless`: the game's simulation sources compiled against `minicore_headless`: `car`, `tire`, `gearbox`, `carphysicscomponent`, `carfactory`, `race`, `timing`, `ai`, `track`, `trackdata`, `trackloader`, `tracktile`, `trackobject`, `trackobjectfactory`, `tree`, `bridge`, `pit`, `offtrackdetector`, `difficultyprofile`, `layers`, `particlefactory`, `carparticleeffectmanager`, `carsoundeffectmanager`, `audio/audiosource`, `graphicsfactory`, `racesetup`, `simrandom`, plus `MCTextureFontManager` sources (row 32). The plan fixes the exact list against the linker.
  - `simtests`: Qt Test executable linking `dustsim_headless`, Qt Core/Xml/Gui and the test-only stubs.
- The desktop `dustrac-game` keeps its current target layout. It gains `racesetup.cpp` and `simrandom.cpp` as ordinary sources.
- **Sim build flags.** `-ffp-contract=off` and no `-ffast-math`/`-Ofast` on MiniCore (both variants), the game's simulation sources (desktop and headless) and `simtests`. This is brought forward from Phase 2 (scope §7) so that Phase 2 does not invalidate the golden fixtures. Apply it with a `dust_sim_flags()` CMake function so Phase 2 reuses it.

### 3.3 Seams fixed in the real code

These are crash seams S1 hit, fixed properly rather than stubbed:

| S1 row | Fix |
|---|---|
| 38 | `Car::updateAnimations` null-checks `m_soundEffectManager` before use (`car.cpp:301`). |
| 37 | `ParticleFactory` becomes optional: `ParticleFactory::instanceOrNull()`; callers (`Car`, `CarParticleEffectManager`) skip particle creation when it is null. `Scene` still creates it, so the desktop is unchanged. |
| 33–35 | `Renderer::instance()` call sites in `trackobjectfactory.cpp`, `bridge.cpp` and `track.cpp` wrapped in `#ifndef MC_HEADLESS`, same shape as S1. |
| 36 | `GraphicsFactory::generateNumberSurface` takes the S1 headless branch under `MC_HEADLESS` (blank 32×32 `QImage`). |

Test-only stubs under `src/game/simtests/stubs/`: `Game` (rows 26–27; difficulty Medium, configurable lap count, mode `OnePlayerRace`), `Database` (row 28; no records, all tracks unlocked). `game.hpp`'s `Application m_app` member is guarded with `#ifndef MC_HEADLESS` (row 29).

### 3.4 `RaceSetup`

Extract the race-construction code from `Scene` into `RaceSetup` (`src/game/racesetup.{hpp,cpp}`) so the desktop game and the tests build races through the same code:

- inputs: `Track &`, car count, human-player count, lap count, sim seed, an optional `ParticleFactory *`;
- does: `MCWorld::clear()`; creates the `SimRandom`; places track objects (`Scene::createNormalObjects` / `createBridgeObjects`, including the mesh base-z offset and `Pit::pitStop` → `Race::pitStop` wiring S1 mirrored); places cars on the grid; creates AI controllers; initialises `Race` and `Timing`;
- owns: the `SimRandom`, the AI list, and the per-race tick counter's reset.

`Scene` keeps cameras, overlays, audio wiring and menus, and calls `RaceSetup` from `setActiveTrack`. `RaceSetup` is a behaviour-preserving move, guarded by the existing 5 ctests plus a desktop launch smoke test (launch, start a race, no crash in the log).

### 3.5 `simtests` layout

```text
DustRacing2D/src/game/simtests/
  CMakeLists.txt
  stubs/                  stub_game.cpp, stub_database.cpp
  harness/                SimHarness (RaceSetup driver, stepping, hashing, event log, input scripts)
  characterization/       laps, positions, pits, finish, collisions, recovery, startup
  determinism/            repeatability, cosmetic invariance, allocation-order invariance
  golden/                 golden_test.cpp + fixtures/<platform>/*.json
  parity/                 parity_runner.cpp + baseline-macos-arm64.json
  validation/             track_asset_validation.cpp
  inputs/                 *.input scripted-input files
```

`SimHarness` steps `Scene`-equivalent logic per tick: process inputs, update AI, `MCWorld::stepTime(16)`, `Race::update(16 ms)`, tick counter. It mirrors `Scene::updateFrame`'s order exactly; the plan extracts that order into one shared function if the duplication would be more than a few lines.

Budget: full `simtests` (excluding the parity gate) at most about 2 minutes per OS. Monza, 12 cars, 3 laps runs in about 7 s in S1.

---

## 4. Fixed tick

### 4.1 Game loop (`game.cpp`)

Replace the averaged whole-ms delta (`game.cpp:110–118`) with an accumulator:

```text
on frame (QTimer, interval unchanged):
    now = elapsedTimer.nsecsElapsed()
    acc += now - last; last = now
    stateMachine.update()               // once per frame, as today
    steps = 0
    while acc >= 16 ms and steps < 5:
        scene.updateFrame(input, 16 ms)
        acc -= 16 ms; ++steps
    if steps == 5: acc = min(acc, 16 ms - 1 ns)   // drop the excess: time dilates, no spiral
    alpha = acc / 16 ms
    scene.updateOverlays()
    renderer.renderNow(alpha)
```

- `acc` resets to 0 on pause, on unpause, and on every state-machine state change, so there is no catch-up burst after menus, loading or a pause.
- The menu state also runs on 16 ms ticks (`MenuManager::stepTime`). It is not part of the sim, but one code path is simpler.
- `QTimer` remains the frame pump. Vsync behaviour is unchanged.

### 4.2 Tick counter and timing

- `Race` owns `uint64_t m_tick`, reset to 0 by `RaceSetup` and incremented at the end of each step. **Tick N is the state after N steps** (`tMs = N × 16`), so the first step produces tick 1. This fixes S1's one-step label lag at the source; every test, fixture and log uses this numbering.
- `Timing` stores tick counts, not summed `timeStep`. Race time is `(tick − startTick) × 16 ms`, and lap time is the tick delta between line crossings × 16 ms. Lap and race times stay in whole milliseconds and are multiples of 16. Records stored in the `Database` keep their millisecond format.
- `Race::update` and `Timing::tick` keep their `std::chrono::milliseconds` parameter for now and assert it equals 16 ms.

### 4.3 Start lights

The desktop countdown keeps its wall-clock `QTimer`. The world still steps during `DoStartlights`, as today, so cars sit on the grid. Tests skip the countdown and call `Race::start()` at tick 0, as S1 did. A tick-driven start sequence is Phase 5's five-light start.

### 4.4 Frame-counted constants

Some sim logic counts update calls and assumes 60 calls per second. Under the fixed tick these count ticks at 62.5 Hz. They are converted to tick counts that keep the intended wall time, through `constexpr int ticksFor(int ms)` (rounded to nearest):

| Site | Upstream | Phase 1 |
|---|---|---|
| `race.cpp:591` `STUCK_LIMIT` | `++counter >= 60 * 5` ("5 secs") | `>= ticksFor(5000)` = 313 ticks (5008 ms) |
| `race.cpp:616` `OFF_TRACK_LIMIT` (human message only) | `> 60` ("1 sec") | `> ticksFor(1000)` = 63 ticks |
| `gearbox.cpp:46` reverse delay | `++counter > 30` (31 frames, about 517 ms at 60 Hz; comment "~0.5 sec") | `++counter >= ticksFor(500)` = 31 ticks (496 ms) |

The particle density counters in `CarParticleEffectManager` are cosmetic and stay as they are. The plan greps for further frame-counted constants (`60`, `30`, `* 60`, `/ 60` in sim sources) and adds any it finds to this table. The gearbox count stays 31, so `gearboxtest` is unaffected.

### 4.5 Render interpolation (desktop only)

Scope: cars, their child objects (number plates, tyre visuals) and the camera. Particles and static objects are not interpolated.

- `MCObject` gains render-only state: `m_interpolated` flag, `m_prevLocation`, `m_prevAngle`, and a `capturePreviousPose()` method. `RaceSetup` flags each car and its children.
- At the start of each sim step, `MCWorld::stepTime` calls `capturePreviousPose()` on every flagged object.
- The GL renderer (`MCSurfaceObjectRenderer`, `MCSurfaceObjectRendererLegacy` and the shadow paths) draws a flagged object at `lerp(prev, cur, alpha)`, with angles along the shortest arc. The renderer receives `alpha` from `Renderer::renderNow(alpha)` through `MCWorld::render`.
- The camera follows the interpolated pose of the player's car (`Scene::updateCameraLocation`).
- The sim never reads the previous pose. A determinism test (§6.2) confirms sim hashes are identical with interpolation flags on and off.
- These renderer edits sit in the GL-only code that `MC_HEADLESS` compiles out, so the headless build is unaffected.

---

## 5. RNG and collision order

### 5.1 Sim RNG and cosmetic RNG

- **`SimRandom`** (`src/game/simrandom.{hpp,cpp}`):
  - xoshiro256** seeded through SplitMix64 from a 64-bit seed; implemented in the repo (about 40 lines), no `<random>`;
  - `float uniform()` = `(next() >> 40) × 2⁻²⁴`, giving [0, 1) from the top 24 bits; `uniform(a, b)`; `vector2d()` matching `MCRandom::randomVector2d`'s range;
  - state is 32 bytes, exposed as `state()` / `setState()` for hashing now and Phase 2 keyframes;
  - one instance per race, owned by `RaceSetup`, passed by reference to consumers. No global.
- **Sim consumers:**
  - `AI::setRandomTolerance` (`ai.cpp:61`);
  - `Race::moveCarOntoPreviousCheckPoint` (`race.cpp:645`), replacing the per-call `std::mt19937`. This fixes F4 (stuck cars all sent to the same offset). It is an intentional behaviour change, covered by the AI-recovery test and the parity gate's stuck metric.
- **Cosmetic consumers** keep using `MCRandom`, which becomes the cosmetic stream: `ParticleFactory`, `CarParticleEffectManager`, `Tree`, `TrackObjectFactory` tree parameters, menu text. F11 confirms trees are cosmetic. `MCRandom` gets `setSeed` called once from `Scene`/`SimHarness` (cosmetic seed, default 0); its distribution stays as it is, since it no longer feeds the sim.
- `race.cpp:621` `rand()` (picks an off-track message string) is left as is.
- **Desktop seed:** sim seed 0 by default; a `--seed N` command-line option sets it, so the user's drive test can be repeated.

### 5.2 Stable IDs

- `MCObject` gains `uint32_t stableId() const` (0 = none) and a private world-generation tag.
- `MCWorld` keeps a `uint32_t m_nextStableId` and `uint32_t m_generation`. `clear()` resets the counter to 1 and increments the generation.
- `MCWorld::addObject` assigns the next ID when `isPhysicsObject() && !bypassCollisions()` and the object has no ID for the current generation. An object keeps its ID until the world is cleared, including across `removeObject`/`addObject` in the same generation.
- Particles (`bypassCollisions`) and tree branches (non-physics) never get an ID, so cosmetic churn cannot shift IDs (F6).
- Determinism follows from the add order, which is deterministic: `RaceSetup` adds track objects in file order and cars in index order (F10).
- Debug builds assert ID uniqueness within a generation.

### 5.3 Ordering sites

All unguarded, so the desktop game gets the same order (validated by the parity gate, §6.4).

| Site | Upstream | Phase 1 |
|---|---|---|
| `MCObjectGrid::getPossibleCollisions` (S1 row 40) | Pairs from `std::set<MCObject *>` cells, address order | Each pair oriented lower-ID first; the pair list sorted by `(idA, idB)` before return. |
| `MCCollisionDetector::CollisionMap` and inner sets (S1 row 41) | `std::map<MCObject *, std::set<MCObject *>>`, iterated live while inserting | Keyed by the value type `ObjectKey { uint32_t id; MCObject * ptr; }`, compared by `id` then `ptr`. The comparator never dereferences, which avoids the crash in S1's first attempt (a dangling key after `~MCObject`). Iterated **live**, as upstream, so pairs inserted during a pass are still re-tested in that pass. Only the order changes, which replaces S1's snapshot. |
| `MCObject::ContactHash` (S1 row 42) | `std::map<MCObject *, std::vector<MCContact *>>` | Keyed by `ObjectKey`. |
| `MCImpulseGenerator::resolvePositions`, `generateImpulsesFromDeepestContacts` (F7, new) | Iterate `MCWorld::m_objects` (swap-remove order) | Iterate `MCWorld::m_collidables`, a vector of objects with an ID, kept sorted by ID on add/remove. Objects without an ID never have contacts, so the set of objects visited is unchanged. |
| `MCWorld::integratePhysics` | `m_objects` order | Unchanged: each object's integration is independent, and `MCForceRegistry` writes only its own object's forces (dependency-map note). |

`MCCollisionDetector::remove()` builds its key from the object being destroyed. It runs in `~MCObject`'s body, where `stableId()` is still readable.

**Fallback (risk 1):** if live `ObjectKey` iteration fails the parity gate, use S1 row 41's snapshot iteration, with its semantic change recorded in the hack log and this spec.

---

## 6. Tests

### 6.1 Characterisation (written before any behaviour change)

These are property-based, so they hold on upstream semantics and after §4–§5. In step 3 (§8) they run through a **jittered-dt adapter** that reproduces the upstream loop: per-step dt drawn from the averaged-delta distribution of a 60 Hz `QTimer` (16/17 ms with occasional 33 ms), seeded, with address-ordered collisions because §5 has not landed yet.

Tracks: Monza, Suzuka, Twister. Twelve AI cars, 3 laps, unless stated.

| Area | Properties |
|---|---|
| Laps | Every car completes 3 laps. Each lap counter rises by exactly 1 per line crossing. Every lap time lies between a plausibility floor and ceiling per track (set from the baseline run, ±50 %). |
| Positions | After every car has passed checkpoint 0, positions on each tick are a permutation of 1..N and agree with route progress (lap, then node, then fraction). The final classification is sorted by race time. |
| Pits | A scripted car on lap ≥ 1 (`Race::pitStop` ignores lap 0) driven onto the pit tile triggers `Race::pitStop`, and its tyre wear and damage reset. |
| Finish | The race reaches its finished state. Every car has a finish time. Timing stops. |
| Collisions | Head-on car vs car on a straight: a collision is detected, impulses are exchanged (both velocity vectors change sign along the normal), and interpenetration after resolve is below ε. Car vs wall: the car stops at the wall and does not tunnel through it over 300 ticks. |
| AI recovery | A car placed off-route against a wall is flagged stuck, moved to its previous checkpoint within the stuck timeout, and completes its remaining laps. |
| Startup | Each of the 16 tracks runs `RaceSetup` plus 300 ticks with 12 cars without a crash or assertion (scope risk 5). |

Sectors are not tested: the game has none. They arrive with Phase 2's timing model.

### 6.2 Determinism (after §4–§5)

- **Repeatability in one process:** run the same race twice in one process and require identical hash streams and event logs. This also catches a missing per-world ID reset.
- **Cosmetic invariance:** require identical sim hashes for cosmetic seeds 0 and 1, and with `ParticleFactory` null.
- **Allocation-order invariance:** allocate and free a seeded number of dummy heap blocks before `RaceSetup` to shift object addresses, and require identical hashes.
- **Interpolation invariance:** require identical hashes with interpolation flags on and off.

### 6.3 Golden races

- **State hash** every 60 ticks: FNV-1a 64 over the raw IEEE bits of each car's `x, y, angle, vx, vy, angularVelocity`, plus each car's lap, position and current checkpoint index, plus `SimRandom::state()`.
- **Event log**, exact: `lap` (car, lap, `lapMs`), `position` changes, `pit`, `finish`, `stuck` and `recovered`, each stamped with its tick.
- **Cases:**

  | Fixture | Track | Cars | Seed | Laps | Input |
  |---|---|---|---|---|---|
  | `monza-12-s42` | Monza | 12 AI | 42 | 3 | — |
  | `suzuka-12-s42` | Suzuka | 12 AI | 42 | 3 | — |
  | `twister-12-s42` | Twister | 12 AI | 42 | 3 | — |
  | `monza-1-s42` | Monza | 1 AI | 42 | 3 | — |
  | `monza-input-s7` | Monza | car 0 scripted, 11 AI | 7 | 2 | `inputs/monza-lap.input` |

- **Input script format** (`*.input`): one line per change, `tick accelerate brake left right` (0/1 each), held until the next line. This is the Phase 1 input contract (§7.1).
- **Fixture** `golden/fixtures/<platform>/<case>.json`, with `platform` one of `macos-arm64` or `linux-x86_64`:
  ```json
  { "case": "monza-12-s42", "schema": 1, "tickMs": 16, "hashEvery": 60,
    "compiler": "...", "flags": "-ffp-contract=off",
    "hashes": ["<hex64>", "..."], "events": [{"tick": 0, "type": "...", "data": {}}] }
  ```
- Each platform compares only against its own fixtures. Cross-platform equality is not required in Phase 1: libm differs, and x86-64 vs arm64 is deferred by scope §8.
- **On failure:** print the first divergent hash index (as a tick), the per-car field diff at that tick, and the first divergent event.
- **`simtests --record <case|all>`** rewrites the fixtures for the current platform. Fixtures are recorded only after §4 and §5 have landed (step 7).
- RelWithDebInfo is the recording configuration. CI builds the same.

### 6.4 Parity gate

- **Baseline** (step 3, upstream semantics through the jittered-dt adapter): 20 runs × {Monza, Suzuka, Twister} × 12 AI × 3 laps on macOS arm64, varied by jitter seed. Stored in `parity/baseline-macos-arm64.json`.
- **Metrics per track:** mean AI lap time; winner race time; collision pairs per race (count of new car–car and car–object contacts); stuck recoveries per race.
- **Candidate:** the new build, 20 sim seeds (1–20) per track on fixed ticks.
- **Pass:** for every track and metric, the candidate mean lies within the baseline mean ± 2σ.
- **Runs** locally and through `workflow_dispatch`, never on every push (about 7 minutes).
- If the stuck metric fails only because of the F4 fix, record a documented exception in the plan's verification notes (risk 5). Any other failure blocks.

### 6.5 User drive

After the parity gate passes, the user plays one race on each of Monza and Suzuka in the desktop game (`--seed 0`) and confirms:

- handling and braking feel unchanged;
- bounces off AI cars and walls look as before;
- the AI drives as before;
- no judder at 60 Hz;
- no burst after pause or menus.

Sign-off is recorded in `docs/phase1/verification.md`.

---

## 7. Validation and contracts

### 7.1 Track and asset validation (every push)

`simtests` validation cases over all 16 `.trk` files and `data/*.conf`:

- every `.trk` and config file parses as XML;
- tile types and object roles are known to `TrackObjectFactory`/`TrackTile`;
- the route is closed, has at least 3 nodes, and checkpoint 0 exists;
- every surface referenced by a track, mesh or object exists in `surfaces.conf`, and its image file exists on disk;
- AI hint values are within their documented range;
- every grid slot lies on a drivable tile;
- every track loads through `RaceSetup` (the 300-tick run is the startup characterisation case, §6.1).

### 7.2 Sim contracts document

`docs/phase1/sim-contracts.md` writes down what the Phase 1 sim exposes, as the reference for Phase 2's emitter and engine bridge:

- **State:** per-car pose, velocities, speed (true `|v| × 3.125` m/s, distinct from the display `speedInKmh()`), lap, position, checkpoint, route progress, tyre wear, damage, gear; race-level tick, phase, lap count. Units and frames per S1 (world units, heading in degrees CCW from +x, y-up).
- **Tick numbering:** tick N is the state after N steps; `tMs = N × 16`.
- **Events:** `lap` with `lapMs`, `position`, `pit`, `finish`, `collision`, `stuck`, `recovered`, each with a tick.
- **Input:** per-tick per-car control `{accelerate, brake, left, right}`, as in §6.3. Analog steering is Phase 2.
- **Semantics the decision-6 amendments need:**
  - `pos` before checkpoint 0 is the grid slot;
  - progress is continuous `(nodeIndex + fraction) / nodeCount` through the line;
  - `speedKmh` is true speed.

### 7.3 Contract v0 amendments: scheduled in Phase 2

The six amendments from Phase 0 decision 6 change `contracts/telemetry-v0` and its emitter. Both are Phase 2 work (`dustsim-headless` CLI). Phase 1 supplies their sim-side semantics through §7.2 and the `lapMs` event field. The commit of this spec adds:

- a Phase 2 bullet to the scope doc: "Apply Phase 0 decision-6 amendments to `contracts/telemetry-v0` with the emitter";
- a scope decision-log row citing this spec.

---

## 8. Sequencing and exit

Each step merges only when the previous suites stay green.

| Step | Work | Gate |
|---|---|---|
| 1 | Ignore-rule negations; root workflow; user creates `origin` | CI runs the existing 5 ctests on both OSes |
| 2 | `MC_HEADLESS` guards, seam fixes, `RaceSetup`, `simtests` skeleton, sim build flags | Existing ctests green; desktop launch smoke test; `simtests` runs one race |
| 3 | Characterisation suite (jittered-dt adapter); parity baseline recorded and committed | Suite green on upstream semantics |
| 4 | Fixed tick, tick counter, tick-based `Timing`, frame-counted constants (§4.4), accumulator in `game.cpp` | Characterisation green |
| 5 | `SimRandom`, RNG split, `--seed` | Characterisation green |
| 6 | Stable IDs, `ObjectKey` containers, `m_collidables` | Characterisation and determinism suites green on both OSes |
| 7 | Golden fixtures recorded for both platforms | Golden suite green in CI |
| 8 | Render interpolation; parity gate; user drive | Parity pass; user sign-off |
| 9 | Track/asset validation; `sim-contracts.md`; scope doc update | All suites green in CI |

**Phase 1 is done when:**

- the desktop game runs on 16 ms fixed ticks with interpolation;
- the parity gate passes and the user has signed off the drive;
- CI is green on macOS arm64 and Ubuntu x86-64 with the characterisation, determinism, golden and validation suites;
- `sim-contracts.md` is committed.

---

## 9. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | Live `ObjectKey` iteration still changes collision outcomes beyond the parity band | Fall back to S1 row 41's snapshot iteration, documented (§5.3) |
| 2 | A platform is not repeatable against itself | Treated as a bug to find (determinism tests localise it); never papered over with tolerances |
| 3 | Ubuntu 24.04 ships Qt 6.4, the local build uses 6.12 | Both are in CI; the sim uses only Core/Xml/Gui APIs present in 6.4 |
| 4 | `MC_HEADLESS` `#ifdef` debt in MiniCore | Bounded to rows 1–23 plus the renderer-side guards; Phase 2 replaces them with the link-time split |
| 5 | The F4 stuck-offset fix shifts the stuck metric | Accept only within the ±2σ band, or as a documented exception (§6.4) |
| 6 | Fixed tick changes feel (scope risk 3) | 16 ms is the upstream tuning point; parity gate plus user drive |
| 7 | Disk (about 12 GB free) | One extra headless build directory (a few hundred MB); no extra upstream build, because the parity baseline is committed as data |

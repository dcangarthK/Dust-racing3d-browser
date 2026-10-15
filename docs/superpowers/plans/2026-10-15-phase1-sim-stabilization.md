# Phase 1 — Simulation Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the DustRacing2D desktop game on a deterministic 16 ms fixed tick with a seeded portable sim RNG and stable-ID collision order, guarded by headless characterisation, determinism, golden-hash and asset-validation suites in CI, with desktop feel and collision behaviour shown unchanged.

**Architecture:** S1's `MC_HEADLESS` guards become real code so a GL-free `simtests` build can drive races through a `RaceSetup` class that the desktop `Scene` also uses. Characterisation tests and a statistical parity baseline are recorded on upstream semantics first. The fixed tick, RNG split and stable-ID ordering then land one at a time, and only after all three are golden fixtures recorded per platform.

**Tech Stack:** C++17, CMake + Ninja, Qt 6 (Core, Xml, Gui, Test; desktop also OpenGL, Sql), MiniCore, GitHub Actions (macos-14 arm64, ubuntu-24.04 x86-64).

**Spec:** `docs/superpowers/specs/2026-10-15-phase1-sim-stabilization-design.md`. Read it before starting any task. Section references (§) below point into it.

## Global Constraints

- Tick length is exactly 16 ms. Tick N is the state after N steps; `tMs = N × 16`. The first step produces tick 1.
- Catch-up cap: 5 ticks per frame. The excess is dropped, never queued.
- Every MiniCore and game sim translation unit (desktop and headless) is built with `-ffp-contract=off`, and nothing uses `-ffast-math` or `-Ofast`.
- The sim never calls `std::uniform_*_distribution`, `rand()` or `MCRandom`. The sim RNG is `SimRandom` (xoshiro256** seeded by SplitMix64), with floats from `(next() >> 40) × 2⁻²⁴`.
- Cosmetic code (particles, `CarParticleEffectManager`, `Tree`, tree params in `TrackObjectFactory`, menu text) keeps using `MCRandom`.
- Collision ordering uses `stableId()`, never `MCObject *` addresses.
- Golden fixtures are recorded only in Task 16, after Tasks 10–15 have landed. Fixtures are per platform: `macos-arm64`, `linux-x86_64`. The recording build type is RelWithDebInfo.
- Every `#ifdef MC_HEADLESS` leaves the non-headless code path byte-for-byte unchanged in behaviour.
- New files under `DustRacing2D/src/game/simtests/`, `src/game/unittests/`, `MiniCore/src/UnitTests/` and any `*.json` fixture must be tracked by git. Run `git check-ignore -v <path>` before each commit that adds such files; it must print nothing.
- Commit messages are conventional (`feat(phase1): …`, `test(phase1): …`, `ci(phase1): …`, `docs(phase1): …`) and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Disk is tight (about 12 GB free). Use the single build dir `~/dust-build/p1` for everything, and don't create extra full builds.
- Do not push and do not create remotes. Task 1 asks the user to do that.

## Review Focus

1. **A second race in the same process** (the desktop menu → race → menu → race flow). IDs, tick counter, `Timing`, `SimRandom` and particles must all reset, and the second race must hash identically to a fresh process. This is pinned in Task 15 (`repeatInProcess`).
2. **Pause, menus, or a long stall such as window drag or app nap.** There must be no catch-up burst afterwards, and the cap must drop time rather than spiral. Pinned in Task 11 (`resetAfterStall`, `capDropsExcess`).
3. **A car teleported by stuck recovery while render interpolation is on.** There must be no one-frame streak across the map. Pinned in Task 17 (`teleportSnaps`).
4. **An object whose collision flags make it a trigger (pit, bridge)** must still get a stable ID. Otherwise its pairs fall back to address order and the race is nondeterministic. Pinned in Task 14 (`triggerObjectsGetIds`).
5. **Objects destroyed mid-race while still in `m_currentCollisions`** (particles dying, cars removed between races). The `ObjectKey` comparator must never dereference them. Pinned in Task 15 (`removeDuringCollisionIsSafe`).

---

## File structure

```text
.github/workflows/sim.yml                               CI (Task 1)
tools/dust-configure.sh                                 local + CI configure wrapper (Task 1)
DustRacing2D/.gitignore                                 negations (Task 1)
DustRacing2D/CMakeLists.txt                             dust_sim_flags(), DUST_SIM_TESTS (Tasks 2, 5)
DustRacing2D/src/game/
  simtime.hpp            NEW  TICK, ticksFor()                                    (Task 10)
  fixedstepaccumulator.hpp NEW frame→tick accumulator, header-only                 (Task 11)
  simrandom.{hpp,cpp}    NEW  xoshiro256** sim RNG                                (Task 12)
  carinput.{hpp,cpp}     NEW  CarInput + applyCarInput (shared human-input path)  (Task 4)
  racesetup.{hpp,cpp}    NEW  race construction + per-tick step, used by Scene and simtests (Task 4)
  scene.{hpp,cpp}        MOD  delegates to RaceSetup; camera per frame             (Tasks 4, 17)
  game.{hpp,cpp}         MOD  accumulator loop, --seed                            (Tasks 11, 13)
  race.{hpp,cpp}         MOD  tick counter, carRecovered signal, SimRandom        (Tasks 6, 10, 13)
  timing.{hpp,cpp}       MOD  tick-based time                                     (Task 10)
  ai.{hpp,cpp}           MOD  SimRandom                                           (Task 13)
  carfactory.{hpp,cpp}   MOD  forceAi flag                                        (Task 4)
  car.cpp                MOD  null-check sound manager                            (Task 5)
  particlefactory.{hpp,cpp}, carparticleeffectmanager.cpp  MOD optional factory   (Task 5)
  gearbox.cpp            MOD  ticksFor(500)                                       (Task 10)
  MiniCore/src/Core/mcobject.{hh,cc}       MOD stableId, ObjectKey, pose capture  (Tasks 14, 15, 17)
  MiniCore/src/Core/mcobjectkey.hh         NEW ObjectKey value type               (Task 15)
  MiniCore/src/Core/mcworld.{hh,cc}        MOD IDs, m_collidables, counters, alpha (Tasks 6, 14, 15, 17)
  MiniCore/src/Physics/mccollisiondetector.{hh,cc}  MOD ObjectKey, event counter  (Tasks 6, 15)
  MiniCore/src/Physics/mcobjectgrid.cc     MOD pair ordering                      (Task 15)
  MiniCore/src/Physics/mcimpulsegenerator.{hh,cc}   MOD iterate collidables       (Task 15)
  MiniCore/src/Physics/mcshape.cc, Graphics/mcsurfaceobjectrenderer*.cc  MOD interpolated pose (Task 17)
  MiniCore/src/UnitTests/MCWorldTest/MCWorldTest.{hpp,cpp}  MOD stable-ID tests   (Tasks 14, 15)
  MiniCore/src/{Graphics,Asset,Text}/*     MOD MC_HEADLESS guards (S1 rows 1–23)  (Task 3)
  simtests/
    CMakeLists.txt                         headless libs + test executables       (Task 5)
    stubs/stub_game.cpp, stub_database.cpp                                         (Task 5)
    harness/simenvironment.{hpp,cpp}       process-wide assets/tracks/world       (Task 5)
    harness/simharness.{hpp,cpp}           one race: build, step, hash, events    (Tasks 5, 6)
    harness/statehash.{hpp,cpp}            FNV-1a 64 state hash                    (Task 6)
    harness/upstreamdt.hpp                 jittered-dt model (removed in Task 10)  (Task 6)
    harness/inputscript.{hpp,cpp}          *.input parser                          (Task 6)
    harness/goldencases.hpp                golden case table                       (Task 16)
    harness/parity.{hpp,cpp}               parity metrics + stats                  (Task 9)
    characterization/tst_race.cpp          laps, positions, finish, startup        (Task 7)
    characterization/tst_scenarios.cpp     pits, collisions, recovery              (Task 8)
    determinism/tst_determinism.cpp                                                (Task 15)
    golden/tst_golden.cpp, golden/fixtures/<platform>/*.json                       (Task 16)
    validation/tst_validation.cpp                                                  (Task 19)
    unit/tst_units.cpp                     SimRandom, accumulator, ticksFor, hash  (Tasks 6, 10–12)
    tools/simtool.cpp                      record / parity CLI                     (Tasks 9, 16)
    parity/baseline-macos-arm64.json                                               (Task 9)
    inputs/monza-lap.input                                                         (Task 6)
docs/phase1/sim-contracts.md, docs/phase1/verification.md                         (Tasks 18, 20)
```

Build and test commands used throughout (run from the repo root):

```bash
tools/dust-configure.sh ~/dust-build/p1
cmake --build ~/dust-build/p1
(cd ~/dust-build/p1 && QT_QPA_PLATFORM=offscreen ctest --output-on-failure -LE parity)
```

---

### Task 1: Ignore rules, configure script, root CI

**Files:**
- Modify: `DustRacing2D/.gitignore` (append at end)
- Create: `tools/dust-configure.sh`
- Create: `.github/workflows/sim.yml`

**Interfaces:**
- Produces: `tools/dust-configure.sh <build-dir> [cmake args…]`, which configures RelWithDebInfo with `BUILD_TESTING=ON` and the macOS Homebrew flags from `docs/phase0/desktop-build.md`. CI and every later task use it.

- [ ] **Step 1: Show the ignore problem exists**

```bash
mkdir -p DustRacing2D/src/game/simtests/golden/fixtures/macos-arm64
touch DustRacing2D/src/game/simtests/golden/fixtures/macos-arm64/probe.json DustRacing2D/src/game/MiniCore/src/UnitTests/probe.cpp
git check-ignore -v DustRacing2D/src/game/simtests/golden/fixtures/macos-arm64/probe.json DustRacing2D/src/game/MiniCore/src/UnitTests/probe.cpp
```
Expected: two lines. `*.json` matches the first. `unittests/` matches the second, because macOS git has `core.ignorecase=true`, so `unittests/` also matches `UnitTests/`.

- [ ] **Step 2: Append the negations to `DustRacing2D/.gitignore`**

```gitignore

# racing-telemetry-gcp Phase 1: track tests and fixtures (local divergence from upstream)
!src/game/unittests/
!src/game/unittests/**
!src/game/MiniCore/src/UnitTests/
!src/game/MiniCore/src/UnitTests/**
!src/game/simtests/
!src/game/simtests/**
!src/game/simtests/**/*.json
```

- [ ] **Step 3: Re-check, then remove the probes**

```bash
git check-ignore -v DustRacing2D/src/game/simtests/golden/fixtures/macos-arm64/probe.json DustRacing2D/src/game/MiniCore/src/UnitTests/probe.cpp; echo "exit=$?"
rm DustRacing2D/src/game/simtests/golden/fixtures/macos-arm64/probe.json DustRacing2D/src/game/MiniCore/src/UnitTests/probe.cpp
```
Expected: no output lines and `exit=1`, meaning nothing is ignored.

- [ ] **Step 4: Create `tools/dust-configure.sh`** (then `chmod +x`)

```bash
#!/usr/bin/env bash
# Configure the DustRacing2D build (desktop game + tests).
# Usage: tools/dust-configure.sh <build-dir> [extra cmake args...]
set -euo pipefail
BUILD="${1:?usage: dust-configure.sh <build-dir> [cmake args...]}"
shift
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARGS=(-S "$ROOT/DustRacing2D" -B "$BUILD" -G Ninja
      -DCMAKE_BUILD_TYPE=RelWithDebInfo -DBUILD_TESTING=ON)
if [[ "$(uname)" == "Darwin" ]]; then
  # See docs/phase0/desktop-build.md "Fixes needed".
  P="$(brew --prefix openal-soft)"
  ARGS+=(-DCMAKE_PREFIX_PATH="$(brew --prefix qt)"
         -DOpenALDir="$P"
         -DOPENAL_INCLUDE_DIR="$P/include/AL"
         -DOPENAL_LIBRARY="$P/lib/libopenal.dylib"
         -DCMAKE_CXX_FLAGS="-I$(brew --prefix libvorbis)/include -I$(brew --prefix libogg)/include"
         -DCMAKE_EXE_LINKER_FLAGS="-L$(brew --prefix libvorbis)/lib -L$(brew --prefix libogg)/lib")
fi
exec cmake "${ARGS[@]}" "$@"
```

- [ ] **Step 5: Configure, build, run the existing tests locally**

```bash
tools/dust-configure.sh ~/dust-build/p1 && cmake --build ~/dust-build/p1
(cd ~/dust-build/p1 && QT_QPA_PLATFORM=offscreen ctest --output-on-failure)
```
Expected: `100% tests passed, 0 tests failed out of 5`.

- [ ] **Step 6: Create `.github/workflows/sim.yml`**

```yaml
name: sim

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:
    inputs:
      parity:
        description: "Run the parity gate (macOS, ~7 min)"
        type: boolean
        default: false
      record:
        description: "Record golden fixtures and upload them as an artifact"
        type: boolean
        default: false

env:
  QT_QPA_PLATFORM: offscreen

jobs:
  build-test:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-24.04, macos-14]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - name: Install dependencies (Ubuntu)
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y build-essential cmake ninja-build pkg-config \
            qt6-base-dev qt6-tools-dev qt6-tools-dev-tools qt6-l10n-tools linguist-qt6 \
            libgl-dev libopenal-dev libvorbis-dev
      - name: Install dependencies (macOS)
        if: runner.os == 'macOS'
        run: brew install ninja qt openal-soft libvorbis libogg pkg-config
      - name: Configure
        run: tools/dust-configure.sh build
      - name: Build
        run: cmake --build build
      - name: Test
        run: cd build && ctest --output-on-failure -LE parity
      - name: Record golden fixtures
        if: github.event_name == 'workflow_dispatch' && inputs.record
        run: build/simtests/simtool record all --out recorded
      - name: Upload recorded fixtures
        if: github.event_name == 'workflow_dispatch' && inputs.record
        uses: actions/upload-artifact@v4
        with:
          name: golden-${{ matrix.os }}
          path: recorded
      - name: Parity gate
        if: github.event_name == 'workflow_dispatch' && inputs.parity && runner.os == 'macOS'
        run: build/simtests/simtool parity check
```

The `record` and `parity` steps reference `simtool`, which is created in Tasks 9 and 16. Until then those inputs stay unused.

- [ ] **Step 7: Validate the YAML parses**

Run: `ruby -ryaml -e 'YAML.load_file(".github/workflows/sim.yml"); puts "ok"'`
Expected: `ok`

- [ ] **Step 8: Commit**

```bash
git add DustRacing2D/.gitignore tools/dust-configure.sh .github/workflows/sim.yml
git commit -m "ci(phase1): track test dirs and fixtures; configure script; root sim workflow"
```

- [ ] **Step 9: Ask the user to create the GitHub remote**

Stop and send the user: "Task 1 is committed. Please create a GitHub repository, then run `git remote add origin <url>` and `git push -u origin main`. Tell me when the first `sim` workflow run finishes." Its gate is: both jobs run the 5 existing ctests green. If a job fails on dependencies, fix `sim.yml` in a follow-up commit. Later tasks can continue locally while waiting.

---

### Task 2: Sim build flags

**Files:**
- Modify: `DustRacing2D/CMakeLists.txt` (after `include(CTest)`)
- Modify: `DustRacing2D/src/game/MiniCore/src/CMakeLists.txt` (after `add_library(${MiniCoreTargetName} …)`)
- Modify: `DustRacing2D/src/game/CMakeLists.txt` (after `add_executable(${GAME_BINARY_NAME} …)`)

**Interfaces:**
- Produces: CMake function `dust_sim_flags(<target>)`. Task 5 applies it to the headless libraries and test executables.

- [ ] **Step 1: Show the flag is absent**

```bash
cmake --build ~/dust-build/p1 -t clean >/dev/null; cmake --build ~/dust-build/p1 -- -n -v 2>/dev/null | grep -c 'ffp-contract=off'
```
Expected: `0`

- [ ] **Step 2: Add the function to `DustRacing2D/CMakeLists.txt`** directly after `include(CTest)`:

```cmake
# Phase 1 (spec §3.2): deterministic floating point on every sim translation unit.
# No -ffast-math / -Ofast anywhere; FMA contraction off so native matches WASM (Phase 0 decision 3).
function(dust_sim_flags target)
    if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
        target_compile_options(${target} PRIVATE -ffp-contract=off -fno-fast-math)
    endif()
endfunction()

option(DUST_SIM_TESTS "Build the headless simulation test suites (simtests)" ON)
```

- [ ] **Step 3: Apply it.** In `MiniCore/src/CMakeLists.txt` add `dust_sim_flags(${MiniCoreTargetName})` after its `add_library`. In `src/game/CMakeLists.txt` add `dust_sim_flags(${GAME_BINARY_NAME})` after its `add_executable`.

- [ ] **Step 4: Verify and test**

```bash
tools/dust-configure.sh ~/dust-build/p1 >/dev/null
cmake --build ~/dust-build/p1 -t clean >/dev/null; cmake --build ~/dust-build/p1 -- -v 2>&1 | grep -c 'ffp-contract=off'
(cd ~/dust-build/p1 && QT_QPA_PLATFORM=offscreen ctest --output-on-failure)
```
Expected: the count is at least 150 (every MiniCore and game TU), and 5/5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add DustRacing2D/CMakeLists.txt DustRacing2D/src/game/MiniCore/src/CMakeLists.txt DustRacing2D/src/game/CMakeLists.txt
git commit -m "build(phase1): -ffp-contract=off on MiniCore and game sim sources"
```

---

### Task 3: `MC_HEADLESS` guards (S1 rows 1–23, 29, 33–36)

**Files:**
- Modify (patch from the archived S1 commit `d4fee49e`, reachable from tag `phase0-spikes`):
  - `DustRacing2D/src/game/MiniCore/src/Graphics/{mcglobjectbase.hh,mcglobjectbase.cc,mcglshaderprogram.hh,mcglshaderprogram.cc,mcglmaterial.cc,mcglscene.cc,mcsurface.cc,mcworldrenderer.cc,mcsurfaceobjectrenderer.cc,mcsurfaceobjectrendererlegacy.cc,mcsurfaceparticlerenderer.cc,mcsurfaceparticlerendererlegacy.cc}`
  - `.../MiniCore/src/Asset/mcsurfacemanager.cc`, `.../MiniCore/src/Text/mctexturetext.cc`
  - `DustRacing2D/src/game/{game.hpp,trackobjectfactory.cpp,bridge.cpp,track.cpp,graphicsfactory.cpp}`
- NOT taken from S1: `car.hpp`, `race.*` (accessor rows 24–25), `mcobject.*`, `Physics/*` (rows 39–42; Tasks 14–15 replace them).

**Interfaces:**
- Produces: the macro `MC_HEADLESS`, which compiles out every GL call. Behaviour with the macro undefined is unchanged.

- [ ] **Step 1: Apply the guards as a patch**

```bash
S1=d4fee49e
git cat-file -t $S1   # expect: commit
FILES="DustRacing2D/src/game/MiniCore/src/Graphics DustRacing2D/src/game/MiniCore/src/Asset/mcsurfacemanager.cc DustRacing2D/src/game/MiniCore/src/Text/mctexturetext.cc DustRacing2D/src/game/game.hpp DustRacing2D/src/game/trackobjectfactory.cpp DustRacing2D/src/game/bridge.cpp DustRacing2D/src/game/track.cpp DustRacing2D/src/game/graphicsfactory.cpp"
git diff main $S1 -- $FILES > /tmp/claude-mc-headless.patch
git apply --check /tmp/claude-mc-headless.patch && git apply /tmp/claude-mc-headless.patch
git diff --stat
```
Expected: 17 files changed, all additions inside `#ifdef MC_HEADLESS` / `#ifndef MC_HEADLESS` blocks or `!defined(MC_HEADLESS)` conditions. If `git apply --check` fails, `main` has drifted since S1: stop and report.

- [ ] **Step 2: Audit the patch.** Run `git diff | grep '^[-+]' | grep -v '^[-+][-+]' | grep -vc 'MC_HEADLESS\|#else\|#endif\|(void)'`. Then read each hunk not covered by those patterns and confirm it sits inside a headless branch. Any hunk that changes non-headless code fails the audit: revert that hunk.

- [ ] **Step 3: Rebuild desktop and run the tests** (the desktop build does not define `MC_HEADLESS`, so it must be unchanged)

```bash
cmake --build ~/dust-build/p1 && (cd ~/dust-build/p1 && QT_QPA_PLATFORM=offscreen ctest --output-on-failure)
```
Expected: build OK, 5/5 pass.

- [ ] **Step 4: Commit**

```bash
git add DustRacing2D/src/game
git commit -m "feat(phase1): adopt S1 MC_HEADLESS guards (rows 1-23, 29, 33-36); desktop unchanged"
```

---

### Task 4: `CarInput`, `CarFactory` forceAi, `RaceSetup` (behaviour-preserving desktop refactor)

**Files:**
- Create: `DustRacing2D/src/game/carinput.hpp`, `carinput.cpp`, `racesetup.hpp`, `racesetup.cpp`
- Modify: `DustRacing2D/src/game/carfactory.hpp/.cpp`, `scene.hpp/.cpp`, `CMakeLists.txt` (add the two `.cpp` files to `SRC`)

**Interfaces:**
- Produces:
  ```cpp
  // carinput.hpp
  struct CarInput { bool accelerate = false; bool brake = false; bool left = false; bool right = false; };
  void applyCarInput(Car & car, const CarInput & input, bool raceCompleted);

  // carfactory.hpp
  static std::unique_ptr<Car> buildCar(size_t index, size_t carCount, Game & game, bool forceAi = false);

  // racesetup.hpp
  class RaceSetup {
  public:
      struct Params {
          std::shared_ptr<Track> track;
          size_t carCount = 12;
          size_t humanCount = 1;            // 0 = all cars AI
          size_t lapCount = 3;
          std::function<void(Car &, size_t)> decorateCar; // desktop: shaders + audio; tests: silent sound manager or nothing
      };
      struct Session {
          std::vector<CarS> cars;
          std::vector<std::shared_ptr<AI>> ais;
          std::vector<std::shared_ptr<Bridge>> bridges;
      };
      static Session build(MCWorld & world, const std::shared_ptr<Race> & race, Game & game, const Params & params);
      static void step(MCWorld & world, Race & race, Session & session,
                       const std::vector<CarInput> & humanInputs, std::chrono::milliseconds timeStep);
  };
  ```
  Task 13 adds `uint64_t simSeed` to `Params` and `std::unique_ptr<SimRandom> simRandom` to `Session`.

- [ ] **Step 1: Write `carinput.hpp/.cpp`.** The body is moved verbatim from the per-player body of `Scene::processUserInput`:

```cpp
// carinput.cpp
#include "carinput.hpp"
#include "car.hpp"

void applyCarInput(Car & car, const CarInput & input, bool raceCompleted)
{
    car.setBrakeEnabled(input.brake && !raceCompleted);
    car.setAcceleratorEnabled(input.accelerate && !raceCompleted);

    if (input.left)
        car.steer(Car::Steer::Left);
    else if (input.right)
        car.steer(Car::Steer::Right);
    else
        car.steer(Car::Steer::Neutral);
}
```
Behaviour check against upstream: upstream calls `setBrakeEnabled(true)` only when not completed, and `setBrakeEnabled(false)` when not pressed. When pressed and completed, upstream leaves the previous value. A completed car's controls are ignored by the race in both versions, but to be exact keep upstream's form:
```cpp
    if (input.brake) { if (!raceCompleted) car.setBrakeEnabled(true); } else car.setBrakeEnabled(false);
    if (input.accelerate) { if (!raceCompleted) car.setAcceleratorEnabled(true); } else car.setAcceleratorEnabled(false);
```
Use this exact form instead of the two shorter lines above.

- [ ] **Step 2: Add `forceAi` to `CarFactory::buildCar`.** Change the human condition to `if (!forceAi && (index == 0 || (index == 1 && game.hasTwoHumanPlayers())))` and the AI branch to `else if (forceAi || game.hasComputerPlayers())`. Update the declaration in `carfactory.hpp` with default `false`.

- [ ] **Step 3: Write `racesetup.cpp`.** Move the code out of `Scene` without changing its order:

```cpp
#include "racesetup.hpp"
#include "ai.hpp"
#include "bridge.hpp"
#include "car.hpp"
#include "carfactory.hpp"
#include "pit.hpp"
#include "race.hpp"
#include "track.hpp"
#include "trackdata.hpp"
#include "trackobject.hpp"
#include "tracktile.hpp"
#include "../common/objects.hpp"
#include <MCMesh>
#include <MCShape>
#include <MCShapeView>
#include <MCWorld>
#include <cassert>

namespace {
const float METERS_PER_UNIT = 0.05f; // scene.cpp

void addTrackObjects(Track & track, Race & race)
{
    // Moved from Scene::createNormalObjects.
    for (size_t i = 0; i < track.trackData().objects().count(); i++)
    {
        const auto trackObject = std::dynamic_pointer_cast<TrackObject>(track.trackData().objects().object(i));
        assert(trackObject);
        auto && object = trackObject->object();
        object.addToWorld();

        float baseZ = 0;
        if (object.shape() && object.shape()->view() && object.shape()->view()->object())
        {
            if (dynamic_cast<MCMesh *>(object.shape()->view()->object()))
            {
                baseZ = -object.shape()->view()->object()->minZ();
            }
        }
        object.translate(object.initialLocation() + MCVector3dF { 0, 0, baseZ });
        object.rotate(static_cast<float>(object.initialAngle()));

        if (const auto pit = dynamic_cast<Pit *>(&object); pit)
        {
            pit->reset();
            QObject::connect(pit, &Pit::pitStop, &race, &Race::pitStop);
        }
    }
}

std::vector<std::shared_ptr<Bridge>> addBridges(Track & track)
{
    // Moved from Scene::createBridgeObjects.
    std::vector<std::shared_ptr<Bridge>> bridges;
    auto && map = track.trackData().map();
    for (size_t j = 0; j <= map.rows(); j++)
    {
        for (size_t i = 0; i <= map.cols(); i++)
        {
            const auto tile = std::dynamic_pointer_cast<TrackTile>(map.getTile(i, j));
            if (tile && tile->tileTypeEnum() == TrackTile::TileType::Bridge)
            {
                const auto bridge = std::make_shared<Bridge>();
                bridge->translate(MCVector3dF {
                  static_cast<float>(i * TrackTile::width() + TrackTile::width() / 2),
                  static_cast<float>(j * TrackTile::height() + TrackTile::height() / 2),
                  0 });
                bridge->rotate(static_cast<float>(tile->rotation()));
                bridge->addToWorld();
                bridges.push_back(bridge);
            }
        }
    }
    Bridge::reset();
    return bridges;
}
} // namespace

RaceSetup::Session RaceSetup::build(MCWorld & world, const std::shared_ptr<Race> & race, Game & game, const Params & params)
{
    assert(params.track);
    Session session;

    world.clear();
    world.setDimensions(0, static_cast<float>(params.track->width()), 0, static_cast<float>(params.track->height()), 0, 1000, METERS_PER_UNIT);

    // Moved from Scene::createCars.
    race->removeCars();
    for (size_t i = 0; i < params.carCount; i++)
    {
        const bool forceAi = i >= params.humanCount;
        if (CarS car { CarFactory::buildCar(i, params.carCount, game, forceAi) }; car)
        {
            if (!car->isHuman())
            {
                session.ais.push_back(std::make_shared<AI>(*car, race));
            }
            if (params.decorateCar)
            {
                params.decorateCar(*car, i);
            }
            session.cars.push_back(car);
            race->addCar(*car);
        }
    }

    for (auto && car : session.cars) // Scene::addCarsToWorld
    {
        car->addToWorld();
    }

    addTrackObjects(*params.track, *race);
    session.bridges = addBridges(*params.track);

    race->initialize(params.track, params.lapCount);

    for (auto && ai : session.ais) // Scene::setupAI
    {
        ai->setTrack(params.track);
    }
    return session;
}

void RaceSetup::step(MCWorld & world, Race & race, Session & session,
                     const std::vector<CarInput> & humanInputs, std::chrono::milliseconds timeStep)
{
    // Order is Scene::updateFrame's: inputs and AI only once started, then world, then race.
    if (race.started())
    {
        const auto timing = race.timing().lock();
        for (size_t i = 0; i < humanInputs.size() && i < session.cars.size(); i++)
        {
            applyCarInput(*session.cars.at(i), humanInputs.at(i), timing->raceCompleted(i));
        }
        for (auto && ai : session.ais)
        {
            ai->update(timing->raceCompleted(ai->car().index()));
        }
    }
    world.stepTime(timeStep);
    race.update(timeStep);
}
```
`CarFactory::buildCar` with `forceAi=false` for `i < humanCount` keeps upstream's human selection, including the two-player case. The Desktop passes `humanCount = game.hasTwoHumanPlayers() ? 2 : 1`.

- [ ] **Step 4: Rewire `Scene`.**
  - Replace the members `m_cars`, `m_ai`, `m_bridges` with `RaceSetup::Session m_session;`, and rename uses to `m_session.cars`, `m_session.ais`, `m_session.bridges`. There are 30 occurrences; `grep -n "m_cars\|m_ai\b\|m_bridges" scene.*`.
  - In `setActiveTrack`, replace `m_world.clear(); … setupAI(activeTrack);` with:

```cpp
    m_activeTrack = activeTrack;

    RaceSetup::Params params;
    params.track = activeTrack;
    params.carCount = carCount();
    params.humanCount = m_game.hasTwoHumanPlayers() ? 2 : 1;
    params.lapCount = static_cast<size_t>(m_game.lapCount());
    params.decorateCar = [this](Car & car, size_t index) {
        car.shape()->view()->setShaderProgram(m_renderer.program("car"));
        car.shape()->view()->object()->material()->setDiffuseCoeff(3.4f);
        setupAudio(car, index);
    };
    m_session = RaceSetup::build(m_world, m_race, m_game, params);

    setupCameras(*activeTrack);
    resizeOverlays();
    setFollowedCars();      // the overlay lines from the end of old createCars()
    setupMinimaps();
```
  - Move the four overlay `setCarToFollow` lines from the end of `createCars` into a new private `void Scene::setFollowedCars()`.
  - Delete `createCars`, `addCarsToWorld`, `addTrackObjectsToWorld`, `createNormalObjects`, `createBridgeObjects`, `setWorldDimensions`, `initializeRace`, `setupAI` and their declarations.
  - Note: `setupCameras` used to run before the world was cleared; it only touches cameras and particle visibility, so running it after `build` is equivalent.
  - In `Scene::updateFrame`, replace `processUserInput(handler); updateAi(); updateWorld(timeStep); updateRace(timeStep);` with:

```cpp
            RaceSetup::step(m_world, *m_race, m_session, readHumanInputs(handler), timeStep);
            emit listenerLocationChanged(m_session.cars.at(0)->location().i(), m_session.cars.at(0)->location().j());
```
  - Implement `readHumanInputs` from the old `processUserInput`:

```cpp
std::vector<CarInput> Scene::readHumanInputs(InputHandler & handler) const
{
    std::vector<CarInput> inputs;
    for (size_t i = 0; i < (m_game.hasTwoHumanPlayers() ? 2u : 1u); i++)
    {
        CarInput in;
        in.brake = handler.getActionState(i, InputHandler::Action::Down);
        in.accelerate = handler.getActionState(i, InputHandler::Action::Up);
        in.left = handler.getActionState(i, InputHandler::Action::Left);
        in.right = handler.getActionState(i, InputHandler::Action::Right);
        inputs.push_back(in);
    }
    return inputs;
}
```
  - Delete `processUserInput`, `updateAi`, `updateWorld`, `updateRace`.
  - Keep the camera updates where they are; Task 17 moves them.
  - Add `carinput.cpp` and `racesetup.cpp` to `SRC` in `src/game/CMakeLists.txt`.

- [ ] **Step 5: Build and run the tests**

```bash
cmake --build ~/dust-build/p1 && (cd ~/dust-build/p1 && QT_QPA_PLATFORM=offscreen ctest --output-on-failure)
```
Expected: build OK, 5/5.

- [ ] **Step 6: Desktop launch smoke test**

```bash
cd ~/dust-build/p1 && (./dustrac-game > /tmp/claude-p1-smoke.out 2>&1 & echo $! > /tmp/claude-p1-smoke.pid); sleep 15; kill "$(cat /tmp/claude-p1-smoke.pid)"; grep -iE 'fatal|segmentation|assert' /tmp/claude-p1-smoke.out; echo "grep-exit=$?"
```
Expected: `grep-exit=1`, meaning no crash lines, and the log lists the 16 tracks. Starting a race needs the GUI: ask the user to start one race and confirm the cars move. Record the answer in the task report.

- [ ] **Step 7: Commit**

```bash
git add DustRacing2D/src/game
git commit -m "refactor(phase1): RaceSetup and CarInput shared by Scene; CarFactory forceAi"
```

---

### Task 5: Headless libraries, `simtests` skeleton, seam fixes, first race test

**Files:**
- Modify: `DustRacing2D/src/game/CMakeLists.txt` (end of file):
  ```cmake
  if(BUILD_TESTING AND DUST_SIM_TESTS)
      add_subdirectory(simtests)
  endif()
  ```
- Create: `DustRacing2D/src/game/simtests/CMakeLists.txt`, `stubs/stub_game.cpp`, `stubs/stub_database.cpp`, `harness/simenvironment.{hpp,cpp}`, `harness/simharness.{hpp,cpp}`, `characterization/tst_race.cpp`
- Modify: `car.cpp` (null check), `particlefactory.hpp/.cpp`, `carparticleeffectmanager.cpp`, and any other `ParticleFactory::instance()` caller (`grep -rn "ParticleFactory::instance" DustRacing2D/src/game`)

**Interfaces:**
- Consumes: `RaceSetup`, `CarInput` (Task 4), `dust_sim_flags` (Task 2), `MC_HEADLESS` (Task 3).
- Produces:
  ```cpp
  // particlefactory.hpp
  static ParticleFactory * instanceOrNull();   // nullptr when no factory exists

  // harness/simenvironment.hpp — one per process; owns QCoreApplication-level state
  class SimEnvironment {
  public:
      static SimEnvironment & get();                 // lazily constructs: MCWorld, stub Game, stub Database, TrackLoader (assets + tracks loaded)
      std::shared_ptr<Track> track(const QString & name) const; // by TrackData::name(); nullptr if absent
      std::vector<std::shared_ptr<Track>> allTracks() const;
      MCWorld & world();
      Game & game();
  };

  // harness/simharness.hpp
  struct HarnessConfig {
      QString track = "Monza";
      size_t cars = 12;
      size_t humans = 0;
      size_t laps = 3;
      uint64_t simSeed = 42;        // used from Task 13
      int cosmeticSeed = 0;         // MCRandom::setSeed, from Task 13
      bool particles = true;
      bool interpolationFlags = false; // Task 17
      uint64_t maxTicks = 40000;
      QString inputScript;          // file name under simtests/inputs, Task 6
  };
  struct RunResult {
      bool allFinished = false;
      uint64_t ticks = 0;
      std::vector<int> raceTimeMs;                  // per car, -1 if not finished
      std::vector<std::vector<int>> lapTimesMs;     // per car
      uint64_t collisionEvents = 0;                 // Task 6
      uint64_t recoveries = 0;                      // Task 6
  };
  class SimHarness {
  public:
      explicit SimHarness(const HarnessConfig & config);
      ~SimHarness();
      void start();                 // Race::start() at tick 0 (no start lights, spec §4.3)
      void stepOnce();              // one tick
      RunResult runToFinish();      // start() if needed, step until all finished or maxTicks
      uint64_t ticksRun() const;
      Race & race();
      Car & car(size_t index);
      std::shared_ptr<Track> track() const;
      MCWorld & world();
      RaceSetup::Session & session();
  };
  ```

- [ ] **Step 1: Write the first characterisation test** `characterization/tst_race.cpp`

```cpp
#include "simharness.hpp"
#include <QtTest>

class TstRace : public QObject
{
    Q_OBJECT
private slots:
    void monzaOneCarCompletesThreeLaps()
    {
        HarnessConfig cfg;
        cfg.track = "Monza";
        cfg.cars = 1;
        cfg.laps = 3;
        SimHarness h(cfg);
        const RunResult r = h.runToFinish();
        QVERIFY2(r.allFinished, qPrintable(QString("not finished after %1 ticks").arg(r.ticks)));
        QCOMPARE(r.lapTimesMs.at(0).size(), size_t(3));
    }
};

QTEST_GUILESS_MAIN(TstRace)
#include "tst_race.moc"
```

- [ ] **Step 2: Write `simtests/CMakeLists.txt`**

```cmake
# Headless simulation tests (spec §3.2). Built only with BUILD_TESTING and DUST_SIM_TESTS.
set(DUST ${CMAKE_SOURCE_DIR})
set(G ${DUST}/src/game)
set(MC ${G}/MiniCore/src)
find_package(Qt6 COMPONENTS Core Gui Xml Test REQUIRED)

file(GLOB MC_HEADLESS_SRC "${MC}/Core/*.cc" "${MC}/Physics/*.cc" "${MC}/Graphics/*.cc" "${MC}/Asset/*.cc" "${MC}/Text/*.cc")
list(FILTER MC_HEADLESS_SRC EXCLUDE REGEX "/contrib/")

set(SIM_INCLUDES ${G} ${DUST}/src/common ${MC}/Core ${MC}/Physics ${MC}/Graphics ${MC}/Asset ${MC}/Text
    ${G}/MTFH ${G}/menu ${G}/STFH ${G}/audio ${DUST}/src/contrib/SimpleLogger/src ${DUST}/src/contrib/Argengine/src
    ${MC}/Graphics/contrib/glm/ogl-math ${CMAKE_CURRENT_SOURCE_DIR}/harness)

add_library(minicore_headless STATIC ${MC_HEADLESS_SRC})
target_include_directories(minicore_headless PUBLIC ${SIM_INCLUDES})
target_compile_definitions(minicore_headless PUBLIC MC_HEADLESS __MC_NO_GLEW__ GLEW_STATIC GLEW_NO_GLU)
target_compile_options(minicore_headless PUBLIC -U__MC_QOPENGLFUNCTIONS__)
target_link_libraries(minicore_headless PUBLIC Qt6::Core Qt6::Gui Qt6::Xml)
set_property(TARGET minicore_headless PROPERTY CXX_STANDARD 17)
dust_sim_flags(minicore_headless)

set(DUSTSIM_SRC
    ${G}/ai.cpp ${G}/bridge.cpp ${G}/car.cpp ${G}/carfactory.cpp ${G}/carinput.cpp ${G}/carparticleeffectmanager.cpp
    ${G}/carphysicscomponent.cpp ${G}/carsoundeffectmanager.cpp ${G}/difficultyprofile.cpp ${G}/gearbox.cpp
    ${G}/graphicsfactory.cpp ${G}/map.cpp ${G}/offtrackdetector.cpp ${G}/particlefactory.cpp ${G}/pit.cpp
    ${G}/race.cpp ${G}/racesetup.cpp ${G}/settings.cpp ${G}/timing.cpp ${G}/tire.cpp ${G}/track.cpp
    ${G}/trackdata.cpp ${G}/trackloader.cpp ${G}/trackobject.cpp ${G}/trackobjectfactory.cpp ${G}/tracktile.cpp
    ${G}/tree.cpp ${G}/audio/audiosource.cpp
    ${G}/game.hpp ${G}/race.hpp ${G}/timing.hpp ${G}/difficultyprofile.hpp ${G}/pit.hpp ${G}/audio/audiosource.hpp
    ${DUST}/src/common/mapbase.cpp ${DUST}/src/common/objectbase.cpp ${DUST}/src/common/objects.cpp
    ${DUST}/src/common/route.cpp ${DUST}/src/common/targetnodebase.cpp ${DUST}/src/common/trackdatabase.cpp
    ${DUST}/src/common/tracktilebase.cpp
    stubs/stub_game.cpp stubs/stub_database.cpp
    harness/simenvironment.cpp harness/simharness.cpp)
add_library(dustsim_headless STATIC ${DUSTSIM_SRC})
set_target_properties(dustsim_headless PROPERTIES AUTOMOC ON CXX_STANDARD 17)
target_compile_definitions(dustsim_headless PUBLIC DATA_PATH="${DUST}/data"
    SIMTESTS_DIR="${CMAKE_CURRENT_SOURCE_DIR}")
target_link_libraries(dustsim_headless PUBLIC minicore_headless SimpleLogger_static)
dust_sim_flags(dustsim_headless)

function(dust_simtest name)
    add_executable(${name} ${ARGN})
    set_target_properties(${name} PROPERTIES AUTOMOC ON CXX_STANDARD 17)
    target_link_libraries(${name} PRIVATE dustsim_headless Qt6::Test)
    dust_sim_flags(${name})
    add_test(NAME ${name} COMMAND ${name})
endfunction()

dust_simtest(tst_race characterization/tst_race.cpp)
```
Later tasks append `dust_simtest(...)` lines. Executables land in `${CMAKE_CURRENT_BINARY_DIR}`, which is `build/simtests/`.

- [ ] **Step 3: Restore the stubs from S1**

```bash
mkdir -p DustRacing2D/src/game/simtests/stubs
git show d4fee49e:spikes/s1-headless/stub_game.cpp > DustRacing2D/src/game/simtests/stubs/stub_game.cpp
git show d4fee49e:spikes/s1-headless/stub_database.cpp > DustRacing2D/src/game/simtests/stubs/stub_database.cpp
```
Then edit the header comment of each to: `// simtests stub (Phase 1 spec §3.3): replaces <game.cpp|database.cpp> in the headless test build only. Never linked into dustrac-game.` In `stub_game.cpp`, the initializer list must match `game.hpp`'s current member order. If `game.hpp` gained members (Task 13 adds `m_simSeed`), add them there.

- [ ] **Step 4: Fix the seams (spec §3.3).**
  - `car.cpp` row 38: in `Car::updateAnimations` (and every other unchecked `m_soundEffectManager->` use; `grep -n "m_soundEffectManager->" car.cpp`), guard with `if (m_soundEffectManager)`.
  - Row 37: in `particlefactory.hpp/.cpp`, add `static ParticleFactory * instanceOrNull();`, returning the singleton pointer or `nullptr` when none exists. In every `ParticleFactory::instance()` caller, replace the call with:
    ```cpp
    if (auto factory = ParticleFactory::instanceOrNull(); factory)
    {
        factory->doXxx(...);   // the original call
    }
    ```
    Leave `ParticleFactory::instance()` in place for callers that are render-only. The desktop `Scene` still constructs the factory, so desktop behaviour is unchanged.

- [ ] **Step 5: Write `harness/simenvironment.cpp`.** Mirror S1 `harness.cpp` main(), lines "SimpleLogger…" through `loader.loadTracks(...)`:
  - send every log level to `std::cerr` at `Warning`;
  - construct `Game` (stub, lap count 3) and `Database` (stub);
  - construct `MCWorld` before any asset;
  - `TrackLoader` with search path `DATA_PATH "/levels"`, `loadAssets()`, `loadTracks(3, Medium)`.
  - The environment also requires a `QCoreApplication` to exist. `QTEST_GUILESS_MAIN` and `simtool`'s `main` create it, and `SimEnvironment::get()` asserts `QCoreApplication::instance()`.

- [ ] **Step 6: Write `harness/simharness.cpp`**

```cpp
SimHarness::SimHarness(const HarnessConfig & config)
  : m_config(config)
{
    auto & env = SimEnvironment::get();
    m_track = env.track(config.track);
    if (!m_track)
        qFatal("SimHarness: unknown track %s", qPrintable(config.track));
    if (config.particles)
        m_particles = std::make_unique<ParticleFactory>();
    env.game().setLapCount(static_cast<int>(config.laps));
    m_race = std::make_shared<Race>(env.game(), config.cars);

    RaceSetup::Params p;
    p.track = m_track;
    p.carCount = config.cars;
    p.humanCount = config.humans;
    p.lapCount = config.laps;
    p.decorateCar = [](Car & car, size_t index) {
        // Same handles as Scene::setupAudio; signals go nowhere.
        CarSoundEffectManager::MultiSoundHandles h;
        const auto s = std::to_string(index);
        h.engineSoundHandle = QString::fromStdString("carEngine" + s);
        h.hitSoundHandle = QString::fromStdString("carHit" + s);
        h.skidSoundHandle = QString::fromStdString("skid" + s);
        car.setSoundEffectManager(std::make_shared<CarSoundEffectManager>(car, h));
    };
    m_session = RaceSetup::build(env.world(), m_race, env.game(), p);
}

void SimHarness::start()
{
    m_race->start();
    m_started = true;
}

void SimHarness::stepOnce()
{
    RaceSetup::step(SimEnvironment::get().world(), *m_race, m_session, currentInputs(), stepLength());
    ++m_ticks;
    afterStep(); // Task 6: events and hashes
}

RunResult SimHarness::runToFinish()
{
    if (!m_started)
        start();
    const auto timing = m_race->timing().lock();
    bool allDone = false;
    while (!allDone && m_ticks < m_config.maxTicks)
    {
        stepOnce();
        allDone = true;
        for (size_t i = 0; i < m_session.cars.size(); i++)
            allDone = allDone && timing->raceCompleted(i);
    }
    RunResult r;
    r.allFinished = allDone;
    r.ticks = m_ticks;
    r.lapTimesMs = m_lapTimesMs;  // filled in afterStep() from Timing::lastLapTime on lap change
    for (size_t i = 0; i < m_session.cars.size(); i++)
        r.raceTimeMs.push_back(timing->raceCompleted(i) ? static_cast<int>(timing->raceTime(i).count()) : -1);
    return r;
}
```
`stepLength()` returns `16ms` for now; Task 6 adds the jittered mode. `currentInputs()` returns an empty vector for now; Task 6 adds scripts. `afterStep()` records lap times only: on each tick, for each car, if `timing->lap(i)` rose since the last tick, push `timing->lastLapTime(i)` into `m_lapTimesMs[i]`.

Cleanup: `~SimHarness` calls `SimEnvironment::get().world().clear()` before the cars are destroyed. That keeps the singleton world free of dangling pointers between harnesses.

- [ ] **Step 7: Build and run**

```bash
tools/dust-configure.sh ~/dust-build/p1 >/dev/null && cmake --build ~/dust-build/p1
(cd ~/dust-build/p1 && QT_QPA_PLATFORM=offscreen ctest --output-on-failure -R tst_race)
```
Expected: PASS, in a few seconds. If linking fails on a missing symbol, add the defining `.cpp` to `DUSTSIM_SRC`, never a new stub. If a crash appears at a seam S1 stubbed, fix it as a seam in Step 4 style and note it in the commit message.

- [ ] **Step 8: Verify that no GL is linked**

```bash
nm -u ~/dust-build/p1/simtests/tst_race | grep -E ' _?(gl[A-Z]|CGL|NSOpenGL|glew)' ; echo "exit=$?"
```
Expected: `exit=1`.

- [ ] **Step 9: Run the full suite, check ignores, commit**

```bash
(cd ~/dust-build/p1 && QT_QPA_PLATFORM=offscreen ctest --output-on-failure -LE parity)
git add DustRacing2D/src/game && git status --short DustRacing2D/src/game/simtests
git commit -m "test(phase1): headless simtests build, RaceSetup harness, sound/particle seam fixes"
```
Expected: 6/6 pass, and `git status` lists every new simtests file as staged (A).

---

### Task 6: Harness instrumentation: hash, events, counters, inputs, jittered dt

**Files:**
- Create: `simtests/harness/statehash.{hpp,cpp}`, `simtests/harness/upstreamdt.hpp`, `simtests/harness/inputscript.{hpp,cpp}`, `simtests/inputs/monza-lap.input`, `simtests/unit/tst_units.cpp`
- Modify: `race.hpp/.cpp` (signal `carRecovered`), `MiniCore/src/Physics/mccollisiondetector.{hh,cc}` and `MiniCore/src/Core/mcworld.{hh,cc}` (collision event counter), `simtests/harness/simharness.{hpp,cpp}`, `simtests/CMakeLists.txt`

**Interfaces:**
- Produces:
  ```cpp
  // statehash.hpp
  uint64_t fnv1a64(const void * data, size_t size, uint64_t seed = 0xcbf29ce484222325ULL);
  uint64_t stateHash(const std::vector<CarS> & cars, const Race & race); // Task 13 adds SimRandom state

  // simharness.hpp additions
  struct SimEvent { uint64_t tick; QString type; int car; int a; int b; }; // lap: a=lap,b=lapMs; position: a=pos; pit; finish: a=raceTimeMs; recovered
  enum class DtMode { Fixed, UpstreamJitter };    // HarnessConfig::dtMode, default Fixed; UpstreamJitter removed in Task 10
  // HarnessConfig: DtMode dtMode = DtMode::Fixed; uint64_t jitterSeed = 1; int hashEvery = 60;
  const std::vector<SimEvent> & SimHarness::events() const;
  const std::vector<uint64_t> & SimHarness::hashes() const;   // one per hashEvery ticks, plus the final tick

  // race.hpp
  signals: void carRecovered(size_t carIndex);   // emitted at the end of moveCarOntoPreviousCheckPoint

  // mcworld.hh / mccollisiondetector.hh
  uint64_t MCWorld::collisionEventCount() const;         // new non-trigger pairs that started colliding, since clear()
  uint64_t MCCollisionDetector::collisionEventCount() const;

  // inputscript.hpp
  class InputScript { public: static InputScript load(const QString & path); CarInput at(uint64_t tick) const; };
  ```

- [ ] **Step 1: Write the failing unit tests** in `simtests/unit/tst_units.cpp`

```cpp
#include "statehash.hpp"
#include "inputscript.hpp"
#include "upstreamdt.hpp"
#include <QtTest>

class TstUnits : public QObject
{
    Q_OBJECT
private slots:
    void fnvKnownVectors()
    {
        QCOMPARE(fnv1a64("", 0), 0xcbf29ce484222325ULL);
        QCOMPARE(fnv1a64("a", 1), 0xaf63dc4c8601ec8cULL);
        QCOMPARE(fnv1a64("foobar", 6), 0x85944171f73967e8ULL);
    }
    void inputScriptHoldsUntilNextLine()
    {
        QTemporaryFile f;
        QVERIFY(f.open());
        f.write("# tick accelerate brake left right\n0 1 0 0 0\n10 1 0 1 0\n20 0 1 0 0\n");
        f.flush();
        const auto s = InputScript::load(f.fileName());
        QVERIFY(s.at(0).accelerate && !s.at(0).left);
        QVERIFY(s.at(9).accelerate && !s.at(9).left);
        QVERIFY(s.at(10).left);
        QVERIFY(s.at(25).brake && !s.at(25).accelerate);
    }
    void upstreamDtIsAveragedAndSeeded()
    {
        UpstreamDt a(7), b(7);
        int sum = 0;
        for (int i = 0; i < 1000; i++)
        {
            const int da = a.next();
            QCOMPARE(da, b.next());
            QVERIFY(da >= 16 && da <= 33);
            sum += da;
        }
        QVERIFY(sum > 16000 && sum < 17500);
    }
};
QTEST_GUILESS_MAIN(TstUnits)
#include "tst_units.moc"
```
Add `harness/statehash.cpp` and `harness/inputscript.cpp` to `DUSTSIM_SRC` (the harness needs them), and add `dust_simtest(tst_units unit/tst_units.cpp)`.

- [ ] **Step 2: Run it to verify it fails**

Run: `cmake --build ~/dust-build/p1 2>&1 | tail -3`
Expected: compile error, `statehash.hpp` not found.

- [ ] **Step 3: Implement.**

```cpp
// statehash.cpp
#include "statehash.hpp"
#include "car.hpp"
#include "race.hpp"
#include "timing.hpp"
#include <MCPhysicsComponent>
#include <cstring>

uint64_t fnv1a64(const void * data, size_t size, uint64_t h)
{
    const auto * p = static_cast<const unsigned char *>(data);
    for (size_t i = 0; i < size; i++)
    {
        h ^= p[i];
        h *= 0x100000001b3ULL;
    }
    return h;
}

namespace {
template<typename T>
void mix(uint64_t & h, T v)
{
    unsigned char b[sizeof(T)];
    std::memcpy(b, &v, sizeof(T));   // raw IEEE / integer bits, no float formatting
    h = fnv1a64(b, sizeof(T), h);
}
} // namespace

uint64_t stateHash(const std::vector<CarS> & cars, const Race & race)
{
    uint64_t h = 0xcbf29ce484222325ULL;
    const auto timing = race.timing().lock();
    for (auto && car : cars)
    {
        const auto i = car->index();
        mix(h, car->location().i());
        mix(h, car->location().j());
        mix(h, car->angle());
        mix(h, car->physicsComponent().velocity().i());
        mix(h, car->physicsComponent().velocity().j());
        mix(h, car->physicsComponent().angularVelocity());
        mix(h, static_cast<uint64_t>(timing->lap(i)));
        mix(h, static_cast<uint64_t>(race.position(i)));
        mix(h, static_cast<uint64_t>(race.getCurrentTargetNodeIndex(i)));
    }
    return h;
}
```

```cpp
// upstreamdt.hpp — reproduces game.cpp's averaged whole-ms delta at a 16 ms QTimer (spec §6.1).
// Portable 64-bit LCG; raw delta 16 ms (70 %), 17 ms (28 %), 33 ms (2 %, a missed frame).
#pragma once
#include <cstdint>
class UpstreamDt
{
public:
    explicit UpstreamDt(uint64_t seed) : m_x(seed * 2 + 1) {}
    int next()
    {
        m_x = m_x * 6364136223846793005ULL + 1442695040888963407ULL;
        const int roll = static_cast<int>((m_x >> 33) % 100);
        const int raw = roll < 70 ? 16 : roll < 98 ? 17 : 33;
        const int dt = (raw + m_last) / 2;   // game.cpp:116: (deltaMs + m_lastDeltaMs) / 2
        m_last = raw;
        return dt;
    }
private:
    uint64_t m_x;
    int m_last = 16;
};
```

`inputscript.cpp` parses lines `tick accelerate brake left right`, skips `#` comments and blank lines, and keeps the lines sorted by tick. `at(t)` returns the last line with `tick <= t`, or a default `CarInput` before the first line.

`simtests/inputs/monza-lap.input`:
```text
# tick accelerate brake left right  (held until the next line; Phase 1 input contract, spec §6.3)
0 1 0 0 0
180 1 0 1 0
215 1 0 0 0
600 0 1 0 0
640 1 0 0 1
690 1 0 0 0
1200 1 0 1 0
1260 1 0 0 0
2400 0 1 0 0
2460 1 0 0 1
2520 1 0 0 0
```

- [ ] **Step 4: Add the counters and the signal.**
  - `MCCollisionDetector`: add `uint64_t m_collisionEventCount = 0;` and increment it inside each of the three `if (!areColliding) { MCObject::sendEvent(...) ... }` blocks (rect–rect, rect–circle, circle–circle) when `!triggerObjectInvolved`. `clear()` resets it.
  - `MCWorld::collisionEventCount()` forwards to the detector.
  - `Race`: add `void carRecovered(size_t carIndex);` under `signals:` and `emit carRecovered(car.index());` as the last line of `moveCarOntoPreviousCheckPoint`.
  - Upstream stuck detection and the move happen in the same call, so "stuck" and "recovered" are one event (spec §6.3 lists both; the contract records one `recovered` event).

- [ ] **Step 5: Extend `SimHarness`.**
  - `stepLength()`: in `UpstreamJitter` mode, `std::chrono::milliseconds(m_dt.next())`; otherwise 16 ms.
  - `currentInputs()`: when `humans > 0` and `inputScript` is set, one `CarInput` from `m_script.at(m_ticks)` (loaded from `SIMTESTS_DIR "/inputs/" + inputScript`); otherwise a default `CarInput` per human.
  - `afterStep()`, after the lap-time bookkeeping from Task 5:
    - per car: on a lap rise, push `{tick, "lap", i, lap, lastLapTime}`;
    - on a change of `race.position(i)`, push `{tick, "position", i, pos, 0}`;
    - on a `raceCompleted` rising edge, push `{tick, "finish", i, raceTimeMs, 0}`;
    - when `m_ticks % hashEvery == 0`, push `stateHash(cars, race)` onto `m_hashes`.
  - `runToFinish()` pushes one final hash after the loop when `m_ticks % hashEvery != 0`.
  - In the constructor:
    - `connect(m_race.get(), &Race::carRecovered, …)` pushes `{m_ticks + 1, "recovered", i, 0, 0}`, and `++m_recoveries`. The tick is `+ 1` because the signal fires during step `m_ticks + 1`.
    - `connect(m_race.get(), &Race::tiresChanged, …)` pushes `{m_ticks + 1, "pit", car.index(), 0, 0}`.
  - `RunResult` gets `collisionEvents = world.collisionEventCount()` and `recoveries = m_recoveries`.

- [ ] **Step 6: Run the tests**

```bash
cmake --build ~/dust-build/p1 && (cd ~/dust-build/p1 && QT_QPA_PLATFORM=offscreen ctest --output-on-failure -LE parity)
```
Expected: 7/7 pass (5 upstream + `tst_race` + `tst_units`).

- [ ] **Step 7: Commit**

```bash
git add DustRacing2D/src/game && git commit -m "test(phase1): state hash, event log, collision/recovery counters, input scripts, upstream dt model"
```

---

### Task 7: Characterisation — laps, positions, finish, startup

**Files:**
- Modify: `simtests/characterization/tst_race.cpp`, `simtests/CMakeLists.txt` (`set_tests_properties(tst_race PROPERTIES TIMEOUT 600)`)

**Interfaces:**
- Consumes: `SimHarness`, `RunResult`, `SimEvent`, `DtMode::UpstreamJitter` (Task 6).
- Produces: the characterisation suite. Until Task 10 it runs in `UpstreamJitter` mode; Task 10 flips it to `Fixed`. The constant `CHARACTERIZATION_DT` at the top of the file holds the mode.

- [ ] **Step 1: Write the tests** (replace the body of `TstRace`)

```cpp
namespace {
const DtMode CHARACTERIZATION_DT = DtMode::UpstreamJitter; // Task 10 changes this to DtMode::Fixed
const char * TRACKS[] = { "Monza", "Suzuka", "Twister" };
// Plausibility band per track, AI lap time ms: from the Task 9 baseline mean ±50 %.
// Until Task 9 records the baseline, use the wide band [5000, 120000].
struct Band { int lo; int hi; };
Band lapBand(const QString &) { return { 5000, 120000 }; }

HarnessConfig cfg(const QString & track, uint64_t seed = 1)
{
    HarnessConfig c;
    c.track = track;
    c.cars = 12;
    c.laps = 3;
    c.dtMode = CHARACTERIZATION_DT;
    c.jitterSeed = seed;
    return c;
}
} // namespace

private slots:
    void laps_data()
    {
        QTest::addColumn<QString>("track");
        for (auto t : TRACKS) QTest::newRow(t) << QString(t);
    }
    void laps()
    {
        QFETCH(QString, track);
        SimHarness h(cfg(track));
        const auto r = h.runToFinish();
        QVERIFY2(r.allFinished, qPrintable(QString("%1: unfinished at tick %2").arg(track).arg(r.ticks)));
        const auto band = lapBand(track);
        for (size_t car = 0; car < r.lapTimesMs.size(); car++)
        {
            QCOMPARE(r.lapTimesMs[car].size(), size_t(3));
            for (int ms : r.lapTimesMs[car])
                QVERIFY2(ms >= band.lo && ms <= band.hi, qPrintable(QString("car %1 lap %2 ms").arg(car).arg(ms)));
        }
        // Each lap event raises that car's lap by exactly one.
        std::map<int, int> lastLap;
        for (auto && e : h.events())
            if (e.type == "lap")
            {
                QCOMPARE(e.a, lastLap[e.car] + 1);
                lastLap[e.car] = e.a;
            }
    }
    void positionsArePermutationAndClassificationSorted()
    {
        SimHarness h(cfg("Monza"));
        h.start();
        auto timing = h.race().timing().lock();
        bool allFinished = false;
        while (!allFinished && h.ticksRun() < 40000)
        {
            h.stepOnce();
            std::vector<size_t> pos;
            for (size_t i = 0; i < 12; i++) pos.push_back(h.race().position(i));
            if (std::count(pos.begin(), pos.end(), size_t(0)) == 0) // every car past checkpoint 0
            {
                std::sort(pos.begin(), pos.end());
                for (size_t i = 0; i < 12; i++) QCOMPARE(pos[i], i + 1);
            }
            allFinished = true;
            for (size_t i = 0; i < 12; i++) allFinished = allFinished && timing->raceCompleted(i);
        }
        QVERIFY(allFinished);
        std::vector<std::pair<int, size_t>> byTime;
        for (size_t i = 0; i < 12; i++) byTime.push_back({ int(timing->raceTime(i).count()), h.race().position(i) });
        std::sort(byTime.begin(), byTime.end());
        for (size_t k = 0; k < byTime.size(); k++) QCOMPARE(byTime[k].second, k + 1);
    }
    void finishStopsTiming()
    {
        SimHarness h(cfg("Monza"));
        const auto r = h.runToFinish();
        QVERIFY(r.allFinished);
        for (int ms : r.raceTimeMs) QVERIFY(ms > 0);
        const int before = int(h.race().timing().lock()->raceTime(0).count());
        for (int i = 0; i < 60; i++) h.stepOnce();
        QCOMPARE(int(h.race().timing().lock()->raceTime(0).count()), before);
    }
    void startupAllTracks()
    {
        for (auto && track : SimEnvironment::get().allTracks())
        {
            HarnessConfig c = cfg(track->trackData().name());
            SimHarness h(c);
            h.start();
            for (int i = 0; i < 300; i++) h.stepOnce();
            QVERIFY2(h.ticksRun() == 300, qPrintable(track->trackData().name()));
        }
    }
```
`positionsArePermutation…` assumes that `Race::position(i)` after the finish ranks by finishing order. If the first run shows otherwise (for example ties in `raceTime` at whole-ms resolution), compare with a stable sort by `(raceTime, position)`, record the observed upstream rule in a comment, and keep the strict permutation check.

- [ ] **Step 2: Run them.** This is characterisation of existing behaviour, so the expected result is a pass. A failure means either a harness bug or a genuine upstream property violation. Investigate with superpowers:systematic-debugging; never loosen a property without recording why in the test.

Run: `(cd ~/dust-build/p1 && QT_QPA_PLATFORM=offscreen ctest --output-on-failure -R tst_race)`
Expected: PASS. Record the runtime from the ctest output in the commit message.

- [ ] **Step 3: Commit**

```bash
git add DustRacing2D/src/game/simtests && git commit -m "test(phase1): characterisation of laps, positions, finish, startup on upstream semantics"
```

---

### Task 8: Characterisation — pits, collisions, AI recovery

**Files:**
- Create: `simtests/characterization/tst_scenarios.cpp`
- Modify: `simtests/CMakeLists.txt` (`dust_simtest(tst_scenarios characterization/tst_scenarios.cpp)`)

**Interfaces:**
- Consumes: `SimHarness`, `SimEvent` "pit" and "recovered", `MCWorld::collisionEventCount()`.

- [ ] **Step 1: Write the tests**

```cpp
#include "simharness.hpp"
#include "car.hpp"
#include "pit.hpp"
#include "race.hpp"
#include "timing.hpp"
#include "track.hpp"
#include "trackdata.hpp"
#include "trackobject.hpp"
#include "../common/objects.hpp"
#include <MCPhysicsComponent>
#include <MCRectShape>
#include <MCWorld>
#include <QtTest>

namespace {
const DtMode SCENARIO_DT = DtMode::UpstreamJitter; // Task 10 changes this to DtMode::Fixed

MCObject * findObject(Track & track, const QString & role)
{
    for (size_t i = 0; i < track.trackData().objects().count(); i++)
    {
        auto o = std::dynamic_pointer_cast<TrackObject>(track.trackData().objects().object(i));
        if (o && o->role() == role) return &o->object();
    }
    return nullptr;
}

void park(Car & car, MCVector3dF where, float angle)
{
    car.translate(where);
    car.rotate(angle);
    car.physicsComponent().reset();
}
} // namespace

class TstScenarios : public QObject
{
    Q_OBJECT
private slots:
    void pitStopResetsTyres()
    {
        HarnessConfig c; c.track = "Monza"; c.cars = 2; c.humans = 1; c.laps = 3; c.dtMode = SCENARIO_DT;
        SimHarness h(c);
        h.start();
        h.race().timing().lock()->setLapCompleted(0, true);   // Race::pitStop ignores lap 0
        auto pit = findObject(*h.track(), "pit");
        QVERIFY(pit);
        park(h.car(0), pit->location(), 0);
        for (int i = 0; i < 30; i++) h.stepOnce();
        const auto & ev = h.events();
        QVERIFY(std::any_of(ev.begin(), ev.end(), [](auto && e) { return e.type == "pit" && e.car == 0; }));
    }
    void headOnCarsExchangeImpulse()
    {
        HarnessConfig c; c.track = "Monza"; c.cars = 2; c.dtMode = SCENARIO_DT; // race not started: AI idle
        SimHarness h(c);
        auto & a = h.car(0);
        auto & b = h.car(1);
        const auto start = h.track()->trackData().route().get(0)->location();
        const MCVector3dF mid(float(start.x()), float(start.y()), 0);
        park(a, mid + MCVector3dF(-60, 0, 0), 0);
        park(b, mid + MCVector3dF(60, 0, 0), 180);
        a.physicsComponent().setVelocity(MCVector3dF(4, 0, 0));
        b.physicsComponent().setVelocity(MCVector3dF(-4, 0, 0));
        const auto before = h.world().collisionEventCount();
        for (int i = 0; i < 60; i++) h.stepOnce();
        QVERIFY(h.world().collisionEventCount() > before);
        QVERIFY(a.physicsComponent().velocity().i() < 4.0f);
        QVERIFY(b.physicsComponent().velocity().i() > -4.0f);
        QVERIFY((b.location() - a.location()).lengthFast() > 10.0f); // resolved, not merged
    }
    void carStopsAtWall()
    {
        HarnessConfig c; c.track = "Monza"; c.cars = 1; c.dtMode = SCENARIO_DT;
        SimHarness h(c);
        auto wall = findObject(*h.track(), "wall");
        QVERIFY(wall);
        auto & car = h.car(0);
        const auto w = wall->location();
        park(car, w + MCVector3dF(0, -80, 0), 90);
        car.physicsComponent().setVelocity(MCVector3dF(0, 5, 0));
        for (int i = 0; i < 300; i++)
        {
            h.stepOnce();
            QVERIFY2(!wall->shape()->contains(MCVector2dF(car.location())), qPrintable(QString("tick %1").arg(i)));
        }
        QVERIFY(car.location().j() < w.j());
    }
    void stuckAiIsRecoveredAndFinishes()
    {
        HarnessConfig c; c.track = "Monza"; c.cars = 3; c.laps = 2; c.dtMode = SCENARIO_DT;
        SimHarness h(c);
        h.start();
        auto & car = h.car(2);
        const auto pin = car.location() + MCVector3dF(0, 0, 0);
        bool recovered = false;
        uint64_t pinnedTicks = 0;
        while (!recovered && pinnedTicks < 600)
        {
            park(car, pin, car.angle());  // hold it on one tile, as if stuck
            h.stepOnce();
            ++pinnedTicks;
            for (auto && e : h.events()) recovered = recovered || (e.type == "recovered" && e.car == 2);
        }
        QVERIFY2(recovered, "stuck AI was not recovered within 600 ticks");
        QVERIFY(pinnedTicks >= 290 && pinnedTicks <= 330); // STUCK_LIMIT ≈ 5 s
        const auto r = h.runToFinish();
        QVERIFY(r.allFinished);
    }
};
QTEST_GUILESS_MAIN(TstScenarios)
#include "tst_scenarios.moc"
```
If `Route::get(0)->location()` is not on a straight wide enough for ±60 units, pick the midpoint of the first route segment longer than 300 units. Compute it in the test and keep the code general.

- [ ] **Step 2: Run them.** Expected: PASS. If `stuckAiIsRecovered…` fails on the tick window, print `pinnedTicks` and check upstream `checkIfCarIsStuck`. The counter resets when the tile changes, so make sure `park` keeps the car on one tile.

Run: `(cd ~/dust-build/p1 && QT_QPA_PLATFORM=offscreen ctest --output-on-failure -R tst_scenarios)`

- [ ] **Step 3: Commit**

```bash
git add DustRacing2D/src/game/simtests && git commit -m "test(phase1): characterisation of pit stop, collisions, stuck recovery"
```

---

### Task 9: Parity metrics, `simtool`, baseline recorded on upstream semantics

**Files:**
- Create: `simtests/harness/parity.{hpp,cpp}`, `simtests/tools/simtool.cpp`, `simtests/parity/baseline-macos-arm64.json`
- Modify: `simtests/CMakeLists.txt`, `simtests/characterization/tst_race.cpp` (`lapBand` from the baseline)

**Interfaces:**
- Produces:
  ```cpp
  // parity.hpp
  struct ParityRun { double meanAiLapMs; double winnerRaceMs; double collisionEvents; double recoveries; };
  struct Stat { double mean; double sd; int n; };
  struct TrackStats { Stat meanAiLapMs, winnerRaceMs, collisionEvents, recoveries; };
  ParityRun runParityRace(const QString & track, DtMode mode, uint64_t seed); // 12 AI, 3 laps
  TrackStats summarize(const std::vector<ParityRun> & runs);
  QJsonObject toJson(const std::map<QString, TrackStats> & stats);
  std::map<QString, TrackStats> statsFromJson(const QJsonObject & o);
  QString platformName(); // "macos-arm64" | "linux-x86_64" | "unknown"
  // simtool: `simtool parity baseline [--out FILE]`, `simtool parity check [--baseline FILE]`, `simtool record ...` (Task 16)
  ```

- [ ] **Step 1: Write the failing test for `summarize`.** Append to `tst_units.cpp`:

```cpp
    void summarizeMeanAndSampleSd()
    {
        std::vector<ParityRun> runs = { { 10, 0, 0, 0 }, { 20, 0, 0, 0 }, { 30, 0, 0, 0 } };
        const auto s = summarize(runs);
        QCOMPARE(s.meanAiLapMs.mean, 20.0);
        QCOMPARE(s.meanAiLapMs.sd, 10.0);   // sample sd (n-1)
        QCOMPARE(s.meanAiLapMs.n, 3);
    }
```
Run: `cmake --build ~/dust-build/p1` → expected compile failure (`parity.hpp` missing).

- [ ] **Step 2: Implement `parity.cpp`.** `runParityRace` builds `HarnessConfig { track, cars 12, laps 3, dtMode = mode, jitterSeed = seed, simSeed = seed }` and runs to finish:
  - `meanAiLapMs` = mean of all lap times of all cars;
  - `winnerRaceMs` = min over `raceTimeMs`;
  - `collisionEvents` and `recoveries` come from `RunResult`.
  - If `!allFinished`, abort with `qFatal` naming the track and seed.
  - `platformName()`:

```cpp
QString platformName()
{
#if defined(__APPLE__) && defined(__aarch64__)
    return "macos-arm64";
#elif defined(__linux__) && defined(__x86_64__)
    return "linux-x86_64";
#else
    return "unknown";
#endif
}
```

- [ ] **Step 3: Write `simtool.cpp`** (`QCoreApplication app; …`)
  - `parity baseline`: for each of Monza, Suzuka, Twister, seeds 1..20, `runParityRace(track, DtMode::UpstreamJitter, seed)`. Writes JSON to `--out`, default `SIMTESTS_DIR "/parity/baseline-" + platformName() + ".json"`, with keys `{ "schema": 1, "mode": "upstream-jitter", "runs": 20, "tracks": { "Monza": { "meanAiLapMs": {"mean":…,"sd":…,"n":20}, … } } }`.
  - `parity check`: runs `DtMode::Fixed`, seeds 1..20. Loads the baseline and prints one line per track and metric: `PASS|FAIL track metric candidateMean baselineMean±2sd`. Exit code 1 on any FAIL.
  - CMake:
    ```cmake
    add_executable(simtool tools/simtool.cpp)
    target_link_libraries(simtool PRIVATE dustsim_headless)
    dust_sim_flags(simtool)
    ```
    and add `harness/parity.cpp` to `DUSTSIM_SRC`.

- [ ] **Step 4: Run the unit test, then record the baseline**

```bash
cmake --build ~/dust-build/p1 && (cd ~/dust-build/p1 && QT_QPA_PLATFORM=offscreen ctest -R tst_units --output-on-failure)
time ~/dust-build/p1/simtests/simtool parity baseline
```
Expected: the unit test passes, and the baseline JSON is written. The runtime is about 3 × 20 × 7 s ≈ 7 min; run it in the background. Sanity-check that every `sd > 0`, because upstream varies run to run.

- [ ] **Step 5: Tighten `lapBand`** in `tst_race.cpp`. Load the baseline JSON (`SIMTESTS_DIR "/parity/baseline-macos-arm64.json"`) and return `{ int(mean * 0.5), int(mean * 1.5) }` from `meanAiLapMs.mean` for the track. Keep `[5000, 120000]` as the fallback for tracks outside the baseline (used by `startupAllTracks`, which does not call `lapBand`). Re-run `tst_race`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add DustRacing2D/src/game/simtests && git check-ignore -v DustRacing2D/src/game/simtests/parity/baseline-macos-arm64.json; echo "ignored-exit=$?"
git commit -m "test(phase1): parity metrics, simtool, upstream parity baseline (macOS arm64)"
```
Expected: `ignored-exit=1`.

---

### Task 10: Fixed tick: `simtime.hpp`, tick counter, tick-based `Timing`, frame-counted constants

**Files:**
- Create: `DustRacing2D/src/game/simtime.hpp`
- Modify: `race.hpp/.cpp`, `timing.hpp/.cpp`, `gearbox.cpp`, `simtests/harness/simharness.*` (remove `UpstreamJitter`), `simtests/harness/upstreamdt.hpp` (delete), `tst_units.cpp` (drop `upstreamDtIsAveragedAndSeeded`), `tst_race.cpp` and `tst_scenarios.cpp` (`DtMode::Fixed`), `simtests/harness/parity.cpp` (`baseline` keeps working from the committed JSON only; `simtool parity baseline` now refuses with "baseline is recorded on upstream semantics only (Task 9)")

**Interfaces:**
- Produces:
  ```cpp
  // simtime.hpp
  namespace SimTime {
  constexpr int TICK_MS = 16;
  constexpr std::chrono::milliseconds TICK { TICK_MS };
  constexpr int ticksFor(int ms) { return (ms + TICK_MS / 2) / TICK_MS; }   // nearest
  }
  // race.hpp
  uint64_t Race::tick() const;   // 0 after initialize(); tick N = state after N steps
  ```

- [ ] **Step 1: Write the failing tests.** Append to `tst_units.cpp`:

```cpp
    void ticksForRoundsToNearest()
    {
        static_assert(SimTime::ticksFor(5000) == 313);
        static_assert(SimTime::ticksFor(1000) == 63);
        static_assert(SimTime::ticksFor(500) == 31);
        static_assert(SimTime::ticksFor(16) == 1);
    }
```
Append to `tst_race.cpp`:

```cpp
    void tickNumberingAndTiming()
    {
        HarnessConfig c; c.track = "Monza"; c.cars = 1;
        SimHarness h(c);
        QCOMPARE(h.race().tick(), uint64_t(0));
        h.stepOnce();
        QCOMPARE(h.race().tick(), uint64_t(1));       // first step produces tick 1
        h.start();
        for (int i = 0; i < 10; i++) h.stepOnce();
        QCOMPARE(h.race().tick(), uint64_t(11));
        QCOMPARE(int(h.race().timing().lock()->raceTime().count()), 10 * 16);
    }
    void lapTimesAreTickMultiples()
    {
        HarnessConfig c; c.track = "Monza"; c.cars = 1;
        SimHarness h(c);
        const auto r = h.runToFinish();
        for (int ms : r.lapTimesMs.at(0)) QCOMPARE(ms % 16, 0);
    }
```
Run: `cmake --build ~/dust-build/p1` → expected compile failure (`simtime.hpp` and `Race::tick` missing).

- [ ] **Step 2: Implement.**
  - `Race`: add `uint64_t m_tick = 0;`, reset to 0 in `initialize()`. At the very end of `update()`, `++m_tick;`. Also add `assert(timeStep == SimTime::TICK);` at the top of `update()`.
  - `Timing`: replace `std::chrono::milliseconds m_time` with `uint64_t m_ticks = 0`.
    - `tick(timeStep)`: `assert(timeStep == SimTime::TICK); if (m_started) ++m_ticks;`.
    - Add `std::chrono::milliseconds Timing::now() const { return std::chrono::milliseconds(m_ticks * SimTime::TICK_MS); }`, and replace every read of `m_time` with `now()`.
    - `start()` and `reset()` set `m_ticks = 0`.
  - Frame-counted constants (spec §4.4):
    - `race.cpp` `STUCK_LIMIT = SimTime::ticksFor(5000)`; keep `>=`.
    - `OFF_TRACK_LIMIT = SimTime::ticksFor(1000)`; keep `>`.
    - `gearbox.cpp:46` `if (++m_stopCounter >= SimTime::ticksFor(500))` (31, unchanged count).
  - Then grep sim sources for further frame-counted literals:
    ```bash
    grep -nE '\b(60|30|120)\b' DustRacing2D/src/game/{car,ai,race,timing,tire,gearbox,carphysicscomponent,offtrackdetector,pit}.cpp
    ```
    For each hit that counts update calls, convert it with `ticksFor` and add a row to the spec §4.4 table in the same commit. List every hit judged not to be a frame count (angles, percentages) in the commit message.
  - Harness: delete `DtMode::UpstreamJitter`, `jitterSeed` and `upstreamdt.hpp`. Characterisation constants become `DtMode::Fixed`; then delete the `DtMode` enum entirely, since only Fixed is left, and remove `dtMode` from `HarnessConfig` and `runParityRace`.

- [ ] **Step 3: Run everything**

Run: `cmake --build ~/dust-build/p1 && (cd ~/dust-build/p1 && QT_QPA_PLATFORM=offscreen ctest --output-on-failure -LE parity)`
Expected: all pass. A characterisation failure here is a behaviour change of the fixed tick: debug it, don't loosen the test.

- [ ] **Step 4: Commit**

```bash
git add DustRacing2D/src/game docs/superpowers/specs/2026-10-15-phase1-sim-stabilization-design.md
git commit -m "feat(phase1): 16 ms tick counter, tick-based Timing, frame-counted constants via ticksFor"
```

---

### Task 11: `FixedStepAccumulator` and the desktop loop

**Files:**
- Create: `DustRacing2D/src/game/fixedstepaccumulator.hpp`
- Modify: `game.hpp/.cpp`, `tst_units.cpp`

**Interfaces:**
- Produces:
  ```cpp
  class FixedStepAccumulator {
  public:
      explicit FixedStepAccumulator(int64_t stepNs = 16'000'000, int maxSteps = 5);
      int advance(int64_t elapsedNs);   // adds time, returns steps to run now (0..maxSteps), drops excess beyond the cap
      void reset();                     // accumulated time := 0
      float alpha() const;              // accumulated / step, in [0, 1)
      int64_t accumulatedNs() const;
  };
  ```

- [ ] **Step 1: Write the failing tests** (in `tst_units.cpp`)

```cpp
    void accumulatorSteps()
    {
        FixedStepAccumulator a;
        QCOMPARE(a.advance(16'000'000), 1);
        QCOMPARE(a.alpha(), 0.0f);
        QCOMPARE(a.advance(10'000'000), 0);
        QCOMPARE(a.alpha(), 0.625f);
        QCOMPARE(a.advance(10'000'000), 1);
        QCOMPARE(a.accumulatedNs(), int64_t(4'000'000));
    }
    void capDropsExcess()
    {
        FixedStepAccumulator a;
        QCOMPARE(a.advance(200'000'000), 5);
        QVERIFY(a.accumulatedNs() < 16'000'000);
        QCOMPARE(a.advance(0), 0);           // nothing queued from the dropped 120 ms
    }
    void resetAfterStall()
    {
        FixedStepAccumulator a;
        a.advance(15'000'000);
        a.reset();
        QCOMPARE(a.accumulatedNs(), int64_t(0));
        QCOMPARE(a.alpha(), 0.0f);
    }
```
Run: `cmake --build ~/dust-build/p1` → compile failure.

- [ ] **Step 2: Implement the header**

```cpp
#pragma once
#include <algorithm>
#include <cstdint>

//! Converts wall-clock frame time into whole 16 ms sim ticks (spec §4.1).
class FixedStepAccumulator
{
public:
    explicit FixedStepAccumulator(int64_t stepNs = 16'000'000, int maxSteps = 5)
      : m_stepNs(stepNs), m_maxSteps(maxSteps)
    {
    }

    int advance(int64_t elapsedNs)
    {
        m_accNs += std::max<int64_t>(0, elapsedNs);
        const int64_t due = m_accNs / m_stepNs;
        const int steps = static_cast<int>(std::min<int64_t>(due, m_maxSteps));
        m_accNs -= steps * m_stepNs;
        if (steps == m_maxSteps && m_accNs >= m_stepNs)
        {
            m_accNs = m_stepNs - 1; // drop the excess: time dilates instead of spiralling
        }
        return steps;
    }

    void reset() { m_accNs = 0; }
    float alpha() const { return static_cast<float>(static_cast<double>(m_accNs) / static_cast<double>(m_stepNs)); }
    int64_t accumulatedNs() const { return m_accNs; }

private:
    int64_t m_stepNs;
    int m_maxSteps;
    int64_t m_accNs = 0;
};
```

- [ ] **Step 3: Wire up `game.cpp`.**
  - Members: replace `qint64 m_lastUpdateTime` and `m_lastDeltaMs` with `qint64 m_lastFrameNs = 0; FixedStepAccumulator m_stepper; StateMachine::State m_lastState;`.
  - In the constructor, after `m_elapsedTimer.start()`: `m_lastFrameNs = m_elapsedTimer.nsecsElapsed();`.
  - Timer lambda:

```cpp
    connect(&m_updateTimer, &QTimer::timeout, this, [this]() {
        const qint64 now = m_elapsedTimer.nsecsElapsed();
        const qint64 elapsed = now - m_lastFrameNs;
        m_lastFrameNs = now;

        m_stateMachine->update();                        // once per frame, as upstream
        if (m_stateMachine->state() != m_lastState)
        {
            m_lastState = m_stateMachine->state();
            m_stepper.reset();                           // no catch-up burst after menus or loading
        }
        const int steps = m_stepper.advance(elapsed);
        for (int i = 0; i < steps; i++)
        {
            m_scene->updateFrame(*m_inputHandler, SimTime::TICK);
        }
        MCWorld::setRenderAlpha(m_stepper.alpha());      // Task 17 adds this; until then omit this line
        m_scene->updateOverlays();
        m_renderer->renderNow();
    });
```
  - In `togglePause`, on both pause and unpause: `m_stepper.reset(); m_lastFrameNs = m_elapsedTimer.nsecsElapsed();`.
  - `m_timeStep` / `m_updateDelay` stay: the `QTimer` interval is unchanged.
  - Add `fixedstepaccumulator.hpp` to `HDR` in `src/game/CMakeLists.txt`.

- [ ] **Step 4: Run tests, build desktop, run the smoke test**

```bash
cmake --build ~/dust-build/p1 && (cd ~/dust-build/p1 && QT_QPA_PLATFORM=offscreen ctest --output-on-failure -LE parity)
```
Then repeat Task 4 Step 6's smoke test. Expected: all pass, no crash lines.

- [ ] **Step 5: Commit**

```bash
git add DustRacing2D/src/game && git commit -m "feat(phase1): desktop loop on 16 ms fixed ticks, 5-tick cap, reset on pause and state change"
```

---

### Task 12: `SimRandom`

**Files:**
- Create: `DustRacing2D/src/game/simrandom.hpp`, `simrandom.cpp`
- Modify: `src/game/CMakeLists.txt` (`SRC`), `simtests/CMakeLists.txt` (`DUSTSIM_SRC`), `tst_units.cpp`

**Interfaces:**
- Produces:
  ```cpp
  class SimRandom {
  public:
      using State = std::array<uint64_t, 4>;
      explicit SimRandom(uint64_t seed = 0);
      void reseed(uint64_t seed);
      uint64_t next();
      float uniform();                  // [0, 1), top 24 bits
      float uniform(float lo, float hi);
      MCVector2dF vector2d();           // (uniform()-0.5, uniform()-0.5).normalized(), as MCRandom::randomVector2d
      State state() const;
      void setState(const State & s);
  };
  ```

- [ ] **Step 1: Write the failing tests.** The reference values were computed independently from the published SplitMix64 and xoshiro256** algorithms:

```cpp
    void simRandomSeedsWithSplitMix64()
    {
        SimRandom r(0);
        const SimRandom::State s = { 0xe220a8397b1dcdafULL, 0x6e789e6aa1b965f4ULL, 0x06c45d188009454fULL, 0xf88bb8a8724c81ecULL };
        QCOMPARE(r.state(), s);
    }
    void simRandomKnownSequence()
    {
        SimRandom r(42);
        QCOMPARE(r.next(), 0x15780b2e0c2ec716ULL);
        QCOMPARE(r.next(), 0x6104d9866d113a7eULL);
        QCOMPARE(r.next(), 0xae17533239e499a1ULL);
    }
    void simRandomUniformIsTop24Bits()
    {
        SimRandom r(0);
        QCOMPARE(r.uniform(), float(0x99ec5fULL) / 16777216.0f);   // 0x99ec5f36cb75f2b4 >> 40
        QCOMPARE(r.uniform(), float(0xbf6e1fULL) / 16777216.0f);
    }
    void simRandomStateRoundTrip()
    {
        SimRandom a(7);
        a.next();
        SimRandom b(1);
        b.setState(a.state());
        QCOMPARE(a.next(), b.next());
    }
```
Run → compile failure.

- [ ] **Step 2: Implement**

```cpp
// simrandom.cpp
#include "simrandom.hpp"

namespace {
uint64_t rotl(uint64_t x, int k) { return (x << k) | (x >> (64 - k)); }
uint64_t splitmix64(uint64_t & x)
{
    uint64_t z = (x += 0x9E3779B97F4A7C15ULL);
    z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL;
    z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL;
    return z ^ (z >> 31);
}
} // namespace

SimRandom::SimRandom(uint64_t seed) { reseed(seed); }

void SimRandom::reseed(uint64_t seed)
{
    uint64_t x = seed;
    for (auto & word : m_s) word = splitmix64(x);
}

uint64_t SimRandom::next()
{
    const uint64_t result = rotl(m_s[1] * 5, 7) * 9;
    const uint64_t t = m_s[1] << 17;
    m_s[2] ^= m_s[0];
    m_s[3] ^= m_s[1];
    m_s[1] ^= m_s[2];
    m_s[0] ^= m_s[3];
    m_s[2] ^= t;
    m_s[3] = rotl(m_s[3], 45);
    return result;
}

float SimRandom::uniform() { return static_cast<float>(next() >> 40) * (1.0f / 16777216.0f); }
float SimRandom::uniform(float lo, float hi) { return lo + (hi - lo) * uniform(); }

MCVector2dF SimRandom::vector2d()
{
    const float x = uniform() - 0.5f;   // evaluation order fixed: x first, then y
    const float y = uniform() - 0.5f;
    return MCVector2dF(x, y).normalized();
}

SimRandom::State SimRandom::state() const { return m_s; }
void SimRandom::setState(const State & s) { m_s = s; }
```
In the header: `#include <MCVector2d>`, `#include <array>`, `#include <cstdint>`, and the private member `State m_s {};`.

- [ ] **Step 3: Run**

Run: `cmake --build ~/dust-build/p1 && (cd ~/dust-build/p1 && QT_QPA_PLATFORM=offscreen ctest -R tst_units --output-on-failure)`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add DustRacing2D/src/game && git commit -m "feat(phase1): SimRandom (xoshiro256** + SplitMix64, portable floats)"
```

---

### Task 13: RNG split, `--seed`, cosmetic seed

**Files:**
- Modify: `ai.hpp/.cpp`, `race.hpp/.cpp`, `racesetup.hpp/.cpp`, `game.hpp/.cpp`, `scene.cpp`, `simtests/stubs/stub_game.cpp`, `simtests/harness/{simharness.cpp,statehash.hpp,statehash.cpp}`, `simtests/characterization/tst_scenarios.cpp`

**Interfaces:**
- Consumes: `SimRandom` (Task 12).
- Produces:
  - `AI::AI(Car & car, std::shared_ptr<Race> race, SimRandom & random)`;
  - `void Race::setSimRandom(SimRandom * random)`;
  - `RaceSetup::Params::simSeed` (`uint64_t`, default 0), `RaceSetup::Session::simRandom` (`std::unique_ptr<SimRandom>`);
  - `uint64_t Game::simSeed() const`;
  - `uint64_t stateHash(const std::vector<CarS> & cars, const Race & race, const SimRandom & random)`.

- [ ] **Step 1: Write the failing test** (append to `tst_scenarios.cpp`). It pins F4: two stuck cars get different offsets.

```cpp
    void twoStuckCarsGetDifferentRecoveryOffsets()
    {
        HarnessConfig c; c.track = "Monza"; c.cars = 3; c.laps = 2;
        SimHarness h(c);
        h.start();
        auto & c1 = h.car(1);
        auto & c2 = h.car(2);
        const auto p1 = c1.location();
        const auto p2 = c2.location();
        std::map<int, MCVector3dF> landed;
        for (int i = 0; i < 600 && landed.size() < 2; i++)
        {
            if (!landed.count(1)) park(c1, p1, c1.angle());
            if (!landed.count(2)) park(c2, p2, c2.angle());
            h.stepOnce();
            for (auto && e : h.events())
                if (e.type == "recovered" && !landed.count(e.car)) landed[e.car] = h.car(size_t(e.car)).location();
        }
        QCOMPARE(landed.size(), size_t(2));
        QVERIFY((landed[1] - landed[2]).lengthFast() > 0.001f); // upstream bug: identical offsets
    }
```
Both cars start on the grid behind checkpoint 0, so their previous checkpoint is the same node.

Run: `ctest -R tst_scenarios` → expected FAIL on the last `QVERIFY` (upstream gives both cars the same offset).

- [ ] **Step 2: Implement.**
  - `AI`: store `SimRandom & m_random`. `setRandomTolerance()` becomes `m_randomTolerance = m_random.vector2d() * TrackTileBase::width() / 8;`. Remove `#include <MCRandom>`.
  - `Race`: add `SimRandom * m_simRandom = nullptr;` and `setSimRandom`. In `moveCarOntoPreviousCheckPoint`, replace the `std::mt19937`/distribution lines with:
    ```cpp
    assert(m_simRandom);
    const float r = static_cast<float>(randRadius);
    const float x = static_cast<float>(targetNode->location().x()) + m_simRandom->uniform(-r, r);
    const float y = static_cast<float>(targetNode->location().y()) + m_simRandom->uniform(-r, r);
    ```
    Remove `#include <random>` if it is now unused.
  - `RaceSetup::build`:
    - first line after `world.clear()`: `session.simRandom = std::make_unique<SimRandom>(params.simSeed); race->setSimRandom(session.simRandom.get());`;
    - construct AIs with `*session.simRandom`.
  - `Game`: add `uint64_t m_simSeed = 0;` and `simSeed()`, and a parse option:
    ```cpp
    ae.addOption({ "--seed" }, [=](std::string value) { m_simSeed = std::stoull(value); }, false, "Simulation seed (default 0).");
    ```
    Add `m_simSeed` to the stub's initializer list in member order.
  - `Scene::setActiveTrack`: `params.simSeed = m_game.simSeed();`.
  - Cosmetic seed: `Scene` constructor calls `MCRandom::setSeed(0)`. `SimHarness` constructor calls `MCRandom::setSeed(config.cosmeticSeed)` before `RaceSetup::build`. `HarnessConfig::simSeed` goes to `Params::simSeed`.
  - `MCRandom::setSeed` only takes effect before the first `getValue()`. Change `MCRandom::setSeed` to also clear `m_isBuilt` and `m_valPtr`, so the LUT is rebuilt from the new seed. This is cosmetic-only behaviour, and upstream never calls `setSeed`.
  - `stateHash` gains the `SimRandom` argument and mixes the four state words after the cars. Update the harness call.

- [ ] **Step 3: Run**

Run: `cmake --build ~/dust-build/p1 && (cd ~/dust-build/p1 && QT_QPA_PLATFORM=offscreen ctest --output-on-failure -LE parity)`
Expected: all pass, including `twoStuckCarsGetDifferentRecoveryOffsets`.

- [ ] **Step 4: Verify no sim file still uses a non-portable RNG**

```bash
grep -nE 'MCRandom|std::mt19937|uniform_real_distribution|uniform_int_distribution|[^a-z_]rand\(' DustRacing2D/src/game/{ai,race,car,tire,gearbox,carphysicscomponent,timing,offtrackdetector,pit,racesetup}.cpp
```
Expected: only `race.cpp:…rand() % 2` (the off-track message picker, spec §5.1).

- [ ] **Step 5: Commit**

```bash
git add DustRacing2D/src/game && git commit -m "feat(phase1): sim RNG split from cosmetic MCRandom; fix shared stuck offset; --seed"
```

---

### Task 14: Stable IDs

**Files:**
- Modify: `MiniCore/src/Core/mcobject.hh/.cc`, `MiniCore/src/Core/mcworld.hh/.cc`, `MiniCore/src/UnitTests/MCWorldTest/MCWorldTest.{hpp,cpp}`

**Interfaces:**
- Produces:
  ```cpp
  uint32_t MCObject::stableId() const;                 // 0 = none in the current world generation
  // private, MCWorld is already a friend of MCObject's impl access path; add `friend class MCWorld;` if not
  void MCObject::setStableId(uint32_t id, uint32_t generation);
  uint32_t MCObject::stableIdGeneration() const;
  uint32_t MCWorld::generation() const;
  static bool MCWorld::needsStableId(const MCObject & object); // !isParticle() && (isPhysicsObject() || isTriggerObject()) && !bypassCollisions()
  ```

- [ ] **Step 1: Write the failing tests** in `MCWorldTest`. Add slots to the `.hpp` and implement in the `.cpp`, following the file's existing style. Objects need a shape, because `addToWorld` inserts them into the object grid. Add a file-local helper, which Tasks 15 and 17 reuse:

```cpp
namespace {
std::unique_ptr<MCObject> makeObject(const char * type, bool physics = true)
{
    auto o = std::make_unique<MCObject>(std::make_shared<MCRectShape>(nullptr, 10, 10), type);
    o->setIsPhysicsObject(physics);
    return o;
}
} // namespace

void MCWorldTest::testStableIdsAssignedInAddOrder()
{
    MCWorld world;
    world.setDimensions(0, 1000, 0, 1000, 0, 100, 1.0f);
    auto a = makeObject("a"), b = makeObject("b"), c = makeObject("c");
    a->addToWorld(100, 100); b->addToWorld(300, 100); c->addToWorld(500, 100);
    QCOMPARE(a->stableId(), 1u);
    QCOMPARE(b->stableId(), 2u);
    QCOMPARE(c->stableId(), 3u);
}

void MCWorldTest::triggerObjectsGetIds()
{
    MCWorld world;
    world.setDimensions(0, 1000, 0, 1000, 0, 100, 1.0f);
    auto trigger = makeObject("trigger", false);
    trigger->setIsTriggerObject(true);
    trigger->addToWorld(100, 100);
    QVERIFY(trigger->stableId() != 0u);
}

void MCWorldTest::testNonCollidingObjectsGetNoId()
{
    MCWorld world;
    world.setDimensions(0, 1000, 0, 1000, 0, 100, 1.0f);
    auto visual = makeObject("visual", false);
    auto bypass = makeObject("bypass");
    bypass->setBypassCollisions(true);
    visual->addToWorld(100, 100); bypass->addToWorld(300, 100);
    QCOMPARE(visual->stableId(), 0u);
    QCOMPARE(bypass->stableId(), 0u);
}

void MCWorldTest::testIdsResetOnClearAndKeptOnReAdd()
{
    MCWorld world;
    world.setDimensions(0, 1000, 0, 1000, 0, 100, 1.0f);
    auto a = makeObject("a"), b = makeObject("b");
    a->addToWorld(100, 100); b->addToWorld(300, 100);
    world.removeObjectNow(*a);
    a->addToWorld(100, 100);
    QCOMPARE(a->stableId(), 1u);              // kept within the generation
    world.clear();
    QCOMPARE(a->stableId(), 0u);              // stale generation reads as none
    b->addToWorld(300, 100); a->addToWorld(100, 100);
    QCOMPARE(b->stableId(), 1u);
    QCOMPARE(a->stableId(), 2u);
}
```
If `MCRectShape`'s constructor or `setDimensions`' signature differs from the above, copy the form `MCWorldTest.cpp` already uses.

Run: `cmake --build ~/dust-build/p1` → compile failure (`stableId` missing).

- [ ] **Step 2: Implement.**
  - `MCObject::Impl`: add `uint32_t m_stableId = 0; uint32_t m_stableIdGeneration = 0;`.
  - `stableId()` returns `m_stableId` if `m_stableIdGeneration == MCWorld::instance().generation()` (when `MCWorld::hasInstance()`), else 0.
  - `MCWorld`: add `uint32_t m_nextStableId = 1; uint32_t m_generation = 1;`.
    - `clear()` sets `m_nextStableId = 1; ++m_generation;`.
    - In `addObject`, inside `if (object.index() == REMOVED_INDEX)` and before `m_objects.push_back`:
      ```cpp
      if (needsStableId(object) && object.stableId() == 0)
      {
          object.setStableId(m_nextStableId++, m_generation);
      }
      ```
    - Children are added through the same `addObject`, so they follow the same rule.
  - Debug assert: keep a `std::unordered_set<uint32_t>` of IDs issued in this generation under `#ifndef NDEBUG` and `assert` that each new ID was not already present.

- [ ] **Step 3: Run**

Run: `cmake --build ~/dust-build/p1 && (cd ~/dust-build/p1 && QT_QPA_PLATFORM=offscreen ctest --output-on-failure -LE parity)`
Expected: all pass. Nothing reads the IDs yet, so the sim is unchanged.

- [ ] **Step 4: Commit**

```bash
git add DustRacing2D/src/game/MiniCore && git commit -m "feat(phase1): per-world stable object IDs for colliding and trigger objects"
```

---

### Task 15: Deterministic collision order and determinism suite

**Files:**
- Create: `MiniCore/src/Core/mcobjectkey.hh`, `simtests/determinism/tst_determinism.cpp`
- Modify: `MiniCore/src/Physics/mccollisiondetector.{hh,cc}`, `MiniCore/src/Physics/mcobjectgrid.cc`, `MiniCore/src/Core/mcobject.{hh,cc}` (`ContactHash`), `MiniCore/src/Core/mcworld.{hh,cc}` (`m_collidables`), `MiniCore/src/Physics/mcimpulsegenerator.{hh,cc}`, `MiniCore/src/UnitTests/MCWorldTest/*`, `simtests/CMakeLists.txt`

**Interfaces:**
- Consumes: `MCObject::stableId()` (Task 14).
- Produces:
  ```cpp
  // mcobjectkey.hh
  struct MCObjectKey {
      uint32_t id;
      MCObject * ptr;
      static MCObjectKey of(MCObject & o) { return { o.stableId(), &o }; }
      bool operator<(const MCObjectKey & o) const { return id != o.id ? id < o.id : std::less<MCObject *>()(ptr, o.ptr); }
      bool operator==(const MCObjectKey & o) const { return ptr == o.ptr; }
  };
  // mcobject.hh
  typedef std::map<MCObjectKey, std::vector<MCContact *>> ContactHash;
  // mcworld.hh
  const ObjectVector & MCWorld::collidables() const;   // sorted by stableId
  // mcimpulsegenerator.hh — unchanged signatures; MCWorld passes collidables() instead of m_objects
  ```

- [ ] **Step 1: Write the determinism tests** (`tst_determinism.cpp`). They must fail before this task's implementation.

```cpp
#include "simharness.hpp"
#include <QtTest>

namespace {
struct Trace { std::vector<uint64_t> hashes; std::vector<QString> events; };
Trace run(HarnessConfig c)
{
    SimHarness h(c);
    h.runToFinish();
    Trace t { h.hashes(), {} };
    for (auto && e : h.events())
        t.events.push_back(QString("%1 %2 %3 %4 %5").arg(e.tick).arg(e.type).arg(e.car).arg(e.a).arg(e.b));
    return t;
}
HarnessConfig base()
{
    HarnessConfig c; c.track = "Monza"; c.cars = 12; c.laps = 1; c.simSeed = 42;
    return c;
}
void compare(const Trace & a, const Trace & b)
{
    QCOMPARE(a.hashes.size(), b.hashes.size());
    for (size_t i = 0; i < a.hashes.size(); i++)
        QVERIFY2(a.hashes[i] == b.hashes[i], qPrintable(QString("first divergence at tick %1").arg((i + 1) * 60)));
    QCOMPARE(a.events, b.events);
}
} // namespace

class TstDeterminism : public QObject
{
    Q_OBJECT
private slots:
    void repeatInProcess() { compare(run(base()), run(base())); }
    void cosmeticSeedInvariance()
    {
        auto c1 = base(); c1.cosmeticSeed = 0;
        auto c2 = base(); c2.cosmeticSeed = 1;
        auto c3 = base(); c3.particles = false;
        const auto t1 = run(c1);
        compare(t1, run(c2));
        compare(t1, run(c3));
    }
    void allocationOrderInvariance()
    {
        const auto t1 = run(base());
        std::vector<std::unique_ptr<char[]>> ballast;
        for (int i = 0; i < 4096; i++) ballast.emplace_back(new char[16 + (i * 37) % 512]);
        for (int i = 0; i < 4096; i += 3) ballast[size_t(i)].reset();   // holes: new objects land elsewhere
        compare(t1, run(base()));
    }
};
QTEST_GUILESS_MAIN(TstDeterminism)
#include "tst_determinism.moc"
```
Add `dust_simtest(tst_determinism determinism/tst_determinism.cpp)`.

Run: `ctest -R tst_determinism`. Expected: FAIL in at least `repeatInProcess` or `allocationOrderInvariance`, with a "first divergence at tick …" message. Record which test failed and at which tick in the task report. This is the S1 finding reproduced.

- [ ] **Step 2: Write the MiniCore safety test** (`MCWorldTest`)

```cpp
void MCWorldTest::removeDuringCollisionIsSafe()
{
    MCWorld world;
    world.setDimensions(0, 1000, 0, 1000, 0, 100, 1.0f);
    auto a = makeObject("a");
    auto b = makeObject("b");
    a->addToWorld(100, 100); b->addToWorld(105, 100);    // overlapping
    world.stepTime(16);                                    // pair enters m_currentCollisions
    b.reset();                                             // ~MCObject → MCCollisionDetector::remove
    world.stepTime(16);                                    // must not touch the destroyed object
    QVERIFY(a->stableId() != 0u);
}
```
`makeObject` is the helper from Task 14.

- [ ] **Step 3: Implement the ordering sites (spec §5.3).**
  - `mccollisiondetector.hh`: `using CollisionMap = std::map<MCObjectKey, std::set<MCObjectKey>>;`.
    - Every `m_currentCollisions[&x]` becomes `m_currentCollisions[MCObjectKey::of(x)]`.
    - `.insert(&y)` becomes `.insert(MCObjectKey::of(y))`.
    - `areCurrentlyColliding` uses `find(MCObjectKey::of(o1))` and `count(MCObjectKey::of(o2))`.
    - `remove(object)` builds `MCObjectKey::of(object)` once and erases the reverse links by key.
    - `iterateCurrentCollisions` still iterates the live map, now in key order, dereferencing `outer.first.ptr` and `inner.ptr` exactly where upstream dereferenced the raw pointers. `removedCollisions` holds `std::pair<MCObjectKey, MCObjectKey>`.
    - Add `assert(o.stableId() != 0)` in `MCObjectKey::of` callers inside the detector (debug only).
  - `mcobjectgrid.cc` `getPossibleCollisions()`: when pushing a pair, orient it lower ID first:
    ```cpp
    if (obj2->stableId() < obj1->stableId()) collisions.push_back({ obj2, obj1 }); else collisions.push_back({ obj1, obj2 });
    ```
    Before `return collisions;`:
    ```cpp
    std::sort(collisions.begin(), collisions.end(), [](auto && l, auto && r) {
        return l.first->stableId() != r.first->stableId() ? l.first->stableId() < r.first->stableId()
                                                          : l.second->stableId() < r.second->stableId();
    });
    collisions.erase(std::unique(collisions.begin(), collisions.end()), collisions.end());
    ```
    Upstream can list one pair from two cells; `processPossibleCollision` is idempotent per pair, so dropping duplicates only removes redundant work. If the parity gate (Task 18) disagrees, remove the `unique` line first.
  - `mcobject.cc`: `addContact` uses `m_contacts[MCObjectKey::of(contact.object())]`, and `deleteContacts(object)` uses `find(MCObjectKey::of(object))`. `MCImpulseGenerator` iterating `object->contacts()` now walks in ID order.
  - `MCWorld`: add `ObjectVector m_collidables;`.
    - In `addObject`, when the object has a stable ID, insert it into `m_collidables` with `std::lower_bound` by `stableId()`.
    - In `doRemoveObject` and `removeObjectNow`, erase it if present.
    - `clear()` empties it.
    - `generateImpulses()` and `resolvePositions()` pass `m_collidables` instead of `m_objects`. Change `MCImpulseGenerator`'s parameter to `const std::vector<MCObject *> &` if it isn't already.

- [ ] **Step 4: Run everything**

Run: `cmake --build ~/dust-build/p1 && (cd ~/dust-build/p1 && QT_QPA_PLATFORM=offscreen ctest --output-on-failure -LE parity)`
Expected: all pass, including `tst_determinism` (3/3) and the MiniCore suites. A remaining divergence is a missed ordering site: bisect by tick with the hash stream, and compare `world.collisionEventCount()` at the divergent tick between runs.

- [ ] **Step 5: Push, and wait for CI on both OSes.** Ask the user to push, or push yourself if the user has authorised pushing to `origin` for this work. The determinism suite must be green on Ubuntu and macOS before Task 16.

- [ ] **Step 6: Commit**

```bash
git add DustRacing2D/src/game && git commit -m "feat(phase1): stable-ID collision and contact order, ID-ordered impulse passes, determinism suite"
```

---

### Task 16: Golden races

**Files:**
- Create: `simtests/harness/goldencases.hpp`, `simtests/golden/tst_golden.cpp`, `simtests/golden/fixtures/macos-arm64/*.json`, `simtests/golden/fixtures/linux-x86_64/*.json`
- Modify: `simtests/tools/simtool.cpp` (`record`), `simtests/CMakeLists.txt`

**Interfaces:**
- Produces:
  ```cpp
  struct GoldenCase { const char * name; const char * track; size_t cars; size_t humans; size_t laps; uint64_t seed; const char * inputScript; uint64_t maxTicks; };
  inline constexpr GoldenCase GOLDEN_CASES[] = {
      { "monza-12-s42",   "Monza",   12, 0, 3, 42, "",                40000 },
      { "suzuka-12-s42",  "Suzuka",  12, 0, 3, 42, "",                40000 },
      { "twister-12-s42", "Twister", 12, 0, 3, 42, "",                40000 },
      { "monza-1-s42",    "Monza",    1, 0, 3, 42, "",                40000 },
      { "monza-input-s7", "Monza",   12, 1, 2,  7, "monza-lap.input",  6000 },
  };
  QJsonObject goldenToJson(const GoldenCase & c, const SimHarness & h);
  QString goldenFixturePath(const QString & platform, const QString & caseName); // SIMTESTS_DIR/golden/fixtures/<platform>/<case>.json
  // simtool record <case|all> [--out DIR]   (default DIR = SIMTESTS_DIR/golden/fixtures/<platform>)
  ```
  The scripted car 0 is human, and the stuck recovery only covers AI cars, so `monza-input-s7` may never finish. It runs to `maxTicks = 6000` and compares hashes and events up to there.

- [ ] **Step 1: Write `tst_golden.cpp`**

```cpp
class TstGolden : public QObject
{
    Q_OBJECT
private slots:
    void golden_data()
    {
        QTest::addColumn<int>("index");
        for (int i = 0; i < int(std::size(GOLDEN_CASES)); i++) QTest::newRow(GOLDEN_CASES[i].name) << i;
    }
    void golden()
    {
        QFETCH(int, index);
        const auto & gc = GOLDEN_CASES[index];
        if (platformName() == "unknown") QSKIP("no fixtures for this platform");
        QFile f(goldenFixturePath(platformName(), gc.name));
        QVERIFY2(f.open(QIODevice::ReadOnly), qPrintable("missing fixture " + f.fileName() + " — run: simtool record " + gc.name));
        const auto expected = QJsonDocument::fromJson(f.readAll()).object();

        SimHarness h(configFor(gc));
        h.runToFinish();
        const auto actual = goldenToJson(gc, h);

        const auto eh = expected["hashes"].toArray(), ah = actual["hashes"].toArray();
        for (int i = 0; i < std::min(eh.size(), ah.size()); i++)
        {
            if (eh[i] != ah[i])
            {
                QFAIL(qPrintable(QString("%1: first divergent hash #%2 (tick %3): expected %4 got %5\n%6")
                  .arg(gc.name).arg(i).arg((i + 1) * 60).arg(eh[i].toString(), ah[i].toString(), carDiffAt(gc, (i + 1) * 60))));
            }
        }
        QCOMPARE(ah.size(), eh.size());
        QCOMPARE(actual["events"].toArray(), expected["events"].toArray());
    }
};
```
- `carDiffAt(gc, tick)` re-runs the case to `tick` and prints each car's `x y angle vx vy` with `%a` (hex float) formatting, so the developer can diff against a second platform or a previous build.
- `configFor(gc)` maps the case onto `HarnessConfig`.
- `goldenToJson` writes:
  - `case`, `schema: 1`, `tickMs: 16`, `hashEvery: 60`;
  - `compiler` (`__VERSION__`), `flags: "-ffp-contract=off"`;
  - `hashes` as 16-digit lower-case hex strings;
  - `events` as `{tick,type,car,a,b}` objects.

- [ ] **Step 2: Run it to see the missing-fixture failure**

Run: `cmake --build ~/dust-build/p1 && (cd ~/dust-build/p1 && QT_QPA_PLATFORM=offscreen ctest -R tst_golden --output-on-failure)`
Expected: FAIL `missing fixture …/macos-arm64/monza-12-s42.json — run: simtool record monza-12-s42`.

- [ ] **Step 3: Record macOS fixtures, re-run twice**

```bash
~/dust-build/p1/simtests/simtool record all
(cd ~/dust-build/p1 && QT_QPA_PLATFORM=offscreen ctest -R tst_golden --output-on-failure --repeat until-fail:2)
```
Expected: 5 fixtures written, and the test passes twice.

- [ ] **Step 4: Record Linux fixtures through CI.** Ask the user to push, or push if authorised. Then run the `sim` workflow with `record=true`:
  ```bash
  gh workflow run sim.yml -f record=true
  gh run download <run-id> -n golden-ubuntu-24.04 -D DustRacing2D/src/game/simtests/golden/fixtures/linux-x86_64
  ```
  The user may prefer to trigger the run themselves; ask first, because it is an outward action on their repository. Check that each downloaded file's `case` field matches its name.

- [ ] **Step 5: Commit, then confirm CI is green on both OSes**

```bash
git add DustRacing2D/src/game/simtests && git status --short DustRacing2D/src/game/simtests/golden
git commit -m "test(phase1): golden race fixtures for macos-arm64 and linux-x86_64"
```
Expected: 10 fixture files staged. After the push, both CI jobs pass `tst_golden`.

---

### Task 17: Render interpolation (desktop) and the camera per frame

**Files:**
- Modify: `MiniCore/src/Core/mcobject.{hh,cc}`, `MiniCore/src/Core/mcworld.{hh,cc}`, `MiniCore/src/Physics/mcshape.cc`, `MiniCore/src/Graphics/mcsurfaceobjectrenderer.cc`, `MiniCore/src/Graphics/mcsurfaceobjectrendererlegacy.cc`, `racesetup.cpp`, `scene.{hpp,cpp}`, `game.cpp`, `simtests/harness/simharness.cpp`, `simtests/determinism/tst_determinism.cpp`, `MCWorldTest`

**Interfaces:**
- Produces:
  ```cpp
  // MCObject
  void setInterpolated(bool flag);
  bool interpolated() const;
  void capturePreviousPose();                  // stores location() and angle()
  MCVector3dF renderLocation() const;          // lerp(prev, location(), MCWorld::renderAlpha()) if interpolated, else location()
  float renderAngle() const;                   // shortest-arc lerp in degrees, else angle()
  // MCWorld
  static void setRenderAlpha(float alpha);
  static float renderAlpha();
  // Scene
  void updateCameras();                        // per frame, after the tick loop
  ```

- [ ] **Step 1: Write the failing tests.** In `MCWorldTest`:

```cpp
void MCWorldTest::interpolatedPoseLerps()
{
    MCWorld world;
    world.setDimensions(0, 1000, 0, 1000, 0, 100, 1.0f);
    auto o = makeObject("o");
    o->setInterpolated(true);
    o->addToWorld(100, 100);
    o->capturePreviousPose();
    o->translate(MCVector3dF(110, 100, 0));
    o->rotate(350);                       // from 0 to 350: shortest arc is −10°
    MCWorld::setRenderAlpha(0.5f);
    QCOMPARE(o->renderLocation().i(), 105.0f);
    QCOMPARE(o->renderAngle(), 355.0f);
    o->setInterpolated(false);
    QCOMPARE(o->renderLocation().i(), 110.0f);
}

void MCWorldTest::teleportSnaps()
{
    MCWorld world;
    world.setDimensions(0, 10000, 0, 1000, 0, 100, 1.0f);
    auto o = makeObject("o");
    o->setInterpolated(true);
    o->addToWorld(100, 100);
    o->capturePreviousPose();
    o->translate(MCVector3dF(5000, 100, 0));  // stuck recovery jump
    MCWorld::setRenderAlpha(0.5f);
    QCOMPARE(o->renderLocation().i(), 5000.0f);
}
```
In `tst_determinism.cpp`:
```cpp
    void interpolationFlagsDoNotChangeSim()
    {
        auto on = base(); on.interpolationFlags = true;
        compare(run(base()), run(on));
    }
```
Run → compile failure.

- [ ] **Step 2: Implement.**
  - `MCObject::Impl` members: `bool m_interpolated = false; MCVector3dF m_prevLocation; float m_prevAngle = 0;`.
  - Snap rule: if `(cur - prev).lengthFast() > 256` world units (two tile widths), render `cur`.
  - Angle lerp in degrees:
    ```cpp
    float d = std::fmod(cur - prev + 540.0f, 360.0f) - 180.0f;
    float a = prev + d * alpha;
    if (a < 0) a += 360.0f; else if (a >= 360.0f) a -= 360.0f;
    ```
  - `MCWorld`: `static float m_renderAlpha` (default 1.0f), with a setter and getter.
  - In `MCWorld::stepTime(int)`, first line: for each object in `m_objects` with `interpolated()`, call `capturePreviousPose()`.
  - Renderers:
    - `MCShape::render` / `renderShadow`: if `m_parent && m_parent->interpolated()`, pass `m_parent->renderLocation()` (plus the shadow offset in `renderShadow`) and `m_parent->renderAngle()` to the view, instead of `m_location` / `m_angle`.
    - In `mcsurfaceobjectrenderer.cc` and the legacy renderer, replace `object->shape()->location()` with `object->interpolated() ? object->renderLocation() : object->shape()->location()`, and `object->angle()` with `object->interpolated() ? object->renderAngle() : object->angle()`.
    - These edits sit in code that `MC_HEADLESS` compiles out or never runs headless.
  - `RaceSetup::build`: after building each car, `car->setInterpolated(true); for (auto && child : car->children()) child->setInterpolated(true);`. This always runs; it is render-only state.
  - `SimHarness`: if `!config.interpolationFlags`, after `build`, clear the flags on all cars and their children. That makes the default harness run "flags off".
  - `Scene`:
    - Move the camera block from `updateFrame` into `void Scene::updateCameras()`.
    - Use `object.renderLocation()` in place of `object.location()` inside `updateCameraLocation`.
    - Keep the speed-offset smoothing per frame, which equals upstream's per-update cadence at 60 Hz.
  - `game.cpp`: after the step loop, `MCWorld::setRenderAlpha(m_stepper.alpha()); m_scene->updateCameras();` before `updateOverlays()`. Inside `updateCameras`, return early unless the state is one where `updateFrame` used to move cameras (`GameTransitionIn`, `GameTransitionOut`, `DoStartlights`, `Play`) and a track is active.

- [ ] **Step 3: Run tests and the desktop smoke test**

Run: `cmake --build ~/dust-build/p1 && (cd ~/dust-build/p1 && QT_QPA_PLATFORM=offscreen ctest --output-on-failure -LE parity)`
Expected: all pass, including `tst_golden`; interpolation must not change any fixture. Then repeat Task 4 Step 6's smoke test.

- [ ] **Step 4: Commit**

```bash
git add DustRacing2D/src/game && git commit -m "feat(phase1): render interpolation for cars and children, per-frame camera"
```

---

### Task 18: Parity gate, user drive, verification record

**Files:**
- Create: `docs/phase1/verification.md`

- [ ] **Step 1: Run the parity gate** (in the background, about 7 min)

Run: `~/dust-build/p1/simtests/simtool parity check | tee /tmp/claude-parity.txt`
Expected: every line `PASS`, exit 0.

- [ ] **Step 2: If any metric fails**:
  - **Only `recoveries` fails, and the candidate is lower or higher because of the F4 fix:** re-run with the F4 fix temporarily reverted in a scratch build to confirm the cause. Record a documented exception in `verification.md` (spec §6.4, risk 5).
  - **`collisionEvents` fails:** first remove the `std::unique` pair dedup from Task 15 and re-run.
  - **Still failing:** switch `iterateCurrentCollisions` to the S1 row 41 snapshot iteration over the key-ordered map (spec §5.3 fallback), re-run, and record which variant passed.
  - **Any other failure:** stop, and report the numbers to the user.

- [ ] **Step 3: Ask the user for the drive test.** Send: "Please build with `cmake --build ~/dust-build/p1`, run `cd ~/dust-build/p1 && ./dustrac-game --seed 0`, and race once on Monza and once on Suzuka. Check:
  - handling and braking feel unchanged;
  - bounces off AI cars and walls look as before;
  - the AI drives as before;
  - no judder;
  - no burst after pausing (Esc / P) or returning from the menu.

  Reply with pass or what felt off." Wait for the reply.

- [ ] **Step 4: Write `docs/phase1/verification.md`** with:
  - the full `/tmp/claude-parity.txt` table;
  - which collision-iteration variant shipped;
  - any documented exception;
  - the user's drive verdict, quoted with the date;
  - the commit hash tested.

- [ ] **Step 5: Commit**

```bash
git add docs/phase1/verification.md && git commit -m "docs(phase1): parity gate results and drive sign-off"
```

---

### Task 19: Track and asset validation

**Files:**
- Create: `simtests/validation/tst_validation.cpp`
- Modify: `simtests/CMakeLists.txt`

- [ ] **Step 1: Write the tests**

```cpp
class TstValidation : public QObject
{
    Q_OBJECT
private slots:
    void configsParse_data()
    {
        QTest::addColumn<QString>("file");
        for (auto f : { "surfaces.conf", "meshes.conf", "editorModels.conf" }) QTest::newRow(f) << QString(f);
        for (auto && fi : QDir(DATA_PATH "/levels").entryInfoList({ "*.trk" })) QTest::newRow(qPrintable(fi.fileName())) << "levels/" + fi.fileName();
    }
    void configsParse()
    {
        QFETCH(QString, file);
        QFile f(QString(DATA_PATH "/") + file);
        QVERIFY(f.open(QIODevice::ReadOnly));
        QDomDocument doc;
        QVERIFY2(bool(doc.setContent(&f)), qPrintable(file));
    }
    void surfaceImagesExist()
    {
        QFile f(DATA_PATH "/surfaces.conf");
        QVERIFY(f.open(QIODevice::ReadOnly));
        QDomDocument doc;
        QVERIFY(bool(doc.setContent(&f)));
        const auto list = doc.elementsByTagName("surface");
        QVERIFY(list.size() > 0);
        for (int i = 0; i < list.size(); i++)
        {
            const auto e = list.at(i).toElement();
            const auto image = e.attribute("image");
            QVERIFY2(!image.isEmpty(), qPrintable(e.attribute("handle")));
            QVERIFY2(QFileInfo::exists(QString(DATA_PATH "/images/") + image), qPrintable(image));
        }
    }
    void everyTrackIsSound()
    {
        const auto tracks = SimEnvironment::get().allTracks();
        QCOMPARE(int(tracks.size()), 16);
        for (auto && t : tracks)
        {
            const auto name = t->trackData().name();
            const auto & route = t->trackData().route();
            QVERIFY2(route.numNodes() >= 3, qPrintable(name));
            QVERIFY2(route.isClosed(), qPrintable(name));
            auto && map = t->trackData().map();
            for (size_t j = 0; j < map.rows(); j++)
                for (size_t i = 0; i < map.cols(); i++)
                {
                    const auto tile = std::dynamic_pointer_cast<TrackTile>(map.getTile(i, j));
                    QVERIFY2(tile && tile->tileTypeEnum() != TrackTile::TileType::None, qPrintable(QString("%1 tile %2,%3").arg(name).arg(i).arg(j)));
                    QVERIFY2(int(tile->computerHint()) <= int(TrackTileBase::ComputerHint::Brake), qPrintable(name));
                }
            for (size_t k = 0; k < t->trackData().objects().count(); k++)
                QVERIFY2(std::dynamic_pointer_cast<TrackObject>(t->trackData().objects().object(k)), qPrintable(name + ": unknown object role"));

            HarnessConfig c; c.track = name; c.cars = 12;
            SimHarness h(c);     // loads through RaceSetup
            for (size_t i = 0; i < 12; i++)
            {
                const auto loc = h.car(i).location();
                const auto tile = t->trackTileAtLocation(loc.i(), loc.j());
                QVERIFY2(tile && tile->hasAsphalt(), qPrintable(QString("%1: grid slot %2 off asphalt").arg(name).arg(i)));
            }
        }
    }
};
```
- Before writing `surfaceImagesExist`, check the real element and attribute names in `data/surfaces.conf` (`head -20 DustRacing2D/data/surfaces.conf`) and in `MCSurfaceConfigLoader`, and use those. The image directory comes from the loader too.
- An object of an unknown role is dropped by `TrackLoader::readObject`, not stored. If that is the case, replace the object check with a check against the `.trk` XML: every `o` element's `r` attribute is in the set `TrackObjectFactory` handles (read the `if (role == …)` chain).
- If a grid slot is legitimately on a non-asphalt tile in a shipped track, the test reports it. Stop and report to the user rather than weakening the check.
- Add `dust_simtest(tst_validation validation/tst_validation.cpp)`, and link `Qt6::Xml` (already via `minicore_headless`).

- [ ] **Step 2: Run them**

Run: `cmake --build ~/dust-build/p1 && (cd ~/dust-build/p1 && QT_QPA_PLATFORM=offscreen ctest --output-on-failure -R tst_validation)`
Expected: PASS.

- [ ] **Step 3: Prove a broken asset is caught.** Temporarily rename one image referenced by `surfaces.conf`, re-run, and expect a FAIL naming it. Then restore it and confirm `git status` is clean for `DustRacing2D/data`.

- [ ] **Step 4: Commit**

```bash
git add DustRacing2D/src/game/simtests && git commit -m "test(phase1): track and asset validation in CI"
```

---

### Task 20: Sim contracts document, spec sync, final CI

**Files:**
- Create: `docs/phase1/sim-contracts.md`
- Modify: `docs/superpowers/specs/2026-10-15-phase1-sim-stabilization-design.md` (status line → "Implemented; see `docs/phase1/verification.md`"), `docs/superpowers/specs/2026-10-15-dustracing2d-upgrade-scope.md` (status: Phase 1 complete)

- [ ] **Step 1: Write `docs/phase1/sim-contracts.md`** with these sections, each filled from the code as built:
  1. **Timing:** tick 16 ms; tick N = state after N steps; `Race::tick()`; race time `= Timing` ticks × 16 since `Race::start()`.
  2. **State:** per car:
     - `x, y` (world units; 1 unit = 0.05 m);
     - `angle` (degrees CCW from +x, y-up);
     - `vx, vy` (units per tick; m/s = |v| × 3.125);
     - `angularVelocity`, `lap`, `position` (0 before checkpoint 0 internally; contract value = grid slot), `currentTargetNodeIndex`;
     - route progress defined as `(nodeIndex + fraction) / nodeCount` (not yet exported; Phase 2);
     - `tireWearLevel`, `damageLevel`, gear;
     - true speed vs `speedInKmh()` display speed (×2.75 display tuning).
  3. **Events:** `lap {car, lap, lapMs}`, `position {car, pos}`, `pit {car}`, `finish {car, raceTimeMs}`, `recovered {car}` (stuck detection and recovery are one event), `collision` (counter only in Phase 1). Each has a tick.
  4. **Input:** `CarInput {accelerate, brake, left, right}` per tick per human car; the `*.input` file format; analog steering deferred to Phase 2.
  5. **Determinism:**
     - same seed + inputs + build → identical hashes per platform;
     - `-ffp-contract=off`; `SimRandom` state in the hash;
     - stable-ID ordering rule (colliding and trigger objects).
  6. **Telemetry v0 mapping (for Phase 2):** for each of the six decision-6 amendments, the sim source of the value.

- [ ] **Step 2: Sync the spec.** Check every spec section against the code. Record deviations made during implementation (extra §4.4 rows from Task 10, the shipped §5.3 variant from Task 18) in the spec's text, and set the status line.

- [ ] **Step 3: Final full run, locally and in CI**

```bash
(cd ~/dust-build/p1 && QT_QPA_PLATFORM=offscreen ctest --output-on-failure -LE parity)
```
Expected: all suites pass: 5 upstream, `tst_units`, `tst_race`, `tst_scenarios`, `tst_determinism`, `tst_golden`, `tst_validation`. After the push, both CI jobs are green.

- [ ] **Step 4: Commit**

```bash
git add docs && git commit -m "docs(phase1): sim contracts; spec and scope marked Phase 1 complete"
```

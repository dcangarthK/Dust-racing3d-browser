# Desktop build on macOS (Phase 0, Task 3)

Host: macOS 15.6.1 arm64, Apple clang 16, cmake 4.4.4, Ninja 1.13.2, Qt 6.12.0 (see `toolchain-versions.txt`).

- Configure (the command Task 11 must reuse; the Step 1 command from the plan fails to build on this host, see "Fixes needed"):

  ```bash
  P="$(brew --prefix openal-soft)"
  cmake -S DustRacing2D -B ~/dust-build/desktop -G Ninja \
    -DCMAKE_BUILD_TYPE=Debug \
    -DCMAKE_PREFIX_PATH="$(brew --prefix qt)" \
    -DOpenALDir="$P" \
    -DOPENAL_INCLUDE_DIR="$P/include/AL" \
    -DOPENAL_LIBRARY="$P/lib/libopenal.dylib" \
    -DCMAKE_CXX_FLAGS="-I$(brew --prefix libvorbis)/include -I$(brew --prefix libogg)/include" \
    -DCMAKE_EXE_LINKER_FLAGS="-L$(brew --prefix libvorbis)/lib -L$(brew --prefix libogg)/lib"
  ```

  Result: `-- Configuring done` / `-- Generating done`. The plan's original command (only `CMAKE_PREFIX_PATH` and `OpenALDir`) also configures cleanly, so `-DCMAKE_POLICY_VERSION_MINIMUM=3.5` was NOT needed with cmake 4.4.4.
- Build: `cmake --build ~/dust-build/desktop` — succeeded (219 steps in the final run, exit 0). `dustrac-game` (8.3 MB) and `dustrac-editor` (1.8 MB) linked, plus the unit test binaries. The build also copies `DustRacing2D/data` to `~/dust-build/desktop/data`.
- ctest: 5/5 passed (`QT_QPA_PLATFORM=offscreen ctest --output-on-failure`): MCForceRegistryTest, MCObjectTest, MCMeshLoaderTest, MCWorldTest, gearboxtest. Total 5.47 s.
- Run: `cd ~/dust-build/desktop && ./dustrac-game`, launched in the background with stdout/stderr redirected. No data-path problem: `DATA_PATH=./data` resolves because the build copies `data/` next to the binary, so run from the build directory.
  - Process alive after 15 s (and 26 s). Killed afterwards.
  - stdout: Qt 6.12.0, OpenGL 2.1 Metal 89.4, screen 1512x982 (pixel scale 200%, fullscreen on), font loaded, "Sound device: OpenAL Soft", all 16 tracks in `./data/levels` found.
  - stderr (only): `<W> Failed to load translations for en_ZA` and `not in fullscreen state` (Qt/AppKit notice). Both harmless.
  - Side effect: the game creates `~/Library/Application Support/DustRacing2D/Game/status.db` on first launch.
  - Screenshot: `screencapture -x` ran with exit 0 but produced an all-black frame (every pixel 0,0,0), most likely because the game is in a fullscreen Metal space and/or Screen Recording permission is not granted to the terminal. A black image is not evidence, so `docs/phase0/evidence/desktop-baseline.png` is NOT committed.
  - "Start a race, drive one lap, confirm AI cars move" is deferred to the user (no keyboard/GUI driving available to the agent). Menu reached only as far as the logs show (track loading finished, no crash).
- Fixes needed: no DustRacing2D source changes; branch `spike/macos-build` was not created. Three build-environment problems, all solved with configure flags only:

| Where | Error | Fix (configure flag) |
|---|---|---|
| `DustRacing2D/CMakeLists.txt:172-175` (`find_package(OpenAL)`) | CMake's FindOpenAL prefers the system `OpenAL.framework` over `-DOpenALDir`; compile fails with `src/game/audio/openaldevice.hpp:21: fatal error: 'AL/al.h' file not found` (framework headers are `OpenAL/al.h`) | `-DOPENAL_INCLUDE_DIR=$P/include/AL -DOPENAL_LIBRARY=$P/lib/libopenal.dylib` (note the source adds `${OPENAL_INCLUDE_DIR}/..`, so the value must end in `/AL`) |
| `DustRacing2D/CMakeLists.txt:196-197` (`pkg_check_modules(VORBISFILE)`) | `VORBISFILE_INCLUDE_DIRS` is never used: `src/game/audio/openaloggdata.cpp:24: fatal error: 'vorbis/vorbisfile.h' file not found` (libvorbis/libogg are not in the default Homebrew include path on this host) | `-DCMAKE_CXX_FLAGS="-I<libvorbis>/include -I<libogg>/include"` |
| `DustRacing2D/src/game/CMakeLists.txt:164` (`${VORBISFILE_LIBRARIES}`) | `VORBISFILE_LIBRARY_DIRS` is never used: `ld: library 'vorbisfile' not found` when linking `dustrac-game` | `-DCMAKE_EXE_LINKER_FLAGS="-L<libvorbis>/lib -L<libogg>/lib"` |

Other notes: the build emitted 4 compiler warnings in the first (failed) pass; none were errors. Build logs are in `~/dust-build/desktop-build*.log`.

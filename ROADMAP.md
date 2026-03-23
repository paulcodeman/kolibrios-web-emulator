# Roadmap

Goal: Run KolibriOS 32-bit .kex apps in the browser using a JS x86 interpreter and sysfuncs.txt (int 0x40) with a static, no-server UI.

## Milestone 0 - Discovery
- Confirm .kex format details from upstream sources (MENUET01 header, version 1/2, KX extension).
- Document packing (KPCK/kpack) and decide initial support strategy (detect vs unpack).
- Define ABI details: entry point, stack/heap layout, memory map, alignment.
- Build a minimal syscall set from sysfuncs.txt needed for window + text + events.
- Pick 2-3 small test apps and record expected behavior.

## Milestone 1 - Browser Skeleton
- Create a static browser UI (no server) to load a .kex and start/stop execution.
- Implement a loader that parses MENUET01 headers and validates image sizes.
- Implement KPCK unpacking for packed .kex files.
- Provide a GPU-backed rendering surface (WebGL2 preferred, fallback to 2D).

## Milestone 2 - Core Emulator
- Implement an x86 32-bit interpreter core in the browser.
- Keep the core WASM-friendly (TypedArrays for state, numeric-only ops, clear core/IO boundary).
- Split execution/runtime, core-access, host/runtime, and syscall layers out of the shell before any WASM port.
- Keep CPU decode/execute in a single `core-*` source of truth; `emulator.js` should stay a shell/orchestration layer only.
- Keep handwritten host DLLs, guest-library overrides, and shared host-lib runtime helpers in `src/emulator/host-libs/*`; `emulator-host.js` should stay generic loader/bridge code only.
- Map memory regions: code, data, bss, stack, heap, shared buffers.
- Hook int 0x40 and dispatch to JS syscall handlers.
- Add a harness for tracing registers, syscalls, and timing.

## Milestone 3 - UI and Graphics Syscalls
- Implement syscalls: 0 (create window), 1 (put pixel), 4 (draw text).
- Load and apply KolibriOS `.skn` themes for syscall 48 colors, margins, skin height, and window frame rendering.
- Implement time syscalls needed by early demos.
- Run a simple GUI demo end-to-end.

## Milestone 4 - Event Loop
- Implement wait/keyboard/mouse/event syscalls used by test apps.
- Add a minimal message pump to drive redraws and input.
- Verify an interactive app.

## Milestone 5 - Files and IPC
- Implement filesystem stubs or a host FS sandbox for file syscalls.
- Cover file I/O syscalls required by the test set.
- Add named shared-memory support for syscall 68.22/68.23 so CMM apps can use system-style shared resources.
- Add browser-side folder mounting so apps can work against a user-approved host directory from the UI.

## Milestone 6 - Compatibility and Tooling
- Expand syscall coverage by priority and real app needs.
- Add a headless UI harness for click-driven scenarios and structured window snapshots on top of the same emulator runtime.
- Add PNG frame dumps from the headless harness so GUI regressions can be checked visually, not only by surface hash.
- Add browser-style keyboard/scancode regression scenarios, including extended keys and key-release handling.
- Add a host-side session/workspace manager with one emulator instance per app window, shared FS/IPC services, and process syscalls that can grow into a near-real Kolibri desktop session.
- Add a bundled read-only Kolibri root plus a dedicated `launcher.html` desktop page so the browser build can boot straight into `LAUNCHER` out of the box.
- Add regression tests and golden screenshots.
- Add debugging tools (register view, memory dump, syscall trace).

## Milestone 7 - KolibriOS 32-bit Core Completion
- Treat this as a KolibriOS userland target, not full IA-32 completeness.
- Build and maintain a corpus of stock Kolibri apps, launcher services, and SDK-built apps that exercise different runtime/library paths.
- Extend the headless runner to collect unknown opcodes, runtime traps, bad-flag cases, and repeatable crash signatures by app.
- Close the remaining 32-bit integer/core gaps used by real apps: flag accuracy, shift/rotate groups, bit-test family, atomics, cmpxchg/xadd paths, and string/`rep` corner cases.
- Finish the practical x87 subset needed by FASM, libc/newlib-style code, and common math-heavy Kolibri apps.
- Finish the practical MMX/SSE/SSE2 subset used by Kolibri binaries and SDK outputs; keep AVX, x64, and ring0 paths out of scope.
- Turn the corpus into a compatibility gate: app starts, first frame appears, scripted input works, and no unknown opcode/unhandled trap remains in the tested path.
- Keep syscall, FS, UI, timers, network, and host DLL behavior in JS; only the numeric CPU/memory core should be a future WASM port target.

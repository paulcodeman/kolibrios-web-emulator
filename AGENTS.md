# AGENTS

Project: KolibriOS .kex emulator in the browser (canvas/WebGL). System calls are defined in sysfuncs.txt (int 0x40). Static HTML/JS, no server.

Current status
- Static HTML/JS UI exists with .kex loader, KPCK unpacking, GPU-backed canvas, and syscall patching + soft-instruction handling.
- Interpreter-only core active with growing opcode/FPU coverage.
- Headless Node runner exists for opcode discovery without DOM/graphics.
- UI has toggles for syscall/opcode tracing and image hash tracing.
- PLASMA renders and animates (palette updates); BCDCLK uses draw/syscall timing instead of image blits.
- IDE in `ide/` folder: CodeMirror editor, example ASM sources, FASM.KEX + includes.
- URL param `?load=path.kex` loads a .kex on page startup; `?ide` hides toolbars/sidebar for iframe embedding.

Conventions
- Default to ASCII in files unless a specific non-ASCII requirement exists.
- Keep documentation minimal and accurate; update ROADMAP.md when scope changes.
- Prefer small, testable increments; add a trace flag for syscalls early.
- Never add "kostiI"/workaround hacks; always fix root causes.
- After code changes, run a Node.js verification path when possible (use tools/node-runner.js or an equivalent headless check) and report results.
- Keep core WASM-friendly: TypedArrays for core state, numeric-only ops, avoid dynamic properties.
- Avoid JS magic in the core: no dynamic fields, minimize closures, keep functions pure where possible.
- Separate core vs IO: core does CPU/memory/opcodes; IO handles DOM/logging/files.
- Prefer TypeScript strict for core modules when introduced.

Architecture plan (subject to change)
- Browser-first emulator core in plain JavaScript with a WASM-ready interpreter.
- Optional headless mode for Node-based opcode scanning.
- Loader for MENUET01 header (version 1) with optional KX extension (version 2).
- Detect KPCK-packed files and unpack via LZMA in-browser.
- Syscall dispatcher mapping int 0x40 to JS handlers.
- GPU-backed rendering surface (WebGL2 preferred, fallback to 2D).

When implementing
- Prefer plain JavaScript for emulator core and syscall handlers.
- Keep syscall coverage prioritized by test apps and ROADMAP.md.
- Provide a visible log for loader/CPU/syscall events.
- Add trace flags (syscalls, opcodes, images, registers) before deep debugging.
- Add at least one minimal demo app as a regression test.

Commands
- Headless run: `node tools/node-runner.js <file.kex> [max_ms]`
- Autotest (BCDCLK): `node tools/autotest-bcdclk.js [path-to-bcdclk.kex] [max_ms]`
- Browser run: open `index.html` (landing) or `apps.html` (app launcher) directly (file://, no server)

References
- sysfuncs.txt is the primary syscall specification.
- Upstream KolibriOS source in `C:\Users\Paul\Desktop\upstream-kolibrios` for format details.

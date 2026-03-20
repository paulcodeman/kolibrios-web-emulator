# KolibriOS Web Emulator

Browser-first JavaScript emulator for KolibriOS `.kex` applications.

It runs as a static HTML/JS app, requires no server, and includes a headless Node.js runner for opcode and syscall debugging.

## Status

- Static browser UI with `.kex` loader and KPCK unpacking
- Interpreter-only CPU core with growing opcode and FPU coverage
- GPU-backed rendering surface in the browser
- `int 0x40` syscall dispatch and tracing toggles
- Headless Node.js runner for verification and opcode discovery

## Run

Local browser run:

Open `index.html` directly in a browser via `file://`.

Headless run:

```bash
node tools/node-runner.js <file.kex> [max_ms]
```

BCDCLK autotest:

```bash
node tools/autotest-bcdclk.js [path-to-bcdclk.kex] [max_ms]
```

## Live Demo

Try it in the browser:

```text
https://paulcodeman.github.io/kolibrios-web-emulator/
```

The project is a static HTML/JS app, so the same entry point can also be opened locally via `file://`.

## Layout

- `index.html` - browser entry point
- `src/` - emulator core, graphics, UI, and bundled vendor files
- `tools/` - headless harness, capture tools, and autotests
- `sysfuncs.txt` - primary syscall reference

## License

MIT. See [LICENSE](LICENSE).

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

## GitHub Pages

This repository includes a GitHub Actions workflow that publishes the static app to GitHub Pages.

After enabling `Settings -> Pages -> Source -> GitHub Actions`, the emulator will be available at:

```text
https://<user>.github.io/<repo>/
```

The Pages deployment uploads only:

- `index.html`
- `src/`

That keeps the published site aligned with the browser entry point and avoids shipping local debug artifacts.

## Layout

- `index.html` - browser entry point
- `src/` - emulator core, graphics, UI, and bundled vendor files
- `tools/` - headless harness, capture tools, and autotests
- `sysfuncs.txt` - primary syscall reference

## License

MIT. See [LICENSE](LICENSE).

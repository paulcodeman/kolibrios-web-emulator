# KolibriOS Web Emulator

Browser-first JavaScript emulator for KolibriOS `.kex` applications.

Runs as a static HTML/JS app (no server required). Supports both browser and headless Node.js execution.

## Features

- Interpreter-only CPU core with growing opcode and FPU coverage
- GPU-backed rendering (WebGL2 with 2D fallback)
- `int 0x40` syscall dispatch with live tracing toggles
- KPCK-packed .kex unpacking via in-browser LZMA
- Speed control with auto-calibration (measures baseline, cubic ratio mapping)
- FASM IDE with syntax highlighting and compile-and-run
- App marketplace with download/launch management

## Live Demo

```text
https://paulcodeman.github.io/kolibrios-web-emulator/
```

## Pages

| Page | Description |
|---|---|
| `index.html` | Landing page with 4 cards (Desktop / IDE / Apps / Marketplace) |
| `launcher.html` | Full KolibriOS desktop environment (auto-boots bundled OS) |
| `apps.html` | Individual .kex app launcher with side panel and speed control |
| `marketplace.html` | App catalog with download and one-click launch |
| `ide/index.html` | FASM code editor with compile-and-run via embedded emulator |

## Run Locally

The app is static. For consistent loading of local resources, serve the checkout:

```sh
python -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000/`. Direct `file://` opening is browser-dependent;
resource requests and optional features can be subject to browser restrictions.

### Headless

```bash
node tools/node-runner.js <file.kex> [max_ms]
```

### Autotests

```bash
node tools/autotest-bcdclk.js [path-to-bcdclk.kex] [max_ms]
```

## Project Layout

- `src/` — emulator core, GPU surface, UI modules, bundled vendor libs
- `ide/` — FASM code editor (CodeMirror), examples, includes
- `tools/` — headless runner, autotests, benchmarking, build scripts

Hotspot benchmark: `node tools/benchmark-hotspots.js` (add `--headless temp_plasma.kex` to measure headless timer starvation).
- `assets_kolibrios/` — built-in KolibriOS root filesystem
- `.github/workflows/pages.yml` — GitHub Actions deploy to Pages
- `sysfuncs.txt` — primary `int 0x40` syscall reference

## License

MIT. See [LICENSE](LICENSE).

## Status

CPU instruction, FPU and KolibriOS syscall coverage is incomplete. The demo URL,
page names, `.kex` paths and SDK-facing interfaces are kept stable. An available
web page is not proof that every KolibriOS application runs correctly; binary
execution and hardware compatibility were not tested during documentation work.

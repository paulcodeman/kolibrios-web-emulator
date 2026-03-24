(() => {
  const root = globalThis;
  const { Emulator } = root.KosEmu.emu;
  const { createSurface } = root.KosEmu.gfx.surface;
  const { parseKex } = root.KosEmu.core.loader;

  let surface = null;
  let emulator = null;
  let cpuBackendMode = "js";

  function post(type, payload) {
    root.postMessage({ type, ...payload });
  }

  function log(message) {
    post("log", { message: String(message) });
  }

  function ensureEmulator() {
    if (!surface) {
      throw new Error("Worker surface is not initialized.");
    }
    if (emulator) {
      return emulator;
    }
    emulator = new Emulator(surface, log, { cpuBackend: cpuBackendMode });
    emulator.autoFitWindow = true;
    emulator.onWindowResize = (width, height) => {
      const w = Math.max(1, width | 0);
      const h = Math.max(1, height | 0);
      surface.resize(w, h);
      post("window-size", { width: w, height: h });
    };
    const stop = emulator.stop.bind(emulator);
    emulator.stop = () => {
      const wasRunning = emulator.running;
      stop();
      if (wasRunning) {
        post("stopped", {});
      }
    };
    return emulator;
  }

  function applyTraceConfig(cpu, data) {
    cpu.traceSyscalls = !!data.traceSyscalls;
    cpu.traceImages = !!data.traceImages;
    cpu.traceOpcodes = !!data.traceOpcodes;
  }

  function applyMouseState(cpu, data) {
    cpu.setMouseState(
      data.x | 0,
      data.y | 0,
      data.buttons | 0,
      !!data.inside,
      data.pressMask | 0,
      data.releaseMask | 0,
      data.wheelX | 0,
      data.wheelY | 0,
      !!data.moved
    );
  }

  function applyKeyState(cpu, data) {
    cpu.setControlKeyState(data.controlKeys | 0);
    if (data.enqueue) {
      if (data.browser && typeof cpu.queueBrowserKeyEvent === "function") {
        cpu.queueBrowserKeyEvent(data);
        return;
      }
      cpu.queueKeyEvent(
        data.asciiCode | 0,
        data.scanCode | 0,
        data.controlKeys | 0,
        !!data.hotkey
      );
    }
  }

  root.onmessage = (event) => {
    const data = event.data || {};
    try {
      switch (data.type) {
        case "init": {
          cpuBackendMode = typeof Emulator.normalizeCpuBackendMode === "function"
            ? Emulator.normalizeCpuBackendMode(data.cpuBackend)
            : (String(data.cpuBackend || "").trim().toLowerCase() === "wasm" ? "wasm" : "js");
          surface = createSurface(data.canvas, data.width | 0, data.height | 0, log);
          ensureEmulator();
          post("ready", {});
          return;
        }
        case "trace-config": {
          if (emulator) {
            applyTraceConfig(emulator, data);
          }
          return;
        }
        case "surface-size": {
          if (surface) {
            surface.resize(Math.max(1, data.width | 0), Math.max(1, data.height | 0));
          }
          return;
        }
        case "mouse": {
          if (emulator) {
            applyMouseState(emulator, data);
          }
          return;
        }
        case "key": {
          if (emulator) {
            applyKeyState(emulator, data);
          }
          return;
        }
        case "run": {
          const cpu = ensureEmulator();
          if (data.cpuBackend && typeof cpu.setCpuBackend === "function") {
            cpuBackendMode = typeof Emulator.normalizeCpuBackendMode === "function"
              ? Emulator.normalizeCpuBackendMode(data.cpuBackend)
              : (String(data.cpuBackend || "").trim().toLowerCase() === "wasm" ? "wasm" : "js");
            cpu.setCpuBackend(cpuBackendMode);
          }
          applyTraceConfig(cpu, data);
          if (data.mouse) {
            applyMouseState(cpu, data.mouse);
          }
          const image = parseKex(data.buffer, data.fileName || "image.kex");
          cpu.load(image);
          cpu.run();
          return;
        }
        case "stop": {
          if (emulator) {
            emulator.stop();
          }
          return;
        }
        default:
          return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`Worker failure: ${message}`);
      throw err;
    }
  };
})();

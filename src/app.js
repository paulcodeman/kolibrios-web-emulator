(() => {
  const KosEmu = globalThis.KosEmu;
  const { Emulator } = KosEmu.emu;
  const { parseKex, formatKexInfo } = KosEmu.core.loader;
  const { createSurface, createHeadlessSurface } = KosEmu.gfx.surface;
  const { App } = KosEmu.ui;

  KosEmu.Emulator = Emulator;
  KosEmu.parseKex = parseKex;
  KosEmu.createSurface = createSurface;
  KosEmu.createHeadlessSurface = createHeadlessSurface;
  KosEmu.formatKexInfo = formatKexInfo;

  if (typeof window !== "undefined" && window.document) {
    window.addEventListener("DOMContentLoaded", () => {
      const app = new App();
      app.start();
    });
  }
})();

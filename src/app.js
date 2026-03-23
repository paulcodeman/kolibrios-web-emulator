(() => {
  const KosEmu = globalThis.KosEmu;
  const { Emulator } = KosEmu.emu;
  const { parseKex, formatKexInfo } = KosEmu.core.loader;
  const { createSurface, createHeadlessSurface } = KosEmu.gfx.surface;
  const { App, bundledRoot } = KosEmu.ui;

  KosEmu.Emulator = Emulator;
  KosEmu.parseKex = parseKex;
  KosEmu.createSurface = createSurface;
  KosEmu.createHeadlessSurface = createHeadlessSurface;
  KosEmu.formatKexInfo = formatKexInfo;

  if (typeof window !== "undefined" && window.document) {
    window.addEventListener("DOMContentLoaded", () => {
      const pageConfig = window.KosEmuPageConfig || null;
      const app = new App();
      if (pageConfig && pageConfig.skipPersistedRootRestore) {
        app.restorePersistedRootFolder = function skipPersistedRootFolder() {};
      }
      app.start();
      window.__app = app;
      if (pageConfig && pageConfig.autoBootBundledDesktop) {
        if (!bundledRoot || typeof bundledRoot.bootBundledDesktopPage !== "function") {
          app.log("Bundled desktop helper unavailable.");
          app.setStatus("Desktop boot failed");
          return;
        }
        void bundledRoot.bootBundledDesktopPage(app, pageConfig).catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          app.log(`Bundled desktop boot failed: ${message}`);
          app.setStatus("Desktop boot failed");
        });
      }
    });
  }
})();

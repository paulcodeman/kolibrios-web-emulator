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
  KosEmu.pollForOutput = pollForOutput;

  if (typeof window !== "undefined" && window.document) {
    window.addEventListener("DOMContentLoaded", () => {
      const pageConfig = window.KosEmuPageConfig || null;
      const app = new App();
      if (pageConfig && pageConfig.skipPersistedRootRestore) {
        app.restorePersistedRootFolder = function skipPersistedRootFolder() {};
      }
      app.start();
      window.__app = app;

      const params = new URLSearchParams(location.search);
      if (params.has("ide")) {
        document.body.classList.add("ide-mode");
        if (!app.browserFsRoot) {
          mountBundledRoot(app);
        }
      }
      const loadPath = params.get("load");
      if (loadPath) {
        fetch(loadPath).then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.arrayBuffer();
        }).then(buffer => {
          const name = loadPath.split("/").pop() || "image.kex";
          app.loadImageFromBuffer(name, buffer, "Loaded via URL");
          app.launchCurrentImage();
        }).catch(err => {
          app.log(`URL load failed: ${err.message}`);
        });
      }
      window.addEventListener("message", (e) => {
        const data = e.data;
        if (!data) return;
        if (data.type === "kex-binary") {
          const name = data.name || "ide.kex";
          const buffer = data.buffer;
          app.loadImageFromBuffer(name, buffer, "IDE");
          app.launchCurrentImage();
        } else if (data.type === "compile") {
          handleCompile(e, app);
        }
      });
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

  function mountBundledRoot(app) {
    const manifest = (KosEmu.assets || {}).builtinKolibriRoot;
    if (!manifest || !bundledRoot || typeof bundledRoot.createBundledRoot !== "function") {
      app.log("Bundled root unavailable for IDE mode.");
      return;
    }
    try {
      app.browserFsRoot = bundledRoot.createBundledRoot(manifest);
      app.savedFsRootLabel = "";
      app.savedFsRootPendingPermission = false;
      if (typeof app.updateFsRootStatus === "function") {
        app.updateFsRootStatus();
      }
      if (typeof app.updateSessionState === "function") {
        app.updateSessionState();
      }
      app.log("Mounted built-in FS root for IDE.");
    } catch (err) {
      app.log(`Failed to mount built-in root: ${err.message}`);
    }
  }

  async function handleCompile(e, app) {
    const { id, source, fileName } = e.data;
    const reply = (result) => {
      e.source.postMessage({ type: "compile-result", id, ...result }, "*");
    };

    try {
      if (!app.browserFsRoot) {
        mountBundledRoot(app);
        if (!app.browserFsRoot) {
          reply({ success: false, error: "No filesystem available" });
          return;
        }
      }

      const encoder = new TextEncoder();
      const sourceBytes = encoder.encode(source);
      const srcResult = app.browserFsRoot.mutationProvider("create-file", "/tmp0/1/source.asm", { data: sourceBytes.buffer });
      app.log(`Write source result: ${JSON.stringify(srcResult)}`);
      const verify = app.browserFsRoot.fileProvider("/tmp0/1/source.asm");
      app.log(`Source exists: ${!!verify}, size: ${verify ? verify.length : 0}`);
      if (!srcResult || srcResult.errorCode !== 0) {
        reply({ success: false, error: `Failed to write source (error ${srcResult ? srcResult.errorCode : "?"})` });
        return;
      }

      const paramsStr = "/tmp0/1/source.asm /tmp0/1/out.kex";
      app.log(`Launching FASM with params: "${paramsStr}"`);
      const launchResult = app.sessionManager.startApplication({
        path: "/develop/FASM",
        params: paramsStr
      });

      if (launchResult.errorCode !== 0) {
        reply({ success: false, error: `FASM launch failed (error ${launchResult.errorCode})` });
        return;
      }

      const pid = launchResult.pid;

      const kexBytes = await pollForOutput(app, pid, "/tmp0/1/out.kex", 30000);
      if (!kexBytes) {
        reply({ success: false, error: "FASM did not produce output" });
        return;
      }

      reply({ success: true, kex: kexBytes.buffer });
    } catch (err) {
      reply({ success: false, error: err.message });
    }
  }

  function pollForOutput(app, pid, outPath, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve) => {
      const poll = () => {
        if (Date.now() > deadline) {
          resolve(null);
          return;
        }
        const proc = app.sessionManager.processByPid.get(pid);
        if (!proc || proc.removed) {
          const bytes = app.browserFsRoot.fileProvider(outPath);
          resolve(bytes || null);
          return;
        }
        setTimeout(poll, 100);
      };
      setTimeout(poll, 100);
    });
  }
})();
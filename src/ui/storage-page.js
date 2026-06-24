(() => {
  const CATALOG = [
    {
      id: "tinypad",
      name: "Tinypad",
      path: "/sys/TINYPAD",
      badge: "Editor",
      description: "Compact text editor for notes, quick edits, and simple file work.",
      shotTitle: "TEXT",
      shotAccent: "#d26d35",
      shotAccentSoft: "#f0c7a8"
    },
    {
      id: "calc",
      name: "Calc",
      path: "/sys/CALC",
      badge: "Utility",
      description: "Classic calculator with a small window footprint and fast startup.",
      shotTitle: "1 + 2",
      shotAccent: "#8a6fc8",
      shotAccentSoft: "#d9d1ef"
    },
    {
      id: "terminal",
      name: "Terminal",
      path: "/sys/TERMINAL",
      badge: "Console",
      description: "Console session for command-line workflows inside the emulated environment.",
      shotTitle: ">_",
      shotAccent: "#3d7d54",
      shotAccentSoft: "#cfe7d7"
    },
    {
      id: "shell",
      name: "Shell",
      path: "/sys/SHELL",
      badge: "System",
      description: "Direct shell window for scripts, commands, and process control.",
      shotTitle: "CMD",
      shotAccent: "#4f6d8e",
      shotAccentSoft: "#d7e0eb"
    },
    {
      id: "gmon",
      name: "GMon",
      path: "/sys/GMON",
      badge: "Monitor",
      description: "System monitor with CPU and memory information rendered by the guest.",
      shotTitle: "CPU",
      shotAccent: "#a64f4f",
      shotAccentSoft: "#edd1d1"
    },
    {
      id: "bcdclk",
      name: "BCDCLK",
      path: "/demos/BCDCLK",
      badge: "Demo",
      description: "Timing demo used as a compact regression target for drawing and palette updates.",
      shotTitle: "12:34",
      shotAccent: "#bf8a23",
      shotAccentSoft: "#f2e0b5"
    },
    {
      id: "cube",
      name: "3DCUBE2",
      path: "/3d/3DCUBE2",
      badge: "3D",
      description: "Small 3D demo that is useful for checking window redraw and animation paths.",
      shotTitle: "3D",
      shotAccent: "#2f78a3",
      shotAccentSoft: "#c5dfec"
    },
    {
      id: "fasm",
      name: "FASM",
      path: "/develop/FASM",
      badge: "Dev",
      description: "Assembler IDE from the bundled KolibriOS root for heavier compatibility testing.",
      shotTitle: "ASM",
      shotAccent: "#5f8a39",
      shotAccentSoft: "#dbe8ca"
    }
  ];

  function getBaseName(pathText) {
    const parts = String(pathText || "").split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : "app";
  }

  function getDownloadName(pathText) {
    const baseName = getBaseName(pathText);
    return /\.[a-z0-9]+$/i.test(baseName) ? baseName : `${baseName}.kex`;
  }

  function updateMarketplaceStatus(app) {
    if (!app || typeof app.setStatus !== "function") {
      return;
    }
    if (app.storageStatusOverride) {
      app.setStatus(app.storageStatusOverride);
      return;
    }
    const sessionManager = app.sessionManager || null;
    const active = sessionManager && typeof sessionManager.getActiveProcess === "function"
      ? sessionManager.getActiveProcess()
      : null;
    if (active && !active.removed) {
      const label = getBaseName(active.displayPath || active.processPath || active.fileName || "app");
      app.setStatus(`Active: ${label}`);
      return;
    }
    if (app.browserFsRoot) {
      app.setStatus("Catalog ready");
      return;
    }
    app.setStatus("Connecting catalog...");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function createCardElement(entry) {
    const article = document.createElement("article");
    article.className = "card storage-card";
    article.dataset.appId = entry.id;

    const shot = document.createElement("div");
    shot.className = "storage-shot";
    shot.style.setProperty("--storage-shot-accent", entry.shotAccent);
    shot.style.setProperty("--storage-shot-accent-soft", entry.shotAccentSoft);
    const shotWindow = document.createElement("div");
    shotWindow.className = "storage-shot-window";
    const toolbar = document.createElement("div");
    toolbar.className = "storage-shot-toolbar";
    shotWindow.appendChild(toolbar);
    const shotBody = document.createElement("div");
    shotBody.className = "storage-shot-body";
    const grid = document.createElement("div");
    grid.className = "storage-shot-grid";
    shotBody.appendChild(grid);
    const title = document.createElement("div");
    title.className = "storage-shot-title";
    title.textContent = entry.shotTitle;
    shotBody.appendChild(title);
    shotWindow.appendChild(shotBody);
    shot.appendChild(shotWindow);
    article.appendChild(shot);

    const cardBody = document.createElement("div");
    cardBody.className = "storage-card-body";
    const top = document.createElement("div");
    top.className = "storage-card-top";
    const nameBlock = document.createElement("div");
    const nameEl = document.createElement("div");
    nameEl.className = "storage-app-name";
    nameEl.textContent = entry.name;
    nameBlock.appendChild(nameEl);
    const pathEl = document.createElement("div");
    pathEl.className = "storage-app-path mono";
    pathEl.textContent = entry.path;
    nameBlock.appendChild(pathEl);
    top.appendChild(nameBlock);
    const badge = document.createElement("div");
    badge.className = "storage-badge";
    badge.textContent = entry.badge;
    top.appendChild(badge);
    cardBody.appendChild(top);

    const desc = document.createElement("p");
    desc.className = "storage-card-description";
    desc.textContent = entry.description;
    cardBody.appendChild(desc);

    const footer = document.createElement("div");
    footer.className = "storage-card-footer";
    const state = document.createElement("div");
    state.className = "storage-card-state";
    state.dataset.role = "state";
    state.textContent = "Preparing...";
    footer.appendChild(state);
    const actions = document.createElement("div");
    actions.className = "storage-actions";
    const dlBtn = document.createElement("button");
    dlBtn.className = "storage-download-btn";
    dlBtn.type = "button";
    dlBtn.textContent = "Download";
    actions.appendChild(dlBtn);
    const launchBtn = document.createElement("button");
    launchBtn.className = "primary storage-launch-btn";
    launchBtn.type = "button";
    launchBtn.textContent = "Launch";
    actions.appendChild(launchBtn);
    footer.appendChild(actions);
    cardBody.appendChild(footer);
    article.appendChild(cardBody);

    return article;
  }

  function findProcessState(process) {
    if (!process) {
      return { active: false, removed: true };
    }
    return {
      active: !process.removed,
      removed: !!process.removed,
      pid: process.pid >>> 0,
      slot: process.slot >>> 0,
      stopped: !!process.stopped
    };
  }

  function revokeObjectUrlLater(url) {
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 0);
  }

  function downloadApp(app, entry) {
    if (!app || !app.browserFsRoot || typeof app.browserFsRoot.fileProvider !== "function") {
      app.log(`Download failed for ${entry.path}: FS root unavailable.`);
      return;
    }
    const bytes = app.browserFsRoot.fileProvider(entry.path);
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength) {
      app.log(`Download failed for ${entry.path}: file not found.`);
      return;
    }
    const blob = new Blob([bytes.slice()], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = getDownloadName(entry.path);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    revokeObjectUrlLater(url);
    app.log(`Downloaded ${entry.path} as ${link.download}`);
  }

  async function mountBundledRoot(app) {
    const bundledRoot = globalThis.KosEmu && globalThis.KosEmu.ui ? globalThis.KosEmu.ui.bundledRoot : null;
    const assets = globalThis.KosEmu ? globalThis.KosEmu.assets : null;
    const manifest = assets ? (assets.builtinKolibriRoot || null) : null;
    if (!bundledRoot || typeof bundledRoot.createBundledRoot !== "function" || !manifest) {
      throw new Error("Built-in KolibriOS root is unavailable.");
    }
    const root = bundledRoot.createBundledRoot(manifest);
    app.browserFsRoot = root;
    app.savedFsRootLabel = "";
    app.savedFsRootPendingPermission = false;
    if (app.sessionManager && typeof app.sessionManager.refreshSkinThemes === "function") {
      app.sessionManager.refreshSkinThemes();
    }
    if (typeof app.updateFsRootStatus === "function") {
      app.updateFsRootStatus();
    }
    app.log(`Mounted built-in FS root: ${root.summaryText()}`);
    return root;
  }

  function renderCatalog(app, launches) {
    const catalogEl = document.getElementById("storageCatalog");
    if (!catalogEl) {
      return new Map();
    }
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < CATALOG.length; i += 1) {
      fragment.appendChild(createCardElement(CATALOG[i]));
    }
    catalogEl.textContent = "";
    catalogEl.appendChild(fragment);
    const cards = new Map();
    for (let i = 0; i < CATALOG.length; i += 1) {
      const entry = CATALOG[i];
      const card = catalogEl.querySelector(`[data-app-id="${CSS.escape(entry.id)}"]`);
      if (!card) {
        continue;
      }
      const launchBtn = card.querySelector(".storage-launch-btn");
      const downloadBtn = card.querySelector(".storage-download-btn");
      if (launchBtn) {
        launchBtn.addEventListener("click", () => {
          const current = launches.get(entry.id) || null;
          if (current && !current.removed) {
            app.storageStatusOverride = "";
            current.stop("stopped");
            return;
          }
          try {
            const process = app.sessionManager.launchPath(entry.path, { activate: true });
            app.storageStatusOverride = "";
            launches.set(entry.id, process);
            app.log(`Storage launched ${entry.path} as PID ${process.pid} (slot ${process.slot})`);
            app.updateSessionState();
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            card.dataset.error = message;
            app.storageStatusOverride = "Launch failed";
            app.log(`Storage launch failed for ${entry.path}: ${message}`);
            app.updateSessionState();
          }
        });
      }
      if (downloadBtn) {
        downloadBtn.addEventListener("click", () => downloadApp(app, entry));
      }
      cards.set(entry.id, card);
    }
    return cards;
  }

  function syncCatalogState(app, launches, cards) {
    for (let i = 0; i < CATALOG.length; i += 1) {
      const entry = CATALOG[i];
      const card = cards.get(entry.id);
      if (!card) {
        continue;
      }
      const process = launches.get(entry.id) || null;
      if (process && process.removed) {
        launches.delete(entry.id);
      }
      const activeProcess = launches.get(entry.id) || null;
      const state = findProcessState(activeProcess);
      const launchBtn = card.querySelector(".storage-launch-btn");
      const downloadBtn = card.querySelector(".storage-download-btn");
      const stateEl = card.querySelector("[data-role='state']");
      const errorText = card.dataset.error ? String(card.dataset.error) : "";
      if (downloadBtn) {
        downloadBtn.disabled = !app.browserFsRoot;
      }
      if (launchBtn) {
        launchBtn.disabled = !app.browserFsRoot && !state.active;
        launchBtn.textContent = state.active ? "Stop" : "Launch";
      }
      card.classList.toggle("storage-card-running", state.active);
      if (state.active && stateEl) {
        stateEl.textContent = `Running: PID ${state.pid}`;
        card.dataset.error = "";
      } else if (!app.browserFsRoot && stateEl) {
        stateEl.textContent = "Connecting root...";
      } else if (errorText && stateEl) {
        stateEl.textContent = `Error: ${errorText}`;
      } else if (stateEl) {
        stateEl.textContent = "Ready";
      }
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    const app = window.__app;
    if (!app || !app.sessionManager) {
      return;
    }

    const launches = new Map();
    app.storageStatusOverride = "";

    const baseUpdateFsRootStatus = typeof app.updateFsRootStatus === "function"
      ? app.updateFsRootStatus.bind(app)
      : null;
    app.updateFsRootStatus = function updateStorageFsRootStatus() {
      if (baseUpdateFsRootStatus) {
        baseUpdateFsRootStatus();
      }
      if (app.fsRootStatusEl && app.browserFsRoot && typeof app.browserFsRoot.summaryText === "function") {
        app.fsRootStatusEl.textContent = `FS root: ${app.browserFsRoot.summaryText()}`;
      }
    };

    const cards = renderCatalog(app, launches);

    const baseUpdateSessionState = typeof app.updateSessionState === "function"
      ? app.updateSessionState.bind(app)
      : null;
    app.updateSessionState = function updateStorageSessionState() {
      if (baseUpdateSessionState) {
        baseUpdateSessionState();
      }
      syncCatalogState(app, launches, cards);
      updateMarketplaceStatus(app);
    };
    app.updateSessionState();

    void mountBundledRoot(app)
      .then(() => {
        app.storageStatusOverride = "";
        app.updateSessionState();
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        app.storageStatusOverride = "Catalog unavailable";
        app.log(`Storage boot failed: ${message}`);
        app.updateSessionState();
      });
  });
})();

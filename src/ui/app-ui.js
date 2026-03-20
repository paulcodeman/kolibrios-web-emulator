(() => {
  const KosEmu = globalThis.KosEmu;
  const { parseKex, formatKexInfo } = KosEmu.core.loader;
  const { BrowserFsRoot } = KosEmu.ui.browserFs || {};

  function keyboardKey(scanCode, extended) {
    return {
      scanCode: scanCode & 0xff,
      extended: !!extended
    };
  }

  const KEYBOARD_SCANCODES = {
    Escape: keyboardKey(0x01),
    Digit1: keyboardKey(0x02),
    Digit2: keyboardKey(0x03),
    Digit3: keyboardKey(0x04),
    Digit4: keyboardKey(0x05),
    Digit5: keyboardKey(0x06),
    Digit6: keyboardKey(0x07),
    Digit7: keyboardKey(0x08),
    Digit8: keyboardKey(0x09),
    Digit9: keyboardKey(0x0a),
    Digit0: keyboardKey(0x0b),
    Minus: keyboardKey(0x0c),
    Equal: keyboardKey(0x0d),
    Backspace: keyboardKey(0x0e),
    Tab: keyboardKey(0x0f),
    KeyQ: keyboardKey(0x10),
    KeyW: keyboardKey(0x11),
    KeyE: keyboardKey(0x12),
    KeyR: keyboardKey(0x13),
    KeyT: keyboardKey(0x14),
    KeyY: keyboardKey(0x15),
    KeyU: keyboardKey(0x16),
    KeyI: keyboardKey(0x17),
    KeyO: keyboardKey(0x18),
    KeyP: keyboardKey(0x19),
    BracketLeft: keyboardKey(0x1a),
    BracketRight: keyboardKey(0x1b),
    Enter: keyboardKey(0x1c),
    NumpadEnter: keyboardKey(0x1c, true),
    ControlLeft: keyboardKey(0x1d),
    ControlRight: keyboardKey(0x1d, true),
    KeyA: keyboardKey(0x1e),
    KeyS: keyboardKey(0x1f),
    KeyD: keyboardKey(0x20),
    KeyF: keyboardKey(0x21),
    KeyG: keyboardKey(0x22),
    KeyH: keyboardKey(0x23),
    KeyJ: keyboardKey(0x24),
    KeyK: keyboardKey(0x25),
    KeyL: keyboardKey(0x26),
    Semicolon: keyboardKey(0x27),
    Quote: keyboardKey(0x28),
    Backquote: keyboardKey(0x29),
    ShiftLeft: keyboardKey(0x2a),
    Backslash: keyboardKey(0x2b),
    KeyZ: keyboardKey(0x2c),
    KeyX: keyboardKey(0x2d),
    KeyC: keyboardKey(0x2e),
    KeyV: keyboardKey(0x2f),
    KeyB: keyboardKey(0x30),
    KeyN: keyboardKey(0x31),
    KeyM: keyboardKey(0x32),
    Comma: keyboardKey(0x33),
    Period: keyboardKey(0x34),
    Slash: keyboardKey(0x35),
    NumpadDivide: keyboardKey(0x35, true),
    ShiftRight: keyboardKey(0x36),
    NumpadMultiply: keyboardKey(0x37),
    AltLeft: keyboardKey(0x38),
    AltRight: keyboardKey(0x38, true),
    Space: keyboardKey(0x39),
    CapsLock: keyboardKey(0x3a),
    F1: keyboardKey(0x3b),
    F2: keyboardKey(0x3c),
    F3: keyboardKey(0x3d),
    F4: keyboardKey(0x3e),
    F5: keyboardKey(0x3f),
    F6: keyboardKey(0x40),
    F7: keyboardKey(0x41),
    F8: keyboardKey(0x42),
    F9: keyboardKey(0x43),
    F10: keyboardKey(0x44),
    NumLock: keyboardKey(0x45),
    ScrollLock: keyboardKey(0x46),
    Numpad7: keyboardKey(0x47),
    Numpad8: keyboardKey(0x48),
    Numpad9: keyboardKey(0x49),
    NumpadSubtract: keyboardKey(0x4a),
    Numpad4: keyboardKey(0x4b),
    Numpad5: keyboardKey(0x4c),
    Numpad6: keyboardKey(0x4d),
    NumpadAdd: keyboardKey(0x4e),
    Numpad1: keyboardKey(0x4f),
    Numpad2: keyboardKey(0x50),
    Numpad3: keyboardKey(0x51),
    Numpad0: keyboardKey(0x52),
    NumpadDecimal: keyboardKey(0x53),
    F11: keyboardKey(0x57),
    F12: keyboardKey(0x58),
    Home: keyboardKey(0x47, true),
    ArrowUp: keyboardKey(0x48, true),
    PageUp: keyboardKey(0x49, true),
    ArrowLeft: keyboardKey(0x4b, true),
    ArrowRight: keyboardKey(0x4d, true),
    End: keyboardKey(0x4f, true),
    ArrowDown: keyboardKey(0x50, true),
    PageDown: keyboardKey(0x51, true),
    Insert: keyboardKey(0x52, true),
    Delete: keyboardKey(0x53, true),
    MetaLeft: keyboardKey(0x5b, true),
    MetaRight: keyboardKey(0x5c, true),
    ContextMenu: keyboardKey(0x5d, true)
  };

  const CONTROL_KEY_MASKS = {
    ShiftLeft: 0x001,
    ShiftRight: 0x002,
    ControlLeft: 0x004,
    ControlRight: 0x008,
    AltLeft: 0x010,
    AltRight: 0x020,
    MetaLeft: 0x200,
    MetaRight: 0x400
  };

  function isLockKey(code) {
    return code === "CapsLock" || code === "NumLock" || code === "ScrollLock";
  }

  function isTrackedKeyboardCode(code) {
    return !!(CONTROL_KEY_MASKS[code] || isLockKey(code) || KEYBOARD_SCANCODES[code]);
  }

  function getCp866ByteFromKey(key) {
    if (!key) {
      return 0;
    }
    const codePoint = key.codePointAt(0) >>> 0;
    if (String.fromCodePoint(codePoint) !== key) {
      return 0;
    }
    const kolibriText = KosEmu.gfx && KosEmu.gfx.kolibriText ? KosEmu.gfx.kolibriText : null;
    if (kolibriText && typeof kolibriText.encodeCp866CodePoint === "function") {
      const encoded = kolibriText.encodeCp866CodePoint(codePoint);
      if (encoded !== 0 || codePoint === 0) {
        return encoded & 0xff;
      }
    }
    return codePoint <= 0xff ? codePoint : 0;
  }

  function getAsciiCodeFromKey(event) {
    const key = event && typeof event.key === "string" ? event.key : "";
    if (!key) {
      return 0;
    }
    switch (key) {
      case "Enter": return 13;
      case "Escape": return 27;
      case "Backspace": return 8;
      case "Tab": return 9;
      case " ": return 32;
      case "ArrowLeft": return 176;
      case "ArrowDown": return 177;
      case "ArrowUp": return 178;
      case "ArrowRight": return 179;
      case "Home": return 180;
      case "End": return 181;
      case "Delete": return 182;
      case "PageDown": return 183;
      case "PageUp": return 184;
      case "Insert": return 185;
      default:
        break;
    }
    if (key.length >= 1 && key.length <= 2) {
      return getCp866ByteFromKey(key);
    }
    return 0;
  }

  function updateControlKeyMaskState(mask, event, isDown) {
    let nextMask = mask & 0x7ff;
    const code = event && typeof event.code === "string" ? event.code : "";
    const bit = CONTROL_KEY_MASKS[code] || 0;
    if (bit) {
      if (isDown) {
        nextMask |= bit;
      } else {
        nextMask &= ~bit;
      }
    }
    if (event && typeof event.getModifierState === "function") {
      const setBit = (nextBit, enabled) => {
        if (enabled) {
          nextMask |= nextBit;
        } else {
          nextMask &= ~nextBit;
        }
      };
      setBit(0x040, !!event.getModifierState("CapsLock"));
      setBit(0x080, !!event.getModifierState("NumLock"));
      setBit(0x100, !!event.getModifierState("ScrollLock"));
    }
    return nextMask & 0x7ff;
  }

  function translateDomKeyboardEvent(event) {
    if (!event) {
      return null;
    }
    const code = typeof event.code === "string" ? event.code : "";
    const entry = KEYBOARD_SCANCODES[code] || null;
    const asciiCode = getAsciiCodeFromKey(event) & 0xff;
    if (!entry && asciiCode === 0) {
      return null;
    }
    return {
      asciiCode,
      scanCode: entry ? (entry.scanCode & 0xff) : 0,
      extended: !!(entry && entry.extended),
      modifier: !!CONTROL_KEY_MASKS[code],
      lockKey: isLockKey(code)
    };
  }

  class App {
    start() {
      this.bindDom();
      this.logLines = [];
      this.currentImage = null;
      this.currentFileBuffer = null;
      this.currentFileName = "";
      this.browserFsRoot = null;
      this.fsRootBusy = false;
      this.savedFsRootLabel = "";
      this.savedFsRootPendingPermission = false;
      this.sessionManager = new KosEmu.ui.SessionManager(this, this.workspaceEl);

      this.fileInput.addEventListener("change", () => this.handleFile());
      this.runBtn.addEventListener("click", () => this.handleRun());
      this.stopBtn.addEventListener("click", () => this.handleStop());
      if (this.pickRootBtn) {
        this.pickRootBtn.addEventListener("click", () => this.handlePickRootFolder());
      }
      if (this.clearRootBtn) {
        this.clearRootBtn.addEventListener("click", () => this.handleClearRootFolder());
      }
      if (this.traceSyscallsInput) {
        this.traceSyscallsInput.addEventListener("change", () => this.applyTraceConfig());
      }
      if (this.traceImagesInput) {
        this.traceImagesInput.addEventListener("change", () => this.applyTraceConfig());
      }
      if (this.traceOpcodesInput) {
        this.traceOpcodesInput.addEventListener("change", () => this.applyTraceConfig());
      }

      window.addEventListener("beforeunload", () => {
        this.flushMountedRoot();
        if (this.sessionManager) {
          this.sessionManager.stopAllProcesses("stopped");
        }
      });

      this.infoEl.textContent = "No image loaded.";
      this.logEl.textContent = "Ready.";
      this.updateFsRootStatus();
      this.updateSessionState();
      this.setStatus("Session ready");
      this.restorePersistedRootFolder();
    }

    bindDom() {
      this.fileInput = document.getElementById("fileInput");
      this.runBtn = document.getElementById("runBtn");
      this.stopBtn = document.getElementById("stopBtn");
      this.pickRootBtn = document.getElementById("pickRootBtn");
      this.clearRootBtn = document.getElementById("clearRootBtn");
      this.traceSyscallsInput = document.getElementById("traceSyscalls");
      this.traceOpcodesInput = document.getElementById("traceOpcodes");
      this.traceImagesInput = document.getElementById("traceImages");
      this.infoEl = document.getElementById("info");
      this.logEl = document.getElementById("log");
      this.statusEl = document.getElementById("status");
      this.fsRootStatusEl = document.getElementById("fsRootStatus");
      this.workspaceEl = document.getElementById("workspace");
      this.workspaceEmptyEl = document.getElementById("workspaceEmpty");
      this.sessionInfoEl = document.getElementById("sessionInfo");
    }

    setStatus(message) {
      if (this.statusEl) {
        this.statusEl.textContent = message;
      }
    }

    log(message) {
      const now = new Date();
      const stamp = now.toTimeString().slice(0, 8);
      this.logLines.push(`[${stamp}] ${message}`);
      if (this.logLines.length > 300) {
        this.logLines.shift();
      }
      if (this.logEl) {
        this.logEl.textContent = this.logLines.join("\n");
      }
    }

    currentTraceConfig() {
      return {
        traceSyscalls: !!(this.traceSyscallsInput && this.traceSyscallsInput.checked),
        traceImages: !!(this.traceImagesInput && this.traceImagesInput.checked),
        traceOpcodes: !!(this.traceOpcodesInput && this.traceOpcodesInput.checked)
      };
    }

    applyTraceConfig() {
      if (this.sessionManager) {
        this.sessionManager.applyTraceConfig(this.currentTraceConfig());
      }
    }

    hasBrowserFsRoot() {
      return !!this.browserFsRoot;
    }

    flushMountedRoot() {
      if (this.browserFsRoot) {
        this.browserFsRoot.flushPending();
      }
    }

    updateFsRootStatus() {
      const supported = !!(BrowserFsRoot && BrowserFsRoot.supportsDirectoryPicker && BrowserFsRoot.supportsDirectoryPicker());
      if (this.pickRootBtn) {
        this.pickRootBtn.disabled = this.fsRootBusy || !supported;
      }
      if (this.clearRootBtn) {
        this.clearRootBtn.disabled = this.fsRootBusy || (!this.browserFsRoot && !this.savedFsRootPendingPermission);
      }
      if (!this.fsRootStatusEl) {
        return;
      }
      if (!supported) {
        this.fsRootStatusEl.textContent = "FS root: browser directory picker unavailable";
        return;
      }
      if (this.fsRootBusy) {
        this.fsRootStatusEl.textContent = "FS root: scanning selected folder...";
        return;
      }
      if (!this.browserFsRoot) {
        if (this.savedFsRootPendingPermission && this.savedFsRootLabel) {
          this.fsRootStatusEl.textContent = `FS root: ${this.savedFsRootLabel} saved, permission required`;
          return;
        }
        this.fsRootStatusEl.textContent = "FS root: not mounted";
        return;
      }
      this.fsRootStatusEl.textContent = `FS root: ${this.browserFsRoot.summaryText()}`;
    }

    async restorePersistedRootFolder() {
      if (!BrowserFsRoot || !BrowserFsRoot.supportsHandlePersistence || !BrowserFsRoot.supportsHandlePersistence()) {
        return;
      }
      this.fsRootBusy = true;
      this.updateFsRootStatus();
      this.setStatus("Restoring FS root...");
      try {
        const handle = await BrowserFsRoot.loadPersistedDirectoryHandle();
        if (!handle) {
          return;
        }
        const root = await BrowserFsRoot.fromDirectoryHandle(handle, {
          interactive: false,
          log: (msg) => this.log(msg),
          onProgress: (progress) => {
            if (!progress) {
              return;
            }
            this.setStatus(`Scanning ${progress.label}: ${progress.files} files`);
          }
        });
        if (root.permission !== "granted") {
          this.savedFsRootLabel = root.label;
          this.savedFsRootPendingPermission = true;
          this.log(`Saved FS root '${root.label}' requires permission again.`);
          return;
        }
        this.browserFsRoot = root;
        this.savedFsRootLabel = "";
        this.savedFsRootPendingPermission = false;
        this.log(`Restored browser FS root: ${root.summaryText()}`);
        if (this.sessionManager && typeof this.sessionManager.refreshSkinThemes === "function") {
          this.sessionManager.refreshSkinThemes();
        }
        this.setStatus(`Mounted ${root.label}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.log(`FS root restore failed: ${message}`);
        this.setStatus("Session ready");
      } finally {
        this.fsRootBusy = false;
        this.updateFsRootStatus();
        if (!this.browserFsRoot) {
          this.updateSessionState();
        }
      }
    }

    async handlePickRootFolder() {
      if (!BrowserFsRoot || !BrowserFsRoot.supportsDirectoryPicker || !BrowserFsRoot.supportsDirectoryPicker()) {
        this.log("Browser directory access is unavailable in this browser.");
        return;
      }
      this.fsRootBusy = true;
      this.updateFsRootStatus();
      this.setStatus("Selecting FS root...");
      try {
        const handle = await window.showDirectoryPicker({ mode: "readwrite" });
        this.setStatus(`Scanning ${handle.name}...`);
        const root = await BrowserFsRoot.fromDirectoryHandle(handle, {
          log: (msg) => this.log(msg),
          onProgress: (progress) => {
            if (!progress) {
              return;
            }
            this.setStatus(`Scanning ${progress.label}: ${progress.files} files`);
          }
        });
        if (root.permission !== "granted") {
          throw new Error("Directory access was not granted.");
        }
        this.browserFsRoot = root;
        this.savedFsRootLabel = "";
        this.savedFsRootPendingPermission = false;
        if (BrowserFsRoot.supportsHandlePersistence && BrowserFsRoot.supportsHandlePersistence()) {
          try {
            await BrowserFsRoot.savePersistedDirectoryHandle(handle);
          } catch (persistErr) {
            const persistMessage = persistErr instanceof Error ? persistErr.message : String(persistErr);
            this.log(`FS root persistence failed: ${persistMessage}`);
          }
        }
        this.log(`Mounted browser FS root: ${root.summaryText()}`);
        if (this.sessionManager && typeof this.sessionManager.refreshSkinThemes === "function") {
          this.sessionManager.refreshSkinThemes();
        }
        this.setStatus(`Mounted ${root.label}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message !== "The user aborted a request.") {
          this.log(`FS root selection failed: ${message}`);
        }
        this.setStatus("Session ready");
      } finally {
        this.fsRootBusy = false;
        this.updateFsRootStatus();
      }
    }

    async handleClearRootFolder() {
      this.browserFsRoot = null;
      this.savedFsRootLabel = "";
      this.savedFsRootPendingPermission = false;
      if (BrowserFsRoot && BrowserFsRoot.supportsHandlePersistence && BrowserFsRoot.supportsHandlePersistence()) {
        try {
          await BrowserFsRoot.clearPersistedDirectoryHandle();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.log(`FS root clear failed: ${message}`);
        }
      }
      this.updateFsRootStatus();
      if (this.sessionManager && typeof this.sessionManager.refreshSkinThemes === "function") {
        this.sessionManager.refreshSkinThemes();
      }
      this.updateSessionState();
      this.log("Browser FS root cleared.");
    }

    async handleFile() {
      const file = this.fileInput.files && this.fileInput.files[0];
      if (!file) {
        return;
      }
      this.runBtn.disabled = true;
      this.setStatus(`Loading ${file.name}`);
      try {
        const buffer = await file.arrayBuffer();
        const image = parseKex(buffer, file.name);
        this.currentImage = image;
        this.currentFileBuffer = buffer.slice(0);
        this.currentFileName = file.name;
        this.infoEl.textContent = formatKexInfo(image);
        this.log(`Loaded ${file.name}`);
        if (image.packed) {
          this.log(`KPCK unpacked: ${image.fileSize} -> ${image.unpackedSize}`);
        }
        this.setStatus(`Loaded ${file.name}`);
        this.runBtn.disabled = false;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.currentImage = null;
        this.currentFileBuffer = null;
        this.currentFileName = "";
        this.infoEl.textContent = `Error: ${message}`;
        this.log(`Load failed: ${message}`);
        this.setStatus("Load failed");
      }
    }

    handleRun() {
      if (!this.currentImage) {
        this.log("No image loaded.");
        return;
      }
      this.runBtn.disabled = true;
      try {
        const process = this.sessionManager.launchImage(this.currentImage, {
          buffer: this.currentFileBuffer,
          fileName: this.currentFileName || this.currentImage.fileName || "image.kex",
          processPath: this.currentImage.fileName || this.currentFileName || "image.kex",
          activate: true
        });
        this.log(`Started ${process.displayPath} as PID ${process.pid} (slot ${process.slot})`);
        this.updateSessionState();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.log(`Start failed: ${message}`);
        this.setStatus("Start failed");
      } finally {
        this.runBtn.disabled = this.currentImage === null;
      }
    }

    handleStop() {
      if (this.sessionManager && this.sessionManager.stopActiveProcess("stopped")) {
        this.updateSessionState();
        return;
      }
      if (this.sessionManager && this.sessionManager.stopAllProcesses("stopped")) {
        this.updateSessionState();
        return;
      }
      this.log("No running applications.");
    }

    updateSessionState() {
      if (!this.sessionManager) {
        return;
      }
      const summary = this.sessionManager.summaryText();
      if (this.sessionInfoEl) {
        this.sessionInfoEl.textContent = summary;
      }
      if (this.workspaceEmptyEl) {
        this.workspaceEmptyEl.hidden = this.sessionManager.hasProcesses();
      }
      this.stopBtn.disabled = !this.sessionManager.hasProcesses();
      const active = this.sessionManager.getActiveProcess();
      if (active) {
        this.setStatus(`Active: ${active.displayPath} | PID ${active.pid} | slot ${active.slot}`);
      } else if (this.currentImage) {
        this.setStatus(`Loaded ${this.currentImage.fileName}`);
      } else {
        this.setStatus("Session ready");
      }
    }

    getFileProvider() {
      if (!this.browserFsRoot) {
        return null;
      }
      return (kpath) => this.browserFsRoot.fileProvider(kpath);
    }

    getFileInfoProvider() {
      if (!this.browserFsRoot) {
        return null;
      }
      return (kpath, kind) => this.browserFsRoot.fileInfoProvider(kpath, kind);
    }

    getFileMutationProvider() {
      if (!this.browserFsRoot) {
        return null;
      }
      return (op, kpath, options) => this.browserFsRoot.mutationProvider(op, kpath, options);
    }
  }

  KosEmu.ui.keyboard = {
    KEYBOARD_SCANCODES,
    CONTROL_KEY_MASKS,
    getAsciiCodeFromKey,
    isLockKey,
    isTrackedKeyboardCode,
    translateDomKeyboardEvent,
    updateControlKeyMaskState
  };
  KosEmu.ui.App = App;
})();

(() => {
  const KosEmu = globalThis.KosEmu;
  const { parseKex, formatKexInfo } = KosEmu.core.loader;
  const { BrowserFsRoot, wrapWithHdMounts } = KosEmu.ui.browserFs || {};

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
  const KEYBOARD_LANGUAGE_IDS = Object.freeze({
    EN: 1,
    FI: 2,
    GE: 3,
    RU: 4,
    FR: 5,
    ET: 6,
    UA: 7,
    IT: 8,
    BE: 9
  });
  const KEYBOARD_LAYOUT_SAMPLE_CODES = Object.freeze([
    "KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO", "KeyP",
    "KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL",
    "KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM"
  ]);
  const CYRILLIC_RE = /[\u0400-\u04ff]/;
  const LATIN_RE = /[A-Za-z]/;
  const UKRAINIAN_RE = /[ІіЇїЄєҐґ]/;
  const BELARUSIAN_RE = /[Ўў]/;
  const BROWSER_LAYOUT_TEMPLATE_EN_NORMAL = Object.freeze([
    [0,54],[1,27],[2,49],[3,50],[4,51],[5,52],[6,53],[7,54],[8,55],[9,56],[10,57],[11,48],[12,45],[13,61],[14,8],[15,9],[16,113],[17,119],[18,101],[19,114],[20,116],[21,121],[22,117],[23,105],[24,111],[25,112],[26,91],[27,93],[28,13],[29,126],[30,97],[31,115],[32,100],[33,102],[34,103],[35,104],[36,106],[37,107],[38,108],[39,59],[40,39],[41,96],[43,92],[44,122],[45,120],[46,99],[47,118],[48,98],[49,110],[50,109],[51,44],[52,46],[53,47],[55,52],[56,53],[57,32],[58,64],[59,50],[60,51],[61,52],[62,53],[63,54],[64,55],[65,56],[66,57],[67,48],[68,49],[69,50],[70,51],[71,180],[72,178],[73,184],[74,54],[75,176],[76,55],[77,179],[78,56],[79,181],[80,177],[81,183],[82,185],[83,182],[84,65],[85,66],[86,60],[87,68],[88,255],[89,70],[90,71],[91,72],[92,73],[93,74],[94,75],[95,76],[96,77],[97,78],[98,79],[99,80],[100,81],[101,82],[102,83],[103,84],[104,85],[105,86],[106,87],[107,88],[108,89],[109,90],[110,65],[111,66],[112,67],[113,68],[114,69],[115,70],[116,71],[117,72],[118,73],[119,74],[120,75],[121,76],[122,77],[123,78],[124,79],[125,80],[126,81],[127,82]
  ]);
  const BROWSER_LAYOUT_TEMPLATE_EN_SHIFT = Object.freeze([
    [0,54],[1,27],[2,33],[3,64],[4,35],[5,36],[6,37],[7,94],[8,38],[9,42],[10,40],[11,41],[12,95],[13,43],[14,8],[15,9],[16,81],[17,87],[18,69],[19,82],[20,84],[21,89],[22,85],[23,73],[24,79],[25,80],[26,123],[27,125],[28,13],[29,126],[30,65],[31,83],[32,68],[33,70],[34,71],[35,72],[36,74],[37,75],[38,76],[39,58],[40,34],[41,126],[43,124],[44,90],[45,88],[46,67],[47,86],[48,66],[49,78],[50,77],[51,60],[52,62],[53,63],[55,52],[56,53],[57,32],[58,64],[59,50],[60,51],[61,52],[62,53],[63,54],[64,55],[65,56],[66,57],[67,48],[68,49],[69,50],[70,51],[71,180],[72,178],[73,184],[74,54],[75,176],[76,55],[77,179],[78,56],[79,181],[80,177],[81,183],[82,185],[83,182],[84,65],[85,66],[86,62],[87,68],[88,255],[89,70],[90,71],[91,72],[92,73],[93,74],[94,75],[95,76],[96,77],[97,78],[98,79],[99,80],[100,81],[101,82],[102,83],[103,84],[104,85],[105,86],[106,87],[107,88],[108,89],[109,90],[110,65],[111,66],[112,67],[113,68],[114,69],[115,70],[116,71],[117,72],[118,73],[119,74],[120,75],[121,76],[122,77],[123,78],[124,79],[125,80],[126,81],[127,82]
  ]);
  const BROWSER_LAYOUT_TEMPLATE_RU_NORMAL = Object.freeze([
    [0,54],[1,27],[2,49],[3,50],[4,51],[5,52],[6,53],[7,54],[8,55],[9,56],[10,57],[11,48],[12,45],[13,61],[14,8],[15,9],[16,169],[17,230],[18,227],[19,170],[20,165],[21,173],[22,163],[23,232],[24,233],[25,167],[26,229],[27,234],[28,13],[30,228],[31,235],[32,162],[33,160],[34,175],[35,224],[36,174],[37,171],[38,164],[39,166],[40,237],[41,241],[42,45],[43,47],[44,239],[45,231],[46,225],[47,172],[48,168],[49,226],[50,236],[51,161],[52,238],[53,46],[54,45],[55,52],[56,53],[57,32],[58,64],[59,50],[60,51],[61,52],[62,53],[63,54],[64,55],[65,56],[66,57],[67,48],[68,49],[69,50],[70,51],[71,180],[72,178],[73,184],[74,54],[75,176],[76,55],[77,179],[78,56],[79,181],[80,177],[81,183],[82,185],[83,182],[84,65],[85,66],[86,60],[87,68],[88,255],[89,70],[90,71],[91,72],[92,73],[93,74],[94,75],[95,76],[96,77],[97,78],[98,79],[99,80],[100,81],[101,82],[102,83],[103,84],[104,85],[105,86],[106,87],[107,88],[108,89],[109,90],[110,65],[111,66],[112,67],[113,68],[114,69],[115,70],[116,71],[117,72],[118,73],[119,74],[120,75],[121,76],[122,77],[123,78],[124,79],[125,80],[126,81],[127,82]
  ]);
  const BROWSER_LAYOUT_TEMPLATE_RU_SHIFT = Object.freeze([
    [0,54],[1,27],[2,33],[3,34],[4,78],[5,59],[6,37],[7,58],[8,63],[9,42],[10,40],[11,41],[12,95],[13,43],[14,8],[16,137],[17,150],[18,147],[19,138],[20,133],[21,141],[22,131],[23,152],[24,153],[25,135],[26,149],[27,154],[28,13],[30,148],[31,155],[32,130],[33,128],[34,143],[35,144],[36,142],[37,139],[38,132],[39,134],[40,157],[41,240],[42,45],[43,92],[44,159],[45,151],[46,145],[47,140],[48,136],[49,146],[50,156],[51,129],[52,158],[53,44],[54,45],[55,52],[56,53],[57,32],[58,64],[59,50],[60,51],[61,52],[62,53],[63,54],[64,55],[65,56],[66,57],[67,48],[68,49],[69,50],[70,51],[71,180],[72,178],[73,184],[74,54],[75,176],[76,55],[77,179],[78,56],[79,181],[80,177],[81,183],[82,185],[83,182],[84,65],[85,66],[86,62],[87,68],[88,255],[89,70],[90,71],[91,72],[92,73],[93,74],[94,75],[95,76],[96,77],[97,78],[98,79],[99,80],[100,81],[101,82],[102,83],[103,84],[104,85],[105,86],[106,87],[107,88],[108,89],[109,90],[110,65],[111,66],[112,67],[113,68],[114,69],[115,70],[116,71],[117,72],[118,73],[119,74],[120,75],[121,76],[122,77],[123,78],[124,79],[125,80],[126,81],[127,82]
  ]);

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

  function inferKeyboardLanguageIdFromText(text) {
    const value = typeof text === "string" ? text : "";
    if (!value) {
      return 0;
    }
    if (UKRAINIAN_RE.test(value)) {
      return KEYBOARD_LANGUAGE_IDS.UA;
    }
    if (BELARUSIAN_RE.test(value)) {
      return KEYBOARD_LANGUAGE_IDS.BE;
    }
    if (CYRILLIC_RE.test(value)) {
      return KEYBOARD_LANGUAGE_IDS.RU;
    }
    if (LATIN_RE.test(value)) {
      return KEYBOARD_LANGUAGE_IDS.EN;
    }
    return 0;
  }

  function inferKeyboardLanguageIdFromLayoutMap(layoutMap) {
    if (!layoutMap || typeof layoutMap.get !== "function") {
      return 0;
    }
    let detectedCyrillic = 0;
    let detectedLatin = 0;
    let detectedUa = 0;
    let detectedBe = 0;
    for (let i = 0; i < KEYBOARD_LAYOUT_SAMPLE_CODES.length; i += 1) {
      const text = layoutMap.get(KEYBOARD_LAYOUT_SAMPLE_CODES[i]);
      const languageId = inferKeyboardLanguageIdFromText(text);
      if (languageId === KEYBOARD_LANGUAGE_IDS.UA) {
        detectedUa += 1;
        continue;
      }
      if (languageId === KEYBOARD_LANGUAGE_IDS.BE) {
        detectedBe += 1;
        continue;
      }
      if (languageId === KEYBOARD_LANGUAGE_IDS.RU) {
        detectedCyrillic += 1;
        continue;
      }
      if (languageId === KEYBOARD_LANGUAGE_IDS.EN) {
        detectedLatin += 1;
      }
    }
    if (detectedUa > 0) {
      return KEYBOARD_LANGUAGE_IDS.UA;
    }
    if (detectedBe > 0) {
      return KEYBOARD_LANGUAGE_IDS.BE;
    }
    if (detectedCyrillic > 0) {
      return KEYBOARD_LANGUAGE_IDS.RU;
    }
    const lowerQ = String(layoutMap.get("KeyQ") || "").toLowerCase();
    const lowerA = String(layoutMap.get("KeyA") || "").toLowerCase();
    const lowerY = String(layoutMap.get("KeyY") || "").toLowerCase();
    const lowerZ = String(layoutMap.get("KeyZ") || "").toLowerCase();
    if (lowerQ === "a" && lowerA === "q") {
      return KEYBOARD_LANGUAGE_IDS.FR;
    }
    if (lowerY === "z" && lowerZ === "y") {
      return KEYBOARD_LANGUAGE_IDS.GE;
    }
    if (detectedLatin > 0) {
      return KEYBOARD_LANGUAGE_IDS.EN;
    }
    return 0;
  }

  function makeKeyboardLayoutFromPairs(pairs) {
    const layout = new Uint8Array(128);
    const source = Array.isArray(pairs) ? pairs : [];
    for (let i = 0; i < source.length; i += 1) {
      const item = source[i];
      if (!item || item.length < 2) {
        continue;
      }
      layout[item[0] & 0x7f] = item[1] & 0xff;
    }
    return layout;
  }

  function cloneKeyboardLayout(layout) {
    return layout instanceof Uint8Array ? layout.slice(0, 128) : new Uint8Array(128);
  }

  function getKeyboardLayoutTemplatesForLanguage(languageId) {
    switch (languageId | 0) {
      case KEYBOARD_LANGUAGE_IDS.RU:
        return {
          normal: makeKeyboardLayoutFromPairs(BROWSER_LAYOUT_TEMPLATE_RU_NORMAL),
          shift: makeKeyboardLayoutFromPairs(BROWSER_LAYOUT_TEMPLATE_RU_SHIFT),
          alt: new Uint8Array(128)
        };
      default:
        return {
          normal: makeKeyboardLayoutFromPairs(BROWSER_LAYOUT_TEMPLATE_EN_NORMAL),
          shift: makeKeyboardLayoutFromPairs(BROWSER_LAYOUT_TEMPLATE_EN_SHIFT),
          alt: new Uint8Array(128)
        };
    }
  }

  function getKeyboardLayoutEntryFromCode(code) {
    const entry = KEYBOARD_SCANCODES[String(code || "")] || null;
    if (!entry) {
      return null;
    }
    if (entry.extended || (entry.scanCode & 0xff) >= 0x80) {
      return null;
    }
    return entry;
  }

  function setKeyboardLayoutEntry(layout, scanCode, value) {
    if (!(layout instanceof Uint8Array)) {
      return false;
    }
    const index = scanCode & 0x7f;
    const next = value & 0xff;
    if ((layout[index] & 0xff) === next) {
      return false;
    }
    layout[index] = next;
    return true;
  }

  function buildKeyboardLayoutsFromLayoutMap(layoutMap, languageId) {
    const templates = getKeyboardLayoutTemplatesForLanguage(languageId);
    const normal = cloneKeyboardLayout(templates.normal);
    const shift = cloneKeyboardLayout(templates.shift);
    const alt = cloneKeyboardLayout(templates.alt);
    if (!layoutMap || typeof layoutMap.get !== "function") {
      return { normal, shift, alt };
    }
    for (const code of Object.keys(KEYBOARD_SCANCODES)) {
      const entry = getKeyboardLayoutEntryFromCode(code);
      if (!entry) {
        continue;
      }
      const key = layoutMap.get(code);
      const normalByte = getCp866ByteFromKey(key);
      if (normalByte) {
        setKeyboardLayoutEntry(normal, entry.scanCode, normalByte);
        const upperByte = getCp866ByteFromKey(String(key).toUpperCase());
        const lowerByte = getCp866ByteFromKey(String(key).toLowerCase());
        if (upperByte && upperByte !== normalByte) {
          setKeyboardLayoutEntry(shift, entry.scanCode, upperByte);
        } else if (lowerByte && lowerByte !== normalByte) {
          setKeyboardLayoutEntry(shift, entry.scanCode, normalByte);
          setKeyboardLayoutEntry(normal, entry.scanCode, lowerByte);
        }
      }
    }
    return { normal, shift, alt };
  }

  class App {
    start() {
      this.bindDom();
      this.pageConfig = window.KosEmuPageConfig || null;
      this.logLines = [];
      this.currentImage = null;
      this.currentFileBuffer = null;
      this.currentFileName = "";
      this.cpuBackendStorageKey = "kosemu.cpuBackendMode";
      this.cpuBackendMode = this.resolveInitialCpuBackendMode();
      if (this.cpuBackendSelect) {
        this.cpuBackendSelect.value = this.cpuBackendMode;
      }
      this.workspaceDragDepth = 0;
      this.browserFsRoot = null;
      this.fsRootBusy = false;
      this.savedFsRootLabel = "";
      this.savedFsRootPendingPermission = false;
      this.launcherOverlayHoldMs = 550;
      this.launcherOverlayVisibleMs = 4000;
      this.launcherOverlayMoveTolerance = 12;
      this.launcherOverlayEdgeRevealPx = 18;
      this.launcherOverlayHideTimer = 0;
      this.launcherOverlayPressTimer = 0;
      this.launcherOverlayPointerActive = false;
      this.launcherOverlayPointerId = -1;
      this.launcherOverlayStartX = 0;
      this.launcherOverlayStartY = 0;
      this.browserKeyboardLanguageRefreshTimer = 0;
      this.browserKeyboardLanguageRefreshToken = 0;
      this.boundFullscreenChange = () => this.handleFullscreenChange();
      this.boundFullscreenError = () => this.handleFullscreenError();
      this.boundWindowFocus = () => this.scheduleBrowserKeyboardLanguageRefresh(0);
      this.boundVisibilityChange = () => {
        if (!document.hidden) {
          this.scheduleBrowserKeyboardLanguageRefresh(0);
        }
      };
      this.sessionManager = new KosEmu.ui.SessionManager(this, this.workspaceEl);

      if (this.fileInput) {
        this.fileInput.addEventListener("change", () => this.handleFile());
      }
      if (this.runBtn) {
        this.runBtn.addEventListener("click", () => this.handleRun());
      }
      if (this.stopBtn) {
        this.stopBtn.addEventListener("click", () => this.handleStop());
      }
      if (this.fullscreenBtn) {
        this.fullscreenBtn.addEventListener("click", () => {
          void this.handleFullscreenToggle();
        });
      }
      if (this.restoreDefaultsBtn) {
        this.restoreDefaultsBtn.addEventListener("click", () => {
          void this.handleRestoreBundledDefaults();
        });
      }
      if (this.mountFolderBtn) {
        this.mountFolderBtn.addEventListener("click", () => {
          void this.handleMountFolder();
        });
      }
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
      if (this.cpuBackendSelect) {
        this.cpuBackendSelect.addEventListener("change", () => this.applyCpuBackendConfig());
      }
      this.installWorkspaceDropHandlers();
      this.installLauncherOverlayControls();
      document.addEventListener("fullscreenchange", this.boundFullscreenChange);
      document.addEventListener("fullscreenerror", this.boundFullscreenError);
      document.addEventListener("webkitfullscreenchange", this.boundFullscreenChange);
      document.addEventListener("webkitfullscreenerror", this.boundFullscreenError);
      window.addEventListener("focus", this.boundWindowFocus);
      document.addEventListener("visibilitychange", this.boundVisibilityChange);

      window.addEventListener("beforeunload", () => {
        this.clearBrowserKeyboardLanguageRefreshTimer();
        this.flushMountedRoot();
        if (this.sessionManager) {
          this.sessionManager.stopAllProcesses("stopped");
        }
      });

      if (this.infoEl) {
        this.infoEl.textContent = "No image loaded.";
      }
      if (this.logEl) {
        this.logEl.textContent = "Ready.";
      }
      this.updateFsRootStatus();
      this.updateCpuBackendControl();
      this.applyCpuBackendConfig({ silent: true });
      this.updateFullscreenButton();
      this.updateSessionState();
      this.setStatus("Session ready");
      this.restorePersistedRootFolder();
      this.scheduleBrowserKeyboardLanguageRefresh(0);
    }

    bindDom() {
      this.appRootEl = document.getElementById("app");
      this.fileInput = document.getElementById("fileInput");
      this.runBtn = document.getElementById("runBtn");
      this.stopBtn = document.getElementById("stopBtn");
      this.pickRootBtn = document.getElementById("pickRootBtn");
      this.clearRootBtn = document.getElementById("clearRootBtn");
      this.fullscreenBtn = document.getElementById("fullscreenBtn");
      this.restoreDefaultsBtn = document.getElementById("restoreDefaultsBtn");
      this.mountFolderBtn = document.getElementById("mountFolderBtn");
      this.cpuBackendSelect = document.getElementById("cpuBackendSelect");
      this.traceSyscallsInput = document.getElementById("traceSyscalls");
      this.traceOpcodesInput = document.getElementById("traceOpcodes");
      this.traceImagesInput = document.getElementById("traceImages");
      this.infoEl = document.getElementById("info");
      this.logEl = document.getElementById("log");
      this.statusEl = document.getElementById("status");
      this.fsRootStatusEl = document.getElementById("fsRootStatus");
      this.screenPanelEl = document.getElementById("screenPanel");
      this.workspaceEl = document.getElementById("workspace");
      this.workspaceEmptyEl = document.getElementById("workspaceEmpty");
      this.sessionInfoEl = document.getElementById("sessionInfo");
    }

    isLauncherPage() {
      return !!(document.body && document.body.classList.contains("launcher-page"));
    }

    getFullscreenTarget() {
      if (
        this.screenPanelEl &&
        this.workspaceEl &&
        this.screenPanelEl.contains(this.workspaceEl)
      ) {
        return this.screenPanelEl;
      }
      return this.workspaceEl || null;
    }

    supportsFullscreen() {
      const target = this.getFullscreenTarget();
      const doc = document;
      return !!(
        target &&
        (
          typeof target.requestFullscreen === "function" ||
          typeof target.webkitRequestFullscreen === "function"
        ) &&
        (
          typeof doc.exitFullscreen === "function" ||
          typeof doc.webkitExitFullscreen === "function"
        )
      );
    }

    getFullscreenElement() {
      return document.fullscreenElement || document.webkitFullscreenElement || null;
    }

    isWorkspaceFullscreen() {
      const target = this.getFullscreenTarget();
      return !!target && this.getFullscreenElement() === target;
    }

    async requestWorkspaceFullscreen() {
      const target = this.getFullscreenTarget();
      if (!target) {
        return;
      }
      if (typeof target.requestFullscreen === "function") {
        await target.requestFullscreen();
        return;
      }
      if (typeof target.webkitRequestFullscreen === "function") {
        target.webkitRequestFullscreen();
      }
    }

    async exitWorkspaceFullscreen() {
      if (typeof document.exitFullscreen === "function") {
        await document.exitFullscreen();
        return;
      }
      if (typeof document.webkitExitFullscreen === "function") {
        document.webkitExitFullscreen();
      }
    }

    updateFullscreenButton() {
      if (!this.fullscreenBtn) {
        return;
      }
      const supported = this.supportsFullscreen();
      const active = this.isWorkspaceFullscreen();
      this.fullscreenBtn.disabled = !supported;
      this.fullscreenBtn.textContent = active ? "Windowed" : "Fullscreen";
      this.fullscreenBtn.setAttribute("aria-pressed", active ? "true" : "false");
      this.fullscreenBtn.title = active
        ? "Exit desktop fullscreen"
        : "Open desktop fullscreen";
    }

    handleFullscreenError() {
      this.updateFullscreenButton();
      this.log("Fullscreen toggle failed.");
    }

    refreshSessionViewport() {
      if (!this.sessionManager || typeof this.sessionManager.handleViewportResize !== "function") {
        return;
      }
      const refresh = () => {
        if (this.sessionManager && typeof this.sessionManager.handleViewportResize === "function") {
          this.sessionManager.handleViewportResize();
        }
      };
      refresh();
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => {
          refresh();
          requestAnimationFrame(() => {
            refresh();
          });
        });
      }
    }

    handleFullscreenChange() {
      this.updateFullscreenButton();
      this.refreshSessionViewport();
    }

    clearBrowserKeyboardLanguageRefreshTimer() {
      if (this.browserKeyboardLanguageRefreshTimer) {
        clearTimeout(this.browserKeyboardLanguageRefreshTimer);
        this.browserKeyboardLanguageRefreshTimer = 0;
      }
    }

    applyBrowserKeyboardLanguageId(languageId) {
      if (!this.sessionManager || typeof this.sessionManager.setKeyboardLanguageId !== "function") {
        return false;
      }
      const next = Math.max(0, languageId | 0) >>> 0;
      if (!next) {
        return false;
      }
      return !!this.sessionManager.setKeyboardLanguageId(next);
    }

    applyBrowserKeyboardLayouts(layouts) {
      if (!this.sessionManager || typeof this.sessionManager.setKeyboardLayout !== "function" || !layouts) {
        return false;
      }
      let changed = false;
      if (layouts.normal instanceof Uint8Array) {
        changed = this.sessionManager.setKeyboardLayout(1, layouts.normal) || changed;
      }
      if (layouts.shift instanceof Uint8Array) {
        changed = this.sessionManager.setKeyboardLayout(2, layouts.shift) || changed;
      }
      if (layouts.alt instanceof Uint8Array) {
        changed = this.sessionManager.setKeyboardLayout(3, layouts.alt) || changed;
      }
      return changed;
    }

    updateBrowserKeyboardLayoutEntry(event) {
      if (!this.sessionManager || typeof this.sessionManager.getKeyboardLayout !== "function" || typeof this.sessionManager.setKeyboardLayout !== "function") {
        return false;
      }
      const entry = getKeyboardLayoutEntryFromCode(event && event.code);
      if (!entry) {
        return false;
      }
      const keyText = event && typeof event.key === "string" ? event.key : "";
      const byte = getCp866ByteFromKey(keyText);
      if (!byte) {
        return false;
      }
      const scanCode = entry.scanCode & 0x7f;
      const shiftPressed = !!(event && event.shiftKey);
      const kind = shiftPressed ? 2 : 1;
      const current = cloneKeyboardLayout(this.sessionManager.getKeyboardLayout(kind));
      let changed = setKeyboardLayoutEntry(current, scanCode, byte);
      if (changed) {
        this.sessionManager.setKeyboardLayout(kind, current);
      }
      const oppositeText = shiftPressed ? String(keyText).toLowerCase() : String(keyText).toUpperCase();
      const oppositeByte = getCp866ByteFromKey(oppositeText);
      if (oppositeByte && oppositeByte !== byte) {
        const oppositeKind = shiftPressed ? 1 : 2;
        const opposite = cloneKeyboardLayout(this.sessionManager.getKeyboardLayout(oppositeKind));
        if (setKeyboardLayoutEntry(opposite, scanCode, oppositeByte)) {
          this.sessionManager.setKeyboardLayout(oppositeKind, opposite);
          changed = true;
        }
      }
      return changed;
    }

    async refreshBrowserKeyboardLanguage() {
      const keyboardApi = typeof navigator !== "undefined" && navigator ? navigator.keyboard : null;
      if (!keyboardApi || typeof keyboardApi.getLayoutMap !== "function") {
        return 0;
      }
      const refreshToken = ((this.browserKeyboardLanguageRefreshToken | 0) + 1) | 0;
      this.browserKeyboardLanguageRefreshToken = refreshToken;
      let layoutMap = null;
      try {
        layoutMap = await keyboardApi.getLayoutMap();
      } catch (err) {
        return 0;
      }
      if ((this.browserKeyboardLanguageRefreshToken | 0) !== refreshToken) {
        return 0;
      }
      const languageId = inferKeyboardLanguageIdFromLayoutMap(layoutMap);
      if (languageId) {
        this.applyBrowserKeyboardLanguageId(languageId);
        this.applyBrowserKeyboardLayouts(buildKeyboardLayoutsFromLayoutMap(layoutMap, languageId));
      }
      return languageId | 0;
    }

    scheduleBrowserKeyboardLanguageRefresh(delayMs) {
      const delay = Math.max(0, delayMs | 0);
      this.clearBrowserKeyboardLanguageRefreshTimer();
      this.browserKeyboardLanguageRefreshTimer = setTimeout(() => {
        this.browserKeyboardLanguageRefreshTimer = 0;
        void this.refreshBrowserKeyboardLanguage();
      }, delay);
    }

    handleBrowserKeyboardSyncEvent(event) {
      const languageId = inferKeyboardLanguageIdFromText(event && typeof event.key === "string" ? event.key : "");
      if (languageId) {
        this.applyBrowserKeyboardLanguageId(languageId);
      }
      this.updateBrowserKeyboardLayoutEntry(event);
      const code = event && typeof event.code === "string" ? event.code : "";
      const mightChangeLayout =
        code === "AltLeft" ||
        code === "AltRight" ||
        code === "ShiftLeft" ||
        code === "ShiftRight" ||
        code === "MetaLeft" ||
        code === "MetaRight" ||
        code === "Space" ||
        (!!event && (event.altKey || event.ctrlKey || event.metaKey));
      if (mightChangeLayout) {
        this.scheduleBrowserKeyboardLanguageRefresh(40);
      }
    }

    normalizeLauncherOverlayDelay(value, fallback, min, max) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return fallback;
      }
      return Math.max(min, Math.min(max, Math.round(numeric))) | 0;
    }

    setLauncherOverlaysVisible(visible) {
      if (!this.isLauncherPage() || !document.body) {
        return;
      }
      document.body.classList.toggle("launcher-overlays-visible", !!visible);
    }

    clearLauncherOverlayHideTimer() {
      if (this.launcherOverlayHideTimer) {
        clearTimeout(this.launcherOverlayHideTimer);
        this.launcherOverlayHideTimer = 0;
      }
    }

    hideLauncherOverlays() {
      this.clearLauncherOverlayHideTimer();
      this.setLauncherOverlaysVisible(false);
    }

    showLauncherOverlays(durationMs) {
      if (!this.isLauncherPage()) {
        return;
      }
      const visibleMs = this.normalizeLauncherOverlayDelay(
        durationMs,
        this.launcherOverlayVisibleMs,
        250,
        10000
      );
      this.setLauncherOverlaysVisible(true);
      this.clearLauncherOverlayHideTimer();
      this.launcherOverlayHideTimer = setTimeout(() => {
        this.launcherOverlayHideTimer = 0;
        this.setLauncherOverlaysVisible(false);
      }, visibleMs);
    }

    clearLauncherOverlayPressTimer() {
      if (this.launcherOverlayPressTimer) {
        clearTimeout(this.launcherOverlayPressTimer);
        this.launcherOverlayPressTimer = 0;
      }
    }

    cancelLauncherOverlayPress() {
      this.clearLauncherOverlayPressTimer();
      this.launcherOverlayPointerActive = false;
      this.launcherOverlayPointerId = -1;
    }

    beginLauncherOverlayPress(pointerId, clientX, clientY) {
      this.cancelLauncherOverlayPress();
      this.launcherOverlayPointerActive = true;
      this.launcherOverlayPointerId = pointerId | 0;
      this.launcherOverlayStartX = clientX | 0;
      this.launcherOverlayStartY = clientY | 0;
      this.launcherOverlayPressTimer = setTimeout(() => {
        this.launcherOverlayPressTimer = 0;
        if (!this.launcherOverlayPointerActive) {
          return;
        }
        this.showLauncherOverlays(this.launcherOverlayVisibleMs);
      }, this.launcherOverlayHoldMs);
    }

    handleLauncherOverlayPointerDown(event) {
      if (!this.isLauncherPage() || !this.workspaceEl || !event || event.isPrimary === false) {
        return;
      }
      const pointerType = String(event.pointerType || "");
      if (pointerType !== "mouse") {
        return;
      }
      if ((event.button | 0) !== 0) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (target && (target.closest(".launcher-toolbar") || target.closest(".launcher-session-info"))) {
        return;
      }
      this.beginLauncherOverlayPress(event.pointerId | 0, event.clientX | 0, event.clientY | 0);
    }

    handleLauncherOverlayPointerMove(event) {
      if (
        this.isLauncherPage() &&
        event &&
        event.isPrimary !== false &&
        (event.pointerType || "") === "mouse" &&
        ((event.buttons | 0) === 0)
      ) {
        const edge = this.launcherOverlayEdgeRevealPx | 0;
        const clientY = event.clientY | 0;
        const viewportHeight = Math.max(1, window.innerHeight | 0);
        if (clientY <= edge || clientY >= (viewportHeight - edge)) {
          this.showLauncherOverlays(this.launcherOverlayVisibleMs);
        }
      }
      if (!this.launcherOverlayPointerActive || !event || event.isPrimary === false) {
        return;
      }
      if ((event.pointerId | 0) !== (this.launcherOverlayPointerId | 0)) {
        return;
      }
      const dx = Math.abs((event.clientX | 0) - (this.launcherOverlayStartX | 0));
      const dy = Math.abs((event.clientY | 0) - (this.launcherOverlayStartY | 0));
      if (dx > (this.launcherOverlayMoveTolerance | 0) || dy > (this.launcherOverlayMoveTolerance | 0)) {
        this.cancelLauncherOverlayPress();
      }
    }

    handleLauncherOverlayPointerUp(event) {
      if (!this.launcherOverlayPointerActive || !event || event.isPrimary === false) {
        return;
      }
      if ((event.pointerId | 0) !== (this.launcherOverlayPointerId | 0)) {
        return;
      }
      this.cancelLauncherOverlayPress();
    }

    installLauncherOverlayControls() {
      if (!this.isLauncherPage() || !this.workspaceEl || typeof window === "undefined") {
        return;
      }
      const pageConfig = window.KosEmuPageConfig || {};
      this.launcherOverlayHoldMs = this.normalizeLauncherOverlayDelay(
        pageConfig.launcherOverlayHoldMs,
        this.launcherOverlayHoldMs,
        250,
        3000
      );
      this.launcherOverlayVisibleMs = this.normalizeLauncherOverlayDelay(
        pageConfig.launcherOverlayVisibleMs,
        this.launcherOverlayVisibleMs,
        1000,
        10000
      );
      this.launcherOverlayMoveTolerance = this.normalizeLauncherOverlayDelay(
        pageConfig.launcherOverlayMoveTolerance,
        this.launcherOverlayMoveTolerance,
        4,
        64
      );
      this.launcherOverlayEdgeRevealPx = this.normalizeLauncherOverlayDelay(
        pageConfig.launcherOverlayEdgeRevealPx,
        this.launcherOverlayEdgeRevealPx,
        8,
        64
      );
      this.boundLauncherOverlayPointerDown = (event) => this.handleLauncherOverlayPointerDown(event);
      this.boundLauncherOverlayPointerMove = (event) => this.handleLauncherOverlayPointerMove(event);
      this.boundLauncherOverlayPointerUp = (event) => this.handleLauncherOverlayPointerUp(event);
      this.boundLauncherOverlayWindowBlur = () => this.cancelLauncherOverlayPress();
      this.workspaceEl.addEventListener("pointerdown", this.boundLauncherOverlayPointerDown, true);
      window.addEventListener("pointermove", this.boundLauncherOverlayPointerMove, true);
      window.addEventListener("pointerup", this.boundLauncherOverlayPointerUp, true);
      window.addEventListener("pointercancel", this.boundLauncherOverlayPointerUp, true);
      window.addEventListener("blur", this.boundLauncherOverlayWindowBlur);
      this.setLauncherOverlaysVisible(false);
    }

    describeSystemAction(action) {
      switch (action >>> 0) {
        case 2:
          return "Shutdown";
        case 3:
          return "Reboot";
        case 4:
          return "Restart kernel";
        default:
          return "System action";
      }
    }

    async rebootCurrentSession() {
      if (!this.sessionManager) {
        return false;
      }
      const root = this.browserFsRoot || null;
      if (root && typeof root.flushPending === "function") {
        await root.flushPending();
      }
      this.sessionManager.resetSystemState({ reloadStyleFromFileSystem: true });
      const pageConfig = window.KosEmuPageConfig || null;
      if (pageConfig && pageConfig.autoBootBundledDesktop) {
        const bundledRoot = KosEmu && KosEmu.ui ? KosEmu.ui.bundledRoot : null;
        if (bundledRoot && typeof bundledRoot.bootBundledDesktopPage === "function") {
          await bundledRoot.bootBundledDesktopPage(this, pageConfig);
          return true;
        }
      }
      if (this.currentImage) {
        this.launchCurrentImage();
        return true;
      }
      return false;
    }

    async handleSystemAction(action) {
      const mode = action >>> 0;
      if (mode !== 2 && mode !== 3 && mode !== 4) {
        return false;
      }
      const label = this.describeSystemAction(mode);
      this.log(`${label} requested by guest.`);
      const preserveFullscreen = mode !== 2 && this.isWorkspaceFullscreen();
      let fullscreenPromise = null;
      if (!preserveFullscreen && this.isWorkspaceFullscreen()) {
        fullscreenPromise = this.exitWorkspaceFullscreen();
      }
      if (this.sessionManager) {
        this.sessionManager.stopAllProcesses("stopped");
      }
      let fullscreenError = "";
      if (fullscreenPromise) {
        try {
          await fullscreenPromise;
        } catch (err) {
          fullscreenError = err instanceof Error ? err.message : String(err);
          this.log(`Fullscreen exit failed during ${label.toLowerCase()}: ${fullscreenError}`);
        }
      }
      let restartError = "";
      if (mode !== 2) {
        try {
          await this.rebootCurrentSession();
          if (preserveFullscreen) {
            this.refreshSessionViewport();
          }
        } catch (err) {
          restartError = err instanceof Error ? err.message : String(err);
          this.log(`${label} failed: ${restartError}`);
        }
      }
      this.updateFullscreenButton();
      this.updateSessionState();
      if (fullscreenError || restartError) {
        this.setStatus(`${label} requested`);
      }
      return true;
    }

    async handleFullscreenToggle() {
      if (!this.supportsFullscreen()) {
        this.log("Fullscreen API unavailable in this browser.");
        this.updateFullscreenButton();
        return;
      }
      try {
        if (this.isWorkspaceFullscreen()) {
          await this.exitWorkspaceFullscreen();
        } else {
          await this.requestWorkspaceFullscreen();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.log(`Fullscreen failed: ${message}`);
      } finally {
        this.updateFullscreenButton();
      }
    }

    installWorkspaceDropHandlers() {
      if (!this.workspaceEl) {
        return;
      }
      this.workspaceEl.addEventListener("dragenter", (event) => this.handleWorkspaceDragEnter(event));
      this.workspaceEl.addEventListener("dragover", (event) => this.handleWorkspaceDragOver(event));
      this.workspaceEl.addEventListener("dragleave", (event) => this.handleWorkspaceDragLeave(event));
      this.workspaceEl.addEventListener("drop", (event) => {
        void this.handleWorkspaceDrop(event);
      });
      this.installLauncherDropFallbackHandlers();
    }

    isWorkspaceDropTargetEvent(event) {
      const target = event && event.target instanceof Node ? event.target : null;
      return !!(target && this.workspaceEl && this.workspaceEl.contains(target));
    }

    installLauncherDropFallbackHandlers() {
      if (
        !this.isLauncherPage() ||
        !this.appRootEl ||
        !this.workspaceEl ||
        this.appRootEl === this.workspaceEl
      ) {
        return;
      }
      this.appRootEl.addEventListener("dragenter", (event) => {
        if (event.defaultPrevented || this.isWorkspaceDropTargetEvent(event)) {
          return;
        }
        this.handleWorkspaceDragEnter(event);
      });
      this.appRootEl.addEventListener("dragover", (event) => {
        if (event.defaultPrevented || this.isWorkspaceDropTargetEvent(event)) {
          return;
        }
        this.handleWorkspaceDragOver(event);
      });
      this.appRootEl.addEventListener("dragleave", (event) => {
        if (event.defaultPrevented || this.isWorkspaceDropTargetEvent(event)) {
          return;
        }
        this.handleWorkspaceDragLeave(event);
      });
      this.appRootEl.addEventListener("drop", (event) => {
        if (event.defaultPrevented || this.isWorkspaceDropTargetEvent(event)) {
          return;
        }
        void this.handleWorkspaceDrop(event);
      });
    }

    hasDroppedFiles(event) {
      const transfer = event && event.dataTransfer ? event.dataTransfer : null;
      if (!transfer) {
        return false;
      }
      if (transfer.items && transfer.items.length) {
        for (let i = 0; i < transfer.items.length; i += 1) {
          if (transfer.items[i] && transfer.items[i].kind === "file") {
            return true;
          }
        }
        return false;
      }
      return !!(transfer.files && transfer.files.length);
    }

    getFirstDroppedFile(event) {
      const transfer = event && event.dataTransfer ? event.dataTransfer : null;
      if (!transfer) {
        return null;
      }
      if (transfer.items && transfer.items.length) {
        for (let i = 0; i < transfer.items.length; i += 1) {
          const item = transfer.items[i];
          if (!item || item.kind !== "file" || typeof item.getAsFile !== "function") {
            continue;
          }
          const file = item.getAsFile();
          if (file) {
            return file;
          }
        }
      }
      return transfer.files && transfer.files.length ? transfer.files[0] : null;
    }

    updateWorkspaceDropState(active) {
      if (this.workspaceEl) {
        this.workspaceEl.classList.toggle("workspace-drop-target", !!active);
      }
    }

    resetWorkspaceDropState() {
      this.workspaceDragDepth = 0;
      this.updateWorkspaceDropState(false);
    }

    handleWorkspaceDragEnter(event) {
      if (!this.hasDroppedFiles(event)) {
        return;
      }
      event.preventDefault();
      this.workspaceDragDepth = (this.workspaceDragDepth + 1) | 0;
      this.updateWorkspaceDropState(true);
    }

    handleWorkspaceDragOver(event) {
      if (!this.hasDroppedFiles(event)) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
      this.updateWorkspaceDropState(true);
    }

    handleWorkspaceDragLeave(event) {
      if (!this.hasDroppedFiles(event)) {
        return;
      }
      event.preventDefault();
      this.workspaceDragDepth = Math.max(0, (this.workspaceDragDepth - 1) | 0);
      if (!this.workspaceDragDepth) {
        this.updateWorkspaceDropState(false);
      }
    }

    async handleWorkspaceDrop(event) {
      if (!this.hasDroppedFiles(event)) {
        return;
      }
      event.preventDefault();
      this.resetWorkspaceDropState();
      const file = this.getFirstDroppedFile(event);
      if (!file) {
        return;
      }
      if (this.runBtn) {
        this.runBtn.disabled = true;
      }
      this.setStatus(`Loading ${file.name}`);
      try {
        const buffer = await file.arrayBuffer();
        this.loadImageFromBuffer(file.name || "image.kex", buffer, "Dropped");
        this.launchCurrentImage();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.log(`Drop failed: ${message}`);
        this.setStatus("Drop failed");
      } finally {
        if (this.runBtn) {
          this.runBtn.disabled = this.currentImage === null;
        }
      }
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

    normalizeCpuBackendMode(mode) {
      const EmulatorClass = KosEmu.emu && KosEmu.emu.Emulator ? KosEmu.emu.Emulator : null;
      if (EmulatorClass && typeof EmulatorClass.normalizeCpuBackendMode === "function") {
        return EmulatorClass.normalizeCpuBackendMode(mode);
      }
      const normalized = String(mode || "").trim().toLowerCase();
      if (normalized === "wasm") {
        return "wasm";
      }
      if (normalized === "auto") {
        return "auto";
      }
      return "js";
    }

    resolveInitialCpuBackendMode() {
      const persisted = this.loadPersistedCpuBackendMode();
      if (persisted) {
        return persisted;
      }
      return this.normalizeCpuBackendMode(this.pageConfig && this.pageConfig.cpuBackend);
    }

    loadPersistedCpuBackendMode() {
      if (typeof localStorage === "undefined") {
        return "";
      }
      try {
        const raw = localStorage.getItem(this.cpuBackendStorageKey || "kosemu.cpuBackendMode");
        if (!raw) {
          return "";
        }
        return this.normalizeCpuBackendMode(raw);
      } catch (_err) {
        return "";
      }
    }

    persistCpuBackendMode(mode) {
      if (typeof localStorage === "undefined") {
        return;
      }
      try {
        localStorage.setItem(this.cpuBackendStorageKey || "kosemu.cpuBackendMode", this.normalizeCpuBackendMode(mode));
      } catch (_err) {
        // Ignore storage failures; runtime selection still applies for this session.
      }
    }

    getCpuBackendAvailability() {
      const EmulatorClass = KosEmu.emu && KosEmu.emu.Emulator ? KosEmu.emu.Emulator : null;
      if (EmulatorClass && typeof EmulatorClass.getCpuBackendAvailability === "function") {
        return EmulatorClass.getCpuBackendAvailability();
      }
      return { js: true, wasm: false };
    }

    currentCpuBackendConfig() {
      const raw = this.cpuBackendSelect ? this.cpuBackendSelect.value : this.cpuBackendMode;
      const next = this.normalizeCpuBackendMode(raw);
      this.cpuBackendMode = next;
      return next;
    }

    updateCpuBackendControl() {
      if (!this.cpuBackendSelect) {
        return;
      }
      const mode = this.currentCpuBackendConfig();
      if (this.cpuBackendSelect.value !== mode) {
        this.cpuBackendSelect.value = mode;
      }
      const availability = this.getCpuBackendAvailability();
      const wasmOption = this.cpuBackendSelect.querySelector('option[value="wasm"]');
      if (wasmOption) {
        wasmOption.textContent = availability.wasm ? "WASM CPU" : "WASM CPU (not built)";
      }
      this.cpuBackendSelect.title = availability.wasm
        ? "Select the CPU backend for new launches."
        : "WASM CPU backend is not available in this build yet.";
    }

    applyCpuBackendConfig(options) {
      const opts = options || {};
      const nextMode = this.currentCpuBackendConfig();
      if (this.sessionManager && typeof this.sessionManager.setCpuBackendMode === "function") {
        this.sessionManager.setCpuBackendMode(nextMode);
      }
      this.cpuBackendMode = nextMode;
      this.persistCpuBackendMode(nextMode);
      this.updateCpuBackendControl();
      if (!opts.silent) {
        const availability = this.getCpuBackendAvailability();
        this.log(`CPU backend set to ${nextMode}.`);
        if (nextMode === "wasm" && !availability.wasm) {
          this.log("WASM CPU backend is not available in this build. New launches in WASM mode will fail until a WASM core is connected.");
        }
        if (this.sessionManager && typeof this.sessionManager.hasProcesses === "function" && this.sessionManager.hasProcesses()) {
          this.log("Running processes keep their current CPU backend; the new mode applies to future launches.");
        }
      }
      return this.cpuBackendMode;
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

    ensureHdMountableRoot() {
      if (!this.browserFsRoot || typeof wrapWithHdMounts !== "function") {
        return this.browserFsRoot || null;
      }
      const nextRoot = wrapWithHdMounts(this.browserFsRoot, {
        log: (message) => this.log(message)
      });
      if (nextRoot && nextRoot !== this.browserFsRoot) {
        this.browserFsRoot = nextRoot;
      }
      return this.browserFsRoot || null;
    }

    async handleRestoreBundledDefaults() {
      if (!this.isLauncherPage()) {
        return;
      }
      const root = this.browserFsRoot || null;
      if (!root || typeof root.clearPersistence !== "function") {
        this.log("Bundled desktop reset is unavailable.");
        return;
      }
      const confirmed = typeof window.confirm === "function"
        ? window.confirm("Restore bundled desktop files and reload the page?")
        : true;
      if (!confirmed) {
        return;
      }
      this.setStatus("Restoring bundled desktop...");
      try {
        await root.flushPending();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.log(`Bundled desktop flush before reset failed: ${message}`);
      }
      if (!root.clearPersistence()) {
        this.log("Bundled desktop reset failed.");
        this.setStatus("Reset failed");
        return;
      }
      this.log("Bundled desktop restored to defaults.");
      if (typeof window.location.reload === "function") {
        window.location.reload();
      }
    }

    async handleMountFolder() {
      if (!BrowserFsRoot || !BrowserFsRoot.supportsDirectoryPicker || !BrowserFsRoot.supportsDirectoryPicker()) {
        this.log("Browser directory access is unavailable in this browser.");
        return;
      }
      if (!this.browserFsRoot) {
        this.log("No active FS root available for HD mount.");
        return;
      }
      const root = this.ensureHdMountableRoot();
      if (!root || typeof root.mountDirectoryHandle !== "function") {
        this.log("HD mounts are unavailable for the current FS root.");
        return;
      }
      this.fsRootBusy = true;
      this.updateFsRootStatus();
      this.setStatus("Selecting folder to mount...");
      try {
        const handle = await window.showDirectoryPicker({ mode: "readwrite" });
        this.setStatus(`Scanning ${handle.name}...`);
        const mounted = await root.mountDirectoryHandle(handle, {
          log: (msg) => this.log(msg),
          onProgress: (progress) => {
            if (!progress) {
              return;
            }
            this.setStatus(`Scanning ${progress.label}: ${progress.files} files`);
          }
        });
        if (!mounted || !mounted.root || mounted.root.permission !== "granted" || !mounted.diskName) {
          throw new Error("Directory access was not granted.");
        }
        if (typeof mounted.root.verifyWriteAccess === "function") {
          const writeAccess = await mounted.root.verifyWriteAccess();
          if (!writeAccess || !writeAccess.ok) {
            if (typeof root.removeMount === "function") {
              root.removeMount(mounted.diskName);
            }
            throw new Error(
              `Mounted folder is readable, but write access failed: ${writeAccess && writeAccess.message ? writeAccess.message : "Unknown error."}`
            );
          }
        }
        const mountPath = `/${mounted.diskName}/${mounted.volumeName}`;
        this.log(`Mounted browser folder '${mounted.label}' as ${mountPath}`);
        this.setStatus(`Mounted ${mountPath}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message !== "The user aborted a request.") {
          this.log(`Folder mount failed: ${message}`);
          this.setStatus("Mount failed");
          return;
        }
        this.setStatus("Session ready");
      } finally {
        this.fsRootBusy = false;
        this.updateFsRootStatus();
      }
    }

    updateFsRootStatus() {
      const supported = !!(BrowserFsRoot && BrowserFsRoot.supportsDirectoryPicker && BrowserFsRoot.supportsDirectoryPicker());
      if (this.mountFolderBtn) {
        this.mountFolderBtn.disabled = this.fsRootBusy || !supported || !this.browserFsRoot;
      }
      if (this.pickRootBtn) {
        this.pickRootBtn.disabled = this.fsRootBusy || !supported;
      }
      if (this.clearRootBtn) {
        this.clearRootBtn.disabled = this.fsRootBusy || (!this.browserFsRoot && !this.savedFsRootPendingPermission);
      }
      if (this.restoreDefaultsBtn) {
        this.restoreDefaultsBtn.disabled = this.fsRootBusy || !this.isLauncherPage() || !this.browserFsRoot || typeof this.browserFsRoot.clearPersistence !== "function";
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
      const file = this.fileInput && this.fileInput.files && this.fileInput.files[0];
      if (!file) {
        return;
      }
      if (this.runBtn) {
        this.runBtn.disabled = true;
      }
      this.setStatus(`Loading ${file.name}`);
      try {
        const buffer = await file.arrayBuffer();
        this.loadImageFromBuffer(file.name, buffer, "Loaded");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.currentImage = null;
        this.currentFileBuffer = null;
        this.currentFileName = "";
        if (this.infoEl) {
          this.infoEl.textContent = `Error: ${message}`;
        }
        this.log(`Load failed: ${message}`);
        this.setStatus("Load failed");
      }
    }

    loadImageFromBuffer(fileName, buffer, actionLabel) {
      const image = parseKex(buffer, fileName);
      const storedBuffer = buffer.slice(0);
      this.currentImage = image;
      this.currentFileBuffer = storedBuffer;
      this.currentFileName = fileName;
      if (this.infoEl) {
        this.infoEl.textContent = formatKexInfo(image);
      }
      this.log(`${String(actionLabel || "Loaded")} ${fileName}`);
      if (image.packed) {
        this.log(`KPCK unpacked: ${image.fileSize} -> ${image.unpackedSize}`);
      }
      this.setStatus(`${String(actionLabel || "Loaded")} ${fileName}`);
      if (this.runBtn) {
        this.runBtn.disabled = false;
      }
      return image;
    }

    launchCurrentImage() {
      if (!this.currentImage) {
        this.log("No image loaded.");
        return null;
      }
      const process = this.sessionManager.launchImage(this.currentImage, {
        buffer: this.currentFileBuffer,
        fileName: this.currentFileName || this.currentImage.fileName || "image.kex",
        processPath: this.currentImage.fileName || this.currentFileName || "image.kex",
        activate: true
      });
      this.log(`Started ${process.displayPath} as PID ${process.pid} (slot ${process.slot})`);
      this.updateSessionState();
      return process;
    }

    handleRun() {
      if (!this.currentImage) {
        this.log("No image loaded.");
        return;
      }
      if (this.runBtn) {
        this.runBtn.disabled = true;
      }
      try {
        this.launchCurrentImage();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.log(`Start failed: ${message}`);
        this.setStatus("Start failed");
      } finally {
        if (this.runBtn) {
          this.runBtn.disabled = this.currentImage === null;
        }
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
      if (this.stopBtn) {
        this.stopBtn.disabled = !this.sessionManager.hasProcesses();
      }
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

    getFileProviderAsync() {
      if (!this.browserFsRoot || typeof this.browserFsRoot.fileProviderAsync !== "function") {
        return null;
      }
      return (kpath) => this.browserFsRoot.fileProviderAsync(kpath);
    }

    getFileInfoProvider() {
      if (!this.browserFsRoot) {
        return null;
      }
      return (kpath, kind) => this.browserFsRoot.fileInfoProvider(kpath, kind);
    }

    getFileInfoProviderAsync() {
      if (!this.browserFsRoot || typeof this.browserFsRoot.fileInfoProviderAsync !== "function") {
        return null;
      }
      return (kpath, kind) => this.browserFsRoot.fileInfoProviderAsync(kpath, kind);
    }

    getFileMutationProvider() {
      if (!this.browserFsRoot) {
        return null;
      }
      return (op, kpath, options) => this.browserFsRoot.mutationProvider(op, kpath, options);
    }

    getFileMutationProviderAsync() {
      if (!this.browserFsRoot || typeof this.browserFsRoot.mutationProviderAsync !== "function") {
        return null;
      }
      return (op, kpath, options) => this.browserFsRoot.mutationProviderAsync(op, kpath, options);
    }
  }

  KosEmu.ui.keyboard = {
    KEYBOARD_SCANCODES,
    CONTROL_KEY_MASKS,
    KEYBOARD_LANGUAGE_IDS,
    buildKeyboardLayoutsFromLayoutMap,
    getAsciiCodeFromKey,
    inferKeyboardLanguageIdFromLayoutMap,
    inferKeyboardLanguageIdFromText,
    isLockKey,
    isTrackedKeyboardCode,
    translateDomKeyboardEvent,
    updateControlKeyMaskState
  };
  KosEmu.ui.App = App;
})();

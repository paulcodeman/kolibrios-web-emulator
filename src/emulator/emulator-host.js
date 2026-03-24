(() => {
  const KosEmu = globalThis.KosEmu;
  const UTF8_DECODER = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;
  const DEBUG_BOARD_CAPACITY = 512;
  const SPEAKER_TIMER_HZ = 1193180;
  const SPEAKER_NOTE_DIVIDERS = new Uint16Array([
    0x4742, 0x4342, 0x3F7C, 0x3BEC, 0x388F, 0x3562,
    0x3264, 0x2F8F, 0x2CE4, 0x2A5F, 0x2802, 0x25BF
  ]);

  function ensureDebugBoardState(owner) {
    if (
      owner &&
      owner.debugBoardState &&
      owner.debugBoardState.buffer instanceof Uint8Array &&
      (owner.debugBoardState.buffer.length | 0) > 0
    ) {
      return owner.debugBoardState;
    }
    const state = {
      buffer: new Uint8Array(DEBUG_BOARD_CAPACITY),
      readIndex: 0,
      size: 0
    };
    if (owner) {
      owner.debugBoardState = state;
    }
    return state;
  }

  function pushDebugBoardByte(state, value) {
    const board = state && state.buffer instanceof Uint8Array ? state : null;
    if (!board || !(board.buffer instanceof Uint8Array) || board.buffer.length <= 0) {
      return false;
    }
    const capacity = board.buffer.length | 0;
    let size = board.size | 0;
    let readIndex = board.readIndex | 0;
    let writeIndex = ((readIndex + size) % capacity) | 0;
    if (size >= capacity) {
      writeIndex = readIndex;
      readIndex = ((readIndex + 1) % capacity) | 0;
      size = (capacity - 1) | 0;
    }
    board.buffer[writeIndex] = value & 0xff;
    board.readIndex = readIndex;
    board.size = (size + 1) | 0;
    return true;
  }

  function readDebugBoardByte(state) {
    const board = state && state.buffer instanceof Uint8Array ? state : null;
    if (!board || (board.size | 0) <= 0) {
      return { hasByte: false, byte: 0 };
    }
    const byte = board.buffer[board.readIndex | 0] & 0xff;
    board.readIndex = (((board.readIndex | 0) + 1) % (board.buffer.length | 0)) | 0;
    board.size = Math.max(0, ((board.size | 0) - 1) | 0) | 0;
    return { hasByte: true, byte };
  }

  function decodeCp866Z(bytes) {
    const source = bytes instanceof Uint8Array ? bytes : null;
    if (!source || !source.length) {
      return "";
    }
    const assets = KosEmu.gfx && KosEmu.gfx.kolibriFontAssets ? KosEmu.gfx.kolibriFontAssets : null;
    const map = assets && assets.cp866CodePoints ? assets.cp866CodePoints : null;
    let out = "";
    for (let i = 0; i < source.length; i += 1) {
      const value = source[i] & 0xff;
      if (value === 0) {
        break;
      }
      const codePoint = map && map[value] !== undefined ? map[value] : value;
      out += String.fromCodePoint(codePoint >>> 0);
    }
    return out;
  }

  function decodeUtf16Z(bytes) {
    const source = bytes instanceof Uint8Array ? bytes : null;
    if (!source || source.length < 2) {
      return "";
    }
    let out = "";
    for (let i = 0; i + 1 < source.length; i += 2) {
      const value = ((source[i] & 0xff) | ((source[i + 1] & 0xff) << 8)) >>> 0;
      if (value === 0) {
        break;
      }
      out += String.fromCodePoint(value);
    }
    return out;
  }

  function decodeSpeakerNoteDivider(noteCode) {
    const packed = noteCode & 0xff;
    const noteIndex = (packed & 0x0f) - 1;
    if (noteIndex < 0 || noteIndex >= SPEAKER_NOTE_DIVIDERS.length) {
      return 0;
    }
    const octave = (packed >>> 4) & 0x0f;
    return (SPEAKER_NOTE_DIVIDERS[noteIndex] >>> octave) >>> 0;
  }

  function decodeUtf8Z(bytes) {
    const source = bytes instanceof Uint8Array ? bytes : null;
    if (!source || !source.length) {
      return "";
    }
    let end = 0;
    while (end < source.length && source[end] !== 0) {
      end += 1;
    }
    if (UTF8_DECODER) {
      return UTF8_DECODER.decode(source.subarray(0, end));
    }
    return decodeCp866Z(source.subarray(0, end));
  }

  function packAsciiDword(text, offset) {
    let value = 0;
    const source = String(text || "");
    const start = offset | 0;
    for (let i = 0; i < 4; i += 1) {
      const index = start + i;
      const code = index < source.length ? (source.charCodeAt(index) & 0x7f) : 0x20;
      value |= (code & 0xff) << (i * 8);
    }
    return value >>> 0;
  }

  function encodeCpuidBrandDwords(text) {
    const source = String(text || "").slice(0, 48).padEnd(48, " ");
    const out = [];
    for (let offset = 0; offset < 48; offset += 4) {
      out.push(packAsciiDword(source, offset));
    }
    return out;
  }

  function installEmulatorHost(Emulator, shared) {
    if (!Emulator || !Emulator.prototype) {
      throw new Error("installEmulatorHost requires an Emulator class.");
    }
    const {
      REG,
      formatBytes,
      align4k,
      FALLBACK_COLOR_TABLE,
      getDefaultSkin,
      getDefaultSkinBytes,
      unpackKpck,
      parseSkinBuffer,
      getTextInfoFromString,
      measureKolibriText,
      drawKolibriText
    } = shared || {};

    Object.assign(Emulator.prototype, {
      ioRead8(port) {
        const p = port & 0xffff;
        if (!this.unknownPorts.has(p)) {
          this.unknownPorts.add(p);
          if (this.traceOpcodes) {
            this.log(`IO read8 from port 0x${p.toString(16)}`);
          }
        }
        return this.readTimeCounter32() & 0xff;
      },

      ioRead32(port) {
        const p = port & 0xffff;
        if (!this.unknownPorts.has(p)) {
          this.unknownPorts.add(p);
          if (this.traceOpcodes) {
            this.log(`IO read32 from port 0x${p.toString(16)}`);
          }
        }
        return this.readTimeCounter32() >>> 0;
      },

      ioWrite8(port, value) {
        const p = port & 0xffff;
        if (!this.unknownPorts.has(p)) {
          this.unknownPorts.add(p);
          if (this.traceOpcodes) {
            this.log(`IO write8 to port 0x${p.toString(16)} value=0x${(value & 0xff).toString(16)}`);
          }
        }
      },

      ioWrite32(port, value) {
        const p = port & 0xffff;
        if (!this.unknownPorts.has(p)) {
          this.unknownPorts.add(p);
          if (this.traceOpcodes) {
            this.log(`IO write32 to port 0x${p.toString(16)} value=0x${(value >>> 0).toString(16)}`);
          }
        }
      },

      readTimeCounter32() {
        if (!this.tscBase) {
          this.tscBase = Date.now();
        }
        return (Date.now() - this.tscBase) >>> 0;
      },

      getWallClockMs() {
        return (
          typeof performance !== "undefined" &&
          performance &&
          typeof performance.now === "function"
        ) ? performance.now() : Date.now();
      },

      getReportedCpuFrequencyHz() {
        let hz = this.cpuFreqHz && Number.isFinite(this.cpuFreqHz)
          ? Number(this.cpuFreqHz)
          : 0;
        if (!(hz > 0) && this.hostSession && typeof this.hostSession.getReportedCpuFrequencyHz === "function") {
          hz = Number(this.hostSession.getReportedCpuFrequencyHz());
        }
        if (!(hz > 0)) {
          hz = 2400000000;
        }
        hz = Math.max(1, Math.min(0xffffffff, Math.round(hz)));
        this.cpuFreqHz = hz >>> 0;
        return this.cpuFreqHz >>> 0;
      },

      getReportedCpuidLeaf(leaf, subleaf) {
        const requestLeaf = leaf >>> 0;
        const requestSubleaf = subleaf >>> 0;
        if (this.hostSession && typeof this.hostSession.getReportedCpuidLeaf === "function") {
          const hostLeaf = this.hostSession.getReportedCpuidLeaf(requestLeaf >>> 0, requestSubleaf >>> 0);
          if (hostLeaf && typeof hostLeaf === "object") {
            return {
              eax: (hostLeaf.eax >>> 0),
              ebx: (hostLeaf.ebx >>> 0),
              ecx: (hostLeaf.ecx >>> 0),
              edx: (hostLeaf.edx >>> 0)
            };
          }
        }
        if (!this.reportedCpuidCache) {
          const stepping = 3;
          const model = 0x0f;
          const family = 0x06;
          const processorType = 0;
          const extModel = 0;
          const extFamily = 0;
          const leaf1Eax = (
            (stepping & 0x0f) |
            ((model & 0x0f) << 4) |
            ((family & 0x0f) << 8) |
            ((processorType & 0x03) << 12) |
            ((extModel & 0x0f) << 16) |
            ((extFamily & 0xff) << 20)
          ) >>> 0;
          const leaf1Edx = (
            (1 << 4) |
            (1 << 5) |
            (1 << 8) |
            (1 << 15) |
            (1 << 23) |
            (1 << 24) |
            (1 << 25) |
            (1 << 26)
          ) >>> 0;
          const brandDwords = encodeCpuidBrandDwords("KolibriOS Web Emulator");
          this.reportedCpuidCache = {
            leaf1Eax,
            leaf1Ebx: ((8 << 8) | (1 << 16)) >>> 0,
            leaf1Ecx: 0,
            leaf1Edx,
            brandDwords
          };
        }
        const cache = this.reportedCpuidCache;
        switch (requestLeaf) {
          case 0:
            return {
              eax: 1,
              ebx: 0x756e6547,
              ecx: 0x6c65746e,
              edx: 0x49656e69
            };
          case 1:
            return {
              eax: cache.leaf1Eax >>> 0,
              ebx: cache.leaf1Ebx >>> 0,
              ecx: cache.leaf1Ecx >>> 0,
              edx: cache.leaf1Edx >>> 0
            };
          case 0x80000000:
            return {
              eax: 0x80000004,
              ebx: 0,
              ecx: 0,
              edx: 0
            };
          case 0x80000001:
          case 0x80000007:
            return {
              eax: 0,
              ebx: 0,
              ecx: 0,
              edx: 0
            };
          case 0x80000002:
          case 0x80000003:
          case 0x80000004: {
            const index = ((requestLeaf - 0x80000002) * 4) >>> 0;
            return {
              eax: cache.brandDwords[index] >>> 0,
              ebx: cache.brandDwords[index + 1] >>> 0,
              ecx: cache.brandDwords[index + 2] >>> 0,
              edx: cache.brandDwords[index + 3] >>> 0
            };
          }
          default:
            return {
              eax: 0,
              ebx: 0,
              ecx: 0,
              edx: 0
            };
        }
      },

      readReportedMsr(msr) {
        const reg = msr >>> 0;
        if (this.hostSession && typeof this.hostSession.readReportedMsr === "function") {
          const value = this.hostSession.readReportedMsr(reg >>> 0);
          if (value && typeof value === "object") {
            return {
              low: value.low >>> 0,
              high: value.high >>> 0
            };
          }
        }
        const cpuFreqHz = this.getReportedCpuFrequencyHz();
        const ratio100 = Math.max(1, Math.min(0x1f, Math.round(cpuFreqHz / 100000000)));
        switch (reg) {
          case 0x2a:
            return {
              low: (ratio100 << 22) >>> 0,
              high: 0
            };
          case 0x2c:
            return {
              low: (ratio100 << 24) >>> 0,
              high: 0
            };
          default:
            return {
              low: 0,
              high: 0
            };
        }
      },

      trimCpuBusySamples(nowMs) {
        if (!Array.isArray(this.cpuBusySamples)) {
          this.cpuBusySamples = [];
          this.cpuBusySampleTotalMs = 0;
          return;
        }
        const cutoff = (Number(nowMs) || 0) - 1000;
        while (this.cpuBusySamples.length && (this.cpuBusySamples[0].at || 0) < cutoff) {
          const sample = this.cpuBusySamples.shift();
          const busy = sample && Number.isFinite(sample.busyMs) ? Number(sample.busyMs) : 0;
          this.cpuBusySampleTotalMs = Math.max(0, (Number(this.cpuBusySampleTotalMs) || 0) - busy);
        }
      },

      noteCpuBusyTime(durationMs) {
        const busyMs = Math.max(0, Number(durationMs) || 0);
        if (!(busyMs > 0)) {
          return;
        }
        if (!Array.isArray(this.cpuBusySamples)) {
          this.cpuBusySamples = [];
          this.cpuBusySampleTotalMs = 0;
        }
        const now = this.getWallClockMs();
        this.cpuBusySamples.push({
          at: now,
          busyMs
        });
        this.cpuBusySampleTotalMs = (Number(this.cpuBusySampleTotalMs) || 0) + busyMs;
        this.trimCpuBusySamples(now);
        if (this.hostSession && typeof this.hostSession.noteCpuBusyTime === "function") {
          this.hostSession.noteCpuBusyTime(busyMs);
        }
      },

      getReportedCpuUsage() {
        const now = this.getWallClockMs();
        this.trimCpuBusySamples(now);
        let busyMs = Math.max(0, Number(this.cpuBusySampleTotalMs) || 0);
        if ((Number(this.cpuBusyActiveStartMs) || 0) > 0) {
          busyMs += Math.max(0, now - Number(this.cpuBusyActiveStartMs));
        }
        busyMs = Math.max(0, Math.min(1000, busyMs));
        const cpuFreqHz = this.getReportedCpuFrequencyHz();
        return Math.round((busyMs / 1000) * cpuFreqHz) >>> 0;
      },

      applyWindowOffset(x, y) {
        const ox = (this.windowOriginX + this.windowClientOffsetX) | 0;
        const oy = (this.windowOriginY + this.windowClientOffsetY) | 0;
        return {
          x: (x + ox) | 0,
          y: (y + oy) | 0
        };
      },

      getHostScreenInfo() {
        const hostSize = typeof this.getHostScreenSize === "function"
          ? (this.getHostScreenSize() || null)
          : null;
        return {
          width: hostSize && hostSize.width !== undefined
            ? Math.max(1, hostSize.width | 0)
            : Math.max(1, this.surface ? (this.surface.width | 0) : 1),
          height: hostSize && hostSize.height !== undefined
            ? Math.max(1, hostSize.height | 0)
            : Math.max(1, this.surface ? (this.surface.height | 0) : 1)
        };
      },

      getHostScreenWorkArea() {
        const screen = this.getHostScreenInfo();
        const rect = this.hostSession && typeof this.hostSession.getScreenWorkArea === "function"
          ? (this.hostSession.getScreenWorkArea() || null)
          : null;
        return {
          left: rect ? (rect.left | 0) : 0,
          top: rect ? (rect.top | 0) : 0,
          right: rect ? (rect.right | 0) : Math.max(0, ((screen.width | 0) - 1) | 0),
          bottom: rect ? (rect.bottom | 0) : Math.max(0, ((screen.height | 0) - 1) | 0)
        };
      },

      isHostScreenPointVisible(x, y) {
        const screen = this.getHostScreenInfo();
        const px = x | 0;
        const py = y | 0;
        return px >= 0 && py >= 0 && px < (screen.width | 0) && py < (screen.height | 0);
      },

      getWindowLocalPointFromHost(x, y) {
        if (!this.windowDefined) {
          return null;
        }
        const localX = ((x | 0) - (this.windowHostX | 0)) | 0;
        const localY = ((y | 0) - (this.windowHostY | 0)) | 0;
        const windowWidth = Math.max(1, this.windowWidth | 0);
        const windowHeight = Math.max(1, this.windowHeight | 0);
        if (localX < 0 || localY < 0 || localX >= windowWidth || localY >= windowHeight) {
          return null;
        }
        return {
          x: localX | 0,
          y: localY | 0
        };
      },

      isWindowShapePixelVisible(localX, localY) {
        const shape = this.windowShape;
        if (!(shape && shape.data instanceof Uint8Array)) {
          return true;
        }
        const x = localX | 0;
        const y = localY | 0;
        const width = shape.width | 0;
        const height = shape.height | 0;
        if (x < 0 || y < 0 || x >= width || y >= height) {
          return true;
        }
        return !!shape.data[(y * width) + x];
      },

      getFallbackPixelOwnerAt(x, y) {
        if (!this.isHostScreenPointVisible(x, y)) {
          return 0;
        }
        if (!this.windowDefined) {
          return 1;
        }
        const local = this.getWindowLocalPointFromHost(x, y);
        if (!local) {
          return 1;
        }
        return this.isWindowShapePixelVisible(local.x, local.y)
          ? (this.threadSlot >>> 0)
          : 1;
      },

      getFallbackPackedPixelAt(x, y) {
        if (!this.isHostScreenPointVisible(x, y)) {
          return 0;
        }
        const local = this.getWindowLocalPointFromHost(x, y);
        if (
          !local ||
          !this.surface ||
          !(this.surface.buffer32 instanceof Uint32Array)
        ) {
          return 0;
        }
        const surfaceWidth = this.surface.width | 0;
        if (local.x < 0 || local.y < 0 || local.x >= surfaceWidth || local.y >= (this.surface.height | 0)) {
          return 0;
        }
        return this.surface.buffer32[(local.y * surfaceWidth) + local.x] >>> 0;
      },

      setMousePosition(x, y, inside, screenX, screenY) {
        this.mouseX = x | 0;
        this.mouseY = y | 0;
        this.mouseInside = !!inside;
        this.mouseScreenX = screenX === undefined ? (x | 0) : (screenX | 0);
        this.mouseScreenY = screenY === undefined ? (y | 0) : (screenY | 0);
      },

      setMouseState(x, y, buttons, inside, pressMask, releaseMask, wheelX, wheelY, moved, screenX, screenY) {
        this.setMousePosition(x, y, inside, screenX, screenY);
        this.mouseButtons = buttons & 0x1f;
        const eventFlags =
          (((pressMask & 0x1f) << 8) | ((releaseMask & 0x1f) << 16)) >>> 0 |
          (wheelY ? (1 << 15) : 0) |
          (wheelX ? (1 << 23) : 0);
        let buttonEventQueued = false;
        if (pressMask) {
          this.mouseEventFlags |= ((pressMask & 0x1f) << 8) >>> 0;
        }
        if (releaseMask) {
          this.mouseEventFlags |= ((releaseMask & 0x1f) << 16) >>> 0;
        }
        if (wheelY) {
          this.mouseEventFlags |= 1 << 15;
          this.mouseScrollY = ((this.mouseScrollY | 0) + (wheelY | 0)) | 0;
        }
        if (wheelX) {
          this.mouseEventFlags |= 1 << 23;
          this.mouseScrollX = ((this.mouseScrollX | 0) + (wheelX | 0)) | 0;
        }
        if (pressMask) {
          const button = this.findDefinedButtonAt(this.mouseX | 0, this.mouseY | 0);
          this.activeButtonSerial = button ? (button.serial >>> 0) : 0;
          if (button) {
            buttonEventQueued = !!this.queuePressedButton(button);
          }
        } else if (releaseMask || (this.mouseButtons & 0x1f) === 0) {
          this.activeButtonSerial = 0;
        }
        const mouseEventOccurred = !!(pressMask || releaseMask || wheelX || wheelY || moved);
        const mouseEventQueued =
          mouseEventOccurred &&
          typeof this.shouldRecordMouseEvent === "function" &&
          this.shouldRecordMouseEvent();
        if (mouseEventQueued) {
          this.pushBufferedMouseEvent(
            x,
            y,
            buttons,
            inside,
            pressMask,
            releaseMask,
            wheelX,
            wheelY,
            moved,
            screenX,
            screenY,
            eventFlags
          );
          this.queueEvent(6);
        }
        const shouldWakeForMouse =
          mouseEventQueued &&
          typeof this.isEventEnabledByMask === "function" &&
          this.isEventEnabledByMask(6);
        if (buttonEventQueued || shouldWakeForMouse) {
          this.wakeExecution();
        }
      },

      setControlKeyState(mask) {
        this.controlKeyState = mask & 0x7ff;
      },

      pushBufferedKeyEntry(asciiCode, scanCode, controlKeys, hotkey, mode) {
        this.keyBuffer.push({
          asciiCode: asciiCode & 0xff,
          scanCode: scanCode & 0xff,
          controlKeys: controlKeys & 0x7ff,
          hotkey: !!hotkey,
          mode: mode & 0xff
        });
        this.removeQueuedEvent(2);
        this.queueEvent(2);
      },

      pushBufferedMouseEvent(x, y, buttons, inside, pressMask, releaseMask, wheelX, wheelY, moved, screenX, screenY, eventFlags) {
        this.mouseEventBuffer.push({
          x: x | 0,
          y: y | 0,
          buttons: buttons & 0x1f,
          inside: !!inside,
          screenX: screenX === undefined ? (x | 0) : (screenX | 0),
          screenY: screenY === undefined ? (y | 0) : (screenY | 0),
          eventFlags: eventFlags >>> 0,
          scrollX: wheelX | 0,
          scrollY: wheelY | 0,
          moved: !!moved,
          pressMask: pressMask & 0x1f,
          releaseMask: releaseMask & 0x1f
        });
      },

      applyBufferedMouseEvent(entry) {
        if (!entry) {
          return false;
        }
        this.mouseX = entry.x | 0;
        this.mouseY = entry.y | 0;
        this.mouseButtons = entry.buttons & 0x1f;
        this.mouseInside = !!entry.inside;
        this.mouseScreenX = entry.screenX | 0;
        this.mouseScreenY = entry.screenY | 0;
        this.mouseEventFlags = entry.eventFlags >>> 0;
        this.mouseScrollX = entry.scrollX | 0;
        this.mouseScrollY = entry.scrollY | 0;
        return true;
      },

      queueKeyEvent(asciiCode, scanCode, controlMask, hotkey) {
        const ascii = asciiCode & 0xff;
        const scan = scanCode & 0xff;
        if (controlMask !== undefined && controlMask !== null) {
          this.setControlKeyState(controlMask >>> 0);
        }
        if (ascii === 0 && scan === 0) {
          return;
        }
        this.pushBufferedKeyEntry(
          ascii,
          scan,
          this.controlKeyState & 0x7ff,
          !!hotkey,
          hotkey ? 2 : (this.keyboardMode & 0xff)
        );
        this.wakeExecution();
        this.wakeHostSiblingThreads(true);
      },

      queueBrowserKeyEvent(eventInfo) {
        const info = eventInfo || {};
        if (info.controlKeys !== undefined && info.controlKeys !== null) {
          this.setControlKeyState(info.controlKeys >>> 0);
        }

        const controlKeys = this.controlKeyState & 0x7ff;
        const ascii = info.asciiCode & 0xff;
        const baseScan = info.scanCode & 0x7f;
        const hotkey = !!info.hotkey;
        const released = !!info.released;
        const extended = !!info.extended;
        const modifier = !!info.modifier;
        const lockKey = !!info.lockKey;

        if (hotkey) {
          if (baseScan !== 0) {
            this.pushBufferedKeyEntry(0, baseScan, controlKeys, true, 2);
            this.wakeExecution();
            this.wakeHostSiblingThreads(true);
          }
          return;
        }

        if (this.keyboardInputLocked && !hotkey) {
          return;
        }

        if ((this.keyboardMode & 0xff) === 0) {
          if (released) {
            return;
          }
          if (ascii === 0 && (modifier || lockKey)) {
            return;
          }
          if (ascii === 0 && baseScan === 0) {
            return;
          }
          this.pushBufferedKeyEntry(ascii, baseScan, controlKeys, false, 0);
          this.wakeExecution();
          this.wakeHostSiblingThreads(true);
          return;
        }

        if (released) {
          return;
        }
        if (baseScan === 0) {
          return;
        }
        if (extended) {
          this.pushBufferedKeyEntry(0, 0xe0, controlKeys, false, 1);
        }
        this.pushBufferedKeyEntry(0, baseScan, controlKeys, false, 1);
        this.wakeExecution();
        this.wakeHostSiblingThreads(true);
      },

      removeQueuedEvent(eventId) {
        if (!eventId || !this.eventQueue.length) {
          return;
        }
        for (let i = this.eventQueue.length - 1; i >= 0; i -= 1) {
          if (this.eventQueue[i] === eventId) {
            this.eventQueue.splice(i, 1);
          }
        }
      },

      resetDefinedButtons() {
        this.buttons.length = 0;
        this.activeButtonSerial = 0;
      },

      deleteDefinedButtons(id) {
        if (!this.buttons.length) {
          return;
        }
        const target = id & 0x00ffffff;
        for (let i = this.buttons.length - 1; i >= 0; i -= 1) {
          const button = this.buttons[i];
          if ((button.id & 0x00ffffff) !== target) {
            continue;
          }
          if ((button.serial >>> 0) === (this.activeButtonSerial >>> 0)) {
            this.activeButtonSerial = 0;
          }
          this.buttons.splice(i, 1);
        }
      },

      findDefinedButtonAt(screenX, screenY) {
        for (let i = this.buttons.length - 1; i >= 0; i -= 1) {
          const button = this.buttons[i];
          const pos = this.applyWindowOffset(button.x, button.y);
          if (
            screenX >= (pos.x | 0) &&
            screenY >= (pos.y | 0) &&
            screenX < ((pos.x + button.width) | 0) &&
            screenY < ((pos.y + button.height) | 0)
          ) {
            return button;
          }
        }
        return null;
      },

      queuePressedButton(button) {
        if (!button) {
          return false;
        }
        if (typeof this.isHostThreadActive === "function" && !this.isHostThreadActive()) {
          return false;
        }
        const id = button.id & 0x00ffffff;
        if (id === 0xffff) {
          return false;
        }
        const al = this.mouseButtons & 0x1e;
        this.pendingButtonResult = (((id & 0x00ffffff) << 8) | (al & 0xff)) >>> 0;
        this.removeQueuedEvent(3);
        this.queueEvent(3);
        return true;
      },

      queueSystemButtonEvent(buttonId, mouseButtonMask) {
        const packedId = (buttonId | 0) & 0x00ffffff;
        const encodedButtons = (mouseButtonMask | 0) & 0x1e;
        this.pendingButtonResult = (((packedId >>> 0) << 8) | (encodedButtons & 0xff)) >>> 0;
        this.removeQueuedEvent(3);
        this.queueEvent(3);
        this.wakeExecution();
      },

      shouldRecordMouseEvent() {
        if (((this.eventMask >>> 31) & 1) !== 0 && typeof this.isHostThreadActive === "function" && !this.isHostThreadActive()) {
          return false;
        }
        if (((this.eventMask >>> 30) & 1) !== 0 && !this.mouseInside) {
          return false;
        }
        return true;
      },

      getUiColor(offset, fallback) {
        const bytes = this.getSkinColorTableBytes();
        if (!bytes || bytes.length < offset + 4) {
          return fallback & 0x00ffffff;
        }
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return view.getUint32(offset, true) & 0x00ffffff;
      },

      shadeColor(color, delta) {
        const clamp = (value) => Math.max(0, Math.min(255, value | 0));
        const r = clamp(((color >>> 16) & 0xff) + delta);
        const g = clamp(((color >>> 8) & 0xff) + delta);
        const b = clamp((color & 0xff) + delta);
        return ((r << 16) | (g << 8) | b) >>> 0;
      },

      drawDefinedButton(button) {
        if (!button || button.hidden) {
          return;
        }
        const pos = this.applyWindowOffset(button.x, button.y);
        const x = pos.x | 0;
        const y = pos.y | 0;
        const width = button.width | 0;
        const height = button.height | 0;
        if (width <= 0 || height <= 0) {
          return;
        }

        const baseColor = (button.color || this.getUiColor(24, 0xd0d0d0)) & 0x00ffffff;
        const lightColor = this.getUiColor(12, this.shadeColor(baseColor, 24));
        const darkColor = this.getUiColor(8, this.shadeColor(baseColor, -28));
        const borderColor = this.getUiColor(0, this.shadeColor(baseColor, -48));
        const pressed =
          !button.noPressFrame &&
          (button.serial >>> 0) === (this.activeButtonSerial >>> 0) &&
          (this.mouseButtons & 0x1f) !== 0;
        const bodyColor = pressed ? this.shadeColor(baseColor, -10) : baseColor;

        if (this.buttonStyle === 0) {
          this.fillRect(x, y, width, height, bodyColor);
          this.fillRect(x, y, width, 1, pressed ? darkColor : borderColor);
          this.fillRect(x, y, 1, height, pressed ? darkColor : borderColor);
          this.fillRect(x + width - 1, y, 1, height, darkColor);
          this.fillRect(x, y + height - 1, width, 1, darkColor);
          return;
        }

        this.fillRect(x, y, width, height, borderColor);
        this.fillRect(x + 1, y + 1, Math.max(0, width - 2), Math.max(0, height - 2), bodyColor);

        const outerTop = pressed ? darkColor : lightColor;
        const outerBottom = pressed ? lightColor : darkColor;
        this.fillRect(x, y, width, 1, outerTop);
        this.fillRect(x, y, 1, height, outerTop);
        this.fillRect(x + width - 1, y, 1, height, outerBottom);
        this.fillRect(x, y + height - 1, width, 1, outerBottom);

        if (width > 3 && height > 3) {
          const innerLight = this.shadeColor(lightColor, 10);
          const innerDark = this.shadeColor(darkColor, -10);
          const innerTop = pressed ? innerDark : innerLight;
          const innerBottom = pressed ? innerLight : innerDark;
          this.fillRect(x + 1, y + 1, width - 2, 1, innerTop);
          this.fillRect(x + 1, y + 1, 1, height - 2, innerTop);
          this.fillRect(x + width - 2, y + 1, 1, height - 2, innerBottom);
          this.fillRect(x + 1, y + height - 2, width - 2, 1, innerBottom);
        }
      },

      notifyWindowSize(width, height) {
        const w = width | 0;
        const h = height | 0;
        if (w <= 0 || h <= 0) {
          return;
        }
        if (w === this.windowWidth && h === this.windowHeight) {
          return;
        }
        this.windowWidth = w;
        this.windowHeight = h;
        if (this.onWindowResize) {
          this.onWindowResize(w, h);
        }
      },

      notifyWindowGeometry(x, y, width, height) {
        const hostX = x | 0;
        const hostY = y | 0;
        const w = width | 0;
        const h = height | 0;
        this.windowHostX = hostX;
        this.windowHostY = hostY;
        if (typeof this.onWindowGeometry === "function" && w > 0 && h > 0) {
          this.onWindowGeometry(hostX, hostY, w, h);
        }
      },

      applyHostWindowGeometry(next, options) {
        if (!this.windowDefined) {
          return false;
        }
        const update = next || {};
        const opts = options || {};
        const currentX = this.windowHostX | 0;
        const currentY = this.windowHostY | 0;
        const currentWidth = Math.max(1, this.windowWidth | 0 || (this.surface ? (this.surface.width | 0) : 1));
        const currentHeight = Math.max(1, this.windowHeight | 0 || (this.surface ? (this.surface.height | 0) : 1));
        const nextX = update.x === undefined || update.x === null ? currentX : (update.x | 0);
        const nextY = update.y === undefined || update.y === null ? currentY : (update.y | 0);
        const nextWidth = Math.max(1, update.width === undefined || update.width === null ? currentWidth : (update.width | 0));
        const nextHeight = Math.max(1, update.height === undefined || update.height === null ? currentHeight : (update.height | 0));
        const geometryChanged = nextX !== currentX || nextY !== currentY;
        const sizeChanged = nextWidth !== currentWidth || nextHeight !== currentHeight;

        if (!geometryChanged && !sizeChanged) {
          if (opts.forceRedraw) {
            this.queueEvent(1);
            if (opts.wake !== false) {
              this.wakeExecution();
            }
          }
          return false;
        }

        if (this.autoFitWindow) {
          this.windowOriginX = 0;
          this.windowOriginY = 0;
        } else {
          this.windowOriginX = nextX | 0;
          this.windowOriginY = nextY | 0;
        }

        if (sizeChanged) {
          this.notifyWindowSize(nextWidth, nextHeight);
        }
        this.notifyWindowGeometry(nextX, nextY, nextWidth, nextHeight);
        if (typeof this.updateWindowShape === "function") {
          this.updateWindowShape();
        }
        if (opts.queueRedraw !== false) {
          this.queueEvent(1);
        }
        if (opts.wake !== false) {
          this.wakeExecution();
        }
        return true;
      },

      getCurrentClientInfo() {
        const skinned =
          this.windowStyle === 3 ||
          this.windowStyle === 4 ||
          (this.windowClientOffsetX | 0) !== 0 ||
          (this.windowClientOffsetY | 0) !== 0;
        let clientX = this.windowClientOffsetX | 0;
        let clientY = this.windowClientOffsetY | 0;
        if (!clientX && skinned) {
          clientX = 4;
        }
        if (!clientY && skinned) {
          clientY = Math.max(0, this.skinHeight | 0);
        }
        const rightInset = skinned ? 4 : 0;
        const bottomInset = skinned ? 5 : 0;
        const windowWidth = this.windowDefined
          ? Math.max(0, this.windowWidth | 0)
          : Math.max(0, this.surface ? (this.surface.width | 0) : 0);
        const windowHeight = this.windowDefined
          ? Math.max(0, this.windowHeight | 0)
          : Math.max(0, this.surface ? (this.surface.height | 0) : 0);
        return {
          x: clientX | 0,
          y: clientY | 0,
          width: Math.max(0, windowWidth - clientX - rightInset) | 0,
          height: Math.max(0, windowHeight - clientY - bottomInset) | 0
        };
      },

      buildCurrentThreadInfo(slot) {
        const client = this.getCurrentClientInfo();
        const activeSlot = this.threadSlot >>> 0;
        const requestedSlot = slot >>> 0;
        const windowX = this.windowDefined ? (this.windowHostX | 0) : 0;
        const windowY = this.windowDefined ? (this.windowHostY | 0) : 0;
        const windowWidth = this.windowDefined
          ? Math.max(0, this.windowWidth | 0)
          : Math.max(0, this.surface ? (this.surface.width | 0) : 0);
        const windowHeight = this.windowDefined
          ? Math.max(0, this.windowHeight | 0)
          : Math.max(0, this.surface ? (this.surface.height | 0) : 0);
        const slotState = requestedSlot === activeSlot ? (this.running ? 0 : 3) : 9;
        return {
          cpuUsage: this.getReportedCpuUsage(),
          windowStackPosition: requestedSlot === activeSlot ? 1 : 0,
          name: this.image && this.image.fileName ? String(this.image.fileName) : "APP",
          memoryAddress: 0,
          usedMemory: typeof this.getCommittedProcessMemoryBytes === "function"
            ? (this.getCommittedProcessMemoryBytes() >>> 0)
            : (this.memLimit ? (this.memLimit >>> 0) : 0),
          pid: this.processId >>> 0,
          windowX: windowX >>> 0,
          windowY: windowY >>> 0,
          windowWidth: windowWidth >>> 0,
          windowHeight: windowHeight >>> 0,
          slotState: slotState >>> 0,
          clientX: client.x >>> 0,
          clientY: client.y >>> 0,
          clientWidth: client.width >>> 0,
          clientHeight: client.height >>> 0,
          windowState: 0,
          eventMask: this.eventMask >>> 0,
          keyboardMode: this.keyboardMode & 0xff
        };
      },

      copySurfaceRegion24(dstPtr, width, height, screenX, screenY) {
        if (!this.cpu || !this.surface || !this.surface.buffer32) {
          return false;
        }
        const w = width | 0;
        const h = height | 0;
        if (w <= 0 || h <= 0) {
          return false;
        }
        const totalBytes = (w * h * 3) >>> 0;
        const dst = dstPtr >>> 0;
        const mem = this.cpu.mem;
        if (dst >= mem.length || (dst + totalBytes) > mem.length) {
          return false;
        }

        let originX = 0;
        let originY = 0;
        if (this.autoFitWindow) {
          const info = this.getHostThreadInfo(this.threadSlot >>> 0);
          if (info) {
            originX = info.windowX | 0;
            originY = info.windowY | 0;
          } else {
            originX = this.windowHostX | 0;
            originY = this.windowHostY | 0;
          }
        }

        const localX0 = (screenX | 0) - originX;
        const localY0 = (screenY | 0) - originY;
        const src = this.surface.buffer32;
        const stride = this.surface.width | 0;
        const limitY = this.surface.height | 0;
        let out = dst;

        for (let y = 0; y < h; y += 1) {
          const sy = localY0 + y;
          if (sy < 0 || sy >= limitY) {
            mem.fill(0, out, out + w * 3);
            out += w * 3;
            continue;
          }
          let srcIndex = sy * stride;
          for (let x = 0; x < w; x += 1) {
            const sx = localX0 + x;
            if (sx < 0 || sx >= stride) {
              mem[out++] = 0;
              mem[out++] = 0;
              mem[out++] = 0;
              continue;
            }
            const packed = src[srcIndex + sx] >>> 0;
            mem[out++] = (packed >>> 16) & 0xff;
            mem[out++] = (packed >>> 8) & 0xff;
            mem[out++] = packed & 0xff;
          }
        }
        return true;
      },

      buildWindowShape() {
        if (!this.cpu || !this.windowDefined) {
          return null;
        }
        const ptr = this.windowShapePtr >>> 0;
        if (!ptr) {
          return null;
        }
        const width = Math.max(1, this.windowWidth | 0);
        const height = Math.max(1, this.windowHeight | 0);
        const scale = Math.max(0, Math.min(8, this.windowShapeScale | 0));
        const sampleWidth = Math.max(1, width >> scale);
        const sampleHeight = Math.max(1, height >> scale);
        const sourceSize = Math.max(1, sampleWidth * sampleHeight);
        const source = this.readMemBlock(ptr, sourceSize);
        if (!source || !source.length) {
          return null;
        }
        const data = new Uint8Array(width * height);
        for (let y = 0; y < height; y += 1) {
          const sampleY = Math.min(sampleHeight - 1, y >> scale);
          const dstRow = y * width;
          const srcRow = sampleY * sampleWidth;
          for (let x = 0; x < width; x += 1) {
            const sampleX = Math.min(sampleWidth - 1, x >> scale);
            data[dstRow + x] = source[srcRow + sampleX] ? 1 : 0;
          }
        }
        return {
          width,
          height,
          scale,
          data
        };
      },

      updateWindowShape() {
        this.windowShape = this.buildWindowShape();
        if (typeof this.onWindowShape === "function") {
          this.onWindowShape(this.windowShape);
        }
      },

      callHostSession(methodName, args, fallbackValue, failureLabel, errorFallbackValue) {
        const session = this.hostSession;
        const fn = session && session[methodName];
        const getFallback = (value) => (
          typeof value === "function"
            ? value()
            : value
        );
        if (typeof fn !== "function") {
          return getFallback(fallbackValue);
        }
        try {
          return fn.apply(session, Array.isArray(args) ? args : []);
        } catch (err) {
          this.log(`Host session ${failureLabel || methodName} failed: ${err}`);
          return getFallback(
            errorFallbackValue === undefined
              ? fallbackValue
              : errorFallbackValue
          );
        }
      },

      getLocalDebugBoardState() {
        return ensureDebugBoardState(this);
      },

      writeDebugBoardByte(value) {
        const byte = value & 0xff;
        const session = this.hostSession;
        if (session && typeof session.writeDebugBoardByte === "function") {
          try {
            return !!session.writeDebugBoardByte(byte, this);
          } catch (err) {
            this.log(`Host session writeDebugBoardByte failed: ${err}`);
          }
        }
        return pushDebugBoardByte(this.getLocalDebugBoardState(), byte);
      },

      readDebugBoardByte() {
        const session = this.hostSession;
        if (session && typeof session.readDebugBoardByte === "function") {
          try {
            const result = session.readDebugBoardByte(this);
            if (result && result.hasByte) {
              return {
                hasByte: true,
                byte: (result.byte & 0xff) >>> 0
              };
            }
            return { hasByte: false, byte: 0 };
          } catch (err) {
            this.log(`Host session readDebugBoardByte failed: ${err}`);
          }
        }
        return readDebugBoardByte(this.getLocalDebugBoardState());
      },

      getHostMaxThreadSlot() {
        const value = this.callHostSession(
          "getMaxThreadSlot",
          [],
          () => this.threadSlot >>> 0,
          "getMaxThreadSlot"
        );
        return Math.max(1, value | 0) >>> 0;
      },

      getHostThreadCount() {
        const value = this.callHostSession(
          "getThreadCount",
          [],
          () => this.threadSlot >>> 0,
          "getThreadCount"
        );
        return Math.max(1, value | 0) >>> 0;
      },

      getHostActiveThreadSlot() {
        const value = this.callHostSession(
          "getActiveThreadSlot",
          [],
          () => this.threadSlot >>> 0,
          "getActiveThreadSlot"
        );
        return Math.max(1, value | 0) >>> 0;
      },

      isHostThreadActive() {
        return (this.getHostActiveThreadSlot() >>> 0) === (this.threadSlot >>> 0);
      },

      getHostThreadSlotByProcessId(pid) {
        const requestedPid = pid >>> 0;
        return this.callHostSession(
          "getThreadSlotByProcessId",
          [requestedPid],
          () => (requestedPid === (this.processId >>> 0) ? (this.threadSlot >>> 0) : 0),
          `getThreadSlotByProcessId for pid ${requestedPid}`
        ) >>> 0;
      },

      getHostThreadInfo(slot) {
        return this.callHostSession(
          "getThreadInfo",
          [slot >>> 0],
          null,
          `getThreadInfo for slot ${slot >>> 0}`
        ) || null;
      },

      getHostWindowStackSlot(position) {
        const requestedPosition = position >>> 0;
        return this.callHostSession(
          "getWindowStackSlot",
          [requestedPosition],
          requestedPosition,
          `getWindowStackSlot for position ${requestedPosition}`
        ) >>> 0;
      },

      focusHostThreadSlot(slot) {
        return this.callHostSession(
          "focusThreadSlot",
          [slot >>> 0],
          () => this.threadSlot >>> 0,
          `focusThreadSlot for slot ${slot >>> 0}`
        ) >>> 0;
      },

      unfocusHostThreadSlot(slot) {
        return this.callHostSession(
          "unfocusThreadSlot",
          [slot >>> 0],
          () => this.getHostActiveThreadSlot(),
          `unfocusThreadSlot for slot ${slot >>> 0}`
        ) >>> 0;
      },

      terminateHostThreadSlot(slot) {
        return !!this.callHostSession(
          "terminateThreadSlot",
          [slot >>> 0],
          false,
          `terminateThreadSlot for slot ${slot >>> 0}`
        );
      },

      terminateHostProcessId(pid) {
        return !!this.callHostSession(
          "terminateProcessId",
          [pid >>> 0],
          false,
          `terminateProcessId for pid ${pid >>> 0}`
        );
      },

      decodeSpeakerSequence(ptr) {
        const start = ptr >>> 0;
        const items = [];
        let offset = start >>> 0;
        let totalDurationMs = 0;
        let bytesRead = 0;
        let terminated = false;
        const maxItems = 4096;
        const maxBytes = 65536;
        for (let index = 0; index < maxItems && bytesRead < maxBytes; index += 1) {
          const control = this.readMem8(offset) & 0xff;
          offset = (offset + 1) >>> 0;
          bytesRead = (bytesRead + 1) >>> 0;
          if (control === 0) {
            terminated = true;
            break;
          }

          let durationCs = 0;
          let divider = 0;
          let noteCode = 0;
          let kind = "rest";
          if (control < 0x81) {
            durationCs = control & 0xff;
            divider = this.readMem16(offset) & 0xffff;
            offset = (offset + 2) >>> 0;
            bytesRead = (bytesRead + 2) >>> 0;
            if (!divider) {
              break;
            }
            kind = "tone";
          } else {
            durationCs = (control - 0x81) & 0xff;
            noteCode = this.readMem8(offset) & 0xff;
            offset = (offset + 1) >>> 0;
            bytesRead = (bytesRead + 1) >>> 0;
            if (noteCode === 0xff) {
              kind = "rest";
            } else {
              divider = decodeSpeakerNoteDivider(noteCode);
              if (!divider) {
                break;
              }
              kind = "tone";
            }
          }

          const durationMs = Math.max(0, durationCs * 10) | 0;
          totalDurationMs = (totalDurationMs + durationMs) | 0;
          items.push({
            kind,
            durationCs: durationCs & 0xff,
            durationMs,
            divider: divider >>> 0,
            frequencyHz: divider ? (SPEAKER_TIMER_HZ / divider) : 0,
            noteCode: noteCode >>> 0
          });
        }
        return {
          ptr: start >>> 0,
          bytesRead: bytesRead >>> 0,
          totalDurationMs: totalDurationMs >>> 0,
          terminated: !!terminated,
          items
        };
      },

      playHostSpeakerSequence(ptr) {
        const sequence = this.decodeSpeakerSequence(ptr >>> 0);
        const result = this.callHostSession(
          "playSpeakerSequence",
          [{
            ownerPid: this.processId >>> 0,
            ownerSlot: this.threadSlot >>> 0,
            processPath: String(this.processPathOverride || this.processPath || ""),
            ptr: ptr >>> 0,
            bytesRead: sequence.bytesRead >>> 0,
            totalDurationMs: sequence.totalDurationMs >>> 0,
            terminated: !!sequence.terminated,
            items: sequence.items
          }],
          this.speakerDisabled ? 55 : 0,
          "playSpeakerSequence",
          55
        );
        return (result | 0) >>> 0;
      },

      startHostApplication(path, params, flags) {
        const result = this.callHostSession(
          "startApplication",
          [{
            path: path ? String(path) : "",
            params: params ? String(params) : "",
            flags: flags >>> 0,
            parentThreadSlot: this.threadSlot >>> 0,
            parentPid: this.processId >>> 0
          }],
          {
            errorCode: 5,
            pid: 0
          },
          `startApplication for '${path}'`,
          {
            errorCode: 31,
            pid: 0
          }
        ) || {};
        return {
          errorCode: result.errorCode ? (result.errorCode >>> 0) : 0,
          pid: result.pid ? (result.pid >>> 0) : 0
        };
      },

      buildSharedThreadState() {
        if (!this.cpu || !(this.cpu.mem instanceof Uint8Array)) {
          return null;
        }
        return {
          sharedMem: this.cpu.mem,
          sharedView: this.cpu.view instanceof DataView ? this.cpu.view : null,
          memLimit: this.memLimit >>> 0,
          processReservedSize: this.processReservedSize >>> 0,
          currentFolder: this.currentFolder || "/sys",
          additionalSystemDirs: new Map(this.additionalSystemDirs || []),
          hostCallStubs: this.hostCallStubs instanceof Map ? this.hostCallStubs : new Map(),
          loadedHostLibraries: this.loadedHostLibraries instanceof Map ? this.loadedHostLibraries : new Map(),
          loadedDllLibraries: this.loadedDllLibraries instanceof Map ? this.loadedDllLibraries : new Map(),
          hostLibimgImages: this.hostLibimgImages instanceof Map ? this.hostLibimgImages : new Map(),
          futexState: this.futexState && this.futexState.handles instanceof Map
            ? this.futexState
            : { nextHandle: 1, handles: new Map() },
          threadPriority: this.threadPriority >>> 0
        };
      },

      createHostThread(entry, stack) {
        const result = this.callHostSession(
          "createThread",
          [{
            parentThreadSlot: this.threadSlot >>> 0,
            parentPid: this.processId >>> 0,
            entry: entry >>> 0,
            stack: stack >>> 0,
            image: this.image || null,
            processPath: this.processPathOverride || "",
            processArgs: this.processArgs || "",
            sharedState: this.buildSharedThreadState()
          }],
          { tid: 0xffffffff >>> 0 },
          "createThread"
        ) || {};
        return result.tid ? (result.tid >>> 0) : (0xffffffff >>> 0);
      },

      setHostIpcArea(bufferPtr, size) {
        this.ipcBufferPtr = bufferPtr >>> 0;
        this.ipcBufferSize = size >>> 0;
        return 0;
      },

      sendHostIpcMessage(targetPid, srcPtr, length) {
        const pid = targetPid >>> 0;
        if (!pid) {
          return 4;
        }
        const size = length >>> 0;
        const data = size ? (this.readMemBlock(srcPtr >>> 0, size) || new Uint8Array(0)) : new Uint8Array(0);
        if (size && data.length !== size) {
          return 3;
        }
        return (this.callHostSession(
          "sendIpcMessage",
          [{
            senderPid: this.processId >>> 0,
            targetPid: pid >>> 0,
            data
          }],
          4,
          `sendIpcMessage for pid ${pid}`
        ) | 0) >>> 0;
      },

      wakeHostSiblingThreads(forceWake) {
        this.callHostSession(
          "wakeSiblingThreads",
          [this.threadSlot >>> 0, !!forceWake],
          undefined,
          "wakeSiblingThreads"
        );
      },

      autoFitContentRect(x, y, width, height) {
        if (!this.autoFitWindow || this.windowDefined) {
          return;
        }
        const w = width | 0;
        const h = height | 0;
        if (w <= 0 || h <= 0) {
          return;
        }
        const right = ((x | 0) + w) | 0;
        const bottom = ((y | 0) + h) | 0;
        const fitWidth = Math.max(this.windowWidth | 0, right);
        const fitHeight = Math.max(this.windowHeight | 0, bottom);
        this.notifyWindowSize(fitWidth, fitHeight);
      },

      resetSkinTheme() {
        this.skin = null;
        this.skinPath = "/sys/default.skn";
        this.skinReady = false;
        this.skinHeight = 18;
        this.skinMarginLeft = 4;
        this.skinMarginRight = 4;
        this.skinMarginTop = 3;
        this.skinMarginBottom = 3;
        this.skinColorTableBytes = FALLBACK_COLOR_TABLE ? new Uint8Array(FALLBACK_COLOR_TABLE) : new Uint8Array(40);
      },

      applySkinTheme(skin, path) {
        if (!skin) {
          return false;
        }
        this.skin = skin;
        this.skinReady = true;
        this.skinHeight = Math.max(1, skin.height | 0);
        this.skinMarginLeft = skin.margins.left | 0;
        this.skinMarginRight = skin.margins.right | 0;
        this.skinMarginTop = skin.margins.top | 0;
        this.skinMarginBottom = skin.margins.bottom | 0;
        this.skinColorTableBytes = new Uint8Array(skin.colorTableBytes);
        if (path) {
          this.skinPath = String(path);
        }
        return true;
      },

      isDefaultSkinPath(path) {
        const normalized = String(path || "").replace(/\\/g, "/").toLowerCase();
        return (
          normalized === "default.skn" ||
          normalized === "/sys/default.skn" ||
          normalized.endsWith("/default.skn")
        );
      },

      loadSkinThemeData(data, path) {
        try {
          const skin = parseSkinBuffer(data, path || "theme.skn");
          this.applySkinTheme(skin, path);
          return 0;
        } catch (err) {
          this.log(`Skin load failed${path ? ` for '${path}'` : ""}: ${err instanceof Error ? err.message : String(err)}`);
          return 3;
        }
      },

      loadBuiltInSkinTheme(path) {
        try {
          const skin = getDefaultSkin ? getDefaultSkin() : parseSkinBuffer(getDefaultSkinBytes(), path || "DEFAULT.SKN");
          this.applySkinTheme(skin, path || "/sys/default.skn");
          return 0;
        } catch (err) {
          this.log(`Built-in skin load failed: ${err instanceof Error ? err.message : String(err)}`);
          return 3;
        }
      },

      loadSkinTheme(path) {
        const nextPath = String(path || this.skinPath || "/sys/default.skn");
        const variants = [nextPath];
        const normalized = nextPath.replace(/\\/g, "/");
        if (normalized !== nextPath) {
          variants.push(normalized);
        }
        const upper = normalized.toUpperCase();
        if (upper !== normalized) {
          variants.push(upper);
        }
        for (let i = 0; i < variants.length; i += 1) {
          const candidate = variants[i];
          const data = this.loadHostFile(candidate);
          if (data && data.length) {
            const result = this.loadSkinThemeData(data, candidate);
            if (result === 0) {
              return 0;
            }
            return result;
          }
        }
        if (this.isDefaultSkinPath(nextPath)) {
          return this.loadBuiltInSkinTheme(nextPath);
        }
        return 1;
      },

      ensureSkinThemeLoaded() {
        if (this.skinReady) {
          return true;
        }
        this.skinReady = true;
        return this.loadSkinTheme(this.skinPath) === 0;
      },

      getSkinMarginsPackedX() {
        return (((this.skinMarginLeft & 0xffff) << 16) | (this.skinMarginRight & 0xffff)) >>> 0;
      },

      getSkinMarginsPackedY() {
        return (((this.skinMarginTop & 0xffff) << 16) | (this.skinMarginBottom & 0xffff)) >>> 0;
      },

      getSkinColorTableBytes() {
        this.ensureSkinThemeLoaded();
        return this.skinColorTableBytes || new Uint8Array(0);
      },

      setSkinColorTable(bytes) {
        const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
        const base = this.skinColorTableBytes && this.skinColorTableBytes.length
          ? this.skinColorTableBytes
          : (FALLBACK_COLOR_TABLE || new Uint8Array(40));
        const next = new Uint8Array(Math.max(base.length, source.length, 40));
        next.set(base.subarray(0, Math.min(base.length, next.length)));
        next.set(source.subarray(0, Math.min(source.length, next.length)));
        this.skinColorTableBytes = next;
      },

      drawSkinBitmap(bitmap, x, y, limitWidth) {
        if (!bitmap) {
          return;
        }
        const drawWidth = limitWidth > 0 ? Math.min(bitmap.width, limitWidth) : bitmap.width;
        for (let yy = 0; yy < bitmap.height; yy += 1) {
          const row = yy * bitmap.width;
          for (let xx = 0; xx < drawWidth; xx += 1) {
            this.surface.setPixel((x + xx) | 0, (y + yy) | 0, bitmap.pixels[row + xx] >>> 0);
          }
        }
      },

      drawSkinBitmapTiled(bitmap, x, y, width) {
        if (!bitmap || width <= 0) {
          return;
        }
        for (let offset = 0; offset < width; offset += bitmap.width) {
          this.drawSkinBitmap(bitmap, x + offset, y, width - offset);
        }
      },

      drawWindowSkin(originX, originY, width, height, active) {
        if (!this.ensureSkinThemeLoaded() || !this.skin) {
          return false;
        }
        const palette = active === false ? this.skin.inactive : this.skin.active;
        const bitmaps = active === false ? this.skin.bitmaps.inactive : this.skin.bitmaps.active;
        const outer = palette.outer >>> 0;
        const frame = palette.frame >>> 0;
        const inner = palette.inner >>> 0;
        this.fillRect(originX, originY, width, 1, outer);
        this.fillRect(originX, originY, 1, height, outer);
        this.fillRect(originX + width - 1, originY, 1, height, outer);
        this.fillRect(originX, originY + height - 1, width, 1, outer);
        for (let inset = 1; inset <= 3; inset += 1) {
          const x0 = originX + inset;
          const y0 = originY + inset;
          const w0 = width - inset * 2;
          const h0 = height - inset * 2;
          if (w0 <= 0 || h0 <= 0) {
            break;
          }
          this.fillRect(x0, y0, w0, 1, frame);
          this.fillRect(x0, y0, 1, h0, frame);
          this.fillRect(x0 + w0 - 1, y0, 1, h0, frame);
          this.fillRect(x0, y0 + h0 - 1, w0, 1, frame);
        }
        if (height > this.skinHeight + 4 && width > 8) {
          const clientX = originX + 4;
          const clientY = originY + this.skinHeight;
          const clientW = width - 8;
          const clientH = height - this.skinHeight - 4;
          this.fillRect(clientX, clientY, clientW, 1, inner);
          this.fillRect(clientX, clientY, 1, clientH, inner);
          this.fillRect(clientX + clientW - 1, clientY, 1, clientH, inner);
          this.fillRect(clientX, clientY + clientH - 1, clientW, 1, inner);
        }
        const leftWidth = bitmaps.left ? bitmaps.left.width : 0;
        const operWidth = bitmaps.oper ? bitmaps.oper.width : 0;
        if (bitmaps.left) {
          this.drawSkinBitmap(bitmaps.left, originX, originY, width);
        }
        const middleWidth = Math.max(0, width - leftWidth - operWidth);
        if (bitmaps.base && middleWidth > 0) {
          this.drawSkinBitmapTiled(bitmaps.base, originX + leftWidth, originY, middleWidth);
        }
        if (bitmaps.oper) {
          this.drawSkinBitmap(bitmaps.oper, originX + Math.max(0, width - operWidth), originY, width);
        }
        return true;
      },

      drawWindowTitle(title, originX, originY, width, active) {
        const text = String(title || "");
        if (!text) {
          return;
        }
        this.ensureSkinThemeLoaded();
        const colorBytes = this.getSkinColorTableBytes();
        const colorsView = new DataView(colorBytes.buffer, colorBytes.byteOffset, colorBytes.byteLength);
        const color = colorBytes.length >= 20 ? (colorsView.getUint32(16, true) & 0x00ffffff) : 0xffffff;
        const marginLeft = this.skinMarginLeft | 0;
        const marginRight = this.skinMarginRight | 0;
        const availableWidth = Math.max(0, width - marginLeft - marginRight);
        if (availableWidth <= 0) {
          return;
        }
        let visible = text;
        let textInfo = getTextInfoFromString(visible, 0);
        const maxChars = Math.max(1, Math.floor(availableWidth / Math.max(1, textInfo.cellWidth)));
        if (visible.length > maxChars) {
          visible = visible.slice(0, maxChars);
          textInfo = getTextInfoFromString(visible, 0);
        }
        const metrics = measureKolibriText(textInfo, 1);
        const availableHeight = Math.max(1, this.skinHeight - this.skinMarginTop - this.skinMarginBottom);
        const y = originY + this.skinMarginTop + Math.max(0, Math.floor((availableHeight - metrics.height) / 2));
        drawKolibriText(this.surface, originX + marginLeft, y, color, textInfo, 1);
      },

      fillRect(x, y, w, h, color) {
        if (w <= 0 || h <= 0) {
          return;
        }
        const x0 = Math.max(0, x | 0);
        const y0 = Math.max(0, y | 0);
        const x1 = Math.min(this.surface.width, (x + w) | 0);
        const y1 = Math.min(this.surface.height, (y + h) | 0);
        if (x1 <= x0 || y1 <= y0) {
          return;
        }
        for (let yy = y0; yy < y1; yy += 1) {
          for (let xx = x0; xx < x1; xx += 1) {
            this.surface.setPixel(xx, yy, color);
          }
        }
      },

      requestYield(delayMs, mode, options) {
        const skipPresentFlush = !!(options && options.skipPresentFlush);
        this.yieldRequested = true;
        this.yieldMode = mode ? String(mode) : "yield";
        if (delayMs > this.yieldDelay) {
          this.yieldDelay = delayMs;
        }
        if (!skipPresentFlush && this.surfaceDirty && !this.inRedraw) {
          this.presentIfNeeded(true);
        }
      },

      wakeExecution(forceWake) {
        if (!this.running) {
          return;
        }
        if (!forceWake && this.timer && this.yieldMode === "sleep") {
          return;
        }
        if (this.yieldMode === "present") {
          this.yieldMode = "";
        }
        if (typeof this.cancelScheduledStep === "function") {
          this.cancelScheduledStep();
        } else if (this.timer) {
          clearTimeout(this.timer);
          this.timer = null;
        }
        this.scheduleStep(0);
      },

      handleInterrupt(intno) {
        if (intno !== 0x40) {
          this.log(`Unhandled interrupt ${intno}`);
          this.requestYield(0);
          return;
        }
        this.handleSyscall();
      },

      readCString(addr, maxLen) {
        const start = addr >>> 0;
        const limit = maxLen || 512;
        let out = "";
        for (let i = 0; i < limit; i += 1) {
          const b = this.readMem8((start + i) >>> 0);
          if (b === 0) {
            break;
          }
          out += String.fromCharCode(b);
        }
        return out;
      },

      readCStringEncoded(addr, maxLen, encoding) {
        const start = addr >>> 0;
        const limit = Math.max(1, maxLen | 0 || 512);
        let enc = encoding | 0;
        let offset = start;
        let remaining = limit;
        if (enc === 0) {
          const marker = this.readMem8(start) & 0xff;
          if (marker >= 1 && marker <= 3) {
            enc = marker;
            offset = (start + 1) >>> 0;
            remaining = Math.max(1, limit - 1) | 0;
          } else {
            enc = 1;
          }
        }
        const bytes = this.readMemBlock(offset, remaining) || new Uint8Array(0);
        if (enc === 2) {
          return decodeUtf16Z(bytes);
        }
        if (enc === 3) {
          return decodeUtf8Z(bytes);
        }
        return decodeCp866Z(bytes);
      },

      writeCString(addr, text, maxLen) {
        const start = addr >>> 0;
        const str = text ? String(text) : "";
        const limit = maxLen || (str.length + 1);
        const bytes = new Uint8Array(Math.min(limit, str.length + 1));
        const maxChars = Math.max(0, bytes.length - 1);
        for (let i = 0; i < maxChars; i += 1) {
          bytes[i] = str.charCodeAt(i) & 0xff;
        }
        bytes[bytes.length - 1] = 0;
        this.writeMemBlock(start, bytes);
      },

      sanitizeKosPath(path) {
        if (!path) {
          return "";
        }
        let text = String(path).replace(/\\/g, "/").trim();
        if (!text) {
          return "";
        }
        const first = text.charCodeAt(0);
        if (first >= 1 && first <= 3) {
          text = text.slice(1);
        } else if (text.startsWith("/") && text.length > 1) {
          const second = text.charCodeAt(1);
          if (second >= 1 && second <= 3) {
            text = "/" + text.slice(2);
          }
        }
        return text.replace(/\/+/g, "/");
      },

      normalizeKosPath(path) {
        const raw = this.sanitizeKosPath(path);
        if (!raw) {
          return this.currentFolder || "/sys";
        }
        const absolute = raw.startsWith("/");
        const base = absolute ? raw : `${this.currentFolder || "/sys"}/${raw}`;
        const parts = base.split("/");
        const normalized = [];
        for (let i = 0; i < parts.length; i += 1) {
          const part = parts[i];
          if (!part || part === ".") {
            continue;
          }
          if (part === "..") {
            if (normalized.length) {
              normalized.pop();
            }
            continue;
          }
          normalized.push(part);
        }
        return normalized.length ? `/${normalized.join("/")}` : "/";
      },

      resolveKosPath(path) {
        const normalized = this.normalizeKosPath(path);
        if (normalized === "/") {
          return normalized;
        }
        const parts = normalized.slice(1).split("/");
        const head = (parts[0] || "").toLowerCase();
        if (head && this.additionalSystemDirs && this.additionalSystemDirs.has(head)) {
          const mapped = this.additionalSystemDirs.get(head) || "/";
          const tail = parts.slice(1).join("/");
          return this.normalizeKosPath(tail ? `${mapped}/${tail}` : mapped);
        }
        return normalized;
      },

      ensureNamedMemoryStore() {
        if (!this.namedMemoryAreas) {
          this.namedMemoryAreas = new Map();
        }
        return this.namedMemoryAreas;
      },

      normalizeNamedMemoryName(name) {
        if (!name) {
          return "";
        }
        const text = String(name);
        const zeroIndex = text.indexOf("\0");
        const normalized = zeroIndex >= 0 ? text.slice(0, zeroIndex) : text;
        return normalized.slice(0, 31);
      },

      isBootstrapNamedMemoryName(name) {
        const key = this.normalizeNamedMemoryName(name);
        return key === "ICONS32" || key === "ICONS18" || key === "ICONS18W" || key === "CHECKBOX";
      },

      getNamedMemoryRequestedSize(entry) {
        if (!entry) {
          return 0;
        }
        const requested = entry.requestedSize >>> 0;
        if (requested) {
          return requested >>> 0;
        }
        return entry.size >>> 0;
      },

      getNamedMemoryMappings(entry) {
        if (!entry) {
          return new Map();
        }
        if (!(entry.mappings instanceof Map)) {
          entry.mappings = new Map();
        }
        return entry.mappings;
      },

      getNamedMemoryProcessEmulator(pid) {
        const targetPid = pid >>> 0;
        if (!targetPid) {
          return null;
        }
        if (targetPid === (this.processId >>> 0)) {
          return this;
        }
        const session = this.hostSession || null;
        if (!session || !(session.processByPid instanceof Map)) {
          return null;
        }
        const process = session.processByPid.get(targetPid) || null;
        return process && !process.removed && process.emulator ? process.emulator : null;
      },

      getNamedMemoryEffectiveAccess(entry, mapping, pid) {
        if (!entry) {
          return 0;
        }
        const targetPid = pid >>> 0;
        const mappedAccess = mapping ? (mapping.access | 0) : 0;
        if (targetPid && targetPid === (entry.ownerPid >>> 0)) {
          return (mappedAccess | (entry.ownerAccess | 0)) & 0x01;
        }
        return mappedAccess & 0x01;
      },

      syncNamedMemoryAreaFromPid(entry, pid) {
        if (!entry) {
          return false;
        }
        const mappings = this.getNamedMemoryMappings(entry);
        const mapping = mappings.get(pid >>> 0) || null;
        if (!mapping || !mapping.ptr) {
          return false;
        }
        const emulator = this.getNamedMemoryProcessEmulator(pid >>> 0);
        if (!emulator || typeof emulator.readMemBlock !== "function") {
          mappings.delete(pid >>> 0);
          return false;
        }
        const size = entry.size >>> 0;
        if (!size) {
          return false;
        }
        const bytes = emulator.readMemBlock(mapping.ptr >>> 0, size) || null;
        if (!(bytes instanceof Uint8Array) || !bytes.length) {
          return false;
        }
        if (!(entry.data instanceof Uint8Array) || entry.data.length !== size) {
          entry.data = new Uint8Array(size);
        }
        entry.data.fill(0);
        entry.data.set(bytes.subarray(0, Math.min(size, bytes.length)));
        return true;
      },

      syncNamedMemoryAreaToPid(entry, pid) {
        if (!entry) {
          return false;
        }
        const mappings = this.getNamedMemoryMappings(entry);
        const mapping = mappings.get(pid >>> 0) || null;
        if (!mapping || !mapping.ptr) {
          return false;
        }
        const emulator = this.getNamedMemoryProcessEmulator(pid >>> 0);
        if (!emulator || typeof emulator.writeMemBlock !== "function") {
          mappings.delete(pid >>> 0);
          return false;
        }
        const size = entry.size >>> 0;
        if (!size || !(entry.data instanceof Uint8Array) || !entry.data.length) {
          return false;
        }
        emulator.writeMemBlock(
          mapping.ptr >>> 0,
          entry.data.subarray(0, Math.min(entry.data.length, size))
        );
        return true;
      },

      syncNamedMemoryAreaToOtherMappings(entry, excludePid) {
        if (!entry) {
          return false;
        }
        const skipPid = excludePid >>> 0;
        let synced = false;
        const mappings = this.getNamedMemoryMappings(entry);
        for (const [pid, mapping] of mappings.entries()) {
          if ((pid >>> 0) === skipPid || !mapping || !mapping.ptr) {
            continue;
          }
          if (this.syncNamedMemoryAreaToPid(entry, pid >>> 0)) {
            synced = true;
          }
        }
        return synced;
      },

      syncNamedMemoryAreaData(entry) {
        if (!entry) {
          return false;
        }
        const lastWriterPid = entry.lastWriterPid >>> 0;
        if (lastWriterPid && this.syncNamedMemoryAreaFromPid(entry, lastWriterPid)) {
          return true;
        }
        const ownerPid = entry.ownerPid >>> 0;
        if (ownerPid && ownerPid !== lastWriterPid && this.syncNamedMemoryAreaFromPid(entry, ownerPid)) {
          return true;
        }
        const mappings = this.getNamedMemoryMappings(entry);
        for (const [pid, mapping] of mappings.entries()) {
          if (pid === lastWriterPid || pid === ownerPid || !mapping || ((mapping.access | 0) & 0x01) === 0) {
            continue;
          }
          if (this.syncNamedMemoryAreaFromPid(entry, pid >>> 0)) {
            return true;
          }
        }
        for (const [pid] of mappings.entries()) {
          if (pid === lastWriterPid || pid === ownerPid) {
            continue;
          }
          if (this.syncNamedMemoryAreaFromPid(entry, pid >>> 0)) {
            return true;
          }
        }
        return entry.data instanceof Uint8Array && entry.data.length === (entry.size >>> 0);
      },

      syncOwnedNamedMemoryAreas() {
        const pid = this.processId >>> 0;
        if (!pid) {
          return;
        }
        const areas = this.ensureNamedMemoryStore();
        for (const entry of areas.values()) {
          const mappings = entry && entry.mappings instanceof Map ? entry.mappings : null;
          if (!mappings || !mappings.has(pid)) {
            continue;
          }
          const mapping = mappings.get(pid) || null;
          if (!this.syncNamedMemoryAreaFromPid(entry, pid)) {
            continue;
          }
          if ((this.getNamedMemoryEffectiveAccess(entry, mapping, pid) & 0x01) !== 0) {
            entry.lastWriterPid = pid >>> 0;
          }
          this.syncNamedMemoryAreaToOtherMappings(entry, pid);
        }
      },

      mapNamedMemoryAreaForCurrentProcess(entry, requestedAccess) {
        if (!entry) {
          return null;
        }
        const pid = this.processId >>> 0;
        if (!pid) {
          return null;
        }
        const size = entry.size >>> 0;
        if (!size) {
          return null;
        }
        this.syncNamedMemoryAreaData(entry);
        const mappings = this.getNamedMemoryMappings(entry);
        let mapping = mappings.get(pid) || null;
        if (!mapping) {
          if (!this.heapEnabled) {
            this.heapInit();
          }
          const ptr = this.heapAllocInternal(size);
          if (!ptr) {
            return null;
          }
          mapping = {
            ptr: ptr >>> 0,
            size: size >>> 0,
            access: requestedAccess & 0x01
          };
          mappings.set(pid, mapping);
        } else {
          mapping.access = ((mapping.access | 0) | (requestedAccess & 0x01)) & 0x01;
        }
        if (entry.data instanceof Uint8Array && entry.data.length) {
          this.writeMemBlock(mapping.ptr >>> 0, entry.data.subarray(0, Math.min(entry.data.length, size)));
        }
        if ((requestedAccess & 0x01) !== 0) {
          entry.lastWriterPid = pid >>> 0;
        }
        entry.ptr = mapping.ptr >>> 0;
        return mapping;
      },

      releaseProcessNamedMemoryMappings() {
        const pid = this.processId >>> 0;
        if (!pid) {
          return;
        }
        const areas = this.ensureNamedMemoryStore();
        for (const entry of areas.values()) {
          const mappings = entry && entry.mappings instanceof Map ? entry.mappings : null;
          if (!mappings) {
            continue;
          }
          const mapping = mappings.get(pid) || null;
          if (!mapping) {
            continue;
          }
          this.syncNamedMemoryAreaFromPid(entry, pid);
          mappings.delete(pid);
          if ((entry.lastWriterPid >>> 0) === pid) {
            entry.lastWriterPid = 0;
          }
          if ((entry.ownerPid >>> 0) === pid) {
            entry.ownerPid = 0;
          }
          if ((entry.ptr >>> 0) === (mapping.ptr >>> 0)) {
            entry.ptr = 0;
          }
        }
      },

      ensureHostNamedMemoryArea(name) {
        const key = this.normalizeNamedMemoryName(name);
        if (!key || !this.isBootstrapNamedMemoryName(key)) {
          return this.getNamedMemoryArea(key);
        }
        let entry = this.getNamedMemoryArea(key);
        const session = this.hostSession || null;
        const ready = session && typeof session.isNamedMemoryAreaReady === "function"
          ? !!session.isNamedMemoryAreaReady(key)
          : !!(entry && entry.data instanceof Uint8Array && entry.data.length);
        if (entry && ready) {
          return entry;
        }
        if (session && typeof session.ensureNamedMemoryArea === "function") {
          try {
            entry = session.ensureNamedMemoryArea(key) || null;
          } catch (err) {
            this.log(`Named memory bootstrap failed for '${key}': ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        return entry || this.getNamedMemoryArea(key);
      },

      getNamedMemoryArea(name) {
        const key = this.normalizeNamedMemoryName(name);
        if (!key) {
          return null;
        }
        return this.ensureNamedMemoryStore().get(key) || null;
      },

      createNamedMemoryArea(name, size, access, options) {
        const key = this.normalizeNamedMemoryName(name);
        const requestSize = size >>> 0;
        if (!key || !requestSize) {
          return null;
        }
        const areas = this.ensureNamedMemoryStore();
        if (areas.has(key)) {
          return areas.get(key) || null;
        }
        if (!this.heapEnabled) {
          this.heapInit();
        }
        if (!this.heapEnabled) {
          return null;
        }
        const allocSize = align4k(requestSize);
        if (!allocSize) {
          return null;
        }
        const ptr = this.heapAllocInternal(allocSize);
        if (!ptr) {
          return null;
        }
        const config = options || {};
        const ownerPid = this.processId >>> 0;
        const accessMode = access & 0x1;
        const dataBytes = new Uint8Array(allocSize);
        const entry = {
          name: key,
          ptr: ptr >>> 0,
          size: allocSize >>> 0,
          requestedSize: requestSize >>> 0,
          access: accessMode,
          ownerAccess: config.ownerAccess === undefined ? accessMode : (config.ownerAccess & 0x1),
          refCount: 0,
          persistent: !!config.persistent,
          ownerPid: ownerPid >>> 0,
          lastWriterPid: accessMode ? (ownerPid >>> 0) : 0,
          data: dataBytes,
          mappings: new Map()
        };
        const data = config.data;
        if (data instanceof Uint8Array) {
          dataBytes.set(data.subarray(0, Math.min(data.length, allocSize)));
        } else if (ArrayBuffer.isView(data)) {
          const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          dataBytes.set(view.subarray(0, Math.min(view.length, allocSize)));
        } else if (data instanceof ArrayBuffer) {
          const view = new Uint8Array(data);
          dataBytes.set(view.subarray(0, Math.min(view.length, allocSize)));
        }
        if (dataBytes.length) {
          this.writeMemBlock(ptr, dataBytes);
        }
        entry.mappings.set(ownerPid >>> 0, {
          ptr: ptr >>> 0,
          size: allocSize >>> 0,
          access: accessMode
        });
        areas.set(key, entry);
        return entry;
      },

      retainNamedMemoryArea(name) {
        const entry = this.getNamedMemoryArea(name);
        if (!entry) {
          return null;
        }
        entry.refCount = ((entry.refCount >>> 0) + 1) >>> 0;
        return entry;
      },

      releaseNamedMemoryArea(name) {
        const entry = this.getNamedMemoryArea(name);
        if (!entry) {
          return false;
        }
        const pid = this.processId >>> 0;
        if (pid) {
          const mappings = this.getNamedMemoryMappings(entry);
          const mapping = mappings.get(pid) || null;
          if (this.syncNamedMemoryAreaFromPid(entry, pid)) {
            if ((this.getNamedMemoryEffectiveAccess(entry, mapping, pid) & 0x01) !== 0) {
              entry.lastWriterPid = pid >>> 0;
            }
            this.syncNamedMemoryAreaToOtherMappings(entry, pid);
          }
        }
        const nextRefCount = Math.max(0, (entry.refCount >>> 0) - 1) >>> 0;
        entry.refCount = nextRefCount;
        if (nextRefCount === 0 && !entry.persistent) {
          this.ensureNamedMemoryStore().delete(entry.name);
        }
        return true;
      },

      freeHeapBlock(ptr) {
        const addr = ptr >>> 0;
        if (!addr || !(this.heapAllocs instanceof Map) || !this.heapAllocs.has(addr)) {
          return false;
        }
        const size = this.heapAllocs.get(addr) >>> 0;
        this.heapAllocs.delete(addr);
        this.heapInsertFreeBlock(addr >>> 0, size >>> 0);
        return true;
      },

      readFsPath(infoPtr, options) {
        const opts = options || {};
        if (opts.encoded) {
          const encoding = this.readMem32((infoPtr + 0x14) >>> 0) & 0xff;
          const ptr = this.readMem32((infoPtr + 0x18) >>> 0) >>> 0;
          return ptr ? this.readCStringEncoded(ptr, 4096, encoding) : "";
        }
        const base = (infoPtr + 0x14) >>> 0;
        const marker = this.readMem8(base);
        if (marker === 0) {
          const ptr = this.readMem32((base + 1) >>> 0) >>> 0;
          return ptr ? this.readCString(ptr, 4096) : "";
        }
        return this.readCString(base, 4096);
      },

      loadHostFile(path) {
        if (!this.fileProvider || !path) {
          return null;
        }
        const resolvedPath = this.resolveKosPath(path);
        try {
          const data = this.fileProvider(resolvedPath);
          if (!data) {
            return null;
          }
          if (data instanceof Uint8Array) {
            return data;
          }
          if (data instanceof ArrayBuffer) {
            return new Uint8Array(data);
          }
          if (ArrayBuffer.isView(data)) {
            return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          }
        } catch (err) {
          this.log(`File provider error for '${resolvedPath}': ${err}`);
        }
        return null;
      },

      async loadHostFileAsync(path) {
        if (!path) {
          return null;
        }
        const resolvedPath = this.resolveKosPath(path);
        const provider = typeof this.fileProviderAsync === "function"
          ? this.fileProviderAsync
          : null;
        if (!provider) {
          return this.loadHostFile(resolvedPath);
        }
        try {
          const data = await provider(resolvedPath);
          if (!data) {
            return null;
          }
          if (data instanceof Uint8Array) {
            return data;
          }
          if (data instanceof ArrayBuffer) {
            return new Uint8Array(data);
          }
          if (ArrayBuffer.isView(data)) {
            return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          }
        } catch (err) {
          this.log(`File provider error for '${resolvedPath}': ${err}`);
        }
        return null;
      },

      maybeUnpackHostFile(data, path) {
        if (!data || !data.length || typeof unpackKpck !== "function") {
          return data;
        }
        const source = data instanceof Uint8Array
          ? data
          : new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength || data.length || 0);
        if (source.length < 4) {
          return source;
        }
        try {
          const unpacked = unpackKpck(
            source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength)
          );
          if (!unpacked || !unpacked.packed) {
            return source;
          }
          return new Uint8Array(unpacked.buffer);
        } catch (err) {
          const resolvedPath = path ? this.resolveKosPath(path) : "";
          this.log(`KPCK unpack failed for '${resolvedPath || "<buffer>"}': ${err}`);
          return source;
        }
      },

      loadHostInfo(path, kind) {
        if (!this.fileInfoProvider || !path) {
          return null;
        }
        const resolvedPath = this.resolveKosPath(path);
        try {
          return this.fileInfoProvider(resolvedPath, kind || "stat") || null;
        } catch (err) {
          this.log(`File info provider error for '${resolvedPath}': ${err}`);
        }
        return null;
      },

      async loadHostInfoAsync(path, kind) {
        if (!path) {
          return null;
        }
        const resolvedPath = this.resolveKosPath(path);
        const provider = typeof this.fileInfoProviderAsync === "function"
          ? this.fileInfoProviderAsync
          : null;
        if (!provider) {
          return this.loadHostInfo(resolvedPath, kind);
        }
        try {
          return await provider(resolvedPath, kind || "stat") || null;
        } catch (err) {
          this.log(`File info provider error for '${resolvedPath}': ${err}`);
        }
        return null;
      },

      mutateHostPath(op, path, options) {
        if (!this.fileMutationProvider || !path) {
          return { errorCode: 2, written: 0 };
        }
        const resolvedPath = this.resolveKosPath(path);
        try {
          const result = this.fileMutationProvider(op, resolvedPath, options || {}) || null;
          if (typeof result === "number") {
            return {
              errorCode: result >>> 0,
              written: 0
            };
          }
          return {
            errorCode: result && result.errorCode !== undefined ? (result.errorCode >>> 0) : 0,
            written: result && result.written !== undefined ? (result.written >>> 0) : 0
          };
        } catch (err) {
          this.log(`File mutation provider error for '${resolvedPath}' (${op}): ${err}`);
          return { errorCode: 10, written: 0 };
        }
      },

      async mutateHostPathAsync(op, path, options) {
        if (!path) {
          return { errorCode: 2, written: 0 };
        }
        const resolvedPath = this.resolveKosPath(path);
        const provider = typeof this.fileMutationProviderAsync === "function"
          ? this.fileMutationProviderAsync
          : null;
        if (!provider) {
          return this.mutateHostPath(op, resolvedPath, options);
        }
        try {
          const result = await provider(op, resolvedPath, options || {});
          if (typeof result === "number") {
            return {
              errorCode: result >>> 0,
              written: 0
            };
          }
          return {
            errorCode: result && result.errorCode !== undefined ? (result.errorCode >>> 0) : 0,
            written: result && result.written !== undefined ? (result.written >>> 0) : 0
          };
        } catch (err) {
          this.log(`File mutation provider error for '${resolvedPath}' (${op}): ${err}`);
          return { errorCode: 10, written: 0 };
        }
      },

      createOrRewriteHostFile(path, data) {
        return this.mutateHostPath("create-file", path, { data });
      },

      createOrRewriteHostFileAsync(path, data) {
        return this.mutateHostPathAsync("create-file", path, { data });
      },

      writeExistingHostFile(path, offset, data) {
        return this.mutateHostPath("write-file", path, {
          offset: offset >>> 0,
          data
        });
      },

      writeExistingHostFileAsync(path, offset, data) {
        return this.mutateHostPathAsync("write-file", path, {
          offset: offset >>> 0,
          data
        });
      },

      setHostFileSize(path, size) {
        return this.mutateHostPath("set-end", path, { size: size >>> 0 });
      },

      setHostFileSizeAsync(path, size) {
        return this.mutateHostPathAsync("set-end", path, { size: size >>> 0 });
      },

      deleteHostPath(path) {
        return this.mutateHostPath("delete", path, {});
      },

      deleteHostPathAsync(path) {
        return this.mutateHostPathAsync("delete", path, {});
      },

      createHostFolder(path) {
        return this.mutateHostPath("create-folder", path, {});
      },

      createHostFolderAsync(path) {
        return this.mutateHostPathAsync("create-folder", path, {});
      },

      renameOrMoveHostPath(path, nextPath) {
        return this.mutateHostPath("move", path, { nextPath });
      },

      renameOrMoveHostPathAsync(path, nextPath) {
        return this.mutateHostPathAsync("move", path, { nextPath });
      },

      loadFileToHeap(path) {
        const data = this.maybeUnpackHostFile(this.loadHostFile(path), path);
        if (!data || !data.length) {
          return null;
        }
        if (!this.heapEnabled) {
          this.heapInit();
        }
        const size = data.length >>> 0;
        const allocSize = align4k(size);
        const ptr = this.heapAllocInternal(allocSize);
        if (!ptr) {
          return null;
        }
        this.writeMemBlock(ptr, data);
        return { ptr: ptr >>> 0, size };
      },

      ensureMemoryCapacity(requiredEnd) {
        if (!this.cpu) {
          return false;
        }
        const needed = align4k(requiredEnd >>> 0);
        const current = this.cpu.mem.length >>> 0;
        if (needed <= current) {
          return true;
        }
        let nextSize = current;
        while (nextSize < needed) {
          nextSize = Math.max(nextSize * 2, needed);
        }
        nextSize = align4k(nextSize);
        const max = this.memGrowMax >>> 0;
        if (max && nextSize > max) {
          return false;
        }
        const nextMem = new Uint8Array(nextSize);
        nextMem.set(this.cpu.mem);
        this.cpu.mem = nextMem;
        this.cpu.view = new DataView(nextMem.buffer);
        this.memLimit = nextSize >>> 0;
        if (this.heapEnabled) {
          this.heapLowSize = Math.max(0, nextSize - (this.heapLowBase >>> 0)) >>> 0;
          this.heapSize = this.heapLowSize >>> 0;
          this.heapHighBase = 0;
          this.heapHighTop = 0;
          this.heapHighSize = 0;
        }
        if (this.traceSyscalls) {
          this.log(`memory grow -> ${formatBytes(nextSize)}`);
        }
        return true;
      }
    
    });
  }

  KosEmu.emu.installEmulatorHost = installEmulatorHost;
})();

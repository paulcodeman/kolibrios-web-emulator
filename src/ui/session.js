(function initSessionShared(root, factory) {
  const shared = factory();
  if (typeof module === "object" && module && module.exports) {
    module.exports = shared;
  }
  const globalRoot = root || (typeof globalThis !== "undefined" ? globalThis : this);
  if (!globalRoot) {
    return;
  }
  const KosEmu = globalRoot.KosEmu || (globalRoot.KosEmu = {});
  const ui = KosEmu.ui || (KosEmu.ui = {});
  ui.sessionShared = shared;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const DEBUG_BOARD_DEFAULT_CAPACITY = 512;
  const WINDOW_Z_DESKTOP = -2;
  const WINDOW_Z_ALWAYS_BACK = -1;
  const WINDOW_Z_ALWAYS_TOP = 1;

  function getWindowZRank(position) {
    switch (position | 0) {
      case WINDOW_Z_DESKTOP:
        return 0;
      case WINDOW_Z_ALWAYS_BACK:
        return 1;
      case WINDOW_Z_ALWAYS_TOP:
        return 3;
      default:
        return 2;
    }
  }

  function compareProcessZOrder(a, b) {
    const rankDiff = getWindowZRank(a && a.windowPositionMode) - getWindowZRank(b && b.windowPositionMode);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    return ((a && a.zOrder) | 0) - ((b && b.zOrder) | 0);
  }

  function getWindowStack(processes) {
    return processes
      .filter((process) => process && !process.removed)
      .slice()
      .sort((a, b) => compareProcessZOrder(b, a));
  }

  function getVisibleWindowStack(processes) {
    return processes
      .filter((process) => process && !process.removed && !process.minimized)
      .slice()
      .sort((a, b) => compareProcessZOrder(b, a));
  }

  function getWindowStackPositionSlots(processes) {
    return getWindowStack(processes)
      .map((process) => (process.slot >>> 0))
      .filter((slot) => slot > 0)
      .sort((a, b) => a - b);
  }

  function getWindowStackPosition(processes, slot) {
    const target = slot >>> 0;
    const stack = getWindowStack(processes);
    const positions = getWindowStackPositionSlots(processes);
    for (let i = 0; i < stack.length; i += 1) {
      if ((stack[i].slot >>> 0) === target) {
        const positionIndex = positions.length - 1 - i;
        return positionIndex >= 0 && positions[positionIndex]
          ? (positions[positionIndex] >>> 0)
          : 0;
      }
    }
    return 0;
  }

  function getWindowStackSlot(processes, position) {
    const stack = getWindowStack(processes);
    const positions = getWindowStackPositionSlots(processes);
    const target = position >>> 0;
    const positionIndex = positions.indexOf(target);
    if (positionIndex < 0) {
      return 0;
    }
    const stackIndex = positions.length - 1 - positionIndex;
    return stackIndex >= 0 && stack[stackIndex] ? (stack[stackIndex].slot >>> 0) : 0;
  }

  function getMaxThreadSlot(processes) {
    let maxSlot = 0;
    for (let i = 0; i < processes.length; i += 1) {
      const process = processes[i];
      if (!process || process.removed) {
        continue;
      }
      maxSlot = Math.max(maxSlot, process.slot | 0);
    }
    return Math.max(0, maxSlot | 0) >>> 0;
  }

  function createDebugBoardState(capacity) {
    const size = Math.max(1, capacity | 0 || DEBUG_BOARD_DEFAULT_CAPACITY);
    return {
      buffer: new Uint8Array(size),
      readIndex: 0,
      size: 0
    };
  }

  function resetDebugBoardState(state) {
    if (!state) {
      return;
    }
    state.readIndex = 0;
    state.size = 0;
  }

  function pushDebugBoardByte(state, value) {
    if (!state || !(state.buffer instanceof Uint8Array) || (state.buffer.length | 0) <= 0) {
      return false;
    }
    const capacity = state.buffer.length | 0;
    let size = state.size | 0;
    let readIndex = state.readIndex | 0;
    let writeIndex = ((readIndex + size) % capacity) | 0;
    if (size >= capacity) {
      writeIndex = readIndex;
      readIndex = ((readIndex + 1) % capacity) | 0;
      size = (capacity - 1) | 0;
    }
    state.buffer[writeIndex] = value & 0xff;
    state.readIndex = readIndex;
    state.size = (size + 1) | 0;
    return true;
  }

  function readDebugBoardByte(state) {
    if (!state || !(state.buffer instanceof Uint8Array) || (state.size | 0) <= 0) {
      return { hasByte: false, byte: 0 };
    }
    const byte = state.buffer[state.readIndex | 0] & 0xff;
    state.readIndex = (((state.readIndex | 0) + 1) % (state.buffer.length | 0)) | 0;
    state.size = Math.max(0, ((state.size | 0) - 1) | 0) | 0;
    return { hasByte: true, byte };
  }

  function writeDebugBoardText(state, text) {
    const source = String(text || "");
    for (let i = 0; i < source.length; i += 1) {
      const code = source.charCodeAt(i);
      pushDebugBoardByte(state, code >= 0 && code <= 0xff ? code : 0x3f);
    }
    return source.length | 0;
  }

  function classifyProcessLogSeverity(message) {
    const text = String(message || "");
    if (!text || /^debug:\s/i.test(text)) {
      return "";
    }
    if (
      /^Unhandled /.test(text) ||
      /^Interpreter error:/.test(text) ||
      /^Unknown opcode /.test(text) ||
      /^Unknown opcode handler /.test(text) ||
      /^Host session .* failed:/.test(text) ||
      /^Skin load failed/.test(text) ||
      /^Built-in skin load failed:/.test(text) ||
      /^File provider error /.test(text) ||
      /^File info provider error /.test(text) ||
      /^File mutation provider error /.test(text) ||
      /^KPCK unpack failed /.test(text) ||
      /^Named memory bootstrap failed /.test(text)
    ) {
      return "E";
    }
    return "";
  }

  function readSystemStyleState(fileProvider, options) {
    const opts = options || {};
    const defaultSkinPath = String(opts.defaultSkinPath || "/sys/default.skn");
    const defaultButtonStyle = (opts.defaultButtonStyle & 0xff) === 0 ? 0 : 1;
    const state = {
      skinPath: defaultSkinPath,
      buttonStyle: defaultButtonStyle,
      colorTableBytes: opts.defaultColorTableBytes instanceof Uint8Array
        ? opts.defaultColorTableBytes.slice()
        : null
    };
    if (typeof fileProvider !== "function") {
      return state;
    }
    const helpers = opts.helpers || null;
    const findIniValue = helpers && typeof helpers.findIniValue === "function"
      ? helpers.findIniValue
      : null;
    const parseIniIntString = helpers && typeof helpers.parseIniIntString === "function"
      ? helpers.parseIniIntString
      : null;
    if (!findIniValue) {
      return state;
    }
    let bytes = null;
    try {
      bytes = fileProvider(String(opts.iniPath || "/sys/settings/system.ini"));
    } catch (err) {
      bytes = null;
    }
    if (!(bytes instanceof Uint8Array) || !bytes.length) {
      return state;
    }
    const skinPath = findIniValue(bytes, "style", "skin");
    if (skinPath) {
      state.skinPath = String(skinPath);
    }
    const buttonStyle = parseIniIntString
      ? parseIniIntString(findIniValue(bytes, "style", "buttons_gradient"))
      : null;
    if (buttonStyle !== null) {
      state.buttonStyle = buttonStyle === 0 ? 0 : 1;
    }
    return state;
  }

  function wakeSiblingThreads(processes, threadGroupId, excludedSlot, forceWake) {
    const groupId = threadGroupId >>> 0;
    const excluded = excludedSlot >>> 0;
    for (let i = 0; i < processes.length; i += 1) {
      const process = processes[i];
      if (
        !process ||
        process.removed ||
        !process.emulator ||
        !process.emulator.running ||
        (process.slot >>> 0) === excluded ||
        (process.threadGroupId >>> 0) !== groupId
      ) {
        continue;
      }
      process.emulator.wakeExecution(!!forceWake);
    }
  }

  function queueSiblingRedraw(processes, threadGroupId, excludedSlot) {
    const groupId = threadGroupId >>> 0;
    const excluded = excludedSlot >>> 0;
    if (!groupId) {
      return;
    }
    for (let i = 0; i < processes.length; i += 1) {
      const process = processes[i];
      if (
        !process ||
        process.removed ||
        !process.emulator ||
        !process.emulator.running ||
        (process.slot >>> 0) === excluded ||
        (process.threadGroupId >>> 0) !== groupId
      ) {
        continue;
      }
      process.emulator.queueEvent(1);
      process.emulator.wakeExecution(true);
    }
  }

  return {
    classifyProcessLogSeverity,
    compareProcessZOrder,
    createDebugBoardState,
    getMaxThreadSlot,
    getVisibleWindowStack,
    getWindowStack,
    getWindowStackPosition,
    getWindowStackPositionSlots,
    getWindowStackSlot,
    getWindowZRank,
    readDebugBoardByte,
    readSystemStyleState,
    resetDebugBoardState,
    writeDebugBoardText,
    pushDebugBoardByte,
    queueSiblingRedraw,
    wakeSiblingThreads
  };
});

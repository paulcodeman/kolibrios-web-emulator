const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { createNodeFileProviders } = require("./kos-fs");
const { writeSurfacePng } = require("./surface-snapshot");

const DEFAULT_CPU_FREQ_HZ = 2400000000;
const DEFAULT_SYSTEM_RAM_BYTES = 512 * 1024 * 1024;
const DEFAULT_SYSTEM_RESERVED_RAM_BYTES = 16 * 1024 * 1024;
const DEFAULT_SYSTEM_SKIN_PATH = "/sys/default.skn";
const DEFAULT_SYSTEM_BUTTON_STYLE = 1;
const DEBUG_BOARD_CAPACITY = 512;
const SYSTEM_STYLE_INI_PATH = "/sys/settings/system.ini";

const REG = {
  EAX: 0,
  ECX: 1,
  EDX: 2,
  EBX: 3,
  ESP: 4,
  EBP: 5,
  ESI: 6,
  EDI: 7,
  EIP: 8,
  EFLAGS: 9
};

const SCRIPT_LIST = [
  "../src/boot.js",
  "../src/core/utils.js",
  "../src/core/loader.js",
  "../src/gfx/text.js",
  "../src/gfx/kolibri-font-assets.js",
  "../src/gfx/kolibri-font.js",
  "../src/gfx/kolibri-skin-assets.js",
  "../src/gfx/kolibri-skin.js",
  "../src/gfx/surface.js",
  "../src/emulator/core-access.js",
  "../src/emulator/host-libs/registry.js",
  "../src/emulator/host-libs/http.obj.js",
  "../src/emulator/host-libs/cnv_png.obj.js",
  "../src/emulator/host-libs/libimg.obj.js",
  "../src/emulator/host-libs/libini.obj.js",
  "../src/emulator/host-libs/runtime.js",
  "../src/emulator/emulator-host.js",
  "../src/emulator/core-runtime.js",
  "../src/emulator/core-execute.js",
  "../src/emulator/emulator-syscalls.js",
  "../src/emulator/emulator.js",
  "../src/ui/app-ui.js",
  "../src/app.js"
];

let runtimeLoaded = false;

function cloneBytes(data) {
  return data instanceof Uint8Array ? data.slice() : null;
}

function createDebugBoardState() {
  return {
    buffer: new Uint8Array(DEBUG_BOARD_CAPACITY),
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

function getIniHelpers() {
  const runtime = loadKosRuntime();
  const emu = runtime && runtime.emu ? runtime.emu : null;
  return emu && emu.hostLibHelpers ? emu.hostLibHelpers : null;
}

function readSystemStyleState(fileProvider) {
  const state = {
    skinPath: DEFAULT_SYSTEM_SKIN_PATH,
    buttonStyle: DEFAULT_SYSTEM_BUTTON_STYLE,
    colorTableBytes: null
  };
  if (typeof fileProvider !== "function") {
    return state;
  }
  const helpers = getIniHelpers();
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
    bytes = fileProvider(SYSTEM_STYLE_INI_PATH);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms | 0)));
}

function loadKosRuntime() {
  if (runtimeLoaded) {
    return global.KosEmu;
  }

  const lzma = require("../src/vendor/lzma_worker-min.js");
  if (lzma && lzma.LZMA) {
    global.LZMA = lzma.LZMA;
  }
  const fflate = require("../src/vendor/fflate-umd.js");
  if (fflate) {
    global.fflate = fflate;
  }

  for (const rel of SCRIPT_LIST) {
    const filePath = path.resolve(__dirname, rel);
    const code = fs.readFileSync(filePath, "utf8");
    vm.runInThisContext(code, { filename: rel });
  }

  runtimeLoaded = true;
  return global.KosEmu;
}

function readTargetImage(targetPath) {
  const { parseKex } = loadKosRuntime();
  const data = fs.readFileSync(targetPath);
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  return parseKex(buffer, path.basename(targetPath));
}

function loadScenarioFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function createDefaultFileProviders(targetPath, rootDir) {
  return createNodeFileProviders(targetPath, rootDir);
}

function createDefaultFileProvider(targetPath, rootDir) {
  return createDefaultFileProviders(targetPath, rootDir).fileProvider;
}

function createDefaultFileInfoProvider(targetPath, rootDir) {
  return createDefaultFileProviders(targetPath, rootDir).fileInfoProvider;
}

function createDefaultFileMutationProvider(targetPath, rootDir) {
  return createDefaultFileProviders(targetPath, rootDir).fileMutationProvider;
}

function buildExternalAppProcessPath(targetPath) {
  return `/app/${path.basename(String(targetPath || ""))}`;
}

function isShellScriptBytes(bytes) {
  if (!bytes || bytes.byteLength < 4) {
    return false;
  }
  const view = bytes instanceof Uint8Array
    ? bytes
    : new Uint8Array(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength || bytes.length || 0);
  return (
    view.length >= 4 &&
    view[0] === 0x23 &&
    view[1] === 0x53 &&
    view[2] === 0x48 &&
    view[3] === 0x53
  );
}

function toHex24(color) {
  return `0x${((color >>> 0) & 0x00ffffff).toString(16).padStart(6, "0")}`;
}

function parseNumberish(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 0);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function clampCodePoint(value) {
  const cp = value >>> 0;
  return cp > 0x10ffff ? 0xfffd : cp;
}

function unpackSignedHigh16(value) {
  return (value >> 16) | 0;
}

function unpackSignedLow16(value) {
  return ((value & 0xffff) << 16) >> 16;
}

function codePointsToString(codePoints) {
  let out = "";
  for (let i = 0; i < codePoints.length; i += 1) {
    out += String.fromCodePoint(clampCodePoint(codePoints[i]));
  }
  return out;
}

function decodeCp866(bytes, zeroTerm, maxChars) {
  const assets = loadKosRuntime().gfx.kolibriFontAssets || {};
  const map = assets.cp866CodePoints || [];
  const glyphs = [];
  const limit = Math.max(0, maxChars | 0);
  for (let i = 0; i < bytes.length && glyphs.length < limit; i += 1) {
    const value = bytes[i] & 0xff;
    if (zeroTerm && value === 0) {
      break;
    }
    glyphs.push((map[value] !== undefined ? map[value] : value) >>> 0);
  }
  return codePointsToString(glyphs);
}

function decodeUtf16Le(bytes, zeroTerm, maxChars) {
  const glyphs = [];
  const limit = Math.max(0, maxChars | 0);
  for (let i = 0; i + 1 < bytes.length && glyphs.length < limit; i += 2) {
    const value = (bytes[i] | (bytes[i + 1] << 8)) >>> 0;
    if (zeroTerm && value === 0) {
      break;
    }
    glyphs.push(value);
  }
  return codePointsToString(glyphs);
}

function decodeUtf8(bytes, zeroTerm, maxChars) {
  const glyphs = [];
  const limit = Math.max(0, maxChars | 0);
  let pos = 0;
  while (pos < bytes.length && glyphs.length < limit) {
    const b0 = bytes[pos] & 0xff;
    if (zeroTerm && b0 === 0) {
      break;
    }
    if (b0 < 0x80) {
      glyphs.push(b0);
      pos += 1;
      continue;
    }
    if ((b0 & 0xe0) === 0xc0 && pos + 1 < bytes.length) {
      glyphs.push((((b0 & 0x1f) << 6) | (bytes[pos + 1] & 0x3f)) >>> 0);
      pos += 2;
      continue;
    }
    if ((b0 & 0xf0) === 0xe0 && pos + 2 < bytes.length) {
      glyphs.push((((b0 & 0x0f) << 12) | ((bytes[pos + 1] & 0x3f) << 6) | (bytes[pos + 2] & 0x3f)) >>> 0);
      pos += 3;
      continue;
    }
    if ((b0 & 0xf8) === 0xf0 && pos + 3 < bytes.length) {
      glyphs.push(
        (((b0 & 0x07) << 18) | ((bytes[pos + 1] & 0x3f) << 12) | ((bytes[pos + 2] & 0x3f) << 6) | (bytes[pos + 3] & 0x3f)) >>> 0
      );
      pos += 4;
      continue;
    }
    glyphs.push(0xfffd);
    pos += 1;
  }
  return codePointsToString(glyphs);
}

function decodeTextBytes(bytes, zeroTerm, maxChars, fontMode) {
  const mode = fontMode & 3;
  if (mode === 0 || mode === 1) {
    return decodeCp866(bytes, zeroTerm, maxChars);
  }
  if (mode === 2) {
    return decodeUtf16Le(bytes, zeroTerm, maxChars);
  }
  return decodeUtf8(bytes, zeroTerm, maxChars);
}

function createHarnessDomKeyEvent(step, controlKeyMask) {
  const code = step && typeof step.code === "string" ? step.code : "";
  const key = step && typeof step.key === "string" ? step.key : "";
  const controlMask = controlKeyMask & 0x7ff;
  return {
    code,
    key,
    getModifierState(name) {
      switch (String(name || "")) {
        case "CapsLock":
          return (controlMask & 0x040) !== 0;
        case "NumLock":
          return (controlMask & 0x080) !== 0;
        case "ScrollLock":
          return (controlMask & 0x100) !== 0;
        default:
          return false;
      }
    }
  };
}

function fnv1a32FromSurface(surface, width, height) {
  const w = Math.max(0, Math.min(surface.width | 0, width | 0));
  const h = Math.max(0, Math.min(surface.height | 0, height | 0));
  let hash = 2166136261 >>> 0;
  for (let y = 0; y < h; y += 1) {
    let row = y * (surface.width | 0);
    for (let x = 0; x < w; x += 1) {
      const pixel = surface.buffer32[row + x] >>> 0;
      hash ^= pixel & 0xff;
      hash = Math.imul(hash, 16777619) >>> 0;
      hash ^= (pixel >>> 8) & 0xff;
      hash = Math.imul(hash, 16777619) >>> 0;
      hash ^= (pixel >>> 16) & 0xff;
      hash = Math.imul(hash, 16777619) >>> 0;
      hash ^= (pixel >>> 24) & 0xff;
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  }
  return `0x${hash.toString(16).padStart(8, "0")}`;
}

const DEFAULT_DESKTOP_COLOR = 0xaab799;
const DEFAULT_DESKTOP_GRID_COLOR = 0x9aab83;
const WINDOW_Z_DESKTOP = -2;
const WINDOW_Z_ALWAYS_BACK = -1;
const WINDOW_Z_NORMAL = 0;
const WINDOW_Z_ALWAYS_TOP = 1;
const WINDOW_STATE_MAXIMIZED = 0x01;
const WINDOW_STATE_MINIMIZED = 0x02;
const WINDOW_STATE_ROLLEDUP = 0x04;
const WINDOW_STATE_USED = 0x80;

function packSurfaceColor(color) {
  const r = (color >>> 16) & 0xff;
  const g = (color >>> 8) & 0xff;
  const b = color & 0xff;
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

function unpackSurfaceColor(value) {
  const packed = value >>> 0;
  return ((((packed & 0xff) << 16) | (packed & 0xff00) | ((packed >>> 16) & 0xff)) >>> 0);
}

function readSurfacePixelColor(surface, x, y) {
  if (
    !surface ||
    !(surface.buffer32 instanceof Uint32Array) ||
    x < 0 ||
    y < 0 ||
    x >= (surface.width | 0) ||
    y >= (surface.height | 0)
  ) {
    return 0;
  }
  return unpackSurfaceColor(surface.buffer32[(y * (surface.width | 0)) + x] >>> 0);
}

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

function rectContains(outer, inner) {
  return (
    inner.screenX >= outer.screenX &&
    inner.screenY >= outer.screenY &&
    inner.screenX + inner.width <= outer.screenX + outer.width &&
    inner.screenY + inner.height <= outer.screenY + outer.height
  );
}

function rectOverlapArea(a, b) {
  const x0 = Math.max(a.screenX, b.screenX);
  const y0 = Math.max(a.screenY, b.screenY);
  const x1 = Math.min(a.screenX + a.width, b.screenX + b.width);
  const y1 = Math.min(a.screenY + a.height, b.screenY + b.height);
  if (x1 <= x0 || y1 <= y0) {
    return 0;
  }
  return (x1 - x0) * (y1 - y0);
}

class HeadlessUiHarness {
  constructor(options) {
    const opts = options || {};
    this.options = opts;
    this.rootDir = opts.rootDir || process.env.KOS_ROOT || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root";
    this.baseWidth = Math.max(1, opts.width | 0 || 800);
    this.baseHeight = Math.max(1, opts.height | 0 || 600);
    this.echoLogs = !!opts.echoLogs;
    this.maxLogs = Math.max(20, opts.maxLogs | 0 || 120);
    this.launchDelayMs = Math.max(0, opts.launchDelayMs | 0 || 80);
    this.actionDelayMs = Math.max(0, opts.actionDelayMs | 0 || 12);
    this.defaultTimeoutMs = Math.max(50, opts.defaultTimeoutMs | 0 || 2000);
    this.nextPid = 1;
    this.nextSlot = 1;
    this.zCounter = 1;
    this.desktopAnchorX = 0;
    this.desktopAnchorY = 0;
    this.desktopAnchorSet = false;
    this.desktopSurface = null;
    this.desktopBackgroundWidth = 0;
    this.desktopBackgroundHeight = 0;
    this.desktopBackgroundMode = 1;
    this.desktopBackgroundData = new Uint8Array(0);
    this.desktopLastDraw = { left: 0, top: 0, right: 0, bottom: 0 };
    this.keyboardLayouts = new Map();
    this.keyboardLanguageId = 1;
    this.systemLanguageId = 1;
    this.systemSkinPath = DEFAULT_SYSTEM_SKIN_PATH;
    this.systemButtonStyle = DEFAULT_SYSTEM_BUTTON_STYLE;
    this.systemSkinColorTableBytes = null;
    this.fontSmoothingMode = 1;
    this.fontSizePx = 9;
    this.speakerDisabled = false;
    this.lowLevelHdAccessEnabled = false;
    this.lowLevelPciAccessEnabled = false;
    this.loadedDrivers = new Map();
    this.nextDriverHandle = 1;
    this.cpuBusySamples = [];
    this.cpuBusySampleTotalMs = 0;
    this.screenWorkArea = null;
    this.processes = [];
    this.processByPid = new Map();
    this.processBySlot = new Map();
    this.activeProcess = null;
    this.sharedNamedMemoryStore = new Map();
    this.debugBoardState = createDebugBoardState();
    this.namedMemoryBootstrapActive = false;
    this.surface = null;
    this.emulator = null;
    this.image = null;
    this.targetPath = "";
    this.logs = [];
    this.controlKeyMask = 0;
    this.lastSystemAction = 0;
    this.resetDesktopState();
  }

  syncActiveAliases() {
    const process = this.activeProcess || null;
    this.surface = process ? process.surface : null;
    this.emulator = process ? process.emulator : null;
    this.image = process ? process.image : null;
    this.logs = process ? process.logs : [];
    this.controlKeyMask = process ? (process.controlKeyMask | 0) : 0;
  }

  createProcessState(launch) {
    const pid = launch.pid >>> 0;
    const groupLeaderPid = launch.groupLeaderPid ? (launch.groupLeaderPid >>> 0) : pid;
    const threadGroupId = launch.threadGroupId ? (launch.threadGroupId >>> 0) : groupLeaderPid;
    return {
      pid,
      slot: launch.slot >>> 0,
      groupLeaderPid,
      threadGroupId,
      image: launch.image,
      fileName: launch.fileName || (launch.image && launch.image.fileName) || "image.kex",
      targetPath: launch.targetPath || "",
      processPath: launch.processPath || launch.targetPath || "",
      processArgs: launch.processArgs || "",
      displayPath: launch.displayPath || launch.processPath || launch.targetPath || "",
      surface: null,
      emulator: null,
      requestedX: launch.initialX | 0,
      requestedY: launch.initialY | 0,
      actualX: launch.initialX | 0,
      actualY: launch.initialY | 0,
      zOrder: 0,
      stopped: false,
      removed: false,
      minimized: false,
      windowTitle: "",
      textDraws: [],
      numberDraws: [],
      drawSequence: 0,
      presentCount: 0,
      logs: [],
      controlKeyMask: 0,
      windowPositionMode: WINDOW_Z_NORMAL,
      windowShape: null,
      threadLaunchSpec: launch.threadLaunchSpec || null
    };
  }

  resetDesktopState() {
    const { createHeadlessSurface } = loadKosRuntime().gfx.surface;
    this.desktopSurface = createHeadlessSurface(this.baseWidth, this.baseHeight);
    this.desktopBackgroundWidth = 0;
    this.desktopBackgroundHeight = 0;
    this.desktopBackgroundMode = 1;
    this.desktopBackgroundData = new Uint8Array(0);
    this.desktopLastDraw = {
      left: 0,
      top: 0,
      right: Math.max(0, (this.baseWidth | 0) - 1) | 0,
      bottom: Math.max(0, (this.baseHeight | 0) - 1) | 0
    };
    this.keyboardLayouts = new Map();
    this.keyboardLanguageId = 1;
    this.systemLanguageId = 1;
    this.fontSmoothingMode = 1;
    this.fontSizePx = 9;
    this.speakerDisabled = false;
    this.lowLevelHdAccessEnabled = false;
    this.lowLevelPciAccessEnabled = false;
    this.loadedDrivers = new Map();
    this.nextDriverHandle = 1;
    this.resetScreenWorkArea();
    this.renderDesktopBackground();
  }

  resetScreenWorkArea() {
    const size = this.getReportedScreenSize();
    this.screenWorkArea = {
      left: 0,
      top: 0,
      right: Math.max(0, (size.width | 0) - 1) | 0,
      bottom: Math.max(0, (size.height | 0) - 1) | 0
    };
  }

  clampScreenWorkArea() {
    const size = this.getReportedScreenSize();
    const maxRight = Math.max(0, (size.width | 0) - 1) | 0;
    const maxBottom = Math.max(0, (size.height | 0) - 1) | 0;
    if (!this.screenWorkArea) {
      this.resetScreenWorkArea();
      return false;
    }
    const next = {
      left: Math.max(0, Math.min(this.screenWorkArea.left | 0, maxRight)) | 0,
      top: Math.max(0, Math.min(this.screenWorkArea.top | 0, maxBottom)) | 0,
      right: Math.max(0, Math.min(this.screenWorkArea.right | 0, maxRight)) | 0,
      bottom: Math.max(0, Math.min(this.screenWorkArea.bottom | 0, maxBottom)) | 0
    };
    if (next.right < next.left) {
      next.left = 0;
      next.right = maxRight;
    }
    if (next.bottom < next.top) {
      next.top = 0;
      next.bottom = maxBottom;
    }
    const changed =
      next.left !== (this.screenWorkArea.left | 0) ||
      next.top !== (this.screenWorkArea.top | 0) ||
      next.right !== (this.screenWorkArea.right | 0) ||
      next.bottom !== (this.screenWorkArea.bottom | 0);
    this.screenWorkArea = next;
    return changed;
  }

  getScreenWorkArea() {
    if (!this.screenWorkArea) {
      this.resetScreenWorkArea();
    }
    return {
      left: this.screenWorkArea.left | 0,
      top: this.screenWorkArea.top | 0,
      right: this.screenWorkArea.right | 0,
      bottom: this.screenWorkArea.bottom | 0
    };
  }

  setScreenWorkArea(rect) {
    if (!rect) {
      return false;
    }
    const size = this.getReportedScreenSize();
    const maxRight = Math.max(0, (size.width | 0) - 1) | 0;
    const maxBottom = Math.max(0, (size.height | 0) - 1) | 0;
    const current = this.getScreenWorkArea();
    const next = { ...current };
    const left = rect.left | 0;
    const right = rect.right | 0;
    const top = rect.top | 0;
    const bottom = rect.bottom | 0;
    if (left < right) {
      next.left = Math.max(0, Math.min(left, maxRight)) | 0;
      next.right = Math.max(next.left, Math.min(right, maxRight)) | 0;
    }
    if (top < bottom) {
      next.top = Math.max(0, Math.min(top, maxBottom)) | 0;
      next.bottom = Math.max(next.top, Math.min(bottom, maxBottom)) | 0;
    }
    const changed =
      next.left !== current.left ||
      next.top !== current.top ||
      next.right !== current.right ||
      next.bottom !== current.bottom;
    if (!changed) {
      return false;
    }
    this.screenWorkArea = next;
    for (let i = 0; i < this.processes.length; i += 1) {
      const process = this.processes[i];
      if (!process || process.removed || !process.emulator || !process.emulator.running) {
        continue;
      }
      process.emulator.removeQueuedEvent(1);
      process.emulator.queueEvent(1);
      process.emulator.wakeExecution();
    }
    return true;
  }

  getSystemStyleState() {
    return {
      skinPath: String(this.systemSkinPath || DEFAULT_SYSTEM_SKIN_PATH),
      buttonStyle: (this.systemButtonStyle & 0xff) === 0 ? 0 : 1,
      colorTableBytes: cloneBytes(this.systemSkinColorTableBytes)
    };
  }

  reloadSystemStyleFromFileSystem() {
    const fileProvider = createDefaultFileProvider(this.targetPath, this.rootDir);
    const next = readSystemStyleState(fileProvider);
    this.systemSkinPath = String(next.skinPath || DEFAULT_SYSTEM_SKIN_PATH);
    this.systemButtonStyle = (next.buttonStyle & 0xff) === 0 ? 0 : 1;
    this.systemSkinColorTableBytes = cloneBytes(next.colorTableBytes);
    return this.getSystemStyleState();
  }

  applySystemStyleToEmulator(emulator, styleState, options) {
    if (!emulator) {
      return 1;
    }
    const next = styleState || this.getSystemStyleState();
    const opts = options || {};
    emulator.buttonStyle = (next.buttonStyle & 0xff) === 0 ? 0 : 1;
    if (typeof emulator.resetSkinTheme === "function") {
      emulator.resetSkinTheme();
    }
    emulator.skinPath = String(next.skinPath || DEFAULT_SYSTEM_SKIN_PATH);
    emulator.skinReady = false;
    let result = 0;
    if (typeof emulator.loadSkinTheme === "function") {
      result = emulator.loadSkinTheme(emulator.skinPath) >>> 0;
    } else if (typeof emulator.ensureSkinThemeLoaded === "function") {
      result = emulator.ensureSkinThemeLoaded() ? 0 : 1;
    }
    if (result !== 0) {
      return result >>> 0;
    }
    if (next.colorTableBytes instanceof Uint8Array && typeof emulator.setSkinColorTable === "function") {
      emulator.setSkinColorTable(next.colorTableBytes);
    }
    if (opts.queueRedraw !== false && emulator.running) {
      emulator.removeQueuedEvent(1);
      emulator.queueEvent(1);
    }
    if (opts.wake !== false && emulator.running) {
      emulator.wakeExecution();
    }
    return 0;
  }

  applySystemStyleToProcesses(styleState, options) {
    const next = styleState || this.getSystemStyleState();
    let updated = false;
    for (let i = 0; i < this.processes.length; i += 1) {
      const process = this.processes[i];
      if (!process || process.removed || !process.emulator) {
        continue;
      }
      const result = this.applySystemStyleToEmulator(process.emulator, next, options);
      if (result !== 0) {
        continue;
      }
      updated = true;
    }
    return updated;
  }

  setSystemSkinPath(pathText, sourceEmulator) {
    const nextPath = String(pathText || "").trim();
    if (!nextPath) {
      return 3;
    }
    const previous = this.getSystemStyleState();
    const candidate = {
      skinPath: nextPath,
      buttonStyle: previous.buttonStyle,
      colorTableBytes: null
    };
    const probe = sourceEmulator || (this.activeProcess && this.activeProcess.emulator ? this.activeProcess.emulator : null);
    if (probe) {
      const result = this.applySystemStyleToEmulator(probe, candidate, { queueRedraw: false, wake: false });
      if (result !== 0) {
        this.applySystemStyleToEmulator(probe, previous, { queueRedraw: false, wake: false });
        return result >>> 0;
      }
      candidate.colorTableBytes = cloneBytes(
        typeof probe.getSkinColorTableBytes === "function" ? probe.getSkinColorTableBytes() : null
      );
    }
    this.systemSkinPath = nextPath;
    this.systemSkinColorTableBytes = cloneBytes(candidate.colorTableBytes);
    this.applySystemStyleToProcesses(this.getSystemStyleState(), { queueRedraw: true, wake: true });
    return 0;
  }

  setSystemButtonStyle(value) {
    this.systemButtonStyle = (value & 0xff) === 0 ? 0 : 1;
    this.applySystemStyleToProcesses(this.getSystemStyleState(), { queueRedraw: false, wake: false });
    return true;
  }

  setSystemSkinColorTable(bytes) {
    this.systemSkinColorTableBytes = bytes instanceof Uint8Array ? bytes.slice() : null;
    this.applySystemStyleToProcesses(this.getSystemStyleState(), { queueRedraw: false, wake: false });
    return true;
  }

  applySystemStyleSettings() {
    return this.applySystemStyleToProcesses(this.getSystemStyleState(), { queueRedraw: true, wake: true });
  }

  getKeyboardLayout(kind) {
    return this.keyboardLayouts.get(kind | 0) || null;
  }

  setKeyboardLayout(kind, bytes) {
    const key = kind | 0;
    if (key < 1 || key > 3 || !(bytes instanceof Uint8Array) || bytes.length < 128) {
      return false;
    }
    this.keyboardLayouts.set(key, bytes.slice(0, 128));
    return true;
  }

  getKeyboardLanguageId() {
    return this.keyboardLanguageId >>> 0;
  }

  notifyKeyboardLanguageChanged() {
    let updated = false;
    for (let i = 0; i < this.processes.length; i += 1) {
      const process = this.processes[i];
      if (!process || process.removed || !process.emulator || !process.emulator.running) {
        continue;
      }
      process.emulator.removeQueuedEvent(1);
      process.emulator.queueEvent(1);
      process.emulator.wakeExecution();
      updated = true;
    }
    return updated;
  }

  setKeyboardLanguageId(value) {
    const next = Math.max(0, value | 0) >>> 0;
    if (next === (this.keyboardLanguageId >>> 0)) {
      return true;
    }
    this.keyboardLanguageId = next;
    this.notifyKeyboardLanguageChanged();
    return true;
  }

  getSystemLanguageId() {
    return this.systemLanguageId >>> 0;
  }

  setSystemLanguageId(value) {
    this.systemLanguageId = Math.max(0, value | 0) >>> 0;
    return true;
  }

  getFontSmoothingMode() {
    return this.fontSmoothingMode >>> 0;
  }

  setFontSmoothingMode(value) {
    this.fontSmoothingMode = Math.max(0, Math.min(2, value | 0)) >>> 0;
    return true;
  }

  getFontSizePx() {
    return this.fontSizePx >>> 0;
  }

  setFontSizePx(value) {
    this.fontSizePx = Math.max(1, Math.min(255, value | 0)) >>> 0;
    return true;
  }

  getSpeakerDisabled() {
    return !!this.speakerDisabled;
  }

  setSpeakerDisabled(value) {
    this.speakerDisabled = !!value;
    return true;
  }

  toggleSpeakerDisabled() {
    this.speakerDisabled = !this.speakerDisabled;
    return !!this.speakerDisabled;
  }

  getLowLevelHdAccessEnabled() {
    return !!this.lowLevelHdAccessEnabled;
  }

  setLowLevelHdAccessEnabled(value) {
    this.lowLevelHdAccessEnabled = !!value;
    return true;
  }

  getLowLevelPciAccessEnabled() {
    return !!this.lowLevelPciAccessEnabled;
  }

  setLowLevelPciAccessEnabled(value) {
    this.lowLevelPciAccessEnabled = !!value;
    return true;
  }

  loadSystemDriver(name) {
    const key = String(name || "");
    if (!key) {
      return 0;
    }
    if (this.loadedDrivers.has(key)) {
      return this.loadedDrivers.get(key) >>> 0;
    }
    let handle = this.nextDriverHandle >>> 0;
    if (!handle) {
      handle = 1;
    }
    this.nextDriverHandle = ((handle + 1) >>> 0) || 1;
    this.loadedDrivers.set(key, handle >>> 0);
    return handle >>> 0;
  }

  getWallClockMs() {
    return (
      typeof performance !== "undefined" &&
      performance &&
      typeof performance.now === "function"
    ) ? performance.now() : Date.now();
  }

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
  }

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
  }

  getSystemBusyCount() {
    const now = this.getWallClockMs();
    this.trimCpuBusySamples(now);
    const busyMs = Math.max(0, Math.min(1000, Number(this.cpuBusySampleTotalMs) || 0));
    return Math.round((busyMs / 1000) * (this.getReportedCpuFrequencyHz() >>> 0)) >>> 0;
  }

  getIdleCount() {
    const cpuFreqHz = this.getReportedCpuFrequencyHz();
    const busy = this.getSystemBusyCount() >>> 0;
    if (busy >= cpuFreqHz) {
      return 0;
    }
    return Math.max(0, cpuFreqHz - busy) >>> 0;
  }

  getReportedCpuFrequencyHz() {
    let hz = 0;
    try {
      const cpus = os.cpus();
      if (Array.isArray(cpus) && cpus.length && Number.isFinite(Number(cpus[0].speed))) {
        hz = Number(cpus[0].speed) * 1000000;
      }
    } catch (err) {
      hz = 0;
    }
    if (!(hz > 0)) {
      hz = DEFAULT_CPU_FREQ_HZ;
    }
    return Math.max(1, Math.min(0xffffffff, Math.round(hz))) >>> 0;
  }

  getConfiguredSystemRamBytes() {
    let total = 0;
    if (Number.isFinite(Number(this.options && this.options.systemRamBytes))) {
      total = Number(this.options.systemRamBytes);
    }
    if (!(total > 0)) {
      total = DEFAULT_SYSTEM_RAM_BYTES;
    }
    return Math.max(1, Math.min(0xffffffff, Math.round(total))) >>> 0;
  }

  getConfiguredSystemReservedRamBytes() {
    let reserved = null;
    if (Number.isFinite(Number(this.options && this.options.systemReservedRamBytes))) {
      reserved = Number(this.options.systemReservedRamBytes);
    }
    if (!Number.isFinite(reserved) || reserved < 0) {
      reserved = DEFAULT_SYSTEM_RESERVED_RAM_BYTES;
    }
    return Math.max(0, Math.min(0xffffffff, Math.round(reserved))) >>> 0;
  }

  getReportedUsedRamBytes() {
    const processUsed = this.processes.reduce((sum, process) => {
      if (!process || process.removed) {
        return sum;
      }
      return sum + this.getApproxProcessMemoryBytes(process);
    }, 0);
    const reserved = this.getConfiguredSystemReservedRamBytes();
    return Math.max(0, Math.min(0xffffffff, Math.round(processUsed + reserved))) >>> 0;
  }

  getApproxProcessMemoryBytes(process) {
    const emulator = process && process.emulator ? process.emulator : null;
    if (!emulator) {
      return 0;
    }
    let committed = Math.max(
      emulator.processReservedSize >>> 0,
      emulator.stackBase >>> 0,
      emulator.image && emulator.image.header ? (emulator.image.header.memorySize >>> 0) : 0
    ) >>> 0;
    if (emulator.heapEnabled) {
      committed = Math.max(
        committed >>> 0,
        emulator.heapTop >>> 0,
        emulator.heapLowTop >>> 0
      ) >>> 0;
    }
    if (!committed) {
      committed = 0x10000;
    }
    return ((committed + 0xfff) & ~0xfff) >>> 0;
  }

  getReportedTotalRamBytes() {
    const used = this.getReportedUsedRamBytes();
    let total = this.getConfiguredSystemRamBytes();
    total = Math.max(total, used + (64 * 1024 * 1024));
    return Math.max(1, Math.min(0xffffffff, Math.round(total))) >>> 0;
  }

  getReportedFreeRamBytes() {
    const total = this.getReportedTotalRamBytes();
    const used = Math.min(total >>> 0, this.getReportedUsedRamBytes()) >>> 0;
    return Math.max(0, total - used) >>> 0;
  }

  getDesktopBackgroundInfo() {
    return {
      width: this.desktopBackgroundWidth | 0,
      height: this.desktopBackgroundHeight | 0,
      mode: this.desktopBackgroundMode | 0,
      lastDraw: {
        left: this.desktopLastDraw.left | 0,
        top: this.desktopLastDraw.top | 0,
        right: this.desktopLastDraw.right | 0,
        bottom: this.desktopLastDraw.bottom | 0
      }
    };
  }

  getDesktopBackgroundBytes() {
    return this.desktopBackgroundData.slice();
  }

  setDesktopBackgroundSize(width, height) {
    const w = Math.max(0, width | 0);
    const h = Math.max(0, height | 0);
    const size = Math.max(0, (w * h * 3) | 0);
    this.desktopBackgroundWidth = w;
    this.desktopBackgroundHeight = h;
    this.desktopBackgroundData = size > 0 ? new Uint8Array(size) : new Uint8Array(0);
    return true;
  }

  setDesktopBackgroundMode(mode) {
    this.desktopBackgroundMode = (mode | 0) === 2 ? 2 : 1;
    return true;
  }

  setDesktopBackgroundBytes(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length !== this.desktopBackgroundData.length) {
      return false;
    }
    this.desktopBackgroundData.set(bytes);
    return true;
  }

  writeDesktopBackgroundPixel(offset, color) {
    const ptr = offset | 0;
    if (ptr < 0 || (ptr + 2) >= this.desktopBackgroundData.length) {
      return false;
    }
    this.desktopBackgroundData[ptr] = color & 0xff;
    this.desktopBackgroundData[ptr + 1] = (color >>> 8) & 0xff;
    this.desktopBackgroundData[ptr + 2] = (color >>> 16) & 0xff;
    return true;
  }

  writeDesktopBackgroundBytes(offset, data) {
    const ptr = Math.max(0, offset | 0);
    if (!(data instanceof Uint8Array) || !data.length || ptr >= this.desktopBackgroundData.length) {
      return false;
    }
    const end = Math.min(this.desktopBackgroundData.length, ptr + data.length);
    this.desktopBackgroundData.set(data.subarray(0, end - ptr), ptr);
    return true;
  }

  ensureDesktopSurfaceSize(minWidth, minHeight) {
    if (!this.desktopSurface) {
      this.resetDesktopState();
      return true;
    }
    const viewport = this.getViewportSize();
    const width = Math.max(1, viewport.width | 0, minWidth === undefined ? 0 : (minWidth | 0));
    const height = Math.max(1, viewport.height | 0, minHeight === undefined ? 0 : (minHeight | 0));
    if ((this.desktopSurface.width | 0) === width && (this.desktopSurface.height | 0) === height) {
      return false;
    }
    this.desktopSurface.resize(width, height);
    return true;
  }

  renderDesktopBackground() {
    if (!this.desktopSurface || !this.desktopSurface.buffer32) {
      return;
    }
    const surface = this.desktopSurface;
    const width = surface.width | 0;
    const height = surface.height | 0;
    if ((this.desktopBackgroundWidth | 0) <= 0 || (this.desktopBackgroundHeight | 0) <= 0 || !this.desktopBackgroundData.length) {
      const fill = packSurfaceColor(DEFAULT_DESKTOP_COLOR);
      const grid = packSurfaceColor(DEFAULT_DESKTOP_GRID_COLOR);
      surface.buffer32.fill(fill);
      for (let y = 0; y < height; y += 24) {
        const row = y * width;
        for (let x = 0; x < width; x += 1) {
          surface.buffer32[row + x] = grid;
        }
      }
      for (let x = 0; x < width; x += 24) {
        for (let y = 0; y < height; y += 1) {
          surface.buffer32[(y * width) + x] = grid;
        }
      }
      return;
    }

    const src = this.desktopBackgroundData;
    const srcWidth = Math.max(1, this.desktopBackgroundWidth | 0);
    const srcHeight = Math.max(1, this.desktopBackgroundHeight | 0);
    const stretch = (this.desktopBackgroundMode | 0) === 2;
    for (let y = 0; y < height; y += 1) {
      const sy = stretch
        ? Math.min(srcHeight - 1, Math.floor((y * srcHeight) / Math.max(1, height)))
        : (y % srcHeight);
      const dstRow = y * width;
      const srcRow = sy * srcWidth;
      for (let x = 0; x < width; x += 1) {
        const sx = stretch
          ? Math.min(srcWidth - 1, Math.floor((x * srcWidth) / Math.max(1, width)))
          : (x % srcWidth);
        const base = ((srcRow + sx) * 3) | 0;
        const b = src[base] & 0xff;
        const g = src[base + 1] & 0xff;
        const r = src[base + 2] & 0xff;
        surface.buffer32[dstRow + x] = packSurfaceColor(((r << 16) | (g << 8) | b) >>> 0);
      }
    }
  }

  queueDesktopRedrawEvent(excludeThreadGroupId) {
    const excluded = excludeThreadGroupId >>> 0;
    for (let i = 0; i < this.processes.length; i += 1) {
      const process = this.processes[i];
      const emulator = process && process.emulator ? process.emulator : null;
      if (
        !emulator ||
        !emulator.running ||
        ((emulator.eventMask >>> 4) & 1) === 0 ||
        (excluded && (process.threadGroupId >>> 0) === excluded)
      ) {
        continue;
      }
      emulator.removeQueuedEvent(5);
      emulator.queueEvent(5);
      emulator.wakeExecution();
    }
  }

  redrawDesktopBackground(rect) {
    const resized = this.ensureDesktopSurfaceSize();
    if (resized) {
      this.clampScreenWorkArea();
    }
    this.renderDesktopBackground();
    const width = Math.max(1, this.desktopSurface ? (this.desktopSurface.width | 0) : 1);
    const height = Math.max(1, this.desktopSurface ? (this.desktopSurface.height | 0) : 1);
    const next = rect || {
      left: 0,
      top: 0,
      right: width - 1,
      bottom: height - 1
    };
    this.desktopLastDraw = {
      left: Math.max(0, Math.min(next.left | 0, width - 1)) | 0,
      top: Math.max(0, Math.min(next.top | 0, height - 1)) | 0,
      right: Math.max(0, Math.min(next.right | 0, width - 1)) | 0,
      bottom: Math.max(0, Math.min(next.bottom | 0, height - 1)) | 0
    };
    this.queueDesktopRedrawEvent();
    return true;
  }

  putDesktopImage(data, width, height, x, y, sourceSlot) {
    if (!(data instanceof Uint8Array) || !this.desktopSurface || !this.desktopSurface.buffer32) {
      return false;
    }
    this.ensureDesktopSurfaceSize();
    const drawWidth = Math.max(0, width | 0);
    const drawHeight = Math.max(0, height | 0);
    const dstX = x | 0;
    const dstY = y | 0;
    if (drawWidth <= 0 || drawHeight <= 0) {
      return false;
    }
    const surface = this.desktopSurface;
    for (let py = 0; py < drawHeight; py += 1) {
      const ty = dstY + py;
      if (ty < 0 || ty >= (surface.height | 0)) {
        continue;
      }
      const srcRow = py * drawWidth;
      const dstRow = ty * (surface.width | 0);
      for (let px = 0; px < drawWidth; px += 1) {
        const tx = dstX + px;
        if (tx < 0 || tx >= (surface.width | 0)) {
          continue;
        }
        const base = ((srcRow + px) * 4) | 0;
        const alpha = data[base + 3] & 0xff;
        if (!alpha) {
          continue;
        }
        const b = data[base] & 0xff;
        const g = data[base + 1] & 0xff;
        const r = data[base + 2] & 0xff;
        surface.buffer32[dstRow + tx] = packSurfaceColor(((r << 16) | (g << 8) | b) >>> 0);
      }
    }
    const source = this.processBySlot.get(sourceSlot >>> 0) || null;
    this.queueDesktopRedrawEvent(source ? (source.threadGroupId >>> 0) : 0);
    return true;
  }

  getWindowPositionMode(pid) {
    const process = this.processByPid.get(pid >>> 0) || null;
    return process && !process.removed ? ((process.windowPositionMode | 0) >>> 0) : (WINDOW_Z_NORMAL >>> 0);
  }

  setWindowPositionMode(pid, position) {
    const process = this.processByPid.get(pid >>> 0) || null;
    const next = position | 0;
    if (!process || process.removed || (next !== WINDOW_Z_DESKTOP && next !== WINDOW_Z_ALWAYS_BACK && next !== WINDOW_Z_NORMAL && next !== WINDOW_Z_ALWAYS_TOP)) {
      return false;
    }
    process.windowPositionMode = next;
    return true;
  }

  getActiveProcess() {
    if (this.activeProcess && !this.activeProcess.removed && !this.activeProcess.minimized) {
      return this.activeProcess;
    }
    return this.getVisibleWindowStack()[0] || null;
  }

  isBootstrapNamedMemoryName(name) {
    return name === "ICONS32" || name === "ICONS18" || name === "ICONS18W" || name === "CHECKBOX";
  }

  isNamedMemoryAreaReady(name) {
    const area = this.sharedNamedMemoryStore.get(String(name || "")) || null;
    if (!area || !(area.data instanceof Uint8Array)) {
      return false;
    }
    let minBytes = 64;
    if (name === "ICONS32") {
      minBytes = 32 * 32 * 4;
    } else if (name === "ICONS18" || name === "ICONS18W") {
      minBytes = 18 * 18 * 4;
    }
    if (area.data.length < minBytes) {
      return false;
    }
    const limit = Math.min(area.data.length, Math.max(minBytes, 512));
    const first = area.data[0] & 0xff;
    for (let i = 1; i < limit; i += 1) {
      if ((area.data[i] & 0xff) !== first) {
        return true;
      }
    }
    return false;
  }

  pumpProcessUntil(process, predicate, maxSlices) {
    const target = process && process.emulator ? process : null;
    const done = typeof predicate === "function" ? predicate : (() => false);
    if (!target) {
      return done();
    }
    for (let i = 0; i < Math.max(1, maxSlices | 0); i += 1) {
      if (done()) {
        return true;
      }
      if (!target.emulator.running) {
        break;
      }
      if (target.emulator.timer) {
        clearTimeout(target.emulator.timer);
        target.emulator.timer = null;
      }
      target.emulator.immediatePending = false;
      target.emulator.step();
    }
    return done();
  }

  ensureNamedMemoryArea(name) {
    const key = String(name || "");
    if (!key) {
      return null;
    }
    const existing = this.sharedNamedMemoryStore.get(key) || null;
    if (existing && this.isNamedMemoryAreaReady(key)) {
      return existing;
    }
    if (!this.isBootstrapNamedMemoryName(key) || this.namedMemoryBootstrapActive) {
      return existing;
    }
    const bootstrapPath = path.join(this.rootDir, "@RESHARE");
    if (!fs.existsSync(bootstrapPath)) {
      return existing;
    }
    this.namedMemoryBootstrapActive = true;
    const previousActive = this.getActiveProcess();
    let bootstrapProcess = null;
    try {
      const image = readTargetImage(bootstrapPath);
      bootstrapProcess = this.createProcess({
        image,
        fileName: path.basename(bootstrapPath),
        targetPath: bootstrapPath,
        processPath: "/sys/@RESHARE",
        displayPath: "/sys/@RESHARE",
        processArgs: "",
        pid: this.nextPid++,
        slot: this.nextSlot++,
        groupLeaderPid: 0,
        threadGroupId: 0,
        initialX: 0,
        initialY: 0
      });
      this.pumpProcessUntil(bootstrapProcess, () => this.isNamedMemoryAreaReady(key), 256);
    } catch (err) {
      this.log(`Shared resource bootstrap failed for ${key}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.namedMemoryBootstrapActive = false;
      if (bootstrapProcess && !bootstrapProcess.removed && bootstrapProcess.emulator && bootstrapProcess.emulator.running) {
        bootstrapProcess.emulator.stop("stopped");
      }
      if (previousActive && !previousActive.removed) {
        this.setActiveProcess(previousActive);
      }
    }
    return this.sharedNamedMemoryStore.get(key) || existing;
  }

  setActiveProcess(process) {
    if (process && process.removed) {
      return null;
    }
    if (process && process.minimized) {
      process.minimized = false;
    }
    if (process) {
      process.zOrder = this.zCounter++;
    }
    this.activeProcess = process || null;
    this.processes.sort(compareProcessZOrder);
    this.syncActiveAliases();
    return this.activeProcess;
  }

  registerProcess(process) {
    this.processes.push(process);
    this.processByPid.set(process.pid >>> 0, process);
    this.processBySlot.set(process.slot >>> 0, process);
    process.zOrder = this.zCounter++;
    this.processes.sort(compareProcessZOrder);
  }

  unregisterProcess(process) {
    const threadGroupId = process ? (process.threadGroupId >>> 0) : 0;
    const slot = process ? (process.slot >>> 0) : 0;
    const index = this.processes.indexOf(process);
    if (index >= 0) {
      this.processes.splice(index, 1);
    }
    this.processByPid.delete(process.pid >>> 0);
    this.processBySlot.delete(process.slot >>> 0);
    if (this.activeProcess === process) {
      const next = this.getVisibleWindowStack()[0] || null;
      this.activeProcess = next || null;
    }
    this.syncActiveAliases();
    this.queueSiblingRedraw(threadGroupId, slot);
  }

  writeDebugBoardByte(value) {
    return pushDebugBoardByte(this.debugBoardState, value & 0xff);
  }

  writeDebugBoardMessage(message) {
    return writeDebugBoardText(this.debugBoardState, String(message || ""));
  }

  readDebugBoardByte() {
    return readDebugBoardByte(this.debugBoardState);
  }

  mirrorProcessLogToDebugBoard(process, message) {
    const severity = classifyProcessLogSeverity(message);
    if (!severity) {
      return false;
    }
    const source = process
      ? String(process.displayPath || process.processPath || process.fileName || "process")
      : "emulator";
    this.writeDebugBoardMessage(`${severity}: ${source}: ${String(message || "")}\r\n`);
    return true;
  }

  logForProcess(process, message) {
    const line = String(message);
    const target = process && process.logs ? process.logs : this.logs;
    target.push(line);
    if (target.length > this.maxLogs) {
      target.splice(0, target.length - this.maxLogs);
    }
    if (this.echoLogs) {
      const prefix = process ? `[pid ${process.pid >>> 0} slot ${process.slot >>> 0}] ` : "";
      console.log(`${prefix}${line}`);
    }
    this.mirrorProcessLogToDebugBoard(process, line);
  }

  log(message) {
    this.logForProcess(this.getActiveProcess(), message);
  }

  clearProcessCapture(process) {
    if (!process) {
      return;
    }
    process.windowTitle = "";
    process.textDraws.length = 0;
    process.numberDraws.length = 0;
    process.drawSequence = 0;
    process.presentCount = 0;
    process.logs.length = 0;
    process.controlKeyMask = 0;
  }

  clearCapture() {
    this.logs.length = 0;
    this.controlKeyMask = 0;
    this.lastSystemAction = 0;
    this.processes.length = 0;
    this.processByPid.clear();
    this.processBySlot.clear();
    this.desktopAnchorX = 0;
    this.desktopAnchorY = 0;
    this.desktopAnchorSet = false;
    this.activeProcess = null;
    this.surface = null;
    this.emulator = null;
    this.image = null;
    this.sharedNamedMemoryStore = new Map();
    resetDebugBoardState(this.debugBoardState);
    this.namedMemoryBootstrapActive = false;
    this.resetDesktopState();
  }

  async launch(targetPath) {
    const resolved = path.resolve(targetPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Target not found: ${resolved}`);
    }

    this.close();
    this.clearCapture();

    this.targetPath = resolved;
    this.reloadSystemStyleFromFileSystem();
    const image = readTargetImage(resolved);
    this.createProcess({
      image,
      fileName: path.basename(resolved),
      targetPath: resolved,
      processPath: buildExternalAppProcessPath(resolved),
      displayPath: resolved,
      processArgs: "",
      pid: this.nextPid++,
      slot: this.nextSlot++,
      groupLeaderPid: 0,
      threadGroupId: 0,
      initialX: 0,
      initialY: 0
    });
    await sleep(this.launchDelayMs);
    return this;
  }

  createProcess(launch) {
    const { Emulator, createHeadlessSurface } = loadKosRuntime();
    const process = this.createProcessState(launch);
    process.surface = createHeadlessSurface(this.baseWidth, this.baseHeight);
    process.emulator = new Emulator(process.surface, (msg) => this.logForProcess(process, msg));
    process.emulator.autoFitWindow = true;
    process.emulator.threadSlot = process.slot >>> 0;
    process.emulator.processId = process.pid >>> 0;
    process.emulator.hostSession = this;
    process.emulator.sharedNamedMemoryStore = this.sharedNamedMemoryStore;
    process.emulator.processPathOverride = process.processPath;
    process.emulator.processArgs = process.processArgs;
    process.emulator.threadLaunchSpec = process.threadLaunchSpec;
    process.emulator.getHostScreenSize = () => this.getReportedScreenSize();
    process.emulator.getHostPixelOwnerAt = (x, y) => this.getPixelOwnerAt(x | 0, y | 0);
    process.emulator.getHostPixelColorAt = (x, y) => this.getPixelColorAt(x | 0, y | 0);
    const fileProviders = createDefaultFileProviders(process.targetPath || this.targetPath, this.rootDir);
    process.emulator.fileProvider = fileProviders.fileProvider;
    process.emulator.fileInfoProvider = fileProviders.fileInfoProvider;
    process.emulator.fileMutationProvider = fileProviders.fileMutationProvider;
    process.emulator.traceOpcodes = global.process.env.KOS_TRACE_OPCODES === "1";
    process.emulator.traceSyscalls = global.process.env.KOS_TRACE_SYSCALLS === "1";
    process.emulator.traceImages = global.process.env.KOS_TRACE_IMAGES === "1";
    process.emulator.onWindowResize = (width, height) => {
      process.surface.resize(Math.max(1, width | 0), Math.max(1, height | 0));
    };
    process.emulator.onWindowGeometry = (x, y) => {
      const bounded = this.normalizeWindowPosition(
        x | 0,
        y | 0,
        process.surface ? (process.surface.width | 0) : this.baseWidth,
        process.surface ? (process.surface.height | 0) : this.baseHeight
      );
      process.requestedX = bounded.x | 0;
      process.requestedY = bounded.y | 0;
      if (!this.desktopAnchorSet) {
        this.desktopAnchorX = process.requestedX | 0;
        this.desktopAnchorY = process.requestedY | 0;
        this.desktopAnchorSet = true;
      }
      process.actualX = ((process.requestedX | 0) - (this.desktopAnchorX | 0)) | 0;
      process.actualY = ((process.requestedY | 0) - (this.desktopAnchorY | 0)) | 0;
    };
    process.emulator.onStopped = () => {
      process.stopped = true;
      process.removed = true;
      this.unregisterProcess(process);
    };
    this.installHooks(process);
    process.emulator.load(process.image);
    this.applySystemStyleToEmulator(process.emulator, null, { queueRedraw: false, wake: false });
    process.emulator.run();
    this.registerProcess(process);
    this.setActiveProcess(process);
    return process;
  }

  normalizeWindowPosition(x, y, width, height) {
    const nextX = x | 0;
    const nextY = y | 0;
    const windowWidth = Math.max(1, width | 0);
    const windowHeight = Math.max(1, height | 0);
    const viewport = this.getViewportSize();
    const viewportWidth = viewport.width | 0;
    const viewportHeight = viewport.height | 0;
    const overlapsViewport =
      nextX < viewportWidth &&
      nextY < viewportHeight &&
      (nextX + windowWidth) > 0 &&
      (nextY + windowHeight) > 0;
    if (overlapsViewport) {
      return {
        x: nextX,
        y: nextY
      };
    }
    const maxX = Math.max(0, viewportWidth - Math.min(windowWidth, viewportWidth)) | 0;
    const maxY = Math.max(0, viewportHeight - Math.min(windowHeight, viewportHeight)) | 0;
    return {
      x: Math.max(0, Math.min(nextX, maxX)) | 0,
      y: Math.max(0, Math.min(nextY, maxY)) | 0
    };
  }

  getViewportSize() {
    return {
      width: Math.max(1, this.baseWidth | 0) | 0,
      height: Math.max(1, this.baseHeight | 0) | 0
    };
  }

  getReportedScreenSize() {
    const viewport = this.getViewportSize();
    let width = viewport.width | 0;
    let height = viewport.height | 0;
    if (width > 1) {
      width &= ~1;
    }
    if (height > 1) {
      height &= ~1;
    }
    return {
      width: Math.max(1, width | 0) | 0,
      height: Math.max(1, height | 0) | 0
    };
  }

  close() {
    const list = this.processes.slice();
    for (let i = 0; i < list.length; i += 1) {
      const process = list[i];
      if (process.emulator) {
        process.emulator.stop();
      }
      process.removed = true;
    }
    this.clearCapture();
  }

  installHooks(process) {
    if (!process || !process.emulator || process.emulator.__uiHarnessInstalled) {
      return;
    }
    const emulator = process.emulator;
    const surface = process.surface;
    const { getTextInfo, getTextInfoFromString, measureKolibriText } = loadKosRuntime().gfx.kolibriText;

    const originalPresent = surface.present.bind(surface);
    surface.present = () => {
      process.presentCount += 1;
      return originalPresent();
    };

    const originalCreateWindow = emulator.sysCreateWindow.bind(emulator);
    emulator.sysCreateWindow = () => {
      const result = originalCreateWindow();
      process.windowTitle = String(emulator.windowTitle || "");
      return result;
    };

    emulator.onWindowShape = (shape) => {
      if (shape && shape.data instanceof Uint8Array && (shape.width | 0) > 0 && (shape.height | 0) > 0) {
        process.windowShape = {
          width: shape.width | 0,
          height: shape.height | 0,
          data: shape.data
        };
      } else {
        process.windowShape = null;
      }
    };

    const originalRedraw = emulator.sysRedraw.bind(emulator);
    emulator.sysRedraw = () => {
      const phase = emulator.readReg(REG.EBX) & 0xffff;
      if (phase === 1) {
        process.textDraws.length = 0;
        process.numberDraws.length = 0;
      }
      return originalRedraw();
    };

    const originalDrawRect = emulator.sysDrawRect.bind(emulator);
    emulator.sysDrawRect = () => {
      const ebx = emulator.readReg(REG.EBX) >>> 0;
      const ecx = emulator.readReg(REG.ECX) >>> 0;
      const x = unpackSignedHigh16(ebx);
      const width = ebx & 0xffff;
      const y = unpackSignedHigh16(ecx);
      const height = ecx & 0xffff;
      const pos = this.applyProcessWindowOffset(process, x, y);
      const result = originalDrawRect();
      if (width > 0 && height > 0) {
        this.clearDrawsInRect(process, pos.x | 0, pos.y | 0, width | 0, height | 0);
      }
      return result;
    };

    const originalDrawText = emulator.sysDrawText.bind(emulator);
    emulator.sysDrawText = () => {
      const ebx = emulator.readReg(REG.EBX) >>> 0;
      const ecx = emulator.readReg(REG.ECX) >>> 0;
      const edx = emulator.readReg(REG.EDX) >>> 0;
      const esi = emulator.readReg(REG.ESI) >>> 0;
      const edi = emulator.readReg(REG.EDI) >>> 0;
      const x = unpackSignedHigh16(ebx);
      const y = unpackSignedLow16(ebx);
      const color = ecx & 0x00ffffff;
      const flags = (ecx >>> 24) & 0xff;
      const zeroTerm = (flags & 0x80) !== 0;
      const fillBackground = (flags & 0x40) !== 0;
      const fontMode = (flags >>> 4) & 0x03;
      const drawToBuffer = (flags & 0x08) !== 0;
      const scale = (flags & 0x07) + 1;

      let record = null;
      if (edx !== 0 && !drawToBuffer) {
        const maxChars = zeroTerm ? 2048 : Math.min(esi >>> 0, 2048);
        let maxBytes = maxChars;
        if (fontMode === 2) {
          maxBytes = zeroTerm ? 4096 : (maxChars * 2);
        } else if (fontMode === 3) {
          maxBytes = zeroTerm ? 8192 : (maxChars * 4);
        }
        const bytes = emulator.readMemBlock(edx, maxBytes >>> 0);
        if (bytes) {
          const text = decodeTextBytes(bytes, zeroTerm, maxChars, fontMode);
          const textInfo = getTextInfo(bytes, zeroTerm, maxChars, fontMode);
          const size = measureKolibriText(textInfo, scale);
          const pos = this.applyProcessWindowOffset(process, x, y);
          record = {
            kind: "text",
            text,
            x: x | 0,
            y: y | 0,
            screenX: pos.x | 0,
            screenY: pos.y | 0,
            width: size.width | 0,
            height: size.height | 0,
            fontMode: fontMode | 0,
            scale: scale | 0,
            colorHex: toHex24(color),
            fillBackground: !!fillBackground,
            backgroundHex: toHex24(edi & 0x00ffffff)
          };
        }
      }

      const result = originalDrawText();
      if (record) {
        this.upsertDrawRecord(process, process.textDraws, record);
      }
      return result;
    };

    const originalDrawNumber = emulator.sysDrawNumber.bind(emulator);
    emulator.sysDrawNumber = () => {
      const ebx = emulator.readReg(REG.EBX) >>> 0;
      const ecx = emulator.readReg(REG.ECX) >>> 0;
      const edx = emulator.readReg(REG.EDX) >>> 0;
      const esi = emulator.readReg(REG.ESI) >>> 0;
      const edi = emulator.readReg(REG.EDI) >>> 0;
      const bl = ebx & 0xff;
      const bh = (ebx >>> 8) & 0xff;
      let digits = (ebx >>> 16) & 0x3f;
      const isQword = (ebx & 0x40000000) !== 0;
      const noLeading = (ebx & 0x80000000) !== 0;
      const base = bh === 1 ? 16 : bh === 2 ? 2 : 10;
      const flags = (esi >>> 24) & 0xff;
      const fontMode = (flags >>> 4) & 0x03;
      const drawToBuffer = (flags & 0x08) !== 0;
      const fillBackground = (flags & 0x40) !== 0;
      const scale = (flags & 0x07) + 1;

      let record = null;
      if (!drawToBuffer) {
        let value = 0n;
        if (bl === 1) {
          if (ecx !== 0) {
            value = isQword ? emulator.readMem64(ecx) : BigInt(emulator.readMem32(ecx));
          }
        } else {
          value = BigInt(ecx >>> 0);
        }
        if (digits > 60) {
          digits = 60;
        }
        let text = value.toString(base);
        if (base === 16) {
          text = text.toUpperCase();
        }
        if (digits > 0) {
          if (text.length > digits) {
            text = text.slice(text.length - digits);
          } else if (!noLeading) {
            text = text.padStart(digits, "0");
          }
        }
        const x = unpackSignedHigh16(edx);
        const y = unpackSignedLow16(edx);
        const pos = this.applyProcessWindowOffset(process, x, y);
        const textInfo = getTextInfoFromString(text, fontMode);
        const size = measureKolibriText(textInfo, scale);
        record = {
          kind: "number",
          text,
          x: x | 0,
          y: y | 0,
          screenX: pos.x | 0,
          screenY: pos.y | 0,
          width: size.width | 0,
          height: size.height | 0,
          fontMode: fontMode | 0,
          scale: scale | 0,
          colorHex: toHex24(esi & 0x00ffffff),
          fillBackground: !!fillBackground,
          backgroundHex: toHex24(edi & 0x00ffffff),
          base: base | 0
        };
      }

      const result = originalDrawNumber();
      if (record) {
        this.upsertDrawRecord(process, process.numberDraws, record);
      }
      return result;
    };

    emulator.__uiHarnessInstalled = true;
  }

  applyProcessWindowOffset(process, x, y) {
    if (!process || !process.emulator) {
      return { x: x | 0, y: y | 0 };
    }
    const pos = process.emulator.applyWindowOffset(x | 0, y | 0);
    return {
      x: ((process.actualX | 0) + (pos.x | 0)) | 0,
      y: ((process.actualY | 0) + (pos.y | 0)) | 0
    };
  }

  upsertDrawRecord(process, target, record) {
    const next = { ...record, sequence: (process.drawSequence = ((process.drawSequence + 1) >>> 0)) };
    for (let i = target.length - 1; i >= 0; i -= 1) {
      const prev = target[i];
      if (
        prev.screenX === next.screenX &&
        prev.screenY === next.screenY &&
        prev.fontMode === next.fontMode &&
        prev.scale === next.scale &&
        prev.kind === next.kind
      ) {
        target.splice(i, 1);
      }
    }
    target.push(next);
  }

  clearDrawsInRect(process, screenX, screenY, width, height) {
    if (width <= 0 || height <= 0) {
      return;
    }
    const clearRect = {
      screenX: screenX | 0,
      screenY: screenY | 0,
      width: width | 0,
      height: height | 0
    };
    process.textDraws = process.textDraws.filter((item) => !rectContains(clearRect, item));
    process.numberDraws = process.numberDraws.filter((item) => !rectContains(clearRect, item));
  }

  exportDrawRecord(record) {
    return {
      kind: record.kind,
      text: record.text,
      x: record.x | 0,
      y: record.y | 0,
      screenX: record.screenX | 0,
      screenY: record.screenY | 0,
      width: record.width | 0,
      height: record.height | 0,
      fontMode: record.fontMode | 0,
      scale: record.scale | 0,
      color: record.colorHex,
      fillBackground: !!record.fillBackground,
      background: record.backgroundHex,
      sequence: record.sequence >>> 0,
      base: record.base === undefined ? undefined : (record.base | 0)
    };
  }

  resolveButtonLabel(button, process) {
    const rect = {
      screenX: button.screenX | 0,
      screenY: button.screenY | 0,
      width: button.width | 0,
      height: button.height | 0
    };
    const candidates = [];
    const target = process || this.getActiveProcess();
    const draws = target ? target.textDraws.concat(target.numberDraws) : [];
    for (let i = 0; i < draws.length; i += 1) {
      const draw = draws[i];
      if (!draw.text) {
        continue;
      }
      const overlap = rectOverlapArea(rect, draw);
      if (overlap <= 0) {
        continue;
      }
      if (!rectContains(rect, draw) && overlap < Math.min(draw.width * draw.height, rect.width * rect.height) / 3) {
        continue;
      }
      candidates.push(draw);
    }
    if (!candidates.length) {
      return "";
    }
    candidates.sort((a, b) => {
      if (a.screenY !== b.screenY) {
        return a.screenY - b.screenY;
      }
      if (a.screenX !== b.screenX) {
        return a.screenX - b.screenX;
      }
      return a.sequence - b.sequence;
    });
    return candidates.map((item) => item.text).join("").trim();
  }

  captureSnapshot(options) {
    const opts = options || {};
    const process = this.getActiveProcess();
    if (!process || !process.emulator || !process.surface) {
      return {
        running: false,
        target: this.targetPath || "",
        window: null,
        buttons: [],
        texts: [],
        numbers: [],
        surface: null
      };
    }
    const emulator = process.emulator;
    const surface = process.surface;
    const texts = process.textDraws
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map((item) => this.exportDrawRecord(item));
    const numbers = process.numberDraws
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map((item) => this.exportDrawRecord(item));
    const buttonMap = new Map();
    for (const button of emulator.buttons || []) {
      const pos = this.applyProcessWindowOffset(process, button.x | 0, button.y | 0);
      const item = {
        id: button.id & 0x00ffffff,
        label: "",
        x: button.x | 0,
        y: button.y | 0,
        screenX: pos.x | 0,
        screenY: pos.y | 0,
        width: button.width | 0,
        height: button.height | 0,
        hidden: !!button.hidden,
        noPressFrame: !!button.noPressFrame,
        color: toHex24(button.color || 0)
      };
      item.label = this.resolveButtonLabel(item, process);
      const key = [
        item.id,
        item.x,
        item.y,
        item.width,
        item.height,
        item.hidden ? 1 : 0
      ].join(":");
      buttonMap.set(key, item);
    }
    const buttons = Array.from(buttonMap.values());
    const windowWidth = Math.max(1, emulator.windowWidth | 0 || surface.width | 0);
    const windowHeight = Math.max(1, emulator.windowHeight | 0 || surface.height | 0);
    const snapshot = {
      running: !!emulator.running,
      target: process.targetPath || this.targetPath,
      title: process.windowTitle || emulator.windowTitle || "",
      pid: process.pid >>> 0,
      slot: process.slot >>> 0,
      window: {
        defined: !!emulator.windowDefined,
        width: windowWidth,
        height: windowHeight,
        originX: process.actualX | 0,
        originY: process.actualY | 0,
        clientOffsetX: emulator.windowClientOffsetX | 0,
        clientOffsetY: emulator.windowClientOffsetY | 0,
        skinHeight: emulator.skinHeight | 0,
        buttonStyle: emulator.buttonStyle | 0
      },
      buttons,
      texts,
      numbers,
      surface: {
        width: surface.width | 0,
        height: surface.height | 0,
        presentCount: process.presentCount | 0
      },
      pendingButtonResult: emulator.pendingButtonResult >>> 0,
      unknownOpcodes: Array.from(emulator.opcodeCounts.entries()).map(([opcode, count]) => ({
        opcode: `0x${(opcode >>> 0).toString(16)}`,
        count: count | 0
      }))
    };
    if (opts.includeSurfaceHash) {
      snapshot.surface.hash = fnv1a32FromSurface(surface, windowWidth, windowHeight);
    }
    if (opts.includeLogs) {
      snapshot.logs = process.logs.slice();
    }
    return snapshot;
  }

  composeDesktopSurface() {
    const { createHeadlessSurface } = loadKosRuntime().gfx.surface;
    const base = this.desktopSurface || createHeadlessSurface(this.baseWidth, this.baseHeight);
    const surface = createHeadlessSurface(base.width | 0, base.height | 0);
    if (base.buffer32 && surface.buffer32) {
      surface.buffer32.set(base.buffer32);
    }
    const stack = this.processes
      .filter((process) => !process.removed && !process.minimized && process.emulator && process.emulator.windowDefined && process.surface)
      .slice()
      .sort(compareProcessZOrder);
    for (let i = 0; i < stack.length; i += 1) {
      const process = stack[i];
      const src = process.surface;
      const dstWidth = surface.width | 0;
      const srcWidth = src.width | 0;
      const srcHeight = src.height | 0;
      const offsetX = process.actualX | 0;
      const offsetY = process.actualY | 0;
      for (let y = 0; y < srcHeight; y += 1) {
        const ty = offsetY + y;
        if (ty < 0 || ty >= (surface.height | 0)) {
          continue;
        }
        const srcRow = y * srcWidth;
        const dstRow = ty * dstWidth;
        for (let x = 0; x < srcWidth; x += 1) {
          const tx = offsetX + x;
          if (tx < 0 || tx >= dstWidth) {
            continue;
          }
          surface.buffer32[dstRow + tx] = src.buffer32[srcRow + x] >>> 0;
        }
      }
    }
    return surface;
  }

  captureDesktopSnapshot(options) {
    const opts = options || {};
    const surface = this.composeDesktopSurface();
    const desktop = {
      width: surface.width | 0,
      height: surface.height | 0
    };
    if (opts.includeSurfaceHash) {
      desktop.hash = fnv1a32FromSurface(surface, surface.width | 0, surface.height | 0);
    }
    return {
      target: this.targetPath || "",
      screen: {
        reported: this.getReportedScreenSize(),
        workArea: this.getScreenWorkArea()
      },
      desktopSurface: desktop,
      processes: this.processes
        .filter((process) => !process.removed)
        .map((process) => ({
          pid: process.pid >>> 0,
          slot: process.slot >>> 0,
          displayPath: process.displayPath || "",
          title: process.windowTitle || "",
          windowDefined: !!(process.emulator && process.emulator.windowDefined),
          minimized: !!process.minimized,
          x: process.actualX | 0,
          y: process.actualY | 0,
          width: process.surface ? (process.surface.width | 0) : 0,
          height: process.surface ? (process.surface.height | 0) : 0,
          presentCount: process.presentCount | 0,
          windowPositionMode: process.windowPositionMode | 0
        }))
    };
  }

  findButtons(query, snapshot) {
    const state = snapshot || this.captureSnapshot();
    const q = query || {};
    const id = q.id === undefined ? null : parseNumberish(q.id);
    const label = q.label === undefined ? null : String(q.label);
    return state.buttons.filter((button) => {
      if (q.hidden !== undefined && !!button.hidden !== !!q.hidden) {
        return false;
      }
      if (id !== null && (button.id >>> 0) !== (id >>> 0)) {
        return false;
      }
      if (label !== null && button.label !== label) {
        return false;
      }
      return true;
    });
  }

  findDraws(kind, matcher, snapshot) {
    const state = snapshot || this.captureSnapshot();
    const list = kind === "number" ? state.numbers : state.texts;
    const exact = matcher.exact !== false;
    const expected = matcher.text === undefined ? String(matcher.value) : String(matcher.text);
    return list.filter((item) => {
      if (exact) {
        return item.text === expected;
      }
      return item.text.includes(expected);
    });
  }

  assertRunning() {
    const process = this.getActiveProcess();
    if (!process || !process.emulator || !process.emulator.running) {
      const snapshot = this.captureSnapshot({ includeLogs: true });
      const tail = snapshot.logs && snapshot.logs.length ? snapshot.logs.slice(-10).join("\n") : "no logs";
      throw new Error(`Emulator is not running.\n${tail}`);
    }
  }

  formatFailure(message, snapshot) {
    const state = snapshot || this.captureSnapshot({ includeLogs: true });
    const buttonPreview = state.buttons
      .filter((item) => !item.hidden)
      .slice(0, 12)
      .map((item) => `${item.id}:${item.label || "<empty>"}`)
      .join(", ");
    const latestNumber = state.numbers.length ? state.numbers[state.numbers.length - 1].text : "<none>";
    const latestText = state.texts.length ? state.texts[state.texts.length - 1].text : "<none>";
    const logTail = state.logs && state.logs.length ? state.logs.slice(-8).join("\n") : "no logs";
    return new Error(
      `${message}\n` +
      `window=${state.window ? `${state.window.width}x${state.window.height}` : "<none>"} ` +
      `title='${state.title || ""}' latestNumber='${latestNumber}' latestText='${latestText}'\n` +
      `buttons=${buttonPreview || "<none>"}\n` +
      `logs:\n${logTail}`
    );
  }

  async waitUntil(predicate, description, timeoutMs) {
    const timeout = Math.max(10, timeoutMs | 0 || this.defaultTimeoutMs);
    const deadline = Date.now() + timeout;
    while (Date.now() <= deadline) {
      const snapshot = this.captureSnapshot();
      const result = predicate(snapshot);
      if (result) {
        return result;
      }
      const process = this.getActiveProcess();
      if (process && process.emulator && !process.emulator.running) {
        throw this.formatFailure(`Timed out waiting for ${description}; emulator stopped.`, this.captureSnapshot({ includeLogs: true }));
      }
      await sleep(10);
    }
    throw this.formatFailure(`Timed out waiting for ${description}.`, this.captureSnapshot({ includeLogs: true }));
  }

  async waitForButton(query, timeoutMs) {
    return this.waitUntil((snapshot) => {
      const buttons = this.findButtons(query, snapshot).filter((item) => !item.hidden);
      const index = Math.max(0, query.index | 0 || 0);
      return buttons[index] || null;
    }, `button ${query.label !== undefined ? `'${query.label}'` : `id ${query.id}`}`, timeoutMs);
  }

  async waitForText(query, timeoutMs) {
    return this.waitUntil((snapshot) => {
      const draws = this.findDraws("text", query, snapshot);
      return draws.length ? draws[draws.length - 1] : null;
    }, `text '${query.text}'`, timeoutMs);
  }

  async waitForNumber(query, timeoutMs) {
    return this.waitUntil((snapshot) => {
      const draws = this.findDraws("number", query, snapshot);
      return draws.length ? draws[draws.length - 1] : null;
    }, `number '${query.value}'`, timeoutMs);
  }

  async pressKey(step, options) {
    const opts = options || {};
    const asciiCode = parseNumberish(step.ascii);
    const scanCode = parseNumberish(step.scan);
    const controlKeys = parseNumberish(step.controlKeys);
    const settleDelay = opts.settleMs === undefined ? this.actionDelayMs : Math.max(0, opts.settleMs | 0);
    this.assertRunning();
    const process = this.getActiveProcess();
    if (!process || !process.emulator) {
      throw new Error("No active process to receive key input.");
    }
    process.controlKeyMask = controlKeys === null ? 0 : (controlKeys | 0);
    this.controlKeyMask = process.controlKeyMask | 0;
    process.emulator.setControlKeyState(process.controlKeyMask | 0);
    process.emulator.queueKeyEvent(
      asciiCode === null ? 0 : asciiCode,
      scanCode === null ? 0 : scanCode,
      controlKeys === null ? 0 : controlKeys,
      !!step.hotkey
    );
    if (settleDelay > 0) {
      await sleep(settleDelay);
    }
    return this.captureSnapshot();
  }

  async pressDomKey(step, options) {
    const opts = options || {};
    const ui = loadKosRuntime().ui || {};
    const keyboard = ui.keyboard || null;
    const phase = String(step && step.phase || "tap").toLowerCase();
    const holdDelay = opts.holdMs === undefined ? this.actionDelayMs : Math.max(0, opts.holdMs | 0);
    const settleDelay = opts.settleMs === undefined ? this.actionDelayMs : Math.max(0, opts.settleMs | 0);
    if (!keyboard || typeof keyboard.translateDomKeyboardEvent !== "function" || typeof keyboard.updateControlKeyMaskState !== "function") {
      throw new Error("Browser keyboard helpers are not available in the harness runtime.");
    }
    this.assertRunning();

    const sendPhase = (isDown) => {
      const process = this.getActiveProcess();
      if (!process || !process.emulator) {
        return;
      }
      const event = createHarnessDomKeyEvent(step, process.controlKeyMask | 0);
      process.controlKeyMask = keyboard.updateControlKeyMaskState(process.controlKeyMask | 0, event, !!isDown);
      this.controlKeyMask = process.controlKeyMask | 0;
      const info = keyboard.translateDomKeyboardEvent(event);
      if (!info) {
        return;
      }
      process.emulator.queueBrowserKeyEvent({
        browser: true,
        enqueue: true,
        released: !isDown,
        hotkey: !!step.hotkey,
        controlKeys: process.controlKeyMask | 0,
        asciiCode: info.asciiCode | 0,
        scanCode: info.scanCode | 0,
        extended: !!info.extended,
        modifier: !!info.modifier,
        lockKey: !!info.lockKey
      });
    };

    if (phase === "down") {
      sendPhase(true);
    } else if (phase === "up") {
      sendPhase(false);
    } else {
      sendPhase(true);
      if (holdDelay > 0) {
        await sleep(holdDelay);
      }
      sendPhase(false);
    }

    if (settleDelay > 0) {
      await sleep(settleDelay);
    }
    return this.captureSnapshot();
  }

  async clickScreen(x, y, options) {
    const opts = options || {};
    const moveDelay = opts.moveDelayMs === undefined ? this.actionDelayMs : Math.max(0, opts.moveDelayMs | 0);
    const pressDelay = opts.pressDelayMs === undefined ? this.actionDelayMs : Math.max(0, opts.pressDelayMs | 0);
    const releaseDelay = opts.releaseDelayMs === undefined ? this.actionDelayMs : Math.max(0, opts.releaseDelayMs | 0);
    const settleDelay = opts.settleMs === undefined ? this.actionDelayMs : Math.max(0, opts.settleMs | 0);
    this.assertRunning();
    const process = this.getActiveProcess();
    if (!process || !process.emulator) {
      throw new Error("No active process to receive mouse input.");
    }
    const screenX = x | 0;
    const screenY = y | 0;
    this.forwardGlobalMouseState(screenX, screenY, 0, 0, 0, true, 0, 0);
    if (moveDelay > 0) {
      await sleep(moveDelay);
    }
    this.forwardGlobalMouseState(screenX, screenY, 1, 1, 0, false, 0, 0);
    if (pressDelay > 0) {
      await sleep(pressDelay);
    }
    this.forwardGlobalMouseState(screenX, screenY, 0, 0, 1, false, 0, 0);
    if (releaseDelay > 0) {
      await sleep(releaseDelay);
    }
    if (settleDelay > 0) {
      await sleep(settleDelay);
    }
    return this.captureSnapshot();
  }

  getDesktopInputProcesses() {
    return this.processes.filter((process) => {
      if (!process || process.removed || process.minimized || !process.emulator || !process.emulator.running) {
        return false;
      }
      if ((process.windowPositionMode | 0) === WINDOW_Z_DESKTOP) {
        return true;
      }
      return !process.emulator.windowDefined;
    });
  }

  getProcessMouseState(process, screenX, screenY) {
    if (!process || process.removed || !process.emulator) {
      return null;
    }
    const x = screenX | 0;
    const y = screenY | 0;
    if (process.minimized && (process.windowPositionMode | 0) !== WINDOW_Z_DESKTOP) {
      return null;
    }
    if ((process.windowPositionMode | 0) === WINDOW_Z_DESKTOP || !process.emulator.windowDefined) {
      const viewport = this.getViewportSize();
      return {
        x,
        y,
        screenX: x,
        screenY: y,
        inside:
          x >= 0 &&
          y >= 0 &&
          x < (viewport.width | 0) &&
          y < (viewport.height | 0)
      };
    }
    const localX = (x - (process.actualX | 0)) | 0;
    const localY = (y - (process.actualY | 0)) | 0;
    const width = process.surface ? (process.surface.width | 0) : this.baseWidth;
    const height = process.surface ? (process.surface.height | 0) : this.baseHeight;
    const insideRect = localX >= 0 && localY >= 0 && localX < width && localY < height;
    let inside = insideRect;
    const shape = process.windowShape;
    if (inside && shape && shape.data instanceof Uint8Array) {
      if (localX >= (shape.width | 0) || localY >= (shape.height | 0)) {
        inside = false;
      } else {
        inside = !!shape.data[localY * (shape.width | 0) + localX];
      }
    }
    return {
      x: localX,
      y: localY,
      screenX: x,
      screenY: y,
      inside
    };
  }

  forwardGlobalMouseState(screenX, screenY, buttons, pressMask, releaseMask, moved, wheelX, wheelY) {
    const x = screenX | 0;
    const y = screenY | 0;
    for (const process of this.processes) {
      if (!process || process.removed || !process.emulator || !process.emulator.running) {
        continue;
      }
      const state = this.getProcessMouseState(process, x, y);
      if (!state) {
        continue;
      }
      process.emulator.setMouseState(
        state.x | 0,
        state.y | 0,
        buttons | 0,
        !!state.inside,
        pressMask | 0,
        releaseMask | 0,
        wheelX | 0,
        wheelY | 0,
        !!moved,
        x,
        y
      );
    }
  }

  async clickDesktop(x, y, options) {
    const opts = options || {};
    const moveDelay = opts.moveDelayMs === undefined ? this.actionDelayMs : Math.max(0, opts.moveDelayMs | 0);
    const pressDelay = opts.pressDelayMs === undefined ? this.actionDelayMs : Math.max(0, opts.pressDelayMs | 0);
    const releaseDelay = opts.releaseDelayMs === undefined ? this.actionDelayMs : Math.max(0, opts.releaseDelayMs | 0);
    const settleDelay = opts.settleMs === undefined ? this.actionDelayMs : Math.max(0, opts.settleMs | 0);
    this.assertRunning();
    const targets = this.getDesktopInputProcesses();
    if (!targets.length && !this.processes.length) {
      throw new Error("No processes are available to receive mouse input.");
    }
    const screenX = x | 0;
    const screenY = y | 0;
    const send = (buttons, pressMask, releaseMask, moved) => {
      this.forwardGlobalMouseState(screenX, screenY, buttons | 0, pressMask | 0, releaseMask | 0, !!moved, 0, 0);
    };
    send(0, 0, 0, true);
    if (moveDelay > 0) {
      await sleep(moveDelay);
    }
    send(1, 1, 0, false);
    if (pressDelay > 0) {
      await sleep(pressDelay);
    }
    send(0, 0, 1, false);
    if (releaseDelay > 0) {
      await sleep(releaseDelay);
    }
    if (settleDelay > 0) {
      await sleep(settleDelay);
    }
    return this.captureSnapshot();
  }

  async clickButton(query, timeoutMs, options) {
    const button = await this.waitForButton(query, timeoutMs);
    const x = button.screenX + Math.max(0, Math.floor(button.width / 2));
    const y = button.screenY + Math.max(0, Math.floor(button.height / 2));
    return this.clickScreen(x, y, options);
  }

  resolveClientCoords(x, y) {
    const process = this.getActiveProcess();
    if (!process || !process.emulator) {
      return { x: x | 0, y: y | 0 };
    }
    return this.applyProcessWindowOffset(process, x | 0, y | 0);
  }

  async runStep(step, index, scenarioTimeoutMs) {
    const action = String(step && step.action || "").trim();
    if (!action) {
      throw new Error(`Scenario step ${index + 1} is missing 'action'.`);
    }

    const timeout = step.timeoutMs === undefined ? scenarioTimeoutMs : Math.max(10, step.timeoutMs | 0);

    switch (action) {
      case "wait":
        await sleep(Math.max(0, step.ms | 0 || 0));
        return this.captureSnapshot();
      case "waitForButton":
        return this.waitForButton(step, timeout);
      case "waitForText":
        return this.waitForText(step, timeout);
      case "waitForNumber":
        return this.waitForNumber(step, timeout);
      case "clickButton":
        return this.clickButton(step, timeout, step);
      case "clickAt": {
        const rawX = parseNumberish(step.x);
        const rawY = parseNumberish(step.y);
        if (rawX === null || rawY === null) {
          throw new Error(`Scenario step ${index + 1} clickAt requires numeric x/y.`);
        }
        const pos = step.screen ? { x: rawX | 0, y: rawY | 0 } : this.resolveClientCoords(rawX, rawY);
        return this.clickScreen(pos.x, pos.y, step);
      }
      case "pressKey":
        return this.pressKey(step, step);
      case "pressDomKey":
        return this.pressDomKey(step, step);
      case "assertButton": {
        const snapshot = this.captureSnapshot();
        const matches = this.findButtons(step, snapshot).filter((item) => !item.hidden);
        if (!matches.length) {
          throw this.formatFailure(`Button assertion failed on step ${index + 1}.`, this.captureSnapshot({ includeLogs: true }));
        }
        return matches[0];
      }
      case "assertText":
        return this.waitUntil((snapshot) => {
          const draws = this.findDraws("text", step, snapshot);
          return draws.length ? draws[draws.length - 1] : null;
        }, `assert text '${step.text}'`, timeout);
      case "assertNumber":
        return this.waitUntil((snapshot) => {
          const draws = this.findDraws("number", step, snapshot);
          return draws.length ? draws[draws.length - 1] : null;
        }, `assert number '${step.value}'`, timeout);
      case "assertWindow": {
        const snapshot = this.captureSnapshot();
        const info = snapshot.window || {};
        if (step.width !== undefined && (info.width | 0) !== (step.width | 0)) {
          throw this.formatFailure(`Window width assertion failed on step ${index + 1}.`, this.captureSnapshot({ includeLogs: true }));
        }
        if (step.height !== undefined && (info.height | 0) !== (step.height | 0)) {
          throw this.formatFailure(`Window height assertion failed on step ${index + 1}.`, this.captureSnapshot({ includeLogs: true }));
        }
        if (step.minWidth !== undefined && (info.width | 0) < (step.minWidth | 0)) {
          throw this.formatFailure(`Window minWidth assertion failed on step ${index + 1}.`, this.captureSnapshot({ includeLogs: true }));
        }
        if (step.minHeight !== undefined && (info.height | 0) < (step.minHeight | 0)) {
          throw this.formatFailure(`Window minHeight assertion failed on step ${index + 1}.`, this.captureSnapshot({ includeLogs: true }));
        }
        if (step.title !== undefined && snapshot.title !== String(step.title)) {
          throw this.formatFailure(`Window title assertion failed on step ${index + 1}.`, this.captureSnapshot({ includeLogs: true }));
        }
        return info;
      }
      default:
        throw new Error(`Unknown scenario action '${action}' on step ${index + 1}.`);
    }
  }

  async runScenario(scenario) {
    if (!scenario || typeof scenario !== "object") {
      throw new Error("Scenario must be an object.");
    }
    const steps = Array.isArray(scenario.steps) ? scenario.steps : [];
    const scenarioTimeoutMs = Math.max(10, scenario.timeoutMs | 0 || this.defaultTimeoutMs);
    const settleMs = Math.max(0, scenario.settleMs | 0 || 0);
    for (let i = 0; i < steps.length; i += 1) {
      await this.runStep(steps[i], i, scenarioTimeoutMs);
    }
    if (settleMs > 0) {
      await sleep(settleMs);
    }
    return this.captureSnapshot({ includeSurfaceHash: true });
  }

  getWindowStack() {
    return this.processes
      .filter((process) => !process.removed)
      .slice()
      .sort((a, b) => compareProcessZOrder(b, a));
  }

  getVisibleWindowStack() {
    return this.processes
      .filter((process) => !process.removed && !process.minimized)
      .slice()
      .sort((a, b) => compareProcessZOrder(b, a));
  }

  getWindowStackPositionSlots() {
    return this.getWindowStack()
      .map((process) => (process && !process.removed ? (process.slot >>> 0) : 0))
      .filter((slot) => slot > 0)
      .sort((a, b) => a - b);
  }

  getWindowStackPosition(slot) {
    const target = slot >>> 0;
    const stack = this.getWindowStack();
    const positions = this.getWindowStackPositionSlots();
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

  getThreadCount() {
    let count = 0;
    for (let i = 0; i < this.processes.length; i += 1) {
      const process = this.processes[i];
      if (process && !process.removed) {
        count += 1;
      }
    }
    return Math.max(1, count) >>> 0;
  }

  processOwnsScreenPoint(process, screenX, screenY) {
    if (!process || process.removed || process.minimized || !process.emulator || !process.emulator.windowDefined || !process.surface) {
      return false;
    }
    const localX = (screenX - (process.actualX | 0)) | 0;
    const localY = (screenY - (process.actualY | 0)) | 0;
    const width = process.surface.width | 0;
    const height = process.surface.height | 0;
    if (localX < 0 || localY < 0 || localX >= width || localY >= height) {
      return false;
    }
    const shape = process.windowShape;
    if (!shape || !(shape.data instanceof Uint8Array)) {
      return true;
    }
    if (localX >= (shape.width | 0) || localY >= (shape.height | 0)) {
      return false;
    }
    return !!shape.data[localY * (shape.width | 0) + localX];
  }

  getPixelOwnerAt(x, y) {
    const screenX = x | 0;
    const screenY = y | 0;
    const viewport = this.getViewportSize();
    if (screenX < 0 || screenY < 0 || screenX >= (viewport.width | 0) || screenY >= (viewport.height | 0)) {
      return 0;
    }
    const stack = this.getVisibleWindowStack();
    for (let i = 0; i < stack.length; i += 1) {
      const process = stack[i];
      if (this.processOwnsScreenPoint(process, screenX, screenY)) {
        return process.slot >>> 0;
      }
    }
    return 1;
  }

  getPixelColorAt(x, y) {
    const screenX = x | 0;
    const screenY = y | 0;
    const viewport = this.getViewportSize();
    if (screenX < 0 || screenY < 0 || screenX >= (viewport.width | 0) || screenY >= (viewport.height | 0)) {
      return 0;
    }
    const stack = this.getVisibleWindowStack();
    for (let i = 0; i < stack.length; i += 1) {
      const process = stack[i];
      if (!this.processOwnsScreenPoint(process, screenX, screenY)) {
        continue;
      }
      const localX = (screenX - (process.actualX | 0)) | 0;
      const localY = (screenY - (process.actualY | 0)) | 0;
      return readSurfacePixelColor(process.surface, localX | 0, localY | 0) & 0x00ffffff;
    }
    return readSurfacePixelColor(this.desktopSurface, screenX | 0, screenY | 0) & 0x00ffffff;
  }

  getMaxThreadSlot() {
    let maxSlot = 0;
    for (let i = 0; i < this.processes.length; i += 1) {
      const process = this.processes[i];
      if (!process || process.removed) {
        continue;
      }
      maxSlot = Math.max(maxSlot, process.slot | 0);
    }
    return Math.max(0, maxSlot | 0) >>> 0;
  }

  getActiveThreadSlot() {
    const process = this.getActiveProcess();
    return process ? (process.slot >>> 0) : 0;
  }

  getThreadSlotByProcessId(pid) {
    const process = this.processByPid.get(pid >>> 0) || null;
    return process && !process.removed ? (process.slot >>> 0) : 0;
  }

  getWindowStackSlot(position) {
    const stack = this.getWindowStack();
    const positions = this.getWindowStackPositionSlots();
    const target = position >>> 0;
    const positionIndex = positions.indexOf(target);
    if (positionIndex < 0) {
      return 0;
    }
    const stackIndex = positions.length - 1 - positionIndex;
    return stackIndex >= 0 && stack[stackIndex] ? (stack[stackIndex].slot >>> 0) : 0;
  }

  getClientBounds(process) {
    const emulator = process && process.emulator ? process.emulator : null;
    const style = emulator ? (emulator.windowStyle & 0xff) : 0;
    const skinned = style === 3 || style === 4;
    let clientOffsetX = emulator ? (emulator.windowClientOffsetX | 0) : 0;
    let clientOffsetY = emulator ? (emulator.windowClientOffsetY | 0) : 0;
    if (!clientOffsetX && skinned) {
      clientOffsetX = 4;
    }
    if (!clientOffsetY && skinned) {
      clientOffsetY = emulator ? (emulator.skinHeight | 0) : 24;
    }
    const rightInset = skinned ? 4 : 0;
    const bottomInset = skinned ? 5 : 0;
    const width = process && process.surface ? (process.surface.width | 0) : this.baseWidth;
    const height = process && process.surface ? (process.surface.height | 0) : this.baseHeight;
    return {
      x: clientOffsetX | 0,
      y: clientOffsetY | 0,
      width: Math.max(0, width - clientOffsetX - rightInset) | 0,
      height: Math.max(0, height - clientOffsetY - bottomInset) | 0
    };
  }

  getThreadInfo(slot) {
    const process = this.processBySlot.get(slot >>> 0) || null;
    if (!process || process.removed) {
      return null;
    }
    const emulator = process.emulator;
    const client = this.getClientBounds(process);
    return {
      cpuUsage: emulator && typeof emulator.getReportedCpuUsage === "function"
        ? emulator.getReportedCpuUsage()
        : 0,
      windowStackPosition: this.getWindowStackPosition(slot >>> 0),
      name: path.basename(String(process.displayPath || process.processPath || process.fileName || "thread")).slice(0, 12),
      memoryAddress: 0,
      usedMemory: emulator && typeof emulator.getCommittedProcessMemoryBytes === "function"
        ? (emulator.getCommittedProcessMemoryBytes() >>> 0)
        : (this.getApproxProcessMemoryBytes(process) >>> 0),
      pid: process.pid >>> 0,
      windowX: process.actualX >>> 0,
      windowY: process.actualY >>> 0,
      windowWidth: process.surface ? (process.surface.width >>> 0) : 0,
      windowHeight: process.surface ? (process.surface.height >>> 0) : 0,
      slotState: process.stopped ? 9 : 0,
      clientX: client.x >>> 0,
      clientY: client.y >>> 0,
      clientWidth: client.width >>> 0,
      clientHeight: client.height >>> 0,
      windowState: (
        WINDOW_STATE_USED |
        (process.minimized ? WINDOW_STATE_MINIMIZED : 0) |
        (process.rolledUp ? WINDOW_STATE_ROLLEDUP : 0) |
        (process.maximized ? WINDOW_STATE_MAXIMIZED : 0)
      ) >>> 0,
      eventMask: emulator ? (emulator.eventMask >>> 0) : 0,
      keyboardMode: emulator ? (emulator.keyboardMode & 0xff) : 0
    };
  }

  sendIpcMessage(request) {
    const senderPid = request && request.senderPid ? (request.senderPid >>> 0) : 0;
    const targetPid = request && request.targetPid ? (request.targetPid >>> 0) : 0;
    const target = this.processByPid.get(targetPid) || null;
    if (!targetPid || !target || target.removed || !target.emulator) {
      return 4;
    }
    const emulator = target.emulator;
    const bufferPtr = emulator.ipcBufferPtr >>> 0;
    const bufferSize = emulator.ipcBufferSize >>> 0;
    if (!bufferPtr || bufferSize < 8) {
      return 1;
    }
    let data = new Uint8Array(0);
    if (request && request.data instanceof Uint8Array) {
      data = request.data;
    } else if (request && request.data instanceof ArrayBuffer) {
      data = new Uint8Array(request.data);
    } else if (request && request.data && ArrayBuffer.isView(request.data)) {
      data = new Uint8Array(request.data.buffer, request.data.byteOffset, request.data.byteLength);
    }
    try {
      if ((emulator.readMem32(bufferPtr >>> 0) >>> 0) !== 0) {
        return 2;
      }
      let used = emulator.readMem32((bufferPtr + 4) >>> 0) >>> 0;
      if (used < 8) {
        used = 8;
      }
      const messageSize = (8 + (data.length >>> 0)) >>> 0;
      const nextUsed = (used + messageSize) >>> 0;
      if (used > bufferSize || nextUsed > bufferSize || nextUsed < used) {
        return 3;
      }
      const messagePtr = (bufferPtr + used) >>> 0;
      emulator.writeMem32(messagePtr >>> 0, senderPid >>> 0);
      emulator.writeMem32((messagePtr + 4) >>> 0, data.length >>> 0);
      if (data.length) {
        emulator.writeMemBlock((messagePtr + 8) >>> 0, data);
      }
      emulator.writeMem32((bufferPtr + 4) >>> 0, nextUsed >>> 0);
      emulator.queueEvent(7);
      emulator.wakeExecution();
      return 0;
    } catch (err) {
      this.log(`IPC delivery failed to pid ${targetPid} from ${senderPid}: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  wakeSiblingThreads(slot, forceWake) {
    const source = this.processBySlot.get(slot >>> 0) || null;
    if (!source || source.removed) {
      return;
    }
    const threadGroupId = source.threadGroupId >>> 0;
    for (let i = 0; i < this.processes.length; i += 1) {
      const process = this.processes[i];
      if (
        !process ||
        process.removed ||
        !process.emulator ||
        !process.emulator.running ||
        (process.slot >>> 0) === (source.slot >>> 0) ||
        (process.threadGroupId >>> 0) !== threadGroupId
      ) {
        continue;
      }
      process.emulator.wakeExecution(!!forceWake);
    }
  }

  queueSiblingRedraw(threadGroupId, excludedSlot) {
    const groupId = threadGroupId >>> 0;
    const excluded = excludedSlot >>> 0;
    if (!groupId) {
      return;
    }
    for (let i = 0; i < this.processes.length; i += 1) {
      const process = this.processes[i];
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

  focusThreadSlot(slot) {
    const process = this.processBySlot.get(slot >>> 0) || null;
    if (!process || process.removed) {
      return this.getActiveThreadSlot();
    }
    this.setActiveProcess(process);
    return process.slot >>> 0;
  }

  unfocusThreadSlot(slot) {
    const active = this.getActiveProcess();
    if (!active || ((slot >>> 0) !== (active.slot >>> 0) && slot !== 0xffffffff)) {
      return this.getActiveThreadSlot();
    }
    const stack = this.getVisibleWindowStack();
    const next = stack.find((process) => (process.slot >>> 0) !== (active.slot >>> 0)) || null;
    this.setActiveProcess(next || null);
    return this.getActiveThreadSlot();
  }

  isSpecialWindowProcess(process) {
    const name = path.basename(String(process && (process.displayPath || process.processPath || process.fileName || "")));
    return name.startsWith("@");
  }

  hasTaskbarWindow() {
    return this.processes.some((process) => (
      process &&
      !process.removed &&
      process.emulator &&
      process.emulator.windowDefined &&
      String(path.basename(String(process.displayPath || process.processPath || process.fileName || ""))).toUpperCase() === "@TASKBAR"
    ));
  }

  minimizeProcess(process) {
    if (
      !process ||
      process.removed ||
      process.minimized ||
      !process.emulator ||
      !process.emulator.windowDefined ||
      !this.hasTaskbarWindow()
    ) {
      return false;
    }
    const next = this.activeProcess === process
      ? (this.getVisibleWindowStack().find((item) => item !== process) || null)
      : null;
    process.minimized = true;
    if (this.activeProcess === process) {
      this.setActiveProcess(next || null);
    } else {
      this.syncActiveAliases();
    }
    return true;
  }

  restoreProcess(process, options) {
    if (!process || process.removed) {
      return false;
    }
    const changed = !!process.minimized;
    process.minimized = false;
    if (!options || options.activate !== false) {
      this.setActiveProcess(process);
    } else {
      this.syncActiveAliases();
    }
    return changed;
  }

  minimizeTopWindow() {
    const active = this.getActiveProcess();
    const target = active && !active.minimized
      ? active
      : (this.getVisibleWindowStack()[0] || null);
    return this.minimizeProcess(target);
  }

  controlForeignWindow(action, value) {
    const sub = action >>> 0;
    const key = value >>> 0;
    let process = null;
    if (sub === 0 || sub === 2) {
      process = this.processBySlot.get(key) || null;
    } else if (sub === 1 || sub === 3) {
      process = this.processByPid.get(key) || null;
    } else {
      return 0xffffffff >>> 0;
    }
    if (!process || process.removed) {
      return 0xffffffff >>> 0;
    }
    if (sub === 0 || sub === 1) {
      return this.minimizeProcess(process) ? 0 : (0xffffffff >>> 0);
    }
    return this.restoreProcess(process, { activate: false }) ? 0 : (0xffffffff >>> 0);
  }

  minimizeAllWindows() {
    const list = this.processes.filter((process) => (
      process &&
      !process.removed &&
      !process.minimized &&
      process.emulator &&
      process.emulator.windowDefined &&
      !this.isSpecialWindowProcess(process)
    ));
    let count = 0;
    for (let i = 0; i < list.length; i += 1) {
      count += this.minimizeProcess(list[i]) ? 1 : 0;
    }
    return count >>> 0;
  }

  stopAllProcesses(reason) {
    if (!this.processes.length) {
      return false;
    }
    const list = this.processes.slice();
    for (let i = 0; i < list.length; i += 1) {
      const process = list[i];
      if (!process || process.removed) {
        continue;
      }
      if (process.emulator && process.emulator.running) {
        process.emulator.stop(reason || "stopped");
        continue;
      }
      process.stopped = true;
      process.removed = true;
      this.unregisterProcess(process);
    }
    return true;
  }

  rebootSession(mode) {
    const targetPath = this.targetPath ? path.resolve(this.targetPath) : "";
    this.stopAllProcesses("stopped");
    this.clearCapture();
    this.nextPid = 1;
    this.nextSlot = 1;
    this.zCounter = 1;
    this.lastSystemAction = mode >>> 0;
    if (!targetPath || !fs.existsSync(targetPath)) {
      return true;
    }
    this.targetPath = targetPath;
    this.reloadSystemStyleFromFileSystem();
    const image = readTargetImage(targetPath);
    this.createProcess({
      image,
      fileName: path.basename(targetPath),
      targetPath,
      processPath: buildExternalAppProcessPath(targetPath),
      displayPath: targetPath,
      processArgs: "",
      pid: this.nextPid++,
      slot: this.nextSlot++,
      groupLeaderPid: 0,
      threadGroupId: 0,
      initialX: 0,
      initialY: 0
    });
    return true;
  }

  requestSystemAction(action) {
    const mode = action >>> 0;
    if (mode !== 2 && mode !== 3 && mode !== 4) {
      return false;
    }
    this.lastSystemAction = mode >>> 0;
    if (mode === 3 || mode === 4) {
      return this.rebootSession(mode);
    }
    this.stopAllProcesses("stopped");
    return true;
  }

  terminateThreadSlot(slot) {
    const process = this.processBySlot.get(slot >>> 0) || null;
    if (!process || process.removed) {
      return false;
    }
    if (process.emulator && process.emulator.running) {
      process.emulator.stop("terminated");
    }
    process.stopped = true;
    process.removed = true;
    this.unregisterProcess(process);
    return true;
  }

  terminateProcessId(pid) {
    const process = this.processByPid.get(pid >>> 0) || null;
    return process ? this.terminateThreadSlot(process.slot >>> 0) : false;
  }

  startApplication(request) {
    const parentSlot = request && request.parentThreadSlot ? (request.parentThreadSlot >>> 0) : 0;
    const parentPid = request && request.parentPid ? (request.parentPid >>> 0) : 0;
    const hasParentContext = !!(parentSlot || parentPid);
    const parent = this.processBySlot.get(parentSlot) || this.processByPid.get(parentPid) || (!hasParentContext ? this.getActiveProcess() : null);
    const rawPath = request && request.path ? String(request.path) : "";
    const processArgs = request && request.params ? String(request.params) : "";
    if (!parent || !parent.emulator || !rawPath) {
      return { errorCode: 33, pid: 0 };
    }
    const resolvedPath = typeof parent.emulator.resolveKosPath === "function"
      ? parent.emulator.resolveKosPath(rawPath)
      : rawPath;
    this.logForProcess(
      parent,
      `startApplication path='${rawPath}' resolved='${resolvedPath}' params='${processArgs}' parentPid=${parent.pid >>> 0}`
    );
    const fileProvider = parent.emulator.fileProvider;
    if (typeof fileProvider !== "function") {
      this.logForProcess(parent, `startApplication failed for '${resolvedPath}': no file provider`);
      return { errorCode: 5, pid: 0 };
    }
    const bytes = fileProvider(resolvedPath);
    if (!bytes || !bytes.byteLength) {
      this.logForProcess(parent, `startApplication failed for '${resolvedPath}': file not found`);
      return { errorCode: 5, pid: 0 };
    }
    let image;
    try {
      const { parseKex } = loadKosRuntime();
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      image = parseKex(buffer, path.basename(resolvedPath));
    } catch (err) {
      if (isShellScriptBytes(bytes)) {
        if (!hasParentContext) {
          this.logForProcess(parent, `startApplication shell redirect '${resolvedPath}' -> /sys/SHELL`);
          return this.startApplication({
            path: "/sys/SHELL",
            params: resolvedPath
          });
        }
        this.logForProcess(parent, `startApplication shell script rejected for '${resolvedPath}' in child context`);
        return { errorCode: 31, pid: 0 };
      }
      this.logForProcess(parent, `startApplication parse failed for '${resolvedPath}': ${err instanceof Error ? err.message : String(err)}`);
      return { errorCode: 31, pid: 0 };
    }
    const child = this.createProcess({
      image,
      fileName: path.basename(resolvedPath),
      targetPath: parent.targetPath,
      processPath: resolvedPath,
      displayPath: resolvedPath,
      processArgs,
      pid: this.nextPid++,
      slot: this.nextSlot++,
      initialX: (parent.actualX + 24) | 0,
      initialY: (parent.actualY + 24) | 0
    });
    return {
      errorCode: 0,
      pid: child.pid >>> 0
    };
  }

  createThread(request) {
    const parentSlot = request && request.parentThreadSlot ? (request.parentThreadSlot >>> 0) : 0;
    const parentPid = request && request.parentPid ? (request.parentPid >>> 0) : 0;
    const parent = this.processBySlot.get(parentSlot) || this.processByPid.get(parentPid) || null;
    if (!parent || parent.removed || !request || !request.sharedState || !(request.sharedState.sharedMem instanceof Uint8Array)) {
      return { tid: 0xffffffff >>> 0 };
    }
    const child = this.createProcess({
      image: request.image || parent.image,
      fileName: parent.fileName,
      targetPath: parent.targetPath,
      processPath: request.processPath || parent.processPath,
      displayPath: parent.displayPath,
      processArgs: request.processArgs || parent.processArgs,
      pid: this.nextPid++,
      slot: this.nextSlot++,
      groupLeaderPid: parent.groupLeaderPid >>> 0,
      threadGroupId: parent.threadGroupId >>> 0,
      initialX: (parent.actualX + 18) | 0,
      initialY: (parent.actualY + 18) | 0,
      threadLaunchSpec: {
        ...request.sharedState,
        entry: request.entry >>> 0,
        stack: request.stack >>> 0
      }
    });
    return {
      tid: child.pid >>> 0,
      slot: child.slot >>> 0
    };
  }

  saveScreenshot(filePath, options) {
    const opts = options || {};
    const useDesktop = !!opts.desktop;
    const process = useDesktop ? null : this.getActiveProcess();
    if (!useDesktop && (!process || !process.surface)) {
      throw new Error("Cannot save screenshot before launch.");
    }
    const sourceSurface = useDesktop ? this.composeDesktopSurface() : process.surface;
    const snapshot = useDesktop ? this.captureDesktopSnapshot() : this.captureSnapshot();
    const width = Math.max(
      1,
      opts.width | 0 ||
      (useDesktop
        ? (sourceSurface.width | 0)
        : (snapshot.window && snapshot.window.defined ? (snapshot.window.width | 0) : (process.surface.width | 0)))
    );
    const height = Math.max(
      1,
      opts.height | 0 ||
      (useDesktop
        ? (sourceSurface.height | 0)
        : (snapshot.window && snapshot.window.defined ? (snapshot.window.height | 0) : (process.surface.height | 0)))
    );
    try {
      return writeSurfacePng(sourceSurface, filePath, { width, height });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Screenshot validation failed for ${width}x${height} from surface ${sourceSurface.width | 0}x${sourceSurface.height | 0}: ${reason}`
      );
    }
  }
}

async function runScenarioFile(targetPath, scenarioPath, options) {
  const harness = new HeadlessUiHarness(options);
  try {
    await harness.launch(targetPath);
    const scenario = loadScenarioFile(scenarioPath);
    return await harness.runScenario(scenario);
  } finally {
    harness.close();
  }
}

async function main() {
  const target = process.argv[2];
  const scenarioFile = process.argv[3];
  const timeoutArg = process.argv[4];
  if (!target || !scenarioFile) {
    console.error("Usage: node tools/ui-harness.js <file.kex> <scenario.json> [timeout_ms]");
    process.exit(1);
  }

  const targetPath = path.resolve(target);
  const scenarioPath = path.resolve(scenarioFile);
  if (!fs.existsSync(targetPath)) {
    console.error(`Target not found: ${targetPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(scenarioPath)) {
    console.error(`Scenario not found: ${scenarioPath}`);
    process.exit(1);
  }

  const scenario = loadScenarioFile(scenarioPath);
  if (timeoutArg !== undefined) {
    const override = Number(timeoutArg);
    if (Number.isFinite(override) && override > 0) {
      scenario.timeoutMs = override | 0;
    }
  }

  const harness = new HeadlessUiHarness({
    echoLogs: process.env.KOS_TRACE_HARNESS === "1"
  });

  try {
    await harness.launch(targetPath);
    const snapshot = await harness.runScenario(scenario);
    console.log(JSON.stringify(snapshot, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error(JSON.stringify(harness.captureSnapshot({ includeSurfaceHash: true, includeLogs: true }), null, 2));
    process.exit(2);
  } finally {
    harness.close();
  }
}

module.exports = {
  HeadlessUiHarness,
  buildExternalAppProcessPath,
  createDefaultFileProviders,
  createDefaultFileProvider,
  createDefaultFileInfoProvider,
  createDefaultFileMutationProvider,
  loadKosRuntime,
  readTargetImage,
  loadScenarioFile,
  runScenarioFile
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack || err.message : String(err));
    process.exit(1);
  });
}

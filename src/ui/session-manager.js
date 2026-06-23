(() => {
  const KosEmu = globalThis.KosEmu;
  const { Emulator } = KosEmu.emu;
  const { parseKex } = KosEmu.core.loader;
  const { createSurface } = KosEmu.gfx.surface;
  const { getDefaultSkin } = KosEmu.gfx.kolibriSkin;
  const { getTextInfoFromString, measureKolibriText, drawKolibriText } = KosEmu.gfx.kolibriText;
  const keyboard = KosEmu.ui.keyboard || {};
  const sessionShared = KosEmu.ui && KosEmu.ui.sessionShared;

  const DEFAULT_SURFACE_WIDTH = 800;
  const DEFAULT_SURFACE_HEIGHT = 600;
  const DEFAULT_TITLEBAR_HEIGHT = 21;
  const DEFAULT_ROLLUP_EXTRA = 3;
  const TOUCH_SWIPE_MIN_DISTANCE = 42;
  const TOUCH_SWIPE_AXIS_RATIO = 1.35;
  const TOUCH_SWIPE_MAX_DURATION_MS = 450;
  const TOUCH_LONG_PRESS_DELAY_MS = 520;
  const TOUCH_LONG_PRESS_RELEASE_DELAY_MS = 18;
  const TOUCH_LONG_PRESS_MOVE_TOLERANCE = 24;
  const CASCADE_STEP_X = 28;
  const CASCADE_STEP_Y = 24;
  const WINDOW_RESIZE_BORDER = 6;
  const MIN_WINDOW_WIDTH = 48;
  const MIN_WINDOW_HEIGHT = DEFAULT_TITLEBAR_HEIGHT + 8;
  const MAX_WINDOW_WIDTH = 4096;
  const MAX_WINDOW_HEIGHT = 4096;
  const DEFAULT_CPU_FREQ_HZ = 2400000000;
  const DEFAULT_SYSTEM_RAM_BYTES = 512 * 1024 * 1024;
  const DEFAULT_SYSTEM_RESERVED_RAM_BYTES = 16 * 1024 * 1024;
  const DEFAULT_SYSTEM_SKIN_PATH = "/sys/default.skn";
  const DEFAULT_SYSTEM_BUTTON_STYLE = 1;
  const SYSTEM_STYLE_INI_PATH = "/sys/settings/system.ini";
  const WINDOW_STATE_MAXIMIZED = 0x01;
  const WINDOW_STATE_USED = 0x80;
  const WINDOW_STATE_MINIMIZED = 0x02;
  const WINDOW_STATE_ROLLEDUP = 0x04;
  const SYSTEM_BUTTON_CLOSE = 0x000001;
  const DEFAULT_DESKTOP_COLOR = 0xaab799;
  const DEFAULT_DESKTOP_GRID_COLOR = 0x9aab83;
  const WINDOW_Z_DESKTOP = -2;
  const WINDOW_Z_ALWAYS_BACK = -1;
  const WINDOW_Z_NORMAL = 0;
  const WINDOW_Z_ALWAYS_TOP = 1;
  const SPEAKER_AUDIO_LATENCY = 0.01;
  const SPEAKER_SEGMENT_ATTACK_SEC = 0.003;
  const SPEAKER_SEGMENT_RELEASE_SEC = 0.006;
  const SPEAKER_MASTER_GAIN = 0.05;

  function getAudioContextCtor() {
    if (typeof AudioContext === "function") {
      return AudioContext;
    }
    if (typeof webkitAudioContext === "function") {
      return webkitAudioContext;
    }
    return null;
  }

  function packCanvasColor(color, alpha) {
    const a = alpha === undefined ? 255 : (alpha & 0xff);
    const r = (color >>> 16) & 0xff;
    const g = (color >>> 8) & 0xff;
    const b = color & 0xff;
    return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }

  function unpackCanvasColor(value) {
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
    return unpackCanvasColor(surface.buffer32[(y * (surface.width | 0)) + x] >>> 0);
  }

  function getWindowZBase(position) {
    return (sessionShared.getWindowZRank(position) * 100000) | 0;
  }

  function cloneBytes(data) {
    if (!(data instanceof Uint8Array)) {
      return null;
    }
    return data.slice();
  }

  function getIniHelpers() {
    const emu = KosEmu && KosEmu.emu ? KosEmu.emu : null;
    return emu && emu.hostLibHelpers ? emu.hostLibHelpers : null;
  }

  function createOverlaySurface(canvas, width, height) {
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) {
      throw new Error("2D context unavailable for workspace chrome.");
    }
    const surface = {
      canvas,
      ctx,
      width: 1,
      height: 1,
      imageData: ctx.createImageData(1, 1),
      buffer32: new Uint32Array(1),
      resize(nextWidth, nextHeight) {
        const w = Math.max(1, nextWidth | 0);
        const h = Math.max(1, nextHeight | 0);
        if (w === this.width && h === this.height) {
          return;
        }
        let nextImageData;
        try {
          nextImageData = this.ctx.createImageData(w, h);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          throw new RangeError(`Overlay surface allocation failed for ${w}x${h}: ${reason}`);
        }
        this.canvas.width = w;
        this.canvas.height = h;
        this.width = w;
        this.height = h;
        this.imageData = nextImageData;
        this.buffer32 = new Uint32Array(this.imageData.data.buffer);
      },
      clear() {
        this.buffer32.fill(0);
      },
      setPixel(x, y, color, alphaValue) {
        const px = x | 0;
        const py = y | 0;
        if (px < 0 || py < 0 || px >= this.width || py >= this.height) {
          return;
        }
        this.buffer32[py * this.width + px] = packCanvasColor(color, alphaValue);
      },
      present() {
        this.ctx.putImageData(this.imageData, 0, 0);
      }
    };
    surface.resize(width, height);
    return surface;
  }

  function fillSurfaceRect(surface, x, y, width, height, color, alpha) {
    const x0 = Math.max(0, x | 0);
    const y0 = Math.max(0, y | 0);
    const x1 = Math.min(surface.width, (x + width) | 0);
    const y1 = Math.min(surface.height, (y + height) | 0);
    if (x1 <= x0 || y1 <= y0) {
      return;
    }
    const packed = packCanvasColor(color, alpha);
    for (let yy = y0; yy < y1; yy += 1) {
      const row = yy * surface.width;
      for (let xx = x0; xx < x1; xx += 1) {
        surface.buffer32[row + xx] = packed;
      }
    }
  }

  function drawSurfaceBitmap(surface, bitmap, x, y, limitWidth) {
    if (!bitmap) {
      return;
    }
    const drawWidth = limitWidth > 0 ? Math.min(bitmap.width, limitWidth) : bitmap.width;
    for (let yy = 0; yy < bitmap.height; yy += 1) {
      const row = yy * bitmap.width;
      for (let xx = 0; xx < drawWidth; xx += 1) {
        surface.setPixel((x + xx) | 0, (y + yy) | 0, bitmap.pixels[row + xx] >>> 0, 255);
      }
    }
  }

  function drawSurfaceBitmapTiled(surface, bitmap, x, y, width) {
    if (!bitmap || width <= 0) {
      return;
    }
    for (let offset = 0; offset < width; offset += bitmap.width) {
      drawSurfaceBitmap(surface, bitmap, x + offset, y, width - offset);
    }
  }

  function invertSurfaceRectOutline(surface, x, y, width, height) {
    const x0 = Math.max(0, x | 0);
    const y0 = Math.max(0, y | 0);
    const x1 = Math.min(surface.width, (x + width) | 0);
    const y1 = Math.min(surface.height, (y + height) | 0);
    if (x1 <= x0 || y1 <= y0) {
      return;
    }
    const invertAt = (px, py) => {
      const index = py * surface.width + px;
      const packed = surface.buffer32[index] >>> 0;
      const alpha = (packed >>> 24) & 0xff;
      if (!alpha) {
        surface.buffer32[index] = packCanvasColor(0xffffff, 220);
        return;
      }
      const r = packed & 0xff;
      const g = (packed >>> 8) & 0xff;
      const b = (packed >>> 16) & 0xff;
      surface.buffer32[index] = packCanvasColor(((255 - r) << 16) | ((255 - g) << 8) | (255 - b), alpha);
    };
    for (let xx = x0; xx < x1; xx += 1) {
      invertAt(xx, y0);
      if (y1 - 1 !== y0) {
        invertAt(xx, y1 - 1);
      }
    }
    for (let yy = y0 + 1; yy < y1 - 1; yy += 1) {
      invertAt(x0, yy);
      if (x1 - 1 !== x0) {
        invertAt(x1 - 1, yy);
      }
    }
  }

  function drawGlyphStroke(surface, x0, y0, lines, color) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const x1 = x0 + line[0];
      const y1 = y0 + line[1];
      const x2 = x0 + line[2];
      const y2 = y0 + line[3];
      const dx = Math.sign(x2 - x1);
      const dy = Math.sign(y2 - y1);
      let x = x1;
      let y = y1;
      while (true) {
        surface.setPixel(x, y, color, 255);
        if (x === x2 && y === y2) {
          break;
        }
        x += dx;
        y += dy;
      }
    }
  }

  function sanitizeKosPath(path) {
    if (!path || typeof path !== "string") {
      return "";
    }
    let text = path.replace(/\\/g, "/").trim();
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
  }

  function normalizeKosPath(path, baseFolder) {
    const raw = sanitizeKosPath(path);
    if (!raw) {
      return sanitizeKosPath(baseFolder || "/sys") || "/sys";
    }
    const absolute = raw.startsWith("/");
    const base = absolute ? raw : `${sanitizeKosPath(baseFolder || "/sys") || "/sys"}/${raw}`;
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
  }

  function basenameKosPath(path) {
    const normalized = sanitizeKosPath(path);
    if (!normalized) {
      return "image.kex";
    }
    const parts = normalized.split("/");
    return parts[parts.length - 1] || "image.kex";
  }

  function sliceArrayBuffer(source) {
    if (source instanceof ArrayBuffer) {
      return source.slice(0);
    }
    if (source instanceof Uint8Array) {
      return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    }
    if (ArrayBuffer.isView(source)) {
      return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    }
    return new ArrayBuffer(0);
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

  function pointInRect(x, y, rect) {
    return !!rect &&
      x >= (rect.x | 0) &&
      y >= (rect.y | 0) &&
      x < ((rect.x + rect.width) | 0) &&
      y < ((rect.y + rect.height) | 0);
  }

  function getResizeCursor(edge) {
    switch (edge) {
      case "e":
        return "ew-resize";
      case "s":
        return "ns-resize";
      case "se":
        return "nwse-resize";
      default:
        return "default";
    }
  }

  function getDomButtonMask(button) {
    switch (button | 0) {
      case 0: return 0x01;
      case 1: return 0x04;
      case 2: return 0x02;
      case 3: return 0x08;
      case 4: return 0x10;
      default: return 0;
    }
  }

  function getDomButtonsMask(buttons) {
    return (buttons | 0) & 0x1f;
  }

  function findTouchInList(touchList, identifier) {
    if (!touchList || identifier === null || identifier === undefined) {
      return null;
    }
    const targetId = identifier | 0;
    for (let i = 0; i < touchList.length; i += 1) {
      const touch = touchList[i];
      if (touch && (touch.identifier | 0) === targetId) {
        return touch;
      }
    }
    return null;
  }

  function getRelevantTouch(event, identifier) {
    if (!event) {
      return null;
    }
    if (identifier !== null && identifier !== undefined) {
      return (
        findTouchInList(event.changedTouches, identifier) ||
        findTouchInList(event.touches, identifier) ||
        findTouchInList(event.targetTouches, identifier) ||
        null
      );
    }
    if (event.changedTouches && event.changedTouches.length) {
      return event.changedTouches[0];
    }
    if (event.touches && event.touches.length) {
      return event.touches[0];
    }
    if (event.targetTouches && event.targetTouches.length) {
      return event.targetTouches[0];
    }
    return null;
  }

  function createSyntheticPointerEvent(sourceEvent, touch, buttons, button) {
    const source = sourceEvent || null;
    return {
      clientX: touch ? (touch.clientX | 0) : 0,
      clientY: touch ? (touch.clientY | 0) : 0,
      button: button === undefined ? 0 : (button | 0),
      buttons: buttons === undefined ? 0 : (buttons | 0),
      preventDefault() {
        if (source && typeof source.preventDefault === "function") {
          source.preventDefault();
        }
      }
    };
  }

  function resolveSwipeDirection(dx, dy, durationMs, allowLongHold) {
    const elapsed = Math.max(0, durationMs | 0);
    const absX = Math.abs(dx | 0);
    const absY = Math.abs(dy | 0);
    if (!allowLongHold && elapsed > TOUCH_SWIPE_MAX_DURATION_MS) {
      return "";
    }
    if (absX < TOUCH_SWIPE_MIN_DISTANCE && absY < TOUCH_SWIPE_MIN_DISTANCE) {
      return "";
    }
    if (absX >= TOUCH_SWIPE_MIN_DISTANCE && absX >= (absY * TOUCH_SWIPE_AXIS_RATIO)) {
      return dx < 0 ? "ArrowLeft" : "ArrowRight";
    }
    if (absY >= TOUCH_SWIPE_MIN_DISTANCE && absY >= (absX * TOUCH_SWIPE_AXIS_RATIO)) {
      return dy < 0 ? "ArrowUp" : "ArrowDown";
    }
    return "";
  }

  function didTouchMoveBeyondTolerance(startX, startY, currentX, currentY, tolerance) {
    const dx = (currentX - startX) | 0;
    const dy = (currentY - startY) | 0;
    const limit = Math.max(0, tolerance | 0);
    return ((dx * dx) + (dy * dy)) > (limit * limit);
  }

  function getSkinButtonRect(button, windowWidth) {
    if (!button || (button.width | 0) <= 0 || (button.height | 0) <= 0) {
      return null;
    }
    let x = button.left | 0;
    if (x < 0) {
      x = ((windowWidth | 0) + 1 + x) | 0;
    }
    return {
      x,
      y: button.top | 0,
      width: button.width | 0,
      height: button.height | 0
    };
  }

  function drawTitleTextToSurface(surface, skin, title, windowWidth) {
    const text = String(title || "");
    if (!text || !skin) {
      return;
    }
    const colorBytes = skin.colorTableBytes || new Uint8Array(0);
    const view = colorBytes.length >= 20
      ? new DataView(colorBytes.buffer, colorBytes.byteOffset, colorBytes.byteLength)
      : null;
    const color = view ? (view.getUint32(16, true) & 0x00ffffff) : 0xffffff;
    const marginLeft = skin.margins ? (skin.margins.left | 0) : 4;
    const marginRight = skin.margins ? (skin.margins.right | 0) : 4;
    const availableWidth = Math.max(0, (windowWidth | 0) - marginLeft - marginRight);
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
    const marginTop = skin.margins ? (skin.margins.top | 0) : 3;
    const marginBottom = skin.margins ? (skin.margins.bottom | 0) : 3;
    const availableHeight = Math.max(1, (skin.height | 0) - marginTop - marginBottom);
    const y = marginTop + Math.max(0, Math.floor((availableHeight - metrics.height) / 2));
    drawKolibriText(surface, marginLeft, y, color, textInfo, 1);
  }

  function renderSkinChrome(surface, emulator, title, width, height, active, pressedButton) {
    const skin = emulator && emulator.skin ? emulator.skin : getDefaultSkin();
    if (!skin) {
      return false;
    }
    const palette = active === false ? (skin.inactive || skin.active) : (skin.active || skin.inactive);
    const bitmaps = active === false ? skin.bitmaps.inactive : skin.bitmaps.active;
    const outer = palette && palette.outer !== undefined ? (palette.outer >>> 0) : 0x404040;
    const frame = palette && palette.frame !== undefined ? (palette.frame >>> 0) : 0x808080;
    const inner = palette && palette.inner !== undefined ? (palette.inner >>> 0) : 0xffffff;
    fillSurfaceRect(surface, 0, 0, width, 1, outer, 255);
    fillSurfaceRect(surface, 0, 0, 1, height, outer, 255);
    fillSurfaceRect(surface, width - 1, 0, 1, height, outer, 255);
    fillSurfaceRect(surface, 0, height - 1, width, 1, outer, 255);
    for (let inset = 1; inset <= 3; inset += 1) {
      const w0 = width - inset * 2;
      const h0 = height - inset * 2;
      if (w0 <= 0 || h0 <= 0) {
        break;
      }
      fillSurfaceRect(surface, inset, inset, w0, 1, frame, 255);
      fillSurfaceRect(surface, inset, inset, 1, h0, frame, 255);
      fillSurfaceRect(surface, inset + w0 - 1, inset, 1, h0, frame, 255);
      fillSurfaceRect(surface, inset, inset + h0 - 1, w0, 1, frame, 255);
    }
    if (height > (skin.height | 0) + 4 && width > 8) {
      const clientX = 4;
      const clientY = skin.height | 0;
      const clientW = width - 8;
      const clientH = height - (skin.height | 0) - 4;
      fillSurfaceRect(surface, clientX, clientY, clientW, 1, inner, 255);
      fillSurfaceRect(surface, clientX, clientY, 1, clientH, inner, 255);
      fillSurfaceRect(surface, clientX + clientW - 1, clientY, 1, clientH, inner, 255);
      fillSurfaceRect(surface, clientX, clientY + clientH - 1, clientW, 1, inner, 255);
    }
    const leftWidth = bitmaps && bitmaps.left ? (bitmaps.left.width | 0) : 0;
    const operWidth = bitmaps && bitmaps.oper ? (bitmaps.oper.width | 0) : 0;
    if (bitmaps && bitmaps.left) {
      drawSurfaceBitmap(surface, bitmaps.left, 0, 0, width);
    }
    const middleWidth = Math.max(0, width - leftWidth - operWidth);
    if (bitmaps && bitmaps.base && middleWidth > 0) {
      drawSurfaceBitmapTiled(surface, bitmaps.base, leftWidth, 0, middleWidth);
    }
    if (bitmaps && bitmaps.oper) {
      drawSurfaceBitmap(surface, bitmaps.oper, Math.max(0, width - operWidth), 0, width);
    }
    drawTitleTextToSurface(surface, skin, title, width);
    if (pressedButton) {
      const button = pressedButton === "close"
        ? getSkinButtonRect(skin.buttons && skin.buttons.close, width)
        : getSkinButtonRect(skin.buttons && skin.buttons.minimize, width);
      if (button) {
        invertSurfaceRectOutline(surface, button.x, button.y, button.width, button.height);
      }
    }
    return true;
  }

  function drawFallbackButton(surface, rect, kind, active, pressed) {
    if (!rect) {
      return;
    }
    const fill = active ? 0xe6dcc9 : 0xd9d2c8;
    const border = active ? 0x6f5a46 : 0x756b62;
    const ink = active ? 0x372d26 : 0x4b433d;
    fillSurfaceRect(surface, rect.x, rect.y, rect.width, rect.height, border, 255);
    fillSurfaceRect(surface, rect.x + 1, rect.y + 1, Math.max(0, rect.width - 2), Math.max(0, rect.height - 2), fill, 255);
    if (pressed) {
      invertSurfaceRectOutline(surface, rect.x + 1, rect.y + 1, Math.max(1, rect.width - 2), Math.max(1, rect.height - 2));
    }
    if (kind === "close") {
      drawGlyphStroke(surface, rect.x + 5, rect.y + 4, [[0, 0, 6, 6], [6, 0, 0, 6]], ink);
      return;
    }
    drawGlyphStroke(surface, rect.x + 4, rect.y + 8, [[0, 0, 7, 0]], ink);
  }

  function renderFallbackChrome(surface, title, width, height, active, pressedButton) {
    const outer = active ? 0x7b634f : 0x85766b;
    const frame = active ? 0xe3b685 : 0xd4c3b0;
    const fill = active ? 0xd28b53 : 0xbfa58f;
    fillSurfaceRect(surface, 0, 0, width, height, outer, 255);
    fillSurfaceRect(surface, 1, 1, Math.max(0, width - 2), Math.max(0, height - 2), 0xf7f1e7, 255);
    fillSurfaceRect(surface, 1, 1, Math.max(0, width - 2), DEFAULT_TITLEBAR_HEIGHT - 1, fill, 255);
    fillSurfaceRect(surface, 1, DEFAULT_TITLEBAR_HEIGHT, Math.max(0, width - 2), 1, frame, 255);
    const closeRect = { x: Math.max(2, width - 20), y: 2, width: 16, height: 16 };
    const minimizeRect = { x: Math.max(2, closeRect.x - 18), y: 2, width: 16, height: 16 };
    drawFallbackButton(surface, minimizeRect, "minimize", active, pressedButton === "minimize");
    drawFallbackButton(surface, closeRect, "close", active, pressedButton === "close");
    if (title) {
      const textInfo = getTextInfoFromString(title, 0);
      const metrics = measureKolibriText(textInfo, 1);
      const y = 1 + Math.max(0, Math.floor((DEFAULT_TITLEBAR_HEIGHT - metrics.height) / 2));
      drawKolibriText(surface, 6, y, 0xffffff, textInfo, 1);
    }
  }

  class SessionProcess {
    constructor(manager, launch) {
      this.manager = manager;
      this.app = manager.app;
      this.image = launch.image;
      this.buffer = launch.buffer || null;
      this.fileName = launch.fileName || (this.image && this.image.fileName) || "image.kex";
      this.processPath = launch.processPath || this.fileName;
      this.processArgs = launch.processArgs || "";
      this.displayPath = launch.displayPath || this.processPath || this.fileName;
      this.pid = launch.pid >>> 0;
      this.slot = launch.slot >>> 0;
      this.groupLeaderPid = launch.groupLeaderPid ? (launch.groupLeaderPid >>> 0) : (this.pid >>> 0);
      this.threadGroupId = launch.threadGroupId ? (launch.threadGroupId >>> 0) : (this.groupLeaderPid >>> 0);
      this.threadLaunchSpec = launch.threadLaunchSpec || null;
      this.name = basenameKosPath(this.displayPath).slice(0, 12);
      this.rootEl = null;
      this.shellEl = null;
      this.canvasEl = null;
      this.chromeEl = null;
      this.surface = null;
      this.chromeSurface = null;
      this.emulator = null;
      this.active = false;
      this.stopped = false;
      this.stopReason = "";
      this.removeOnStopReason = "";
      this.removed = false;
      this.rolledUp = false;
      this.minimized = false;
      this.maximized = false;
      this.maximizeRestoreGeometry = null;
      this.windowWidth = DEFAULT_SURFACE_WIDTH;
      this.windowHeight = DEFAULT_SURFACE_HEIGHT;
      this.actualX = launch.initialX | 0;
      this.actualY = launch.initialY | 0;
      this.requestedX = 0;
      this.requestedY = 0;
      this.geometryKnown = false;
      this.userOffsetX = 0;
      this.userOffsetY = 0;
      this.userMoved = false;
      this.zOrder = 0;
      this.captureMode = "";
      this.captureButtonMask = 0;
      this.dragOriginX = 0;
      this.dragOriginY = 0;
      this.dragMouseX = 0;
      this.dragMouseY = 0;
      this.resizeEdge = "";
      this.resizeOriginWidth = 0;
      this.resizeOriginHeight = 0;
      this.resizeMouseX = 0;
      this.resizeMouseY = 0;
      this.pressedSystemButton = "";
      this.pressedSystemHot = false;
      this.chromeRenderQueued = false;
      this.lastChromeKey = "";
      this.lastChromeSkin = null;
      this.windowShape = null;
      this.windowShapeUrl = "";
      this.displayReady = false;
      this.controlKeyMask = 0;
      this.windowPositionMode = WINDOW_Z_NORMAL;
      this.activeTouchId = null;
      this.touchSwipeStartX = 0;
      this.touchSwipeStartY = 0;
      this.touchSwipeLastX = 0;
      this.touchSwipeLastY = 0;
      this.touchSwipeStartMs = 0;
      this.touchSwipeEligible = false;
      this.touchSwipeHeldKey = "";
      this.touchSwipeMouseSuppressed = false;
      this.touchPrimaryMouseActive = false;
      this.touchSecondaryMouseActive = false;
      this.touchLongPressTimer = 0;
      this.touchLongPressReleaseTimer = 0;
      this.touchLongPressTriggered = false;
      this.touchLongPressEligible = false;
      this.touchPrimaryStartClientX = 0;
      this.touchPrimaryStartClientY = 0;
      this.touchDeferredCapture = false;
      this.boundDocMouseMove = (event) => this.handleDocumentMouseMove(event);
      this.boundDocMouseUp = (event) => this.handleDocumentMouseUp(event);
      this.boundDocTouchMove = (event) => this.handleDocumentTouchMove(event);
      this.boundDocTouchEnd = (event) => this.handleDocumentTouchEnd(event);
      this.boundDocTouchCancel = (event) => this.handleDocumentTouchCancel(event);
      this.boundDocBlur = () => this.cancelCapture();
    }

    mount() {
      this.rootEl = document.createElement("div");
      this.rootEl.className = "workspace-window";
      this.rootEl.classList.add("workspace-window-pending");
      this.rootEl.dataset.pid = String(this.pid >>> 0);
      this.rootEl.dataset.slot = String(this.slot >>> 0);
      this.rootEl.style.left = `${this.actualX}px`;
      this.rootEl.style.top = `${this.actualY}px`;
      this.rootEl.style.width = `${this.windowWidth}px`;
      this.rootEl.style.height = `${this.windowHeight}px`;

      this.shellEl = document.createElement("div");
      this.shellEl.className = "workspace-window-shell";
      this.shellEl.tabIndex = 0;
      this.shellEl.style.width = `${this.windowWidth}px`;
      this.shellEl.style.height = `${this.windowHeight}px`;

      this.canvasEl = document.createElement("canvas");
      this.canvasEl.className = "workspace-window-canvas";

      this.chromeEl = document.createElement("canvas");
      this.chromeEl.className = "workspace-window-chrome";
      this.chromeEl.setAttribute("aria-hidden", "true");

      this.shellEl.appendChild(this.canvasEl);
      this.shellEl.appendChild(this.chromeEl);
      this.rootEl.appendChild(this.shellEl);
      this.manager.desktopEl.appendChild(this.rootEl);
      this.installDomListeners();
      this.surface = createSurface(this.canvasEl, this.windowWidth, this.windowHeight, (msg) => this.log(msg));
      this.chromeSurface = createOverlaySurface(this.chromeEl, this.windowWidth, this.windowHeight);
      this.attachEmulator();
      this.manager.syncDesktopSize();
    }

    installDomListeners() {
      this.shellEl.addEventListener("focus", () => {
        if (!this.removed) {
          this.manager.setActiveProcess(this, { focusShell: false });
        }
      });
      this.shellEl.addEventListener("mousedown", (event) => this.handleMouseDown(event));
      this.shellEl.addEventListener("mousemove", (event) => this.handleMouseMove(event));
      this.shellEl.addEventListener("mouseup", (event) => this.handleMouseUp(event));
      this.shellEl.addEventListener("mouseleave", (event) => this.handleMouseLeave(event));
      this.shellEl.addEventListener("touchstart", (event) => this.handleTouchStart(event), { passive: false });
      this.shellEl.addEventListener("wheel", (event) => this.handleWheel(event), { passive: false });
      this.shellEl.addEventListener("contextmenu", (event) => event.preventDefault());
      this.shellEl.addEventListener("dblclick", (event) => this.handleDoubleClick(event));
      this.shellEl.addEventListener("keydown", (event) => this.handleKeyDown(event));
      this.shellEl.addEventListener("keyup", (event) => this.handleKeyUp(event));
    }

    attachEmulator() {
      const emulator = new Emulator(this.surface, (msg) => this.log(msg), {
        cpuBackend: this.manager.getCpuBackendMode()
      });
      this.emulator = emulator;
      emulator.autoFitWindow = true;
      emulator.threadSlot = this.slot >>> 0;
      emulator.processId = this.pid >>> 0;
      emulator.hostSession = this.manager;
      emulator.sharedNamedMemoryStore = this.manager.sharedNamedMemoryStore;
      emulator.processPathOverride = this.processPath;
      emulator.processArgs = this.processArgs;
      emulator.threadLaunchSpec = this.threadLaunchSpec;
      emulator.getHostScreenSize = () => this.manager.getReportedScreenSize();
      emulator.getHostPixelOwnerAt = (x, y) => this.manager.getPixelOwnerAt(x | 0, y | 0);
      emulator.getHostPixelColorAt = (x, y) => this.manager.getPixelColorAt(x | 0, y | 0);
      emulator.fileProvider = this.app.getFileProvider();
      emulator.fileProviderAsync = this.app.getFileProviderAsync();
      emulator.fileInfoProvider = this.app.getFileInfoProvider();
      emulator.fileInfoProviderAsync = this.app.getFileInfoProviderAsync();
      emulator.fileMutationProvider = this.app.getFileMutationProvider();
      emulator.fileMutationProviderAsync = this.app.getFileMutationProviderAsync();
      const applyHostWindowGeometry = typeof emulator.applyHostWindowGeometry === "function"
        ? emulator.applyHostWindowGeometry.bind(emulator)
        : null;
      if (applyHostWindowGeometry) {
        emulator.applyHostWindowGeometry = (next, options) => {
          const opts = options || {};
          if (this.maximized && !opts.allowWhenMaximized) {
            if (opts.forceRedraw) {
              this.scheduleChromeRender(true);
            }
            return false;
          }
          return applyHostWindowGeometry(next, opts);
        };
      }
      emulator.onWindowResize = (width, height) => {
        const w = Math.max(1, width | 0);
        const h = Math.max(1, height | 0);
        this.windowWidth = w;
        this.windowHeight = h;
        this.surface.resize(w, h);
        this.chromeSurface.resize(w, h);
        this.rootEl.style.width = `${w}px`;
        this.shellEl.style.width = `${w}px`;
        this.canvasEl.style.width = `${w}px`;
        this.chromeEl.style.width = `${w}px`;
        this.applyVisibleHeight();
        this.scheduleChromeRender(true);
        this.manager.syncDesktopSize();
      };
      emulator.onWindowGeometry = (x, y) => {
        this.requestedX = x | 0;
        this.requestedY = y | 0;
        if (!this.geometryKnown && !this.userMoved) {
          this.userOffsetX = 0;
          this.userOffsetY = 0;
        }
        this.geometryKnown = true;
        this.setWindowPosition((this.requestedX + this.userOffsetX) | 0, (this.requestedY + this.userOffsetY) | 0, false);
        this.applyVisibleHeight();
        this.scheduleChromeRender(true);
      };
      emulator.onWindowShape = (shape) => {
        this.setWindowShape(shape);
      };
      emulator.onStopped = (reason) => this.handleStopped(reason);
      const originalPresent = this.surface.present.bind(this.surface);
      this.surface.present = () => {
        originalPresent();
        if (!this.displayReady && this.emulator && this.emulator.windowDefined && this.geometryKnown) {
          this.revealWindow();
          this.renderChrome();
          return;
        }
        this.scheduleChromeRender();
      };
      this.applyTraceConfig(this.manager.traceConfig);
    }

    applyTraceConfig(config) {
      if (!this.emulator) {
        return;
      }
      const next = config || {};
      this.emulator.traceSyscalls = !!next.traceSyscalls;
      this.emulator.traceImages = !!next.traceImages;
      this.emulator.traceOpcodes = !!next.traceOpcodes;
    }

    refreshSkinTheme(styleState) {
      if (!this.emulator || this.removed) {
        return false;
      }
      const nextStyle = styleState || (this.manager && typeof this.manager.getSystemStyleState === "function"
        ? this.manager.getSystemStyleState()
        : null);
      const applied = this.manager && typeof this.manager.applySystemStyleToEmulator === "function"
        ? this.manager.applySystemStyleToEmulator(this.emulator, nextStyle, { queueRedraw: false, wake: false }) === 0
        : false;
      if (!applied) {
        return false;
      }
      this.lastChromeSkin = null;
      this.lastChromeKey = "";
      if (this.emulator.running) {
        this.emulator.removeQueuedEvent(1);
        this.emulator.queueEvent(1);
        this.emulator.wakeExecution();
      }
      this.scheduleChromeRender(true);
      return true;
    }

    start() {
      this.emulator.load(this.image);
      if (this.manager && typeof this.manager.applySystemStyleToEmulator === "function") {
        this.manager.applySystemStyleToEmulator(this.emulator, null, { queueRedraw: false, wake: false });
      }
      this.emulator.run();
      this.scheduleChromeRender(true);
    }

    log(message) {
      if (this.manager && typeof this.manager.handleProcessLog === "function") {
        this.manager.handleProcessLog(this, message);
        return;
      }
      this.app.log(`${this.displayPath}: ${String(message)}`);
    }

    revealWindow() {
      if (this.displayReady || !this.rootEl) {
        return;
      }
      this.displayReady = true;
      this.applyWindowVisibility();
      this.manager.syncDesktopSize();
      if (this.active && !this.minimized) {
        this.focusShell();
      }
    }

    applyWindowVisibility() {
      if (!this.rootEl) {
        return;
      }
      this.rootEl.classList.toggle("workspace-window-pending", !this.displayReady);
      this.rootEl.classList.toggle("workspace-window-minimized", !!this.minimized);
    }

    getBaseSkin() {
      return this.emulator && this.emulator.skin ? this.emulator.skin : getDefaultSkin();
    }

    setWindowShape(shape) {
      if (shape && shape.data instanceof Uint8Array && (shape.width | 0) > 0 && (shape.height | 0) > 0) {
        this.windowShape = {
          width: shape.width | 0,
          height: shape.height | 0,
          data: shape.data
        };
      } else {
        this.windowShape = null;
      }
      this.applyWindowShapeMask();
    }

    applyWindowShapeMask() {
      if (!this.rootEl || !this.shellEl) {
        return;
      }
      if (!this.windowShape) {
        this.windowShapeUrl = "";
        this.rootEl.classList.remove("workspace-window-shaped");
        this.rootEl.style.maskImage = "";
        this.rootEl.style.WebkitMaskImage = "";
        this.rootEl.style.maskRepeat = "";
        this.rootEl.style.WebkitMaskRepeat = "";
        this.rootEl.style.maskSize = "";
        this.rootEl.style.WebkitMaskSize = "";
        return;
      }
      const shape = this.windowShape;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, shape.width | 0);
      canvas.height = Math.max(1, shape.height | 0);
      const ctx = canvas.getContext("2d", { alpha: true });
      if (!ctx) {
        return;
      }
      const imageData = ctx.createImageData(canvas.width, canvas.height);
      const pixels = imageData.data;
      for (let i = 0; i < shape.data.length; i += 1) {
        const alpha = shape.data[i] ? 255 : 0;
        const base = i * 4;
        pixels[base] = 255;
        pixels[base + 1] = 255;
        pixels[base + 2] = 255;
        pixels[base + 3] = alpha;
      }
      ctx.putImageData(imageData, 0, 0);
      this.windowShapeUrl = canvas.toDataURL("image/png");
      const cssUrl = `url("${this.windowShapeUrl}")`;
      this.rootEl.classList.add("workspace-window-shaped");
      this.rootEl.style.maskImage = cssUrl;
      this.rootEl.style.WebkitMaskImage = cssUrl;
      this.rootEl.style.maskRepeat = "no-repeat";
      this.rootEl.style.WebkitMaskRepeat = "no-repeat";
      this.rootEl.style.maskSize = `${canvas.width}px ${canvas.height}px`;
      this.rootEl.style.WebkitMaskSize = `${canvas.width}px ${canvas.height}px`;
    }

    pointInWindowShape(x, y) {
      const shape = this.windowShape;
      if (!shape) {
        return true;
      }
      const px = x | 0;
      const py = y | 0;
      if (px < 0 || py < 0 || px >= (shape.width | 0) || py >= (shape.height | 0)) {
        return false;
      }
      return !!shape.data[py * (shape.width | 0) + px];
    }

    isSkinnedWindow() {
      if (!this.emulator || !this.emulator.windowDefined) {
        return false;
      }
      const style = this.emulator.windowStyle & 0xff;
      return style === 3 || style === 4;
    }

    isUserResizable() {
      if (!this.emulator || !this.emulator.windowDefined) {
        return false;
      }
      const style = this.emulator.windowStyle & 0xff;
      return style === 0 || style === 2 || style === 3;
    }

    canUserMaximize() {
      return !!(
        this.emulator &&
        this.emulator.windowDefined &&
        !this.stopped &&
        !this.removed &&
        !this.rolledUp &&
        this.getTitlebarHeight() > 0 &&
        this.isUserResizable()
      );
    }

    usesFallbackCaption() {
      if (!this.emulator || !this.emulator.windowDefined || !this.emulator.windowHasCaption || this.isSkinnedWindow()) {
        return false;
      }
      const style = this.emulator.windowStyle & 0xff;
      return style === 0 || style === 2;
    }

    getTitlebarHeight() {
      if (this.isSkinnedWindow()) {
        const skin = this.getBaseSkin();
        return skin ? Math.max(1, skin.height | 0) : DEFAULT_TITLEBAR_HEIGHT;
      }
      return this.usesFallbackCaption() ? DEFAULT_TITLEBAR_HEIGHT : 0;
    }

    getVisibleHeight() {
      return this.rolledUp ? this.getRollupHeight() : Math.max(1, this.windowHeight | 0);
    }

    getRollupHeight() {
      const titlebar = this.getTitlebarHeight();
      return titlebar > 0 ? (titlebar + DEFAULT_ROLLUP_EXTRA) : DEFAULT_TITLEBAR_HEIGHT;
    }

    getWindowTitle() {
      if (this.emulator && this.emulator.windowTitle) {
        return String(this.emulator.windowTitle);
      }
      return "";
    }

    getSystemButtonRect(kind) {
      if (this.isSkinnedWindow()) {
        const skin = this.getBaseSkin();
        if (!skin) {
          return null;
        }
        if (kind === "close") {
          return getSkinButtonRect(skin.buttons && skin.buttons.close, this.windowWidth);
        }
        if (kind === "minimize") {
          return getSkinButtonRect(skin.buttons && skin.buttons.minimize, this.windowWidth);
        }
        return null;
      }
      if (!this.usesFallbackCaption()) {
        return null;
      }
      const closeRect = { x: Math.max(2, this.windowWidth - 20), y: 2, width: 16, height: 16 };
      if (kind === "close") {
        return closeRect;
      }
      if (kind === "minimize") {
        return { x: Math.max(2, closeRect.x - 18), y: 2, width: 16, height: 16 };
      }
      return null;
    }

    hitTestChrome(x, y) {
      const titlebarHeight = this.getTitlebarHeight();
      if (titlebarHeight <= 0) {
        return "";
      }
      const closeRect = this.getSystemButtonRect("close");
      if (pointInRect(x, y, closeRect)) {
        return "close";
      }
      const minimizeRect = this.getSystemButtonRect("minimize");
      if (pointInRect(x, y, minimizeRect)) {
        return "minimize";
      }
      if (y >= 0 && y < titlebarHeight && x >= 0 && x < this.windowWidth) {
        return "titlebar";
      }
      return "";
    }

    hitTestResize(x, y) {
      if (this.rolledUp || this.maximized || !this.isUserResizable()) {
        return "";
      }
      const border = WINDOW_RESIZE_BORDER | 0;
      const width = this.windowWidth | 0;
      const height = this.getVisibleHeight() | 0;
      if (width <= 0 || height <= 0) {
        return "";
      }
      const onRight = x >= Math.max(0, width - border) && x < width;
      const onBottom = y >= Math.max(0, height - border) && y < height;
      if (onRight && onBottom) {
        return "se";
      }
      if (onRight) {
        return "e";
      }
      if (onBottom) {
        return "s";
      }
      return "";
    }

    scheduleChromeRender(force) {
      if (force) {
        this.lastChromeKey = "";
        this.lastChromeSkin = null;
      }
      if (this.chromeRenderQueued) {
        return;
      }
      this.chromeRenderQueued = true;
      const flush = () => {
        this.chromeRenderQueued = false;
        this.renderChrome();
      };
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(flush);
      } else {
        setTimeout(flush, 0);
      }
    }

    renderChrome() {
      if (!this.chromeSurface || !this.emulator || this.removed) {
        return;
      }
      const mode = this.isSkinnedWindow() ? "skin" : (this.usesFallbackCaption() ? "fallback" : "none");
      const title = this.getWindowTitle();
      const skin = mode === "skin" ? this.getBaseSkin() : null;
      const pressed = this.pressedSystemHot ? this.pressedSystemButton : "";
      const stateKey = [
        mode,
        this.active ? 1 : 0,
        this.stopped ? 1 : 0,
        this.windowWidth | 0,
        this.windowHeight | 0,
        this.rolledUp ? 1 : 0,
        pressed,
        title,
        this.getTitlebarHeight() | 0
      ].join("|");
      if (stateKey === this.lastChromeKey && skin === this.lastChromeSkin) {
        return;
      }
      this.lastChromeKey = stateKey;
      this.lastChromeSkin = skin;
      this.chromeSurface.clear();
      if (mode === "skin") {
        renderSkinChrome(this.chromeSurface, this.emulator, title, this.windowWidth, this.windowHeight, this.active, pressed);
      } else if (mode === "fallback") {
        renderFallbackChrome(this.chromeSurface, title, this.windowWidth, this.windowHeight, this.active, pressed);
      }
      this.chromeSurface.present();
    }

    setWindowPosition(x, y, userAction) {
      let nextX = x | 0;
      let nextY = y | 0;
      if (!userAction && !this.userMoved && this.manager && typeof this.manager.normalizeWindowPosition === "function") {
        const bounded = this.manager.normalizeWindowPosition(
          nextX,
          nextY,
          this.windowWidth | 0,
          this.getVisibleHeight() | 0
        );
        nextX = bounded.x | 0;
        nextY = bounded.y | 0;
      }
      this.actualX = nextX | 0;
      this.actualY = nextY | 0;
      if (!userAction && !this.userMoved) {
        this.userOffsetX = this.actualX - (this.requestedX | 0);
        this.userOffsetY = this.actualY - (this.requestedY | 0);
      }
      if (userAction) {
        this.userMoved = true;
        this.userOffsetX = this.actualX - (this.requestedX | 0);
        this.userOffsetY = this.actualY - (this.requestedY | 0);
      }
      this.rootEl.style.left = `${this.actualX}px`;
      this.rootEl.style.top = `${this.actualY}px`;
      this.manager.syncDesktopSize();
    }

    requestWindowResize(width, height) {
      if (this.maximized || !this.isUserResizable() || !this.emulator || typeof this.emulator.applyHostWindowGeometry !== "function") {
        return;
      }
      const nextWidth = Math.max(MIN_WINDOW_WIDTH, Math.min(MAX_WINDOW_WIDTH, width | 0));
      const nextHeight = Math.max(MIN_WINDOW_HEIGHT, Math.min(MAX_WINDOW_HEIGHT, height | 0));
      this.emulator.applyHostWindowGeometry(
        {
          width: nextWidth,
          height: nextHeight
        },
        { forceRedraw: true }
      );
    }

    getMaximizedGeometry() {
      const workArea = this.manager && typeof this.manager.getScreenWorkArea === "function"
        ? this.manager.getScreenWorkArea()
        : null;
      if (workArea) {
        return {
          x: workArea.left | 0,
          y: workArea.top | 0,
          width: Math.max(1, ((workArea.right | 0) - (workArea.left | 0) + 1) | 0),
          height: Math.max(1, ((workArea.bottom | 0) - (workArea.top | 0) + 1) | 0)
        };
      }
      const size = this.manager && typeof this.manager.getReportedScreenSize === "function"
        ? this.manager.getReportedScreenSize()
        : { width: this.windowWidth | 0, height: this.windowHeight | 0 };
      return {
        x: 0,
        y: 0,
        width: Math.max(1, size.width | 0),
        height: Math.max(1, size.height | 0)
      };
    }

    syncMaximizedGeometry() {
      if (!this.maximized || !this.emulator || typeof this.emulator.applyHostWindowGeometry !== "function") {
        return false;
      }
      return !!this.emulator.applyHostWindowGeometry(
        this.getMaximizedGeometry(),
        { forceRedraw: true, allowWhenMaximized: true }
      );
    }

    toggleMaximize(forceState) {
      if (!this.maximized && !this.canUserMaximize()) {
        return false;
      }
      if (!this.emulator || typeof this.emulator.applyHostWindowGeometry !== "function") {
        return false;
      }
      const next = forceState === undefined ? !this.maximized : !!forceState;
      if (next === this.maximized) {
        return false;
      }

      if (next) {
        this.maximizeRestoreGeometry = {
          x: this.actualX | 0,
          y: this.actualY | 0,
          requestedX: this.requestedX | 0,
          requestedY: this.requestedY | 0,
          width: this.windowWidth | 0,
          height: this.windowHeight | 0,
          userMoved: !!this.userMoved,
          userOffsetX: this.userOffsetX | 0,
          userOffsetY: this.userOffsetY | 0
        };
        this.maximized = true;
        this.userMoved = false;
        this.userOffsetX = 0;
        this.userOffsetY = 0;
        this.emulator.applyHostWindowGeometry(
          this.getMaximizedGeometry(),
          { forceRedraw: true, allowWhenMaximized: true }
        );
        this.scheduleChromeRender(true);
        this.manager.syncDesktopSize();
        return true;
      }

      const restore = this.maximizeRestoreGeometry || {
        x: Math.max(0, this.actualX | 0),
        y: Math.max(0, this.actualY | 0),
        requestedX: this.requestedX | 0,
        requestedY: this.requestedY | 0,
        width: Math.max(1, this.windowWidth | 0),
        height: Math.max(1, this.windowHeight | 0),
        userMoved: !!this.userMoved,
        userOffsetX: this.userOffsetX | 0,
        userOffsetY: this.userOffsetY | 0
      };
      this.maximized = false;
      this.userMoved = false;
      this.userOffsetX = 0;
      this.userOffsetY = 0;
      this.emulator.applyHostWindowGeometry(
        {
          x: restore.x | 0,
          y: restore.y | 0,
          width: Math.max(1, restore.width | 0),
          height: Math.max(1, restore.height | 0)
        },
        { forceRedraw: true, allowWhenMaximized: true }
      );
      this.requestedX = restore.requestedX | 0;
      this.requestedY = restore.requestedY | 0;
      this.userMoved = !!restore.userMoved;
      this.userOffsetX = restore.userOffsetX | 0;
      this.userOffsetY = restore.userOffsetY | 0;
      this.setWindowPosition((this.requestedX + this.userOffsetX) | 0, (this.requestedY + this.userOffsetY) | 0, false);
      this.maximizeRestoreGeometry = null;
      this.scheduleChromeRender(true);
      this.manager.syncDesktopSize();
      return true;
    }

    applyVisibleHeight() {
      const visibleHeight = Math.max(1, this.getVisibleHeight() | 0);
      this.rootEl.style.height = `${visibleHeight}px`;
      this.shellEl.style.height = `${visibleHeight}px`;
      this.canvasEl.style.height = `${this.windowHeight}px`;
      this.chromeEl.style.height = `${this.windowHeight}px`;
      this.rootEl.classList.toggle("workspace-window-rolled-up", !!this.rolledUp);
      this.manager.syncDesktopSize();
    }

    setMinimized(forceState, options) {
      const next = forceState === undefined ? !this.minimized : !!forceState;
      if (next === this.minimized) {
        return false;
      }
      this.cancelCapture();
      this.minimized = next;
      this.pressedSystemButton = "";
      this.pressedSystemHot = false;
      this.applyWindowVisibility();
      this.scheduleChromeRender(true);
      if (!next && this.active) {
        this.focusShell();
      }
      if (!options || options.notify !== false) {
        this.manager.onProcessVisualStateChanged();
      }
      return true;
    }

    toggleRollup(forceState) {
      const next = forceState === undefined ? !this.rolledUp : !!forceState;
      if (next === this.rolledUp) {
        return;
      }
      if (next && this.maximized) {
        this.toggleMaximize(false);
      }
      this.rolledUp = next;
      this.applyVisibleHeight();
      this.scheduleChromeRender(true);
    }

    focusShell() {
      if (this.shellEl && document.activeElement !== this.shellEl) {
        try {
          this.shellEl.focus({ preventScroll: true });
        } catch (err) {
          this.shellEl.focus();
        }
      }
    }

    blurShell() {
      if (this.shellEl && document.activeElement === this.shellEl) {
        this.shellEl.blur();
      }
    }

    getPointerInfo(event) {
      const rect = this.shellEl.getBoundingClientRect();
      const scaleX = rect.width > 0 ? (this.windowWidth / rect.width) : 1;
      const scaleY = rect.height > 0 ? (this.getVisibleHeight() / rect.height) : 1;
      const x = Math.floor((event.clientX - rect.left) * scaleX);
      const y = Math.floor((event.clientY - rect.top) * scaleY);
      const insideRect = event.clientX >= rect.left && event.clientY >= rect.top && event.clientX < rect.right && event.clientY < rect.bottom;
      const inside = insideRect && this.pointInWindowShape(x, y);
      return { x, y, inside };
    }

    forwardMouseEvent(event, pressMask, releaseMask, moved, wheelX, wheelY, insideOverride) {
      if (!this.emulator || this.stopped) {
        return;
      }
      const pointer = this.getPointerInfo(event);
      const screen = this.manager.getWorkspacePointerPosition(event);
      const inside = insideOverride === undefined ? pointer.inside : !!insideOverride;
      this.manager.forwardGlobalMouseEvent(
        screen.x,
        screen.y,
        getDomButtonsMask(event.buttons),
        pressMask | 0,
        releaseMask | 0,
        !!moved,
        wheelX | 0,
        wheelY | 0,
        {
          primaryProcess: this,
          primaryInside: inside
        }
      );
    }

    beginCapture(mode, event, extra) {
      this.captureMode = mode;
      this.captureButtonMask = extra && extra.mask ? (extra.mask & 0x1f) : 0;
      if (mode === "drag") {
        this.dragOriginX = this.actualX;
        this.dragOriginY = this.actualY;
        this.dragMouseX = event.clientX | 0;
        this.dragMouseY = event.clientY | 0;
      } else if (mode === "resize") {
        this.resizeEdge = extra && extra.edge ? String(extra.edge) : "";
        this.resizeOriginWidth = this.windowWidth | 0;
        this.resizeOriginHeight = this.windowHeight | 0;
        this.resizeMouseX = event.clientX | 0;
        this.resizeMouseY = event.clientY | 0;
        this.shellEl.style.cursor = getResizeCursor(this.resizeEdge);
      } else if (mode === "system-button") {
        this.pressedSystemButton = extra && extra.button ? extra.button : "";
        this.pressedSystemHot = true;
      }
      document.addEventListener("mousemove", this.boundDocMouseMove);
      document.addEventListener("mouseup", this.boundDocMouseUp);
      document.addEventListener("touchmove", this.boundDocTouchMove, { passive: false });
      document.addEventListener("touchend", this.boundDocTouchEnd, { passive: false });
      document.addEventListener("touchcancel", this.boundDocTouchCancel, { passive: false });
      window.addEventListener("blur", this.boundDocBlur);
    }

    endCapture() {
      document.removeEventListener("mousemove", this.boundDocMouseMove);
      document.removeEventListener("mouseup", this.boundDocMouseUp);
      document.removeEventListener("touchmove", this.boundDocTouchMove);
      document.removeEventListener("touchend", this.boundDocTouchEnd);
      document.removeEventListener("touchcancel", this.boundDocTouchCancel);
      window.removeEventListener("blur", this.boundDocBlur);
      this.captureMode = "";
      this.captureButtonMask = 0;
      this.resizeEdge = "";
      this.pressedSystemButton = "";
      this.pressedSystemHot = false;
      this.releaseVirtualKey(this.touchSwipeHeldKey);
      this.touchSwipeHeldKey = "";
      this.touchSwipeMouseSuppressed = false;
      this.activeTouchId = null;
      this.resetTouchSwipeTracking();
      if (this.shellEl) {
        this.shellEl.style.cursor = "default";
      }
      this.scheduleChromeRender(true);
    }

    cancelCapture() {
      if (!this.captureMode) {
        return;
      }
      if (this.captureMode === "app" && this.touchSecondaryMouseActive) {
        const releaseEvent = createSyntheticPointerEvent(
          null,
          {
            clientX: this.touchSwipeLastX | 0,
            clientY: this.touchSwipeLastY | 0
          },
          0,
          2
        );
        this.forwardMouseEvent(releaseEvent, 0, 0x02, false, 0, 0, this.getPointerInfo(releaseEvent).inside);
        this.touchSecondaryMouseActive = false;
      }
      if (this.captureMode === "app" && this.touchPrimaryMouseActive && !this.touchSwipeMouseSuppressed) {
        this.manager.forwardGlobalMouseEvent(
          this.emulator.mouseScreenX | 0,
          this.emulator.mouseScreenY | 0,
          0,
          0,
          this.captureButtonMask | 0,
          false,
          0,
          0,
          {
            primaryProcess: this,
            primaryInside: false
          }
        );
      }
      this.endCapture();
    }

    resetTouchSwipeTracking() {
      if (this.touchLongPressTimer) {
        clearTimeout(this.touchLongPressTimer);
        this.touchLongPressTimer = 0;
      }
      if (this.touchLongPressReleaseTimer) {
        clearTimeout(this.touchLongPressReleaseTimer);
        this.touchLongPressReleaseTimer = 0;
      }
      this.touchSwipeStartX = 0;
      this.touchSwipeStartY = 0;
      this.touchSwipeLastX = 0;
      this.touchSwipeLastY = 0;
      this.touchSwipeStartMs = 0;
      this.touchSwipeEligible = false;
      this.touchPrimaryMouseActive = false;
      this.touchSecondaryMouseActive = false;
      this.touchLongPressTriggered = false;
      this.touchLongPressEligible = false;
      this.touchPrimaryStartClientX = 0;
      this.touchPrimaryStartClientY = 0;
      this.touchDeferredCapture = false;
    }

    beginTouchSwipeTracking(event, touch) {
      if (!touch) {
        this.resetTouchSwipeTracking();
        return;
      }
      const pointerEvent = createSyntheticPointerEvent(event, touch, 0x01, 0);
      const pointer = this.getPointerInfo(pointerEvent);
      const client = this.getClientBounds();
      this.touchSwipeStartX = touch.clientX | 0;
      this.touchSwipeStartY = touch.clientY | 0;
      this.touchSwipeLastX = touch.clientX | 0;
      this.touchSwipeLastY = touch.clientY | 0;
      this.touchSwipeStartMs = Date.now();
      this.touchSwipeHeldKey = "";
      this.touchSwipeMouseSuppressed = false;
      this.touchPrimaryMouseActive = false;
      this.touchSecondaryMouseActive = false;
      this.touchLongPressTriggered = false;
      this.touchLongPressEligible = false;
      this.touchPrimaryStartClientX = touch.clientX | 0;
      this.touchPrimaryStartClientY = touch.clientY | 0;
      this.touchDeferredCapture = false;
      this.touchSwipeEligible =
        !this.rolledUp &&
        !this.stopped &&
        !this.hitTestResize(pointer.x, pointer.y) &&
        !this.hitTestChrome(pointer.x, pointer.y) &&
        pointInRect(pointer.x, pointer.y, client);
    }

    updateTouchSwipeTracking(touch) {
      if (!touch) {
        return;
      }
      this.touchSwipeLastX = touch.clientX | 0;
      this.touchSwipeLastY = touch.clientY | 0;
    }

    reanchorTouchSwipe(touch) {
      if (!touch) {
        return;
      }
      this.touchSwipeStartX = touch.clientX | 0;
      this.touchSwipeStartY = touch.clientY | 0;
      this.touchSwipeLastX = touch.clientX | 0;
      this.touchSwipeLastY = touch.clientY | 0;
      this.touchSwipeStartMs = Date.now();
    }

    resolveTouchSwipeDirection(allowLongHold) {
      if (!this.touchSwipeEligible) {
        return "";
      }
      return resolveSwipeDirection(
        (this.touchSwipeLastX - this.touchSwipeStartX) | 0,
        (this.touchSwipeLastY - this.touchSwipeStartY) | 0,
        Date.now() - (this.touchSwipeStartMs || 0),
        !!allowLongHold
      );
    }

    hasTouchLongPressMoved() {
      return didTouchMoveBeyondTolerance(
        this.touchPrimaryStartClientX | 0,
        this.touchPrimaryStartClientY | 0,
        this.touchSwipeLastX | 0,
        this.touchSwipeLastY | 0,
        TOUCH_LONG_PRESS_MOVE_TOLERANCE
      );
    }

    scheduleTouchLongPress(event) {
      if (this.touchLongPressTimer) {
        clearTimeout(this.touchLongPressTimer);
        this.touchLongPressTimer = 0;
      }
      if (!this.touchLongPressEligible || this.captureMode !== "app" || this.activeTouchId === null) {
        return;
      }
      const sourceEvent = event || null;
      const targetTouchId = this.activeTouchId | 0;
      this.touchLongPressTimer = setTimeout(() => {
        this.touchLongPressTimer = 0;
        if (
          this.removed ||
          this.stopped ||
          this.captureMode !== "app" ||
          this.activeTouchId === null ||
          (this.activeTouchId | 0) !== targetTouchId ||
          !this.touchLongPressEligible ||
          this.touchPrimaryMouseActive ||
          this.touchSecondaryMouseActive ||
          this.touchLongPressTriggered ||
          this.touchSwipeHeldKey ||
          this.touchSwipeMouseSuppressed ||
          this.hasTouchLongPressMoved()
        ) {
          return;
        }
        const touchPoint = {
          clientX: this.touchSwipeLastX | 0,
          clientY: this.touchSwipeLastY | 0
        };
        const moveEvent = createSyntheticPointerEvent(sourceEvent, touchPoint, 0, 0);
        const downEvent = createSyntheticPointerEvent(sourceEvent, touchPoint, 0x02, 2);
        const inside = this.getPointerInfo(moveEvent).inside;
        this.forwardMouseEvent(moveEvent, 0, 0, true, 0, 0, inside);
        this.forwardMouseEvent(downEvent, 0x02, 0, false, 0, 0, inside);
        this.touchSecondaryMouseActive = true;
        this.touchLongPressTriggered = true;
        this.touchSwipeMouseSuppressed = true;
        this.scheduleTouchLongPressRelease(sourceEvent, touchPoint);
      }, TOUCH_LONG_PRESS_DELAY_MS);
    }

    scheduleTouchLongPressRelease(event, touch) {
      if (this.touchLongPressReleaseTimer) {
        clearTimeout(this.touchLongPressReleaseTimer);
        this.touchLongPressReleaseTimer = 0;
      }
      if (!this.touchSecondaryMouseActive || this.captureMode !== "app") {
        return;
      }
      const sourceEvent = event || null;
      const point = touch
        ? { clientX: touch.clientX | 0, clientY: touch.clientY | 0 }
        : { clientX: this.touchSwipeLastX | 0, clientY: this.touchSwipeLastY | 0 };
      const targetTouchId = this.activeTouchId === null ? null : (this.activeTouchId | 0);
      this.touchLongPressReleaseTimer = setTimeout(() => {
        this.touchLongPressReleaseTimer = 0;
        if (
          !this.touchSecondaryMouseActive ||
          this.captureMode !== "app" ||
          this.activeTouchId === null ||
          targetTouchId === null ||
          (this.activeTouchId | 0) !== targetTouchId
        ) {
          return;
        }
        this.releaseTouchSecondaryMouse(sourceEvent, point);
      }, TOUCH_LONG_PRESS_RELEASE_DELAY_MS);
    }

    ensureTouchPrimaryMouseDown(event) {
      if (
        this.touchPrimaryMouseActive ||
        this.touchSecondaryMouseActive ||
        this.captureMode !== "app" ||
        this.touchLongPressTriggered ||
        this.touchSwipeMouseSuppressed
      ) {
        return false;
      }
      if (this.touchLongPressTimer) {
        clearTimeout(this.touchLongPressTimer);
        this.touchLongPressTimer = 0;
      }
      const downEvent = createSyntheticPointerEvent(
        event,
        {
          clientX: this.touchPrimaryStartClientX | 0,
          clientY: this.touchPrimaryStartClientY | 0
        },
        this.captureButtonMask || 0x01,
        0
      );
      this.forwardMouseEvent(downEvent, this.captureButtonMask || 0x01, 0, false, 0, 0, this.getPointerInfo(downEvent).inside);
      this.touchPrimaryMouseActive = true;
      return true;
    }

    releaseTouchSecondaryMouse(event, touch) {
      if (!this.touchSecondaryMouseActive || this.captureMode !== "app") {
        return false;
      }
      if (this.touchLongPressReleaseTimer) {
        clearTimeout(this.touchLongPressReleaseTimer);
        this.touchLongPressReleaseTimer = 0;
      }
      const releaseEvent = createSyntheticPointerEvent(event, touch, 0, 2);
      this.forwardMouseEvent(releaseEvent, 0, 0x02, false, 0, 0, this.getPointerInfo(releaseEvent).inside);
      this.touchSecondaryMouseActive = false;
      return true;
    }

    dispatchTouchPrimaryTap(event, touch) {
      if (this.captureMode !== "app" || this.touchLongPressTriggered || this.touchSwipeMouseSuppressed) {
        return false;
      }
      const mask = this.captureButtonMask || 0x01;
      const moveEvent = createSyntheticPointerEvent(
        event,
        {
          clientX: this.touchPrimaryStartClientX | 0,
          clientY: this.touchPrimaryStartClientY | 0
        },
        0,
        0
      );
      const downEvent = createSyntheticPointerEvent(
        event,
        {
          clientX: this.touchPrimaryStartClientX | 0,
          clientY: this.touchPrimaryStartClientY | 0
        },
        mask,
        0
      );
      const upEvent = createSyntheticPointerEvent(event, touch, 0, 0);
      this.forwardMouseEvent(moveEvent, 0, 0, true, 0, 0, this.getPointerInfo(moveEvent).inside);
      this.forwardMouseEvent(downEvent, mask, 0, false, 0, 0, this.getPointerInfo(downEvent).inside);
      setTimeout(() => {
        this.forwardMouseEvent(upEvent, 0, mask, false, 0, 0, this.getPointerInfo(upEvent).inside);
      }, TOUCH_LONG_PRESS_RELEASE_DELAY_MS);
      this.touchPrimaryMouseActive = false;
      return true;
    }

    buildVirtualKeyPayload(code) {
      if (this.removed || this.stopped || !this.emulator || typeof this.emulator.queueBrowserKeyEvent !== "function") {
        return null;
      }
      const key = String(code || "");
      if (!key) {
        return null;
      }
      const translated = keyboard.translateDomKeyboardEvent
        ? keyboard.translateDomKeyboardEvent({ code: key, key })
        : null;
      if (!translated) {
        return null;
      }
      return {
        asciiCode: translated.asciiCode | 0,
        scanCode: translated.scanCode | 0,
        extended: !!translated.extended,
        modifier: !!translated.modifier,
        lockKey: !!translated.lockKey,
        controlKeys: this.controlKeyMask & 0x7ff,
        hotkey: false
      };
    }

    pressVirtualKey(code) {
      const payload = this.buildVirtualKeyPayload(code);
      if (!payload) {
        return false;
      }
      if (this.manager.getActiveProcess() !== this) {
        this.manager.setActiveProcess(this, { focusShell: false });
      }
      this.focusShell();
      this.emulator.queueBrowserKeyEvent({
        ...payload,
        released: false
      });
      return true;
    }

    releaseVirtualKey(code) {
      const payload = this.buildVirtualKeyPayload(code);
      if (!payload) {
        return false;
      }
      this.emulator.queueBrowserKeyEvent({
        ...payload,
        released: true
      });
      return true;
    }

    tapVirtualKey(code) {
      if (!this.pressVirtualKey(code)) {
        return false;
      }
      return this.releaseVirtualKey(code);
    }

    releaseTouchSwipeMouse(event, touch) {
      if (this.touchSwipeMouseSuppressed || this.captureMode !== "app") {
        return;
      }
      if (this.touchLongPressTimer) {
        clearTimeout(this.touchLongPressTimer);
        this.touchLongPressTimer = 0;
      }
      if (this.touchPrimaryMouseActive && this.captureButtonMask) {
        const releaseEvent = createSyntheticPointerEvent(event, touch, 0, 0);
        this.forwardMouseEvent(
          releaseEvent,
          0,
          this.captureButtonMask | 0,
          false,
          0,
          0,
          this.getPointerInfo(releaseEvent).inside
        );
      }
      this.touchPrimaryMouseActive = false;
      this.touchSwipeMouseSuppressed = true;
    }

    tryActivateHeldTouchSwipe(event, touch) {
      const held = this.touchSwipeHeldKey || "";
      const direction = this.resolveTouchSwipeDirection(!!held);
      if (!direction) {
        return !!held;
      }
      if (!held) {
        this.releaseTouchSwipeMouse(event, touch);
        if (!this.pressVirtualKey(direction)) {
          return false;
        }
        this.touchSwipeHeldKey = direction;
        this.reanchorTouchSwipe(touch);
        return true;
      }
      if (direction === held) {
        return true;
      }
      this.releaseVirtualKey(held);
      if (!this.pressVirtualKey(direction)) {
        this.touchSwipeHeldKey = "";
        return false;
      }
      this.touchSwipeHeldKey = direction;
      this.reanchorTouchSwipe(touch);
      return true;
    }

    handleTouchStart(event) {
      if (this.removed || this.activeTouchId !== null) {
        event.preventDefault();
        return;
      }
      if (this.manager && typeof this.manager.primeSpeakerAudio === "function") {
        this.manager.primeSpeakerAudio();
      }
      const touch = getRelevantTouch(event, null);
      if (!touch) {
        return;
      }
      this.activeTouchId = touch.identifier | 0;
      this.beginTouchSwipeTracking(event, touch);
      const pointerEvent = createSyntheticPointerEvent(event, touch, 0x01, 0);
      const pointer = this.getPointerInfo(pointerEvent);
      const resizeHit = this.hitTestResize(pointer.x, pointer.y);
      const chromeHit = this.hitTestChrome(pointer.x, pointer.y);
      if (!this.rolledUp && !this.stopped && !resizeHit && !chromeHit && pointer.inside) {
        this.manager.setActiveProcess(this);
        this.focusShell();
        event.preventDefault();
        this.beginCapture("app", pointerEvent, { mask: 0x01 });
        this.touchLongPressEligible = true;
        this.touchDeferredCapture = true;
        this.scheduleTouchLongPress(event);
      } else {
        this.handleMouseDown(pointerEvent);
      }
      if (!this.captureMode) {
        this.activeTouchId = null;
        this.resetTouchSwipeTracking();
      }
    }

    handleMouseDown(event) {
      if (this.removed) {
        return;
      }
      if (this.manager && typeof this.manager.primeSpeakerAudio === "function") {
        this.manager.primeSpeakerAudio();
      }
      const mask = getDomButtonMask(event.button);
      if (!mask) {
        return;
      }
      this.manager.setActiveProcess(this);
      this.focusShell();
      const pointer = this.getPointerInfo(event);
      const resizeHit = this.hitTestResize(pointer.x, pointer.y);
      const chromeHit = this.hitTestChrome(pointer.x, pointer.y);
      if (event.button === 2 && chromeHit === "titlebar") {
        event.preventDefault();
        this.toggleRollup();
        return;
      }
      if (event.button === 0 && resizeHit) {
        event.preventDefault();
        this.beginCapture("resize", event, { mask, edge: resizeHit });
        return;
      }
      if (event.button === 0 && (chromeHit === "close" || chromeHit === "minimize")) {
        event.preventDefault();
        this.beginCapture("system-button", event, { mask, button: chromeHit });
        this.scheduleChromeRender(true);
        return;
      }
      if (event.button === 0 && chromeHit === "titlebar") {
        event.preventDefault();
        if (this.maximized) {
          return;
        }
        this.beginCapture("drag", event, { mask });
        return;
      }
      if (this.rolledUp) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      this.beginCapture("app", event, { mask });
      this.forwardMouseEvent(event, mask, 0, false, 0, 0, pointer.inside);
    }

    handleMouseMove(event) {
      if (this.captureMode || this.removed || this.rolledUp) {
        return;
      }
      const pointer = this.getPointerInfo(event);
      const resizeHit = this.hitTestResize(pointer.x, pointer.y);
      if (resizeHit) {
        this.shellEl.style.cursor = getResizeCursor(resizeHit);
        if (!this.stopped) {
          this.forwardMouseEvent(event, 0, 0, true, 0, 0, pointer.inside);
        }
        return;
      }
      const chromeHit = this.hitTestChrome(pointer.x, pointer.y);
      if (chromeHit === "titlebar") {
        this.shellEl.style.cursor = this.maximized ? "default" : "move";
        if (!this.stopped) {
          this.forwardMouseEvent(event, 0, 0, true, 0, 0, pointer.inside);
        }
      } else if (chromeHit === "close" || chromeHit === "minimize") {
        this.shellEl.style.cursor = "default";
        if (!this.stopped) {
          this.forwardMouseEvent(event, 0, 0, true, 0, 0, pointer.inside);
        }
      } else {
        this.shellEl.style.cursor = "default";
        if (!this.stopped) {
          this.forwardMouseEvent(event, 0, 0, true, 0, 0, pointer.inside);
        }
      }
    }

    handleMouseUp(event) {
      if (this.captureMode || this.removed || this.rolledUp || this.stopped) {
        return;
      }
      const mask = getDomButtonMask(event.button);
      if (!mask) {
        return;
      }
      this.forwardMouseEvent(event, 0, mask, false, 0, 0, this.getPointerInfo(event).inside);
    }

    handleMouseLeave(event) {
      if (this.captureMode || this.removed || this.stopped) {
        return;
      }
      this.forwardMouseEvent(event, 0, 0, true, 0, 0, false);
    }

    handleWheel(event) {
      if (this.removed || this.stopped || this.rolledUp) {
        return;
      }
      const pointer = this.getPointerInfo(event);
      const wheelX = event.deltaX > 0 ? 1 : (event.deltaX < 0 ? -1 : 0);
      const wheelY = event.deltaY > 0 ? 1 : (event.deltaY < 0 ? -1 : 0);
      if (!wheelX && !wheelY) {
        return;
      }
      event.preventDefault();
      this.forwardMouseEvent(event, 0, 0, false, wheelX, wheelY, pointer.inside);
    }

    handleDoubleClick(event) {
      if (this.removed || this.stopped || this.captureMode || this.rolledUp || event.button !== 0) {
        return;
      }
      const pointer = this.getPointerInfo(event);
      if (this.hitTestChrome(pointer.x, pointer.y) !== "titlebar") {
        return;
      }
      if (!this.maximized && !this.canUserMaximize()) {
        return;
      }
      event.preventDefault();
      this.manager.setActiveProcess(this);
      this.focusShell();
      this.toggleMaximize();
    }

    handleDocumentMouseMove(event) {
      if (this.captureMode === "drag") {
        const dx = (event.clientX | 0) - this.dragMouseX;
        const dy = (event.clientY | 0) - this.dragMouseY;
        this.setWindowPosition((this.dragOriginX + dx) | 0, (this.dragOriginY + dy) | 0, true);
        return;
      }
      if (this.captureMode === "resize") {
        const dx = (event.clientX | 0) - this.resizeMouseX;
        const dy = (event.clientY | 0) - this.resizeMouseY;
        let nextWidth = this.resizeOriginWidth | 0;
        let nextHeight = this.resizeOriginHeight | 0;
        if (this.resizeEdge.indexOf("e") !== -1) {
          nextWidth = (this.resizeOriginWidth + dx) | 0;
        }
        if (this.resizeEdge.indexOf("s") !== -1) {
          nextHeight = (this.resizeOriginHeight + dy) | 0;
        }
        this.requestWindowResize(nextWidth, nextHeight);
        return;
      }
      if (this.captureMode === "system-button") {
        const pointer = this.getPointerInfo(event);
        this.pressedSystemHot = this.hitTestChrome(pointer.x, pointer.y) === this.pressedSystemButton;
        this.scheduleChromeRender(true);
        return;
      }
      if (this.captureMode === "app") {
        this.forwardMouseEvent(event, 0, 0, true, 0, 0, this.getPointerInfo(event).inside);
      }
    }

    handleDocumentMouseUp(event) {
      if (this.captureMode === "drag") {
        this.endCapture();
        return;
      }
      if (this.captureMode === "resize") {
        this.endCapture();
        return;
      }
      if (this.captureMode === "system-button") {
        const button = this.pressedSystemButton;
        const pointer = this.getPointerInfo(event);
        const stillHot = this.hitTestChrome(pointer.x, pointer.y) === button;
        this.endCapture();
        if (stillHot) {
          this.performSystemButton(button);
        }
        return;
      }
      if (this.captureMode === "app") {
        const mask = getDomButtonMask(event.button) || this.captureButtonMask;
        this.forwardMouseEvent(event, 0, mask, false, 0, 0, this.getPointerInfo(event).inside);
        if ((getDomButtonsMask(event.buttons) & this.captureButtonMask) === 0) {
          this.endCapture();
        }
      }
    }

    handleDocumentTouchMove(event) {
      if (this.activeTouchId === null) {
        return;
      }
      const touch = getRelevantTouch(event, this.activeTouchId);
      if (!touch) {
        return;
      }
      this.updateTouchSwipeTracking(touch);
      if (!this.touchDeferredCapture) {
        if (this.tryActivateHeldTouchSwipe(event, touch) || this.touchSwipeMouseSuppressed) {
          event.preventDefault();
          return;
        }
        this.handleDocumentMouseMove(createSyntheticPointerEvent(
          event,
          touch,
          this.captureButtonMask || 0x01,
          0
        ));
        event.preventDefault();
        return;
      }
      if (this.hasTouchLongPressMoved() && this.touchLongPressTimer) {
        clearTimeout(this.touchLongPressTimer);
        this.touchLongPressTimer = 0;
      }
      if (this.touchLongPressTriggered) {
        event.preventDefault();
        return;
      }
      if (this.tryActivateHeldTouchSwipe(event, touch) || this.touchSwipeMouseSuppressed) {
        event.preventDefault();
        return;
      }
      if (!this.touchPrimaryMouseActive && !this.hasTouchLongPressMoved()) {
        event.preventDefault();
        return;
      }
      this.ensureTouchPrimaryMouseDown(event);
      this.handleDocumentMouseMove(createSyntheticPointerEvent(
        event,
        touch,
        this.captureButtonMask || 0x01,
        0
      ));
      event.preventDefault();
    }

    handleDocumentTouchEnd(event) {
      if (this.activeTouchId === null) {
        return;
      }
      const touch = getRelevantTouch(event, this.activeTouchId);
      if (!touch) {
        return;
      }
      this.updateTouchSwipeTracking(touch);
      if (!this.touchDeferredCapture) {
        if (this.touchSwipeHeldKey) {
          this.releaseVirtualKey(this.touchSwipeHeldKey);
          this.touchSwipeHeldKey = "";
          if (this.touchSwipeMouseSuppressed) {
            this.endCapture();
            event.preventDefault();
            return;
          }
        }
        const direction = this.resolveTouchSwipeDirection();
        this.handleDocumentMouseUp(createSyntheticPointerEvent(event, touch, 0, 0));
        if (direction) {
          this.tapVirtualKey(direction);
        }
        event.preventDefault();
        return;
      }
      if (this.touchLongPressTimer) {
        clearTimeout(this.touchLongPressTimer);
        this.touchLongPressTimer = 0;
      }
      if (this.touchLongPressTriggered) {
        this.releaseTouchSecondaryMouse(event, touch);
        this.endCapture();
        event.preventDefault();
        return;
      }
      if (this.touchSwipeHeldKey) {
        this.releaseVirtualKey(this.touchSwipeHeldKey);
        this.touchSwipeHeldKey = "";
        if (this.touchSwipeMouseSuppressed) {
          this.endCapture();
          event.preventDefault();
          return;
        }
      }
      const direction = this.resolveTouchSwipeDirection();
      if (this.touchPrimaryMouseActive) {
        this.handleDocumentMouseUp(createSyntheticPointerEvent(event, touch, 0, 0));
      } else if (!direction && !this.touchSwipeMouseSuppressed) {
        this.dispatchTouchPrimaryTap(event, touch);
        this.endCapture();
      } else {
        this.endCapture();
      }
      if (direction) {
        this.tapVirtualKey(direction);
      }
      event.preventDefault();
    }

    handleDocumentTouchCancel(event) {
      if (this.activeTouchId === null) {
        return;
      }
      if (this.touchLongPressTimer) {
        clearTimeout(this.touchLongPressTimer);
        this.touchLongPressTimer = 0;
      }
      if (this.touchSecondaryMouseActive) {
        this.releaseTouchSecondaryMouse(event, {
          clientX: this.touchSwipeLastX | 0,
          clientY: this.touchSwipeLastY | 0
        });
      }
      this.releaseVirtualKey(this.touchSwipeHeldKey);
      this.touchSwipeHeldKey = "";
      this.cancelCapture();
      event.preventDefault();
    }

    performSystemButton(button) {
      if (button === "close") {
        if (this.stopped || !this.emulator || !this.emulator.running) {
          this.manager.detachProcess(this);
          return;
        }
        if (typeof this.emulator.queueSystemButtonEvent === "function") {
          this.emulator.queueSystemButtonEvent(SYSTEM_BUTTON_CLOSE, 0x01);
        } else {
          this.stop("terminated");
        }
        return;
      }
      if (button === "minimize") {
        this.manager.minimizeProcess(this);
      }
    }

    handleKeyDown(event) {
      if (this.removed || this.stopped || !this.emulator) {
        return;
      }
      if (this.manager && typeof this.manager.primeSpeakerAudio === "function") {
        this.manager.primeSpeakerAudio();
      }
      if (this.manager.getActiveProcess() !== this) {
        this.manager.setActiveProcess(this, { focusShell: false });
      }
      if (this.manager && this.manager.app && typeof this.manager.app.handleBrowserKeyboardSyncEvent === "function") {
        this.manager.app.handleBrowserKeyboardSyncEvent(event);
      }
      const translated = keyboard.translateDomKeyboardEvent ? keyboard.translateDomKeyboardEvent(event) : null;
      if (!translated && (!keyboard.isTrackedKeyboardCode || !keyboard.isTrackedKeyboardCode(event.code))) {
        return;
      }
      if (keyboard.updateControlKeyMaskState) {
        this.controlKeyMask = keyboard.updateControlKeyMaskState(this.controlKeyMask, event, true);
      }
      if (translated && typeof this.emulator.queueBrowserKeyEvent === "function") {
        this.emulator.queueBrowserKeyEvent({
          asciiCode: translated.asciiCode | 0,
          scanCode: translated.scanCode | 0,
          extended: !!translated.extended,
          modifier: !!translated.modifier,
          lockKey: !!translated.lockKey,
          controlKeys: this.controlKeyMask & 0x7ff,
          released: false,
          hotkey: false
        });
      }
      event.preventDefault();
    }

    handleKeyUp(event) {
      if (this.removed || this.stopped || !this.emulator) {
        return;
      }
      if (this.manager && this.manager.app && typeof this.manager.app.handleBrowserKeyboardSyncEvent === "function") {
        this.manager.app.handleBrowserKeyboardSyncEvent(event);
      }
      const translated = keyboard.translateDomKeyboardEvent ? keyboard.translateDomKeyboardEvent(event) : null;
      if (!translated && (!keyboard.isTrackedKeyboardCode || !keyboard.isTrackedKeyboardCode(event.code))) {
        return;
      }
      if (keyboard.updateControlKeyMaskState) {
        this.controlKeyMask = keyboard.updateControlKeyMaskState(this.controlKeyMask, event, false);
      }
      if (translated && typeof this.emulator.queueBrowserKeyEvent === "function") {
        this.emulator.queueBrowserKeyEvent({
          asciiCode: translated.asciiCode | 0,
          scanCode: translated.scanCode | 0,
          extended: !!translated.extended,
          modifier: !!translated.modifier,
          lockKey: !!translated.lockKey,
          controlKeys: this.controlKeyMask & 0x7ff,
          released: true,
          hotkey: false
        });
      }
      event.preventDefault();
    }

    handleStopped(reason) {
      if (this.removed) {
        return;
      }
      this.stopReason = String(reason || this.removeOnStopReason || "stopped");
      this.stopped = true;
      this.rootEl.classList.add("workspace-window-stopped");
      this.cancelCapture();
      this.scheduleChromeRender(true);
      if (this.stopReason === "terminated" || this.stopReason === "stopped") {
        this.manager.detachProcess(this);
        return;
      }
      this.manager.onProcessVisualStateChanged();
    }

    stop(reason) {
      if (this.removed) {
        return false;
      }
      const finalReason = String(reason || "stopped");
      this.removeOnStopReason = finalReason;
      if (this.emulator && this.emulator.running) {
        this.emulator.stop(finalReason);
        return true;
      }
      this.stopped = true;
      if (finalReason === "terminated" || finalReason === "stopped") {
        this.manager.detachProcess(this);
      }
      return true;
    }

    getClientBounds() {
      const titlebar = this.getTitlebarHeight();
      const skinned = this.isSkinnedWindow();
      let clientOffsetX = this.emulator ? (this.emulator.windowClientOffsetX | 0) : 0;
      let clientOffsetY = this.emulator ? (this.emulator.windowClientOffsetY | 0) : 0;
      if (!clientOffsetX && skinned) {
        clientOffsetX = 4;
      }
      if (!clientOffsetY && skinned) {
        clientOffsetY = titlebar;
      }
      const rightInset = skinned ? 4 : 0;
      const bottomInset = skinned ? 5 : 0;
      const visibleHeight = this.getVisibleHeight();
      return {
        x: clientOffsetX | 0,
        y: clientOffsetY | 0,
        width: Math.max(0, this.windowWidth - clientOffsetX - rightInset) | 0,
        height: this.rolledUp ? 0 : (Math.max(0, visibleHeight - clientOffsetY - bottomInset) | 0)
      };
    }

    getWindowState() {
      let state = WINDOW_STATE_USED;
      if (this.maximized) {
        state |= WINDOW_STATE_MAXIMIZED;
      }
      if (this.minimized) {
        state |= WINDOW_STATE_MINIMIZED;
      }
      if (this.rolledUp) {
        state |= WINDOW_STATE_ROLLEDUP;
      }
      return state >>> 0;
    }

    toThreadInfo(windowStackPosition) {
      const client = this.getClientBounds();
      return {
        cpuUsage: this.emulator && typeof this.emulator.getReportedCpuUsage === "function"
          ? this.emulator.getReportedCpuUsage()
          : 0,
        windowStackPosition: windowStackPosition >>> 0,
        name: this.name,
        memoryAddress: 0,
        usedMemory: this.emulator && typeof this.emulator.getCommittedProcessMemoryBytes === "function"
          ? (this.emulator.getCommittedProcessMemoryBytes() >>> 0)
          : (this.manager ? (this.manager.getApproxProcessMemoryBytes(this) >>> 0) : 0),
        pid: this.pid >>> 0,
        windowX: this.actualX >>> 0,
        windowY: this.actualY >>> 0,
        windowWidth: this.windowWidth >>> 0,
        windowHeight: this.getVisibleHeight() >>> 0,
        slotState: this.stopped ? 9 : 0,
        clientX: client.x >>> 0,
        clientY: client.y >>> 0,
        clientWidth: client.width >>> 0,
        clientHeight: client.height >>> 0,
        windowState: this.getWindowState() >>> 0,
        eventMask: this.emulator ? (this.emulator.eventMask >>> 0) : 0,
        keyboardMode: this.emulator ? (this.emulator.keyboardMode & 0xff) : 0
      };
    }

    destroy() {
      if (this.removed) {
        return;
      }
      this.removed = true;
      this.cancelCapture();
      if (this.emulator) {
        const running = !!this.emulator.running;
        this.emulator.onStopped = null;
        this.emulator.onWindowGeometry = null;
        this.emulator.onWindowResize = null;
        if (running) {
          this.emulator.stop("stopped");
        }
      }
      if (this.surface && typeof this.surface.destroy === "function") {
        this.surface.destroy();
      }
      if (this.chromeSurface && typeof this.chromeSurface.destroy === "function") {
        this.chromeSurface.destroy();
      }
      if (this.rootEl && this.rootEl.parentNode) {
        this.rootEl.parentNode.removeChild(this.rootEl);
      }
      this.rootEl = null;
      this.shellEl = null;
      this.canvasEl = null;
      this.chromeEl = null;
      this.surface = null;
      this.chromeSurface = null;
      this.emulator = null;
    }
  }

  class SessionManager {
    constructor(app, workspaceEl) {
      this.app = app;
      this.workspaceEl = workspaceEl;
      this.desktopEl = document.createElement("div");
      this.desktopEl.className = "workspace-desktop";
      this.workspaceEl.insertBefore(this.desktopEl, this.workspaceEl.firstChild);
      this.desktopCanvasEl = document.createElement("canvas");
      this.desktopCanvasEl.className = "workspace-desktop-canvas";
      this.desktopCanvasEl.setAttribute("aria-hidden", "true");
      this.desktopEl.appendChild(this.desktopCanvasEl);
      this.processes = [];
      this.processBySlot = new Map();
      this.processByPid = new Map();
      this.sharedNamedMemoryStore = new Map();
      this.debugBoardState = sessionShared.createDebugBoardState();
      this.desktopSurface = createSurface(
        this.desktopCanvasEl,
        1,
        1,
        (msg) => this.app.log(`desktop: ${msg}`),
        { preferCanvas2D: true }
      );
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
      this.speakerAudioContext = null;
      this.speakerAudioOutput = null;
      this.speakerPlayback = null;
      this.speakerPlaybackSerial = 0;
      this.speakerPlayCount = 0;
      this.lastSpeakerPlayback = null;
      this.speakerAudioLogState = {
        unavailable: false,
        blocked: false
      };
      this.lowLevelHdAccessEnabled = false;
      this.lowLevelPciAccessEnabled = false;
      this.loadedDrivers = new Map();
      this.nextDriverHandle = 1;
      this.cpuBusySamples = [];
      this.cpuBusySampleTotalMs = 0;
      this.screenWorkArea = null;
      this.activeProcess = null;
      this.traceConfig = typeof app.currentTraceConfig === "function" ? app.currentTraceConfig() : {};
      this.cpuBackendMode = typeof app.currentCpuBackendConfig === "function"
        ? app.currentCpuBackendConfig()
        : "js";
      this.nextPid = 1;
      this.nextSlot = 1;
      this.nextCascadeIndex = 0;
      this.zCounter = 1;
      this.namedMemoryBootstrapActive = false;
      this.boundWorkspaceMouseMove = (event) => this.handleWorkspaceMouseMove(event);
      this.boundWindowResize = () => this.handleViewportResize();
      this.boundDesktopMouseDown = (event) => this.handleDesktopMouseDown(event);
      this.boundDesktopMouseMove = (event) => this.handleDesktopMouseMove(event);
      this.boundDesktopMouseUp = (event) => this.handleDesktopMouseUp(event);
      this.boundDesktopMouseLeave = (event) => this.handleDesktopMouseLeave(event);
      this.boundDesktopWheel = (event) => this.handleDesktopWheel(event);
      this.desktopTouchId = null;
      this.desktopTouchClientX = 0;
      this.desktopTouchClientY = 0;
      this.desktopSwipeStartX = 0;
      this.desktopSwipeStartY = 0;
      this.desktopSwipeLastX = 0;
      this.desktopSwipeLastY = 0;
      this.desktopSwipeStartMs = 0;
      this.desktopSwipeEligible = false;
      this.desktopSwipeHeldKey = "";
      this.desktopSwipeMouseSuppressed = false;
      this.desktopSwipeTarget = null;
      this.desktopPrimaryMouseActive = false;
      this.desktopSecondaryMouseActive = false;
      this.desktopLongPressTimer = 0;
      this.desktopLongPressReleaseTimer = 0;
      this.desktopLongPressTriggered = false;
      this.desktopTouchStartClientX = 0;
      this.desktopTouchStartClientY = 0;
      this.boundDesktopTouchMove = (event) => this.handleDocumentDesktopTouchMove(event);
      this.boundDesktopTouchEnd = (event) => this.handleDocumentDesktopTouchEnd(event);
      this.boundDesktopTouchCancel = (event) => this.handleDocumentDesktopTouchCancel(event);
      this.boundDesktopBlur = () => this.cancelDesktopTouchCapture();
      this.workspaceEl.addEventListener("mousemove", this.boundWorkspaceMouseMove);
      window.addEventListener("resize", this.boundWindowResize);
      this.desktopCanvasEl.addEventListener("mousedown", this.boundDesktopMouseDown);
      this.desktopCanvasEl.addEventListener("mousemove", this.boundDesktopMouseMove);
      this.desktopCanvasEl.addEventListener("mouseup", this.boundDesktopMouseUp);
      this.desktopCanvasEl.addEventListener("mouseleave", this.boundDesktopMouseLeave);
      this.desktopCanvasEl.addEventListener("touchstart", (event) => this.handleDesktopTouchStart(event), { passive: false });
      this.desktopCanvasEl.addEventListener("wheel", this.boundDesktopWheel, { passive: false });
      this.desktopCanvasEl.addEventListener("contextmenu", (event) => event.preventDefault());
      this.resetScreenWorkArea();
      this.ensureDesktopSurfaceSize();
      this.renderDesktopBackground();
      this.presentDesktopSurface();
    }

    resetSystemState(options) {
      const opts = options || {};
      if (typeof this.cancelDesktopTouchCapture === "function") {
        this.cancelDesktopTouchCapture();
      }
      this.desktopTouchId = null;
      this.desktopTouchClientX = 0;
      this.desktopTouchClientY = 0;
      this.desktopSwipeStartX = 0;
      this.desktopSwipeStartY = 0;
      this.desktopSwipeLastX = 0;
      this.desktopSwipeLastY = 0;
      this.desktopSwipeStartMs = 0;
      this.desktopSwipeEligible = false;
      this.desktopSwipeHeldKey = "";
      this.desktopSwipeMouseSuppressed = false;
      this.desktopSwipeTarget = null;
      this.desktopPrimaryMouseActive = false;
      this.desktopLongPressTriggered = false;
      if (this.desktopLongPressTimer) {
        clearTimeout(this.desktopLongPressTimer);
        this.desktopLongPressTimer = 0;
      }
      this.desktopTouchStartClientX = 0;
      this.desktopTouchStartClientY = 0;
      this.sharedNamedMemoryStore = new Map();
      sessionShared.resetDebugBoardState(this.debugBoardState);
      this.namedMemoryBootstrapActive = false;
      this.desktopBackgroundWidth = 0;
      this.desktopBackgroundHeight = 0;
      this.desktopBackgroundMode = 1;
      this.desktopBackgroundData = new Uint8Array(0);
      this.keyboardLayouts = new Map();
      this.keyboardLanguageId = 1;
      this.systemLanguageId = 1;
      this.systemSkinPath = DEFAULT_SYSTEM_SKIN_PATH;
      this.systemButtonStyle = DEFAULT_SYSTEM_BUTTON_STYLE;
      this.systemSkinColorTableBytes = null;
      this.fontSmoothingMode = 1;
      this.fontSizePx = 9;
      this.stopSpeakerPlayback();
      this.speakerDisabled = false;
      this.speakerPlayCount = 0;
      this.lastSpeakerPlayback = null;
      this.speakerAudioLogState = {
        unavailable: false,
        blocked: false
      };
      this.lowLevelHdAccessEnabled = false;
      this.lowLevelPciAccessEnabled = false;
      this.loadedDrivers = new Map();
      this.nextDriverHandle = 1;
      this.cpuBusySamples = [];
      this.cpuBusySampleTotalMs = 0;
      this.activeProcess = null;
      this.nextPid = 1;
      this.nextSlot = 1;
      this.nextCascadeIndex = 0;
      this.zCounter = 1;
      this.resetScreenWorkArea();
      if (opts.reloadStyleFromFileSystem !== false) {
        this.reloadSystemStyleFromFileSystem();
      }
      this.ensureDesktopSurfaceSize();
      const width = Math.max(1, this.desktopSurface ? (this.desktopSurface.width | 0) : 1);
      const height = Math.max(1, this.desktopSurface ? (this.desktopSurface.height | 0) : 1);
      this.desktopLastDraw = {
        left: 0,
        top: 0,
        right: width - 1,
        bottom: height - 1
      };
      this.renderDesktopBackground();
      this.presentDesktopSurface();
      this.syncDesktopSize();
      this.onProcessVisualStateChanged();
      return true;
    }

    writeDebugBoardByte(value) {
      return sessionShared.pushDebugBoardByte(this.debugBoardState, value & 0xff);
    }

    writeDebugBoardMessage(message) {
      return sessionShared.writeDebugBoardText(this.debugBoardState, String(message || ""));
    }

    readDebugBoardByte() {
      return sessionShared.readDebugBoardByte(this.debugBoardState);
    }

    mirrorProcessLogToDebugBoard(process, message) {
      const severity = sessionShared.classifyProcessLogSeverity(message);
      if (!severity) {
        return false;
      }
      const source = process
        ? String(process.displayPath || process.processPath || process.fileName || "process")
        : "emulator";
      this.writeDebugBoardMessage(`${severity}: ${source}: ${String(message || "")}\r\n`);
      return true;
    }

    handleProcessLog(process, message) {
      const line = String(message);
      this.app.log(`${process.displayPath}: ${line}`);
      this.mirrorProcessLogToDebugBoard(process, line);
    }

    getWorkspacePointerPosition(event) {
      const rect = this.workspaceEl.getBoundingClientRect();
      return {
        x: Math.floor((event.clientX - rect.left) + this.workspaceEl.scrollLeft),
        y: Math.floor((event.clientY - rect.top) + this.workspaceEl.scrollTop)
      };
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
        if (process.maximized) {
          process.syncMaximizedGeometry();
        }
      }
      this.syncDesktopSize();
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
      const next = sessionShared.readSystemStyleState(
        typeof this.app.getFileProvider === "function" ? this.app.getFileProvider() : null,
        {
          defaultSkinPath: DEFAULT_SYSTEM_SKIN_PATH,
          defaultButtonStyle: DEFAULT_SYSTEM_BUTTON_STYLE,
          iniPath: SYSTEM_STYLE_INI_PATH,
          helpers: getIniHelpers()
        }
      );
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
        process.lastChromeSkin = null;
        process.lastChromeKey = "";
        process.scheduleChromeRender(true);
        updated = true;
      }
      if (updated) {
        this.onProcessVisualStateChanged();
      }
      return updated;
    }

    setSystemSkinPath(path, sourceEmulator) {
      const nextPath = String(path || "").trim();
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
      const key = kind | 0;
      return this.keyboardLayouts.get(key) || null;
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
      const next = Math.max(0, Math.min(2, value | 0)) >>> 0;
      this.fontSmoothingMode = next;
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
      if (this.speakerDisabled) {
        this.stopSpeakerPlayback();
      }
      return true;
    }

    toggleSpeakerDisabled() {
      this.speakerDisabled = !this.speakerDisabled;
      if (this.speakerDisabled) {
        this.stopSpeakerPlayback();
      }
      return !!this.speakerDisabled;
    }

    getSpeakerPlaybackInfo() {
      const playback = this.speakerPlayback || null;
      const current = playback
        ? {
            ownerPid: playback.ownerPid >>> 0,
            ownerSlot: playback.ownerSlot >>> 0,
            processPath: String(playback.processPath || ""),
            totalDurationMs: playback.totalDurationMs >>> 0,
            startedAtMs: playback.startedAtMs >>> 0,
            serial: playback.serial >>> 0
          }
        : null;
      const last = this.lastSpeakerPlayback || null;
      return {
        disabled: !!this.speakerDisabled,
        busy: !!playback,
        playCount: this.speakerPlayCount >>> 0,
        audioAvailable: !!getAudioContextCtor(),
        audioState: this.speakerAudioContext ? String(this.speakerAudioContext.state || "") : "unavailable",
        current,
        last: last
          ? {
              ownerPid: last.ownerPid >>> 0,
              ownerSlot: last.ownerSlot >>> 0,
              processPath: String(last.processPath || ""),
              totalDurationMs: last.totalDurationMs >>> 0,
              itemCount: last.itemCount >>> 0,
              toneCount: last.toneCount >>> 0,
              startedAtMs: last.startedAtMs >>> 0,
              serial: last.serial >>> 0
            }
          : null
      };
    }

    ensureSpeakerAudioOutput() {
      const AudioCtor = getAudioContextCtor();
      if (!AudioCtor) {
        if (!this.speakerAudioLogState.unavailable && this.app && typeof this.app.log === "function") {
          this.app.log("speaker: WebAudio is unavailable in this browser environment");
          this.speakerAudioLogState.unavailable = true;
        }
        return null;
      }
      let context = this.speakerAudioContext;
      if (!context) {
        try {
          context = new AudioCtor();
          this.speakerAudioContext = context;
        } catch (err) {
          if (!this.speakerAudioLogState.unavailable && this.app && typeof this.app.log === "function") {
            this.app.log(`speaker: failed to create audio context: ${err instanceof Error ? err.message : String(err)}`);
            this.speakerAudioLogState.unavailable = true;
          }
          return null;
        }
      }
      if (!this.speakerAudioOutput) {
        try {
          const gainNode = context.createGain();
          gainNode.gain.value = SPEAKER_MASTER_GAIN;
          gainNode.connect(context.destination);
          this.speakerAudioOutput = gainNode;
        } catch (err) {
          if (!this.speakerAudioLogState.unavailable && this.app && typeof this.app.log === "function") {
            this.app.log(`speaker: failed to initialize audio output: ${err instanceof Error ? err.message : String(err)}`);
            this.speakerAudioLogState.unavailable = true;
          }
          return null;
        }
      }
      if (context.state === "suspended" && typeof context.resume === "function") {
        context.resume().catch((err) => {
          if (!this.speakerAudioLogState.blocked && this.app && typeof this.app.log === "function") {
            this.app.log(`speaker: audio resume is blocked until a user gesture: ${err instanceof Error ? err.message : String(err)}`);
            this.speakerAudioLogState.blocked = true;
          }
        });
      }
      return {
        context,
        output: this.speakerAudioOutput
      };
    }

    primeSpeakerAudio() {
      return !!this.ensureSpeakerAudioOutput();
    }

    finalizeSpeakerPlayback(playback) {
      if (!playback || this.speakerPlayback !== playback) {
        return false;
      }
      this.speakerPlayback = null;
      if (playback.timeoutId) {
        clearTimeout(playback.timeoutId);
        playback.timeoutId = 0;
      }
      if (playback.gainNode && typeof playback.gainNode.disconnect === "function") {
        try {
          playback.gainNode.disconnect();
        } catch (err) {
          // ignore disconnect races from ended/stopped nodes
        }
      }
      if (playback.oscillator) {
        playback.oscillator.onended = null;
      }
      return true;
    }

    stopSpeakerPlayback(ownerPid) {
      const playback = this.speakerPlayback || null;
      if (!playback) {
        return false;
      }
      if (ownerPid !== undefined && ownerPid !== null && (playback.ownerPid >>> 0) !== (ownerPid >>> 0)) {
        return false;
      }
      if (playback.timeoutId) {
        clearTimeout(playback.timeoutId);
        playback.timeoutId = 0;
      }
      if (playback.oscillator && typeof playback.oscillator.stop === "function") {
        try {
          playback.oscillator.stop();
        } catch (err) {
          // ignore repeated stop on completed nodes
        }
      }
      return this.finalizeSpeakerPlayback(playback);
    }

    playSpeakerSequence(request) {
      if (this.speakerDisabled) {
        return 55;
      }
      if (this.speakerPlayback) {
        return 55;
      }
      const payload = request || {};
      const items = Array.isArray(payload.items) ? payload.items : [];
      const totalDurationMs = Math.max(0, payload.totalDurationMs | 0) >>> 0;
      const ownerPid = payload.ownerPid >>> 0;
      const ownerSlot = payload.ownerSlot >>> 0;
      const processPath = String(payload.processPath || "");
      const serial = ((this.speakerPlaybackSerial + 1) >>> 0) || 1;
      this.speakerPlaybackSerial = serial;
      let toneCount = 0;
      for (let i = 0; i < items.length; i += 1) {
        if (items[i] && items[i].kind === "tone") {
          toneCount += 1;
        }
      }
      const playback = {
        ownerPid,
        ownerSlot,
        processPath,
        totalDurationMs,
        startedAtMs: Date.now() >>> 0,
        serial,
        oscillator: null,
        gainNode: null,
        timeoutId: 0
      };
      this.lastSpeakerPlayback = {
        ownerPid,
        ownerSlot,
        processPath,
        totalDurationMs,
        startedAtMs: playback.startedAtMs >>> 0,
        serial,
        itemCount: items.length >>> 0,
        toneCount: toneCount >>> 0
      };
      this.speakerPlayCount = ((this.speakerPlayCount + 1) >>> 0);

      if (!items.length || totalDurationMs <= 0) {
        return 0;
      }

      this.speakerPlayback = playback;
      const audio = this.ensureSpeakerAudioOutput();
      if (audio && audio.context && audio.output) {
        try {
          const context = audio.context;
          const gainNode = context.createGain();
          const oscillator = context.createOscillator();
          oscillator.type = "square";
          oscillator.connect(gainNode);
          gainNode.connect(audio.output);
          const startTime = Math.max(context.currentTime, 0) + SPEAKER_AUDIO_LATENCY;
          let cursor = startTime;
          gainNode.gain.setValueAtTime(0, startTime);
          let hasTone = false;
          for (let i = 0; i < items.length; i += 1) {
            const item = items[i] || null;
            const durationSec = Math.max(0, Number(item && item.durationMs) || 0) / 1000;
            const segmentStart = cursor;
            const segmentEnd = segmentStart + durationSec;
            if (item && item.kind === "tone" && (Number(item.frequencyHz) || 0) > 0 && durationSec > 0) {
              oscillator.frequency.setValueAtTime(Number(item.frequencyHz), segmentStart);
              const attackEnd = Math.min(segmentEnd, segmentStart + SPEAKER_SEGMENT_ATTACK_SEC);
              const releaseStart = Math.max(segmentStart, segmentEnd - SPEAKER_SEGMENT_RELEASE_SEC);
              gainNode.gain.setValueAtTime(0, segmentStart);
              if (attackEnd > segmentStart) {
                gainNode.gain.linearRampToValueAtTime(1, attackEnd);
              } else {
                gainNode.gain.setValueAtTime(1, segmentStart);
              }
              if (releaseStart > attackEnd) {
                gainNode.gain.setValueAtTime(1, releaseStart);
              }
              gainNode.gain.linearRampToValueAtTime(0, segmentEnd);
              hasTone = true;
            } else {
              gainNode.gain.setValueAtTime(0, segmentStart);
            }
            cursor = segmentEnd;
          }
          if (hasTone) {
            oscillator.start(startTime);
            oscillator.stop(cursor + SPEAKER_SEGMENT_RELEASE_SEC);
            oscillator.onended = () => {
              this.finalizeSpeakerPlayback(playback);
            };
            playback.oscillator = oscillator;
            playback.gainNode = gainNode;
          } else if (typeof gainNode.disconnect === "function") {
            gainNode.disconnect();
          }
        } catch (err) {
          if (this.app && typeof this.app.log === "function") {
            this.app.log(`speaker: audio scheduling failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
      playback.timeoutId = setTimeout(() => {
        this.finalizeSpeakerPlayback(playback);
      }, Math.max(0, totalDurationMs + 32) | 0);
      return 0;
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
      const config = KosEmu && KosEmu.config ? KosEmu.config : null;
      if (config && Number.isFinite(Number(config.cpuFreqHz))) {
        hz = Number(config.cpuFreqHz);
      }
      if (!(hz > 0)) {
        hz = DEFAULT_CPU_FREQ_HZ;
      }
      return Math.max(1, Math.min(0xffffffff, Math.round(hz))) >>> 0;
    }

    getConfiguredSystemRamBytes() {
      let total = 0;
      const config = KosEmu && KosEmu.config ? KosEmu.config : null;
      if (config && Number.isFinite(Number(config.systemRamBytes))) {
        total = Number(config.systemRamBytes);
      }
      if (!(total > 0)) {
        total = DEFAULT_SYSTEM_RAM_BYTES;
      }
      return Math.max(1, Math.min(0xffffffff, Math.round(total))) >>> 0;
    }

    getConfiguredSystemReservedRamBytes() {
      let reserved = null;
      const config = KosEmu && KosEmu.config ? KosEmu.config : null;
      if (config && Number.isFinite(Number(config.systemReservedRamBytes))) {
        reserved = Number(config.systemReservedRamBytes);
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
        return false;
      }
      const viewport = this.getViewportSize();
      const width = Math.max(1, viewport.width | 0, minWidth === undefined ? 0 : (minWidth | 0));
      const height = Math.max(1, viewport.height | 0, minHeight === undefined ? 0 : (minHeight | 0));
      if ((this.desktopSurface.width | 0) === width && (this.desktopSurface.height | 0) === height) {
        return false;
      }
      this.desktopSurface.resize(width, height);
      this.desktopCanvasEl.style.width = `${width}px`;
      this.desktopCanvasEl.style.height = `${height}px`;
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
        const fill = packCanvasColor(DEFAULT_DESKTOP_COLOR, 255);
        const grid = packCanvasColor(DEFAULT_DESKTOP_GRID_COLOR, 255);
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
          surface.buffer32[dstRow + x] = packCanvasColor(((r << 16) | (g << 8) | b) >>> 0, 255);
        }
      }
    }

    presentDesktopSurface() {
      if (this.desktopSurface && typeof this.desktopSurface.present === "function") {
        this.desktopSurface.present();
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
      this.presentDesktopSurface();
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
      const sw = surface.width | 0;
      const sh = surface.height | 0;
      const dstBuf = surface.buffer32;
      const src32 = new Uint32Array(data.buffer, data.byteOffset, data.byteLength >>> 2);

      for (let py = 0; py < drawHeight; py += 1) {
        const ty = dstY + py;
        if (ty < 0 || ty >= sh) continue;
        const srcOff = py * drawWidth;
        const dstOff = ty * sw + dstX;
        const rowEnd = Math.min(drawWidth, sw - dstX);
        for (let px = 0; px < rowEnd; px += 1) {
          const p = src32[srcOff + px];
          if (!(p >>> 24)) continue;
          dstBuf[dstOff + px] = ((p & 0x000000ff) << 16) | (p & 0x0000ff00) | ((p & 0x00ff0000) >>> 16) | 0xff000000;
        }
      }
      this.presentDesktopSurface();
      const source = this.processBySlot.get(sourceSlot >>> 0) || null;
      this.queueDesktopRedrawEvent(source ? (source.threadGroupId >>> 0) : 0);
      return true;
    }

    getWindowPositionMode(pid) {
      const process = this.processByPid.get(pid >>> 0) || null;
      return process && !process.removed ? ((process.windowPositionMode | 0) >>> 0) : (WINDOW_Z_NORMAL >>> 0);
    }

    applyProcessZOrder(process) {
      if (!process || !process.rootEl) {
        return;
      }
      process.rootEl.style.zIndex = String((getWindowZBase(process.windowPositionMode) + (process.zOrder | 0)) | 0);
    }

    setWindowPositionMode(pid, position) {
      const process = this.processByPid.get(pid >>> 0) || null;
      const next = position | 0;
      if (!process || process.removed || (next !== WINDOW_Z_DESKTOP && next !== WINDOW_Z_ALWAYS_BACK && next !== WINDOW_Z_NORMAL && next !== WINDOW_Z_ALWAYS_TOP)) {
        return false;
      }
      if ((process.windowPositionMode | 0) === next) {
        return true;
      }
      process.windowPositionMode = next;
      this.applyProcessZOrder(process);
      return true;
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
      const insideRect =
        localX >= 0 &&
        localY >= 0 &&
        localX < (process.windowWidth | 0) &&
        localY < (process.getVisibleHeight() | 0);
      return {
        x: localX,
        y: localY,
        screenX: x,
        screenY: y,
        inside: insideRect && process.pointInWindowShape(localX, localY)
      };
    }

    forwardGlobalMouseEvent(screenX, screenY, buttons, pressMask, releaseMask, moved, wheelX, wheelY, options) {
      const x = screenX | 0;
      const y = screenY | 0;
      const opts = options || {};
      const primaryProcess = opts.primaryProcess || null;
      const hasPrimaryInside = Object.prototype.hasOwnProperty.call(opts, "primaryInside");
      const primaryInside = !!opts.primaryInside;
      for (let i = 0; i < this.processes.length; i += 1) {
        const process = this.processes[i];
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
          process === primaryProcess && hasPrimaryInside ? primaryInside : !!state.inside,
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

    forwardDesktopMouseEvent(event, pressMask, releaseMask, moved, wheelX, wheelY) {
      const pointer = this.getWorkspacePointerPosition(event);
      this.forwardGlobalMouseEvent(
        pointer.x,
        pointer.y,
        getDomButtonsMask(event.buttons),
        pressMask,
        releaseMask,
        moved,
        wheelX,
        wheelY
      );
    }

    handleDesktopMouseDown(event) {
      event.preventDefault();
      this.setActiveProcess(null, { focusShell: false });
      this.forwardDesktopMouseEvent(event, getDomButtonMask(event.button), 0, false, 0, 0);
    }

    handleDesktopMouseMove(event) {
      this.forwardDesktopMouseEvent(event, 0, 0, true, 0, 0);
    }

    handleDesktopMouseUp(event) {
      event.preventDefault();
      this.forwardDesktopMouseEvent(event, 0, getDomButtonMask(event.button), false, 0, 0);
    }

    handleDesktopMouseLeave(event) {
      this.forwardDesktopMouseEvent(event, 0, 0, true, 0, 0);
    }

    handleDesktopWheel(event) {
      event.preventDefault();
      this.forwardDesktopMouseEvent(event, 0, 0, false, 0, -(event.deltaY | 0));
    }

    recordDesktopTouch(touch) {
      if (!touch) {
        return;
      }
      this.desktopTouchClientX = touch.clientX | 0;
      this.desktopTouchClientY = touch.clientY | 0;
      this.desktopSwipeLastX = touch.clientX | 0;
      this.desktopSwipeLastY = touch.clientY | 0;
    }

    resetDesktopSwipeTracking() {
      if (this.desktopLongPressTimer) {
        clearTimeout(this.desktopLongPressTimer);
        this.desktopLongPressTimer = 0;
      }
      if (this.desktopLongPressReleaseTimer) {
        clearTimeout(this.desktopLongPressReleaseTimer);
        this.desktopLongPressReleaseTimer = 0;
      }
      this.desktopSwipeStartX = 0;
      this.desktopSwipeStartY = 0;
      this.desktopSwipeLastX = 0;
      this.desktopSwipeLastY = 0;
      this.desktopSwipeStartMs = 0;
      this.desktopSwipeEligible = false;
      this.desktopPrimaryMouseActive = false;
      this.desktopSecondaryMouseActive = false;
      this.desktopLongPressTriggered = false;
      this.desktopTouchStartClientX = 0;
      this.desktopTouchStartClientY = 0;
    }

    beginDesktopSwipeTracking(touch) {
      if (!touch) {
        this.resetDesktopSwipeTracking();
        return;
      }
      this.desktopSwipeStartX = touch.clientX | 0;
      this.desktopSwipeStartY = touch.clientY | 0;
      this.desktopSwipeLastX = touch.clientX | 0;
      this.desktopSwipeLastY = touch.clientY | 0;
      this.desktopSwipeStartMs = Date.now();
      this.desktopSwipeHeldKey = "";
      this.desktopSwipeMouseSuppressed = false;
      this.desktopSwipeTarget = null;
      this.desktopPrimaryMouseActive = false;
      this.desktopSecondaryMouseActive = false;
      this.desktopLongPressTriggered = false;
      this.desktopTouchStartClientX = touch.clientX | 0;
      this.desktopTouchStartClientY = touch.clientY | 0;
      this.desktopSwipeEligible = true;
    }

    reanchorDesktopSwipe(touch) {
      if (!touch) {
        return;
      }
      this.desktopSwipeStartX = touch.clientX | 0;
      this.desktopSwipeStartY = touch.clientY | 0;
      this.desktopSwipeLastX = touch.clientX | 0;
      this.desktopSwipeLastY = touch.clientY | 0;
      this.desktopSwipeStartMs = Date.now();
    }

    resolveDesktopSwipeDirection(allowLongHold) {
      if (!this.desktopSwipeEligible) {
        return "";
      }
      return resolveSwipeDirection(
        (this.desktopSwipeLastX - this.desktopSwipeStartX) | 0,
        (this.desktopSwipeLastY - this.desktopSwipeStartY) | 0,
        Date.now() - (this.desktopSwipeStartMs || 0),
        !!allowLongHold
      );
    }

    hasDesktopLongPressMoved() {
      return didTouchMoveBeyondTolerance(
        this.desktopTouchStartClientX | 0,
        this.desktopTouchStartClientY | 0,
        this.desktopSwipeLastX | 0,
        this.desktopSwipeLastY | 0,
        TOUCH_LONG_PRESS_MOVE_TOLERANCE
      );
    }

    scheduleDesktopLongPress(event) {
      if (this.desktopLongPressTimer) {
        clearTimeout(this.desktopLongPressTimer);
        this.desktopLongPressTimer = 0;
      }
      if (this.desktopTouchId === null) {
        return;
      }
      const sourceEvent = event || null;
      const targetTouchId = this.desktopTouchId | 0;
      this.desktopLongPressTimer = setTimeout(() => {
        this.desktopLongPressTimer = 0;
        if (
          this.desktopTouchId === null ||
          (this.desktopTouchId | 0) !== targetTouchId ||
          this.desktopPrimaryMouseActive ||
          this.desktopSecondaryMouseActive ||
          this.desktopLongPressTriggered ||
          this.desktopSwipeHeldKey ||
          this.desktopSwipeMouseSuppressed ||
          this.hasDesktopLongPressMoved()
        ) {
          return;
        }
        const touchPoint = {
          clientX: this.desktopSwipeLastX | 0,
          clientY: this.desktopSwipeLastY | 0
        };
        const moveEvent = createSyntheticPointerEvent(sourceEvent, touchPoint, 0, 0);
        const downEvent = createSyntheticPointerEvent(sourceEvent, touchPoint, 0x02, 2);
        this.setActiveProcess(null, { focusShell: false });
        this.forwardDesktopMouseEvent(moveEvent, 0, 0, true, 0, 0);
        this.forwardDesktopMouseEvent(downEvent, 0x02, 0, false, 0, 0);
        this.desktopSecondaryMouseActive = true;
        this.desktopLongPressTriggered = true;
        this.desktopSwipeMouseSuppressed = true;
        this.scheduleDesktopLongPressRelease(sourceEvent, touchPoint);
      }, TOUCH_LONG_PRESS_DELAY_MS);
    }

    scheduleDesktopLongPressRelease(event, touch) {
      if (this.desktopLongPressReleaseTimer) {
        clearTimeout(this.desktopLongPressReleaseTimer);
        this.desktopLongPressReleaseTimer = 0;
      }
      if (!this.desktopSecondaryMouseActive || this.desktopTouchId === null) {
        return;
      }
      const sourceEvent = event || null;
      const point = touch
        ? { clientX: touch.clientX | 0, clientY: touch.clientY | 0 }
        : { clientX: this.desktopSwipeLastX | 0, clientY: this.desktopSwipeLastY | 0 };
      const targetTouchId = this.desktopTouchId | 0;
      this.desktopLongPressReleaseTimer = setTimeout(() => {
        this.desktopLongPressReleaseTimer = 0;
        if (
          !this.desktopSecondaryMouseActive ||
          this.desktopTouchId === null ||
          (this.desktopTouchId | 0) !== targetTouchId
        ) {
          return;
        }
        this.releaseDesktopSecondaryMouse(sourceEvent, point);
      }, TOUCH_LONG_PRESS_RELEASE_DELAY_MS);
    }

    ensureDesktopPrimaryMouseDown(event) {
      if (
        this.desktopPrimaryMouseActive ||
        this.desktopSecondaryMouseActive ||
        this.desktopLongPressTriggered ||
        this.desktopSwipeMouseSuppressed
      ) {
        return false;
      }
      if (this.desktopLongPressTimer) {
        clearTimeout(this.desktopLongPressTimer);
        this.desktopLongPressTimer = 0;
      }
      const downEvent = createSyntheticPointerEvent(
        event,
        {
          clientX: this.desktopTouchStartClientX | 0,
          clientY: this.desktopTouchStartClientY | 0
        },
        0x01,
        0
      );
      this.handleDesktopMouseDown(downEvent);
      this.desktopPrimaryMouseActive = true;
      return true;
    }

    releaseDesktopSecondaryMouse(event, touch) {
      if (!this.desktopSecondaryMouseActive) {
        return false;
      }
      if (this.desktopLongPressReleaseTimer) {
        clearTimeout(this.desktopLongPressReleaseTimer);
        this.desktopLongPressReleaseTimer = 0;
      }
      this.forwardDesktopMouseEvent(createSyntheticPointerEvent(event, touch, 0, 2), 0, 0x02, false, 0, 0);
      this.desktopSecondaryMouseActive = false;
      return true;
    }

    dispatchDesktopPrimaryTap(event, touch) {
      if (this.desktopLongPressTriggered || this.desktopSwipeMouseSuppressed) {
        return false;
      }
      const moveEvent = createSyntheticPointerEvent(
        event,
        {
          clientX: this.desktopTouchStartClientX | 0,
          clientY: this.desktopTouchStartClientY | 0
        },
        0,
        0
      );
      const downEvent = createSyntheticPointerEvent(
        event,
        {
          clientX: this.desktopTouchStartClientX | 0,
          clientY: this.desktopTouchStartClientY | 0
        },
        0x01,
        0
      );
      const upEvent = createSyntheticPointerEvent(event, touch, 0, 0);
      this.handleDesktopMouseMove(moveEvent);
      this.handleDesktopMouseDown(downEvent);
      setTimeout(() => {
        this.handleDesktopMouseUp(upEvent);
      }, TOUCH_LONG_PRESS_RELEASE_DELAY_MS);
      this.desktopPrimaryMouseActive = false;
      return true;
    }

    getSwipeTargetProcess() {
      const desktopTargets = this.getDesktopInputProcesses();
      const active = this.getActiveProcess();
      if (
        active &&
        !active.removed &&
        !active.stopped &&
        active.emulator &&
        desktopTargets.indexOf(active) >= 0
      ) {
        return active;
      }
      if (desktopTargets.length) {
        return desktopTargets[0];
      }
      if (active && !active.removed && !active.stopped && active.emulator) {
        return active;
      }
      return null;
    }

    tapSwipeKey(code) {
      const target = this.getSwipeTargetProcess();
      if (!target || typeof target.tapVirtualKey !== "function") {
        return false;
      }
      return !!target.tapVirtualKey(code);
    }

    releaseDesktopSwipeMouse(event, touch) {
      if (this.desktopSwipeMouseSuppressed) {
        return;
      }
      if (this.desktopLongPressTimer) {
        clearTimeout(this.desktopLongPressTimer);
        this.desktopLongPressTimer = 0;
      }
      if (this.desktopPrimaryMouseActive) {
        this.forwardDesktopMouseEvent(
          createSyntheticPointerEvent(event, touch, 0, 0),
          0,
          0x01,
          false,
          0,
          0
        );
      }
      this.desktopPrimaryMouseActive = false;
      this.desktopSwipeMouseSuppressed = true;
    }

    tryActivateHeldDesktopSwipe(event, touch) {
      const held = this.desktopSwipeHeldKey || "";
      const direction = this.resolveDesktopSwipeDirection(!!held);
      if (!direction) {
        return !!held;
      }
      if (!held) {
        const target = this.getSwipeTargetProcess();
        if (!target || typeof target.pressVirtualKey !== "function") {
          return false;
        }
        this.releaseDesktopSwipeMouse(event, touch);
        if (!target.pressVirtualKey(direction)) {
          return false;
        }
        this.desktopSwipeHeldKey = direction;
        this.desktopSwipeTarget = target;
        this.reanchorDesktopSwipe(touch);
        return true;
      }
      if (direction === held) {
        return true;
      }
      const target = this.desktopSwipeTarget || this.getSwipeTargetProcess();
      if (!target || typeof target.pressVirtualKey !== "function" || typeof target.releaseVirtualKey !== "function") {
        return true;
      }
      target.releaseVirtualKey(held);
      if (!target.pressVirtualKey(direction)) {
        this.desktopSwipeHeldKey = "";
        this.desktopSwipeTarget = target;
        return false;
      }
      this.desktopSwipeHeldKey = direction;
      this.desktopSwipeTarget = target;
      this.reanchorDesktopSwipe(touch);
      return true;
    }

    releaseHeldDesktopSwipeKey() {
      if (!this.desktopSwipeHeldKey) {
        return false;
      }
      const target = this.desktopSwipeTarget || this.getSwipeTargetProcess();
      if (!target || typeof target.releaseVirtualKey !== "function") {
        this.desktopSwipeHeldKey = "";
        this.desktopSwipeTarget = null;
        return false;
      }
      const ok = !!target.releaseVirtualKey(this.desktopSwipeHeldKey);
      this.desktopSwipeHeldKey = "";
      this.desktopSwipeTarget = null;
      return ok;
    }

    beginDesktopTouchCapture(touch) {
      if (!touch) {
        return false;
      }
      this.desktopTouchId = touch.identifier | 0;
      this.beginDesktopSwipeTracking(touch);
      this.recordDesktopTouch(touch);
      document.addEventListener("touchmove", this.boundDesktopTouchMove, { passive: false });
      document.addEventListener("touchend", this.boundDesktopTouchEnd, { passive: false });
      document.addEventListener("touchcancel", this.boundDesktopTouchCancel, { passive: false });
      window.addEventListener("blur", this.boundDesktopBlur);
      return true;
    }

    endDesktopTouchCapture() {
      document.removeEventListener("touchmove", this.boundDesktopTouchMove);
      document.removeEventListener("touchend", this.boundDesktopTouchEnd);
      document.removeEventListener("touchcancel", this.boundDesktopTouchCancel);
      window.removeEventListener("blur", this.boundDesktopBlur);
      this.releaseHeldDesktopSwipeKey();
      this.desktopTouchId = null;
      this.resetDesktopSwipeTracking();
    }

    cancelDesktopTouchCapture() {
      if (this.desktopTouchId === null) {
        return;
      }
      if (this.desktopSecondaryMouseActive) {
        this.forwardDesktopMouseEvent(
          createSyntheticPointerEvent(
            null,
            { clientX: this.desktopTouchClientX, clientY: this.desktopTouchClientY },
            0,
            2
          ),
          0,
          0x02,
          false,
          0,
          0
        );
        this.desktopSecondaryMouseActive = false;
      }
      if (this.desktopPrimaryMouseActive && !this.desktopSwipeMouseSuppressed) {
        this.forwardDesktopMouseEvent(
          createSyntheticPointerEvent(
            null,
            { clientX: this.desktopTouchClientX, clientY: this.desktopTouchClientY },
            0,
            0
          ),
          0,
          0x01,
          false,
          0,
          0
        );
      }
      this.endDesktopTouchCapture();
    }

    handleDesktopTouchStart(event) {
      if (this.desktopTouchId !== null) {
        event.preventDefault();
        return;
      }
      const touch = getRelevantTouch(event, null);
      if (!touch) {
        return;
      }
      this.beginDesktopTouchCapture(touch);
      event.preventDefault();
      this.scheduleDesktopLongPress(event);
    }

    handleDocumentDesktopTouchMove(event) {
      if (this.desktopTouchId === null) {
        return;
      }
      const touch = getRelevantTouch(event, this.desktopTouchId);
      if (!touch) {
        return;
      }
      this.recordDesktopTouch(touch);
      if (this.hasDesktopLongPressMoved() && this.desktopLongPressTimer) {
        clearTimeout(this.desktopLongPressTimer);
        this.desktopLongPressTimer = 0;
      }
      if (this.desktopLongPressTriggered) {
        event.preventDefault();
        return;
      }
      if (this.tryActivateHeldDesktopSwipe(event, touch) || this.desktopSwipeMouseSuppressed) {
        event.preventDefault();
        return;
      }
      if (!this.desktopPrimaryMouseActive && !this.hasDesktopLongPressMoved()) {
        event.preventDefault();
        return;
      }
      this.ensureDesktopPrimaryMouseDown(event);
      this.handleDesktopMouseMove(createSyntheticPointerEvent(event, touch, 0x01, 0));
      event.preventDefault();
    }

    handleDocumentDesktopTouchEnd(event) {
      if (this.desktopTouchId === null) {
        return;
      }
      const touch = getRelevantTouch(event, this.desktopTouchId);
      if (!touch) {
        return;
      }
      this.recordDesktopTouch(touch);
      if (this.desktopLongPressTimer) {
        clearTimeout(this.desktopLongPressTimer);
        this.desktopLongPressTimer = 0;
      }
      if (this.desktopLongPressTriggered) {
        this.releaseDesktopSecondaryMouse(event, touch);
        this.endDesktopTouchCapture();
        event.preventDefault();
        return;
      }
      if (this.desktopSwipeHeldKey) {
        this.releaseHeldDesktopSwipeKey();
        if (this.desktopSwipeMouseSuppressed) {
          this.endDesktopTouchCapture();
          event.preventDefault();
          return;
        }
      }
      const direction = this.resolveDesktopSwipeDirection();
      if (this.desktopPrimaryMouseActive) {
        this.handleDesktopMouseUp(createSyntheticPointerEvent(event, touch, 0, 0));
      } else if (!direction && !this.desktopSwipeMouseSuppressed) {
        this.dispatchDesktopPrimaryTap(event, touch);
      }
      if (direction) {
        this.tapSwipeKey(direction);
      }
      this.endDesktopTouchCapture();
      event.preventDefault();
    }

    handleDocumentDesktopTouchCancel(event) {
      if (this.desktopTouchId === null) {
        return;
      }
      if (this.desktopLongPressTimer) {
        clearTimeout(this.desktopLongPressTimer);
        this.desktopLongPressTimer = 0;
      }
      if (this.desktopSecondaryMouseActive) {
        this.releaseDesktopSecondaryMouse(event, {
          clientX: this.desktopSwipeLastX | 0,
          clientY: this.desktopSwipeLastY | 0
        });
      }
      this.releaseHeldDesktopSwipeKey();
      this.cancelDesktopTouchCapture();
      event.preventDefault();
    }

    syncProcessMousePosition(process, screenX, screenY) {
      const state = this.getProcessMouseState(process, screenX, screenY);
      if (!state || !process || !process.emulator) {
        return;
      }
      if (typeof process.emulator.setMousePosition === "function") {
        process.emulator.setMousePosition(
          state.x | 0,
          state.y | 0,
          !!state.inside,
          state.screenX | 0,
          state.screenY | 0
        );
      } else {
        process.emulator.mouseX = state.x | 0;
        process.emulator.mouseY = state.y | 0;
        process.emulator.mouseScreenX = state.screenX | 0;
        process.emulator.mouseScreenY = state.screenY | 0;
        process.emulator.mouseInside = !!state.inside;
      }
    }

    broadcastMousePosition(screenX, screenY) {
      const x = screenX | 0;
      const y = screenY | 0;
      for (let i = 0; i < this.processes.length; i += 1) {
        this.syncProcessMousePosition(this.processes[i], x, y);
      }
    }

    handleWorkspaceMouseMove(event) {
      const pointer = this.getWorkspacePointerPosition(event);
      this.broadcastMousePosition(pointer.x, pointer.y);
    }

    handleViewportResize() {
      const workAreaChanged = this.clampScreenWorkArea();
      const desktopResized = this.ensureDesktopSurfaceSize();
      let changed = false;
      for (let i = 0; i < this.processes.length; i += 1) {
        const process = this.processes[i];
        if (!process || process.removed) {
          continue;
        }
        if (process.maximized) {
          changed = !!process.syncMaximizedGeometry() || changed;
        }
      }
      if (desktopResized || workAreaChanged) {
        this.redrawDesktopBackground();
        changed = true;
      }
      if (!changed) {
        this.syncDesktopSize();
      }
    }

    nextProcessCoordinates() {
      const index = this.nextCascadeIndex++ | 0;
      return {
        x: 18 + ((index % 10) * CASCADE_STEP_X),
        y: 18 + ((index % 10) * CASCADE_STEP_Y)
      };
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
      const fileProvider = this.app && typeof this.app.getFileProvider === "function"
        ? this.app.getFileProvider()
        : null;
      if (typeof fileProvider !== "function") {
        return existing;
      }
      const bootstrapPath = "/sys/@RESHARE";
      const bootstrapBytes = fileProvider(bootstrapPath);
      if (!bootstrapBytes || !bootstrapBytes.byteLength) {
        return existing;
      }
      this.namedMemoryBootstrapActive = true;
      let bootstrapProcess = null;
      try {
        bootstrapProcess = this.launchPath(bootstrapPath, {
          activate: false,
          allowShellRedirect: false
        });
        this.pumpProcessUntil(bootstrapProcess, () => this.isNamedMemoryAreaReady(key), 256);
      } catch (err) {
        this.app.log(`Shared resource bootstrap failed for ${key}: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        this.namedMemoryBootstrapActive = false;
        if (bootstrapProcess && !bootstrapProcess.removed) {
          bootstrapProcess.stop("stopped");
        }
      }
      return this.sharedNamedMemoryStore.get(key) || existing;
    }

    registerProcess(process) {
      this.processes.push(process);
      this.processBySlot.set(process.slot >>> 0, process);
      this.processByPid.set(process.pid >>> 0, process);
      process.zOrder = this.zCounter++;
      this.applyProcessZOrder(process);
      this.onProcessVisualStateChanged();
    }

    launchImage(image, options) {
      if (!image) {
        throw new Error("No parsed image to launch.");
      }
      const start = this.nextProcessCoordinates();
      const processPath = options && options.processPath
        ? String(options.processPath)
        : (image.fileName || (options && options.fileName) || "image.kex");
      const launch = {
        image,
        buffer: options && options.buffer ? sliceArrayBuffer(options.buffer) : null,
        fileName: options && options.fileName ? String(options.fileName) : (image.fileName || "image.kex"),
        processPath,
        processArgs: options && options.processArgs ? String(options.processArgs) : "",
        displayPath: options && options.displayPath ? String(options.displayPath) : String(processPath),
        pid: this.nextPid++,
        slot: this.nextSlot++,
        groupLeaderPid: 0,
        threadGroupId: 0,
        initialX: start.x,
        initialY: start.y
      };
      launch.groupLeaderPid = launch.pid >>> 0;
      launch.threadGroupId = launch.pid >>> 0;
      const process = new SessionProcess(this, launch);
      process.mount();
      this.registerProcess(process);
      try {
        process.start();
      } catch (err) {
        this.detachProcess(process);
        throw err;
      }
      if (!options || options.activate !== false) {
        this.setActiveProcess(process);
      }
      return process;
    }

    launchPath(path, options) {
      const normalized = normalizeKosPath(path, options && options.baseFolder ? options.baseFolder : "/sys");
      const fileProvider = this.app.getFileProvider();
      if (typeof fileProvider !== "function") {
        throw new Error("No mounted FS root available for application launch.");
      }
      const bytes = fileProvider(normalized);
      if (!bytes || !bytes.byteLength) {
        const err = new Error(`Application not found: ${normalized}`);
        err.code = 5;
        throw err;
      }
      const buffer = sliceArrayBuffer(bytes);
      let image;
      try {
        image = parseKex(buffer, basenameKosPath(normalized));
      } catch (err) {
        if (isShellScriptBytes(bytes)) {
          if (!options || options.allowShellRedirect !== false) {
            return this.launchPath("/sys/SHELL", {
              processArgs: normalized,
              activate: !options || options.activate !== false,
              allowShellRedirect: false
            });
          }
          const shellScript = new Error(`Failed to parse ${normalized}: shell script is not directly executable.`);
          shellScript.code = 31;
          shellScript.shellScript = true;
          throw shellScript;
        }
        const invalid = new Error(`Failed to parse ${normalized}: ${err instanceof Error ? err.message : String(err)}`);
        invalid.code = 31;
        throw invalid;
      }
      return this.launchImage(image, {
        buffer,
        fileName: basenameKosPath(normalized),
        processPath: normalized,
        displayPath: normalized,
        processArgs: options && options.processArgs ? String(options.processArgs) : "",
        activate: !options || options.activate !== false
      });
    }

    createThread(request) {
      const parentSlot = request && request.parentThreadSlot ? (request.parentThreadSlot >>> 0) : 0;
      const parentPid = request && request.parentPid ? (request.parentPid >>> 0) : 0;
      const parent = this.processBySlot.get(parentSlot) || this.processByPid.get(parentPid) || null;
      if (!parent || parent.removed || !parent.emulator || !parent.emulator.cpu) {
        return { tid: 0xffffffff >>> 0 };
      }
      const sharedState = request && request.sharedState ? request.sharedState : null;
      if (!sharedState || !(sharedState.sharedMem instanceof Uint8Array)) {
        return { tid: 0xffffffff >>> 0 };
      }

      const launch = {
        image: request && request.image ? request.image : parent.image,
        buffer: parent.buffer,
        fileName: parent.fileName,
        processPath: request && request.processPath ? String(request.processPath) : parent.processPath,
        processArgs: request && request.processArgs ? String(request.processArgs) : parent.processArgs,
        displayPath: parent.displayPath,
        pid: this.nextPid++,
        slot: this.nextSlot++,
        groupLeaderPid: parent.groupLeaderPid >>> 0,
        threadGroupId: parent.threadGroupId >>> 0,
        threadLaunchSpec: {
          ...sharedState,
          entry: request && request.entry ? (request.entry >>> 0) : 0,
          stack: request && request.stack ? (request.stack >>> 0) : 0
        },
        initialX: parent.actualX + 18,
        initialY: parent.actualY + 18
      };

      const process = new SessionProcess(this, launch);
      process.mount();
      this.registerProcess(process);
      try {
        process.start();
      } catch (err) {
        this.detachProcess(process);
        this.app.log(`CreateThread failed for pid ${parent.pid}: ${err instanceof Error ? err.message : String(err)}`);
        return { tid: 0xffffffff >>> 0 };
      }
      this.setActiveProcess(process);
      return {
        tid: process.pid >>> 0,
        slot: process.slot >>> 0
      };
    }

    startApplication(request) {
      const parentSlot = request && request.parentThreadSlot ? (request.parentThreadSlot >>> 0) : 0;
      const parentPid = request && request.parentPid ? (request.parentPid >>> 0) : 0;
      const hasParentContext = !!(parentSlot || parentPid);
      const parent = this.processBySlot.get(parentSlot) || this.processByPid.get(parentPid) || null;
      const rawPath = request && request.path ? String(request.path) : "";
      const processArgs = request && request.params ? String(request.params) : "";
      if (!rawPath) {
        return { errorCode: 33, pid: 0 };
      }
      if (hasParentContext && (!parent || !parent.emulator)) {
        return { errorCode: 33, pid: 0 };
      }
      const path = parent && parent.emulator && typeof parent.emulator.resolveKosPath === "function"
        ? parent.emulator.resolveKosPath(rawPath)
        : rawPath;
      try {
        const process = this.launchPath(path, {
          processArgs,
          activate: true,
          allowShellRedirect: !hasParentContext
        });
        return {
          errorCode: 0,
          pid: process.pid >>> 0
        };
      } catch (err) {
        const code = err && err.code ? (err.code | 0) : 5;
        if (!(hasParentContext && err && err.shellScript)) {
          this.app.log(`Start app failed for ${path}: ${err instanceof Error ? err.message : String(err)}`);
        }
        return {
          errorCode: Math.max(1, code) >>> 0,
          pid: 0
        };
      }
    }

    applyTraceConfig(config) {
      this.traceConfig = config || {};
      for (let i = 0; i < this.processes.length; i += 1) {
        this.processes[i].applyTraceConfig(this.traceConfig);
      }
    }

    getCpuBackendMode() {
      this.cpuBackendMode = typeof Emulator.normalizeCpuBackendMode === "function"
        ? Emulator.normalizeCpuBackendMode(this.cpuBackendMode)
        : ((() => {
          const normalized = String(this.cpuBackendMode || "").trim().toLowerCase();
          if (normalized === "wasm") {
            return "wasm";
          }
          if (normalized === "auto") {
            return "auto";
          }
          return "js";
        })());
      return this.cpuBackendMode;
    }

    setCpuBackendMode(mode) {
      const previous = this.getCpuBackendMode();
      const next = typeof Emulator.normalizeCpuBackendMode === "function"
        ? Emulator.normalizeCpuBackendMode(mode)
        : ((() => {
          const normalized = String(mode || "").trim().toLowerCase();
          if (normalized === "wasm") {
            return "wasm";
          }
          if (normalized === "auto") {
            return "auto";
          }
          return "js";
        })());
      this.cpuBackendMode = next;
      return {
        mode: next,
        changed: next !== previous,
        hasRunningProcesses: this.hasProcesses()
      };
    }

    refreshSkinThemes() {
      const styleState = this.reloadSystemStyleFromFileSystem();
      let updated = false;
      for (let i = 0; i < this.processes.length; i += 1) {
        updated = this.processes[i].refreshSkinTheme(styleState) || updated;
      }
      if (updated) {
        this.onProcessVisualStateChanged();
      }
      return updated;
    }

    setActiveProcess(process, options) {
      const focusShell = !options || options.focusShell !== false;
      if (process && process.removed) {
        return null;
      }
      if (process && process.minimized) {
        process.setMinimized(false, { notify: false });
      }
      if (this.activeProcess === process) {
        if (process) {
          process.active = true;
          process.rootEl.classList.add("active");
          process.zOrder = this.zCounter++;
          this.applyProcessZOrder(process);
          process.scheduleChromeRender(true);
          if (focusShell) {
            process.focusShell();
          }
        }
        this.onProcessVisualStateChanged();
        return process;
      }
      if (this.activeProcess) {
        this.activeProcess.blurShell();
        this.activeProcess.active = false;
        this.activeProcess.rootEl.classList.remove("active");
        this.activeProcess.scheduleChromeRender(true);
      }
      this.activeProcess = process || null;
      if (this.activeProcess) {
        this.activeProcess.active = true;
        this.activeProcess.rootEl.classList.add("active");
        this.activeProcess.zOrder = this.zCounter++;
        this.applyProcessZOrder(this.activeProcess);
        this.activeProcess.scheduleChromeRender(true);
        if (focusShell) {
          this.activeProcess.focusShell();
        }
      }
      this.onProcessVisualStateChanged();
      return this.activeProcess;
    }

    getActiveProcess() {
      return this.activeProcess && !this.activeProcess.removed ? this.activeProcess : null;
    }

    getWindowStack() {
      return sessionShared.getWindowStack(this.processes);
    }

    getVisibleWindowStack() {
      return sessionShared.getVisibleWindowStack(this.processes);
    }

    getWindowStackPositionSlots() {
      return sessionShared.getWindowStackPositionSlots(this.processes);
    }

    getWindowStackPosition(slot) {
      return sessionShared.getWindowStackPosition(this.processes, slot >>> 0);
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
      if (
        !process ||
        process.removed ||
        process.minimized ||
        !process.displayReady ||
        !process.emulator ||
        !process.emulator.windowDefined
      ) {
        return false;
      }
      const localX = (screenX - (process.actualX | 0)) | 0;
      const localY = (screenY - (process.actualY | 0)) | 0;
      if (
        localX < 0 ||
        localY < 0 ||
        localX >= (process.windowWidth | 0) ||
        localY >= (process.getVisibleHeight() | 0)
      ) {
        return false;
      }
      return process.pointInWindowShape(localX, localY);
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

    getWindowStackSlot(position) {
      return sessionShared.getWindowStackSlot(this.processes, position >>> 0);
    }

    getMaxThreadSlot() {
      return sessionShared.getMaxThreadSlot(this.processes);
    }

    getActiveThreadSlot() {
      return this.activeProcess ? (this.activeProcess.slot >>> 0) : 0;
    }

    getViewportSize() {
      return {
        width: Math.max(
          1,
          (this.workspaceEl && ((this.workspaceEl.clientWidth | 0) || (this.workspaceEl.offsetWidth | 0))) || 1
        ) | 0,
        height: Math.max(
          1,
          (this.workspaceEl && ((this.workspaceEl.clientHeight | 0) || (this.workspaceEl.offsetHeight | 0))) || 1
        ) | 0
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

    getThreadSlotByProcessId(pid) {
      const process = this.processByPid.get(pid >>> 0) || null;
      return process && !process.removed ? (process.slot >>> 0) : 0;
    }

    getThreadInfo(slot) {
      const process = this.processBySlot.get(slot >>> 0) || null;
      if (!process || process.removed) {
        return null;
      }
      return process.toThreadInfo(this.getWindowStackPosition(slot >>> 0));
    }

    normalizeWindowPosition(x, y, width, height) {
      const nextX = x | 0;
      const nextY = y | 0;
      const windowWidth = Math.max(1, width | 0);
      const windowHeight = Math.max(1, height | 0);
      const viewportWidth = Math.max(
        1,
        (this.workspaceEl && ((this.workspaceEl.clientWidth | 0) || (this.workspaceEl.offsetWidth | 0))) || 1
      );
      const viewportHeight = Math.max(
        1,
        (this.workspaceEl && ((this.workspaceEl.clientHeight | 0) || (this.workspaceEl.offsetHeight | 0))) || 1
      );
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
        this.app.log(
          `IPC delivery failed to pid ${targetPid} from ${senderPid}: ${err instanceof Error ? err.message : String(err)}`
        );
        return 1;
      }
    }

    wakeSiblingThreads(slot, forceWake) {
      const source = this.processBySlot.get(slot >>> 0) || null;
      if (!source || source.removed) {
        return;
      }
      sessionShared.wakeSiblingThreads(
        this.processes,
        source.threadGroupId >>> 0,
        source.slot >>> 0,
        !!forceWake
      );
    }

    queueSiblingRedraw(threadGroupId, excludedSlot) {
      sessionShared.queueSiblingRedraw(this.processes, threadGroupId >>> 0, excludedSlot >>> 0);
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
      if (!process) {
        return false;
      }
      const name = basenameKosPath(process.displayPath || process.processPath || process.fileName || "");
      return name.startsWith("@");
    }

    hasTaskbarWindow() {
      return this.processes.some((process) => (
        process &&
        !process.removed &&
        !process.stopped &&
        process.emulator &&
        process.emulator.windowDefined &&
        basenameKosPath(process.displayPath || process.processPath || process.fileName || "").toUpperCase() === "@TASKBAR"
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
      if (!process.setMinimized(true, { notify: false })) {
        return false;
      }
      if (this.activeProcess === process) {
        this.setActiveProcess(next, { focusShell: false });
      } else {
        this.onProcessVisualStateChanged();
      }
      return true;
    }

    restoreProcess(process, options) {
      if (!process || process.removed) {
        return false;
      }
      const activate = !options || options.activate !== false;
      const changed = process.setMinimized(false, { notify: false });
      if (activate) {
        this.setActiveProcess(process, { focusShell: !options || options.focusShell !== false });
        return changed || this.activeProcess === process;
      }
      if (changed) {
        this.onProcessVisualStateChanged();
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
      return this.restoreProcess(process, { activate: false, focusShell: false }) ? 0 : (0xffffffff >>> 0);
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

    requestSystemAction(action) {
      const mode = action >>> 0;
      if (mode !== 2 && mode !== 3 && mode !== 4) {
        return false;
      }
      if (this.app && typeof this.app.handleSystemAction === "function") {
        void this.app.handleSystemAction(mode >>> 0);
        return true;
      }
      this.stopAllProcesses("stopped");
      return true;
    }

    terminateThreadSlot(slot) {
      const process = this.processBySlot.get(slot >>> 0) || null;
      if (!process || process.removed) {
        return false;
      }
      process.stop("terminated");
      return true;
    }

    terminateProcessId(pid) {
      const process = this.processByPid.get(pid >>> 0) || null;
      if (!process || process.removed) {
        return false;
      }
      process.stop("terminated");
      return true;
    }

    stopActiveProcess(reason) {
      const active = this.getActiveProcess();
      if (!active) {
        return false;
      }
      if (active.stopped) {
        this.detachProcess(active);
        return true;
      }
      active.stop(reason || "stopped");
      return true;
    }

    stopAllProcesses(reason) {
      if (!this.processes.length) {
        return false;
      }
      const list = this.processes.slice();
      for (let i = 0; i < list.length; i += 1) {
        if (list[i].removed) {
          continue;
        }
        list[i].stop(reason || "stopped");
      }
      return true;
    }

    hasProcesses() {
      return this.processes.some((process) => !process.removed);
    }

    summaryText() {
      const list = this.processes.filter((process) => !process.removed);
      if (!list.length) {
        return "Session idle";
      }
      const active = this.getActiveProcess();
      const running = list.filter((process) => !process.stopped).length;
      const crashed = list.filter((process) => process.stopped).length;
      let text = `${running} running`;
      if (crashed) {
        text += ` | ${crashed} stopped`;
      }
      if (active) {
        text += ` | active PID ${active.pid} slot ${active.slot}`;
      }
      return text;
    }

    detachProcess(process) {
      if (!process || process.removed) {
        return;
      }
      const threadGroupId = process.threadGroupId >>> 0;
      const slot = process.slot >>> 0;
      this.stopSpeakerPlayback(process.pid >>> 0);
      const index = this.processes.indexOf(process);
      if (index >= 0) {
        this.processes.splice(index, 1);
      }
      this.processBySlot.delete(process.slot >>> 0);
      this.processByPid.delete(process.pid >>> 0);
      if (this.activeProcess === process) {
        this.activeProcess = null;
      }
      process.destroy();
      const next = this.getVisibleWindowStack()[0] || null;
      if (next && !next.active) {
        this.setActiveProcess(next, { focusShell: false });
      } else {
        this.onProcessVisualStateChanged();
      }
      this.queueSiblingRedraw(threadGroupId, slot);
    }

    syncDesktopSize() {
      const viewport = this.getViewportSize();
      let maxRight = viewport.width | 0;
      let maxBottom = viewport.height | 0;
      for (let i = 0; i < this.processes.length; i += 1) {
        const process = this.processes[i];
        if (process.removed || process.minimized || !process.displayReady) {
          continue;
        }
        maxRight = Math.max(maxRight, (process.actualX + process.windowWidth) | 0);
        maxBottom = Math.max(maxBottom, (process.actualY + process.getVisibleHeight()) | 0);
      }
      const resized = this.ensureDesktopSurfaceSize(maxRight, maxBottom);
      this.desktopEl.style.width = `${Math.max(1, maxRight)}px`;
      this.desktopEl.style.height = `${Math.max(1, maxBottom)}px`;
      if (resized) {
        this.redrawDesktopBackground();
      }
    }

    onProcessVisualStateChanged() {
      this.syncDesktopSize();
      if (typeof this.app.updateSessionState === "function") {
        this.app.updateSessionState();
      }
    }
  }

  KosEmu.ui.SessionManager = SessionManager;
})();

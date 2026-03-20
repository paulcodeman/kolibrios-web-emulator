(() => {
  const KosEmu = globalThis.KosEmu;
  const { unpackKpck } = KosEmu.core.loader;
  const { defaultSkinBase64 } = KosEmu.gfx.kolibriSkinAssets;

  const SKIN_MAGIC = 0x4e494b53;
  const MAX_COLOR_TABLE_BYTES = 192;

  const FALLBACK_COLOR_TABLE = (() => {
    const bytes = new Uint8Array(40);
    const view = new DataView(bytes.buffer);
    const colors = [
      0x404040,
      0x2d5d7b,
      0x808080,
      0xc0c0c0,
      0xffffff,
      0xe0e0e0,
      0xd0d0d0,
      0x000000,
      0x000000,
      0x000000
    ];
    for (let i = 0; i < colors.length; i += 1) {
      view.setUint32(i * 4, colors[i] >>> 0, true);
    }
    return bytes;
  })();

  let defaultSkinBytes = null;
  let defaultSkin = null;

  function cloneBytes(source) {
    const src = source instanceof Uint8Array ? source : new Uint8Array(source || 0);
    const out = new Uint8Array(src.length);
    out.set(src);
    return out;
  }

  function readColor(view, offset) {
    return view.getUint32(offset, true) & 0x00ffffff;
  }

  function decodeBase64(base64) {
    const text = String(base64 || "");
    if (!text) {
      return new Uint8Array(0);
    }
    if (typeof atob === "function") {
      const bin = atob(text);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) {
        out[i] = bin.charCodeAt(i) & 0xff;
      }
      return out;
    }
    if (typeof Buffer !== "undefined") {
      return Uint8Array.from(Buffer.from(text, "base64"));
    }
    throw new Error("Base64 decoding is unavailable.");
  }

  function getBitmapSlot(kind) {
    if (kind === 1) {
      return "left";
    }
    if (kind === 2) {
      return "oper";
    }
    if (kind === 3) {
      return "base";
    }
    return "";
  }

  function parseColorTable(bytes) {
    const data = cloneBytes(bytes);
    if (data.length < FALLBACK_COLOR_TABLE.length) {
      const merged = cloneBytes(FALLBACK_COLOR_TABLE);
      merged.set(data);
      return parseColorTable(merged);
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return {
      bytes: data,
      frame: readColor(view, 0),
      grab: readColor(view, 4),
      workDark: readColor(view, 8),
      workLight: readColor(view, 12),
      windowTitle: readColor(view, 16),
      work: readColor(view, 20),
      workButton: readColor(view, 24),
      workButtonText: readColor(view, 28),
      workText: readColor(view, 32),
      workGraph: readColor(view, 36)
    };
  }

  function parseBitmap(bytes, offset) {
    if (offset < 0 || offset + 8 > bytes.length) {
      throw new Error(`Bitmap offset out of range: 0x${offset.toString(16)}`);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(offset, true) >>> 0;
    const height = view.getUint32(offset + 4, true) >>> 0;
    const pixelCount = width * height;
    const dataStart = offset + 8;
    const dataEnd = dataStart + pixelCount * 3;
    if (!width || !height || dataEnd > bytes.length) {
      throw new Error(`Invalid bitmap payload at 0x${offset.toString(16)}`);
    }
    const pixels = new Uint32Array(pixelCount);
    let src = dataStart;
    for (let i = 0; i < pixelCount; i += 1) {
      const b = bytes[src++] & 0xff;
      const g = bytes[src++] & 0xff;
      const r = bytes[src++] & 0xff;
      pixels[i] = ((r << 16) | (g << 8) | b) >>> 0;
    }
    return { width, height, pixels };
  }

  function bufferFrom(input) {
    if (input instanceof ArrayBuffer) {
      return input.slice(0);
    }
    if (input instanceof Uint8Array) {
      return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    }
    if (ArrayBuffer.isView(input)) {
      return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    }
    throw new Error("Skin input must be an ArrayBuffer or typed array.");
  }

  function parseSkinBuffer(input, fileName) {
    const unpacked = unpackKpck(bufferFrom(input));
    const bytes = new Uint8Array(unpacked.buffer);
    const view = new DataView(unpacked.buffer);
    if (bytes.length < 20) {
      throw new Error("Skin file too small.");
    }
    if (view.getUint32(0, true) !== SKIN_MAGIC) {
      throw new Error("Unsupported skin signature.");
    }

    const paramsOffset = view.getUint32(8, true) >>> 0;
    const buttonsOffset = view.getUint32(12, true) >>> 0;
    const bitmapsOffset = view.getUint32(16, true) >>> 0;
    if (paramsOffset + 40 > bytes.length) {
      throw new Error("Skin params block is truncated.");
    }

    const height = view.getUint32(paramsOffset, true) >>> 0;
    const margins = {
      right: view.getUint16(paramsOffset + 4, true) >>> 0,
      left: view.getUint16(paramsOffset + 6, true) >>> 0,
      bottom: view.getUint16(paramsOffset + 8, true) >>> 0,
      top: view.getUint16(paramsOffset + 10, true) >>> 0
    };
    const active = {
      inner: readColor(view, paramsOffset + 12),
      outer: readColor(view, paramsOffset + 16),
      frame: readColor(view, paramsOffset + 20)
    };
    const inactive = {
      inner: readColor(view, paramsOffset + 24),
      outer: readColor(view, paramsOffset + 28),
      frame: readColor(view, paramsOffset + 32)
    };

    const rawColorTableSize = view.getUint32(paramsOffset + 36, true) >>> 0;
    const colorTableSize = Math.min(rawColorTableSize, MAX_COLOR_TABLE_BYTES, Math.max(0, bytes.length - (paramsOffset + 40)));
    const colorTableBytes = cloneBytes(bytes.subarray(paramsOffset + 40, paramsOffset + 40 + colorTableSize));
    const colors = parseColorTable(colorTableBytes);

    const bitmaps = {
      active: { left: null, oper: null, base: null },
      inactive: { left: null, oper: null, base: null }
    };
    for (let offset = bitmapsOffset; offset + 4 <= bytes.length; offset += 8) {
      if (view.getUint32(offset, true) === 0) {
        break;
      }
      if (offset + 8 > bytes.length) {
        break;
      }
      const kind = view.getUint16(offset, true) >>> 0;
      const type = view.getUint16(offset + 2, true) >>> 0;
      const dataOffset = view.getUint32(offset + 4, true) >>> 0;
      const slot = getBitmapSlot(kind);
      if (!slot) {
        continue;
      }
      bitmaps[type ? "active" : "inactive"][slot] = parseBitmap(bytes, dataOffset);
    }

    const buttons = {
      close: null,
      minimize: null
    };
    for (let offset = buttonsOffset; offset + 4 <= bytes.length; offset += 12) {
      if (view.getUint32(offset, true) === 0) {
        break;
      }
      if (offset + 12 > bytes.length) {
        break;
      }
      const type = view.getUint32(offset, true) >>> 0;
      const button = {
        left: view.getInt16(offset + 4, true) | 0,
        top: view.getInt16(offset + 6, true) | 0,
        width: view.getInt16(offset + 8, true) | 0,
        height: view.getInt16(offset + 10, true) | 0
      };
      if (type === 1) {
        buttons.close = button;
      } else if (type === 2) {
        buttons.minimize = button;
      }
    }

    return {
      fileName: fileName || "theme.skn",
      packed: !!unpacked.packed,
      packedSize: unpacked.packedSize >>> 0,
      unpackedSize: unpacked.unpackedSize >>> 0,
      version: view.getUint32(4, true) >>> 0,
      height: Math.max(1, height | 0),
      margins,
      active,
      inactive,
      colors,
      colorTableBytes: colors.bytes,
      bitmaps,
      buttons
    };
  }

  function getDefaultSkinBytes() {
    if (!defaultSkinBytes) {
      defaultSkinBytes = decodeBase64(defaultSkinBase64);
    }
    return cloneBytes(defaultSkinBytes);
  }

  function getDefaultSkin() {
    if (!defaultSkin) {
      defaultSkin = parseSkinBuffer(getDefaultSkinBytes(), "DEFAULT.SKN");
    }
    return defaultSkin;
  }

  KosEmu.gfx.kolibriSkin = {
    FALLBACK_COLOR_TABLE,
    getDefaultSkinBytes,
    getDefaultSkin,
    parseSkinBuffer,
    parseColorTable
  };
})();

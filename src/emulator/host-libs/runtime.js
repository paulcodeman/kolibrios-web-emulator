(() => {
  const KosEmu = globalThis.KosEmu;
  const COFF_HEADER_SIZE = 20;
  const COFF_SECTION_SIZE = 40;
  const COFF_SYMBOL_SIZE = 18;
  const COFF_RELOC_SIZE = 10;
  const UTF8_DECODER = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;
  const UTF8_ENCODER = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
  const HTTP_FLAG_HTTP11 = 1 << 0;
  const HTTP_FLAG_GOT_HEADER = 1 << 1;
  const HTTP_FLAG_GOT_ALL_DATA = 1 << 2;
  const HTTP_FLAG_CONTENT_LENGTH = 1 << 3;
  const HTTP_FLAG_CONNECTED = 1 << 5;
  const HTTP_FLAG_KEEPALIVE = 1 << 8;
  const HTTP_FLAG_SOCKET_ERROR = 1 << 18;
  const HTTP_FLAG_TIMEOUT_ERROR = 1 << 19;
  const HTTP_FLAG_TRANSFER_FAILED = 1 << 20;
  const HOST_HTTP_HEADER_CAPACITY = 8192;
  const HOST_HTTP_DEFAULT_TIMEOUT_MS = 5000;
  const LEGACY_DLL_LOAD_ERROR_LIBRARY_NOT_LOAD = 0x100;
  const LEGACY_DLL_LOAD_ERROR_ENTRY_NOT_FOUND = 0x101;
  const LEGACY_DLL_INIT_MAX_STEPS = 1000000;

  function alignValue(value, alignment) {
    const align = Math.max(1, alignment | 0);
    return Math.ceil((value >>> 0) / align) * align;
  }

  function decodeAsciiZ(bytes, offset, maxLen) {
    let out = "";
    const start = offset >>> 0;
    const limit = Math.max(0, maxLen | 0);
    for (let i = 0; i < limit; i += 1) {
      const value = bytes[start + i] & 0xff;
      if (value === 0) {
        break;
      }
      out += String.fromCharCode(value);
    }
    return out;
  }

  function decodeLatin1(bytes) {
    const source = bytes instanceof Uint8Array ? bytes : null;
    if (!source || !source.length) {
      return "";
    }
    let out = "";
    for (let i = 0; i < source.length; i += 1) {
      out += String.fromCharCode(source[i] & 0xff);
    }
    return out;
  }

  function encodeLatin1(value) {
    const text = String(value || "");
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i += 1) {
      out[i] = text.charCodeAt(i) & 0xff;
    }
    return out;
  }

  function encodeUtf8(value) {
    const text = String(value || "");
    if (UTF8_ENCODER) {
      return UTF8_ENCODER.encode(text);
    }
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i += 1) {
      bytes[i] = text.charCodeAt(i) & 0xff;
    }
    return bytes;
  }

  function trimIniAscii(value) {
    const text = String(value || "");
    let start = 0;
    let end = text.length;
    while (start < end && (text.charCodeAt(start) & 0xff) <= 0x20) {
      start += 1;
    }
    while (end > start && (text.charCodeAt(end - 1) & 0xff) <= 0x20) {
      end -= 1;
    }
    return text.slice(start, end);
  }

  function parseIniText(text) {
    const sections = new Map();
    const source = String(text || "");
    let currentSection = null;
    let offset = 0;
    while (offset <= source.length) {
      let lineEnd = source.indexOf("\n", offset);
      if (lineEnd < 0) {
        lineEnd = source.length;
      }
      let line = source.slice(offset, lineEnd);
      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }
      offset = lineEnd + 1;
      const trimmedStart = trimIniAscii(line);
      if (!trimmedStart || trimmedStart.charCodeAt(0) === 0x3b) {
        continue;
      }
      if (trimmedStart.charCodeAt(0) === 0x5b) {
        const end = trimmedStart.indexOf("]");
        if (end < 0) {
          currentSection = null;
          continue;
        }
        const name = trimIniAscii(trimmedStart.slice(1, end));
        if (!name) {
          currentSection = null;
          continue;
        }
        if (sections.has(name)) {
          currentSection = null;
          continue;
        }
        currentSection = new Map();
        sections.set(name, currentSection);
        continue;
      }
      if (!(currentSection instanceof Map)) {
        continue;
      }
      const equal = trimmedStart.indexOf("=");
      if (equal <= 0) {
        continue;
      }
      const key = trimIniAscii(trimmedStart.slice(0, equal));
      if (!key || currentSection.has(key)) {
        continue;
      }
      const value = trimIniAscii(trimmedStart.slice(equal + 1));
      currentSection.set(key, value);
    }
    return sections;
  }

  function findIniValue(bytes, sectionName, keyName) {
    const source = bytes instanceof Uint8Array ? bytes : null;
    if (!source || !source.length) {
      return null;
    }
    const sections = parseIniText(decodeLatin1(source));
    const section = sections.get(String(sectionName || ""));
    if (!(section instanceof Map)) {
      return null;
    }
    return section.has(String(keyName || "")) ? section.get(String(keyName || "")) : null;
  }

  function parseIniIntString(value) {
    const text = trimIniAscii(value);
    if (!text) {
      return null;
    }
    let index = 0;
    let negative = false;
    if (text.charCodeAt(index) === 0x2d) {
      negative = true;
      index += 1;
    }
    let seenDigit = false;
    let out = 0;
    while (index < text.length) {
      const code = text.charCodeAt(index) & 0xff;
      if (code < 0x30 || code > 0x39) {
        break;
      }
      seenDigit = true;
      out = (((out * 10) | 0) + (code - 0x30)) | 0;
      index += 1;
    }
    if (!seenDigit) {
      return null;
    }
    return negative ? (-out) | 0 : out | 0;
  }

  function parseIniBoolString(value) {
    const text = trimIniAscii(value).toLowerCase();
    if (!text) {
      return null;
    }
    if (
      text === "yes" ||
      text === "true" ||
      text === "enabled" ||
      text === "on" ||
      text === "1"
    ) {
      return 1;
    }
    if (
      text === "no" ||
      text === "false" ||
      text === "disabled" ||
      text === "off" ||
      text === "0"
    ) {
      return 0;
    }
    return null;
  }

  function serializeIniText(sections) {
    if (!(sections instanceof Map) || !sections.size) {
      return "";
    }
    const chunks = [];
    let firstSection = true;
    for (const [sectionName, entries] of sections.entries()) {
      if (!firstSection) {
        chunks.push("\r\n");
      }
      firstSection = false;
      chunks.push(`[${sectionName}]`, "\r\n");
      if (entries instanceof Map) {
        for (const [keyName, value] of entries.entries()) {
          chunks.push(`${keyName}=${String(value || "")}`, "\r\n");
        }
      }
    }
    return chunks.join("");
  }

  function setIniValueBytes(bytes, sectionName, keyName, value) {
    const nextSectionName = trimIniAscii(sectionName);
    const nextKeyName = trimIniAscii(keyName);
    if (!nextSectionName || !nextKeyName) {
      return null;
    }
    const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(0);
    const sections = parseIniText(decodeLatin1(source));
    let section = sections.get(nextSectionName);
    if (!(section instanceof Map)) {
      section = new Map();
      sections.set(nextSectionName, section);
    }
    section.set(nextKeyName, String(value || ""));
    return encodeLatin1(serializeIniText(sections));
  }

  function getPngInflateFn() {
    const root = typeof globalThis !== "undefined" ? globalThis : null;
    const lib = root && root.fflate ? root.fflate : null;
    return lib && typeof lib.unzlibSync === "function" ? lib.unzlibSync : null;
  }

  function concatByteArrays(chunks, totalLength) {
    const total = Math.max(0, totalLength | 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      if (!(chunk instanceof Uint8Array) || !chunk.length) {
        continue;
      }
      const next = Math.min(total, offset + chunk.length);
      merged.set(chunk.subarray(0, next - offset), offset);
      offset = next;
      if (offset >= total) {
        break;
      }
    }
    return merged;
  }

  function getPngChannelCount(colorType) {
    switch (colorType | 0) {
      case 0:
        return 1;
      case 2:
        return 3;
      case 3:
        return 1;
      case 4:
        return 2;
      case 6:
        return 4;
      default:
        return 0;
    }
  }

  function scalePngSample(sample, bitDepth) {
    const depth = bitDepth | 0;
    if (depth <= 0) {
      return 0;
    }
    if (depth === 8) {
      return sample & 0xff;
    }
    if (depth === 16) {
      return (sample >>> 8) & 0xff;
    }
    const maxValue = (1 << depth) - 1;
    return maxValue > 0 ? Math.round(((sample & maxValue) * 255) / maxValue) & 0xff : 0;
  }

  function readPackedPngSample(row, rowOffset, x, bitDepth) {
    const depth = bitDepth | 0;
    if (depth === 8) {
      return row[(rowOffset + x) >>> 0] & 0xff;
    }
    if (depth === 16) {
      const base = (rowOffset + x * 2) >>> 0;
      return (((row[base] & 0xff) << 8) | (row[base + 1] & 0xff)) >>> 0;
    }
    const bitIndex = (x * depth) >>> 0;
    const byteIndex = (rowOffset + (bitIndex >>> 3)) >>> 0;
    const shift = 8 - depth - (bitIndex & 7);
    const mask = (1 << depth) - 1;
    return ((row[byteIndex] >>> shift) & mask) >>> 0;
  }

  function paethPredictor(a, b, c) {
    const p = ((a | 0) + (b | 0) - (c | 0)) | 0;
    const pa = Math.abs(p - (a | 0));
    const pb = Math.abs(p - (b | 0));
    const pc = Math.abs(p - (c | 0));
    if (pa <= pb && pa <= pc) {
      return a & 0xff;
    }
    if (pb <= pc) {
      return b & 0xff;
    }
    return c & 0xff;
  }

  function decodePngToBgra(bytes) {
    const source = bytes instanceof Uint8Array
      ? bytes
      : (ArrayBuffer.isView(bytes)
        ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        : (bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : null));
    if (!source || source.length < 8) {
      return null;
    }
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    for (let i = 0; i < signature.length; i += 1) {
      if ((source[i] & 0xff) !== signature[i]) {
        return null;
      }
    }
    const inflate = getPngInflateFn();
    if (!inflate) {
      return null;
    }
    const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    let interlace = 0;
    let palette = null;
    let transparency = null;
    const idatChunks = [];
    let idatLength = 0;
    while ((offset + 8) <= source.length) {
      const chunkLength = view.getUint32(offset, false) >>> 0;
      const chunkTypeOffset = (offset + 4) >>> 0;
      const dataOffset = (offset + 8) >>> 0;
      const dataEnd = (dataOffset + chunkLength) >>> 0;
      const crcOffset = (dataEnd + 4) >>> 0;
      if (crcOffset > source.length) {
        return null;
      }
      const type =
        String.fromCharCode(source[chunkTypeOffset] & 0xff) +
        String.fromCharCode(source[chunkTypeOffset + 1] & 0xff) +
        String.fromCharCode(source[chunkTypeOffset + 2] & 0xff) +
        String.fromCharCode(source[chunkTypeOffset + 3] & 0xff);
      if (type === "IHDR") {
        if (chunkLength !== 13) {
          return null;
        }
        width = view.getUint32(dataOffset, false) >>> 0;
        height = view.getUint32((dataOffset + 4) >>> 0, false) >>> 0;
        bitDepth = source[dataOffset + 8] & 0xff;
        colorType = source[dataOffset + 9] & 0xff;
        const compression = source[dataOffset + 10] & 0xff;
        const filterMethod = source[dataOffset + 11] & 0xff;
        interlace = source[dataOffset + 12] & 0xff;
        if (!width || !height || compression !== 0 || filterMethod !== 0 || interlace !== 0) {
          return null;
        }
      } else if (type === "PLTE") {
        palette = source.slice(dataOffset, dataEnd);
      } else if (type === "tRNS") {
        transparency = source.slice(dataOffset, dataEnd);
      } else if (type === "IDAT") {
        const chunk = source.subarray(dataOffset, dataEnd);
        idatChunks.push(chunk);
        idatLength = (idatLength + chunk.length) >>> 0;
      } else if (type === "IEND") {
        break;
      }
      offset = crcOffset >>> 0;
    }
    if (!width || !height || !idatChunks.length) {
      return null;
    }
    const channels = getPngChannelCount(colorType);
    if (!channels) {
      return null;
    }
    if ((colorType === 2 || colorType === 4 || colorType === 6) && bitDepth !== 8 && bitDepth !== 16) {
      return null;
    }
    if ((colorType === 0 || colorType === 3) && bitDepth !== 1 && bitDepth !== 2 && bitDepth !== 4 && bitDepth !== 8 && bitDepth !== 16) {
      return null;
    }
    if (colorType === 3 && (!(palette instanceof Uint8Array) || palette.length < 3)) {
      return null;
    }
    const bitsPerPixel = (channels * bitDepth) >>> 0;
    const filterBpp = Math.max(1, Math.ceil(bitsPerPixel / 8)) >>> 0;
    const rowSize = Math.ceil((bitsPerPixel * width) / 8) >>> 0;
    if (!rowSize) {
      return null;
    }
    let inflated;
    try {
      inflated = inflate(concatByteArrays(idatChunks, idatLength));
    } catch (err) {
      return null;
    }
    if (!(inflated instanceof Uint8Array) || inflated.length !== ((rowSize + 1) * height)) {
      return null;
    }
    const rows = new Uint8Array(rowSize * height);
    for (let y = 0; y < height; y += 1) {
      const srcOffset = (y * (rowSize + 1)) >>> 0;
      const dstOffset = (y * rowSize) >>> 0;
      const filter = inflated[srcOffset] & 0xff;
      switch (filter) {
        case 0:
          rows.set(inflated.subarray(srcOffset + 1, srcOffset + 1 + rowSize), dstOffset);
          break;
        case 1:
          for (let i = 0; i < rowSize; i += 1) {
            const left = i >= filterBpp ? (rows[dstOffset + i - filterBpp] & 0xff) : 0;
            rows[dstOffset + i] = ((inflated[srcOffset + 1 + i] & 0xff) + left) & 0xff;
          }
          break;
        case 2:
          for (let i = 0; i < rowSize; i += 1) {
            const up = y > 0 ? (rows[dstOffset + i - rowSize] & 0xff) : 0;
            rows[dstOffset + i] = ((inflated[srcOffset + 1 + i] & 0xff) + up) & 0xff;
          }
          break;
        case 3:
          for (let i = 0; i < rowSize; i += 1) {
            const left = i >= filterBpp ? (rows[dstOffset + i - filterBpp] & 0xff) : 0;
            const up = y > 0 ? (rows[dstOffset + i - rowSize] & 0xff) : 0;
            rows[dstOffset + i] = ((inflated[srcOffset + 1 + i] & 0xff) + ((left + up) >>> 1)) & 0xff;
          }
          break;
        case 4:
          for (let i = 0; i < rowSize; i += 1) {
            const left = i >= filterBpp ? (rows[dstOffset + i - filterBpp] & 0xff) : 0;
            const up = y > 0 ? (rows[dstOffset + i - rowSize] & 0xff) : 0;
            const upLeft = (y > 0 && i >= filterBpp) ? (rows[dstOffset + i - rowSize - filterBpp] & 0xff) : 0;
            rows[dstOffset + i] = ((inflated[srcOffset + 1 + i] & 0xff) + paethPredictor(left, up, upLeft)) & 0xff;
          }
          break;
        default:
          return null;
      }
    }
    const pixelCount = (width * height) >>> 0;
    const pixels = new Uint8Array((pixelCount * 4) >>> 0);
    const indexedPixels = colorType === 3 ? new Uint8Array(pixelCount) : null;
    for (let y = 0; y < height; y += 1) {
      const rowOffset = (y * rowSize) >>> 0;
      for (let x = 0; x < width; x += 1) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 255;
        if (colorType === 6) {
          const base = bitDepth === 16 ? (rowOffset + x * 8) >>> 0 : (rowOffset + x * 4) >>> 0;
          r = rows[base] & 0xff;
          g = rows[base + (bitDepth === 16 ? 2 : 1)] & 0xff;
          b = rows[base + (bitDepth === 16 ? 4 : 2)] & 0xff;
          a = rows[base + (bitDepth === 16 ? 6 : 3)] & 0xff;
        } else if (colorType === 2) {
          const base = bitDepth === 16 ? (rowOffset + x * 6) >>> 0 : (rowOffset + x * 3) >>> 0;
          const redValue = bitDepth === 16 ? (((rows[base] & 0xff) << 8) | (rows[base + 1] & 0xff)) : (rows[base] & 0xff);
          const greenValue = bitDepth === 16
            ? (((rows[base + 2] & 0xff) << 8) | (rows[base + 3] & 0xff))
            : (rows[base + 1] & 0xff);
          const blueValue = bitDepth === 16
            ? (((rows[base + 4] & 0xff) << 8) | (rows[base + 5] & 0xff))
            : (rows[base + 2] & 0xff);
          r = scalePngSample(redValue, bitDepth);
          g = scalePngSample(greenValue, bitDepth);
          b = scalePngSample(blueValue, bitDepth);
          if (transparency && transparency.length >= 6) {
            const tr = (((transparency[0] & 0xff) << 8) | (transparency[1] & 0xff)) >>> 0;
            const tg = (((transparency[2] & 0xff) << 8) | (transparency[3] & 0xff)) >>> 0;
            const tb = (((transparency[4] & 0xff) << 8) | (transparency[5] & 0xff)) >>> 0;
            if (redValue === tr && greenValue === tg && blueValue === tb) {
              a = 0;
            }
          }
        } else if (colorType === 3) {
          const index = readPackedPngSample(rows, rowOffset, x, bitDepth) >>> 0;
          const paletteBase = (index * 3) >>> 0;
          if ((paletteBase + 2) >= palette.length) {
            return null;
          }
          if (indexedPixels) {
            indexedPixels[(y * width + x) >>> 0] = index & 0xff;
          }
          r = palette[paletteBase] & 0xff;
          g = palette[paletteBase + 1] & 0xff;
          b = palette[paletteBase + 2] & 0xff;
          a = transparency && index < transparency.length ? (transparency[index] & 0xff) : 255;
        } else if (colorType === 0) {
          const value = readPackedPngSample(rows, rowOffset, x, bitDepth);
          const gray = scalePngSample(value, bitDepth);
          r = gray;
          g = gray;
          b = gray;
          if (transparency && transparency.length >= 2) {
            const tr = (((transparency[0] & 0xff) << 8) | (transparency[1] & 0xff)) >>> 0;
            if (value === tr) {
              a = 0;
            }
          }
        } else if (colorType === 4) {
          const base = bitDepth === 16 ? (rowOffset + x * 4) >>> 0 : (rowOffset + x * 2) >>> 0;
          const grayValue = bitDepth === 16 ? (((rows[base] & 0xff) << 8) | (rows[base + 1] & 0xff)) : (rows[base] & 0xff);
          const alphaValue = bitDepth === 16 ? (((rows[base + 2] & 0xff) << 8) | (rows[base + 3] & 0xff)) : (rows[base + 1] & 0xff);
          const gray = scalePngSample(grayValue, bitDepth);
          r = gray;
          g = gray;
          b = gray;
          a = scalePngSample(alphaValue, bitDepth);
        } else {
          return null;
        }
        const outBase = ((y * width + x) * 4) >>> 0;
        pixels[outBase] = b & 0xff;
        pixels[outBase + 1] = g & 0xff;
        pixels[outBase + 2] = r & 0xff;
        pixels[outBase + 3] = a & 0xff;
      }
    }
    let paletteBytes = null;
    if (colorType === 3 && palette instanceof Uint8Array) {
      const entryCount = (palette.length / 3) | 0;
      paletteBytes = new Uint8Array((entryCount * 4) >>> 0);
      for (let i = 0; i < entryCount; i += 1) {
        const srcBase = (i * 3) >>> 0;
        const dstBase = (i * 4) >>> 0;
        paletteBytes[dstBase] = palette[srcBase + 2] & 0xff;
        paletteBytes[dstBase + 1] = palette[srcBase + 1] & 0xff;
        paletteBytes[dstBase + 2] = palette[srcBase] & 0xff;
        paletteBytes[dstBase + 3] = transparency && i < transparency.length ? (transparency[i] & 0xff) : 0xff;
      }
    }
    return {
      width: width >>> 0,
      height: height >>> 0,
      pixels,
      colorType: colorType >>> 0,
      indexedPixels,
      paletteBytes
    };
  }

  function getCoffSectionAlignment(characteristics) {
    let shift = (((characteristics >>> 20) & 0x0f) - 1) | 0;
    if (shift < 0 || shift > 12) {
      shift = 12;
    }
    return (1 << shift) >>> 0;
  }

  function readCoffSymbolName(bytes, view, symbolOffset, stringTableOffset, stringTableSize) {
    const zero = view.getUint32(symbolOffset, true) >>> 0;
    if (zero === 0) {
      const nameOffset = view.getUint32((symbolOffset + 4) >>> 0, true) >>> 0;
      if (
        nameOffset >= 4 &&
        stringTableSize >= 4 &&
        nameOffset < stringTableSize &&
        (stringTableOffset + nameOffset) < bytes.length
      ) {
        const maxLen = Math.max(0, (stringTableSize - nameOffset) | 0);
        return decodeAsciiZ(bytes, stringTableOffset + nameOffset, maxLen);
      }
      return "";
    }
    return decodeAsciiZ(bytes, symbolOffset, 8);
  }

  const emu = KosEmu.emu || (KosEmu.emu = {});
  const hostLibHelpers = emu.hostLibHelpers || (emu.hostLibHelpers = {});
  hostLibHelpers.decodePngToBgra = decodePngToBgra;
  hostLibHelpers.findIniValue = findIniValue;
  hostLibHelpers.parseIniIntString = parseIniIntString;
  hostLibHelpers.parseIniBoolString = parseIniBoolString;
  hostLibHelpers.setIniValueBytes = setIniValueBytes;

  function installEmulatorHostLibRuntime(Emulator, shared) {
    if (!Emulator || !Emulator.prototype) {
      throw new Error("installEmulatorHostLibRuntime requires an Emulator class.");
    }
    const { REG, align4k } = shared || {};
    if (!REG || typeof align4k !== "function") {
      throw new Error("installEmulatorHostLibRuntime requires REG and align4k helpers.");
    }

    Object.assign(Emulator.prototype, {
      getHostFetchFailureInfo(url, err) {
        const targetUrl = String(url || "").trim() || "<unknown>";
        const rawMessage = err && err.message !== undefined ? err.message : err;
        const detail = String(rawMessage || "fetch API unavailable").trim() || "fetch API unavailable";
        const lower = detail.toLowerCase();
        const isTimeout = /abort|timeout/i.test(detail);
        const likelyCors = !isTimeout && (
          lower.includes("failed to fetch") ||
          lower.includes("networkerror") ||
          lower.includes("load failed") ||
          lower.includes("cors") ||
          lower.includes("cross-origin") ||
          lower.includes("same-origin")
        );
        let logMessage = `fetch failed for ${targetUrl}: ${detail}`;
        if (likelyCors) {
          logMessage += " (likely browser CORS/cross-origin restriction)";
        }
        return {
          errno: (isTimeout ? 60 : 61) >>> 0,
          isTimeout: !!isTimeout,
          likelyCors: !!likelyCors,
          detail,
          logMessage
        };
      },

      logHostFetchFailure(scope, url, err) {
        if (typeof this.log !== "function") {
          return;
        }
        const info = this.getHostFetchFailureInfo(url, err);
        const prefix = scope ? `${String(scope)}: ` : "";
        this.log(`${prefix}${info.logMessage}`);
      },

      registerHostCallStub(name, argBytes, handler) {
        if (typeof handler !== "function") {
          return 0;
        }
        if (!this.heapEnabled) {
          this.heapInit();
        }
        const ptr = this.heapAllocInternal(16);
        if (!ptr) {
          return 0;
        }
        this.hostCallStubs.set(ptr >>> 0, {
          name: name ? String(name) : "host_stub",
          argBytes: Math.max(0, argBytes | 0) >>> 0,
          handler
        });
        return ptr >>> 0;
      },

      freeHostCallStub(ptr) {
        const addr = ptr >>> 0;
        if (!addr || !(this.hostCallStubs instanceof Map) || !this.hostCallStubs.has(addr)) {
          return false;
        }
        this.hostCallStubs.delete(addr);
        return this.freeHeapBlock(addr >>> 0);
      },

      finishHostIniEnumSections(stateId, eax) {
        const key = stateId >>> 0;
        const states = this.hostIniEnumStates instanceof Map ? this.hostIniEnumStates : null;
        const state = states ? (states.get(key) || null) : null;
        if (state) {
          if (state.secBufPtr) {
            this.freeHeapBlock(state.secBufPtr >>> 0);
          }
          if (state.continuationPtr) {
            this.freeHostCallStub(state.continuationPtr >>> 0);
          }
          states.delete(key);
        }
        return { eax: eax >>> 0 };
      },

      queueHostIniEnumCallback(stateId, callerEsp, finalReturnEip) {
        const key = stateId >>> 0;
        const states = this.hostIniEnumStates instanceof Map ? this.hostIniEnumStates : null;
        const state = states ? (states.get(key) || null) : null;
        if (!state) {
          return { eax: 0xffffffff >>> 0 };
        }
        if ((state.index | 0) >= state.sectionNames.length) {
          return this.finishHostIniEnumSections(key, 0);
        }
        const sectionName = String(state.sectionNames[state.index] || "");
        state.index = ((state.index | 0) + 1) | 0;
        this.writeCString(state.secBufPtr >>> 0, sectionName, Math.max(1, state.secBufSize | 0));
        const frameBaseEsp = callerEsp >>> 0;
        const callbackEsp = (frameBaseEsp - 12) >>> 0;
        // Reuse the original stdcall frame so repeated callbacks do not grow the stack.
        this.writeMem32(callbackEsp >>> 0, state.continuationPtr >>> 0);
        this.writeMem32((callbackEsp + 4) >>> 0, state.filePtr >>> 0);
        this.writeMem32((callbackEsp + 8) >>> 0, state.secBufPtr >>> 0);
        if (finalReturnEip !== undefined) {
          this.writeMem32(frameBaseEsp >>> 0, finalReturnEip >>> 0);
        }
        return {
          esp: callbackEsp >>> 0,
          eip: state.callbackPtr >>> 0
        };
      },

      startHostIniEnumSections(context, filePath, filePtr, callbackPtr) {
        const resolvedPath = filePath ? this.resolveKosPath(filePath) : "";
        const fileBytes = resolvedPath ? this.loadHostFile(resolvedPath) : null;
        if (!(fileBytes instanceof Uint8Array) || !callbackPtr) {
          return { eax: 0xffffffff >>> 0 };
        }
        const sectionNames = Array.from(parseIniText(decodeLatin1(fileBytes)).keys());
        if (!sectionNames.length) {
          return { eax: 0 };
        }
        if (!(this.hostIniEnumStates instanceof Map)) {
          this.hostIniEnumStates = new Map();
        }
        this.nextHostIniEnumStateId = ((this.nextHostIniEnumStateId | 0) + 1) | 0;
        const stateId = this.nextHostIniEnumStateId >>> 0;
        if (!this.heapEnabled) {
          this.heapInit();
        }
        let maxLen = 16;
        for (let i = 0; i < sectionNames.length; i += 1) {
          maxLen = Math.max(maxLen, String(sectionNames[i] || "").length + 1);
        }
        const secBufSize = Math.max(16, maxLen | 0) | 0;
        const secBufPtr = this.heapAllocInternal(secBufSize >>> 0);
        if (!secBufPtr) {
          return { eax: 0xffffffff >>> 0 };
        }
        const continuationPtr = this.registerHostCallStub(`libini:enum_sections#${stateId}`, 8, (continuationContext) => {
          const callbackResult = this.readReg(REG.EAX) >>> 0;
          if (callbackResult && this.hostIniEnumStates instanceof Map && this.hostIniEnumStates.has(stateId >>> 0)) {
            return this.queueHostIniEnumCallback(stateId >>> 0, continuationContext.esp >>> 0, continuationContext.returnEip >>> 0);
          }
          return this.finishHostIniEnumSections(stateId >>> 0, 0);
        });
        if (!continuationPtr) {
          this.freeHeapBlock(secBufPtr >>> 0);
          return { eax: 0xffffffff >>> 0 };
        }
        this.hostIniEnumStates.set(stateId >>> 0, {
          filePtr: filePtr >>> 0,
          callbackPtr: callbackPtr >>> 0,
          sectionNames,
          index: 0,
          secBufPtr: secBufPtr >>> 0,
          secBufSize: secBufSize | 0,
          continuationPtr: continuationPtr >>> 0
        });
        return this.queueHostIniEnumCallback(stateId >>> 0, context.esp >>> 0, context.returnEip >>> 0);
      },

      invokeHostCallStub(eip) {
        if (!this.hostCallStubs || !this.hostCallStubs.size) {
          return false;
        }
        const stub = this.hostCallStubs.get(eip >>> 0);
        if (!stub) {
          return false;
        }
        const esp = this.readReg(REG.ESP) >>> 0;
        const returnEip = this.readMem32(esp) >>> 0;
        const context = {
          eip: eip >>> 0,
          esp,
          returnEip,
          argBytes: stub.argBytes >>> 0,
          argPtr: (esp + 4) >>> 0,
          stub
        };
        let result = null;
        try {
          result = stub.handler.call(this, context) || null;
        } catch (err) {
          this.log(`Host call '${stub.name}' failed: ${err}`);
          this.running = false;
          return true;
        }
        if (result && result.eax !== undefined) {
          this.writeReg(REG.EAX, result.eax >>> 0);
        }
        if (result && result.edx !== undefined) {
          this.writeReg(REG.EDX, result.edx >>> 0);
        }
        if (!result || result.esp === undefined) {
          this.writeReg(REG.ESP, (esp + 4 + (stub.argBytes >>> 0)) >>> 0);
        } else {
          this.writeReg(REG.ESP, result.esp >>> 0);
        }
        if (!result || result.eip === undefined) {
          this.writeReg(REG.EIP, returnEip >>> 0);
        } else {
          this.writeReg(REG.EIP, result.eip >>> 0);
        }
        return true;
      },

      createHostDllExportTable(key, exports) {
        const cacheKey = String(key || "").toLowerCase();
        if (cacheKey && this.loadedHostLibraries.has(cacheKey)) {
          return this.loadedHostLibraries.get(cacheKey) >>> 0;
        }
        if (!this.heapEnabled) {
          this.heapInit();
        }
        const items = Array.isArray(exports) ? exports : [];
        if (!items.length) {
          return 0;
        }
        const namePtrs = new Array(items.length);
        for (let i = 0; i < items.length; i += 1) {
          const item = items[i] || {};
          const name = item.name ? String(item.name) : "";
          const namePtr = this.heapAllocInternal(Math.max(4, name.length + 1));
          if (!namePtr) {
            return 0;
          }
          this.writeCString(namePtr, name, name.length + 1);
          namePtrs[i] = namePtr >>> 0;
        }
        const tablePtr = this.heapAllocInternal((items.length + 1) * 8);
        if (!tablePtr) {
          return 0;
        }
        for (let i = 0; i < items.length; i += 1) {
          const item = items[i] || {};
          let value = item.value >>> 0;
          if (typeof item.handler === "function") {
            value = this.registerHostCallStub(item.name, item.argBytes | 0, item.handler);
          }
          this.writeMem32((tablePtr + i * 8) >>> 0, namePtrs[i] >>> 0);
          this.writeMem32((tablePtr + i * 8 + 4) >>> 0, value >>> 0);
        }
        this.writeMem32((tablePtr + items.length * 8) >>> 0, 0);
        this.writeMem32((tablePtr + items.length * 8 + 4) >>> 0, 0);
        if (cacheKey) {
          this.loadedHostLibraries.set(cacheKey, tablePtr >>> 0);
        }
        return tablePtr >>> 0;
      },

      getHostDllCandidatePaths(path) {
        const raw = this.sanitizeKosPath(path);
        if (!raw) {
          return [];
        }
        const candidates = [raw];
        if (!raw.includes("/")) {
          candidates.push(`/sys/lib/${raw}`);
        }
        return candidates.filter((item, index) => candidates.indexOf(item) === index);
      },

      loadRegisteredHostDll(path) {
        const emu = KosEmu && KosEmu.emu ? KosEmu.emu : null;
        const resolver = emu && typeof emu.resolveHostDllModuleFactory === "function"
          ? emu.resolveHostDllModuleFactory
          : null;
        if (!resolver) {
          return 0;
        }
        const factory = resolver(path);
        if (typeof factory !== "function") {
          return 0;
        }
        const resolvedPath = this.resolveKosPath(path);
        try {
          const result = factory.call(this, {
            requestPath: String(path || ""),
            resolvedPath
          });
          if (!result) {
            return 0;
          }
          if (typeof result === "number" && Number.isFinite(result)) {
            return result >>> 0;
          }
          if (Array.isArray(result)) {
            return this.createHostDllExportTable(resolvedPath, result) >>> 0;
          }
          if (result && Array.isArray(result.exports)) {
            const cacheKey = result.cacheKey ? String(result.cacheKey) : resolvedPath;
            return this.createHostDllExportTable(cacheKey, result.exports) >>> 0;
          }
          if (result && result.exportPtr !== undefined) {
            return result.exportPtr >>> 0;
          }
        } catch (err) {
          this.log(`Host DLL '${resolvedPath || path}' failed: ${err}`);
        }
        return 0;
      },

      loadHostDllExportTable(path) {
        const candidates = this.getHostDllCandidatePaths(path);
        for (let i = 0; i < candidates.length; i += 1) {
          const candidate = candidates[i];
          const hostDll = this.loadBuiltInHostDll(candidate);
          if (hostDll) {
            return {
              path: this.resolveKosPath(candidate),
              exportPtr: hostDll >>> 0
            };
          }
          const loaded = this.loadCoffLibrary(candidate);
          if (loaded && loaded.exportPtr) {
            if (typeof this.applyHostLibraryOverrides === "function") {
              this.applyHostLibraryOverrides(loaded);
            }
            if (!loaded.path) {
              loaded.path = this.resolveKosPath(candidate);
            }
            return loaded;
          }
        }
        return null;
      },

      findHostDllExport(exportPtr, nameOrOrdinal) {
        const tablePtr = exportPtr >>> 0;
        if (!tablePtr) {
          return 0;
        }
        if (typeof nameOrOrdinal === "number" && Number.isFinite(nameOrOrdinal)) {
          return 0;
        }
        const wanted = String(nameOrOrdinal || "");
        if (!wanted) {
          return 0;
        }
        const maxEntries = 4096;
        for (let i = 0; i < maxEntries; i += 1) {
          const namePtr = this.readMem32((tablePtr + i * 8) >>> 0) >>> 0;
          if (!namePtr) {
            break;
          }
          const value = this.readMem32((tablePtr + i * 8 + 4) >>> 0) >>> 0;
          if (!value) {
            continue;
          }
          if (this.readCString(namePtr, 256) === wanted) {
            return value >>> 0;
          }
        }
        return 0;
      },

      findHostDllExportValueSlot(exportPtr, nameOrOrdinal) {
        const tablePtr = exportPtr >>> 0;
        if (!tablePtr) {
          return 0;
        }
        if (typeof nameOrOrdinal === "number" && Number.isFinite(nameOrOrdinal)) {
          return 0;
        }
        const wanted = String(nameOrOrdinal || "");
        if (!wanted) {
          return 0;
        }
        const maxEntries = 4096;
        for (let i = 0; i < maxEntries; i += 1) {
          const namePtr = this.readMem32((tablePtr + i * 8) >>> 0) >>> 0;
          if (!namePtr) {
            break;
          }
          const valueSlot = (tablePtr + i * 8 + 4) >>> 0;
          const value = this.readMem32(valueSlot) >>> 0;
          if (!value) {
            continue;
          }
          if (this.readCString(namePtr, 256) === wanted) {
            return valueSlot >>> 0;
          }
        }
        return 0;
      },

      readHostDllExportEntry(exportPtr, index) {
        const tablePtr = exportPtr >>> 0;
        const entryIndex = index | 0;
        if (!tablePtr || entryIndex < 0) {
          return null;
        }
        const entryPtr = (tablePtr + entryIndex * 8) >>> 0;
        const namePtr = this.readMem32(entryPtr >>> 0) >>> 0;
        if (!namePtr) {
          return null;
        }
        return {
          entryPtr: entryPtr >>> 0,
          namePtr: namePtr >>> 0,
          name: this.readCString(namePtr >>> 0, 256),
          value: this.readMem32((entryPtr + 4) >>> 0) >>> 0
        };
      },

      legacyDllReallocInternal(ptr, size) {
        if (!this.heapEnabled) {
          this.heapInit();
        }
        const oldPtr = ptr >>> 0;
        const sizeReq = size >>> 0;
        if (!oldPtr) {
          if (!sizeReq) {
            return 0;
          }
          const allocSize = typeof this.alignProcessHeapSize === "function"
            ? this.alignProcessHeapSize(sizeReq >>> 0)
            : (((sizeReq >>> 0) + 15) & ~15) >>> 0;
          return allocSize ? (this.heapAllocInternal(allocSize >>> 0) >>> 0) : 0;
        }
        if (!sizeReq) {
          this.freeHeapBlock(oldPtr >>> 0);
          return 0;
        }
        const oldSize = this.heapAllocs instanceof Map && this.heapAllocs.has(oldPtr >>> 0)
          ? (this.heapAllocs.get(oldPtr >>> 0) >>> 0)
          : 0;
        const newSize = typeof this.alignProcessHeapSize === "function"
          ? this.alignProcessHeapSize(sizeReq >>> 0)
          : (((sizeReq >>> 0) + 15) & ~15) >>> 0;
        if (oldSize && newSize <= oldSize) {
          return oldPtr >>> 0;
        }
        const newPtr = this.heapAllocInternal(newSize >>> 0);
        if (!newPtr) {
          return 0;
        }
        const copySize = oldSize ? Math.min(oldSize >>> 0, newSize >>> 0) >>> 0 : 0;
        if (copySize) {
          const bytes = this.readMemBlock(oldPtr >>> 0, copySize >>> 0);
          if (bytes instanceof Uint8Array && bytes.length === (copySize >>> 0)) {
            this.writeMemBlock(newPtr >>> 0, bytes);
          }
        }
        this.freeHeapBlock(oldPtr >>> 0);
        return newPtr >>> 0;
      },

      ensureLegacyDllRuntimeSupport() {
        const cached = this.legacyDllRuntimeSupport || null;
        if (
          cached &&
          (cached.allocPtr >>> 0) &&
          (cached.freePtr >>> 0) &&
          (cached.reallocPtr >>> 0) &&
          (cached.loadPtr >>> 0)
        ) {
          return cached;
        }
        const support = {};
        support.allocPtr = this.registerHostCallStub("dll:mem.Alloc", 4, (context) => {
          const sizeReq = this.readMem32(context.argPtr >>> 0) >>> 0;
          const allocSize = typeof this.alignProcessHeapSize === "function"
            ? this.alignProcessHeapSize(sizeReq >>> 0)
            : (((sizeReq >>> 0) + 15) & ~15) >>> 0;
          const ptr = allocSize ? (this.heapAllocInternal(allocSize >>> 0) >>> 0) : 0;
          return { eax: ptr >>> 0 };
        });
        support.freePtr = this.registerHostCallStub("dll:mem.Free", 4, (context) => {
          const ptr = this.readMem32(context.argPtr >>> 0) >>> 0;
          this.freeHeapBlock(ptr >>> 0);
          return { eax: 0 };
        });
        support.reallocPtr = this.registerHostCallStub("dll:mem.ReAlloc", 8, (context) => {
          const ptr = this.readMem32(context.argPtr >>> 0) >>> 0;
          const sizeReq = this.readMem32((context.argPtr + 4) >>> 0) >>> 0;
          return { eax: this.legacyDllReallocInternal(ptr >>> 0, sizeReq >>> 0) >>> 0 };
        });
        support.loadPtr = this.registerHostCallStub("dll:Load", 4, (context) => {
          const importTablePtr = this.readMem32(context.argPtr >>> 0) >>> 0;
          const result = this.linkLegacyImportTable(importTablePtr >>> 0, { source: "dll.load" });
          return { eax: result && result.errorCode !== undefined ? (result.errorCode >>> 0) : 1 };
        });
        this.legacyDllRuntimeSupport = support;
        return support;
      },

      runEmulatedStdcall(entryPtr, registers, options) {
        const targetEip = entryPtr >>> 0;
        if (!this.cpu || !targetEip) {
          return { ok: false, eax: 1 };
        }
        const opts = options || {};
        const savedRegs = new Uint32Array(this.cpu.regs);
        const savedRunning = !!this.running;
        const savedYieldRequested = !!this.yieldRequested;
        const savedYieldDelay = this.yieldDelay | 0;
        const savedYieldMode = this.yieldMode || "";
        const savedRepeatCurrentInstruction = !!this.repeatCurrentInstruction;
        const savedLastEip = this.lastEip >>> 0;
        const savedStopReason = this.lastStopReason || "";
        const savedStopEventEmitted = !!this.stopEventEmitted;
        let completionEax = 0;
        let completed = false;
        const completionStub = this.registerHostCallStub(opts.name || "dll:init:return", 0, () => {
          completionEax = this.readReg(REG.EAX) >>> 0;
          completed = true;
          return { eax: completionEax >>> 0 };
        });
        if (!completionStub) {
          return { ok: false, eax: 1 };
        }
        const savedEsp = savedRegs[REG.ESP] >>> 0;
        const callEsp = (savedEsp - 8) >>> 0;
        this.writeMem32(callEsp >>> 0, completionStub >>> 0);
        this.writeMem32((callEsp + 4) >>> 0, 0);
        this.writeReg(REG.EAX, registers && registers.eax !== undefined ? (registers.eax >>> 0) : 0);
        this.writeReg(REG.EBX, registers && registers.ebx !== undefined ? (registers.ebx >>> 0) : 0);
        this.writeReg(REG.ECX, registers && registers.ecx !== undefined ? (registers.ecx >>> 0) : 0);
        this.writeReg(REG.EDX, registers && registers.edx !== undefined ? (registers.edx >>> 0) : 0);
        this.writeReg(REG.ESI, registers && registers.esi !== undefined ? (registers.esi >>> 0) : 0);
        this.writeReg(REG.EDI, registers && registers.edi !== undefined ? (registers.edi >>> 0) : 0);
        this.writeReg(REG.EBP, registers && registers.ebp !== undefined ? (registers.ebp >>> 0) : 0);
        this.writeReg(REG.ESP, callEsp >>> 0);
        this.writeReg(REG.EIP, targetEip >>> 0);
        this.running = true;
        this.yieldRequested = false;
        this.yieldDelay = 0;
        this.yieldMode = "";
        this.repeatCurrentInstruction = false;
        let ok = true;
        const maxSteps = opts.maxSteps !== undefined
          ? Math.max(1, opts.maxSteps | 0)
          : LEGACY_DLL_INIT_MAX_STEPS;
        let steps = 0;
        while (steps < maxSteps && this.running && !completed) {
          const eip = this.readReg(REG.EIP) >>> 0;
          this.lastEip = eip >>> 0;
          if (this.syscallSiteSet && this.syscallSiteSet.has(eip >>> 0)) {
            this.repeatCurrentInstruction = false;
            this.handleSyscall();
            if (!this.repeatCurrentInstruction) {
              this.writeReg(REG.EIP, (eip + 2) >>> 0);
            }
            this.repeatCurrentInstruction = false;
            steps += 1;
            continue;
          }
          if (this.softInstructions && this.handleSoftInstruction(eip >>> 0)) {
            steps += 1;
            continue;
          }
          if (this.invokeHostCallStub && this.invokeHostCallStub(eip >>> 0)) {
            steps += 1;
            continue;
          }
          const b0 = this.readMem8(eip >>> 0);
          const b1 = this.readMem8((eip + 1) >>> 0);
          if (b0 === 0xcd && b1 === 0x40) {
            this.repeatCurrentInstruction = false;
            this.handleSyscall();
            if (!this.repeatCurrentInstruction) {
              this.writeReg(REG.EIP, (eip + 2) >>> 0);
            }
            this.repeatCurrentInstruction = false;
            steps += 1;
            continue;
          }
          if (!this.executeBasicInstruction(eip >>> 0)) {
            if (this.handleUnknownOpcodeAt && this.handleUnknownOpcodeAt(eip >>> 0)) {
              steps += 1;
              continue;
            }
            ok = false;
            break;
          }
          steps += 1;
        }
        if (!completed) {
          ok = false;
        }
        this.freeHostCallStub(completionStub >>> 0);
        this.cpu.regs.set(savedRegs);
        this.running = savedRunning;
        this.yieldRequested = savedYieldRequested;
        this.yieldDelay = savedYieldDelay;
        this.yieldMode = savedYieldMode;
        this.repeatCurrentInstruction = savedRepeatCurrentInstruction;
        this.lastEip = savedLastEip >>> 0;
        this.lastStopReason = savedStopReason;
        this.stopEventEmitted = savedStopEventEmitted;
        return {
          ok: !!ok,
          eax: completionEax >>> 0,
          steps: steps >>> 0
        };
      },

      initializeLoadedHostDll(loaded) {
        const info = loaded || null;
        if (!info || !info.exportPtr) {
          return { ok: true, errorCode: 0 };
        }
        if (info.initState === 1) {
          return { ok: true, errorCode: 0 };
        }
        if (info.initState === 2) {
          return { ok: false, errorCode: info.initErrorCode >>> 0 };
        }
        if (info.initState === 3) {
          return { ok: true, errorCode: 0 };
        }
        const entry = this.readHostDllExportEntry(info.exportPtr >>> 0, 0);
        if (!entry || entry.name !== "lib_init" || !entry.value) {
          info.initState = 1;
          info.initErrorCode = 0;
          return { ok: true, errorCode: 0 };
        }
        const support = this.ensureLegacyDllRuntimeSupport();
        info.initState = 3;
        const result = this.runEmulatedStdcall(entry.value >>> 0, {
          eax: support.allocPtr >>> 0,
          ebx: support.freePtr >>> 0,
          ecx: support.reallocPtr >>> 0,
          edx: support.loadPtr >>> 0
        }, {
          name: `dll:init:${info.path || "<dll>"}`
        });
        if (result && result.ok && (result.eax >>> 0) === 0) {
          info.initState = 1;
          info.initErrorCode = 0;
          return { ok: true, errorCode: 0 };
        }
        info.initState = 2;
        info.initErrorCode = result && result.eax !== undefined ? (result.eax >>> 0) : 1;
        if (this.traceSyscalls) {
          this.log(
            `DLL init failed for '${info.path || "<dll>"}': eax=0x${(info.initErrorCode >>> 0).toString(16)}`
          );
        }
        return { ok: false, errorCode: info.initErrorCode >>> 0 };
      },

      linkLegacyImportTable(importsPtr, options) {
        const rootPtr = importsPtr >>> 0;
        const opts = options || {};
        if (!rootPtr) {
          return { ok: true, errorCode: 0, libraryCount: 0, symbolCount: 0 };
        }
        let descriptorPtr = rootPtr >>> 0;
        let libraryCount = 0;
        let symbolCount = 0;
        const maxDescriptors = 256;
        const sourceLabel = opts.source ? String(opts.source) : "legacy import";
        for (let descriptorIndex = 0; descriptorIndex < maxDescriptors; descriptorIndex += 1) {
          const importTablePtr = this.readMem32(descriptorPtr >>> 0) >>> 0;
          if (!importTablePtr) {
            return {
              ok: true,
              errorCode: 0,
              libraryCount: libraryCount >>> 0,
              symbolCount: symbolCount >>> 0
            };
          }
          const libraryNamePtr = this.readMem32((descriptorPtr + 4) >>> 0) >>> 0;
          const libraryName = libraryNamePtr ? this.readCString(libraryNamePtr, 260) : "";
          if (!libraryName) {
            return {
              ok: false,
              errorCode: 1,
              message: `${sourceLabel} descriptor at 0x${descriptorPtr.toString(16)} has no library name.`
            };
          }
          const loaded = this.loadHostDllExportTable(libraryName);
          if (!loaded || !loaded.exportPtr) {
            return {
              ok: false,
              errorCode: LEGACY_DLL_LOAD_ERROR_LIBRARY_NOT_LOAD,
              message: `${sourceLabel} library '${libraryName}' could not be loaded.`
            };
          }
          let slotPtr = importTablePtr >>> 0;
          const maxSymbols = 4096;
          for (let symbolIndex = 0; symbolIndex < maxSymbols; symbolIndex += 1) {
            const token = this.readMem32(slotPtr >>> 0) >>> 0;
            if (!token) {
              break;
            }
            let resolved = 0;
            let label = "";
            if ((token & 0x80000000) !== 0) {
              const ordinal = token & 0x7fffffff;
              label = `#${ordinal}`;
              resolved = this.findHostDllExport(loaded.exportPtr >>> 0, ordinal);
            } else {
              label = this.readCString(token >>> 0, 260);
              resolved = this.findHostDllExport(loaded.exportPtr >>> 0, label);
            }
            if (!resolved) {
              return {
                ok: false,
                errorCode: LEGACY_DLL_LOAD_ERROR_ENTRY_NOT_FOUND,
                message: `${sourceLabel} import '${label}' from '${loaded.path || libraryName}' could not be resolved.`
              };
            }
            this.writeMem32(slotPtr >>> 0, resolved >>> 0);
            slotPtr = (slotPtr + 4) >>> 0;
            symbolCount += 1;
          }
          const initResult = this.initializeLoadedHostDll(loaded);
          if (!initResult.ok) {
            return {
              ok: false,
              errorCode: initResult.errorCode >>> 0,
              message: `${sourceLabel} failed to initialize '${loaded.path || libraryName}'.`
            };
          }
          descriptorPtr = (descriptorPtr + 8) >>> 0;
          libraryCount += 1;
        }
        return {
          ok: false,
          errorCode: 1,
          message: `${sourceLabel} table at 0x${rootPtr.toString(16)} exceeded descriptor limit.`
        };
      },

      continueAtOriginalDllExport(context) {
        const originalEip = context && context.originalEip ? (context.originalEip >>> 0) : 0;
        if (!originalEip) {
          return { eax: 0 };
        }
        return {
          eip: originalEip >>> 0,
          esp: context && context.esp !== undefined ? (context.esp >>> 0) : 0
        };
      },

      allocateHostLibimgImage(width, height, bgraBytes) {
        const w = Math.max(1, width | 0);
        const h = Math.max(1, height | 0);
        const pixels = bgraBytes instanceof Uint8Array ? bgraBytes : null;
        const pixelSize = pixels ? (pixels.length >>> 0) : 0;
        if (!pixels || pixelSize !== ((w * h * 4) >>> 0)) {
          return 0;
        }
        if (!this.heapEnabled) {
          this.heapInit();
        }
        const imagePtr = this.heapAllocInternal(44);
        const dataPtr = this.heapAllocInternal(pixelSize);
        if (!imagePtr || !dataPtr) {
          return 0;
        }
        this.writeMemBlock(dataPtr >>> 0, pixels);
        for (let i = 0; i < 44; i += 4) {
          this.writeMem32((imagePtr + i) >>> 0, 0);
        }
        const firstPixel =
          pixelSize >= 4
            ? (
              (pixels[0] & 0xff) |
              ((pixels[1] & 0xff) << 8) |
              ((pixels[2] & 0xff) << 16) |
              ((pixels[3] & 0xff) << 24)
            ) >>> 0
            : 0;
        const checksum = ((((w & 0xffff) << 16) | (h & 0xffff)) ^ firstPixel) >>> 0;
        this.writeMem32(imagePtr >>> 0, checksum >>> 0);
        this.writeMem32((imagePtr + 4) >>> 0, w >>> 0);
        this.writeMem32((imagePtr + 8) >>> 0, h >>> 0);
        this.writeMem32((imagePtr + 20) >>> 0, 3);
        this.writeMem32((imagePtr + 24) >>> 0, dataPtr >>> 0);
        if (!(this.hostLibimgImages instanceof Map)) {
          this.hostLibimgImages = new Map();
        }
        this.hostLibimgImages.set(imagePtr >>> 0, {
          type: 3,
          width: w >>> 0,
          height: h >>> 0,
          dataPtr: dataPtr >>> 0,
          byteLength: pixelSize >>> 0
        });
        return imagePtr >>> 0;
      },

      allocateHostLibimgIndexedImage(width, height, indexBytes, paletteBytes) {
        const w = Math.max(1, width | 0);
        const h = Math.max(1, height | 0);
        const pixels = indexBytes instanceof Uint8Array ? indexBytes : null;
        const palette = paletteBytes instanceof Uint8Array ? paletteBytes : null;
        const pixelSize = pixels ? (pixels.length >>> 0) : 0;
        const paletteSize = palette ? (palette.length >>> 0) : 0;
        if (!pixels || pixelSize !== ((w * h) >>> 0) || !palette || !paletteSize || (paletteSize & 3) !== 0) {
          return 0;
        }
        if (!this.heapEnabled) {
          this.heapInit();
        }
        const imagePtr = this.heapAllocInternal(44);
        const dataPtr = this.heapAllocInternal(pixelSize);
        const palettePtr = this.heapAllocInternal(paletteSize);
        if (!imagePtr || !dataPtr || !palettePtr) {
          return 0;
        }
        this.writeMemBlock(dataPtr >>> 0, pixels);
        this.writeMemBlock(palettePtr >>> 0, palette);
        for (let i = 0; i < 44; i += 4) {
          this.writeMem32((imagePtr + i) >>> 0, 0);
        }
        const firstEntry = this.readMem32(palettePtr >>> 0) >>> 0;
        const checksum = ((((w & 0xffff) << 16) | (h & 0xffff)) ^ firstEntry) >>> 0;
        this.writeMem32(imagePtr >>> 0, checksum >>> 0);
        this.writeMem32((imagePtr + 4) >>> 0, w >>> 0);
        this.writeMem32((imagePtr + 8) >>> 0, h >>> 0);
        this.writeMem32((imagePtr + 20) >>> 0, 1);
        this.writeMem32((imagePtr + 24) >>> 0, dataPtr >>> 0);
        this.writeMem32((imagePtr + 28) >>> 0, palettePtr >>> 0);
        if (!(this.hostLibimgImages instanceof Map)) {
          this.hostLibimgImages = new Map();
        }
        this.hostLibimgImages.set(imagePtr >>> 0, {
          type: 1,
          width: w >>> 0,
          height: h >>> 0,
          dataPtr: dataPtr >>> 0,
          byteLength: pixelSize >>> 0,
          palettePtr: palettePtr >>> 0,
          paletteLength: paletteSize >>> 0
        });
        return imagePtr >>> 0;
      },

      allocateHostRawImage(width, height, bgraBytes) {
        const w = Math.max(1, width | 0);
        const h = Math.max(1, height | 0);
        const pixels = bgraBytes instanceof Uint8Array ? bgraBytes : null;
        const pixelSize = pixels ? (pixels.length >>> 0) : 0;
        if (!pixels || pixelSize !== ((w * h * 4) >>> 0)) {
          return 0;
        }
        if (!this.heapEnabled) {
          this.heapInit();
        }
        const rawPtr = this.heapAllocInternal((44 + pixelSize) >>> 0);
        if (!rawPtr) {
          return 0;
        }
        for (let i = 0; i < 44; i += 4) {
          this.writeMem32((rawPtr + i) >>> 0, 0);
        }
        this.writeMem32(rawPtr >>> 0, 0x20574152);
        this.writeMem32((rawPtr + 4) >>> 0, w >>> 0);
        this.writeMem32((rawPtr + 8) >>> 0, h >>> 0);
        this.writeMem32((rawPtr + 12) >>> 0, 32);
        this.writeMem16((rawPtr + 16) >>> 0, 8);
        this.writeMem16((rawPtr + 18) >>> 0, 4);
        this.writeMem32((rawPtr + 28) >>> 0, 44);
        this.writeMem32((rawPtr + 32) >>> 0, pixelSize >>> 0);
        this.writeMemBlock((rawPtr + 44) >>> 0, pixels);
        return rawPtr >>> 0;
      },
      ensureHostHttpTransfers() {
        if (!(this.hostHttpTransfers instanceof Map)) {
          this.hostHttpTransfers = new Map();
        }
        return this.hostHttpTransfers;
      },

      allocateHeapCStringUtf8(value) {
        if (!this.heapEnabled) {
          this.heapInit();
        }
        const bytes = encodeUtf8(String(value || ""));
        const ptr = this.heapAllocInternal((bytes.length + 1) >>> 0);
        if (!ptr) {
          return 0;
        }
        if (bytes.length) {
          this.writeMemBlock(ptr >>> 0, bytes);
        }
        this.writeMem8((ptr + bytes.length) >>> 0, 0);
        return ptr >>> 0;
      },

      createHostHttpTransfer(method, url, flags, addHeader, options) {
        if (!this.heapEnabled) {
          this.heapInit();
        }
        const methodName = String(method || "GET").toUpperCase();
        const requestedFlags = flags >>> 0;
        const transferSize = (44 + HOST_HTTP_HEADER_CAPACITY + 1) >>> 0;
        const transferPtr = this.heapAllocInternal(transferSize);
        if (!transferPtr) {
          return 0;
        }
        this.writeMemBlock(transferPtr >>> 0, new Uint8Array(transferSize));
        this.writeMem32((transferPtr + 4) >>> 0, requestedFlags >>> 0);
        const state = {
          ptr: transferPtr >>> 0,
          method: methodName,
          url: String(url || ""),
          requestedFlags: requestedFlags >>> 0,
          addHeader: String(addHeader || ""),
          contentType: options && options.contentType ? String(options.contentType) : "",
          expectedContentLength: options && options.contentLength !== undefined ? (options.contentLength >>> 0) : 0,
          headerCapacity: HOST_HTTP_HEADER_CAPACITY >>> 0,
          headerText: "",
          started: false,
          active: true,
          settled: false,
          completed: false,
          pendingResult: null,
          timeoutId: 0,
          controller: null,
          requestChunks: [],
          requestLength: 0,
          contentPtr: 0
        };
        this.ensureHostHttpTransfers().set(transferPtr >>> 0, state);
        if (methodName !== "POST") {
          this.startHostHttpTransfer(state);
        }
        return transferPtr >>> 0;
      },

      concatHostHttpChunks(chunks, totalLength) {
        const size = totalLength >>> 0;
        if (!size) {
          return new Uint8Array(0);
        }
        const out = new Uint8Array(size);
        let offset = 0;
        for (let i = 0; i < chunks.length; i += 1) {
          const chunk = chunks[i];
          if (!(chunk instanceof Uint8Array) || !chunk.length) {
            continue;
          }
          out.set(chunk, offset >>> 0);
          offset = (offset + chunk.length) >>> 0;
        }
        return out;
      },

      parseHostHttpHeaders(rawHeader) {
        const text = String(rawHeader || "");
        const headers = {};
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i];
          if (!line) {
            continue;
          }
          const colon = line.indexOf(":");
          if (colon <= 0) {
            continue;
          }
          const name = line.slice(0, colon).trim();
          const value = line.slice(colon + 1).trim();
          if (!name) {
            continue;
          }
          headers[name] = value;
        }
        return headers;
      },

      buildHostHttpHeaderText(response) {
        if (!response) {
          return "";
        }
        const statusCode = response.status >>> 0;
        const statusText = response.statusText ? ` ${response.statusText}` : "";
        const lines = [`HTTP/1.1 ${statusCode}${statusText}`];
        if (response.headers && typeof response.headers.forEach === "function") {
          response.headers.forEach((value, name) => {
            lines.push(`${name}: ${value}`);
          });
        }
        return `${lines.join("\r\n")}\r\n\r\n`;
      },

      completeHostHttpTransfer(state, result) {
        if (!state || !state.active || state.completed) {
          return;
        }
        const pending = result || {};
        const transferPtr = state.ptr >>> 0;
        if (!transferPtr) {
          return;
        }
        const headerText = String(pending.headerText || "");
        const headerBytesFull = encodeUtf8(headerText);
        const headerBytes = headerBytesFull.subarray(0, Math.min(headerBytesFull.length, state.headerCapacity >>> 0));
        const contentBytes = pending.contentBytes instanceof Uint8Array ? pending.contentBytes : new Uint8Array(0);
        let contentPtr = 0;
        if (state.contentPtr) {
          this.freeHeapBlock(state.contentPtr >>> 0);
          state.contentPtr = 0;
        }
        if (contentBytes.length) {
          contentPtr = this.heapAllocInternal(contentBytes.length >>> 0);
          if (!contentPtr) {
            this.writeMem32((transferPtr + 4) >>> 0, (state.requestedFlags | HTTP_FLAG_TRANSFER_FAILED) >>> 0);
            state.completed = true;
            return;
          }
          this.writeMemBlock(contentPtr >>> 0, contentBytes);
          state.contentPtr = contentPtr >>> 0;
        }
        for (let i = 0; i <= state.headerCapacity; i += 1) {
          this.writeMem8((transferPtr + 44 + i) >>> 0, 0);
        }
        if (headerBytes.length) {
          this.writeMemBlock((transferPtr + 44) >>> 0, headerBytes);
        }
        this.writeMem32(transferPtr >>> 0, 0);
        this.writeMem32((transferPtr + 4) >>> 0, (pending.flags >>> 0));
        this.writeMem32((transferPtr + 24) >>> 0, (pending.status >>> 0));
        this.writeMem32((transferPtr + 28) >>> 0, (headerBytes.length >>> 0));
        this.writeMem32((transferPtr + 32) >>> 0, (contentPtr >>> 0));
        this.writeMem32((transferPtr + 36) >>> 0, (pending.contentLength >>> 0));
        this.writeMem32((transferPtr + 40) >>> 0, (pending.contentReceived >>> 0));
        state.headerText = headerText;
        state.completed = true;
      },

      settleHostHttpTransferError(state, errorFlags) {
        if (!state || !state.active) {
          return;
        }
        state.pendingResult = {
          flags: (state.requestedFlags | (errorFlags >>> 0)) >>> 0,
          status: 0,
          headerText: "",
          contentBytes: new Uint8Array(0),
          contentLength: 0,
          contentReceived: 0
        };
        state.settled = true;
        this.notifyHostHttpTransferReady(state);
      },

      notifyHostHttpTransferReady(state) {
        if (!state || !state.active) {
          return;
        }
        this.queueEvent(8);
        this.wakeExecution(true);
        if (typeof this.wakeHostSiblingThreads === "function") {
          this.wakeHostSiblingThreads(true);
        }
      },

      startHostHttpTransfer(state) {
        if (!state || state.started || !state.active) {
          return;
        }
        state.started = true;
        const fetchImpl = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null;
        if (!fetchImpl || !state.url) {
          this.logHostFetchFailure("host-http", state ? state.url : "", !fetchImpl ? "fetch API unavailable" : "empty URL");
          this.settleHostHttpTransferError(state, HTTP_FLAG_SOCKET_ERROR | HTTP_FLAG_TRANSFER_FAILED);
          return;
        }
        const headers = this.parseHostHttpHeaders(state.addHeader);
        if (state.contentType && headers["Content-Type"] === undefined && headers["content-type"] === undefined) {
          headers["Content-Type"] = state.contentType;
        }
        const bodyBytes = state.method === "POST"
          ? this.concatHostHttpChunks(state.requestChunks, state.requestLength >>> 0)
          : new Uint8Array(0);
        const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        if (controller) {
          state.controller = controller;
        }
        if (typeof setTimeout === "function") {
          state.timeoutId = setTimeout(() => {
            if (!state.active || state.settled) {
              return;
            }
            if (state.controller && typeof state.controller.abort === "function") {
              try {
                state.controller.abort();
              } catch (_) {
                // Ignore abort failures and still surface timeout.
              }
            }
            this.settleHostHttpTransferError(state, HTTP_FLAG_TIMEOUT_ERROR | HTTP_FLAG_TRANSFER_FAILED);
          }, HOST_HTTP_DEFAULT_TIMEOUT_MS);
        }
        const fetchOptions = {
          method: state.method,
          headers
        };
        if (controller) {
          fetchOptions.signal = controller.signal;
        }
        if (state.method === "POST") {
          fetchOptions.body = bodyBytes;
        }
        Promise.resolve(fetchImpl(state.url, fetchOptions)).then(async (response) => {
          if (!state.active || state.settled) {
            return;
          }
          const headerText = this.buildHostHttpHeaderText(response);
          const body = state.method === "HEAD"
            ? new Uint8Array(0)
            : new Uint8Array(await response.arrayBuffer());
          if (!state.active || state.settled) {
            return;
          }
          let flags = (state.requestedFlags | HTTP_FLAG_GOT_HEADER | HTTP_FLAG_GOT_ALL_DATA | HTTP_FLAG_CONNECTED) >>> 0;
          let contentLength = body.length >>> 0;
          if (response.headers && typeof response.headers.get === "function") {
            const contentLengthText = response.headers.get("content-length");
            const parsedLength = contentLengthText ? parseInt(contentLengthText, 10) : NaN;
            if (Number.isFinite(parsedLength) && parsedLength >= 0) {
              contentLength = parsedLength >>> 0;
              flags |= HTTP_FLAG_CONTENT_LENGTH;
            } else if (body.length) {
              flags |= HTTP_FLAG_CONTENT_LENGTH;
            }
          } else if (body.length) {
            flags |= HTTP_FLAG_CONTENT_LENGTH;
          }
          state.pendingResult = {
            flags: flags >>> 0,
            status: response.status >>> 0,
            headerText,
            contentBytes: body,
            contentLength: contentLength >>> 0,
            contentReceived: body.length >>> 0
          };
          state.settled = true;
          this.notifyHostHttpTransferReady(state);
        }).catch((err) => {
          if (!state.active || state.settled) {
            return;
          }
          const info = this.getHostFetchFailureInfo(state.url, err);
          this.logHostFetchFailure("host-http", state.url, err);
          const timeoutFlags = info.isTimeout
            ? (HTTP_FLAG_TIMEOUT_ERROR | HTTP_FLAG_TRANSFER_FAILED)
            : (HTTP_FLAG_SOCKET_ERROR | HTTP_FLAG_TRANSFER_FAILED);
          this.settleHostHttpTransferError(state, timeoutFlags >>> 0);
        });
      },

      receiveHostHttpTransfer(transferPtr) {
        const transfers = this.ensureHostHttpTransfers();
        const state = transfers.get(transferPtr >>> 0) || null;
        if (!state || !state.active) {
          return 0;
        }
        if (!state.started) {
          this.startHostHttpTransfer(state);
        }
        if (state.settled && !state.completed) {
          if (state.timeoutId) {
            clearTimeout(state.timeoutId);
            state.timeoutId = 0;
          }
          this.completeHostHttpTransfer(state, state.pendingResult);
        }
        return state.completed ? 0 : (0xffffffff >>> 0);
      },

      sendHostHttpTransfer(transferPtr, dataPtr, dataLength) {
        const transfers = this.ensureHostHttpTransfers();
        const state = transfers.get(transferPtr >>> 0) || null;
        const size = dataLength >>> 0;
        if (!state || !state.active) {
          return 0xffffffff >>> 0;
        }
        if (!size) {
          return 0;
        }
        const bytes = this.readMemBlock(dataPtr >>> 0, size);
        if (!(bytes instanceof Uint8Array) || bytes.length !== size) {
          return 0xffffffff >>> 0;
        }
        state.requestChunks.push(new Uint8Array(bytes));
        state.requestLength = (state.requestLength + size) >>> 0;
        return size >>> 0;
      },

      disconnectHostHttpTransfer(transferPtr) {
        const transfers = this.ensureHostHttpTransfers();
        const state = transfers.get(transferPtr >>> 0) || null;
        if (!state) {
          return 0;
        }
        state.active = false;
        if (state.timeoutId) {
          clearTimeout(state.timeoutId);
          state.timeoutId = 0;
        }
        if (state.controller && typeof state.controller.abort === "function") {
          try {
            state.controller.abort();
          } catch (_) {
            // Ignore abort failures during teardown.
          }
        }
        return 0;
      },

      freeHostHttpTransfer(transferPtr) {
        const transfers = this.ensureHostHttpTransfers();
        const state = transfers.get(transferPtr >>> 0) || null;
        if (!state) {
          return 0;
        }
        this.disconnectHostHttpTransfer(transferPtr >>> 0);
        if (state.contentPtr) {
          this.freeHeapBlock(state.contentPtr >>> 0);
          state.contentPtr = 0;
        }
        this.freeHeapBlock(state.ptr >>> 0);
        transfers.delete(transferPtr >>> 0);
        return 0;
      },

      findHostHttpHeaderField(transferPtr, fieldName) {
        const transfers = this.ensureHostHttpTransfers();
        const state = transfers.get(transferPtr >>> 0) || null;
        if (!state || !state.completed || !state.headerText) {
          return 0;
        }
        const wanted = String(fieldName || "").trim().toLowerCase();
        if (!wanted) {
          return 0;
        }
        const lines = state.headerText.split("\r\n");
        let offset = 0;
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i];
          const lowerLine = line.toLowerCase();
          if (lowerLine.startsWith(`${wanted}:`)) {
            let valueOffset = wanted.length + 1;
            while (valueOffset < line.length) {
              const code = line.charCodeAt(valueOffset) & 0xff;
              if (code !== 0x20 && code !== 0x09) {
                break;
              }
              valueOffset += 1;
            }
            return (state.ptr + 44 + offset + valueOffset) >>> 0;
          }
          offset = (offset + line.length + 2) >>> 0;
        }
        return 0;
      },

      transformHostHttpUri(value, mode) {
        const text = String(value || "");
        try {
          return mode === "unescape" ? decodeURIComponent(text) : encodeURIComponent(text);
        } catch (_) {
          return text;
        }
      },

      applyHostDllOverrideSet(loaded, key, definitions) {
        if (!loaded || !loaded.exportPtr || !Array.isArray(definitions) || !definitions.length) {
          return;
        }
        if (!(loaded.hostOverrideSet instanceof Set)) {
          loaded.hostOverrideSet = new Set();
        }
        if (loaded.hostOverrideSet.has(key)) {
          return;
        }
        for (let i = 0; i < definitions.length; i += 1) {
          const def = definitions[i] || {};
          const name = def.name ? String(def.name) : "";
          if (!name || typeof def.handler !== "function") {
            continue;
          }
          const valueSlot = this.findHostDllExportValueSlot(loaded.exportPtr >>> 0, name);
          if (!valueSlot) {
            if (this.traceSyscalls) {
              this.log(`host override '${key}:${name}' missing in '${loaded.path || "<dll>"}'`);
            }
            continue;
          }
          const originalEip = this.readMem32(valueSlot) >>> 0;
          const stubPtr = this.registerHostCallStub(`${key}:${name}`, def.argBytes | 0, (context) => (
            def.handler.call(this, {
              eip: context.eip >>> 0,
              esp: context.esp >>> 0,
              returnEip: context.returnEip >>> 0,
              argBytes: context.argBytes >>> 0,
              argPtr: context.argPtr >>> 0,
              originalEip: originalEip >>> 0
            })
          ));
          if (stubPtr) {
            this.writeMem32(valueSlot >>> 0, stubPtr >>> 0);
            if (this.traceSyscalls) {
              this.log(`host override '${key}:${name}' applied to '${loaded.path || "<dll>"}'`);
            }
          }
        }
        loaded.hostOverrideSet.add(key);
      },

      applyHostLibraryOverrides(loaded) {
        if (!loaded || !loaded.exportPtr) {
          return;
        }
        const resolver = emu && typeof emu.resolveHostDllOverrideFactories === "function"
          ? emu.resolveHostDllOverrideFactories
          : null;
        if (!resolver) {
          return;
        }
        const factories = resolver(loaded.path || "");
        for (let i = 0; i < factories.length; i += 1) {
          const factory = factories[i];
          try {
            factory.call(this, loaded);
          } catch (err) {
            this.log(`Host DLL override for '${loaded.path || "<dll>"}' failed: ${err}`);
          }
        }
      },

      resolveKxImports() {
        if (!this.cpu || !this.image || !this.image.header || !this.image.header.kx) {
          return true;
        }
        const importsPtr = this.image.header.kx.importsPtr >>> 0;
        if (!importsPtr) {
          return true;
        }
        const result = this.linkLegacyImportTable(importsPtr >>> 0, { source: "KX import" });
        if (!result || !result.ok) {
          this.log(
            result && result.message
              ? result.message
              : `KX import table at 0x${importsPtr.toString(16)} could not be resolved.`
          );
          return false;
        }
        if (this.traceSyscalls) {
          this.log(
            `Resolved KX imports: ${result.libraryCount >>> 0} libraries, ${result.symbolCount >>> 0} symbols.`
          );
        }
        return true;
      },

      loadBuiltInHostDll(path) {
        return this.loadRegisteredHostDll(path) >>> 0;
      },
      loadCoffLibrary(path) {
        const resolvedPath = this.resolveKosPath(path);
        const cacheKey = resolvedPath.toLowerCase();
        if (cacheKey && this.loadedDllLibraries.has(cacheKey)) {
          const cached = this.loadedDllLibraries.get(cacheKey) || null;
          if (cached && cached.exportPtr && typeof this.applyHostLibraryOverrides === "function") {
            this.applyHostLibraryOverrides(cached);
          }
          return cached;
        }
        const rawData = this.loadHostFile(resolvedPath);
        if (!rawData || !rawData.length) {
          return null;
        }
        const data = this.maybeUnpackHostFile(rawData, resolvedPath);
        if (!data || data.length < COFF_HEADER_SIZE) {
          return null;
        }
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const optionalHeaderSize = view.getUint16(16, true) >>> 0;
        const sectionCount = view.getUint16(2, true) >>> 0;
        const sectionTableOffset = (COFF_HEADER_SIZE + optionalHeaderSize) >>> 0;
        const symbolTableOffset = view.getUint32(8, true) >>> 0;
        const symbolCount = view.getUint32(12, true) >>> 0;
        const stringTableOffset = (symbolTableOffset + symbolCount * COFF_SYMBOL_SIZE) >>> 0;
        let stringTableSize = 0;
        if (stringTableOffset + 4 <= data.length) {
          stringTableSize = view.getUint32(stringTableOffset, true) >>> 0;
        }
        if (
          !sectionCount ||
          sectionTableOffset + sectionCount * COFF_SECTION_SIZE > data.length ||
          symbolTableOffset > data.length
        ) {
          return null;
        }

        const sections = [];
        let imageSize = 0;
        for (let i = 0; i < sectionCount; i += 1) {
          const offset = (sectionTableOffset + i * COFF_SECTION_SIZE) >>> 0;
          const sizeOfRawData = view.getUint32((offset + 16) >>> 0, true) >>> 0;
          const ptrRawData = view.getUint32((offset + 20) >>> 0, true) >>> 0;
          const ptrReloc = view.getUint32((offset + 24) >>> 0, true) >>> 0;
          const numReloc = view.getUint16((offset + 32) >>> 0, true) >>> 0;
          const characteristics = view.getUint32((offset + 36) >>> 0, true) >>> 0;
          const alignment = getCoffSectionAlignment(characteristics);
          imageSize = alignValue(imageSize, alignment);
          sections.push({
            offset,
            rva: imageSize >>> 0,
            sizeOfRawData,
            ptrRawData,
            ptrReloc,
            numReloc
          });
          imageSize = (imageSize + sizeOfRawData) >>> 0;
        }
        if (!imageSize) {
          return null;
        }
        if (!this.heapEnabled) {
          this.heapInit();
        }
        const allocSize = align4k(imageSize);
        const ptr = this.heapAllocInternal(allocSize);
        if (!ptr) {
          return null;
        }

        for (let i = 0; i < sections.length; i += 1) {
          const section = sections[i];
          if (!section.sizeOfRawData) {
            continue;
          }
          if (!section.ptrRawData || section.ptrRawData + section.sizeOfRawData > data.length) {
            continue;
          }
          const slice = data.subarray(section.ptrRawData, section.ptrRawData + section.sizeOfRawData);
          this.writeMemBlock((ptr + section.rva) >>> 0, slice);
        }

        const symbols = new Array(symbolCount);
        for (let i = 0; i < symbolCount; i += 1) {
          const offset = (symbolTableOffset + i * COFF_SYMBOL_SIZE) >>> 0;
          if (offset + COFF_SYMBOL_SIZE > data.length) {
            break;
          }
          const value = view.getUint32((offset + 8) >>> 0, true) >>> 0;
          const sectionNumber = view.getInt16((offset + 12) >>> 0, true);
          let absoluteValue = value >>> 0;
          if (sectionNumber > 0 && sectionNumber <= sections.length) {
            absoluteValue = (ptr + sections[sectionNumber - 1].rva + value) >>> 0;
          } else if (sectionNumber === 0) {
            absoluteValue = 0;
          }
          symbols[i] = {
            name: readCoffSymbolName(data, view, offset, stringTableOffset, stringTableSize),
            absoluteValue
          };
        }

        let exportsPtr = 0;
        for (let i = 0; i < symbols.length; i += 1) {
          const symbol = symbols[i];
          if (!symbol) {
            continue;
          }
          if (symbol.name === "EXPORTS" || symbol.name === "_EXPORTS") {
            exportsPtr = symbol.absoluteValue >>> 0;
            break;
          }
        }
        if (!exportsPtr) {
          return null;
        }

        for (let i = 0; i < sections.length; i += 1) {
          const section = sections[i];
          if (!section.numReloc || !section.ptrReloc) {
            continue;
          }
          for (let j = 0; j < section.numReloc; j += 1) {
            const offset = (section.ptrReloc + j * COFF_RELOC_SIZE) >>> 0;
            if (offset + COFF_RELOC_SIZE > data.length) {
              break;
            }
            const targetRva = view.getUint32(offset, true) >>> 0;
            const symbolIndex = view.getUint32((offset + 4) >>> 0, true) >>> 0;
            const type = view.getUint16((offset + 8) >>> 0, true) >>> 0;
            const symbol = symbols[symbolIndex] || null;
            const symbolValue = symbol ? (symbol.absoluteValue >>> 0) : 0;
            const target = (ptr + section.rva + targetRva) >>> 0;
            if (type === 6) {
              const value = this.readMem32(target) >>> 0;
              this.writeMem32(target, (value + symbolValue) >>> 0);
            } else if (type === 20) {
              const value = this.readMem32(target) | 0;
              const relValue = (symbolValue - ((target + 4) >>> 0)) | 0;
              this.writeMem32(target, (value + relValue) >>> 0);
            }
          }
        }

        const loaded = {
          path: resolvedPath,
          ptr: ptr >>> 0,
          size: imageSize >>> 0,
          exportPtr: exportsPtr >>> 0
        };
        if (cacheKey) {
          this.loadedDllLibraries.set(cacheKey, loaded);
        }
        if (loaded.exportPtr && typeof this.applyHostLibraryOverrides === "function") {
          this.applyHostLibraryOverrides(loaded);
        }
        if (this.traceSyscalls) {
          this.log(
            `load dll '${resolvedPath}' -> image=0x${loaded.ptr.toString(16)} exports=0x${loaded.exportPtr.toString(16)}`
          );
        }
        return loaded;
      },
    });
  }

  emu.installEmulatorHostLibRuntime = installEmulatorHostLibRuntime;
})();

(() => {
  const KosEmu = globalThis.KosEmu;

  function makeKeyboardLayout(pairs) {
    const layout = new Uint8Array(128);
    for (let i = 0; i < pairs.length; i += 1) {
      const item = pairs[i];
      layout[item[0] & 0x7f] = item[1] & 0xff;
    }
    return layout;
  }

  const KEYBOARD_LAYOUT_NORMAL = makeKeyboardLayout([
    [0x01, 27],
    [0x02, 49], [0x03, 50], [0x04, 51], [0x05, 52], [0x06, 53],
    [0x07, 54], [0x08, 55], [0x09, 56], [0x0a, 57], [0x0b, 48],
    [0x0c, 45], [0x0d, 61], [0x0e, 8], [0x0f, 9],
    [0x10, 113], [0x11, 119], [0x12, 101], [0x13, 114], [0x14, 116],
    [0x15, 121], [0x16, 117], [0x17, 105], [0x18, 111], [0x19, 112],
    [0x1a, 91], [0x1b, 93], [0x1c, 13],
    [0x1e, 97], [0x1f, 115], [0x20, 100], [0x21, 102], [0x22, 103],
    [0x23, 104], [0x24, 106], [0x25, 107], [0x26, 108],
    [0x27, 59], [0x28, 39], [0x29, 96],
    [0x2b, 92],
    [0x2c, 122], [0x2d, 120], [0x2e, 99], [0x2f, 118], [0x30, 98],
    [0x31, 110], [0x32, 109], [0x33, 44], [0x34, 46], [0x35, 47],
    [0x37, 42], [0x39, 32],
    [0x47, 55], [0x48, 56], [0x49, 57], [0x4a, 45],
    [0x4b, 52], [0x4c, 53], [0x4d, 54], [0x4e, 43],
    [0x4f, 49], [0x50, 50], [0x51, 51], [0x52, 48], [0x53, 46]
  ]);

  const KEYBOARD_LAYOUT_SHIFT = makeKeyboardLayout([
    [0x01, 27],
    [0x02, 33], [0x03, 64], [0x04, 35], [0x05, 36], [0x06, 37],
    [0x07, 94], [0x08, 38], [0x09, 42], [0x0a, 40], [0x0b, 41],
    [0x0c, 95], [0x0d, 43], [0x0e, 8], [0x0f, 9],
    [0x10, 81], [0x11, 87], [0x12, 69], [0x13, 82], [0x14, 84],
    [0x15, 89], [0x16, 85], [0x17, 73], [0x18, 79], [0x19, 80],
    [0x1a, 123], [0x1b, 125], [0x1c, 13],
    [0x1e, 65], [0x1f, 83], [0x20, 68], [0x21, 70], [0x22, 71],
    [0x23, 72], [0x24, 74], [0x25, 75], [0x26, 76],
    [0x27, 58], [0x28, 34], [0x29, 126],
    [0x2b, 124],
    [0x2c, 90], [0x2d, 88], [0x2e, 67], [0x2f, 86], [0x30, 66],
    [0x31, 78], [0x32, 77], [0x33, 60], [0x34, 62], [0x35, 63],
    [0x37, 42], [0x39, 32],
    [0x47, 55], [0x48, 56], [0x49, 57], [0x4a, 45],
    [0x4b, 52], [0x4c, 53], [0x4d, 54], [0x4e, 43],
    [0x4f, 49], [0x50, 50], [0x51, 51], [0x52, 48], [0x53, 46]
  ]);

  const KEYBOARD_LAYOUT_ALT = KEYBOARD_LAYOUT_NORMAL.slice();
  const KEYBOARD_LANGUAGE_ID = 1;
  const UTF8_ENCODER = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
  const UTF8_DECODER = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;
  const FILE_API_DISPATCH = Object.freeze({
    0: "sysFileRead",
    1: "sysFileReadDir",
    2: "sysFileCreate",
    3: "sysFileWrite",
    4: "sysFileSetEnd",
    5: "sysFileGetInfo",
    6: "sysFileSetInfo",
    7: "sysFileStartApp",
    8: "sysFileDelete",
    9: "sysFileCreateFolder",
    10: "sysFileRenameMove"
  });

  function unpackSignedHigh16(value) {
    return (value >> 16) | 0;
  }

  function unpackSignedLow16(value) {
    return ((value & 0xffff) << 16) >> 16;
  }

  function unpackSurfaceColor(value) {
    const packed = value >>> 0;
    return ((((packed & 0xff) << 16) | (packed & 0xff00) | ((packed >>> 16) & 0xff)) >>> 0);
  }

  function writeFsTime(view, offset, ms) {
    if (!Number.isFinite(ms) || ms <= 0) {
      view.setUint32(offset, 0, true);
      return;
    }
    const date = new Date(ms);
    if (!Number.isFinite(date.getTime())) {
      view.setUint32(offset, 0, true);
      return;
    }
    view.setUint8(offset, date.getSeconds() & 0xff);
    view.setUint8(offset + 1, date.getMinutes() & 0xff);
    view.setUint8(offset + 2, date.getHours() & 0xff);
    view.setUint8(offset + 3, 0);
  }

  function writeFsDate(view, offset, ms) {
    if (!Number.isFinite(ms) || ms <= 0) {
      view.setUint32(offset, 0, true);
      return;
    }
    const date = new Date(ms);
    if (!Number.isFinite(date.getTime())) {
      view.setUint32(offset, 0, true);
      return;
    }
    view.setUint8(offset, date.getDate() & 0xff);
    view.setUint8(offset + 1, (date.getMonth() + 1) & 0xff);
    view.setUint16(offset + 2, date.getFullYear() & 0xffff, true);
  }

  function writeAsciiString(bytes, offset, maxLen, text) {
    const limit = Math.max(1, maxLen | 0);
    const str = text ? String(text) : "";
    const end = Math.min(str.length, limit - 1);
    for (let i = 0; i < end; i += 1) {
      bytes[offset + i] = str.charCodeAt(i) & 0xff;
    }
    bytes[offset + end] = 0;
  }

  function writeUtf16String(bytes, offset, maxLen, text) {
    const limit = Math.max(2, maxLen | 0);
    const str = text ? String(text) : "";
    const chars = Math.min(str.length, (limit >>> 1) - 1);
    for (let i = 0; i < chars; i += 1) {
      const code = str.charCodeAt(i) & 0xffff;
      bytes[offset + i * 2] = code & 0xff;
      bytes[offset + i * 2 + 1] = (code >>> 8) & 0xff;
    }
    bytes[offset + chars * 2] = 0;
    bytes[offset + chars * 2 + 1] = 0;
  }

  function writeUtf8String(bytes, offset, maxLen, text) {
    const limit = Math.max(1, maxLen | 0);
    const str = text ? String(text) : "";
    const encoded = UTF8_ENCODER ? UTF8_ENCODER.encode(str) : null;
    if (!encoded) {
      writeAsciiString(bytes, offset, limit, str);
      return;
    }
    const count = Math.min(encoded.length, limit - 1);
    bytes.set(encoded.subarray(0, count), offset);
    bytes[offset + count] = 0;
  }

  function fromBcd(value) {
    const byte = value & 0xff;
    return ((((byte >>> 4) & 0x0f) * 10) + (byte & 0x0f)) | 0;
  }

  function createBdfeBuffer(entry, encoding, includeName) {
    const enc = encoding & 0xff;
    const wide = enc === 2 || enc === 3;
    const nameSize = wide ? 520 : 264;
    const totalSize = includeName ? (40 + nameSize) : 40;
    const bytes = new Uint8Array(totalSize);
    const view = new DataView(bytes.buffer);
    const sizeValue = Math.max(0, Number(entry && entry.size) || 0);
    const attr = entry && entry.isDirectory ? 0x10 : 0;
    const stamp = entry && entry.mtimeMs ? Number(entry.mtimeMs) : 0;
    view.setUint32(0, attr >>> 0, true);
    view.setUint32(4, enc >>> 0, true);
    writeFsTime(view, 8, stamp);
    writeFsDate(view, 12, stamp);
    writeFsTime(view, 16, stamp);
    writeFsDate(view, 20, stamp);
    writeFsTime(view, 24, stamp);
    writeFsDate(view, 28, stamp);
    view.setUint32(32, (sizeValue >>> 0), true);
    view.setUint32(36, Math.floor(sizeValue / 0x100000000) >>> 0, true);
    if (includeName) {
      const name = entry && entry.name ? String(entry.name) : "";
      if (enc === 2) {
        writeUtf16String(bytes, 40, nameSize, name);
      } else if (enc === 3) {
        writeUtf8String(bytes, 40, nameSize, name);
      } else {
        writeAsciiString(bytes, 40, nameSize, name);
      }
    }
    return bytes;
  }

  function decodeCp866Bytes(bytes) {
    const assets = KosEmu.gfx && KosEmu.gfx.kolibriFontAssets ? KosEmu.gfx.kolibriFontAssets : null;
    const map = assets && assets.cp866CodePoints ? assets.cp866CodePoints : null;
    const parts = [];
    for (let i = 0; i < bytes.length; i += 1) {
      const value = bytes[i] & 0xff;
      if (value === 0) {
        break;
      }
      const codePoint = map && map[value] !== undefined ? map[value] : value;
      parts.push(String.fromCodePoint(codePoint >>> 0));
    }
    return parts.join("");
  }

  function decodeUtf16Bytes(bytes) {
    const parts = [];
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const value = (bytes[i] | (bytes[i + 1] << 8)) >>> 0;
      if (value === 0) {
        break;
      }
      parts.push(String.fromCodePoint(value));
    }
    return parts.join("");
  }

  function decodeUtf8Bytes(bytes) {
    if (!bytes || !bytes.length) {
      return "";
    }
    let end = 0;
    while (end < bytes.length && bytes[end] !== 0) {
      end += 1;
    }
    if (UTF8_DECODER) {
      return UTF8_DECODER.decode(bytes.subarray(0, end));
    }
    return decodeCp866Bytes(bytes.subarray(0, end));
  }

  function decodeCaptionBytes(bytes, encoding) {
    if (!bytes || !bytes.length) {
      return "";
    }
    if ((encoding | 0) === 2) {
      return decodeUtf16Bytes(bytes);
    }
    if ((encoding | 0) === 3) {
      return decodeUtf8Bytes(bytes);
    }
    return decodeCp866Bytes(bytes);
  }

  function decodeCaptionBuffer(bytes, defaultEncoding) {
    if (!bytes || !bytes.length) {
      return "";
    }
    let encoding = (defaultEncoding | 0) || 1;
    let start = 0;
    const marker = bytes[0] & 0xff;
    if (marker >= 1 && marker <= 3) {
      encoding = marker;
      start = 1;
    }
    return decodeCaptionBytes(start ? bytes.subarray(start) : bytes, encoding);
  }

  function parseIpv4String(text) {
    const value = String(text || "").trim();
    if (!value) {
      return 0;
    }
    const parts = value.split(".");
    if (parts.length !== 4) {
      return 0;
    }
    let out = 0;
    for (let i = 0; i < 4; i += 1) {
      const part = parts[i];
      if (!/^\d+$/.test(part)) {
        return 0;
      }
      const octet = Number(part);
      if (!Number.isFinite(octet) || octet < 0 || octet > 255) {
        return 0;
      }
      out = ((out << 8) | (octet & 0xff)) >>> 0;
    }
    return out >>> 0;
  }

  function formatIpv4Value(value) {
    const ip = value >>> 0;
    return [
      (ip >>> 24) & 0xff,
      (ip >>> 16) & 0xff,
      (ip >>> 8) & 0xff,
      ip & 0xff
    ].join(".");
  }

  function parseDnsQuery(bytes) {
    const source = bytes instanceof Uint8Array ? bytes : null;
    if (!source || source.length < 17) {
      return null;
    }
    const qdCount = (((source[4] & 0xff) << 8) | (source[5] & 0xff)) >>> 0;
    if (qdCount !== 1) {
      return null;
    }
    const labels = [];
    let offset = 12;
    while (offset < source.length) {
      const length = source[offset] & 0xff;
      offset += 1;
      if (length === 0) {
        break;
      }
      if ((length & 0xc0) !== 0 || offset + length > source.length) {
        return null;
      }
      let label = "";
      for (let i = 0; i < length; i += 1) {
        label += String.fromCharCode(source[offset + i] & 0xff);
      }
      labels.push(label);
      offset += length;
    }
    if (offset + 4 > source.length || !labels.length) {
      return null;
    }
    return {
      id: (((source[0] & 0xff) << 8) | (source[1] & 0xff)) >>> 0,
      flagsHi: source[2] & 0xff,
      flagsLo: source[3] & 0xff,
      name: labels.join("."),
      qtype: (((source[offset] & 0xff) << 8) | (source[offset + 1] & 0xff)) >>> 0,
      qclass: (((source[offset + 2] & 0xff) << 8) | (source[offset + 3] & 0xff)) >>> 0,
      questionEnd: (offset + 4) >>> 0
    };
  }

  function buildDnsIpv4Response(queryBytes, answerIp, rcode) {
    const source = queryBytes instanceof Uint8Array ? queryBytes : null;
    const query = parseDnsQuery(source);
    if (!source || !query) {
      return null;
    }
    const responseCode = rcode & 0x0f;
    const hasAnswer = responseCode === 0 && (answerIp >>> 0) !== 0;
    const question = source.subarray(12, query.questionEnd >>> 0);
    const answerLength = hasAnswer ? 16 : 0;
    const out = new Uint8Array(12 + question.length + answerLength);
    out[0] = source[0] & 0xff;
    out[1] = source[1] & 0xff;
    out[2] = (query.flagsHi | 0x80) & 0xff;
    out[3] = responseCode & 0xff;
    out[4] = 0x00;
    out[5] = 0x01;
    out[6] = 0x00;
    out[7] = hasAnswer ? 0x01 : 0x00;
    out[8] = 0x00;
    out[9] = 0x00;
    out[10] = 0x00;
    out[11] = 0x00;
    out.set(question, 12);
    if (hasAnswer) {
      let offset = 12 + question.length;
      out[offset] = 0xc0;
      out[offset + 1] = 0x0c;
      out[offset + 2] = 0x00;
      out[offset + 3] = 0x01;
      out[offset + 4] = 0x00;
      out[offset + 5] = 0x01;
      out[offset + 6] = 0x00;
      out[offset + 7] = 0x00;
      out[offset + 8] = 0x00;
      out[offset + 9] = 0x3c;
      out[offset + 10] = 0x00;
      out[offset + 11] = 0x04;
      out[offset + 12] = (answerIp >>> 24) & 0xff;
      out[offset + 13] = (answerIp >>> 16) & 0xff;
      out[offset + 14] = (answerIp >>> 8) & 0xff;
      out[offset + 15] = answerIp & 0xff;
    }
    return out;
  }

  function findHttpHeaderEnd(bytes) {
    const source = bytes instanceof Uint8Array ? bytes : null;
    if (!source || source.length < 2) {
      return -1;
    }
    for (let i = 0; i + 3 < source.length; i += 1) {
      if (
        source[i] === 0x0d &&
        source[i + 1] === 0x0a &&
        source[i + 2] === 0x0d &&
        source[i + 3] === 0x0a
      ) {
        return (i + 4) | 0;
      }
    }
    for (let i = 0; i + 1 < source.length; i += 1) {
      if (source[i] === 0x0a && source[i + 1] === 0x0a) {
        return (i + 2) | 0;
      }
    }
    return -1;
  }

  function decodeLatin1Bytes(bytes) {
    const source = bytes instanceof Uint8Array ? bytes : null;
    if (!source || !source.length) {
      return "";
    }
    const parts = [];
    for (let i = 0; i < source.length; i += 1) {
      parts.push(String.fromCharCode(source[i] & 0xff));
    }
    return parts.join("");
  }

  function encodeLatin1Bytes(text) {
    const value = String(text || "");
    const out = new Uint8Array(value.length);
    for (let i = 0; i < value.length; i += 1) {
      out[i] = value.charCodeAt(i) & 0xff;
    }
    return out;
  }

  function concatUint8Arrays(chunks, totalLength) {
    const total = Math.max(0, totalLength | 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      if (!(chunk instanceof Uint8Array) || !chunk.length) {
        continue;
      }
      const count = Math.min(chunk.length, total - offset);
      if (count <= 0) {
        break;
      }
      out.set(chunk.subarray(0, count), offset);
      offset += count;
      if (offset >= total) {
        break;
      }
    }
    return out;
  }

  function parseHttpRequestBytes(bytes) {
    const source = bytes instanceof Uint8Array ? bytes : null;
    if (!source || !source.length) {
      return null;
    }
    const headerEnd = findHttpHeaderEnd(source);
    if (headerEnd < 0) {
      return {
        complete: false,
        headerEnd: -1,
        totalLength: 0,
        contentLength: 0
      };
    }
    const headerText = decodeLatin1Bytes(source.subarray(0, headerEnd));
    const normalized = headerText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const lines = normalized.split("\n").filter((line, index, all) => index !== all.length - 1 || line.length > 0);
    if (!lines.length) {
      return null;
    }
    const requestLine = lines[0].trim();
    const parts = requestLine.split(/\s+/);
    if (parts.length < 2) {
      return null;
    }
    const headers = {};
    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line) {
        continue;
      }
      const colon = line.indexOf(":");
      if (colon <= 0) {
        continue;
      }
      const name = line.slice(0, colon).trim().toLowerCase();
      const value = line.slice(colon + 1).trim();
      if (name) {
        headers[name] = value;
      }
    }
    const parsedLength = headers["content-length"] ? Number.parseInt(headers["content-length"], 10) : 0;
    const contentLength = Number.isFinite(parsedLength) && parsedLength > 0 ? parsedLength | 0 : 0;
    const totalLength = (headerEnd + contentLength) | 0;
    return {
      complete: source.length >= totalLength,
      method: parts[0].toUpperCase(),
      target: parts[1],
      version: parts[2] || "HTTP/1.1",
      headers,
      headerEnd: headerEnd | 0,
      contentLength: contentLength | 0,
      totalLength: totalLength | 0,
      body: source.subarray(headerEnd, Math.min(source.length, totalLength))
    };
  }

  function buildHttpResponseBytes(status, statusText, headers, body) {
    const responseBody = body instanceof Uint8Array ? body : new Uint8Array(0);
    const lines = [`HTTP/1.1 ${(status >>> 0) || 500}${statusText ? ` ${statusText}` : ""}`];
    const seen = new Set();
    if (headers && typeof headers.forEach === "function") {
      headers.forEach((value, name) => {
        const key = String(name || "").trim().toLowerCase();
        if (!key || key === "connection" || key === "content-length" || key === "transfer-encoding") {
          return;
        }
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        lines.push(`${name}: ${value}`);
      });
    }
    lines.push(`Content-Length: ${responseBody.length >>> 0}`);
    lines.push("Connection: close");
    const headerBytes = encodeLatin1Bytes(`${lines.join("\r\n")}\r\n\r\n`);
    const out = new Uint8Array(headerBytes.length + responseBody.length);
    out.set(headerBytes, 0);
    out.set(responseBody, headerBytes.length);
    return out;
  }

  function createUserBufferSurface(emulator, bufferPtr) {
    if (!emulator || !emulator.cpu || !bufferPtr) {
      return null;
    }
    const ptr = bufferPtr >>> 0;
    const mem = emulator.cpu.mem;
    const view = emulator.cpu.view;
    if (!(mem instanceof Uint8Array) || !view || ptr + 8 > mem.length) {
      return null;
    }
    const width = view.getUint32(ptr, true) >>> 0;
    const height = view.getUint32((ptr + 4) >>> 0, true) >>> 0;
    if (!width || !height) {
      return null;
    }
    const pixelsPtr = (ptr + 8) >>> 0;
    const byteLength = Math.imul(width, height) * 4;
    if (!byteLength || pixelsPtr + byteLength > mem.length) {
      return null;
    }
    return {
      width,
      height,
      pixelsPtr,
      fillRect(x, y, rectWidth, rectHeight, color) {
        const x0 = Math.max(0, x | 0);
        const y0 = Math.max(0, y | 0);
        const x1 = Math.min(width | 0, (x + rectWidth) | 0);
        const y1 = Math.min(height | 0, (y + rectHeight) | 0);
        if (x1 <= x0 || y1 <= y0) {
          return;
        }
        const b = color & 0xff;
        const g = (color >>> 8) & 0xff;
        const r = (color >>> 16) & 0xff;
        for (let py = y0; py < y1; py += 1) {
          let offset = (pixelsPtr + ((py * width + x0) * 4)) >>> 0;
          for (let px = x0; px < x1; px += 1) {
            mem[offset] = b;
            mem[offset + 1] = g;
            mem[offset + 2] = r;
            mem[offset + 3] = 0xff;
            offset += 4;
          }
        }
      },
      setPixel(x, y, color) {
        const px = x | 0;
        const py = y | 0;
        if (px < 0 || py < 0 || px >= (width | 0) || py >= (height | 0)) {
          return;
        }
        const offset = (pixelsPtr + ((py * width + px) * 4)) >>> 0;
        mem[offset] = color & 0xff;
        mem[offset + 1] = (color >>> 8) & 0xff;
        mem[offset + 2] = (color >>> 16) & 0xff;
        mem[offset + 3] = 0xff;
      }
    };
  }

  function fillUserBufferRect(surface, x, y, width, height, color) {
    if (!surface || width <= 0 || height <= 0) {
      return;
    }
    if (typeof surface.fillRect === "function") {
      surface.fillRect(x, y, width, height, color);
      return;
    }
    const x0 = Math.max(0, x | 0);
    const y0 = Math.max(0, y | 0);
    const x1 = Math.min(surface.width | 0, (x + width) | 0);
    const y1 = Math.min(surface.height | 0, (y + height) | 0);
    for (let py = y0; py < y1; py += 1) {
      for (let px = x0; px < x1; px += 1) {
        surface.setPixel(px, py, color);
      }
    }
  }

  function installEmulatorSyscalls(Emulator, shared) {
    if (!Emulator || !Emulator.prototype) {
      throw new Error("installEmulatorSyscalls requires an Emulator class.");
    }
    const {
      REG,
      drawText,
      measureText,
      getTextInfo,
      getTextInfoFromString,
      measureKolibriText,
      drawKolibriText,
      toBcd,
      align4k
    } = shared || {};

    Object.assign(Emulator.prototype, {
      handleSyscall() {
        const eax = this.readReg(REG.EAX) >>> 0;
        const ebx = this.readReg(REG.EBX) >>> 0;
        const ecx = this.readReg(REG.ECX) >>> 0;
        const edx = this.readReg(REG.EDX) >>> 0;
        const esi = this.readReg(REG.ESI) >>> 0;
        const edi = this.readReg(REG.EDI) >>> 0;
        const sc = this.lastSyscall || (this.lastSyscall = {
          eax: 0,
          ebx: 0,
          ecx: 0,
          edx: 0,
          esi: 0,
          edi: 0
        });
        sc.eax = eax;
        sc.ebx = ebx;
        sc.ecx = ecx;
        sc.edx = edx;
        sc.esi = esi;
        sc.edi = edi;
        if (this.traceSyscalls) {
          this.log(
            `syscall ${eax} ebx=0x${sc.ebx.toString(16)} ecx=0x${sc.ecx.toString(16)} edx=0x${sc.edx.toString(16)}`
          );
        }
        switch (eax) {
          case 0:
            this.sysCreateWindow();
            break;
          case 1:
            this.sysPutPixel();
            break;
          case 2:
            this.sysGetKey();
            break;
          case 3:
            this.sysGetTime();
            break;
          case 5:
            this.sysSleep();
            break;
          case 4:
            this.sysDrawText();
            break;
          case 7:
            this.sysDrawImage();
            break;
          case 8:
            this.sysDefineButton();
            break;
          case 9:
            this.sysThreadInfo();
            break;
          case 11:
            this.sysCheckEvent();
            break;
          case 23:
            this.sysWaitEventTimeout();
            break;
          case 40:
            this.sysSetEventMask();
            break;
          case 10:
            this.sysWaitEvent();
            break;
          case 12:
            this.sysRedraw();
            break;
          case 17:
            this.sysGetButton();
            break;
          case 13:
            this.sysDrawRect();
            break;
          case 14:
            this.sysScreenSize();
            break;
          case 15:
            this.sysBackground();
            break;
          case 16:
            this.sysSaveRamdiskFloppy();
            break;
          case 18:
            this.sysSystem();
            break;
          case 21:
            this.sysSystemSet();
            break;
          case 22:
            this.sysSetTimeDate();
            break;
          case 24:
            this.sysCdDrive();
            break;
          case 25:
            this.sysScreenPutImage();
            break;
          case 26:
            this.sysSystemInfo();
            break;
          case 29:
            this.sysGetDate();
            break;
          case 30:
            this.sysCurrentFolder();
            break;
          case 34:
            this.sysPixelOwner();
            break;
          case 35:
            this.sysPixelColor();
            break;
          case 36:
            this.sysGetImage();
            break;
          case 37:
            this.sysMouse();
            break;
          case 38:
            this.sysDrawLine();
            break;
          case 39:
            this.sysBackgroundGet();
            break;
          case 46:
            this.sysSetPorts();
            break;
          case 47:
            this.sysDrawNumber();
            break;
          case 49:
            this.sysApm();
            break;
          case 65:
            this.sysDrawImagePalette();
            break;
          case 66:
            this.sysKeyboard();
            break;
          case 67:
            this.sysChangeWindowGeometry();
            break;
          case 68:
            this.sysSysMisc();
            break;
          case 48:
            this.sysStyleSettings();
            break;
          case 50:
            this.sysSetWindowShape();
            break;
          case 51:
            this.sysThreadControl();
            break;
          case 54:
            this.sysClipboard();
            break;
          case 55:
            this.sysSpeakerPlay();
            break;
          case 57:
            this.sysPciBios();
            break;
          case 60:
            this.sysIpc();
            break;
          case 61:
            this.sysDirectGraphicsParams();
            break;
          case 62:
            this.sysPci();
            break;
          case 63:
            this.sysDebugBoard();
            break;
          case 64:
            this.sysResizeApplicationMemory();
            break;
          case 69:
            this.sysDebug();
            break;
          case 70:
            this.sysFile();
            break;
          case 71:
            this.sysSetCaption();
            break;
          case 72:
            this.sysSendWindowMessage();
            break;
          case 73:
            this.sysBlitBitmap();
            break;
          case 74:
            this.sysNetworkGet();
            break;
          case 75:
            this.sysNetworkSocket();
            break;
          case 76:
            this.sysNetworkProtocol();
            break;
          case 77:
            this.sysFutex();
            break;
          case 80:
            this.sysFileEncoded();
            break;
          case 0xffffffff:
            this.sysTerminate();
            break;
          default:
            if (!this.unknownSyscalls.has(eax)) {
              this.unknownSyscalls.add(eax);
              this.log(`Unhandled syscall ${eax}`);
            }
            break;
        }
      },

      getEmulatedRtcDate() {
        const offset = Number.isFinite(this.rtcOffsetMs) ? this.rtcOffsetMs : 0;
        return new Date(Date.now() + offset);
      },

      writeEncodedString(addr, text, maxLen, encoding) {
        const ptr = addr >>> 0;
        const size = Math.max(1, maxLen | 0);
        if (!ptr || !size) {
          return;
        }
        const bytes = new Uint8Array(size);
        if ((encoding | 0) === 2) {
          writeUtf16String(bytes, 0, size, text);
        } else if ((encoding | 0) === 3) {
          writeUtf8String(bytes, 0, size, text);
        } else {
          writeAsciiString(bytes, 0, size, text);
        }
        this.writeMemBlock(ptr, bytes);
      },

      readEncodedString(addr, maxLen, encoding) {
        const ptr = addr >>> 0;
        if (!ptr) {
          return "";
        }
        if ((encoding | 0) !== 1 && typeof this.readCStringEncoded === "function") {
          return this.readCStringEncoded(ptr, maxLen || 4096, encoding | 0);
        }
        return this.readCString(ptr, maxLen || 4096);
      },

      getClipboardState() {
        if (!this.clipboardState || !Array.isArray(this.clipboardState.slots)) {
          this.clipboardState = {
            slots: [],
            locked: false
          };
        }
        return this.clipboardState;
      },

      getDebugState() {
        if (!this.debugApiState) {
          this.debugApiState = {
            messagePtr: 0,
            messageSize: 0,
            targetPid: 0,
            suspended: false,
            exceptionMask: 0,
            breakpoints: new Map()
          };
        }
        return this.debugApiState;
      },

      getExceptionState() {
        if (!this.exceptionState) {
          this.exceptionState = {
            handler: 0,
            mask: 0,
            active: new Map()
          };
        }
        return this.exceptionState;
      },

      getPipeState() {
        if (!this.pipeState || !(this.pipeState.fds instanceof Map) || !(this.pipeState.pipes instanceof Map)) {
          this.pipeState = {
            nextFd: 3,
            nextPipeId: 1,
            fds: new Map(),
            pipes: new Map()
          };
        }
        return this.pipeState;
      },

      getDesktopBackgroundSnapshot() {
        const session = this.hostSession || null;
        const info = session && typeof session.getDesktopBackgroundInfo === "function"
          ? (session.getDesktopBackgroundInfo() || null)
          : null;
        const bytes = session && typeof session.getDesktopBackgroundBytes === "function"
          ? (session.getDesktopBackgroundBytes() || null)
          : null;
        return {
          width: info && info.width !== undefined ? (info.width >>> 0) : 0,
          height: info && info.height !== undefined ? (info.height >>> 0) : 0,
          mode: info && info.mode !== undefined ? (info.mode >>> 0) : 1,
          lastDraw: info && info.lastDraw ? info.lastDraw : null,
          bytes: bytes instanceof Uint8Array ? bytes : null
        };
      },

      getEmulatedNetworkDevices() {
        const session = this.hostSession || null;
        let devices = null;
        if (session && typeof session.getNetworkDevices === "function") {
          const provided = session.getNetworkDevices();
          if (Array.isArray(provided) && provided.length) {
            devices = provided;
          }
        }
        if (!Array.isArray(devices) || !devices.length) {
          if (!Array.isArray(this.defaultNetworkDevices) || !this.defaultNetworkDevices.length) {
            this.defaultNetworkDevices = [{
              apiDeviceNumber: 1,
              name: "hostnet0",
              type: 1,
              ptr: 0,
              linkUp: true,
              linkStatus: 0x0a,
              mac: 0x02005e100001n,
              ip: 0x0a00020f,
              dns: 0x08080808,
              subnet: 0xffffff00,
              gateway: 0x0a000201,
              txPackets: 0,
              rxPackets: 0,
              txBytes: 0n,
              rxBytes: 0n,
              icmpTxPackets: 0,
              icmpRxPackets: 0,
              udpTxPackets: 0,
              udpRxPackets: 0,
              tcpTxPackets: 0,
              tcpRxPackets: 0,
              arpTxPackets: 0,
              arpRxPackets: 0,
              arpEntries: 0,
              arpConflicts: 0,
              arpTable: []
            }];
          }
          devices = this.defaultNetworkDevices;
        }
        for (let i = 0; i < devices.length; i += 1) {
          this.ensureNetworkDeviceState(devices[i], i);
        }
        return devices;
      },

      ensureNetworkDeviceState(device, index) {
        const target = device || {};
        if (target.apiDeviceNumber === undefined || target.apiDeviceNumber === null) {
          target.apiDeviceNumber = (((index | 0) + 1) & 0xff) >>> 0;
        }
        if (!target.name) {
          target.name = `hostnet${Math.max(0, index | 0)}`;
        }
        if (target.type === undefined || target.type === null) {
          target.type = 1;
        }
        if (target.ptr === undefined || target.ptr === null) {
          target.ptr = 0;
        }
        if (target.linkUp === undefined || target.linkUp === null) {
          target.linkUp = true;
        }
        if (target.linkStatus === undefined || target.linkStatus === null) {
          target.linkStatus = target.linkUp ? 0x0a : 0;
        }
        if (target.mac === undefined || target.mac === null) {
          target.mac = 0x02005e100001n;
        }
        if (target.ip === undefined || target.ip === null) {
          target.ip = 0x0a00020f;
        }
        if (target.dns === undefined || target.dns === null) {
          target.dns = 0x08080808;
        }
        if (target.subnet === undefined || target.subnet === null) {
          target.subnet = 0xffffff00;
        }
        if (target.gateway === undefined || target.gateway === null) {
          target.gateway = 0x0a000201;
        }
        const counterFields = [
          "txPackets",
          "rxPackets",
          "icmpTxPackets",
          "icmpRxPackets",
          "udpTxPackets",
          "udpRxPackets",
          "tcpTxPackets",
          "tcpRxPackets",
          "arpTxPackets",
          "arpRxPackets",
          "arpConflicts",
          "txErrors",
          "txDropped",
          "txMissed",
          "rxErrors",
          "rxDropped",
          "rxMissed"
        ];
        for (let i = 0; i < counterFields.length; i += 1) {
          const name = counterFields[i];
          target[name] = (target[name] >>> 0) || 0;
        }
        if (typeof target.txBytes !== "bigint") {
          target.txBytes = BigInt(target.txBytes || 0);
        }
        if (typeof target.rxBytes !== "bigint") {
          target.rxBytes = BigInt(target.rxBytes || 0);
        }
        if (!Array.isArray(target.arpTable)) {
          target.arpTable = [];
        }
        target.arpEntries = target.arpTable.length >>> 0;
        return target;
      },

      resetNetworkDeviceCounters(device) {
        const target = this.ensureNetworkDeviceState(device, 0);
        const counterFields = [
          "txPackets",
          "rxPackets",
          "icmpTxPackets",
          "icmpRxPackets",
          "udpTxPackets",
          "udpRxPackets",
          "tcpTxPackets",
          "tcpRxPackets",
          "arpTxPackets",
          "arpRxPackets",
          "arpConflicts",
          "txErrors",
          "txDropped",
          "txMissed",
          "rxErrors",
          "rxDropped",
          "rxMissed"
        ];
        for (let i = 0; i < counterFields.length; i += 1) {
          target[counterFields[i]] = 0;
        }
        target.txBytes = 0n;
        target.rxBytes = 0n;
        return target;
      },

      getDeviceArpTable(device) {
        const target = this.ensureNetworkDeviceState(device, 0);
        if (!Array.isArray(target.arpTable)) {
          target.arpTable = [];
        }
        target.arpEntries = target.arpTable.length >>> 0;
        return target.arpTable;
      },

      readArpEntryStruct(addrPtr) {
        const ptr = addrPtr >>> 0;
        if (!ptr) {
          return null;
        }
        let mac = 0n;
        for (let i = 0; i < 6; i += 1) {
          mac |= BigInt(this.readMem8((ptr + 4 + i) >>> 0) & 0xff) << BigInt(i * 8);
        }
        return {
          ip: this.readMem32(ptr >>> 0) >>> 0,
          mac,
          status: this.readMem16((ptr + 10) >>> 0) >>> 0,
          ttl: this.readMem16((ptr + 12) >>> 0) >>> 0
        };
      },

      writeArpEntryStruct(addrPtr, entry) {
        const ptr = addrPtr >>> 0;
        const item = entry || null;
        if (!ptr || !item) {
          return false;
        }
        this.writeMem32(ptr >>> 0, (item.ip >>> 0) || 0);
        const mac = typeof item.mac === "bigint" ? item.mac : BigInt(item.mac || 0);
        for (let i = 0; i < 6; i += 1) {
          this.writeMem8((ptr + 4 + i) >>> 0, Number((mac >> BigInt(i * 8)) & 0xffn) & 0xff);
        }
        this.writeMem16((ptr + 10) >>> 0, (item.status >>> 0) & 0xffff);
        this.writeMem16((ptr + 12) >>> 0, (item.ttl >>> 0) & 0xffff);
        return true;
      },

      resolveNetworkApiDevice(apiDeviceNumber, devices) {
        const list = Array.isArray(devices) ? devices : this.getEmulatedNetworkDevices();
        const requested = apiDeviceNumber & 0xff;
        if (!list.length) {
          return null;
        }
        for (let i = 0; i < list.length; i += 1) {
          const device = list[i];
          if (!device) {
            continue;
          }
          if (((device.apiDeviceNumber >>> 0) & 0xff) === requested) {
            return device;
          }
        }
        if (requested < list.length) {
          return list[requested] || null;
        }
        if (requested > 0) {
          return list[(requested - 1) >>> 0] || null;
        }
        return null;
      },

      getPrimaryNetworkDevice(devices) {
        const list = Array.isArray(devices) ? devices : this.getEmulatedNetworkDevices();
        if (!list.length) {
          return null;
        }
        const preferred = this.resolveNetworkApiDevice(1, list);
        return preferred || list[0] || null;
      },

      getSocketApiState() {
        if (
          !this.socketApiState ||
          !(this.socketApiState.sockets instanceof Map) ||
          !(this.socketApiState.syntheticDnsByName instanceof Map) ||
          !(this.socketApiState.syntheticDnsByAddr instanceof Map)
        ) {
          this.socketApiState = {
            nextSocket: 1,
            nextSyntheticIpv4: 0x0a400001,
            nextEphemeralPort: 49152,
            sockets: new Map(),
            syntheticDnsByName: new Map(),
            syntheticDnsByAddr: new Map()
          };
        }
        return this.socketApiState;
      },

      createNetworkSocketRecord(handle, domain, typeValue, protocolValue) {
        const SO_NONBLOCK = 0x80000000 >>> 0;
        const rawType = typeValue >>> 0;
        const rawProtocol = protocolValue >>> 0;
        const optionBits = ((rawType & SO_NONBLOCK) | (rawProtocol & SO_NONBLOCK)) >>> 0;
        return {
          handle: handle >>> 0,
          domain: domain >>> 0,
          type: (rawType & ~SO_NONBLOCK) >>> 0,
          protocol: (rawProtocol & ~SO_NONBLOCK) >>> 0,
          options: optionBits >>> 0,
          ttl: 128,
          bindDevice: 0,
          localAddr: 0,
          localPort: 0,
          remoteAddr: 0,
          remotePort: 0,
          connected: false,
          listening: false,
          listenBacklog: 0,
          pendingAccepts: [],
          closed: false,
          remoteClosed: false,
          peer: 0,
          pair: 0,
          receiveChunks: [],
          receiveLength: 0,
          sendChunks: [],
          sendLength: 0,
          sendBufferSize: 0x10000,
          receiveBufferSize: 0x10000,
          reuseAddr: false,
          requestPending: false,
          requestComplete: false,
          socketError: 0,
          fetchController: null
        };
      },

      isSocketNonBlocking(socket) {
        return !!(socket && ((socket.options >>> 0) & 0x80000000) !== 0);
      },

      getSocketWaitError(socket, flags) {
        if ((flags & 0x40) !== 0 || this.isSocketNonBlocking(socket)) {
          return 6;
        }
        this.requestYield(0, "network");
        return 60;
      },

      getSocketLocalAddressDefault(socket) {
        const devices = this.getEmulatedNetworkDevices();
        const deviceNumber = socket && socket.bindDevice ? (socket.bindDevice >>> 0) : 1;
        const device = this.resolveNetworkApiDevice(deviceNumber >>> 0, devices) || this.getPrimaryNetworkDevice(devices);
        if (socket && (socket.remoteAddr >>> 0) === 0x7f000001) {
          return 0x7f000001;
        }
        return device ? ((device.ip >>> 0) || 0x0a00020f) : 0x0a00020f;
      },

      socketBindingConflicts(socket, localAddr, localPort) {
        const state = this.getSocketApiState();
        const addr = localAddr >>> 0;
        const port = localPort >>> 0;
        for (const current of state.sockets.values()) {
          if (!current || current.closed || (current.handle >>> 0) === (socket.handle >>> 0)) {
            continue;
          }
          if ((current.type >>> 0) !== (socket.type >>> 0)) {
            continue;
          }
          if ((current.localPort >>> 0) !== port) {
            continue;
          }
          const currentAddr = current.localAddr >>> 0;
          if (currentAddr === 0 || addr === 0 || currentAddr === addr) {
            return true;
          }
        }
        return false;
      },

      allocateEphemeralSocketPort(socket, localAddr) {
        const state = this.getSocketApiState();
        let port = state.nextEphemeralPort >>> 0;
        if (port < 49152 || port > 65535) {
          port = 49152;
        }
        for (let i = 0; i < 16384; i += 1) {
          const candidate = (((port + i - 49152) % 16384) + 49152) >>> 0;
          if (!this.socketBindingConflicts(socket, localAddr >>> 0, candidate >>> 0)) {
            state.nextEphemeralPort = candidate >= 65535 ? 49152 : ((candidate + 1) >>> 0);
            return candidate >>> 0;
          }
        }
        return 0;
      },

      ensureSocketLocalEndpoint(socket) {
        if (!socket) {
          return false;
        }
        if ((socket.localPort >>> 0) !== 0) {
          return true;
        }
        const localAddr = this.getSocketLocalAddressDefault(socket) >>> 0;
        const localPort = this.allocateEphemeralSocketPort(socket, localAddr >>> 0);
        if (!localPort) {
          return false;
        }
        socket.localAddr = localAddr >>> 0;
        socket.localPort = localPort >>> 0;
        return true;
      },

      writeSockaddrIn(addrPtr, addrLen, family, port, addr) {
        const ptr = addrPtr >>> 0;
        const size = addrLen >>> 0;
        if (!ptr || size < 8) {
          return false;
        }
        this.writeMem16(ptr >>> 0, family >>> 0);
        this.writeMem8((ptr + 2) >>> 0, ((port >>> 8) & 0xff) >>> 0);
        this.writeMem8((ptr + 3) >>> 0, (port & 0xff) >>> 0);
        this.writeMem8((ptr + 4) >>> 0, ((addr >>> 24) & 0xff) >>> 0);
        this.writeMem8((ptr + 5) >>> 0, ((addr >>> 16) & 0xff) >>> 0);
        this.writeMem8((ptr + 6) >>> 0, ((addr >>> 8) & 0xff) >>> 0);
        this.writeMem8((ptr + 7) >>> 0, (addr & 0xff) >>> 0);
        for (let i = 8; i < Math.min(size, 16); i += 1) {
          this.writeMem8((ptr + i) >>> 0, 0);
        }
        return true;
      },

      readSocketOption(optPtr) {
        const ptr = optPtr >>> 0;
        if (!ptr) {
          return null;
        }
        return {
          ptr,
          level: this.readMem32(ptr >>> 0) >>> 0,
          optionName: this.readMem32((ptr + 4) >>> 0) >>> 0,
          optionLength: this.readMem32((ptr + 8) >>> 0) >>> 0,
          optionPtr: (ptr + 12) >>> 0
        };
      },

      readSocketOptionValue(option) {
        if (!option || !(option.optionLength >>> 0)) {
          return 0;
        }
        const length = option.optionLength >>> 0;
        if (length >= 4) {
          return this.readMem32(option.optionPtr >>> 0) >>> 0;
        }
        let value = 0;
        for (let i = 0; i < length; i += 1) {
          value |= (this.readMem8((option.optionPtr + i) >>> 0) & 0xff) << (i * 8);
        }
        return value >>> 0;
      },

      writeSocketOptionValue(option, value) {
        if (!option) {
          return false;
        }
        const length = option.optionLength >>> 0;
        if (!length) {
          return true;
        }
        if (length >= 4) {
          this.writeMem32(option.optionPtr >>> 0, value >>> 0);
          return true;
        }
        for (let i = 0; i < length; i += 1) {
          this.writeMem8((option.optionPtr + i) >>> 0, ((value >>> (i * 8)) & 0xff) >>> 0);
        }
        return true;
      },

      findListeningSocket(remoteAddr, remotePort) {
        const state = this.getSocketApiState();
        const addr = remoteAddr >>> 0;
        const port = remotePort >>> 0;
        for (const socket of state.sockets.values()) {
          if (!socket || socket.closed || !socket.listening) {
            continue;
          }
          if ((socket.type >>> 0) !== 1) {
            continue;
          }
          if ((socket.localPort >>> 0) !== port) {
            continue;
          }
          const localAddr = socket.localAddr >>> 0;
          if (localAddr === 0 || localAddr === addr || addr === 0x7f000001) {
            return socket;
          }
        }
        return null;
      },

      findBoundDatagramSocket(remoteAddr, remotePort) {
        const state = this.getSocketApiState();
        const addr = remoteAddr >>> 0;
        const port = remotePort >>> 0;
        for (const socket of state.sockets.values()) {
          if (!socket || socket.closed) {
            continue;
          }
          if ((socket.type >>> 0) !== 2 && (socket.type >>> 0) !== 3) {
            continue;
          }
          if ((socket.localPort >>> 0) !== port) {
            continue;
          }
          const localAddr = socket.localAddr >>> 0;
          if (localAddr === 0 || localAddr === addr || addr === 0x7f000001) {
            return socket;
          }
        }
        return null;
      },

      linkLocalTcpPeer(clientSocket, listenerSocket, remoteAddr, remotePort) {
        const state = this.getSocketApiState();
        let acceptedHandle = state.nextSocket >>> 0;
        if (!acceptedHandle) {
          acceptedHandle = 1;
        }
        state.nextSocket = ((acceptedHandle + 1) >>> 0) || 1;
        const accepted = this.createNetworkSocketRecord(
          acceptedHandle >>> 0,
          listenerSocket.domain >>> 0,
          listenerSocket.type >>> 0,
          listenerSocket.protocol >>> 0
        );
        accepted.localAddr = listenerSocket.localAddr >>> 0;
        accepted.localPort = listenerSocket.localPort >>> 0;
        accepted.remoteAddr = clientSocket.localAddr >>> 0;
        accepted.remotePort = clientSocket.localPort >>> 0;
        accepted.connected = true;
        accepted.peer = clientSocket.handle >>> 0;
        clientSocket.connected = true;
        clientSocket.remoteAddr = remoteAddr >>> 0;
        clientSocket.remotePort = remotePort >>> 0;
        clientSocket.peer = acceptedHandle >>> 0;
        clientSocket.remoteClosed = false;
        accepted.remoteClosed = false;
        state.sockets.set(acceptedHandle >>> 0, accepted);
        if (!Array.isArray(listenerSocket.pendingAccepts)) {
          listenerSocket.pendingAccepts = [];
        }
        listenerSocket.pendingAccepts.push(acceptedHandle >>> 0);
        this.notifyNetworkStackReady();
        return acceptedHandle >>> 0;
      },

      updateDeviceTraffic(device, direction, byteLength, packetField) {
        const target = device ? this.ensureNetworkDeviceState(device, 0) : null;
        if (!target) {
          return;
        }
        const count = Math.max(0, byteLength | 0) >>> 0;
        if (direction === "tx") {
          target.txPackets = ((target.txPackets >>> 0) + 1) >>> 0;
          target.txBytes = (target.txBytes + BigInt(count)) & 0xffffffffffffffffn;
        } else {
          target.rxPackets = ((target.rxPackets >>> 0) + 1) >>> 0;
          target.rxBytes = (target.rxBytes + BigInt(count)) & 0xffffffffffffffffn;
        }
        if (packetField) {
          target[packetField] = ((target[packetField] >>> 0) + 1) >>> 0;
        }
      },

      setSocketOptionState(socket, option) {
        const SO_NONBLOCK = 0x80000000 >>> 0;
        const SO_BINDTODEVICE = 1 << 9;
        const SOL_SOCKET = 0xffff;
        const SOL_SOCKET_ALT = 1;
        const SO_BINDTODEVICE_ALT = 25;
        const IPPROTO_IP = 0;
        const IP_TTL = 2;
        const optionInfo = option || null;
        if (!socket || !optionInfo) {
          return 11;
        }
        const value = this.readSocketOptionValue(optionInfo) >>> 0;
        if ((optionInfo.level >>> 0) === SOL_SOCKET || (optionInfo.level >>> 0) === SOL_SOCKET_ALT) {
          if ((optionInfo.optionName >>> 0) === SO_NONBLOCK) {
            if (value) {
              socket.options = ((socket.options >>> 0) | SO_NONBLOCK) >>> 0;
            } else {
              socket.options = ((socket.options >>> 0) & ~SO_NONBLOCK) >>> 0;
            }
            return 0;
          }
          if ((optionInfo.optionName >>> 0) === SO_BINDTODEVICE || (optionInfo.optionName >>> 0) === SO_BINDTODEVICE_ALT) {
            socket.bindDevice = value >>> 0;
            return 0;
          }
          if ((optionInfo.optionName >>> 0) === 2) {
            socket.reuseAddr = value !== 0;
            return 0;
          }
          if ((optionInfo.optionName >>> 0) === 7) {
            socket.sendBufferSize = Math.max(1, value | 0) >>> 0;
            return 0;
          }
          if ((optionInfo.optionName >>> 0) === 8) {
            socket.receiveBufferSize = Math.max(1, value | 0) >>> 0;
            return 0;
          }
        }
        if ((optionInfo.level >>> 0) === IPPROTO_IP && (optionInfo.optionName >>> 0) === IP_TTL) {
          socket.ttl = Math.max(1, Math.min(255, value | 0)) >>> 0;
          return 0;
        }
        return 4;
      },

      getSocketOptionState(socket, option) {
        const SO_NONBLOCK = 0x80000000 >>> 0;
        const SO_BINDTODEVICE = 1 << 9;
        const SOL_SOCKET = 0xffff;
        const SOL_SOCKET_ALT = 1;
        const SO_BINDTODEVICE_ALT = 25;
        const IPPROTO_IP = 0;
        const IP_TTL = 2;
        const optionInfo = option || null;
        if (!socket || !optionInfo) {
          return 11;
        }
        let value = null;
        if ((optionInfo.level >>> 0) === SOL_SOCKET || (optionInfo.level >>> 0) === SOL_SOCKET_ALT) {
          if ((optionInfo.optionName >>> 0) === SO_NONBLOCK) {
            value = this.isSocketNonBlocking(socket) ? 1 : 0;
          } else if ((optionInfo.optionName >>> 0) === SO_BINDTODEVICE || (optionInfo.optionName >>> 0) === SO_BINDTODEVICE_ALT) {
            value = socket.bindDevice >>> 0;
          } else if ((optionInfo.optionName >>> 0) === 2) {
            value = socket.reuseAddr ? 1 : 0;
          } else if ((optionInfo.optionName >>> 0) === 4) {
            value = socket.socketError >>> 0;
          } else if ((optionInfo.optionName >>> 0) === 7) {
            value = socket.sendBufferSize >>> 0;
          } else if ((optionInfo.optionName >>> 0) === 8) {
            value = socket.receiveBufferSize >>> 0;
          }
        } else if ((optionInfo.level >>> 0) === IPPROTO_IP && (optionInfo.optionName >>> 0) === IP_TTL) {
          value = socket.ttl >>> 0;
        }
        if (value === null) {
          return 4;
        }
        this.writeSocketOptionValue(optionInfo, value >>> 0);
        return 0;
      },

      bindSocketLocalEndpoint(socket, sockaddr) {
        if (!socket || !sockaddr || (sockaddr.family >>> 0) !== 2) {
          return 11;
        }
        if ((socket.localPort >>> 0) !== 0) {
          return 20;
        }
        let localAddr = sockaddr.addr >>> 0;
        let localPort = sockaddr.port >>> 0;
        if (!localPort) {
          localAddr = localAddr || (this.getSocketLocalAddressDefault(socket) >>> 0);
          localPort = this.allocateEphemeralSocketPort(socket, localAddr >>> 0);
          if (!localPort) {
            return 1;
          }
        }
        if (this.socketBindingConflicts(socket, localAddr >>> 0, localPort >>> 0) && !socket.reuseAddr) {
          return 20;
        }
        socket.localAddr = localAddr >>> 0;
        socket.localPort = localPort >>> 0;
        return 0;
      },

      canSocketReceive(socket) {
        if (!socket || socket.closed) {
          return false;
        }
        if (socket.connected || socket.peer) {
          return true;
        }
        if (socket.listening) {
          return true;
        }
        if (((socket.type >>> 0) === 2 || (socket.type >>> 0) === 3) && (socket.localPort >>> 0) !== 0) {
          return true;
        }
        return false;
      },

      canSocketSend(socket) {
        if (!socket || socket.closed) {
          return false;
        }
        if (socket.peer || socket.pair) {
          return true;
        }
        if (socket.connected) {
          return true;
        }
        return false;
      },

      deliverSocketPayload(socket, payload) {
        const state = this.getSocketApiState();
        const packet = payload instanceof Uint8Array ? payload : null;
        if (!socket || !packet) {
          return 11;
        }
        if (socket.pair) {
          const peer = state.sockets.get(socket.pair >>> 0) || null;
          if (!peer) {
            return 9;
          }
          peer.remoteClosed = false;
          this.appendSocketReceiveChunk(peer, new Uint8Array(packet));
          return 0;
        }
        if (socket.peer) {
          const peer = state.sockets.get(socket.peer >>> 0) || null;
          if (!peer) {
            return 9;
          }
          peer.remoteClosed = false;
          this.appendSocketReceiveChunk(peer, new Uint8Array(packet));
          return 0;
        }
        if ((socket.type >>> 0) === 2 || (socket.type >>> 0) === 3) {
          const target = this.findBoundDatagramSocket(socket.remoteAddr >>> 0, socket.remotePort >>> 0);
          if (target) {
            target.remoteClosed = false;
            this.appendSocketReceiveChunk(target, new Uint8Array(packet));
            return 0;
          }
        }
        return 4;
      },

      readSocketReceiveData(socket, maxLength, peek) {
        const limit = Math.max(0, maxLength | 0) >>> 0;
        if (!socket || !Array.isArray(socket.receiveChunks) || !socket.receiveChunks.length || !limit) {
          return null;
        }
        if (peek) {
          const out = new Uint8Array(Math.min(limit, socket.receiveLength >>> 0));
          let written = 0;
          for (let i = 0; i < socket.receiveChunks.length && written < out.length; i += 1) {
            const chunk = socket.receiveChunks[i];
            if (!(chunk instanceof Uint8Array) || !chunk.length) {
              continue;
            }
            const count = Math.min(chunk.length, out.length - written);
            out.set(chunk.subarray(0, count), written);
            written += count;
          }
          return written < out.length ? out.subarray(0, written) : out;
        }
        return this.consumeSocketReceiveChunk(socket, limit >>> 0);
      },

      socketConnectInternal(socket, sockaddr) {
        if (!socket || !sockaddr || (sockaddr.family >>> 0) !== 2) {
          return 11;
        }
        if (!this.ensureSocketLocalEndpoint(socket)) {
          return 1;
        }
        if ((socket.type >>> 0) === 1) {
          const listener = this.findListeningSocket(sockaddr.addr >>> 0, sockaddr.port >>> 0);
          if (listener) {
            if (
              Array.isArray(listener.pendingAccepts) &&
              (listener.listenBacklog >>> 0) !== 0 &&
              (listener.pendingAccepts.length >>> 0) >= (listener.listenBacklog >>> 0)
            ) {
              return 6;
            }
            this.linkLocalTcpPeer(socket, listener, sockaddr.addr >>> 0, sockaddr.port >>> 0);
            return 0;
          }
        }
        socket.connected = true;
        socket.remoteAddr = sockaddr.addr >>> 0;
        socket.remotePort = sockaddr.port >>> 0;
        socket.socketError = 0;
        socket.remoteClosed = false;
        return 0;
      },

      finalizeSocketClose(socket) {
        if (!socket) {
          return;
        }
        const state = this.getSocketApiState();
        if (socket.fetchController && typeof socket.fetchController.abort === "function") {
          try {
            socket.fetchController.abort();
          } catch (_) {
            if (typeof this.log === "function") {
              this.log("Socket abort during teardown (ignored)");
            }
          }
        }
        if (socket.peer) {
          const peer = state.sockets.get(socket.peer >>> 0) || null;
          if (peer) {
            peer.peer = 0;
            peer.remoteClosed = true;
            this.notifyNetworkStackReady();
          }
        }
        if (socket.pair) {
          const pair = state.sockets.get(socket.pair >>> 0) || null;
          if (pair) {
            pair.pair = 0;
            pair.remoteClosed = true;
            this.notifyNetworkStackReady();
          }
        }
        if (Array.isArray(socket.pendingAccepts)) {
          for (let i = 0; i < socket.pendingAccepts.length; i += 1) {
            const acceptedHandle = socket.pendingAccepts[i] >>> 0;
            const accepted = state.sockets.get(acceptedHandle) || null;
            if (accepted) {
              accepted.remoteClosed = true;
              accepted.peer = 0;
            }
          }
        }
      },

      allocateSyntheticDnsHostAddress(hostName) {
        const key = String(hostName || "").trim().toLowerCase();
        if (!key) {
          return 0;
        }
        const state = this.getSocketApiState();
        const existing = state.syntheticDnsByName.get(key);
        if (existing) {
          return existing >>> 0;
        }
        let value = state.nextSyntheticIpv4 >>> 0;
        if (!value) {
          value = 0x0a400001;
        }
        while (state.syntheticDnsByAddr.has(value >>> 0)) {
          value = ((value + 1) >>> 0) || 0x0a400001;
        }
        state.nextSyntheticIpv4 = ((value + 1) >>> 0) || 0x0a400001;
        state.syntheticDnsByName.set(key, value >>> 0);
        state.syntheticDnsByAddr.set(value >>> 0, key);
        return value >>> 0;
      },

      resolveSyntheticDnsHostName(addrValue) {
        const state = this.getSocketApiState();
        const key = state.syntheticDnsByAddr.get(addrValue >>> 0);
        return key ? String(key) : "";
      },

      notifyNetworkStackReady() {
        this.queueEvent(8);
        this.wakeExecution(true);
        this.wakeHostSiblingThreads(true);
      },

      readSockaddrIn(addrPtr, addrLen) {
        const ptr = addrPtr >>> 0;
        const size = addrLen >>> 0;
        if (!ptr || size < 8) {
          return null;
        }
        return {
          family: this.readMem16(ptr >>> 0) >>> 0,
          port: (((this.readMem8((ptr + 2) >>> 0) & 0xff) << 8) | (this.readMem8((ptr + 3) >>> 0) & 0xff)) >>> 0,
          addr: (
            ((this.readMem8((ptr + 4) >>> 0) & 0xff) << 24) |
            ((this.readMem8((ptr + 5) >>> 0) & 0xff) << 16) |
            ((this.readMem8((ptr + 6) >>> 0) & 0xff) << 8) |
            (this.readMem8((ptr + 7) >>> 0) & 0xff)
          ) >>> 0
        };
      },

      appendSocketReceiveChunk(socket, bytes) {
        const chunk = bytes instanceof Uint8Array ? bytes : null;
        if (!socket || !chunk || !chunk.length) {
          return false;
        }
        if (!Array.isArray(socket.receiveChunks)) {
          socket.receiveChunks = [];
          socket.receiveLength = 0;
        }
        socket.receiveChunks.push(chunk);
        socket.receiveLength = ((socket.receiveLength >>> 0) + (chunk.length >>> 0)) >>> 0;
        this.notifyNetworkStackReady();
        return true;
      },

      consumeSocketReceiveChunk(socket, maxLength) {
        const limit = Math.max(0, maxLength | 0) >>> 0;
        if (!socket || !Array.isArray(socket.receiveChunks) || !socket.receiveChunks.length || !limit) {
          return null;
        }
        const out = new Uint8Array(Math.min(limit, socket.receiveLength >>> 0));
        let written = 0;
        while (written < out.length && socket.receiveChunks.length) {
          const chunk = socket.receiveChunks[0];
          if (!(chunk instanceof Uint8Array) || !chunk.length) {
            socket.receiveChunks.shift();
            continue;
          }
          const count = Math.min(chunk.length, out.length - written);
          out.set(chunk.subarray(0, count), written);
          written += count;
          if (count >= chunk.length) {
            socket.receiveChunks.shift();
          } else {
            socket.receiveChunks[0] = chunk.subarray(count);
          }
        }
        socket.receiveLength = Math.max(0, (socket.receiveLength >>> 0) - written) >>> 0;
        return written < out.length ? out.subarray(0, written) : out;
      },

      closeNetworkSocketHandle(handle) {
        const state = this.getSocketApiState();
        const key = handle >>> 0;
        const socket = state.sockets.get(key) || null;
        if (!socket) {
          return false;
        }
        socket.closed = true;
        this.finalizeSocketClose(socket);
        state.sockets.delete(key);
        return true;
      },

      dispatchSyntheticDns(socket, payload) {
        const packet = payload instanceof Uint8Array ? payload : null;
        const query = parseDnsQuery(packet);
        if (!socket || !packet || !query) {
          return false;
        }
        let answerIp = 0;
        let rcode = 0;
        if (query.qclass !== 1 || query.qtype !== 1 || !query.name) {
          rcode = 3;
        } else {
          answerIp = this.allocateSyntheticDnsHostAddress(query.name);
          if (!answerIp) {
            rcode = 2;
          }
        }
        const response = buildDnsIpv4Response(packet, answerIp >>> 0, rcode >>> 0);
        if (!(response instanceof Uint8Array) || !response.length) {
          return false;
        }
        socket.connected = true;
        socket.socketError = 0;
        return this.appendSocketReceiveChunk(socket, response);
      },

      dispatchHttpSocketRequest(socket) {
        if (!socket || socket.closed || socket.requestPending) {
          return false;
        }
        const requestBytes = concatUint8Arrays(socket.sendChunks || [], socket.sendLength >>> 0);
        const request = parseHttpRequestBytes(requestBytes);
        if (!request || !request.complete) {
          return false;
        }
        let authority = String(request.headers.host || "").trim();
        if (!authority) {
          const syntheticName = this.resolveSyntheticDnsHostName(socket.remoteAddr >>> 0);
          authority = syntheticName || formatIpv4Value(socket.remoteAddr >>> 0);
          if ((socket.remotePort >>> 0) !== 80 && (socket.remotePort >>> 0) !== 443) {
            authority = `${authority}:${socket.remotePort >>> 0}`;
          }
        }
        let url = String(request.target || "/");
        if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
          if (!url.startsWith("/")) {
            url = `/${url}`;
          }
          const scheme = (socket.remotePort >>> 0) === 443 ? "https" : "http";
          url = `${scheme}://${authority}${url}`;
        }
        const fetchImpl = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null;
        if (!fetchImpl) {
          socket.requestPending = false;
          socket.requestComplete = true;
          socket.socketError = typeof this.getHostFetchFailureInfo === "function"
            ? this.getHostFetchFailureInfo(url, "fetch API unavailable").errno >>> 0
            : 61;
          if (typeof this.logHostFetchFailure === "function") {
            this.logHostFetchFailure("guest-http", url, "fetch API unavailable");
          }
          this.notifyNetworkStackReady();
          return true;
        }
        const headers = {};
        const skipHeader = {
          host: true,
          connection: true,
          "content-length": true,
          "transfer-encoding": true
        };
        const headerNames = Object.keys(request.headers);
        for (let i = 0; i < headerNames.length; i += 1) {
          const name = headerNames[i];
          if (skipHeader[name]) {
            continue;
          }
          headers[name] = request.headers[name];
        }
        const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        socket.fetchController = controller;
        socket.requestPending = true;
        socket.requestComplete = false;
        socket.socketError = 0;
        const body = request.contentLength > 0 ? request.body.subarray(0, request.contentLength >>> 0) : null;
        const options = {
          method: request.method,
          headers
        };
        if (controller) {
          options.signal = controller.signal;
        }
        if (body && request.method !== "GET" && request.method !== "HEAD") {
          options.body = body;
        }
        Promise.resolve(fetchImpl(url, options)).then(async (response) => {
          if (!socket || socket.closed) {
            return;
          }
          const bodyBytes = request.method === "HEAD"
            ? new Uint8Array(0)
            : new Uint8Array(await response.arrayBuffer());
          if (socket.closed) {
            return;
          }
          socket.requestPending = false;
          socket.requestComplete = true;
          socket.remoteClosed = true;
          socket.socketError = 0;
          this.appendSocketReceiveChunk(
            socket,
            buildHttpResponseBytes(response.status >>> 0, response.statusText || "", response.headers, bodyBytes)
          );
        }).catch((err) => {
          if (!socket || socket.closed) {
            return;
          }
          const failure = typeof this.getHostFetchFailureInfo === "function"
            ? this.getHostFetchFailureInfo(url, err)
            : null;
          socket.requestPending = false;
          socket.requestComplete = true;
          socket.socketError = failure ? (failure.errno >>> 0) : (/abort|timeout/i.test(String(err && err.message ? err.message : err || "")) ? 60 : 61);
          if (typeof this.logHostFetchFailure === "function") {
            this.logHostFetchFailure("guest-http", url, err);
          }
          this.notifyNetworkStackReady();
        });
        return true;
      },

      sysCreateWindow() {
        const ebx = this.readReg(REG.EBX);
        const ecx = this.readReg(REG.ECX);
        const edx = this.readReg(REG.EDX);
        const esi = this.readReg(REG.ESI);
        const edi = this.readReg(REG.EDI);
        this.ensureSkinThemeLoaded();
        this.removeQueuedEvent(1);
        this.keyBuffer.length = 0;
        this.removeQueuedEvent(2);
        this.pendingButtonResult = 1;
        this.removeQueuedEvent(3);
        this.mouseEventBuffer.length = 0;
        this.removeQueuedEvent(6);
        this.activeButtonSerial = 0;
    
        const winX = ebx >> 16;
        const winY = ecx >> 16;
        const styleFlags = (edx >>> 28) & 0xf;
        const windowStyle = (edx >>> 24) & 0xf;
        const coordsAreClient = (styleFlags & 0x2) !== 0;
        const noFill = (styleFlags & 0x4) !== 0;
        const width = ebx & 0xffff;
        const height = ecx & 0xffff;
        const color = edx & 0x00ffffff;
        const skinned = windowStyle === 3 || windowStyle === 4;
        const clientOffsetX = coordsAreClient ? (skinned ? 4 : 0) : 0;
        const clientOffsetY = coordsAreClient ? (skinned ? (this.skinHeight | 0) : 0) : 0;
        this.windowStyle = windowStyle & 0xff;
        this.windowHasCaption = (styleFlags & 0x1) !== 0;
    
        if ((!width || !height) && !this.windowDefined) {
          return;
        }
        if (width || height || this.windowDefined) {
          let hostX = this.windowHostX | 0;
          let hostY = this.windowHostY | 0;
          let outerWidth = Math.max(1, this.windowWidth | 0 || (this.surface ? (this.surface.width | 0) : 1));
          let outerHeight = Math.max(1, this.windowHeight | 0 || (this.surface ? (this.surface.height | 0) : 1));
          if (!this.windowDefined) {
            const screen = this.getHostScreenInfo();
            const screenWidth = Math.max(1, screen.width | 0);
            const screenHeight = Math.max(1, screen.height | 0);
            hostX = winX | 0;
            hostY = winY | 0;
            outerWidth = Math.max(1, Math.min((width + 1) | 0, screenWidth)) | 0;
            outerHeight = Math.max(1, Math.min((height + 1) | 0, screenHeight)) | 0;
            hostX = Math.max(0, Math.min(hostX, Math.max(0, screenWidth - outerWidth))) | 0;
            hostY = Math.max(0, Math.min(hostY, Math.max(0, screenHeight - outerHeight))) | 0;
            this.windowHostX = hostX;
            this.windowHostY = hostY;
            this.windowOriginX = this.autoFitWindow ? 0 : hostX;
            this.windowOriginY = this.autoFitWindow ? 0 : hostY;
            this.windowDefined = true;
            this.windowTitle = "";
            this.surface.clear(0x000000);
            this.notifyWindowSize(outerWidth, outerHeight);
            if (this.notifyWindowGeometry) {
              this.notifyWindowGeometry(hostX, hostY, outerWidth, outerHeight);
            }
            if (typeof this.updateWindowShape === "function") {
              this.updateWindowShape();
            }
          }
          this.windowClientOffsetX = clientOffsetX | 0;
          this.windowClientOffsetY = clientOffsetY | 0;
          if (this.autoFitWindow) {
            this.windowOriginX = 0;
            this.windowOriginY = 0;
          } else {
            this.windowOriginX = hostX;
            this.windowOriginY = hostY;
          }
          const drawWidth = Math.max(0, outerWidth - 1) | 0;
          const drawHeight = Math.max(0, outerHeight - 1) | 0;
          const headerHeight = skinned ? (this.skinHeight | 0) : 0;
          const originX = this.windowOriginX | 0;
          const originY = this.windowOriginY | 0;
          let clientX = originX;
          let clientY = originY;
          let clientW = drawWidth;
          let clientH = drawHeight;
          if (skinned) {
            clientX = originX + 4;
            clientY = originY + headerHeight;
            clientW = Math.max(0, drawWidth - 8);
            clientH = Math.max(0, drawHeight - headerHeight - 4);
          }
    
          if (!noFill) {
            this.fillRect(clientX, clientY, clientW, clientH, color);
          }
    
          if (headerHeight > 0) {
            const drewSkin = this.drawWindowSkin(originX, originY, outerWidth, outerHeight, true);
            if (!drewSkin) {
              let headerColor = esi & 0x00ffffff;
              if (headerColor === 0) {
                const r = (color >> 16) & 0xff;
                const g = (color >> 8) & 0xff;
                const b = color & 0xff;
                const r2 = (r * 3) >> 2;
                const g2 = (g * 3) >> 2;
                const b2 = (b * 3) >> 2;
                headerColor = (r2 << 16) | (g2 << 8) | b2;
              }
              this.fillRect(originX, originY, outerWidth, headerHeight, headerColor);
            }
            if ((styleFlags & 0x1) !== 0 && edi) {
              const bytes = this.readMemBlock(edi >>> 0, 64);
              if (bytes) {
                const title = decodeCaptionBuffer(bytes, 1);
                if (title.length) {
                  this.windowTitle = title;
                  if (drewSkin) {
                    this.drawWindowTitle(title, originX, originY, outerWidth, true);
                  } else {
                    drawText(this.surface, originX + 4, originY + 3, 0xffffff, title, 1);
                  }
                }
              }
            }
          }
          this.presentIfNeeded();
        }
      },

      sysPutPixel() {
        const x = this.readReg(REG.EBX) | 0;
        const y = this.readReg(REG.ECX) | 0;
        const edx = this.readReg(REG.EDX);
        const color = edx & 0x00ffffff;
        const pos = this.applyWindowOffset(x, y);
        this.surface.setPixel(pos.x, pos.y, color);
        this.presentIfNeeded();
      },

      sysGetTime() {
        const now = this.getEmulatedRtcDate();
        const hh = toBcd(now.getHours());
        const mm = toBcd(now.getMinutes());
        const ss = toBcd(now.getSeconds());
        const eax = (ss << 16) | (mm << 8) | hh;
        this.writeReg(REG.EAX, eax >>> 0);
        if (this.traceSyscalls && this.lastTimeBcd !== eax) {
          this.lastTimeBcd = eax >>> 0;
          const hhStr = String(now.getHours()).padStart(2, "0");
          const mmStr = String(now.getMinutes()).padStart(2, "0");
          const ssStr = String(now.getSeconds()).padStart(2, "0");
          this.log(`syscall 3 -> time ${hhStr}:${mmStr}:${ssStr} (bcd=0x${eax.toString(16).padStart(6, "0")})`);
        }
      },

      sysSaveRamdiskFloppy() {
        this.writeReg(REG.EAX, 1);
      },

      sysSetTimeDate() {
        const sub = this.readReg(REG.EBX) >>> 0;
        const value = this.readReg(REG.ECX) >>> 0;
        const now = this.getEmulatedRtcDate();
        if (sub === 0) {
          const hh = fromBcd(value & 0xff);
          const mm = fromBcd((value >>> 8) & 0xff);
          const ss = fromBcd((value >>> 16) & 0xff);
          if (hh > 23 || mm > 59 || ss > 59) {
            this.writeReg(REG.EAX, 1);
            return;
          }
          const next = new Date(now.getTime());
          next.setHours(hh, mm, ss, 0);
          this.rtcOffsetMs = next.getTime() - Date.now();
          this.writeReg(REG.EAX, 0);
          return;
        }
        if (sub === 1) {
          const yearLo = fromBcd(value & 0xff);
          const month = fromBcd((value >>> 8) & 0xff);
          const day = fromBcd((value >>> 16) & 0xff);
          if (day < 1 || day > 31 || month < 1 || month > 12 || yearLo > 99) {
            this.writeReg(REG.EAX, 1);
            return;
          }
          const currentYear = now.getFullYear();
          const year = (Math.floor(currentYear / 100) * 100) + yearLo;
          const next = new Date(now.getTime());
          next.setFullYear(year, month - 1, day);
          if (
            next.getFullYear() !== year ||
            next.getMonth() !== (month - 1) ||
            next.getDate() !== day
          ) {
            this.writeReg(REG.EAX, 1);
            return;
          }
          this.rtcOffsetMs = next.getTime() - Date.now();
          this.writeReg(REG.EAX, 0);
          return;
        }
        if (sub === 2) {
          if (value < 1 || value > 7) {
            this.writeReg(REG.EAX, 1);
            return;
          }
          this.rtcWeekday = value >>> 0;
          this.writeReg(REG.EAX, 0);
          return;
        }
        if (sub === 3) {
          const hh = fromBcd(value & 0xff);
          const mm = fromBcd((value >>> 8) & 0xff);
          const ss = fromBcd((value >>> 16) & 0xff);
          if (hh > 23 || mm > 59 || ss > 59) {
            this.writeReg(REG.EAX, 1);
            return;
          }
          this.rtcAlarmBcd = value >>> 0;
          this.writeReg(REG.EAX, 0);
          return;
        }
        this.writeReg(REG.EAX, 1);
      },

      sysGetDate() {
        const now = this.getEmulatedRtcDate();
        const yy = toBcd(now.getFullYear() % 100);
        const mm = toBcd(now.getMonth() + 1);
        const dd = toBcd(now.getDate());
        this.writeReg(REG.EAX, (((dd & 0xff) << 16) | ((mm & 0xff) << 8) | (yy & 0xff)) >>> 0);
      },

      findReadableKeyBufferIndex() {
        if (!this.keyBuffer.length) {
          return -1;
        }
        const active = typeof this.isHostThreadActive === "function"
          ? this.isHostThreadActive()
          : true;
        if (active) {
          for (let i = 0; i < this.keyBuffer.length; i += 1) {
            const entry = this.keyBuffer[i];
            if (entry && !entry.hotkey) {
              return i;
            }
          }
        }
        for (let i = 0; i < this.keyBuffer.length; i += 1) {
          const entry = this.keyBuffer[i];
          if (entry && entry.hotkey) {
            return i;
          }
        }
        return -1;
      },

      hasPendingKeyEvent() {
        return this.findReadableKeyBufferIndex() >= 0;
      },

      hasPendingButtonEvent() {
        if ((this.pendingButtonResult >>> 0) === 1) {
          return false;
        }
        return typeof this.isHostThreadActive === "function"
          ? this.isHostThreadActive()
          : true;
      },

      hasPendingMouseEvent() {
        return Array.isArray(this.mouseEventBuffer) && this.mouseEventBuffer.length > 0;
      },

      sysGetKey() {
        const keyIndex = this.findReadableKeyBufferIndex();
        if (keyIndex < 0) {
          if (!this.keyBuffer.length) {
            this.removeQueuedEvent(2);
          }
          this.writeReg(REG.EAX, 1);
          return;
        }

        const entry = this.keyBuffer.splice(keyIndex, 1)[0];
        let value = 1;
        if (entry) {
          if (entry.hotkey) {
            value = (
              2 |
              ((entry.scanCode & 0xff) << 8) |
              ((entry.controlKeys & 0xffff) << 16)
            ) >>> 0;
          } else if ((entry.mode & 0xff) === 0) {
            value = (
              ((entry.asciiCode & 0xff) << 8) |
              ((entry.scanCode & 0xff) << 16)
            ) >>> 0;
          } else {
            value = ((entry.scanCode & 0xff) << 8) >>> 0;
          }
        }

        if (this.hasPendingKeyEvent()) {
          this.removeQueuedEvent(2);
          this.queueEvent(2);
        } else {
          this.removeQueuedEvent(2);
        }
        this.writeReg(REG.EAX, value >>> 0);
      },

      sysSleep() {
        const ticks = this.readReg(REG.EBX) >>> 0;
        if (ticks === 0) {
          return;
        }
        const delay = Math.min(ticks * 10, 1000);
        this.requestYield(delay, "sleep");
      },

      sysDrawText() {
        const ebx = this.readReg(REG.EBX);
        const ecx = this.readReg(REG.ECX);
        const edx = this.readReg(REG.EDX);
        const esi = this.readReg(REG.ESI);
        const edi = this.readReg(REG.EDI);
    
        const x = unpackSignedHigh16(ebx);
        const y = unpackSignedLow16(ebx);
        const color = ecx & 0x00ffffff;
        const flags = (ecx >>> 24) & 0xff;
        const zeroTerm = (flags & 0x80) !== 0;
        const fillBackground = (flags & 0x40) !== 0;
        const fontMode = (flags >>> 4) & 0x03;
        const drawToBuffer = (flags & 0x08) !== 0;
        const scale = (flags & 0x07) + 1;
    
        if (edx === 0) {
          return;
        }
    
        const maxChars = zeroTerm ? 2048 : Math.min(esi >>> 0, 2048);
        let maxBytes = maxChars;
        if (fontMode === 2) {
          maxBytes = zeroTerm ? 4096 : (maxChars * 2);
        } else if (fontMode === 3) {
          maxBytes = zeroTerm ? 8192 : (maxChars * 4);
        }
        const bytes = this.readMemBlock(edx, maxBytes >>> 0);
        if (!bytes) {
          this.log(`Text read failed at 0x${edx.toString(16)}`);
          return;
        }
        const textInfo = getTextInfo(bytes, zeroTerm, maxChars, fontMode);
    
        const size = measureKolibriText(textInfo, scale);
        if (drawToBuffer) {
          const target = createUserBufferSurface(this, edi);
          if (!target) {
            return;
          }
          if (fillBackground) {
            fillUserBufferRect(target, x, y, size.width, size.height, edi & 0x00ffffff);
          }
          drawKolibriText(target, x, y, color, textInfo, scale);
          return;
        }
        this.autoFitContentRect(x, y, size.width, size.height);
        const pos = this.applyWindowOffset(x, y);
        if (fillBackground) {
          const bg = edi & 0x00ffffff;
          for (let dy = 0; dy < size.height; dy += 1) {
            for (let dx = 0; dx < size.width; dx += 1) {
              this.surface.setPixel(pos.x + dx, pos.y + dy, bg);
            }
          }
        }
    
        drawKolibriText(this.surface, pos.x, pos.y, color, textInfo, scale);
        this.presentIfNeeded();
      },

      sysSetCaption() {
        const sub = this.readReg(REG.EBX) >>> 0;
        const ptr = this.readReg(REG.ECX) >>> 0;
        let encoding = 1;
        let textPtr = ptr >>> 0;
        if (!textPtr) {
          this.windowTitle = "";
          return;
        }
        if (sub === 1) {
          const marker = this.readMem8(textPtr) & 0xff;
          if (marker >= 1 && marker <= 3) {
            encoding = marker;
            textPtr = (textPtr + 1) >>> 0;
          }
        } else if (sub === 2) {
          const requested = this.readReg(REG.EDX) & 0xff;
          if (requested >= 1 && requested <= 3) {
            encoding = requested;
          }
        } else {
          if (!this.unknownSyscalls.has(7100 + sub)) {
            this.unknownSyscalls.add(7100 + sub);
            this.log(`Unhandled syscall 71 sub ${sub}`);
          }
          return;
        }
        const maxBytes = encoding === 2 ? 512 : 256;
        const bytes = this.readMemBlock(textPtr, maxBytes);
        this.windowTitle = decodeCaptionBytes(bytes, encoding);
        if (!this.windowDefined || !this.windowHasCaption) {
          return;
        }
        if (this.windowStyle === 3 || this.windowStyle === 4) {
          const originX = this.windowOriginX | 0;
          const originY = this.windowOriginY | 0;
          const outerWidth = Math.max(1, this.windowWidth | 0 || (this.surface ? (this.surface.width | 0) : 1));
          const outerHeight = Math.max(1, this.windowHeight | 0 || (this.surface ? (this.surface.height | 0) : 1));
          if (this.drawWindowSkin(originX, originY, outerWidth, outerHeight, true) && this.windowTitle) {
            this.drawWindowTitle(this.windowTitle, originX, originY, outerWidth, true);
            this.presentIfNeeded();
          }
        }
      },

      sysThreadInfo() {
        const ptr = this.readReg(REG.EBX) >>> 0;
        const maxThreadSlot = this.getHostMaxThreadSlot ? (this.getHostMaxThreadSlot() >>> 0) : (this.threadSlot >>> 0);
        const encodeSize = (value) => {
          const size = value >>> 0;
          return size > 0 ? ((size - 1) >>> 0) : 0;
        };
        if (!ptr) {
          this.writeReg(REG.EAX, maxThreadSlot >>> 0);
          return;
        }
        const slotReq = this.readReg(REG.ECX) | 0;
        const slot = slotReq === -1 ? (this.threadSlot >>> 0) : (slotReq >>> 0);
        const info = this.getHostThreadInfo
          ? (this.getHostThreadInfo(slot >>> 0) || (this.buildCurrentThreadInfo ? this.buildCurrentThreadInfo(slot >>> 0) : null))
          : (this.buildCurrentThreadInfo ? this.buildCurrentThreadInfo(slot >>> 0) : null);
        const stackSlot = this.getHostWindowStackSlot
          ? (this.getHostWindowStackSlot(slotReq === -1 ? (this.threadSlot >>> 0) : (slotReq >>> 0)) >>> 0)
          : (slot >>> 0);
        const THREAD_INFO_SIZE = 0x4c;
        const buf = new Uint8Array(THREAD_INFO_SIZE);
        const view = new DataView(buf.buffer);
        if (info) {
          view.setUint32(0, (info.cpuUsage >>> 0), true);
          view.setUint16(4, (info.windowStackPosition >>> 0) & 0xffff, true);
          view.setUint16(6, (stackSlot >>> 0) & 0xffff, true);
          writeAsciiString(buf, 0x0a, 12, info.name || "");
          view.setUint32(0x16, (info.memoryAddress >>> 0), true);
          view.setUint32(0x1a, (info.usedMemory >>> 0), true);
          view.setUint32(0x1e, (info.pid >>> 0), true);
          view.setUint32(0x22, (info.windowX >>> 0), true);
          view.setUint32(0x26, (info.windowY >>> 0), true);
          view.setUint32(0x2a, encodeSize(info.windowWidth), true);
          view.setUint32(0x2e, encodeSize(info.windowHeight), true);
          view.setUint16(0x32, (info.slotState >>> 0) & 0xffff, true);
          view.setUint32(0x36, (info.clientX >>> 0), true);
          view.setUint32(0x3a, (info.clientY >>> 0), true);
          view.setUint32(0x3e, encodeSize(info.clientWidth), true);
          view.setUint32(0x42, encodeSize(info.clientHeight), true);
          buf[0x46] = info.windowState & 0xff;
          view.setUint32(0x47, (info.eventMask >>> 0), true);
          buf[0x4b] = info.keyboardMode & 0xff;
        } else {
          const ticks = this.readTimeCounter32();
          view.setUint32(0, ticks >>> 0, true);
          view.setUint32(0x1a, (this.memLimit ? (this.memLimit - 1) : 0) >>> 0, true);
          view.setUint32(0x22, 0, true);
          view.setUint32(0x26, 0, true);
          view.setUint32(0x2a, encodeSize(this.surface.width), true);
          view.setUint32(0x2e, encodeSize(this.surface.height), true);
          view.setUint16(0x32, slot === (this.threadSlot >>> 0) ? 0 : 9, true);
          view.setUint32(0x36, 0, true);
          view.setUint32(0x3a, 0, true);
          view.setUint32(0x47, this.eventMask >>> 0, true);
          buf[0x4b] = this.keyboardMode & 0xff;
        }
        this.writeMemBlock(ptr, buf);
        this.writeReg(REG.EAX, maxThreadSlot >>> 0);
      },

      sysThreadControl() {
        const sub = this.readReg(REG.EBX) & 0xff;
        const ecx = this.readReg(REG.ECX) >>> 0;
        const isCurrent = ecx === 0xffffffff || ecx === (this.threadSlot >>> 0);
        switch (sub) {
          case 1: { // create thread
            const entry = this.readReg(REG.ECX) >>> 0;
            const stack = this.readReg(REG.EDX) >>> 0;
            const tid = this.createHostThread ? (this.createHostThread(entry, stack) >>> 0) : (0xffffffff >>> 0);
            this.writeReg(REG.EAX, tid >>> 0);
            break;
          }
          case 2: // get current thread slot
            this.writeReg(REG.EAX, this.threadSlot >>> 0);
            break;
          case 3: // get thread priority
            if (isCurrent) {
              this.writeReg(REG.EAX, this.threadPriority >>> 0);
            } else {
              this.writeReg(REG.EAX, 0xffffffff >>> 0);
            }
            break;
          case 4: { // set thread priority
            if (isCurrent) {
              const prev = this.threadPriority >>> 0;
              const next = this.readReg(REG.EDX) & 0xff;
              this.threadPriority = next >>> 0;
              this.writeReg(REG.EAX, prev >>> 0);
            } else {
              this.writeReg(REG.EAX, 0xffffffff >>> 0);
            }
            break;
          }
          default:
            if (!this.unknownSyscalls.has(5100 + sub)) {
              this.unknownSyscalls.add(5100 + sub);
              this.log(`Unhandled syscall 51 sub ${sub}`);
            }
            this.writeReg(REG.EAX, 0xffffffff >>> 0);
            break;
        }
      },

      sysDebugBoard() {
        const sub = this.readReg(REG.EBX) & 0xff;
        if (sub === 2) {
          const result = typeof this.readDebugBoardByte === "function"
            ? this.readDebugBoardByte()
            : { hasByte: false, byte: 0 };
          if (result && result.hasByte) {
            this.writeReg(REG.EAX, result.byte & 0xff);
            this.writeReg(REG.EBX, 1);
          } else {
            this.writeReg(REG.EAX, 0);
            this.writeReg(REG.EBX, 0);
          }
          return;
        }
        if (sub !== 1) {
          return;
        }
        const byte = this.readReg(REG.ECX) & 0xff;
        if (typeof this.writeDebugBoardByte === "function") {
          this.writeDebugBoardByte(byte);
        }
        if (byte === 10 || byte === 13) {
          if (this.debugLine) {
            this.log(`debug: ${this.debugLine}`);
            this.debugLine = "";
          }
          return;
        }
        this.debugLine += String.fromCharCode(byte);
        if (this.debugLine.length > 512) {
          this.log(`debug: ${this.debugLine}`);
          this.debugLine = "";
        }
      },

      sysDebug() {
        const sub = this.readReg(REG.EBX) & 0xff;
        const state = this.getDebugState();
        switch (sub) {
          case 0:
            state.messagePtr = this.readReg(REG.ECX) >>> 0;
            state.messageSize = this.readReg(REG.EDX) >>> 0;
            this.writeReg(REG.EAX, 0);
            return;
          case 1:
          case 2:
          case 4:
          case 5:
          case 8:
            this.writeReg(REG.EAX, 0xffffffff >>> 0);
            return;
          case 3:
            state.targetPid = 0;
            state.suspended = false;
            this.writeReg(REG.EAX, 0);
            return;
          case 6:
          case 7:
            this.writeReg(REG.EAX, 0xffffffff >>> 0);
            return;
          case 9: {
            const index = this.readReg(REG.ECX) >>> 0;
            const address = this.readReg(REG.EDX) >>> 0;
            if (!address) {
              state.breakpoints.delete(index >>> 0);
            } else {
              state.breakpoints.set(index >>> 0, address >>> 0);
            }
            this.writeReg(REG.EAX, 0);
            return;
          }
          default:
            if (!this.unknownSyscalls.has(6900 + sub)) {
              this.unknownSyscalls.add(6900 + sub);
              this.log(`Unhandled syscall 69 sub ${sub}`);
            }
            this.writeReg(REG.EAX, 0xffffffff >>> 0);
            return;
        }
      },

      sysDrawNumber() {
        const ebx = this.readReg(REG.EBX) >>> 0;
        const ecx = this.readReg(REG.ECX) >>> 0;
        const edx = this.readReg(REG.EDX) >>> 0;
        const esi = this.readReg(REG.ESI) >>> 0;
        const edi = this.readReg(REG.EDI) >>> 0;
    
        const bl = ebx & 0xff;
        const bh = (ebx >>> 8) & 0xff;
        let digits = (ebx >>> 16) & 0x3f;
        const isQword = (ebx & 0x40000000) !== 0;
        const noLeading = (ebx & 0x80000000) !== 0;
    
        const base = bh === 1 ? 16 : bh === 2 ? 2 : 10;
        let value = 0n;
        if (bl === 1) {
          if (ecx === 0) {
            return;
          }
          value = isQword ? this.readMem64(ecx) : BigInt(this.readMem32(ecx));
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
        const color = esi & 0x00ffffff;
        const flags = (esi >>> 24) & 0xff;
        const fillBackground = (flags & 0x40) !== 0;
        const fontMode = (flags >>> 4) & 0x03;
        const drawToBuffer = (flags & 0x08) !== 0;
        const scale = (flags & 0x07) + 1;
        const textInfo = getTextInfoFromString(text, fontMode);
    
        const size = measureKolibriText(textInfo, scale);
        if (drawToBuffer) {
          const target = createUserBufferSurface(this, edi);
          if (!target) {
            return;
          }
          if (fillBackground) {
            fillUserBufferRect(target, x, y, size.width, size.height, edi & 0x00ffffff);
          }
          drawKolibriText(target, x, y, color, textInfo, scale);
          return;
        }
        this.autoFitContentRect(x, y, size.width, size.height);
        const pos = this.applyWindowOffset(x, y);
        if (fillBackground) {
          const bg = edi & 0x00ffffff;
          for (let dy = 0; dy < size.height; dy += 1) {
            for (let dx = 0; dx < size.width; dx += 1) {
              this.surface.setPixel(pos.x + dx, pos.y + dy, bg);
            }
          }
        }
    
        drawKolibriText(this.surface, pos.x, pos.y, color, textInfo, scale);
        this.presentIfNeeded();
      },

      drawImageFromMemory(srcPtr, size, pos, bpp, palettePtr, rowStride) {
        const width = (size >>> 16) & 0xffff;
        const height = size & 0xffff;
        const x0 = unpackSignedHigh16(pos);
        const y0 = unpackSignedLow16(pos);
        if (!srcPtr || width === 0 || height === 0) {
          return;
        }
        this.autoFitContentRect(x0, y0, width, height);
    
        const pos0 = this.applyWindowOffset(x0, y0);
        const baseX = pos0.x;
        const baseY = pos0.y;
        const rowBytes = this.defaultImageStride(width, bpp);
        const stride = (rowBytes + (rowStride | 0)) | 0;
        if (rowBytes <= 0 || stride <= 0) {
          return;
        }
    
        if (this.traceSyscalls || this.traceImages) {
          this.imageDrawCount += 1;
          const hash = this.sampleImageHash(srcPtr, stride, width, height);
          const palHash = palettePtr ? this.samplePaletteHash(palettePtr, bpp) : 0;
          const shouldLog = this.imageDrawCount === 1 || this.imageDrawCount % 10 === 0;
          if (shouldLog) {
            const changed =
              this.lastImageHash === null ||
              this.lastPaletteHash === null ||
              hash !== this.lastImageHash ||
              palHash !== this.lastPaletteHash;
            this.lastImageHash = hash;
            this.lastPaletteHash = palHash;
            this.log(
              `image bpp=${bpp} src=0x${srcPtr.toString(16)} pal=0x${palettePtr.toString(16)} stride=${stride} rowofs=${rowStride | 0} pos=(${x0},${y0}) hash=0x${hash.toString(16)} palhash=0x${palHash.toString(16)}${changed ? "" : " (unchanged)"}`
            );
          }
        }
    
        if (bpp === 24 && this.blit24ToSurfaceBuffer(srcPtr, width, height, baseX, baseY, stride)) {
          if (!this.inRedraw) {
            this.presentIfNeeded();
          }
          return;
        }
    
        for (let y = 0; y < height; y += 1) {
          const rowBase = (srcPtr + y * stride) >>> 0;
          if (bpp === 1 || bpp === 2 || bpp === 4) {
            const bitsPerPixel = bpp;
            const pixelsPerByte = 8 / bitsPerPixel;
            for (let x = 0; x < width; x += 1) {
              const byteIndex = Math.floor(x / pixelsPerByte);
              const bitIndex = x % pixelsPerByte;
              const byte = this.readMem8((rowBase + byteIndex) >>> 0);
              const shift = (pixelsPerByte - 1 - bitIndex) * bitsPerPixel;
              const mask = (1 << bitsPerPixel) - 1;
              const idx = (byte >> shift) & mask;
              let color = 0;
              if (palettePtr) {
                color = this.readMem32((palettePtr + idx * 4) >>> 0) & 0x00ffffff;
              } else {
                const v = (idx * 255) / mask;
                color = ((v & 0xff) << 16) | ((v & 0xff) << 8) | (v & 0xff);
              }
              this.surface.setPixel(baseX + x, baseY + y, color);
            }
            continue;
          }
    
          if (bpp === 8 || bpp === 9) {
            for (let x = 0; x < width; x += 1) {
              const idx = this.readMem8((rowBase + x) >>> 0);
              let color = 0;
              if (bpp === 9 || !palettePtr) {
                color = ((idx & 0xff) << 16) | ((idx & 0xff) << 8) | (idx & 0xff);
              } else {
                color = this.readMem32((palettePtr + idx * 4) >>> 0) & 0x00ffffff;
              }
              this.surface.setPixel(baseX + x, baseY + y, color);
            }
            continue;
          }
    
          if (bpp === 15 || bpp === 16) {
            for (let x = 0; x < width; x += 1) {
              const value = this.readMem16((rowBase + x * 2) >>> 0);
              let r = 0;
              let g = 0;
              let b = 0;
              if (bpp === 15) {
                r = (value >> 10) & 0x1f;
                g = (value >> 5) & 0x1f;
                b = value & 0x1f;
                r = (r << 3) | (r >> 2);
                g = (g << 3) | (g >> 2);
                b = (b << 3) | (b >> 2);
              } else {
                r = (value >> 11) & 0x1f;
                g = (value >> 5) & 0x3f;
                b = value & 0x1f;
                r = (r << 3) | (r >> 2);
                g = (g << 2) | (g >> 4);
                b = (b << 3) | (b >> 2);
              }
              const color = (r << 16) | (g << 8) | b;
              this.surface.setPixel(baseX + x, baseY + y, color);
            }
            continue;
          }
    
          if (bpp === 24) {
            for (let x = 0; x < width; x += 1) {
              const base = (rowBase + x * 3) >>> 0;
              const b = this.readMem8(base);
              const g = this.readMem8((base + 1) >>> 0);
              const r = this.readMem8((base + 2) >>> 0);
              const color = (r << 16) | (g << 8) | b;
              this.surface.setPixel(baseX + x, baseY + y, color);
            }
            continue;
          }
    
          if (bpp === 32) {
            for (let x = 0; x < width; x += 1) {
              const value = this.readMem32((rowBase + x * 4) >>> 0);
              const color = value & 0x00ffffff;
              this.surface.setPixel(baseX + x, baseY + y, color);
            }
            continue;
          }
        }
        if (!this.inRedraw) {
          this.presentIfNeeded();
        }
      },

      canBlitDirectToSurface(baseX, baseY, width, height) {
        if (!this.surface || !this.surface.buffer32) {
          return false;
        }
        if (baseX < 0 || baseY < 0 || width <= 0 || height <= 0) {
          return false;
        }
        const surfaceWidth = this.surface.width | 0;
        const surfaceHeight = this.surface.height | 0;
        return baseX + width <= surfaceWidth && baseY + height <= surfaceHeight;
      },

      blit24ToSurfaceBuffer(srcPtr, width, height, baseX, baseY, stride) {
        if (!this.cpu || !this.canBlitDirectToSurface(baseX, baseY, width, height)) {
          return false;
        }
        const mem = this.cpu.mem;
        const start = srcPtr >>> 0;
        const rowSpan = width * 3;
        const lastRowBase = start + Math.max(0, height - 1) * stride;
        if (start >= mem.length || lastRowBase + rowSpan > mem.length) {
          return false;
        }
        const dst = this.surface.buffer32;
        const dstStride = this.surface.width | 0;
        let srcRow = start;
        let dstRow = baseY * dstStride + baseX;
        for (let y = 0; y < height; y += 1) {
          let src = srcRow;
          let out = dstRow;
          for (let x = 0; x < width; x += 1) {
            const b = mem[src++];
            const g = mem[src++];
            const r = mem[src++];
            dst[out++] = (255 << 24) | (b << 16) | (g << 8) | r;
          }
          srcRow += stride;
          dstRow += dstStride;
        }
        return true;
      },

      sysDrawImage() {
        const srcPtr = this.readReg(REG.EBX) >>> 0;
        const size = this.readReg(REG.ECX) >>> 0;
        const pos = this.readReg(REG.EDX) >>> 0;
        this.drawImageFromMemory(srcPtr, size, pos, 24, 0, 0);
      },

      sysGetImage() {
        const dstPtr = this.readReg(REG.EBX) >>> 0;
        const size = this.readReg(REG.ECX) >>> 0;
        const pos = this.readReg(REG.EDX) >>> 0;
        const width = (size >>> 16) & 0xffff;
        const height = size & 0xffff;
        const x = unpackSignedHigh16(pos);
        const y = unpackSignedLow16(pos);
        if (!dstPtr || width === 0 || height === 0) {
          return;
        }
        this.copySurfaceRegion24(dstPtr, width, height, x, y);
      },

      sysDefineButton() {
        const ebx = this.readReg(REG.EBX) >>> 0;
        const ecx = this.readReg(REG.ECX) >>> 0;
        const edx = this.readReg(REG.EDX) >>> 0;
        const color = this.readReg(REG.ESI) & 0x00ffffff;
        const id = edx & 0x00ffffff;

        if ((edx & 0x80000000) !== 0) {
          this.deleteDefinedButtons(id);
          return;
        }

        const x = ebx >> 16;
        const y = ecx >> 16;
        const width = ebx & 0xffff;
        const height = ecx & 0xffff;
        if (width <= 0 || height <= 0 || width >= 0x8000 || height >= 0x8000) {
          return;
        }

        const button = {
          serial: this.nextButtonSerial >>> 0,
          id,
          x: x | 0,
          y: y | 0,
          width: width | 0,
          height: height | 0,
          color,
          hidden: (edx & 0x40000000) !== 0,
          noPressFrame: (edx & 0x20000000) !== 0
        };
        this.nextButtonSerial = (this.nextButtonSerial + 1) >>> 0;
        this.buttons.push(button);
        this.autoFitContentRect(x, y, width, height);
        if (!button.hidden) {
          this.drawDefinedButton(button);
          this.presentIfNeeded();
        }
      },

      sysGetButton() {
        if (!this.hasPendingButtonEvent()) {
          if ((this.pendingButtonResult >>> 0) === 1) {
            this.removeQueuedEvent(3);
          }
          this.writeReg(REG.EAX, 1);
          return;
        }
        const value = this.pendingButtonResult >>> 0;
        this.writeReg(REG.EAX, value);
        this.pendingButtonResult = 1;
        this.removeQueuedEvent(3);
      },

      getProcessMemoryCapacity() {
        const current = this.memLimit >>> 0;
        const growMax = typeof this.getEffectiveMemGrowMax === "function"
          ? (this.getEffectiveMemGrowMax() >>> 0)
          : (this.memGrowMax >>> 0);
        if (growMax > current) {
          return growMax >>> 0;
        }
        return current >>> 0;
      },

      getEffectiveMemGrowMax() {
        let max = this.memGrowMax >>> 0;
        if (this.hostSession && typeof this.hostSession.getReportedTotalRamBytes === "function") {
          const hostTotal = Number(this.hostSession.getReportedTotalRamBytes());
          if (hostTotal > 0) {
            const bounded = align4k(Math.max(0, Math.min(0xffffffff, Math.floor(hostTotal)))) >>> 0;
            if (bounded > max) {
              max = bounded >>> 0;
            }
          }
        }
        return max >>> 0;
      },

      getHeapBaseForMemoryCapacity(memoryCap) {
        const cap = memoryCap >>> 0;
        if (!cap) {
          return 0;
        }
        if (this.heapEnabled) {
          return Math.min(cap, this.heapBase >>> 0) >>> 0;
        }
        const reservedSize = Math.max(
          this.processReservedSize >>> 0,
          this.image ? (this.image.header.memorySize >>> 0) : 0,
          this.stackBase >>> 0
        ) >>> 0;
        return align4k(Math.min(cap, reservedSize)) >>> 0;
      },

      roundDownToAllocSize(bytes) {
        const value = bytes >>> 0;
        return (value & ~0xfff) >>> 0;
      },

      alignProcessHeapSize(bytes) {
        const value = bytes >>> 0;
        if (!value) {
          return 0;
        }
        return ((value + 15) & ~15) >>> 0;
      },

      getCommittedProcessMemoryBytes() {
        let committed = Math.max(
          this.processReservedSize >>> 0,
          this.stackBase >>> 0,
          this.image && this.image.header ? (this.image.header.memorySize >>> 0) : 0
        ) >>> 0;
        if (this.heapEnabled) {
          committed = Math.max(
            committed >>> 0,
            this.heapTop >>> 0,
            this.heapLowTop >>> 0
          ) >>> 0;
        }
        if (!committed) {
          committed = 0x10000;
        }
        return align4k(committed >>> 0) >>> 0;
      },

      getReportedFreeRamBytes() {
        if (this.hostSession && typeof this.hostSession.getReportedFreeRamBytes === "function") {
          const hostFree = Number(this.hostSession.getReportedFreeRamBytes());
          if (hostFree > 0) {
            return Math.max(0, Math.min(0xffffffff, Math.floor(hostFree))) >>> 0;
          }
        }
        const cap = this.getProcessMemoryCapacity();
        if (!cap) {
          return 0;
        }
        if (!this.heapEnabled) {
          const heapBase = this.getHeapBaseForMemoryCapacity(cap);
          if (heapBase >= cap) {
            return 0;
          }
          return this.roundDownToAllocSize((cap - heapBase) >>> 0);
        }
        return this.getLargestHeapFreeBlockSize(cap);
      },

      getReportedTotalRamBytes() {
        if (this.hostSession && typeof this.hostSession.getReportedTotalRamBytes === "function") {
          const hostTotal = Number(this.hostSession.getReportedTotalRamBytes());
          if (hostTotal > 0) {
            return Math.max(0, Math.min(0xffffffff, Math.floor(hostTotal))) >>> 0;
          }
        }
        const cap = this.getProcessMemoryCapacity();
        if (!cap) {
          return 0;
        }
        const heapBase = this.getHeapBaseForMemoryCapacity(cap);
        if (heapBase >= cap) {
          return 0;
        }
        return this.roundDownToAllocSize((cap - heapBase) >>> 0);
      },

      getLargestHeapFreeBlockSize(memoryCap) {
        const cap = memoryCap >>> 0;
        if (!cap) {
          return 0;
        }
        let largest = 0;
        const heapTop = Math.min(cap, Math.max(this.heapBase >>> 0, this.heapLowTop >>> 0)) >>> 0;
        if (heapTop < cap) {
          largest = (cap - heapTop) >>> 0;
        }
        const blocks = Array.isArray(this.heapFreeBlocks) ? this.heapFreeBlocks : [];
        for (let i = 0; i < blocks.length; i += 1) {
          const block = blocks[i] || null;
          if (!block) {
            continue;
          }
          const size = block.size >>> 0;
          if (size > largest) {
            largest = size >>> 0;
          }
        }
        return this.roundDownToAllocSize(largest >>> 0);
      },

      sysSetWindowShape() {
        const sub = this.readReg(REG.EBX) >>> 0;
        if (sub === 0) {
          this.windowShapePtr = this.readReg(REG.ECX) >>> 0;
          if (typeof this.updateWindowShape === "function") {
            this.updateWindowShape();
          }
          return;
        }
        if (sub === 1) {
          this.windowShapeScale = this.readReg(REG.ECX) & 0xff;
          if (typeof this.updateWindowShape === "function") {
            this.updateWindowShape();
          }
        }
      },

      sysDrawImagePalette() {
        const srcPtr = this.readReg(REG.EBX) >>> 0;
        const size = this.readReg(REG.ECX) >>> 0;
        const pos = this.readReg(REG.EDX) >>> 0;
        const bpp = this.readReg(REG.ESI) >>> 0;
        const palettePtr = this.readReg(REG.EDI) >>> 0;
        const rowStride = this.readReg(REG.EBP) | 0;
        this.drawImageFromMemory(srcPtr, size, pos, bpp, palettePtr, rowStride);
      },

      defaultImageStride(width, bpp) {
        switch (bpp) {
          case 1: return Math.ceil(width / 8);
          case 2: return Math.ceil(width / 4);
          case 4: return Math.ceil(width / 2);
          case 8:
          case 9: return width;
          case 15:
          case 16: return width * 2;
          case 24: return width * 3;
          case 32: return width * 4;
          default: return width;
        }
      },

      sampleImageHash(srcPtr, stride, width, height) {
        const rows = 8;
        const cols = 8;
        const stepY = Math.max(1, Math.floor(height / rows));
        const stepX = Math.max(1, Math.floor(width / cols));
        let hash = 2166136261 >>> 0;
        for (let ry = 0; ry < rows; ry += 1) {
          const y = Math.min(height - 1, ry * stepY);
          const base = (srcPtr + y * stride) >>> 0;
          for (let cx = 0; cx < cols; cx += 1) {
            const x = Math.min(width - 1, cx * stepX);
            const byte = this.readMem8((base + x) >>> 0);
            hash ^= byte;
            hash = Math.imul(hash, 16777619) >>> 0;
          }
        }
        return hash >>> 0;
      },

      samplePaletteHash(palettePtr, bpp) {
        if (!palettePtr || bpp > 8) {
          return 0;
        }
        const count = 1 << bpp;
        let hash = 2166136261 >>> 0;
        const step = Math.max(1, Math.floor(count / 16));
        for (let i = 0; i < 16; i += 1) {
          const idx = i * step;
          const color = this.readMem32((palettePtr + idx * 4) >>> 0) & 0x00ffffff;
          hash ^= color & 0xff;
          hash = Math.imul(hash, 16777619) >>> 0;
          hash ^= (color >>> 8) & 0xff;
          hash = Math.imul(hash, 16777619) >>> 0;
          hash ^= (color >>> 16) & 0xff;
          hash = Math.imul(hash, 16777619) >>> 0;
        }
        return hash >>> 0;
      },

      sysWaitEvent() {
        const event = this.dequeueEvent();
        if (event !== 0) {
          this.waitEventDeadlineAt = 0;
          this.writeReg(REG.EAX, event);
          return;
        }
        this.waitEventDeadlineAt = 0;
        this.repeatCurrentInstruction = true;
        this.requestYield(16, "wait");
      },

      sysWaitEventTimeout() {
        const timeout = this.readReg(REG.EBX) >>> 0;
        const event = this.dequeueEvent();
        if (event !== 0) {
          this.waitEventDeadlineAt = 0;
          this.writeReg(REG.EAX, event);
          return;
        }
        if (timeout === 0) {
          this.waitEventDeadlineAt = 0;
          this.writeReg(REG.EAX, 0);
          return;
        }
        const now = Date.now();
        if (!this.waitEventDeadlineAt) {
          this.waitEventDeadlineAt = now + Math.max(1, timeout * 10);
        }
        if (this.waitEventDeadlineAt <= now) {
          this.waitEventDeadlineAt = 0;
          this.writeReg(REG.EAX, 0);
          return;
        }
        const remaining = Math.max(0, this.waitEventDeadlineAt - now);
        if (remaining === 0) {
          this.waitEventDeadlineAt = 0;
          this.writeReg(REG.EAX, 0);
          return;
        }
        this.repeatCurrentInstruction = true;
        this.requestYield(Math.min(remaining, 1000), "wait");
      },

      sysCheckEvent() {
        const event = this.dequeueEvent();
        this.writeReg(REG.EAX, event);
      },

      sysSetEventMask() {
        const next = this.readReg(REG.EBX) >>> 0;
        const prev = this.eventMask >>> 0;
        this.eventMask = next >>> 0;
        this.writeReg(REG.EAX, prev >>> 0);
        const hadDesktopRedraw = ((prev >>> 4) & 1) !== 0;
        const wantsDesktopRedraw = ((next >>> 4) & 1) !== 0;
        if (
          wantsDesktopRedraw &&
          !hadDesktopRedraw &&
          this.hostSession &&
          typeof this.hostSession.redrawDesktopBackground === "function"
        ) {
          this.hostSession.redrawDesktopBackground();
        }
      },

      sysRedraw() {
        const ebx = this.readReg(REG.EBX) & 0xffff;
        if (ebx === 1) {
          this.inRedraw = true;
          this.resetDefinedButtons();
          return;
        }
        if (ebx === 2) {
          this.inRedraw = false;
          this.presentIfNeeded(true);
        }
      },

      sysDrawRect() {
        const ebx = this.readReg(REG.EBX);
        const ecx = this.readReg(REG.ECX);
        const edx = this.readReg(REG.EDX);
    
        const x = unpackSignedHigh16(ebx);
        const w = ebx & 0xffff;
        const y = unpackSignedHigh16(ecx);
        let h = ecx & 0xffff;
        const color = edx & 0x00ffffff;
    
        if (h === 0 && w !== 0) {
          if (this.lastDrawRectHeight > 0) {
            h = this.lastDrawRectHeight;
          } else {
            h = w;
          }
        }
        if (h > 0) {
          this.lastDrawRectHeight = h;
        }
        this.autoFitContentRect(x, y, w, h);
    
        const pos = this.applyWindowOffset(x, y);
        for (let dy = 0; dy < h; dy += 1) {
          for (let dx = 0; dx < w; dx += 1) {
            this.surface.setPixel(pos.x + dx, pos.y + dy, color);
          }
        }
        this.presentIfNeeded();
      },

      sysDrawLine() {
        const ebx = this.readReg(REG.EBX) >>> 0;
        const ecx = this.readReg(REG.ECX) >>> 0;
        const edx = this.readReg(REG.EDX) >>> 0;
        const x0 = unpackSignedHigh16(ebx);
        const x1 = unpackSignedLow16(ebx);
        const y0 = unpackSignedHigh16(ecx);
        const y1 = unpackSignedLow16(ecx);
        const color = edx & 0x00ffffff;
        this.autoFitContentRect(
          Math.min(x0, x1),
          Math.min(y0, y1),
          Math.abs(x1 - x0) + 1,
          Math.abs(y1 - y0) + 1
        );
        const p0 = this.applyWindowOffset(x0, y0);
        const p1 = this.applyWindowOffset(x1, y1);
    
        let dx = Math.abs(p1.x - p0.x);
        let sx = p0.x < p1.x ? 1 : -1;
        let dy = -Math.abs(p1.y - p0.y);
        let sy = p0.y < p1.y ? 1 : -1;
        let err = dx + dy;
    
        let x = p0.x;
        let y = p0.y;
        while (true) {
          this.surface.setPixel(x, y, color);
          if (x === p1.x && y === p1.y) {
            break;
          }
          const e2 = err << 1;
          if (e2 >= dy) {
            err += dy;
            x += sx;
          }
          if (e2 <= dx) {
            err += dx;
            y += sy;
          }
        }
        this.presentIfNeeded();
      },

      sysScreenSize() {
        const screen = this.getHostScreenInfo();
        const width = Math.max(0, (screen.width | 0) - 1) & 0xffff;
        const height = Math.max(0, (screen.height | 0) - 1) & 0xffff;
        const value = (width << 16) | height;
        this.writeReg(REG.EAX, value >>> 0);
      },

      sysPixelOwner() {
        const x = this.readReg(REG.EBX) | 0;
        const y = this.readReg(REG.ECX) | 0;
        let owner = 0;
        if (typeof this.getHostPixelOwnerAt === "function") {
          try {
            owner = this.getHostPixelOwnerAt(x | 0, y | 0) >>> 0;
          } catch (err) {
            this.log(`Host pixel owner lookup failed for ${x},${y}: ${err}`);
            owner = 0;
          }
        } else {
          owner = this.getFallbackPixelOwnerAt(x, y) >>> 0;
        }
        this.writeReg(REG.EAX, owner >>> 0);
      },

      sysPixelColor() {
        const encoded = this.readReg(REG.EBX) >>> 0;
        const screen = this.getHostScreenInfo();
        const screenWidth = screen.width | 0;
        const screenHeight = screen.height | 0;
        const x = screenWidth > 0 ? (encoded % screenWidth) : 0;
        const y = screenWidth > 0 ? Math.floor(encoded / screenWidth) : 0;
        let color = 0;
        if (x >= 0 && y >= 0 && x < screenWidth && y < screenHeight) {
          if (typeof this.getHostPixelColorAt === "function") {
            try {
              color = this.getHostPixelColorAt(x | 0, y | 0) >>> 0;
            } catch (err) {
              this.log(`Host pixel color lookup failed for ${x},${y}: ${err}`);
              color = 0;
            }
          } else {
            color = unpackSurfaceColor(this.getFallbackPackedPixelAt(x, y)) >>> 0;
          }
        }
        this.writeReg(REG.EAX, color & 0x00ffffff);
      },

      sysPci() {
        const sub = this.readReg(REG.EBX) & 0xff;
        const enabled = this.hostSession && typeof this.hostSession.getLowLevelPciAccessEnabled === "function"
          ? !!this.hostSession.getLowLevelPciAccessEnabled()
          : !!this.lowLevelPciAccessEnabled;
        if (!enabled) {
          this.writeReg(REG.EAX, 0xffffffff >>> 0);
          return;
        }
        switch (sub) {
          case 0:
            this.writeReg(REG.EAX, 0x00000100);
            return;
          case 1:
            this.writeReg(REG.EAX, 0);
            return;
          case 2:
            this.writeReg(REG.EAX, 1);
            return;
          case 4:
          case 5:
          case 6:
            this.writeReg(REG.EAX, 0xffffffff >>> 0);
            return;
          case 8:
          case 9:
          case 10:
            this.writeReg(REG.EAX, 0xffffffff >>> 0);
            return;
          default:
            this.writeReg(REG.EAX, 0xffffffff >>> 0);
            return;
        }
      },

      sysSetPorts() {
        const action = this.readReg(REG.EBX) >>> 0;
        const start = this.readReg(REG.ECX) >>> 0;
        const end = this.readReg(REG.EDX) >>> 0;
        if (
          start > 0xffff ||
          end > 0xffff ||
          start > end ||
          !this.portReservations ||
          typeof this.portReservations.has !== "function"
        ) {
          this.writeReg(REG.EAX, 1);
          return;
        }
        const key = `${start}:${end}`;
        if (action === 0) {
          if (this.portReservations.size >= 255 && !this.portReservations.has(key)) {
            this.writeReg(REG.EAX, 1);
            return;
          }
          for (const [rangeKey, range] of this.portReservations.entries()) {
            if (rangeKey === key) {
              continue;
            }
            if (start <= (range.end >>> 0) && end >= (range.start >>> 0)) {
              this.writeReg(REG.EAX, 1);
              return;
            }
          }
          this.portReservations.set(key, { start: start >>> 0, end: end >>> 0 });
          this.writeReg(REG.EAX, 0);
          return;
        }
        if (action === 1) {
          if (!this.portReservations.has(key)) {
            this.writeReg(REG.EAX, 1);
            return;
          }
          this.portReservations.delete(key);
          this.writeReg(REG.EAX, 0);
          return;
        }
        this.writeReg(REG.EAX, 1);
      },

      sysIpc() {
        const sub = this.readReg(REG.EBX) >>> 0;
        if (sub === 1) {
          const ptr = this.readReg(REG.ECX) >>> 0;
          const size = this.readReg(REG.EDX) >>> 0;
          if (typeof this.setHostIpcArea === "function") {
            this.setHostIpcArea(ptr >>> 0, size >>> 0);
          } else {
            this.ipcBufferPtr = ptr >>> 0;
            this.ipcBufferSize = size >>> 0;
          }
          this.writeReg(REG.EAX, 0);
          return;
        }
        if (sub === 2) {
          const targetPid = this.readReg(REG.ECX) >>> 0;
          const srcPtr = this.readReg(REG.EDX) >>> 0;
          const size = this.readReg(REG.ESI) >>> 0;
          const result = typeof this.sendHostIpcMessage === "function"
            ? (this.sendHostIpcMessage(targetPid >>> 0, srcPtr >>> 0, size >>> 0) >>> 0)
            : 4;
          this.writeReg(REG.EAX, result >>> 0);
          return;
        }
        if (!this.unknownSyscalls.has(6000 + sub)) {
          this.unknownSyscalls.add(6000 + sub);
          this.log(`Unhandled syscall 60 sub ${sub}`);
        }
        this.writeReg(REG.EAX, 4);
      },

      syncMappedDesktopBackground() {
        const ptr = this.desktopBackgroundMapPtr >>> 0;
        const size = this.desktopBackgroundMapSize >>> 0;
        if (!ptr || !size || !this.hostSession || typeof this.hostSession.setDesktopBackgroundBytes !== "function") {
          return false;
        }
        const bytes = this.readMemBlock(ptr, size);
        if (!(bytes instanceof Uint8Array) || bytes.length !== size) {
          return false;
        }
        return !!this.hostSession.setDesktopBackgroundBytes(bytes);
      },

      freeMappedDesktopBackground(ptr) {
        const addr = ptr >>> 0;
        if (!addr || !this.heapAllocs.has(addr)) {
          return false;
        }
        const size = this.heapAllocs.get(addr) >>> 0;
        this.heapAllocs.delete(addr);
        this.heapInsertFreeBlock(addr, size);
        if ((this.desktopBackgroundMapPtr >>> 0) === addr) {
          this.desktopBackgroundMapPtr = 0;
          this.desktopBackgroundMapSize = 0;
        }
        return true;
      },

      sysBackground() {
        const sub = this.readReg(REG.EBX) >>> 0;
        const session = this.hostSession || null;
        switch (sub) {
          case 1: {
            const width = this.readReg(REG.ECX) >>> 0;
            const height = this.readReg(REG.EDX) >>> 0;
            if (session && typeof session.setDesktopBackgroundSize === "function") {
              session.setDesktopBackgroundSize(width | 0, height | 0);
            }
            return;
          }
          case 2: {
            const offset = this.readReg(REG.ECX) >>> 0;
            const color = this.readReg(REG.EDX) & 0x00ffffff;
            if (session && typeof session.writeDesktopBackgroundPixel === "function") {
              session.writeDesktopBackgroundPixel(offset | 0, color >>> 0);
            }
            return;
          }
          case 3: {
            this.syncMappedDesktopBackground();
            if (session && typeof session.redrawDesktopBackground === "function") {
              session.redrawDesktopBackground();
            }
            return;
          }
          case 4: {
            const mode = this.readReg(REG.ECX) >>> 0;
            if (session && typeof session.setDesktopBackgroundMode === "function") {
              session.setDesktopBackgroundMode(mode | 0);
            }
            return;
          }
          case 5: {
            const ptr = this.readReg(REG.ECX) >>> 0;
            const offset = this.readReg(REG.EDX) >>> 0;
            const size = this.readReg(REG.ESI) >>> 0;
            const bytes = size ? this.readMemBlock(ptr, size) : new Uint8Array(0);
            if (bytes && session && typeof session.writeDesktopBackgroundBytes === "function") {
              session.writeDesktopBackgroundBytes(offset | 0, bytes);
            }
            return;
          }
          case 6: {
            if (!session || typeof session.getDesktopBackgroundBytes !== "function") {
              this.writeReg(REG.EAX, 0);
              return;
            }
            const bytes = session.getDesktopBackgroundBytes();
            if (!(bytes instanceof Uint8Array)) {
              this.writeReg(REG.EAX, 0);
              return;
            }
            if (!this.heapEnabled) {
              this.heapInit();
            }
            const allocSize = align4k(Math.max(1, bytes.length | 0));
            const ptr = this.heapAllocInternal(allocSize >>> 0);
            if (!ptr) {
              this.writeReg(REG.EAX, 0);
              return;
            }
            if (bytes.length) {
              this.writeMemBlock(ptr >>> 0, bytes);
            }
            this.desktopBackgroundMapPtr = ptr >>> 0;
            this.desktopBackgroundMapSize = bytes.length >>> 0;
            this.writeReg(REG.EAX, ptr >>> 0);
            return;
          }
          case 7: {
            const ptr = this.readReg(REG.ECX) >>> 0;
            if (!ptr || (ptr >>> 0) !== (this.desktopBackgroundMapPtr >>> 0)) {
              this.writeReg(REG.EAX, 0);
              return;
            }
            this.syncMappedDesktopBackground();
            this.writeReg(REG.EAX, this.freeMappedDesktopBackground(ptr >>> 0) ? 1 : 0);
            return;
          }
          case 8: {
            const info = session && typeof session.getDesktopBackgroundInfo === "function"
              ? (session.getDesktopBackgroundInfo() || null)
              : null;
            const rect = info && info.lastDraw ? info.lastDraw : { left: 0, top: 0, right: 0, bottom: 0 };
            this.writeReg(REG.EAX, ((((rect.left | 0) & 0xffff) << 16) | ((rect.right | 0) & 0xffff)) >>> 0);
            this.writeReg(REG.EBX, ((((rect.top | 0) & 0xffff) << 16) | ((rect.bottom | 0) & 0xffff)) >>> 0);
            return;
          }
          case 9: {
            this.syncMappedDesktopBackground();
            const ecx = this.readReg(REG.ECX) >>> 0;
            const edx = this.readReg(REG.EDX) >>> 0;
            const rect = {
              left: unpackSignedHigh16(ecx),
              right: unpackSignedLow16(ecx),
              top: unpackSignedHigh16(edx),
              bottom: unpackSignedLow16(edx)
            };
            if (session && typeof session.redrawDesktopBackground === "function") {
              session.redrawDesktopBackground(rect);
            }
            return;
          }
          default:
            if (!this.unknownSyscalls.has(1500 + sub)) {
              this.unknownSyscalls.add(1500 + sub);
              this.log(`Unhandled syscall 15 sub ${sub}`);
            }
            return;
        }
      },

      sysScreenPutImage() {
        const ptr = this.readReg(REG.EBX) >>> 0;
        const ecx = this.readReg(REG.ECX) >>> 0;
        const edx = this.readReg(REG.EDX) >>> 0;
        const width = (ecx >>> 16) & 0xffff;
        const height = ecx & 0xffff;
        const x = unpackSignedHigh16(edx);
        const y = unpackSignedLow16(edx);
        const size = Math.max(0, (width | 0) * (height | 0) * 4) >>> 0;
        const bytes = size ? this.readMemBlock(ptr, size) : null;
        if (bytes && this.hostSession && typeof this.hostSession.putDesktopImage === "function") {
          this.hostSession.putDesktopImage(
            bytes,
            width | 0,
            height | 0,
            x | 0,
            y | 0,
            this.threadSlot >>> 0
          );
        }
      },

      sysSystemSet() {
        const sub = this.readReg(REG.EBX) & 0xff;
        const session = this.hostSession || null;
        if (sub === 2) {
          const kind = this.readReg(REG.ECX) >>> 0;
          if (kind === 9) {
            if (session && typeof session.setKeyboardLanguageId === "function") {
              session.setKeyboardLanguageId(this.readReg(REG.EDX) >>> 0);
            }
            this.writeReg(REG.EAX, 0);
            return;
          }
          const ptr = this.readReg(REG.EDX) >>> 0;
          const bytes = ptr ? this.readMemBlock(ptr, 128) : null;
          if (!bytes || (kind >>> 0) < 1 || (kind >>> 0) > 3) {
            this.writeReg(REG.EAX, 0xffffffff >>> 0);
            return;
          }
          if (session && typeof session.setKeyboardLayout === "function") {
            session.setKeyboardLayout(kind | 0, bytes);
          }
          this.writeReg(REG.EAX, 0);
          return;
        }
        if (sub === 5) {
          if (session && typeof session.setSystemLanguageId === "function") {
            session.setSystemLanguageId(this.readReg(REG.ECX) >>> 0);
          }
          this.writeReg(REG.EAX, 0);
          return;
        }
        if (sub === 11) {
          const enabled = (this.readReg(REG.ECX) & 1) !== 0;
          if (session && typeof session.setLowLevelHdAccessEnabled === "function") {
            session.setLowLevelHdAccessEnabled(enabled);
          } else {
            this.lowLevelHdAccessEnabled = enabled;
          }
          this.writeReg(REG.EAX, 0);
          return;
        }
        if (sub === 12) {
          const enabled = (this.readReg(REG.ECX) & 1) !== 0;
          if (session && typeof session.setLowLevelPciAccessEnabled === "function") {
            session.setLowLevelPciAccessEnabled(enabled);
          } else {
            this.lowLevelPciAccessEnabled = enabled;
          }
          this.writeReg(REG.EAX, 0);
          return;
        }
        if (!this.unknownSyscalls.has(2100 + sub)) {
          this.unknownSyscalls.add(2100 + sub);
          this.log(`Unhandled syscall 21 sub ${sub}`);
        }
        this.writeReg(REG.EAX, 0);
      },

      sysSystem() {
        const sub = this.readReg(REG.EBX) & 0xff;
        switch (sub) {
          case 1: {
            const slot = this.readReg(REG.ECX) >>> 0;
            const active = this.unfocusHostThreadSlot ? this.unfocusHostThreadSlot(slot >>> 0) : (this.threadSlot >>> 0);
            this.writeReg(REG.EAX, active >>> 0);
            return;
          }
          case 2: {
            const slot = this.readReg(REG.ECX) >>> 0;
            if (slot === (this.threadSlot >>> 0) || slot === 0xffffffff) {
              this.sysTerminate();
              this.writeReg(REG.EAX, 0);
              return;
            }
            const terminated = this.terminateHostThreadSlot ? this.terminateHostThreadSlot(slot >>> 0) : false;
            this.writeReg(REG.EAX, terminated ? 0 : (0xffffffff >>> 0));
            return;
          }
          case 3: {
            const slot = this.readReg(REG.ECX) >>> 0;
            const active = this.focusHostThreadSlot ? this.focusHostThreadSlot(slot >>> 0) : (this.threadSlot >>> 0);
            this.writeReg(REG.EAX, active >>> 0);
            return;
          }
          case 4: {
            const idle = this.hostSession && typeof this.hostSession.getIdleCount === "function"
              ? (this.hostSession.getIdleCount() >>> 0)
              : 0;
            this.writeReg(REG.EAX, idle >>> 0);
            return;
          }
          case 5:
            this.writeReg(REG.EAX, this.getReportedCpuFrequencyHz() >>> 0);
            return;
          case 6:
            this.writeReg(REG.EAX, 2);
            return;
          case 7: {
            const active = this.getHostActiveThreadSlot ? this.getHostActiveThreadSlot() : (this.threadSlot >>> 0);
            this.writeReg(REG.EAX, active >>> 0);
            return;
          }
          case 8: {
            const action = this.readReg(REG.ECX) >>> 0;
            if (action === 1) {
              const disabled = this.hostSession && typeof this.hostSession.getSpeakerDisabled === "function"
                ? !!this.hostSession.getSpeakerDisabled()
                : !!this.speakerDisabled;
              this.writeReg(REG.EAX, disabled ? 1 : 0);
              return;
            }
            if (action === 2) {
              if (this.hostSession && typeof this.hostSession.toggleSpeakerDisabled === "function") {
                this.hostSession.toggleSpeakerDisabled();
              } else {
                this.speakerDisabled = !this.speakerDisabled;
              }
              return;
            }
            break;
          }
          case 9: {
            const action = this.readReg(REG.ECX) >>> 0;
            if (action !== 2 && action !== 3 && action !== 4) {
              return;
            }
            this.systemShutdownAction = action >>> 0;
            if (this.hostSession && typeof this.hostSession.requestSystemAction === "function") {
              this.hostSession.requestSystemAction(action >>> 0);
            }
            this.writeReg(REG.EAX, 0);
            return;
          }
          case 10:
            if (this.hostSession && typeof this.hostSession.minimizeTopWindow === "function") {
              this.hostSession.minimizeTopWindow();
            }
            this.writeReg(REG.EAX, 0);
            return;
          case 11: {
            const type = this.readReg(REG.ECX) >>> 0;
            const ptr = this.readReg(REG.EDX) >>> 0;
            if (type !== 1 || !ptr) {
              this.writeReg(REG.EAX, 0xffffffff >>> 0);
              return;
            }
            const info = new Uint8Array(16);
            this.writeMemBlock(ptr, info);
            this.writeReg(REG.EAX, 0);
            return;
          }
          case 13: {
            const ptr = this.readReg(REG.ECX) >>> 0;
            if (!ptr) {
              this.writeReg(REG.EAX, 0xffffffff >>> 0);
              return;
            }
            const info = new Uint8Array(16);
            const view = new DataView(info.buffer);
            info[0] = 0;
            info[1] = 7;
            info[2] = 7;
            view.setUint16(6, 40, true);
            view.setUint32(8, 0xf26d5b28, true);
            view.setUint16(14, 1675, true);
            try {
              this.writeMemBlock(ptr, info);
              this.writeReg(REG.EAX, 0);
            } catch (err) {
              this.writeReg(REG.EAX, 0xffffffff >>> 0);
            }
            return;
          }
          case 14:
            this.writeReg(REG.EAX, 0);
            return;
          case 15: {
            const centerX = Math.max(0, ((this.surface.width | 0) / 2) | 0);
            const centerY = Math.max(0, ((this.surface.height | 0) / 2) | 0);
            this.setMousePosition(centerX, centerY, true, centerX, centerY);
            this.writeReg(REG.EAX, 0);
            return;
          }
          case 16:
            this.writeReg(REG.EAX, (this.getReportedFreeRamBytes() >>> 10) >>> 0);
            return;
          case 17:
            this.writeReg(REG.EAX, (this.getReportedTotalRamBytes() >>> 10) >>> 0);
            return;
          case 18: {
            const pid = this.readReg(REG.ECX) >>> 0;
            if (pid === (this.processId >>> 0) && pid !== 0) {
              this.sysTerminate();
              this.writeReg(REG.EAX, 0);
              return;
            }
            const terminated = this.terminateHostProcessId ? this.terminateHostProcessId(pid >>> 0) : false;
            this.writeReg(REG.EAX, terminated ? 0 : (0xffffffff >>> 0));
            return;
          }
          case 19: {
            const mode = this.readReg(REG.ECX) >>> 0;
            switch (mode) {
              case 0:
                this.writeReg(REG.EAX, (this.mouseSpeedDivider | 0) >>> 0);
                return;
              case 1:
                this.mouseSpeedDivider = Math.max(1, this.readReg(REG.EDX) >>> 0) >>> 0;
                this.writeReg(REG.EAX, 0);
                return;
              case 2:
                this.writeReg(REG.EAX, (this.mouseSensitivity | 0) >>> 0);
                return;
              case 3:
                this.mouseSensitivity = Math.max(1, this.readReg(REG.EDX) >>> 0) >>> 0;
                this.writeReg(REG.EAX, 0);
                return;
              case 4: {
                const pos = this.readReg(REG.EDX) >>> 0;
                const x = unpackSignedHigh16(pos);
                const y = unpackSignedLow16(pos);
                this.setMousePosition(x, y, true, x, y);
                this.writeReg(REG.EAX, 0);
                return;
              }
              case 5:
                this.mouseButtons = this.readReg(REG.EDX) & 0x1f;
                this.writeReg(REG.EAX, 0);
                return;
              case 6:
                this.writeReg(REG.EAX, (this.mouseDoubleClickDelay | 0) >>> 0);
                return;
              case 7:
                this.mouseDoubleClickDelay = Math.max(1, this.readReg(REG.EDX) & 0xff) >>> 0;
                this.writeReg(REG.EAX, 0);
                return;
              default:
                break;
            }
            break;
          }
          case 20: {
            const ptr = this.readReg(REG.ECX) >>> 0;
            if (!ptr) {
              this.writeReg(REG.EAX, 0xffffffff >>> 0);
              return;
            }
            const totalPages = (this.getReportedTotalRamBytes() >>> 12) >>> 0;
            const freePages = (this.getReportedFreeRamBytes() >>> 12) >>> 0;
            const info = new Uint8Array(36);
            const view = new DataView(info.buffer);
            view.setUint32(0, totalPages >>> 0, true);
            view.setUint32(4, freePages >>> 0, true);
            view.setUint32(8, freePages >>> 0, true);
            view.setUint32(12, 0, true);
            view.setUint32(16, 0, true);
            view.setUint32(20, 0, true);
            view.setUint32(24, 0, true);
            view.setUint32(28, 0, true);
            view.setUint32(32, 0, true);
            this.writeMemBlock(ptr, info);
            this.writeReg(REG.EAX, totalPages >>> 0);
            return;
          }
          case 21: {
            const pid = this.readReg(REG.ECX) >>> 0;
            const slot = this.getHostThreadSlotByProcessId
              ? (this.getHostThreadSlotByProcessId(pid >>> 0) >>> 0)
              : ((pid >>> 0) === (this.processId >>> 0) ? (this.threadSlot >>> 0) : 0);
            this.writeReg(REG.EAX, slot >>> 0);
            return;
          }
          case 22: {
            const action = this.readReg(REG.ECX) >>> 0;
            const value = this.readReg(REG.EDX) >>> 0;
            let result = 0xffffffff >>> 0;
            if (this.hostSession && typeof this.hostSession.controlForeignWindow === "function") {
              result = this.hostSession.controlForeignWindow(action >>> 0, value >>> 0) >>> 0;
            }
            this.writeReg(REG.EAX, result >>> 0);
            return;
          }
          case 23:
            if (this.hostSession && typeof this.hostSession.minimizeAllWindows === "function") {
              this.writeReg(REG.EAX, this.hostSession.minimizeAllWindows() >>> 0);
              return;
            }
            this.writeReg(REG.EAX, 0);
            return;
          case 24:
            this.screenLimitX = this.readReg(REG.ECX) >>> 0;
            this.screenLimitY = this.readReg(REG.EDX) >>> 0;
            if (this.hostSession && typeof this.hostSession.setScreenLimits === "function") {
              this.hostSession.setScreenLimits(this.screenLimitX >>> 0, this.screenLimitY >>> 0);
            }
            return;
          case 25: {
            const action = this.readReg(REG.ECX) >>> 0;
            const pidRaw = this.readReg(REG.EDX) >>> 0;
            const targetPid = pidRaw === (0xffffffff >>> 0) ? (this.processId >>> 0) : (pidRaw >>> 0);
            if (action === 1) {
              const pos = this.hostSession && typeof this.hostSession.getWindowPositionMode === "function"
                ? this.hostSession.getWindowPositionMode(targetPid >>> 0)
                : 0;
              this.writeReg(REG.EAX, pos >>> 0);
              return;
            }
            if (action === 2) {
              const position = this.readReg(REG.ESI) | 0;
              const ok = this.hostSession && typeof this.hostSession.setWindowPositionMode === "function"
                ? this.hostSession.setWindowPositionMode(targetPid >>> 0, position | 0)
                : false;
              this.writeReg(REG.EAX, ok ? 1 : 0);
              return;
            }
            break;
          }
          default:
            break;
        }
        if (!this.unknownSyscalls.has(1800 + sub)) {
          this.unknownSyscalls.add(1800 + sub);
          this.log(`Unhandled syscall 18 sub ${sub}`);
        }
        this.writeReg(REG.EAX, 0);
      },

      getFutexState() {
        if (!this.futexState || !(this.futexState.handles instanceof Map)) {
          this.futexState = {
            nextHandle: 1,
            handles: new Map()
          };
        }
        if (!Number.isFinite(this.futexState.nextHandle) || (this.futexState.nextHandle | 0) <= 0) {
          this.futexState.nextHandle = 1;
        }
        return this.futexState;
      },

      sysFutex() {
        const sub = this.readReg(REG.EBX) >>> 0;
        const state = this.getFutexState();
        const handles = state.handles;
        switch (sub) {
          case 0: {
            let handle = state.nextHandle >>> 0;
            if (!handle) {
              handle = 1;
            }
            while (handles.has(handle >>> 0)) {
              handle = (handle + 1) >>> 0;
              if (!handle) {
                handle = 1;
              }
            }
            handles.set(handle >>> 0, {
              control: this.readReg(REG.ECX) >>> 0,
              waiters: 0
            });
            state.nextHandle = ((handle + 1) >>> 0) || 1;
            this.writeReg(REG.EAX, handle >>> 0);
            return;
          }
          case 1: {
            const handle = this.readReg(REG.ECX) >>> 0;
            const removed = handles.delete(handle >>> 0);
            this.writeReg(REG.EAX, removed ? 0 : (0xffffffff >>> 0));
            return;
          }
          case 2: {
            const handle = this.readReg(REG.ECX) >>> 0;
            const expected = this.readReg(REG.EDX) >>> 0;
            const timeout = this.readReg(REG.ESI) >>> 0;
            const entry = handles.get(handle >>> 0) || null;
            if (!entry || (entry.control >>> 0) !== expected) {
              this.writeReg(REG.EAX, 0xfffffffe >>> 0);
              return;
            }
            if (timeout) {
              this.requestYield(Math.min(timeout * 10, 1000), "sleep");
            }
            this.writeReg(REG.EAX, 0);
            return;
          }
          case 3: {
            const handle = this.readReg(REG.ECX) >>> 0;
            const entry = handles.get(handle >>> 0) || null;
            if (!entry) {
              this.writeReg(REG.EAX, 0);
              return;
            }
            const limit = this.readReg(REG.EDX) >>> 0;
            const woken = Math.max(0, Math.min(entry.waiters | 0, limit)) >>> 0;
            entry.waiters = Math.max(0, (entry.waiters | 0) - (woken | 0)) | 0;
            this.writeReg(REG.EAX, woken >>> 0);
            return;
          }
          case 10: {
            const pipes = this.getPipeState();
            const fd = this.readReg(REG.ECX) >>> 0;
            const dstPtr = this.readReg(REG.EDX) >>> 0;
            const size = this.readReg(REG.ESI) >>> 0;
            const fdEntry = pipes.fds.get(fd >>> 0) || null;
            if (!fdEntry || fdEntry.kind !== "read") {
              this.writeReg(REG.EAX, (-9) >>> 0);
              return;
            }
            const pipe = pipes.pipes.get(fdEntry.pipeId >>> 0) || null;
            if (!pipe) {
              this.writeReg(REG.EAX, (-9) >>> 0);
              return;
            }
            const count = Math.min(size, pipe.buffer.length) >>> 0;
            if (count && dstPtr) {
              this.writeMemBlock(dstPtr, pipe.buffer.subarray(0, count));
            }
            pipe.buffer = count >= pipe.buffer.length ? new Uint8Array(0) : pipe.buffer.subarray(count);
            this.writeReg(REG.EAX, count >>> 0);
            return;
          }
          case 11: {
            const pipes = this.getPipeState();
            const fd = this.readReg(REG.ECX) >>> 0;
            const srcPtr = this.readReg(REG.EDX) >>> 0;
            const size = this.readReg(REG.ESI) >>> 0;
            const fdEntry = pipes.fds.get(fd >>> 0) || null;
            if (!fdEntry || fdEntry.kind !== "write") {
              this.writeReg(REG.EAX, (-9) >>> 0);
              return;
            }
            const pipe = pipes.pipes.get(fdEntry.pipeId >>> 0) || null;
            if (!pipe) {
              this.writeReg(REG.EAX, (-9) >>> 0);
              return;
            }
            if (!pipe.readerOpen) {
              this.writeReg(REG.EAX, (-32) >>> 0);
              return;
            }
            const bytes = size ? (this.readMemBlock(srcPtr, size) || new Uint8Array(0)) : new Uint8Array(0);
            const next = new Uint8Array(pipe.buffer.length + bytes.length);
            next.set(pipe.buffer, 0);
            next.set(bytes, pipe.buffer.length);
            pipe.buffer = next;
            this.writeReg(REG.EAX, bytes.length >>> 0);
            return;
          }
          case 12:
            this.writeReg(REG.EAX, 0xfffffff7 >>> 0);
            return;
          case 13: {
            const pipes = this.getPipeState();
            const ptr = this.readReg(REG.ECX) >>> 0;
            if (!ptr) {
              this.writeReg(REG.EAX, (-14) >>> 0);
              return;
            }
            let readFd = pipes.nextFd >>> 0;
            let writeFd = (readFd + 1) >>> 0;
            pipes.nextFd = (writeFd + 1) >>> 0;
            const pipeId = pipes.nextPipeId >>> 0;
            pipes.nextPipeId = ((pipeId + 1) >>> 0) || 1;
            pipes.pipes.set(pipeId >>> 0, {
              buffer: new Uint8Array(0),
              readerOpen: true,
              writerOpen: true
            });
            pipes.fds.set(readFd >>> 0, { pipeId: pipeId >>> 0, kind: "read" });
            pipes.fds.set(writeFd >>> 0, { pipeId: pipeId >>> 0, kind: "write" });
            this.writeMem32(ptr >>> 0, readFd >>> 0);
            this.writeMem32((ptr + 4) >>> 0, writeFd >>> 0);
            this.writeReg(REG.EAX, 0);
            return;
          }
          default:
            if (sub >= 4 && sub <= 7) {
              this.writeReg(REG.EAX, 0xffffffff >>> 0);
              return;
            }
            if (sub === 8 || sub === 9) {
              this.writeReg(REG.EAX, 0xfffffff7 >>> 0);
              return;
            }
            if (!this.unknownSyscalls.has(7700 + sub)) {
              this.unknownSyscalls.add(7700 + sub);
              this.log(`Unhandled syscall 77 sub ${sub}`);
            }
            this.writeReg(REG.EAX, 0xffffffff >>> 0);
            return;
        }
      },

      sysSystemInfo() {
        const sub = this.readReg(REG.EBX) & 0xff;
        if (sub === 2) {
          const kind = this.readReg(REG.ECX) >>> 0;
          if (kind === 9) {
            const value = this.hostSession && typeof this.hostSession.getKeyboardLanguageId === "function"
              ? this.hostSession.getKeyboardLanguageId()
              : KEYBOARD_LANGUAGE_ID;
            this.writeReg(REG.EAX, value >>> 0);
            return;
          }
          const ptr = this.readReg(REG.EDX) >>> 0;
          let layout = this.hostSession && typeof this.hostSession.getKeyboardLayout === "function"
            ? this.hostSession.getKeyboardLayout(kind | 0)
            : null;
          if (!layout) {
            if (kind === 1) {
              layout = KEYBOARD_LAYOUT_NORMAL;
            } else if (kind === 2) {
              layout = KEYBOARD_LAYOUT_SHIFT;
            } else if (kind === 3) {
              layout = KEYBOARD_LAYOUT_ALT;
            }
          }
          if (!layout || !ptr) {
            this.writeReg(REG.EAX, 0xffffffff >>> 0);
            return;
          }
          try {
            this.writeMemBlock(ptr, layout);
            this.writeReg(REG.EAX, 0);
          } catch (err) {
            this.writeReg(REG.EAX, 0xffffffff >>> 0);
          }
          return;
        }
        if (sub === 5) {
          const value = this.hostSession && typeof this.hostSession.getSystemLanguageId === "function"
            ? this.hostSession.getSystemLanguageId()
            : KEYBOARD_LANGUAGE_ID;
          this.writeReg(REG.EAX, value >>> 0);
          return;
        }
        if (sub === 9) {
          const ticks = Math.floor(this.readTimeCounter32() / 10) >>> 0;
          this.writeReg(REG.EAX, ticks >>> 0);
          return;
        }
        if (sub === 10) {
          const ticks100 = BigInt(this.readTimeCounter32() >>> 0);
          const ns = ticks100 * 10000000n;
          this.writeReg(REG.EAX, Number(ns & 0xffffffffn) >>> 0);
          this.writeReg(REG.EDX, Number((ns >> 32n) & 0xffffffffn) >>> 0);
          return;
        }
        if (sub === 11) {
          const enabled = this.hostSession && typeof this.hostSession.getLowLevelHdAccessEnabled === "function"
            ? !!this.hostSession.getLowLevelHdAccessEnabled()
            : !!this.lowLevelHdAccessEnabled;
          this.writeReg(REG.EAX, enabled ? 1 : 0);
          return;
        }
        if (sub === 12) {
          const enabled = this.hostSession && typeof this.hostSession.getLowLevelPciAccessEnabled === "function"
            ? !!this.hostSession.getLowLevelPciAccessEnabled()
            : !!this.lowLevelPciAccessEnabled;
          this.writeReg(REG.EAX, enabled ? 1 : 0);
          return;
        }
        if (!this.unknownSyscalls.has(2600 + sub)) {
          this.unknownSyscalls.add(2600 + sub);
          this.log(`Unhandled syscall 26 sub ${sub}`);
        }
      },

      sysCurrentFolder() {
        const sub = this.readReg(REG.EBX) & 0xff;
        switch (sub) {
          case 1:
          case 4: {
            const ptr = this.readReg(REG.ECX) >>> 0;
            const encoding = sub === 4 ? (this.readReg(REG.EDX) & 0xff) : 1;
            const next = ptr ? this.resolveKosPath(this.readEncodedString(ptr, 4096, encoding)) : "";
            if (next) {
              this.currentFolder = next;
            }
            return;
          }
          case 2:
          case 5: {
            const ptr = this.readReg(REG.ECX) >>> 0;
            const size = this.readReg(REG.EDX) >>> 0;
            const encoding = sub === 5 ? (this.readReg(REG.ESI) & 0xff) : 1;
            const text = this.currentFolder || "/sys";
            if (ptr && size) {
              this.writeEncodedString(ptr, text, Math.max(1, size), encoding);
            }
            if (encoding === 2) {
              this.writeReg(REG.EAX, ((text.length * 2) + 2) >>> 0);
            } else if (encoding === 3 && UTF8_ENCODER) {
              this.writeReg(REG.EAX, (UTF8_ENCODER.encode(text).length + 1) >>> 0);
            } else {
              this.writeReg(REG.EAX, (text.length + 1) >>> 0);
            }
            return;
          }
          case 3: {
            const ptr = this.readReg(REG.ECX) >>> 0;
            if (!ptr) {
              return;
            }
            const key = this.readCString(ptr, 64).trim().toLowerCase();
            const rawPath = this.readCString((ptr + 64) >>> 0, 64).trim();
            if (!key || !rawPath) {
              return;
            }
            const path = this.resolveKosPath(rawPath.startsWith("/") ? rawPath : `/${rawPath}`);
            this.additionalSystemDirs.set(key, path);
            return;
          }
          default:
            if (!this.unknownSyscalls.has(3000 + sub)) {
              this.unknownSyscalls.add(3000 + sub);
              this.log(`Unhandled syscall 30 sub ${sub}`);
            }
            this.writeReg(REG.EAX, 0);
            return;
        }
      },

      sysMouse() {
        const sub = this.readReg(REG.EBX) & 0xff;
        switch (sub) {
          case 0: {
            const x = this.mouseScreenX | 0;
            const y = this.mouseScreenY | 0;
            const eax = ((x << 16) | (y & 0xffff)) >>> 0;
            this.writeReg(REG.EAX, eax);
            return;
          }
          case 1: {
            const relX = (this.mouseX - this.windowClientOffsetX) | 0;
            const relY = (this.mouseY - this.windowClientOffsetY) | 0;
            const eax = ((relX << 16) | (relY & 0xffff)) >>> 0;
            this.writeReg(REG.EAX, eax);
            return;
          }
          case 2: {
            this.writeReg(REG.EAX, this.mouseButtons & 0x1f);
            return;
          }
          case 3: {
            const value = (this.mouseButtons & 0x1f) | (this.mouseEventFlags >>> 0);
            this.writeReg(REG.EAX, value >>> 0);
            this.mouseEventFlags = 0;
            return;
          }
          case 4: {
            if (!this.nextCursorHandle) {
              this.nextCursorHandle = 1;
            }
            const handle = this.nextCursorHandle;
            this.nextCursorHandle += 1;
            this.currentCursorHandle = handle;
            this.writeReg(REG.EAX, handle >>> 0);
            return;
          }
          case 5: {
            const prev = this.currentCursorHandle || 0;
            const handle = this.readReg(REG.ECX) >>> 0;
            this.currentCursorHandle = handle >>> 0;
            this.writeReg(REG.EAX, prev >>> 0);
            return;
          }
          case 6: {
            const handle = this.readReg(REG.ECX) >>> 0;
            if (this.currentCursorHandle === handle) {
              this.currentCursorHandle = 0;
            }
            return;
          }
          case 7: {
            const horizontal = this.mouseScrollX | 0;
            const vertical = this.mouseScrollY | 0;
            const eax = (((horizontal & 0xffff) << 16) | (vertical & 0xffff)) >>> 0;
            this.mouseScrollX = 0;
            this.mouseScrollY = 0;
            this.writeReg(REG.EAX, eax);
            return;
          }
          default:
            if (!this.unknownSyscalls.has(3700 + sub)) {
              this.unknownSyscalls.add(3700 + sub);
              this.log(`Unhandled syscall 37 sub ${sub}`);
            }
            return;
        }
      },

      presentIfNeeded(force) {
        this.surfaceDirty = true;
        if (this.inRedraw && !force) {
          return;
        }
        const canDeferPresent =
          !force &&
          this.running &&
          !this.inRedraw &&
          this.windowDefined &&
          (this.useImmediateScheduler || typeof requestAnimationFrame === "function");
        if (canDeferPresent) {
          this.presentYieldPending = true;
          return;
        }
        const now =
          typeof performance !== "undefined" && typeof performance.now === "function"
            ? performance.now()
            : Date.now();
        if (!force && now - this.lastPresentAt < 16) {
          return;
        }
        this.lastPresentAt = now;
        this.surface.present();
        this.surfaceDirty = false;
      },

      sysStyleSettings() {
        const ebx = this.readReg(REG.EBX) >>> 0;
        const sub = ebx & 0xff;
        this.ensureSkinThemeLoaded();
        if (sub === 0) {
          this.syncMappedDesktopBackground();
          this.presentIfNeeded(true);
          if (this.hostSession && typeof this.hostSession.applySystemStyleSettings === "function") {
            this.hostSession.applySystemStyleSettings();
          } else {
            this.queueEvent(1);
          }
          return;
        }
        if (sub === 8 || sub === 13) {
          const ptr = this.readReg(REG.ECX) >>> 0;
          const path = ptr ? this.readCString(ptr, 260) : "";
          const result = path
            ? (
              this.hostSession && typeof this.hostSession.setSystemSkinPath === "function"
                ? this.hostSession.setSystemSkinPath(path, this)
                : this.loadSkinTheme(path)
            )
            : 3;
          this.writeReg(REG.EAX, result >>> 0);
          if (result === 0) {
            if (!(this.hostSession && typeof this.hostSession.setSystemSkinPath === "function")) {
              this.queueEvent(1);
            }
          }
          if (this.traceSyscalls) {
            this.log(`syscall 48 -> set skin '${path || "<empty>"}' result=${result}`);
          }
          return;
        }
        if (sub === 1) {
          const value = (this.readReg(REG.ECX) & 0xff) === 0 ? 0 : 1;
          if (this.hostSession && typeof this.hostSession.setSystemButtonStyle === "function") {
            this.hostSession.setSystemButtonStyle(value);
          } else {
            this.buttonStyle = value;
          }
          return;
        }
        if (sub === 9) {
          const value = this.hostSession && typeof this.hostSession.getFontSmoothingMode === "function"
            ? this.hostSession.getFontSmoothingMode()
            : (this.fontSmoothingMode >>> 0);
          this.writeReg(REG.EAX, value >>> 0);
          return;
        }
        if (sub === 10) {
          const value = Math.max(0, Math.min(2, this.readReg(REG.ECX) & 0xff)) >>> 0;
          if (this.hostSession && typeof this.hostSession.setFontSmoothingMode === "function") {
            this.hostSession.setFontSmoothingMode(value);
          } else {
            this.fontSmoothingMode = value;
          }
          return;
        }
        if (sub === 11) {
          const value = this.hostSession && typeof this.hostSession.getFontSizePx === "function"
            ? this.hostSession.getFontSizePx()
            : (this.fontSizePx >>> 0);
          this.writeReg(REG.EAX, value >>> 0);
          return;
        }
        if (sub === 12) {
          const value = Math.max(1, Math.min(255, this.readReg(REG.ECX) & 0xff)) >>> 0;
          if (this.hostSession && typeof this.hostSession.setFontSizePx === "function") {
            this.hostSession.setFontSizePx(value);
          } else {
            this.fontSizePx = value;
          }
          return;
        }
        if (sub === 7) {
          this.writeReg(REG.EAX, this.getSkinMarginsPackedX());
          this.writeReg(REG.EBX, this.getSkinMarginsPackedY());
          return;
        }
        if (sub === 4) {
          this.writeReg(REG.EAX, this.skinHeight >>> 0);
          if (this.traceSyscalls) {
            this.log(`syscall 48 -> skinHeight ${this.skinHeight}`);
          }
          return;
        }
        if (sub === 5) {
          const workArea = this.getHostScreenWorkArea();
          const left = workArea.left | 0;
          const top = workArea.top | 0;
          const right = workArea.right | 0;
          const bottom = workArea.bottom | 0;
          this.writeReg(REG.EAX, ((((left & 0xffff) << 16) | (right & 0xffff))) >>> 0);
          this.writeReg(REG.EBX, ((((top & 0xffff) << 16) | (bottom & 0xffff))) >>> 0);
          return;
        }
        if (sub === 6) {
          const ecx = this.readReg(REG.ECX) >>> 0;
          const edx = this.readReg(REG.EDX) >>> 0;
          if (this.hostSession && typeof this.hostSession.setScreenWorkArea === "function") {
            this.hostSession.setScreenWorkArea({
              left: unpackSignedHigh16(ecx),
              right: unpackSignedLow16(ecx),
              top: unpackSignedHigh16(edx),
              bottom: unpackSignedLow16(edx)
            });
          }
          return;
        }
        if (sub === 2) {
          const ptr = this.readReg(REG.ECX) >>> 0;
          const size = Math.min(this.readReg(REG.EDX) >>> 0, 192);
          if (ptr && size) {
            const table = this.readMemBlock(ptr, size);
            if (table) {
              if (this.hostSession && typeof this.hostSession.setSystemSkinColorTable === "function") {
                this.hostSession.setSystemSkinColorTable(table);
              } else {
                this.setSkinColorTable(table);
              }
            }
          }
          return;
        }
        if (sub === 3) {
          const ptr = this.readReg(REG.ECX) >>> 0;
          const size = Math.min(this.readReg(REG.EDX) >>> 0, 192);
          if (!ptr || !size) {
            return;
          }
          const table = this.getSkinColorTableBytes();
          const writeSize = Math.min(size, table.byteLength);
          try {
            this.writeMemBlock(ptr, table.slice(0, writeSize));
          } catch (err) {
            this.log(`Color table write failed at 0x${ptr.toString(16)}`);
          }
          return;
        }
        if (!this.unknownSyscalls.has(4800 + sub)) {
          this.unknownSyscalls.add(4800 + sub);
          this.log(`Unhandled syscall 48 sub ${sub}`);
        }
      },

      sysKeyboard() {
        const sub = this.readReg(REG.EBX) & 0xff;
        switch (sub) {
          case 1:
            this.keyboardMode = (this.readReg(REG.ECX) & 0xff) === 0 ? 0 : 1;
            return;
          case 2:
            this.writeReg(REG.EAX, this.keyboardMode & 0xff);
            return;
          case 3:
            this.writeReg(REG.EAX, this.controlKeyState & 0x7ff);
            return;
          case 4: {
            if (!(this.hotkeys instanceof Map)) {
              this.hotkeys = new Map();
            }
            const key = `${this.readReg(REG.ECX) & 0xff}:${this.readReg(REG.EDX) >>> 0}`;
            if (this.hotkeys.size >= 256 && !this.hotkeys.has(key)) {
              this.writeReg(REG.EAX, 1);
              return;
            }
            this.hotkeys.set(key, 1);
            this.writeReg(REG.EAX, 0);
            return;
          }
          case 5: {
            if (!(this.hotkeys instanceof Map)) {
              this.hotkeys = new Map();
            }
            const key = `${this.readReg(REG.ECX) & 0xff}:${this.readReg(REG.EDX) >>> 0}`;
            if (!this.hotkeys.delete(key)) {
              this.writeReg(REG.EAX, 1);
              return;
            }
            this.writeReg(REG.EAX, 0);
            return;
          }
          case 6:
            this.keyboardInputLocked = true;
            return;
          case 7:
            this.keyboardInputLocked = false;
            return;
          default:
            if (!this.unknownSyscalls.has(6600 + sub)) {
              this.unknownSyscalls.add(6600 + sub);
              this.log(`Unhandled syscall 66 sub ${sub}`);
            }
            this.writeReg(REG.EAX, 0);
            return;
        }
      },

      sysNetworkGet() {
        const ebx = this.readReg(REG.EBX) >>> 0;
        const sub = ebx & 0xff;
        const apiDeviceNumber = (ebx >>> 8) & 0xff;
        const devices = this.getEmulatedNetworkDevices();
        const device = this.resolveNetworkApiDevice(apiDeviceNumber >>> 0, devices);
        if (sub === 0xff) {
          this.writeReg(REG.EAX, devices.length >>> 0);
          return;
        }
        if (!device) {
          this.writeReg(REG.EAX, 0xffffffff >>> 0);
          if (sub === 8 || sub === 9) {
            this.writeReg(REG.EBX, 0);
          }
          return;
        }
        switch (sub) {
          case 0:
            this.writeReg(REG.EAX, (device.type >>> 0) || 0);
            return;
          case 1: {
            const ptr = this.readReg(REG.ECX) >>> 0;
            if (ptr) {
              this.writeCString(ptr, device.name || "", 64);
            }
            this.writeReg(REG.EAX, 0);
            return;
          }
          case 2:
            this.resetNetworkDeviceCounters(device);
            this.writeReg(REG.EAX, 0);
            return;
          case 3:
            device.linkUp = false;
            device.linkStatus = 0;
            this.writeReg(REG.EAX, 0);
            return;
          case 4:
            this.writeReg(REG.EAX, (device.ptr >>> 0) || 0);
            return;
          case 6:
            this.writeReg(REG.EAX, (device.txPackets >>> 0) || 0);
            return;
          case 7:
            this.writeReg(REG.EAX, (device.rxPackets >>> 0) || 0);
            return;
          case 8: {
            const value = typeof device.txBytes === "bigint" ? device.txBytes : BigInt(device.txBytes || 0);
            this.writeReg(REG.EAX, Number(value & 0xffffffffn) >>> 0);
            this.writeReg(REG.EBX, Number((value >> 32n) & 0xffffffffn) >>> 0);
            return;
          }
          case 9: {
            const value = typeof device.rxBytes === "bigint" ? device.rxBytes : BigInt(device.rxBytes || 0);
            this.writeReg(REG.EAX, Number(value & 0xffffffffn) >>> 0);
            this.writeReg(REG.EBX, Number((value >> 32n) & 0xffffffffn) >>> 0);
            return;
          }
          case 10:
            this.writeReg(REG.EAX, device.linkStatus !== undefined ? (device.linkStatus >>> 0) : (device.linkUp ? 1 : 0));
            return;
          case 11:
            this.writeReg(REG.EAX, (device.txErrors >>> 0) || 0);
            return;
          case 12:
            this.writeReg(REG.EAX, (device.txDropped >>> 0) || 0);
            return;
          case 13:
            this.writeReg(REG.EAX, (device.txMissed >>> 0) || 0);
            return;
          case 14:
            this.writeReg(REG.EAX, (device.rxErrors >>> 0) || 0);
            return;
          case 15:
            this.writeReg(REG.EAX, (device.rxDropped >>> 0) || 0);
            return;
          case 16:
            this.writeReg(REG.EAX, (device.rxMissed >>> 0) || 0);
            return;
          default:
            this.writeReg(REG.EAX, 0xffffffff >>> 0);
            if (sub === 8 || sub === 9) {
              this.writeReg(REG.EBX, 0);
            }
            return;
        }
      },

      sysChangeWindowGeometry() {
        if (!this.windowDefined || typeof this.applyHostWindowGeometry !== "function") {
          return;
        }
        const rawX = this.readReg(REG.EBX) | 0;
        const rawY = this.readReg(REG.ECX) | 0;
        const rawWidth = this.readReg(REG.EDX) | 0;
        const rawHeight = this.readReg(REG.ESI) | 0;
        const update = {};

        if (rawX !== -1) {
          update.x = rawX | 0;
        }
        if (rawY !== -1) {
          update.y = rawY | 0;
        }
        if (rawWidth !== -1) {
          const outerWidth = (rawWidth + 1) | 0;
          if (outerWidth > 0) {
            update.width = outerWidth;
          }
        }
        if (rawHeight !== -1) {
          const outerHeight = (rawHeight + 1) | 0;
          if (outerHeight > 0) {
            update.height = outerHeight;
          }
        }

        this.applyHostWindowGeometry(update, { forceRedraw: true });
      },

      sysSysMisc() {
        const sub = this.readReg(REG.EBX) & 0xff;
        switch (sub) {
          case 0: // get task switch counter
            this.writeReg(REG.EAX, 0);
            break;
          case 1: // switch to next thread
            this.writeReg(REG.EAX, 0);
            this.requestYield(0);
            break;
          case 2: {
            const action = this.readReg(REG.ECX) >>> 0;
            if (action === 0) {
              this.writeReg(REG.EAX, 0);
            } else if (action === 1) {
              this.writeReg(REG.EAX, 0);
            } else if (action === 2 || action === 3) {
              this.writeReg(REG.EAX, 0);
            } else {
              this.writeReg(REG.EAX, 0xffffffff >>> 0);
            }
            break;
          }
          case 3:
            {
              const value = typeof this.readReportedMsr === "function"
                ? this.readReportedMsr(this.readReg(REG.EDX) >>> 0)
                : { low: 0, high: 0 };
              this.writeReg(REG.EAX, value && value.low !== undefined ? (value.low >>> 0) : 0);
              this.writeReg(REG.EBX, value && value.high !== undefined ? (value.high >>> 0) : 0);
              this.writeReg(REG.EDX, value && value.high !== undefined ? (value.high >>> 0) : 0);
            }
            break;
          case 4:
            this.writeReg(REG.EAX, 0);
            break;
          case 18:
          case 19:
            this.sysLoadDll();
            break;
          case 11:
            this.heapInit();
            break;
          case 12:
            this.heapAlloc();
            break;
          case 13:
            this.heapFree();
            break;
          case 14: {
            const ptr = this.readReg(REG.ECX) >>> 0;
            if (ptr) {
              this.writeMem32(ptr >>> 0, 0);
              this.writeMem32((ptr + 4) >>> 0, 0);
              this.writeMem32((ptr + 8) >>> 0, 0);
              this.writeMem32((ptr + 12) >>> 0, 0);
              this.writeMem32((ptr + 16) >>> 0, 0);
              this.writeMem32((ptr + 20) >>> 0, 0);
            }
            this.requestYield(0);
            break;
          }
          case 16:
            this.sysLoadDriver();
            break;
          case 17:
            this.sysControlDriver();
            break;
          case 20:
            this.heapRealloc();
            break;
          case 21:
            this.sysLoadDriver();
            break;
          case 22:
            this.sysNamedMemoryOpen();
            break;
          case 23:
            this.sysNamedMemoryClose();
            break;
          case 24: {
            const state = this.getExceptionState();
            const prevHandler = state.handler >>> 0;
            const prevMask = state.mask >>> 0;
            state.handler = this.readReg(REG.ECX) >>> 0;
            state.mask = this.readReg(REG.EDX) >>> 0;
            this.writeReg(REG.EAX, prevHandler >>> 0);
            this.writeReg(REG.EBX, prevMask >>> 0);
            break;
          }
          case 25: {
            const signal = this.readReg(REG.ECX) >>> 0;
            const state = this.getExceptionState();
            if (signal > 31) {
              this.writeReg(REG.EAX, 0xffffffff >>> 0);
              break;
            }
            const prev = state.active.get(signal >>> 0) ? 1 : 0;
            state.active.set(signal >>> 0, (this.readReg(REG.EDX) & 1) !== 0);
            this.writeReg(REG.EAX, prev >>> 0);
            break;
          }
          case 26:
            this.writeReg(REG.EAX, 0);
            break;
          case 27:
            this.sysLoadFile();
            break;
          case 28:
            this.sysLoadFile();
            break;
          case 29: {
            const size = this.readReg(REG.ECX) >>> 0;
            if (!size || (size & 0xfff) !== 0) {
              this.writeReg(REG.EAX, 0);
              break;
            }
            if (!this.heapEnabled) {
              this.heapInit();
            }
            this.writeReg(REG.EAX, this.heapAllocInternal(size >>> 0) >>> 0);
            break;
          }
          case 30: {
            const handle = this.readReg(REG.ECX) >>> 0;
            let removed = false;
            if (this.loadedDrivers instanceof Map) {
              for (const [name, value] of this.loadedDrivers.entries()) {
                if ((value >>> 0) === (handle >>> 0)) {
                  this.loadedDrivers.delete(name);
                  removed = true;
                  break;
                }
              }
            }
            this.writeReg(REG.EAX, removed ? 0 : (0xffffffff >>> 0));
            break;
          }
          case 31: {
            const action = this.readReg(REG.ECX) >>> 0;
            if (action === 1) {
              this.writeReg(REG.EBX, 0);
              this.writeReg(REG.ECX, 0);
              break;
            }
            if (action === 2) {
              const outPtr = this.readReg(REG.EDI) >>> 0;
              if (!outPtr) {
                this.writeReg(REG.EAX, 0xffffffff >>> 0);
                break;
              }
              const data = new Uint8Array(36);
              this.writeMemBlock(outPtr, data);
              this.writeReg(REG.EAX, 0);
              break;
            }
            this.writeReg(REG.EAX, 0xffffffff >>> 0);
            break;
          }
          default:
            if (!this.unknownSyscalls.has(6800 + sub)) {
              this.unknownSyscalls.add(6800 + sub);
              this.log(`Unhandled syscall 68 sub ${sub}`);
            }
            this.writeReg(REG.EAX, 0);
            break;
        }
      },

      sysLoadDll() {
        const pathPtr = this.readReg(REG.ECX) >>> 0;
        if (!pathPtr) {
          this.writeReg(REG.EAX, 0);
          return;
        }
        const sub = this.readReg(REG.EBX) & 0xff;
        const encoding = sub === 18 ? (this.readReg(REG.EDX) & 0xff) : 1;
        const path = this.readEncodedString(pathPtr, 260, encoding);
        const hostDll = this.loadBuiltInHostDll(path);
        if (hostDll) {
          this.writeReg(REG.EAX, hostDll >>> 0);
          return;
        }
        const loaded = this.loadCoffLibrary(path);
        if (!loaded) {
          this.writeReg(REG.EAX, 0);
          return;
        }
        this.writeReg(REG.EAX, loaded.exportPtr >>> 0);
      },

      sysLoadFile() {
        const pathPtr = this.readReg(REG.ECX) >>> 0;
        if (!pathPtr) {
          this.writeReg(REG.EAX, 0);
          this.writeReg(REG.EDX, 0);
          return;
        }
        const sub = this.readReg(REG.EBX) & 0xff;
        const encoding = sub === 28 ? (this.readReg(REG.EDX) & 0xff) : 1;
        const path = this.readEncodedString(pathPtr, 260, encoding);
        const loaded = this.loadFileToHeap(path);
        if (!loaded) {
          this.writeReg(REG.EAX, 0);
          this.writeReg(REG.EDX, 0);
          return;
        }
        this.writeReg(REG.EAX, loaded.ptr >>> 0);
        this.writeReg(REG.EDX, loaded.size >>> 0);
      },

      sysLoadDriver() {
        const sub = this.readReg(REG.EBX) & 0xff;
        const namePtr = this.readReg(REG.ECX) >>> 0;
        let name = "";
        let path = "";
        if (sub === 21) {
          const rawPath = namePtr ? this.readCString(namePtr, 260) : "";
          path = rawPath ? this.resolveKosPath(rawPath) : "";
          const leaf = path.replace(/\\/g, "/").split("/").pop() || "";
          name = leaf.replace(/\.[^.]+$/, "").slice(0, 15);
        } else {
          const rawName = namePtr ? this.readCString(namePtr, 16) : "";
          name = String(rawName || "").slice(0, 15);
          path = name ? `/sys/drivers/${name}.sys` : "";
        }
        if (!name || !path) {
          this.writeReg(REG.EAX, 0);
          return;
        }
        const bytes = typeof this.loadHostFile === "function" ? this.loadHostFile(path) : null;
        if (!bytes || !bytes.length) {
          this.writeReg(REG.EAX, 0);
          return;
        }
        if (this.hostSession && typeof this.hostSession.loadSystemDriver === "function") {
          this.writeReg(REG.EAX, this.hostSession.loadSystemDriver(name) >>> 0);
          return;
        }
        if (this.loadedDrivers instanceof Map && this.loadedDrivers.has(name)) {
          this.writeReg(REG.EAX, this.loadedDrivers.get(name) >>> 0);
          return;
        }
        let handle = this.nextDriverHandle >>> 0;
        if (!handle) {
          handle = 1;
        }
        this.nextDriverHandle = ((handle + 1) >>> 0) || 1;
        if (!(this.loadedDrivers instanceof Map)) {
          this.loadedDrivers = new Map();
        }
        this.loadedDrivers.set(name, handle >>> 0);
        this.writeReg(REG.EAX, handle >>> 0);
      },

      sysControlDriver() {
        this.writeReg(REG.EAX, 0xffffffff >>> 0);
      },

      sysNamedMemoryOpen() {
        const namePtr = this.readReg(REG.ECX) >>> 0;
        const requestSize = this.readReg(REG.EDX) >>> 0;
        const flags = this.readReg(REG.ESI) >>> 0;
        const action = flags & 0x0c;
        const requestedAccess = flags & 0x01;
        const key = this.normalizeNamedMemoryName(namePtr ? this.readCString(namePtr, 32) : "");
        if (!key) {
          this.writeReg(REG.EAX, 0);
          this.writeReg(REG.EDX, 33);
          return;
        }

        let area = this.getNamedMemoryArea(key);
        if (!area) {
          if (action === 0x00 && typeof this.ensureHostNamedMemoryArea === "function") {
            area = this.ensureHostNamedMemoryArea(key);
          }
        }
        if (!area) {
          if (action === 0x00) {
            this.writeReg(REG.EAX, 0);
            this.writeReg(REG.EDX, 5);
            return;
          }
          if (action !== 0x04 && action !== 0x08) {
            this.writeReg(REG.EAX, 0);
            this.writeReg(REG.EDX, 33);
            return;
          }
          if (!requestSize) {
            this.writeReg(REG.EAX, 0);
            this.writeReg(REG.EDX, 33);
            return;
          }
          area = this.createNamedMemoryArea(key, requestSize, requestedAccess, { ownerAccess: 1 });
          if (!area) {
            this.writeReg(REG.EAX, 0);
            this.writeReg(REG.EDX, 30);
            return;
          }
          this.retainNamedMemoryArea(key);
          this.writeReg(REG.EAX, area.ptr >>> 0);
          this.writeReg(REG.EDX, 0);
          return;
        }

        if (action !== 0x00 && action !== 0x04 && action !== 0x08) {
          this.writeReg(REG.EAX, 0);
          this.writeReg(REG.EDX, 33);
          return;
        }
        if (action === 0x08) {
          this.writeReg(REG.EAX, 0);
          this.writeReg(REG.EDX, 10);
          return;
        }

        const allowedAccess = Math.max(area.access | 0, area.ownerAccess | 0) & 0x01;
        if (requestedAccess > allowedAccess) {
          this.writeReg(REG.EAX, 0);
          this.writeReg(REG.EDX, 10);
          return;
        }

        const mapping = typeof this.mapNamedMemoryAreaForCurrentProcess === "function"
          ? this.mapNamedMemoryAreaForCurrentProcess(area, requestedAccess)
          : area;
        if (!mapping || !(mapping.ptr >>> 0)) {
          this.writeReg(REG.EAX, 0);
          this.writeReg(REG.EDX, 30);
          return;
        }
        this.retainNamedMemoryArea(key);
        this.writeReg(REG.EAX, mapping.ptr >>> 0);
        this.writeReg(
          REG.EDX,
          typeof this.getNamedMemoryRequestedSize === "function"
            ? (this.getNamedMemoryRequestedSize(area) >>> 0)
            : (area.size >>> 0)
        );
      },

      sysNamedMemoryClose() {
        const namePtr = this.readReg(REG.ECX) >>> 0;
        if (namePtr) {
          this.releaseNamedMemoryArea(this.readCString(namePtr, 32));
        }
        this.writeReg(REG.EAX, 0);
      },

      sysFile() {
        const infoPtr = this.readReg(REG.EBX) >>> 0;
        this.sysFileDispatch(infoPtr, false);
      },

      sysFileEncoded() {
        const infoPtr = this.readReg(REG.EBX) >>> 0;
        this.sysFileDispatch(infoPtr, true);
      },

      sysFileDispatch(infoPtr, encoded) {
        if (!infoPtr) {
          this.writeReg(REG.EAX, 7);
          this.writeReg(REG.EBX, 0);
          return;
        }
        const sub = this.readMem32(infoPtr) >>> 0;
        const handlerName = FILE_API_DISPATCH[sub];
        if (handlerName && typeof this[handlerName] === "function") {
          this[handlerName](infoPtr, encoded);
          return;
        }
        if (!this.unknownSyscalls.has(7000 + sub)) {
          this.unknownSyscalls.add(7000 + sub);
          this.log(`Unhandled syscall 70 sub ${sub}`);
        }
        this.writeReg(REG.EAX, 2);
        this.writeReg(REG.EBX, 0);
      },

      getFileApiEncoding(infoPtr, encoded) {
        if (!encoded) {
          return 1;
        }
        return this.readMem32((infoPtr + 0x14) >>> 0) & 0xff;
      },

      readFileApiPath(infoPtr, encoded) {
        return this.readFsPath(infoPtr, encoded ? { encoded: true } : undefined);
      },

      readFileApiString(infoPtr, ptr, encoded, maxLen) {
        if (!ptr) {
          return "";
        }
        if (encoded && typeof this.readCStringEncoded === "function") {
          return this.readCStringEncoded(ptr, maxLen || 4096, this.getFileApiEncoding(infoPtr, true));
        }
        return this.readCString(ptr, maxLen || 4096);
      },

      yieldForSuccessfulFileMutation(result) {
        if (!result || !this.fileMutationProvider) {
          return;
        }
        if ((result.errorCode >>> 0) !== 0) {
          return;
        }
        this.requestYield(0, "host-fs");
      },

      continueAsyncHostFsRequest(stateKey, promiseFactory, options) {
        const key = String(stateKey || "");
        if (!key) {
          return null;
        }
        const pending = this[key] || null;
        if (pending) {
          if (pending.ready) {
            this[key] = null;
            return pending.result;
          }
          this.repeatCurrentInstruction = true;
          this.requestYield(0, "host-fs");
          return null;
        }
        const createPromise = typeof promiseFactory === "function" ? promiseFactory : null;
        if (!createPromise) {
          return null;
        }
        let promise;
        try {
          promise = createPromise();
        } catch (err) {
          this.log(`${options && options.setupLabel ? options.setupLabel : "Async host FS setup failed"}: ${err}`);
          return options && Object.prototype.hasOwnProperty.call(options, "fallbackResult")
            ? options.fallbackResult
            : null;
        }
        if (!promise || typeof promise.then !== "function") {
          return null;
        }
        const normalizeResult = options && typeof options.normalizeResult === "function"
          ? options.normalizeResult
          : ((result) => result);
        const state = {
          ready: false,
          result: options && Object.prototype.hasOwnProperty.call(options, "fallbackResult")
            ? options.fallbackResult
            : null
        };
        this[key] = state;
        Promise.resolve(promise).then((result) => {
          state.result = normalizeResult(result);
          state.ready = true;
          if (typeof this.wakeExecution === "function") {
            this.wakeExecution(true);
          }
        }).catch((err) => {
          this.log(`${options && options.failLabel ? options.failLabel : "Async host FS failed"}: ${err}`);
          state.result = options && Object.prototype.hasOwnProperty.call(options, "fallbackResult")
            ? options.fallbackResult
            : null;
          state.ready = true;
          if (typeof this.wakeExecution === "function") {
            this.wakeExecution(true);
          }
        });
        this.repeatCurrentInstruction = true;
        this.requestYield(0, "host-fs");
        return null;
      },

      continueAsyncHostFileMutation(promiseFactory) {
        return this.continueAsyncHostFsRequest("pendingHostFsMutation", promiseFactory, {
          fallbackResult: {
            errorCode: 10,
            written: 0
          },
          setupLabel: "Async host file mutation setup failed",
          failLabel: "Async host file mutation failed",
          normalizeResult(result) {
            return {
              errorCode: result && result.errorCode !== undefined ? (result.errorCode >>> 0) : 0,
              written: result && result.written !== undefined ? (result.written >>> 0) : 0
            };
          }
        });
      },

      continueAsyncHostFileRead(promiseFactory) {
        return this.continueAsyncHostFsRequest("pendingHostFsRead", promiseFactory, {
          fallbackResult: null,
          setupLabel: "Async host file read setup failed",
          failLabel: "Async host file read failed",
          normalizeResult(result) {
            if (!result) {
              return null;
            }
            if (result instanceof Uint8Array) {
              return result;
            }
            if (result instanceof ArrayBuffer) {
              return new Uint8Array(result);
            }
            if (ArrayBuffer.isView(result)) {
              return new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
            }
            return null;
          }
        });
      },

      continueAsyncHostFileInfo(promiseFactory) {
        return this.continueAsyncHostFsRequest("pendingHostFsInfo", promiseFactory, {
          fallbackResult: null,
          setupLabel: "Async host file info setup failed",
          failLabel: "Async host file info failed",
          normalizeResult(result) {
            return result || null;
          }
        });
      },

      sysFileRead(infoPtr, encoded) {
        const offset = this.readMem32((infoPtr + 4) >>> 0) >>> 0;
        const size = this.readMem32((infoPtr + 0x0c) >>> 0) >>> 0;
        const bufferPtr = this.readMem32((infoPtr + 0x10) >>> 0) >>> 0;
        const path = this.readFileApiPath(infoPtr, encoded);
        const asyncData = this.continueAsyncHostFileRead(
          typeof this.loadHostFileAsync === "function" && this.fileProviderAsync
            ? () => this.loadHostFileAsync(path)
            : null
        );
        if (this.repeatCurrentInstruction) {
          return;
        }
        const data = this.maybeUnpackHostFile(asyncData || this.loadHostFile(path), path);
        if (!data) {
          this.writeReg(REG.EAX, 5);
          this.writeReg(REG.EBX, 0);
          return;
        }
        if (offset >= data.length) {
          this.writeReg(REG.EAX, 6);
          this.writeReg(REG.EBX, 0);
          return;
        }
        const end = Math.min(data.length, offset + size);
        const slice = data.subarray(offset, end);
        if (bufferPtr) {
          this.writeMemBlock(bufferPtr, slice);
        }
        this.writeReg(REG.EBX, slice.length >>> 0);
        if (offset + size > data.length) {
          this.writeReg(REG.EAX, 6);
        } else {
          this.writeReg(REG.EAX, 0);
        }
      },

      sysFileReadDir(infoPtr, encoded) {
        const offset = this.readMem32((infoPtr + 4) >>> 0) >>> 0;
        const encoding = this.readMem32((infoPtr + 8) >>> 0) & 0xff;
        const count = this.readMem32((infoPtr + 0x0c) >>> 0) >>> 0;
        const bufferPtr = this.readMem32((infoPtr + 0x10) >>> 0) >>> 0;
        const path = this.readFileApiPath(infoPtr, encoded);
        const asyncInfo = this.continueAsyncHostFileInfo(
          typeof this.loadHostInfoAsync === "function" && this.fileInfoProviderAsync
            ? () => this.loadHostInfoAsync(path, "list")
            : null
        );
        if (this.repeatCurrentInstruction) {
          return;
        }
        const info = asyncInfo || this.loadHostInfo(path, "list");
        if (!info || !info.exists) {
          this.writeReg(REG.EAX, 5);
          this.writeReg(REG.EBX, 0);
          return;
        }
        if (!info.isDirectory) {
          this.writeReg(REG.EAX, 10);
          this.writeReg(REG.EBX, 0);
          return;
        }
        const entries = Array.isArray(info.entries) ? info.entries : [];
        const total = entries.length >>> 0;
        const start = Math.min(offset, total) >>> 0;
        const placed = Math.min(count, Math.max(0, total - start)) >>> 0;
        const blockSize = (encoding === 2 || encoding === 3) ? 560 : 304;
        if (bufferPtr) {
          const header = new Uint8Array(32 + placed * blockSize);
          const view = new DataView(header.buffer);
          view.setUint32(0, 1, true);
          view.setUint32(4, placed >>> 0, true);
          view.setUint32(8, total >>> 0, true);
          for (let i = 0; i < placed; i += 1) {
            const entry = entries[start + i] || null;
            const block = createBdfeBuffer(entry, encoding, true);
            header.set(block, 32 + i * blockSize);
          }
          this.writeMemBlock(bufferPtr, header);
        }
        this.writeReg(REG.EBX, placed >>> 0);
        if (count !== 0 && start + count > total) {
          this.writeReg(REG.EAX, 6);
        } else {
          this.writeReg(REG.EAX, 0);
        }
      },

      sysFileCreate(infoPtr, encoded) {
        const size = this.readMem32((infoPtr + 0x0c) >>> 0) >>> 0;
        const bufferPtr = this.readMem32((infoPtr + 0x10) >>> 0) >>> 0;
        const path = this.readFileApiPath(infoPtr, encoded);
        const data = size && bufferPtr ? (this.readMemBlock(bufferPtr, size) || new Uint8Array(0)) : new Uint8Array(0);
        const asyncResult = this.continueAsyncHostFileMutation(
          typeof this.createOrRewriteHostFileAsync === "function" && this.fileMutationProviderAsync
            ? () => this.createOrRewriteHostFileAsync(path, data)
            : null
        );
        if (this.repeatCurrentInstruction) {
          return;
        }
        const result = asyncResult || this.createOrRewriteHostFile(path, data);
        this.writeReg(REG.EAX, result.errorCode >>> 0);
        this.writeReg(REG.EBX, result.errorCode ? 0 : (result.written >>> 0));
        this.yieldForSuccessfulFileMutation(result);
      },

      sysFileWrite(infoPtr, encoded) {
        const offset = this.readMem32((infoPtr + 4) >>> 0) >>> 0;
        const size = this.readMem32((infoPtr + 0x0c) >>> 0) >>> 0;
        const bufferPtr = this.readMem32((infoPtr + 0x10) >>> 0) >>> 0;
        const path = this.readFileApiPath(infoPtr, encoded);
        const data = size && bufferPtr ? (this.readMemBlock(bufferPtr, size) || new Uint8Array(0)) : new Uint8Array(0);
        const asyncResult = this.continueAsyncHostFileMutation(
          typeof this.writeExistingHostFileAsync === "function" && this.fileMutationProviderAsync
            ? () => this.writeExistingHostFileAsync(path, offset, data)
            : null
        );
        if (this.repeatCurrentInstruction) {
          return;
        }
        const result = asyncResult || this.writeExistingHostFile(path, offset, data);
        this.writeReg(REG.EAX, result.errorCode >>> 0);
        this.writeReg(REG.EBX, result.errorCode ? 0 : (result.written >>> 0));
        this.yieldForSuccessfulFileMutation(result);
      },

      sysFileSetEnd(infoPtr, encoded) {
        const sizeLo = this.readMem32((infoPtr + 4) >>> 0) >>> 0;
        const sizeHi = this.readMem32((infoPtr + 8) >>> 0) >>> 0;
        const path = this.readFileApiPath(infoPtr, encoded);
        if (sizeHi !== 0) {
          this.writeReg(REG.EAX, 33);
          this.writeReg(REG.EBX, 0);
          return;
        }
        const asyncResult = this.continueAsyncHostFileMutation(
          typeof this.setHostFileSizeAsync === "function" && this.fileMutationProviderAsync
            ? () => this.setHostFileSizeAsync(path, sizeLo >>> 0)
            : null
        );
        if (this.repeatCurrentInstruction) {
          return;
        }
        const result = asyncResult || this.setHostFileSize(path, sizeLo >>> 0);
        this.writeReg(REG.EAX, result.errorCode >>> 0);
        this.writeReg(REG.EBX, 0);
        this.yieldForSuccessfulFileMutation(result);
      },

      sysFileGetInfo(infoPtr, encoded) {
        const bufferPtr = this.readMem32((infoPtr + 0x10) >>> 0) >>> 0;
        const path = this.readFileApiPath(infoPtr, encoded);
        const asyncInfo = this.continueAsyncHostFileInfo(
          typeof this.loadHostInfoAsync === "function" && this.fileInfoProviderAsync
            ? () => this.loadHostInfoAsync(path, "stat")
            : null
        );
        if (this.repeatCurrentInstruction) {
          return;
        }
        const info = asyncInfo || this.loadHostInfo(path, "stat");
        if (!info || !info.exists) {
          this.writeReg(REG.EAX, 5);
          this.writeReg(REG.EBX, 0);
          return;
        }
        if (bufferPtr) {
          this.writeMemBlock(bufferPtr, createBdfeBuffer(info, 0, false));
        }
        this.writeReg(REG.EAX, 0);
        this.writeReg(REG.EBX, 0);
      },

      sysFileSetInfo(infoPtr, encoded) {
        const path = this.readFileApiPath(infoPtr, encoded);
        const asyncInfo = this.continueAsyncHostFileInfo(
          typeof this.loadHostInfoAsync === "function" && this.fileInfoProviderAsync
            ? () => this.loadHostInfoAsync(path, "stat")
            : null
        );
        if (this.repeatCurrentInstruction) {
          return;
        }
        const info = asyncInfo || this.loadHostInfo(path, "stat");
        this.writeReg(REG.EAX, info && info.exists ? 0 : 5);
        this.writeReg(REG.EBX, 0);
      },

      sysFileDelete(infoPtr, encoded) {
        const path = this.readFileApiPath(infoPtr, encoded);
        const asyncResult = this.continueAsyncHostFileMutation(
          typeof this.deleteHostPathAsync === "function" && this.fileMutationProviderAsync
            ? () => this.deleteHostPathAsync(path)
            : null
        );
        if (this.repeatCurrentInstruction) {
          return;
        }
        const result = asyncResult || this.deleteHostPath(path);
        this.writeReg(REG.EAX, result.errorCode >>> 0);
        this.writeReg(REG.EBX, 0);
        this.yieldForSuccessfulFileMutation(result);
      },

      sysFileCreateFolder(infoPtr, encoded) {
        const path = this.readFileApiPath(infoPtr, encoded);
        const asyncResult = this.continueAsyncHostFileMutation(
          typeof this.createHostFolderAsync === "function" && this.fileMutationProviderAsync
            ? () => this.createHostFolderAsync(path)
            : null
        );
        if (this.repeatCurrentInstruction) {
          return;
        }
        const result = asyncResult || this.createHostFolder(path);
        this.writeReg(REG.EAX, result.errorCode >>> 0);
        this.writeReg(REG.EBX, 0);
        this.yieldForSuccessfulFileMutation(result);
      },

      sysFileRenameMove(infoPtr, encoded) {
        const path = this.readFileApiPath(infoPtr, encoded);
        const nextPathPtr = this.readMem32((infoPtr + 0x10) >>> 0) >>> 0;
        const nextPath = this.readFileApiString(infoPtr, nextPathPtr, encoded, 4096);
        if (!nextPath) {
          this.writeReg(REG.EAX, 33);
          this.writeReg(REG.EBX, 0);
          return;
        }
        const asyncResult = this.continueAsyncHostFileMutation(
          typeof this.renameOrMoveHostPathAsync === "function" && this.fileMutationProviderAsync
            ? () => this.renameOrMoveHostPathAsync(path, nextPath)
            : null
        );
        if (this.repeatCurrentInstruction) {
          return;
        }
        const result = asyncResult || this.renameOrMoveHostPath(path, nextPath);
        this.writeReg(REG.EAX, result.errorCode >>> 0);
        this.writeReg(REG.EBX, 0);
        this.yieldForSuccessfulFileMutation(result);
      },

      sysFileStartApp(infoPtr, encoded) {
        const flags = this.readMem32((infoPtr + 4) >>> 0) >>> 0;
        const paramsPtr = this.readMem32((infoPtr + 8) >>> 0) >>> 0;
        const params = this.readFileApiString(infoPtr, paramsPtr, encoded, 4096);
        const rawPath = this.readFileApiPath(infoPtr, encoded);
        const path = rawPath ? this.resolveKosPath(rawPath) : "";
        if (!path) {
          this.writeReg(REG.EAX, (-33) >>> 0);
          this.writeReg(REG.EBX, 0);
          return;
        }
        const result = this.startHostApplication
          ? this.startHostApplication(path, params, flags)
          : { errorCode: 5, pid: 0 };
        if (result && !result.errorCode && result.pid) {
          this.writeReg(REG.EAX, result.pid >>> 0);
        } else {
          const errorCode = result && result.errorCode ? (result.errorCode | 0) : 5;
          this.writeReg(REG.EAX, (-Math.max(1, errorCode)) >>> 0);
        }
        this.writeReg(REG.EBX, 0);
      },

      sysCdDrive() {
        this.writeReg(REG.EAX, 0);
      },

      sysBackgroundGet() {
        const sub = this.readReg(REG.EBX) >>> 0;
        const snapshot = this.getDesktopBackgroundSnapshot();
        if (sub === 1) {
          this.writeReg(REG.EAX, ((((snapshot.width & 0xffff) << 16) | (snapshot.height & 0xffff))) >>> 0);
          return;
        }
        if (sub === 2) {
          const bytes = snapshot.bytes;
          const offset = this.readReg(REG.ECX) >>> 0;
          if (!bytes || offset + 2 >= bytes.length) {
            this.writeReg(REG.EAX, 2);
            return;
          }
          const color = ((bytes[offset + 2] << 16) | (bytes[offset + 1] << 8) | bytes[offset]) >>> 0;
          this.writeReg(REG.EAX, color >>> 0);
          return;
        }
        if (sub === 3) {
          const bytes = snapshot.bytes;
          const width = snapshot.width | 0;
          const height = snapshot.height | 0;
          const pos = this.readReg(REG.ECX) >>> 0;
          const size = this.readReg(REG.EDX) >>> 0;
          const dstPtr = this.readReg(REG.ESI) >>> 0;
          const x = unpackSignedHigh16(pos);
          const y = unpackSignedLow16(pos);
          const rectWidth = (size >>> 16) & 0xffff;
          const rectHeight = size & 0xffff;
          if (!bytes || !dstPtr || width <= 0 || height <= 0 || rectWidth === 0 || rectHeight === 0) {
            this.writeReg(REG.EAX, 0xffffffff >>> 0);
            return;
          }
          const out = new Uint8Array(rectWidth * rectHeight * 3);
          for (let py = 0; py < rectHeight; py += 1) {
            const srcY = y + py;
            if (srcY < 0 || srcY >= height) {
              continue;
            }
            for (let px = 0; px < rectWidth; px += 1) {
              const srcX = x + px;
              if (srcX < 0 || srcX >= width) {
                continue;
              }
              const srcOffset = ((srcY * width + srcX) * 3) >>> 0;
              const dstOffset = ((py * rectWidth + px) * 3) >>> 0;
              out[dstOffset] = bytes[srcOffset];
              out[dstOffset + 1] = bytes[srcOffset + 1];
              out[dstOffset + 2] = bytes[srcOffset + 2];
            }
          }
          this.writeMemBlock(dstPtr, out);
          this.writeReg(REG.EAX, 0);
          return;
        }
        if (sub === 4) {
          this.writeReg(REG.EAX, snapshot.mode ? (snapshot.mode >>> 0) : 1);
          return;
        }
      },

      sysApm() {
        const flags = this.readReg(REG.EFLAGS) | 1;
        this.writeReg(REG.EFLAGS, flags >>> 0);
        this.writeReg(REG.EAX, 0xffffffff >>> 0);
      },

      sysClipboard() {
        const sub = this.readReg(REG.EBX) >>> 0;
        const state = this.getClipboardState();
        switch (sub) {
          case 0:
            this.writeReg(REG.EAX, state.slots.length >>> 0);
            return;
          case 1: {
            const index = this.readReg(REG.ECX) >>> 0;
            const slot = index < state.slots.length ? state.slots[index] : null;
            if (!(slot instanceof Uint8Array)) {
              this.writeReg(REG.EAX, 1);
              return;
            }
            if (!this.heapEnabled) {
              this.heapInit();
            }
            const ptr = this.heapAllocInternal(Math.max(1, align4k(slot.length)));
            if (!ptr) {
              this.writeReg(REG.EAX, 1);
              return;
            }
            this.writeMemBlock(ptr, slot);
            this.writeReg(REG.EAX, ptr >>> 0);
            return;
          }
          case 2: {
            const size = this.readReg(REG.ECX) >>> 0;
            const ptr = this.readReg(REG.EDX) >>> 0;
            const bytes = size ? (this.readMemBlock(ptr, size) || null) : new Uint8Array(0);
            if (size && !bytes) {
              this.writeReg(REG.EAX, 1);
              return;
            }
            state.slots.push(bytes ? new Uint8Array(bytes) : new Uint8Array(0));
            this.writeReg(REG.EAX, 0);
            return;
          }
          case 3:
            if (!state.slots.length) {
              this.writeReg(REG.EAX, 1);
              return;
            }
            state.slots.pop();
            this.writeReg(REG.EAX, 0);
            return;
          case 4:
            if (!state.locked) {
              this.writeReg(REG.EAX, 0xffffffff >>> 0);
              return;
            }
            state.locked = false;
            this.writeReg(REG.EAX, 0);
            return;
          default:
            this.writeReg(REG.EAX, 1);
            return;
        }
      },

      sysSpeakerPlay() {
        const sub = this.readReg(REG.EBX) >>> 0;
        if (sub !== 55) {
          this.writeReg(REG.EAX, 55);
          return;
        }
        if (this.hostSession && typeof this.hostSession.getSpeakerDisabled === "function") {
          this.speakerDisabled = !!this.hostSession.getSpeakerDisabled();
        }
        if (this.speakerDisabled) {
          this.writeReg(REG.EAX, 55);
          return;
        }
        const ptr = this.readReg(REG.ESI) >>> 0;
        const result = typeof this.playHostSpeakerSequence === "function"
          ? (this.playHostSpeakerSequence(ptr) >>> 0)
          : 0;
        this.writeReg(REG.EAX, result === 55 ? 55 : 0);
      },

      sysPciBios() {
        const flags = this.readReg(REG.EFLAGS) | 1;
        this.writeReg(REG.EFLAGS, flags >>> 0);
        this.writeReg(REG.EAX, 0xffffffff >>> 0);
      },

      sysDirectGraphicsParams() {
        const sub = this.readReg(REG.EBX) >>> 0;
        if (sub === 1) {
          this.writeReg(REG.EAX, ((((this.surface.width | 0) & 0xffff) << 16) | ((this.surface.height | 0) & 0xffff)) >>> 0);
          return;
        }
        if (sub === 2) {
          this.writeReg(REG.EAX, 32);
          return;
        }
        if (sub === 3) {
          this.writeReg(REG.EAX, Math.max(0, (this.surface.width | 0) * 4) >>> 0);
          return;
        }
      },

      sysResizeApplicationMemory() {
        if ((this.readReg(REG.EBX) >>> 0) !== 1) {
          this.writeReg(REG.EAX, 1);
          return;
        }
        if (this.heapEnabled) {
          this.writeReg(REG.EAX, 0);
          return;
        }
        const requested = align4k(this.readReg(REG.ECX) >>> 0);
        const minimum = Math.max(
          this.processReservedSize >>> 0,
          this.image ? (this.image.header.memorySize >>> 0) : 0,
          this.stackBase >>> 0
        ) >>> 0;
        const nextSize = Math.max(requested, minimum) >>> 0;
        if (!nextSize) {
          this.writeReg(REG.EAX, 1);
          return;
        }
        if (!this.ensureMemoryCapacity(nextSize >>> 0)) {
          this.writeReg(REG.EAX, 1);
          return;
        }
        this.memLimit = nextSize >>> 0;
        this.writeReg(REG.EAX, 0);
      },

      sysSendWindowMessage() {
        const sub = this.readReg(REG.EBX) >>> 0;
        if (sub !== 1) {
          this.writeReg(REG.EAX, 1);
          return;
        }
        const eventCode = this.readReg(REG.ECX) >>> 0;
        const param = this.readReg(REG.EDX) >>> 0;
        const active = this.getHostActiveThreadSlot ? (this.getHostActiveThreadSlot() >>> 0) : (this.threadSlot >>> 0);
        if (active !== (this.threadSlot >>> 0)) {
          this.writeReg(REG.EAX, 1);
          return;
        }
        if (eventCode === 2) {
          if (typeof this.queueKeyEvent === "function") {
            this.queueKeyEvent(param & 0xff, param & 0xff, this.controlKeyState & 0x7ff, false);
          }
          this.writeReg(REG.EAX, 0);
          return;
        }
        if (eventCode === 3) {
          this.pendingButtonResult = ((param & 0x00ffffff) << 8) >>> 0;
          this.queueEvent(3);
          this.writeReg(REG.EAX, 0);
          return;
        }
        this.writeReg(REG.EAX, 1);
      },

      sysBlitBitmap() {
        const control = this.readReg(REG.EBX) >>> 0;
        const rop = control & 0x0f;
        const toBackground = (control & 0x10) !== 0;
        const transparent = (control & 0x20) !== 0;
        const clientRelative = (control & 0x40000000) !== 0;
        const paramsPtr = this.readReg(REG.ECX) >>> 0;
        if (!paramsPtr || rop !== 0) {
          return;
        }
        const dstX = this.readMem32(paramsPtr >>> 0) | 0;
        const dstY = this.readMem32((paramsPtr + 4) >>> 0) | 0;
        const dstWidth = this.readMem32((paramsPtr + 8) >>> 0) >>> 0;
        const dstHeight = this.readMem32((paramsPtr + 12) >>> 0) >>> 0;
        const srcX = this.readMem32((paramsPtr + 16) >>> 0) | 0;
        const srcY = this.readMem32((paramsPtr + 20) >>> 0) | 0;
        const srcWidth = this.readMem32((paramsPtr + 24) >>> 0) >>> 0;
        const srcHeight = this.readMem32((paramsPtr + 28) >>> 0) >>> 0;
        const srcPtr = this.readMem32((paramsPtr + 32) >>> 0) >>> 0;
        let stride = this.readMem32((paramsPtr + 36) >>> 0) >>> 0;
        if (!srcPtr || !dstWidth || !dstHeight || !srcWidth || !srcHeight) {
          return;
        }
        if (!stride) {
          stride = (srcWidth * 4) >>> 0;
        }
        const copyWidth = Math.min(dstWidth, srcWidth) >>> 0;
        const copyHeight = Math.min(dstHeight, srcHeight) >>> 0;
        if (toBackground) {
          const session = this.hostSession || null;
          const snapshot = this.getDesktopBackgroundSnapshot();
          if (!session || !snapshot.bytes || !snapshot.width || !snapshot.height) {
            return;
          }
          const out = new Uint8Array(snapshot.bytes);
          for (let py = 0; py < copyHeight; py += 1) {
            const srcRow = (srcPtr + ((srcY + py) * stride) + Math.max(0, srcX) * 4) >>> 0;
            const dstRowY = dstY + py;
            if (dstRowY < 0 || dstRowY >= (snapshot.height | 0)) {
              continue;
            }
            for (let px = 0; px < copyWidth; px += 1) {
              const dstRowX = dstX + px;
              if (dstRowX < 0 || dstRowX >= (snapshot.width | 0)) {
                continue;
              }
              const srcOffset = (srcRow + px * 4) >>> 0;
              const alpha = this.readMem8((srcOffset + 3) >>> 0) & 0xff;
              if (transparent && alpha === 0) {
                continue;
              }
              const outOffset = ((dstRowY * snapshot.width + dstRowX) * 3) >>> 0;
              out[outOffset] = this.readMem8(srcOffset >>> 0) & 0xff;
              out[outOffset + 1] = this.readMem8((srcOffset + 1) >>> 0) & 0xff;
              out[outOffset + 2] = this.readMem8((srcOffset + 2) >>> 0) & 0xff;
            }
          }
          if (typeof session.setDesktopBackgroundBytes === "function") {
            session.setDesktopBackgroundBytes(out);
          }
          if (typeof session.redrawDesktopBackground === "function") {
            session.redrawDesktopBackground();
          }
          return;
        }
        const origin = clientRelative ? this.applyWindowOffset(dstX, dstY) : { x: dstX | 0, y: dstY | 0 };
        for (let py = 0; py < copyHeight; py += 1) {
          const srcRow = (srcPtr + ((srcY + py) * stride) + Math.max(0, srcX) * 4) >>> 0;
          const outY = origin.y + py;
          if (outY < 0 || outY >= (this.surface.height | 0)) {
            continue;
          }
          for (let px = 0; px < copyWidth; px += 1) {
            const outX = origin.x + px;
            if (outX < 0 || outX >= (this.surface.width | 0)) {
              continue;
            }
            const srcOffset = (srcRow + px * 4) >>> 0;
            const alpha = this.readMem8((srcOffset + 3) >>> 0) & 0xff;
            if (transparent && alpha === 0) {
              continue;
            }
            const b = this.readMem8(srcOffset >>> 0) & 0xff;
            const g = this.readMem8((srcOffset + 1) >>> 0) & 0xff;
            const r = this.readMem8((srcOffset + 2) >>> 0) & 0xff;
            this.surface.setPixel(outX, outY, ((r << 16) | (g << 8) | b) >>> 0);
          }
        }
        this.presentIfNeeded();
      },

      sysNetworkSocket() {
        const sub = this.readReg(REG.EBX) & 0xff;
        const state = this.getSocketApiState();
        const ENOBUFS = 1;
        const EOPNOTSUPP = 4;
        const EWOULDBLOCK = 6;
        const ENOTCONN = 9;
        const EALREADY = 10;
        const EINVAL = 11;
        const EMSGSIZE = 12;
        const EADDRINUSE = 20;
        const ECONNABORTED = 53;
        const EISCONN = 56;
        const ETIMEDOUT = 60;
        const ECONNREFUSED = 61;
        if (sub === 0) {
          let handle = state.nextSocket >>> 0;
          if (!handle) {
            handle = 1;
          }
          state.nextSocket = ((handle + 1) >>> 0) || 1;
          state.sockets.set(
            handle >>> 0,
            this.createNetworkSocketRecord(
              handle >>> 0,
              this.readReg(REG.ECX) >>> 0,
              this.readReg(REG.EDX) >>> 0,
              this.readReg(REG.ESI) >>> 0
            )
          );
          this.writeReg(REG.EAX, handle >>> 0);
          this.writeReg(REG.EBX, 0);
          return;
        }
        if (sub === 1) {
          const handle = this.readReg(REG.ECX) >>> 0;
          const ok = this.closeNetworkSocketHandle(handle >>> 0);
          this.writeReg(REG.EAX, ok ? 0 : (0xffffffff >>> 0));
          this.writeReg(REG.EBX, ok ? 0 : ENOTCONN);
          return;
        }
        if (sub === 2) {
          const handle = this.readReg(REG.ECX) >>> 0;
          const socket = state.sockets.get(handle >>> 0) || null;
          const sockaddr = this.readSockaddrIn(this.readReg(REG.EDX) >>> 0, this.readReg(REG.ESI) >>> 0);
          const errorCode = this.bindSocketLocalEndpoint(socket, sockaddr) >>> 0;
          this.writeReg(REG.EAX, errorCode ? (0xffffffff >>> 0) : 0);
          this.writeReg(REG.EBX, errorCode >>> 0);
          return;
        }
        if (sub === 3) {
          const handle = this.readReg(REG.ECX) >>> 0;
          const socket = state.sockets.get(handle >>> 0) || null;
          const backlog = Math.max(0, this.readReg(REG.EDX) | 0) >>> 0;
          if (!socket) {
            this.writeReg(REG.EAX, 0xffffffff >>> 0);
            this.writeReg(REG.EBX, EINVAL);
            return;
          }
          if ((socket.type >>> 0) !== 1) {
            this.writeReg(REG.EAX, 0xffffffff >>> 0);
            this.writeReg(REG.EBX, EOPNOTSUPP);
            return;
          }
          if (!this.ensureSocketLocalEndpoint(socket)) {
            this.writeReg(REG.EAX, 0xffffffff >>> 0);
            this.writeReg(REG.EBX, ENOBUFS);
            return;
          }
          socket.listening = true;
          socket.connected = false;
          socket.listenBacklog = Math.max(1, backlog | 0) >>> 0;
          if (!Array.isArray(socket.pendingAccepts)) {
            socket.pendingAccepts = [];
          }
          this.writeReg(REG.EAX, 0);
          this.writeReg(REG.EBX, 0);
          return;
        }
        if (sub === 4) {
          const handle = this.readReg(REG.ECX) >>> 0;
          const socket = state.sockets.get(handle >>> 0) || null;
          const sockaddr = this.readSockaddrIn(this.readReg(REG.EDX) >>> 0, this.readReg(REG.ESI) >>> 0);
          if (!socket || !sockaddr) {
            this.writeReg(REG.EAX, 0xffffffff >>> 0);
            this.writeReg(REG.EBX, EINVAL);
            return;
          }
          if (socket.connected) {
            this.writeReg(REG.EAX, 0xffffffff >>> 0);
            this.writeReg(REG.EBX, EISCONN);
            return;
          }
          if (socket.requestPending) {
            this.writeReg(REG.EAX, 0xffffffff >>> 0);
            this.writeReg(REG.EBX, EALREADY);
            return;
          }
          const errorCode = this.socketConnectInternal(socket, sockaddr) >>> 0;
          this.writeReg(REG.EAX, errorCode ? (0xffffffff >>> 0) : 0);
          this.writeReg(REG.EBX, errorCode >>> 0);
          return;
        }
        if (sub === 5) {
          const handle = this.readReg(REG.ECX) >>> 0;
          const socket = state.sockets.get(handle >>> 0) || null;
          const outPtr = this.readReg(REG.EDX) >>> 0;
          const outLen = this.readReg(REG.ESI) >>> 0;
          if (!socket) {
            this.writeReg(REG.EAX, 0xffffffff >>> 0);
            this.writeReg(REG.EBX, EINVAL);
            return;
          }
          if (!socket.listening || (socket.type >>> 0) !== 1) {
            this.writeReg(REG.EAX, 0xffffffff >>> 0);
            this.writeReg(REG.EBX, EOPNOTSUPP);
            return;
          }
          if (Array.isArray(socket.pendingAccepts) && socket.pendingAccepts.length) {
            const acceptedHandle = socket.pendingAccepts.shift() >>> 0;
            const accepted = state.sockets.get(acceptedHandle >>> 0) || null;
            if (!accepted) {
              this.writeReg(REG.EAX, 0xffffffff >>> 0);
              this.writeReg(REG.EBX, ECONNABORTED);
              return;
            }
            if (outPtr) {
              this.writeSockaddrIn(outPtr >>> 0, outLen >>> 0, 2, accepted.remotePort >>> 0, accepted.remoteAddr >>> 0);
            }
            this.writeReg(REG.EAX, acceptedHandle >>> 0);
            this.writeReg(REG.EBX, 0);
            return;
          }
          this.writeReg(REG.EAX, 0xffffffff >>> 0);
          this.writeReg(REG.EBX, this.getSocketWaitError(socket, 0) >>> 0);
          return;
        }
        if (sub === 6) {
          const handle = this.readReg(REG.ECX) >>> 0;
          const socket = state.sockets.get(handle >>> 0) || null;
          const dataPtr = this.readReg(REG.EDX) >>> 0;
          const dataLength = this.readReg(REG.ESI) >>> 0;
          const flags = this.readReg(REG.EDI) >>> 0;
          const devices = this.getEmulatedNetworkDevices();
          const device = this.resolveNetworkApiDevice((socket && socket.bindDevice) ? (socket.bindDevice >>> 0) : 1, devices) || this.getPrimaryNetworkDevice(devices);
          if (!this.canSocketSend(socket)) {
            this.writeReg(REG.EAX, 0xffffffff >>> 0);
            this.writeReg(REG.EBX, ENOTCONN);
            return;
          }
          const payload = dataLength ? this.readMemBlock(dataPtr >>> 0, dataLength >>> 0) : new Uint8Array(0);
          if (!(payload instanceof Uint8Array) || payload.length !== (dataLength >>> 0)) {
            this.writeReg(REG.EAX, 0xffffffff >>> 0);
            this.writeReg(REG.EBX, EINVAL);
            return;
          }
          if ((payload.length >>> 0) > (socket.sendBufferSize >>> 0)) {
            this.writeReg(REG.EAX, 0xffffffff >>> 0);
            this.writeReg(REG.EBX, EMSGSIZE);
            return;
          }
          socket.sendChunks.push(new Uint8Array(payload));
          socket.sendLength = ((socket.sendLength >>> 0) + (payload.length >>> 0)) >>> 0;
          this.updateDeviceTraffic(
            device,
            "tx",
            payload.length >>> 0,
            (socket.type >>> 0) === 2 ? "udpTxPackets" : ((socket.type >>> 0) === 1 ? "tcpTxPackets" : ((socket.protocol >>> 0) === 1 ? "icmpTxPackets" : ""))
          );
          const internalError = this.deliverSocketPayload(socket, payload);
          if (!internalError) {
            this.writeReg(REG.EAX, payload.length >>> 0);
            this.writeReg(REG.EBX, 0);
            return;
          }
          if ((socket.type >>> 0) === 2 && (socket.remotePort >>> 0) === 53) {
            const ok = this.dispatchSyntheticDns(socket, payload);
            this.writeReg(REG.EAX, ok ? (payload.length >>> 0) : (0xffffffff >>> 0));
            this.writeReg(REG.EBX, ok ? 0 : ECONNREFUSED);
            return;
          }
          if ((socket.type >>> 0) === 1) {
            this.dispatchHttpSocketRequest(socket);
            this.writeReg(REG.EAX, payload.length >>> 0);
            this.writeReg(REG.EBX, 0);
            return;
          }
          this.writeReg(REG.EAX, 0xffffffff >>> 0);
          this.writeReg(REG.EBX, EOPNOTSUPP);
          return;
        }
        if (sub === 7) {
          const handle = this.readReg(REG.ECX) >>> 0;
          const socket = state.sockets.get(handle >>> 0) || null;
          const dataPtr = this.readReg(REG.EDX) >>> 0;
          const dataLength = this.readReg(REG.ESI) >>> 0;
          const flags = this.readReg(REG.EDI) >>> 0;
          const devices = this.getEmulatedNetworkDevices();
          const device = this.resolveNetworkApiDevice((socket && socket.bindDevice) ? (socket.bindDevice >>> 0) : 1, devices) || this.getPrimaryNetworkDevice(devices);
          if (!socket) {
            this.writeReg(REG.EAX, 0xffffffff >>> 0);
            this.writeReg(REG.EBX, EINVAL);
            return;
          }
          if (socket.listening) {
            this.writeReg(REG.EAX, 0xffffffff >>> 0);
            this.writeReg(REG.EBX, EOPNOTSUPP);
            return;
          }
          if (!this.canSocketReceive(socket)) {
            this.writeReg(REG.EAX, 0xffffffff >>> 0);
            this.writeReg(REG.EBX, ENOTCONN);
            return;
          }
          if (socket.socketError) {
            const errorCode = socket.socketError >>> 0;
            socket.socketError = 0;
            this.writeReg(REG.EAX, 0xffffffff >>> 0);
            this.writeReg(REG.EBX, errorCode >>> 0);
            return;
          }
          const data = this.readSocketReceiveData(socket, dataLength >>> 0, (flags & 0x02) !== 0);
          if (data instanceof Uint8Array && data.length) {
            this.writeMemBlock(dataPtr >>> 0, data);
            this.updateDeviceTraffic(
              device,
              "rx",
              data.length >>> 0,
              (socket.type >>> 0) === 2 ? "udpRxPackets" : ((socket.type >>> 0) === 1 ? "tcpRxPackets" : ((socket.protocol >>> 0) === 1 ? "icmpRxPackets" : ""))
            );
            this.writeReg(REG.EAX, data.length >>> 0);
            this.writeReg(REG.EBX, 0);
            return;
          }
          if (socket.remoteClosed && !socket.requestPending) {
            this.writeReg(REG.EAX, 0);
            this.writeReg(REG.EBX, 0);
            return;
          }
          this.writeReg(REG.EAX, 0xffffffff >>> 0);
          this.writeReg(REG.EBX, this.getSocketWaitError(socket, flags >>> 0) >>> 0);
          return;
        }
        if (sub === 8) {
          const handle = this.readReg(REG.ECX) >>> 0;
          const socket = state.sockets.get(handle >>> 0) || null;
          const option = this.readSocketOption(this.readReg(REG.EDX) >>> 0);
          const errorCode = this.setSocketOptionState(socket, option) >>> 0;
          this.writeReg(REG.EAX, errorCode ? (0xffffffff >>> 0) : 0);
          this.writeReg(REG.EBX, errorCode >>> 0);
          return;
        }
        if (sub === 9) {
          const handle = this.readReg(REG.ECX) >>> 0;
          const socket = state.sockets.get(handle >>> 0) || null;
          const option = this.readSocketOption(this.readReg(REG.EDX) >>> 0);
          const errorCode = this.getSocketOptionState(socket, option) >>> 0;
          this.writeReg(REG.EAX, errorCode ? (0xffffffff >>> 0) : 0);
          this.writeReg(REG.EBX, errorCode >>> 0);
          return;
        }
        if (sub === 10) {
          let first = state.nextSocket >>> 0;
          if (!first) {
            first = 1;
          }
          let second = (first + 1) >>> 0;
          state.nextSocket = ((second + 1) >>> 0) || 1;
          const firstSocket = this.createNetworkSocketRecord(first >>> 0, 1, 1, 0);
          const secondSocket = this.createNetworkSocketRecord(second >>> 0, 1, 1, 0);
          firstSocket.pair = second >>> 0;
          secondSocket.pair = first >>> 0;
          firstSocket.connected = true;
          secondSocket.connected = true;
          state.sockets.set(first >>> 0, firstSocket);
          state.sockets.set(second >>> 0, secondSocket);
          this.writeReg(REG.EAX, first >>> 0);
          this.writeReg(REG.EBX, second >>> 0);
          return;
        }
        this.writeReg(REG.EAX, 0xffffffff >>> 0);
        this.writeReg(REG.EBX, EOPNOTSUPP);
      },

      sysNetworkProtocol() {
        const ebx = this.readReg(REG.EBX) >>> 0;
        const protocol = (ebx >>> 16) & 0xffff;
        const apiDeviceNumber = (ebx >>> 8) & 0xff;
        const sub = ebx & 0xff;
        const devices = this.getEmulatedNetworkDevices();
        const device = this.resolveNetworkApiDevice(apiDeviceNumber >>> 0, devices);
        if (!device) {
          this.writeReg(REG.EAX, 0xffffffff >>> 0);
          return;
        }
        this.ensureNetworkDeviceState(device, apiDeviceNumber > 0 ? ((apiDeviceNumber - 1) | 0) : 0);
        if (protocol === 0 && sub === 0) {
          const mac = typeof device.mac === "bigint" ? device.mac : BigInt(device.mac || 0);
          this.writeReg(REG.EAX, Number(mac & 0xffffffffn) >>> 0);
          this.writeReg(REG.EBX, Number((mac >> 32n) & 0xffffn) >>> 0);
          return;
        }
        const readOnlyMap = {
          0x10000: "txPackets",
          0x10001: "rxPackets",
          0x10002: "ip",
          0x10004: "dns",
          0x10006: "subnet",
          0x10008: "gateway",
          0x20000: "icmpTxPackets",
          0x20001: "icmpRxPackets",
          0x30000: "udpTxPackets",
          0x30001: "udpRxPackets",
          0x40000: "tcpTxPackets",
          0x40001: "tcpRxPackets",
          0x50000: "arpTxPackets",
          0x50001: "arpRxPackets",
          0x50002: "arpEntries",
          0x50007: "arpConflicts"
        };
        const writeMap = {
          0x10003: "ip",
          0x10005: "dns",
          0x10007: "subnet",
          0x10009: "gateway"
        };
        const key = (((protocol & 0xffff) << 16) | ((sub & 0xff) << 0)) >>> 0;
        if (readOnlyMap[key]) {
          if (readOnlyMap[key] === "arpEntries") {
            this.writeReg(REG.EAX, this.getDeviceArpTable(device).length >>> 0);
            return;
          }
          this.writeReg(REG.EAX, (device[readOnlyMap[key]] >>> 0) || 0);
          return;
        }
        if (writeMap[key]) {
          device[writeMap[key]] = this.readReg(REG.ECX) >>> 0;
          if (key === 0x10003 || key === 0x10005 || key === 0x10007 || key === 0x10009) {
            device.linkUp = true;
            if (!device.linkStatus) {
              device.linkStatus = 0x0a;
            }
          }
          this.writeReg(REG.EAX, 0);
          return;
        }
        if (key === 0x50003) {
          const index = this.readReg(REG.ECX) >>> 0;
          const outPtr = this.readReg(REG.EDI) >>> 0;
          const table = this.getDeviceArpTable(device);
          const entry = index < table.length ? (table[index] || null) : null;
          if (!entry || !this.writeArpEntryStruct(outPtr >>> 0, entry)) {
            this.writeReg(REG.EAX, 0xffffffff >>> 0);
            return;
          }
          this.writeReg(REG.EAX, 0);
          return;
        }
        if (key === 0x50004) {
          const entry = this.readArpEntryStruct(this.readReg(REG.ESI) >>> 0);
          if (!entry) {
            this.writeReg(REG.EAX, 0xffffffff >>> 0);
            return;
          }
          const table = this.getDeviceArpTable(device);
          const existingIndex = table.findIndex((item) => item && (item.ip >>> 0) === (entry.ip >>> 0));
          if (existingIndex >= 0) {
            table[existingIndex] = entry;
          } else {
            table.push(entry);
          }
          device.arpEntries = table.length >>> 0;
          device.arpTxPackets = ((device.arpTxPackets >>> 0) + 1) >>> 0;
          this.writeReg(REG.EAX, 0);
          return;
        }
        if (key === 0x50005) {
          const table = this.getDeviceArpTable(device);
          const index = this.readReg(REG.ECX) >>> 0;
          if (index === 0xffffffff >>> 0) {
            table.length = 0;
            device.arpEntries = 0;
            this.writeReg(REG.EAX, 0);
            return;
          }
          if (index >= table.length) {
            this.writeReg(REG.EAX, 0xffffffff >>> 0);
            return;
          }
          table.splice(index, 1);
          device.arpEntries = table.length >>> 0;
          this.writeReg(REG.EAX, 0);
          return;
        }
        if (key === 0x50006) {
          device.arpTxPackets = ((device.arpTxPackets >>> 0) + 1) >>> 0;
          this.writeReg(REG.EAX, 0);
          return;
        }
        if (key === 0x20003) {
          this.writeReg(REG.EAX, 0);
          return;
        }
        this.writeReg(REG.EAX, 0xffffffff >>> 0);
      },

      sysTerminate() {
        if (typeof this.stop === "function") {
          this.stop("terminated");
        } else {
          this.running = false;
          if (this.emitStopped) {
            this.emitStopped("terminated");
          }
        }
        if (this.traceSyscalls) {
          this.log("syscall -1 -> terminate");
        }
      },

      heapInit() {
        if (this.heapEnabled) {
          this.writeReg(REG.EAX, this.heapSize >>> 0);
          if (this.traceSyscalls) {
            this.log(`heap init (existing) base=0x${this.heapBase.toString(16)} size=0x${this.heapSize.toString(16)}`);
          }
          return;
        }
        const memSize = this.memLimit || 0;
        if (!memSize) {
          this.writeReg(REG.EAX, 0);
          if (this.traceSyscalls) {
            this.log("heap init failed: no memory limit");
          }
          return;
        }
        const reservedSize = Math.max(
          this.processReservedSize >>> 0,
          this.image ? (this.image.header.memorySize >>> 0) : 0,
          this.stackBase >>> 0
        ) >>> 0;
        const base = align4k(Math.min(memSize, reservedSize));
        this.heapEnabled = true;
        this.heapBase = base >>> 0;
        this.heapTop = this.heapBase >>> 0;
        this.heapLowBase = this.heapBase >>> 0;
        this.heapLowSize = Math.max(0, memSize - base) >>> 0;
        this.heapLowTop = this.heapTop >>> 0;
        this.heapHighBase = 0;
        this.heapHighTop = 0;
        this.heapHighSize = 0;
        this.heapSize = this.heapLowSize >>> 0;
        this.heapAllocs.clear();
        this.heapFreeBlocks.length = 0;
        this.writeReg(REG.EAX, this.heapSize >>> 0);
        if (this.traceSyscalls) {
          this.log(`heap init base=0x${this.heapBase.toString(16)} size=0x${this.heapSize.toString(16)}`);
        }
      },

      heapAllocFromFreeList(size) {
        const requestSize = size >>> 0;
        if (!requestSize) {
          return 0;
        }
        const blocks = Array.isArray(this.heapFreeBlocks) ? this.heapFreeBlocks : [];
        for (let i = 0; i < blocks.length; i += 1) {
          const block = blocks[i];
          if (!block || (block.size >>> 0) < requestSize) {
            continue;
          }
          const ptr = block.ptr >>> 0;
          if ((block.size >>> 0) === requestSize) {
            blocks.splice(i, 1);
          } else {
            block.ptr = ((block.ptr >>> 0) + requestSize) >>> 0;
            block.size = ((block.size >>> 0) - requestSize) >>> 0;
          }
          return ptr >>> 0;
        }
        return 0;
      },

      heapAllocBump(size) {
        const requestSize = size >>> 0;
        let ptr = this.heapLowTop >>> 0;
        if (ptr + requestSize <= (this.heapLowBase + this.heapLowSize)) {
          this.heapLowTop = (ptr + requestSize) >>> 0;
          this.heapTop = this.heapLowTop >>> 0;
          return ptr >>> 0;
        }
        const needed = (ptr + requestSize) >>> 0;
        if (!this.ensureMemoryCapacity(needed)) {
          return 0;
        }
        ptr = this.heapLowTop >>> 0;
        if (ptr + requestSize > (this.heapLowBase + this.heapLowSize)) {
          return 0;
        }
        this.heapLowTop = (ptr + requestSize) >>> 0;
        this.heapTop = this.heapLowTop >>> 0;
        return ptr >>> 0;
      },

      heapInsertFreeBlock(ptr, size) {
        const start = ptr >>> 0;
        const blockSize = size >>> 0;
        if (!start || !blockSize) {
          return;
        }
        if (!Array.isArray(this.heapFreeBlocks)) {
          this.heapFreeBlocks = [];
        }
        const blocks = this.heapFreeBlocks;
        let nextStart = start >>> 0;
        let nextEnd = (start + blockSize) >>> 0;
        let insertAt = blocks.length;
        for (let i = 0; i < blocks.length; i += 1) {
          const block = blocks[i];
          const blockStart = block.ptr >>> 0;
          const blockEnd = (blockStart + (block.size >>> 0)) >>> 0;
          if (nextEnd < blockStart) {
            insertAt = i;
            break;
          }
          if (nextStart > blockEnd) {
            continue;
          }
          nextStart = Math.min(nextStart, blockStart) >>> 0;
          nextEnd = Math.max(nextEnd, blockEnd) >>> 0;
          blocks.splice(i, 1);
          i -= 1;
          insertAt = i + 1;
        }
        blocks.splice(insertAt, 0, {
          ptr: nextStart >>> 0,
          size: (nextEnd - nextStart) >>> 0
        });
        this.heapReleaseTailFreeBlocks();
      },

      heapReleaseTailFreeBlocks() {
        if (!Array.isArray(this.heapFreeBlocks) || !this.heapFreeBlocks.length) {
          return;
        }
        let changed = false;
        while (this.heapFreeBlocks.length) {
          const last = this.heapFreeBlocks[this.heapFreeBlocks.length - 1];
          if (!last) {
            this.heapFreeBlocks.pop();
            continue;
          }
          const end = ((last.ptr >>> 0) + (last.size >>> 0)) >>> 0;
          if (end !== (this.heapLowTop >>> 0)) {
            break;
          }
          this.heapLowTop = last.ptr >>> 0;
          this.heapTop = this.heapLowTop >>> 0;
          this.heapFreeBlocks.pop();
          changed = true;
        }
        if (changed && this.traceSyscalls) {
          this.log(`heap release tail -> top=0x${this.heapLowTop.toString(16)}`);
        }
      },

      heapAlloc() {
        if (!this.heapEnabled) {
          this.heapInit();
        }
        const request = this.readReg(REG.ECX) >>> 0;
        if (!request) {
          this.writeReg(REG.EAX, 0);
          if (this.traceSyscalls) {
            this.log("heap alloc size=0 -> ptr=0");
          }
          return;
        }
        const size = this.alignProcessHeapSize(request);
        const ptr = this.heapAllocInternal(size);
        if (!ptr) {
          this.writeReg(REG.EAX, 0);
          if (this.traceSyscalls) {
            this.log(`heap alloc size=0x${request.toString(16)} -> ptr=0 (oom)`);
          }
          return;
        }
        this.writeReg(REG.EAX, ptr >>> 0);
        if (this.traceSyscalls) {
          this.log(`heap alloc size=0x${request.toString(16)} -> ptr=0x${ptr.toString(16)}`);
        }
      },

      heapFree() {
        const ptr = this.readReg(REG.ECX) >>> 0;
        if (!ptr || !this.heapAllocs.has(ptr)) {
          this.writeReg(REG.EAX, 0);
          return;
        }
        const size = this.heapAllocs.get(ptr) >>> 0;
        this.heapAllocs.delete(ptr);
        this.heapInsertFreeBlock(ptr, size);
        this.writeReg(REG.EAX, 1);
      },

      heapRealloc() {
        if (!this.heapEnabled) {
          this.heapInit();
        }
        const sizeReq = this.readReg(REG.ECX) >>> 0;
        const ptr = this.readReg(REG.EDX) >>> 0;
        if (!ptr) {
          this.readReg(REG.ECX);
          this.heapAlloc();
          return;
        }
        if (sizeReq === 0) {
          this.writeReg(REG.ECX, ptr);
          this.heapFree();
          this.writeReg(REG.EAX, 0);
          if (this.traceSyscalls) {
            this.log(`heap realloc ptr=0x${ptr.toString(16)} size=0 -> free`);
          }
          return;
        }
        const oldSize = this.heapAllocs.get(ptr) >>> 0;
        const newSize = this.alignProcessHeapSize(sizeReq);
        if (oldSize && newSize <= oldSize) {
          this.heapAllocs.set(ptr, oldSize);
          this.writeReg(REG.EAX, ptr >>> 0);
          if (this.traceSyscalls) {
            this.log(`heap realloc ptr=0x${ptr.toString(16)} size=0x${sizeReq.toString(16)} -> reuse`);
          }
          return;
        }
        const newPtr = this.heapAllocInternal(newSize);
        if (!newPtr) {
          this.writeReg(REG.EAX, 0);
          if (this.traceSyscalls) {
            this.log(`heap realloc ptr=0x${ptr.toString(16)} size=0x${sizeReq.toString(16)} -> 0 (oom)`);
          }
          return;
        }
        const copySize = oldSize ? Math.min(oldSize, newSize) : 0;
        if (copySize) {
          const data = this.readMemBlock(ptr, copySize);
          if (data) {
            this.writeMemBlock(newPtr, data);
          }
        }
        if (oldSize) {
          this.heapAllocs.delete(ptr);
        }
        this.writeReg(REG.EAX, newPtr >>> 0);
        if (this.traceSyscalls) {
          this.log(`heap realloc ptr=0x${ptr.toString(16)} size=0x${sizeReq.toString(16)} -> 0x${newPtr.toString(16)}`);
        }
      },

      heapAllocInternal(size) {
        const requestSize = size >>> 0;
        const mem = this.cpu && this.cpu.mem ? this.cpu.mem : null;
        const previousMemLength = mem ? (mem.length >>> 0) : 0;
        let ptr = this.heapAllocFromFreeList(requestSize);
        if (!ptr) {
          ptr = this.heapAllocBump(requestSize);
        }
        if (!ptr) {
          return 0;
        }
        this.heapAllocs.set(ptr, requestSize);
        if (this.cpu && this.cpu.mem) {
          const start = ptr >>> 0;
          const end = Math.min((start + requestSize) >>> 0, this.cpu.mem.length >>> 0);
          if (end > start) {
            let dirtyEnd = end;
            if (previousMemLength && end > previousMemLength && (this.cpu.mem.length >>> 0) > previousMemLength) {
              dirtyEnd = Math.min(end, previousMemLength) >>> 0;
            }
            if (dirtyEnd > start) {
              // Fresh tail bytes after a Uint8Array grow are already zeroed.
              this.invalidateBasicBlocksForWrite(start, dirtyEnd - start);
              this.cpu.mem.fill(0, start, dirtyEnd);
            }
          }
        }
        return ptr >>> 0;
      },

      maybeInjectTimerEvent() {
        const now = Date.now();
        if (!this.lastTimerEventAt) {
          this.lastTimerEventAt = now;
          this.queueEvent(1);
          return;
        }
        if (now - this.lastTimerEventAt >= 16) {
          this.lastTimerEventAt = now;
          this.queueEvent(1);
        }
      },

      queueEvent(eventId) {
        if (!eventId) {
          return;
        }
        for (let i = 0; i < this.eventQueue.length; i += 1) {
          if ((this.eventQueue[i] | 0) === (eventId | 0)) {
            return;
          }
        }
        this.eventQueue.push(eventId);
      },

      isPersistentBufferedEvent(eventId) {
        return eventId === 1 || eventId === 2 || eventId === 3 || eventId === 6;
      },

      hasQueuedEvent(eventId) {
        if (!eventId || !this.eventQueue.length) {
          return false;
        }
        for (let i = 0; i < this.eventQueue.length; i += 1) {
          if ((this.eventQueue[i] | 0) === (eventId | 0)) {
            return true;
          }
        }
        return false;
      },

      getNextQueuedEventId() {
        const preferred = [9, 8, 7, 6, 5, 3, 2, 1];
        for (let i = 0; i < preferred.length; i += 1) {
          const eventId = preferred[i];
          if (!this.hasQueuedEvent(eventId) || !this.isEventAllowed(eventId)) {
            continue;
          }
          if (eventId === 2 && !this.hasPendingKeyEvent()) {
            continue;
          }
          if (eventId === 3 && !this.hasPendingButtonEvent()) {
            continue;
          }
          if (eventId === 6 && !this.hasPendingMouseEvent()) {
            continue;
          }
          return eventId;
        }
        for (let i = 0; i < this.eventQueue.length; i += 1) {
          const eventId = this.eventQueue[i] | 0;
          if (eventId === 4) {
            continue;
          }
          if (eventId === 2 && !this.hasPendingKeyEvent()) {
            continue;
          }
          if (eventId === 3 && !this.hasPendingButtonEvent()) {
            continue;
          }
          if (eventId === 6 && !this.hasPendingMouseEvent()) {
            continue;
          }
          if (this.isEventAllowed(eventId)) {
            return eventId;
          }
        }
        return 0;
      },

      dequeueEvent() {
        const eventId = this.getNextQueuedEventId();
        if (!eventId) {
          return 0;
        }
        if (eventId === 6) {
          const nextMouseEvent = this.hasPendingMouseEvent()
            ? this.mouseEventBuffer.shift()
            : null;
          if (typeof this.applyBufferedMouseEvent === "function") {
            this.applyBufferedMouseEvent(nextMouseEvent);
          }
          if (!this.hasPendingMouseEvent()) {
            this.removeQueuedEvent(6);
          }
          return 6;
        }
        if (!this.isPersistentBufferedEvent(eventId)) {
          this.removeQueuedEvent(eventId);
        }
        return eventId;
      },

      isEventEnabledByMask(eventId) {
        if (!eventId) {
          return false;
        }
        const bit = eventId - 1;
        if (bit < 0 || bit > 30) {
          return true;
        }
        return ((this.eventMask >>> bit) & 1) !== 0;
      },

      isEventAllowed(eventId) {
        return this.isEventEnabledByMask(eventId);
      }
    
    });
  }

  KosEmu.emu.installEmulatorSyscalls = installEmulatorSyscalls;
})();

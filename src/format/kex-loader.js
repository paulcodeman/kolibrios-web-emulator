(() => {
  const KosEmu = globalThis.KosEmu;
  const { formatBytes } = KosEmu.core.utils;

  const MENUET_MAGIC = "MENUET01";
  const MENUET_MAGIC_V2 = "MENUET02";
  const HEADER_SIZE = 36;
  const KPCK_MAGIC = 0x4b43504b;
  const KPCK_HEADER_SIZE = 12;
  const KPCK_LZMA_HEADER_SIZE = 14;
  const KPCK_LZMA_PROPS = (2 * 5 + 0) * 9 + 3;
  const KPCK_LZMA_DICT_MIN = 0x10000;
  const KPCK_METHOD_MASK = 0x3f;
  const KPCK_METHOD_LZMA = 1;
  const KPCK_FLAG_CALLTRICK1 = 0x40;
  const KPCK_FLAG_CALLTRICK2 = 0x80;

  function bswap32(value) {
    return (
      ((value & 0xff) << 24) |
      ((value & 0xff00) << 8) |
      ((value >>> 8) & 0xff00) |
      ((value >>> 24) & 0xff)
    ) >>> 0;
  }

  function decodeCallTrickValue(raw) {
    // Matches the unpacker sequence: shr ax,8 / ror eax,16 / xchg al,ah
    // This effectively does bswap(raw) and clears the highest byte (cti marker).
    return bswap32(raw) & 0x00ffffff;
  }

  function applyCallTrick1(output, ctn, cti) {
    let remaining = ctn >>> 0;
    if (!remaining) {
      return;
    }
    const buf = output;
    let i = 0;
    const len = buf.length >>> 0;
    while (remaining && i < len) {
      let al = buf[i++] & 0xff;
      al = (al - 0xe8) & 0xff;
      if (al > 1) {
        continue;
      }
      if (i >= len || buf[i] !== cti) {
        continue;
      }
      if (i + 3 >= len) {
        break;
      }
      let eax =
        buf[i] |
        (buf[i + 1] << 8) |
        (buf[i + 2] << 16) |
        (buf[i + 3] << 24);
      eax = decodeCallTrickValue(eax);
      const ptrAfter = (i + 4) >>> 0;
      eax = (eax - ptrAfter) >>> 0;
      buf[i] = eax & 0xff;
      buf[i + 1] = (eax >>> 8) & 0xff;
      buf[i + 2] = (eax >>> 16) & 0xff;
      buf[i + 3] = (eax >>> 24) & 0xff;
      i = ptrAfter;
      remaining -= 1;
    }
  }

  function applyCallTrick2(output, ctn, cti) {
    let remaining = ctn >>> 0;
    if (!remaining) {
      return;
    }
    const buf = output;
    let i = 0;
    const len = buf.length >>> 0;
    while (remaining && i < len) {
      let al = buf[i++] & 0xff;
      let isJcc = false;
      while (true) {
        if (al === 0x0f) {
          if (i >= len) {
            return;
          }
          al = buf[i++] & 0xff;
          if (al < 0x80) {
            continue;
          }
          if (al < 0x90) {
            isJcc = true;
            break;
          }
        }
        if (al !== 0xe8 && al !== 0xe9) {
          isJcc = false;
          break;
        }
        break;
      }
      if (!isJcc && al !== 0xe8 && al !== 0xe9) {
        continue;
      }
      if (i >= len || buf[i] !== cti) {
        continue;
      }
      if (i + 3 >= len) {
        break;
      }
      let eax =
        buf[i] |
        (buf[i + 1] << 8) |
        (buf[i + 2] << 16) |
        (buf[i + 3] << 24);
      eax = decodeCallTrickValue(eax);
      const ptrAfter = (i + 4) >>> 0;
      eax = (eax - ptrAfter) >>> 0;
      buf[i] = eax & 0xff;
      buf[i + 1] = (eax >>> 8) & 0xff;
      buf[i + 2] = (eax >>> 16) & 0xff;
      buf[i + 3] = (eax >>> 24) & 0xff;
      i = ptrAfter;
      remaining -= 1;
    }
  }

  function maybeUnpackKpck(buffer) {
    if (buffer.byteLength < 4) {
      return { buffer, packed: false, packedSize: buffer.byteLength, unpackedSize: buffer.byteLength };
    }
    const view = new DataView(buffer);
    const signature = view.getUint32(0, true);
    if (signature !== KPCK_MAGIC) {
      return { buffer, packed: false, packedSize: buffer.byteLength, unpackedSize: buffer.byteLength };
    }
    if (buffer.byteLength < KPCK_HEADER_SIZE) {
      throw new Error("KPCK header too small");
    }
    const lzma = globalThis.LZMA;
    if (!lzma || typeof lzma.decompress !== "function") {
      throw new Error("LZMA library not loaded. Ensure lzma_worker-min.js is included.");
    }

    const unpackedSize = view.getUint32(4, true);
    const flags = view.getUint32(8, true);
    const method = flags & KPCK_METHOD_MASK;
    if (method !== KPCK_METHOD_LZMA) {
      throw new Error("KPCK compression flag unsupported");
    }

    let dictSize = KPCK_LZMA_DICT_MIN;
    while (dictSize < unpackedSize) {
      dictSize <<= 1;
    }

    const packedDataView = new DataView(buffer, KPCK_HEADER_SIZE);
    const lzmaBuffer = new Uint8Array(packedDataView.byteLength + KPCK_LZMA_HEADER_SIZE);
    const lzmaView = new DataView(lzmaBuffer.buffer);
    lzmaView.setUint8(0, KPCK_LZMA_PROPS);
    lzmaView.setUint32(1, dictSize, true);
    lzmaView.setBigUint64(5, BigInt(unpackedSize), true);

    // KPCK stores the first LZMA word in little-endian form. Rewrite it only
    // in the temporary decode buffer so parseKex() stays non-mutating.
    lzmaBuffer.set(new Uint8Array(buffer, KPCK_HEADER_SIZE), KPCK_LZMA_HEADER_SIZE);
    const firstUint32 = packedDataView.getUint32(0, true);
    lzmaView.setUint32(KPCK_LZMA_HEADER_SIZE, firstUint32, false);

    const result = lzma.decompress(lzmaBuffer);

    let output = null;
    if (result && result.buffer instanceof ArrayBuffer) {
      output = new Uint8Array(result.buffer, result.byteOffset || 0, result.byteLength || result.length);
    } else if (Array.isArray(result)) {
      output = Uint8Array.from(result);
    } else if (result instanceof Uint8Array) {
      output = result;
    }

    if (!output) {
      throw new Error("KPCK unpack failed");
    }

    if (buffer.byteLength >= 5) {
      const ctn = view.getUint32(buffer.byteLength - 5, true);
      const cti = new Uint8Array(buffer)[buffer.byteLength - 1] & 0xff;
      if (flags & KPCK_FLAG_CALLTRICK2) {
        applyCallTrick2(output, ctn, cti);
      } else if (flags & KPCK_FLAG_CALLTRICK1) {
        applyCallTrick1(output, ctn, cti);
      }
    }

    const outBuffer = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
    return {
      buffer: outBuffer,
      packed: true,
      packedSize: buffer.byteLength,
      unpackedSize
    };
  }

  function parseKex(buffer, fileName) {
    const originalSize = buffer.byteLength;
    const unpacked = maybeUnpackKpck(buffer);
    const activeBuffer = unpacked.buffer;
    const size = activeBuffer.byteLength;

    if (size < HEADER_SIZE) {
      throw new Error("File too small for MENUET header");
    }

    const view = new DataView(activeBuffer);

    const magic = readAscii(view, 0, 8);
    if (magic !== MENUET_MAGIC && magic !== MENUET_MAGIC_V2) {
      throw new Error(`Unsupported magic '${magic}'. Expected '${MENUET_MAGIC}'.`);
    }

    const header = {
      magic,
      version: view.getUint32(8, true),
      entry: view.getUint32(12, true),
      imageSize: view.getUint32(16, true),
      memorySize: view.getUint32(20, true),
      stack: view.getUint32(24, true),
      argv: view.getUint32(28, true),
      path: view.getUint32(32, true)
    };

    const warnings = [];
    if (header.imageSize < HEADER_SIZE) {
      if (header.imageSize === 0) {
        warnings.push("imageSize=0 (using full file size)");
        header.imageSize = size;
      } else {
        warnings.push("imageSize < header size (using full file size)");
        header.imageSize = size;
      }
    }
    if (header.imageSize > size) {
      warnings.push("imageSize > file size (padding with zeros)");
    }
    if ((header.entry >>> 0) >= (header.imageSize >>> 0) && (header.entry >>> 0) < (size >>> 0)) {
      warnings.push("entry > imageSize (using full file size)");
      header.imageSize = size;
    }
    if (header.memorySize < header.imageSize) {
      warnings.push("memorySize < imageSize (may be malformed)");
    }

    if (header.version >= 2) {
      const kx = parseKxHeader(view, HEADER_SIZE);
      if (kx) {
        header.kx = kx;
      } else {
        warnings.push("Header version >=2 but KX header not found");
      }
    }

    const loadSize = Math.max(size, header.imageSize) >>> 0;
    const image = new Uint8Array(loadSize);
    image.set(new Uint8Array(activeBuffer.slice(0, Math.min(size, loadSize))), 0);

    return {
      fileName: fileName || "(buffer)",
      fileSize: originalSize,
      unpackedSize: size,
      loadSize,
      packed: unpacked.packed,
      header,
      image,
      warnings
    };
  }

  function formatKexInfo(image) {
  const h = image.header;
  const lines = [
    `File: ${image.fileName}`,
    `File size: ${formatBytes(image.fileSize)}`,
    `Packed: ${image.packed ? "yes" : "no"}`,
    `Unpacked size: ${formatBytes(image.unpackedSize)}`,
    "",
    `Magic: ${h.magic}`,
    `Version: ${h.version}`,
    `Entry: 0x${h.entry.toString(16).padStart(8, "0")}`,
    `Image size: ${formatBytes(h.imageSize)}`,
    `Memory size: ${formatBytes(h.memorySize)}`,
    `Stack: 0x${h.stack.toString(16).padStart(8, "0")}`,
    `Argv: 0x${h.argv.toString(16).padStart(8, "0")}`,
    `Path: 0x${h.path.toString(16).padStart(8, "0")}`
  ];

  if (h.kx) {
    lines.push("");
    lines.push("KX header:");
    lines.push(`  Revision: ${h.kx.revision}`);
    lines.push(`  Arch: ${h.kx.arch}`);
    lines.push(`  Flags: 0x${h.kx.flags.toString(16)}`);
    if (h.kx.exportsPtr !== undefined) {
      lines.push(`  Exports: 0x${h.kx.exportsPtr.toString(16)}`);
    }
    if (h.kx.importsPtr !== undefined) {
      lines.push(`  Imports: 0x${h.kx.importsPtr.toString(16)}`);
    }
  }

  if (image.warnings.length) {
    lines.push("");
    lines.push("Warnings:");
    for (const w of image.warnings) {
      lines.push(`- ${w}`);
    }
  }

  return lines.join("\n");
}

function parseKxHeader(view, offset) {
  if (offset + 8 > view.byteLength) {
    return null;
  }
  const sig = readAscii(view, offset, 2);
  if (sig !== "KX") {
    return null;
  }

  const revision = view.getUint8(offset + 2);
  const arch = view.getUint8(offset + 3);
  const flags = view.getUint16(offset + 4, true);
  let cursor = offset + 8;

  const kx = { revision, arch, flags };
  const hasExport = (flags & (1 << 5)) !== 0;
  const hasImport = (flags & (1 << 6)) !== 0;

  if (hasExport && cursor + 4 <= view.byteLength) {
    kx.exportsPtr = view.getUint32(cursor, true);
    cursor += 4;
  }
  if (hasImport && cursor + 4 <= view.byteLength) {
    kx.importsPtr = view.getUint32(cursor, true);
    cursor += 4;
  }

  return kx;
}

function readAscii(view, offset, length) {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    const byte = view.getUint8(offset + i);
    if (byte === 0) {
      break;
    }
    out += String.fromCharCode(byte);
  }
  return out;
}

  function scanSyscalls(buffer) {
    const sites = [];
    if (!buffer || buffer.length < 2) {
      return sites;
    }
    for (let i = 0; i < buffer.length - 1; i += 1) {
      if (buffer[i] === 0xcd && buffer[i + 1] === 0x40) {
        sites.push(i);
        i += 1;
      }
    }
    return sites;
  }

function decodeX86Instruction(buffer, offset, limit) {
  let i = offset >>> 0;
  let operandSize = 4;
  let addressSize = 4;
  const start = i;

  while (i < limit) {
    const b = buffer[i];
    if (b === 0x66) {
      operandSize = 2;
      i += 1;
      continue;
    }
    if (b === 0x67) {
      addressSize = 2;
      i += 1;
      continue;
    }
    if (
      b === 0xf0 ||
      b === 0xf2 ||
      b === 0xf3 ||
      b === 0x2e ||
      b === 0x36 ||
      b === 0x3e ||
      b === 0x26 ||
      b === 0x64 ||
      b === 0x65
    ) {
      i += 1;
      continue;
    }
    break;
  }

  if (i >= limit) {
    return null;
  }

  const op = buffer[i++];
  let immBytes = 0;
  let relBytes = 0;
  let hasModrm = false;
  let flow = null;
  let indirect = false;
  let op2 = -1;
  let known = false;
  let regField = 0;
  let modrmByte = 0;
  let modrmOffset = -1;

  if (op === 0x0f) {
    if (i >= limit) {
      return null;
    }
    op2 = buffer[i++];
    if (op2 >= 0x80 && op2 <= 0x8f) {
      relBytes = 4;
      flow = "jcc";
      known = true;
    } else if (op2 >= 0x90 && op2 <= 0x9f) {
      hasModrm = true;
      known = true;
    } else if (op2 >= 0xc8 && op2 <= 0xcf) {
      known = true;
    } else if (op2 === 0xaf || op2 === 0xbe || op2 === 0xb6 || op2 === 0xb7 || op2 === 0xbf) {
      hasModrm = true;
      known = true;
    } else {
      return null;
    }
  } else if (op >= 0x70 && op <= 0x7f) {
    relBytes = 1;
    flow = "jcc";
    known = true;
  } else {
    switch (op) {
      case 0xe8:
        relBytes = 4;
        flow = "call";
        known = true;
        break;
      case 0xe9:
        relBytes = 4;
        flow = "jmp";
        known = true;
        break;
      case 0xeb:
        relBytes = 1;
        flow = "jmp";
        known = true;
        break;
      case 0xe0:
      case 0xe1:
      case 0xe2:
        relBytes = 1;
        flow = "loop";
        known = true;
        break;
      case 0xe3:
        relBytes = 1;
        flow = "jcc";
        known = true;
        break;
      case 0xc3:
        flow = "ret";
        known = true;
        break;
      case 0xc2:
        flow = "ret";
        immBytes = 2;
        known = true;
        break;
      case 0x24:
        immBytes = 1;
        known = true;
        break;
      case 0x80:
      case 0x81:
      case 0x82:
      case 0x83:
        hasModrm = true;
        immBytes = op === 0x81 ? operandSize : 1;
        known = true;
        break;
      case 0xc0:
      case 0xc1:
        hasModrm = true;
        immBytes = 1;
        known = true;
        break;
      case 0xd0:
      case 0xd1:
      case 0xd2:
      case 0xd3:
        hasModrm = true;
        known = true;
        break;
      case 0xf6:
      case 0xf7:
        hasModrm = true;
        known = true;
        break;
      case 0xff:
        hasModrm = true;
        known = true;
        break;
      case 0x88:
      case 0x89:
      case 0x8a:
      case 0x8b:
      case 0x31:
      case 0x09:
        hasModrm = true;
        known = true;
        break;
      case 0x60:
      case 0x61:
      case 0x90:
        known = true;
        break;
      default:
        if (op >= 0x50 && op <= 0x5f) {
          known = true;
        } else if (op >= 0x40 && op <= 0x4f) {
          known = true;
        } else {
          return null;
        }
        break;
    }
  }

  if (hasModrm) {
    if (i >= limit) {
      return null;
    }
    modrmOffset = i;
    modrmByte = buffer[i++];
    regField = (modrmByte >> 3) & 7;
    const mod = (modrmByte >> 6) & 3;
    const rm = modrmByte & 7;

    if (addressSize === 4) {
      if (mod !== 3 && rm === 4) {
        if (i >= limit) {
          return null;
        }
        const sib = buffer[i++];
        const base = sib & 7;
        if (mod === 0 && base === 5) {
          i += 4;
        } else if (mod === 1) {
          i += 1;
        } else if (mod === 2) {
          i += 4;
        }
      } else if (mod === 0 && rm === 5) {
        i += 4;
      } else if (mod === 1) {
        i += 1;
      } else if (mod === 2) {
        i += 4;
      }
    } else {
      if (mod === 0 && rm === 6) {
        i += 2;
      } else if (mod === 1) {
        i += 1;
      } else if (mod === 2) {
        i += 2;
      }
    }

    if (op === 0xf6) {
      immBytes = regField === 0 ? 1 : 0;
    } else if (op === 0xf7) {
      immBytes = regField === 0 ? operandSize : 0;
    } else if (op === 0xff) {
      if (regField === 2 || regField === 3) {
        flow = "call";
        indirect = true;
      } else if (regField === 4 || regField === 5) {
        flow = "jmp";
        indirect = true;
      }
    }
  }

  if (!known || i > limit) {
    return null;
  }

  let rel = 0;
  if (relBytes) {
    if (i + relBytes > limit) {
      return null;
    }
    if (relBytes === 1) {
      rel = (buffer[i] << 24) >> 24;
    } else if (relBytes === 2) {
      rel = (buffer[i] | (buffer[i + 1] << 8));
      rel = (rel << 16) >> 16;
    } else if (relBytes === 4) {
      rel =
        buffer[i] |
        (buffer[i + 1] << 8) |
        (buffer[i + 2] << 16) |
        (buffer[i + 3] << 24);
    }
    i += relBytes;
  }

  let immOffset = -1;
  if (immBytes) {
    if (i + immBytes > limit) {
      return null;
    }
    immOffset = i;
    i += immBytes;
  }

  if (flow === "jmp" && indirect) {
    flow = "stop";
  }

  return {
    opcode: op,
    op2,
    len: i - start,
    flow,
    rel,
    indirect,
    regField,
    modrm: modrmByte,
    modrmOffset,
    immOffset,
    immBytes
  };
}

  function scanSoftOps(buffer, entry, limit) {
  const sites = new Map();
  const warnings = [];
  if (!buffer || !buffer.length) {
    return { sites, warnings };
  }
  const max = Math.min(buffer.length, limit || buffer.length);
  const visited = new Set();
  const work = [];
  const startAddr = entry >>> 0;
  if (startAddr < max) {
    work.push(startAddr);
  }

  while (work.length) {
    const start = work.pop();
    if (start >= max) {
      continue;
    }
    let pc = start >>> 0;
    while (pc < max) {
      if (visited.has(pc)) {
        break;
      }
      visited.add(pc);

      const info = decodeX86Instruction(buffer, pc, max);
      if (!info || !info.len) {
        warnings.push(`decode failed at 0x${pc.toString(16)}`);
        break;
      }

      if (info.opcode === 0x0f && info.op2 >= 0xc8 && info.op2 <= 0xcf) {
        const bytes = buffer.slice(pc, pc + info.len);
        sites.set(pc, {
          type: "bswap",
          reg: info.op2 - 0xc8,
          len: info.len,
          bytes
        });
      } else if (info.opcode === 0xe2) {
        const bytes = buffer.slice(pc, pc + info.len);
        sites.set(pc, {
          type: "loop",
          len: info.len,
          bytes
        });
      } else if (info.opcode === 0xd0 && info.regField === 4) {
        const bytes = buffer.slice(pc, pc + info.len);
        sites.set(pc, {
          type: "shlb-mem1",
          len: info.len,
          bytes
        });
      } else if (info.opcode === 0xc0 && info.regField === 5 && info.immBytes === 1) {
        const bytes = buffer.slice(pc, pc + info.len);
        sites.set(pc, {
          type: "shrb-mem-imm",
          len: info.len,
          bytes
        });
      } else if (info.opcode === 0x60 || info.opcode === 0x61) {
        const bytes = buffer.slice(pc, pc + info.len);
        sites.set(pc, {
          type: info.opcode === 0x60 ? "pusha" : "popa",
          len: info.len,
          bytes
        });
      } else if (info.opcode === 0xf6 && info.regField === 0 && info.immBytes === 1) {
        const bytes = buffer.slice(pc, pc + info.len);
        sites.set(pc, {
          type: "testb-imm8",
          len: info.len,
          bytes
        });
      } else if (
        (info.opcode === 0x80 || info.opcode === 0x81 || info.opcode === 0x82 || info.opcode === 0x83) &&
        (info.regField === 0 || info.regField === 1 || info.regField === 4 || info.regField === 5 || info.regField === 7)
      ) {
        const bytes = buffer.slice(pc, pc + info.len);
        sites.set(pc, {
          type: "alu-imm",
          opcode: info.opcode,
          regField: info.regField,
          len: info.len,
          bytes
        });
      } else if (info.opcode === 0xc1 && (info.regField === 4 || info.regField === 5) && info.immBytes === 1) {
        const bytes = buffer.slice(pc, pc + info.len);
        sites.set(pc, {
          type: info.regField === 4 ? "shl32-imm" : "shr32-imm",
          len: info.len,
          bytes
        });
      } else if (info.opcode === 0x88 || info.opcode === 0x8a) {
        const bytes = buffer.slice(pc, pc + info.len);
        sites.set(pc, {
          type: info.opcode === 0x88 ? "mov8-rm-r" : "mov8-r-rm",
          len: info.len,
          bytes
        });
      } else if (info.opcode === 0x89 || info.opcode === 0x8b) {
        const bytes = buffer.slice(pc, pc + info.len);
        sites.set(pc, {
          type: info.opcode === 0x89 ? "mov32-rm-r" : "mov32-r-rm",
          len: info.len,
          bytes
        });
      } else if (info.opcode === 0x31 || info.opcode === 0x09) {
        const bytes = buffer.slice(pc, pc + info.len);
        sites.set(pc, {
          type: info.opcode === 0x31 ? "xor32-rm-r" : "or32-rm-r",
          len: info.len,
          bytes
        });
      } else if (info.opcode === 0xe8) {
        const bytes = buffer.slice(pc, pc + info.len);
        sites.set(pc, {
          type: "call-rel32",
          len: info.len,
          bytes
        });
      } else if (info.opcode === 0xc3) {
        const bytes = buffer.slice(pc, pc + info.len);
        sites.set(pc, {
          type: "ret",
          len: info.len,
          bytes
        });
      } else if (info.opcode >= 0x50 && info.opcode <= 0x5f) {
        const bytes = buffer.slice(pc, pc + info.len);
        const reg = info.opcode & 7;
        sites.set(pc, {
          type: info.opcode < 0x58 ? "push-r32" : "pop-r32",
          reg,
          len: info.len,
          bytes
        });
      } else if (info.opcode >= 0x40 && info.opcode <= 0x4f) {
        const bytes = buffer.slice(pc, pc + info.len);
        const reg = info.opcode & 7;
        sites.set(pc, {
          type: info.opcode < 0x48 ? "inc-r32" : "dec-r32",
          reg,
          len: info.len,
          bytes
        });
      } else if (info.opcode === 0x24) {
        const bytes = buffer.slice(pc, pc + info.len);
        sites.set(pc, {
          type: "and-al-imm8",
          len: info.len,
          bytes
        });
      } else if (info.flow === "jcc") {
        const bytes = buffer.slice(pc, pc + info.len);
        let cc = 0;
        if (info.opcode === 0x0f && info.op2 >= 0x80 && info.op2 <= 0x8f) {
          cc = info.op2 & 0xf;
        } else if (info.opcode >= 0x70 && info.opcode <= 0x7f) {
          cc = info.opcode & 0xf;
        }
        sites.set(pc, {
          type: "jcc",
          cc,
          rel: info.rel,
          len: info.len,
          bytes
        });
      } else if (info.flow === "jmp") {
        const bytes = buffer.slice(pc, pc + info.len);
        sites.set(pc, {
          type: "jmp",
          rel: info.rel,
          len: info.len,
          bytes
        });
      }

      const next = (pc + info.len) >>> 0;
      if (info.flow === "ret" || info.flow === "stop") {
        break;
      }
      if (info.flow === "jmp") {
        const target = (next + info.rel) >>> 0;
        if (target < max) {
          work.push(target);
        }
        break;
      }
      if (info.flow === "jcc" || info.flow === "loop") {
        const target = (next + info.rel) >>> 0;
        if (target < max) {
          work.push(target);
        }
        pc = next;
        continue;
      }
      if (info.flow === "call") {
        if (!info.indirect) {
          const target = (next + info.rel) >>> 0;
          if (target < max) {
            work.push(target);
          }
        }
        pc = next;
        continue;
      }
      pc = next;
    }
  }

  return { sites, warnings };
  }

  KosEmu.core.loader = {
    parseKex,
    unpackKpck: maybeUnpackKpck,
    formatKexInfo,
    scanSyscalls,
    scanSoftOps
  };
})();



(() => {
  const KosEmu = globalThis.KosEmu;
  const { drawText, measureText } = KosEmu.gfx.text;
  const { getTextInfo, getTextInfoFromString, measureKolibriText, drawKolibriText } = KosEmu.gfx.kolibriText;
  const { FALLBACK_COLOR_TABLE, getDefaultSkin, getDefaultSkinBytes, parseSkinBuffer } = KosEmu.gfx.kolibriSkin;
  const { scanSyscalls, scanSoftOps, unpackKpck } = KosEmu.core.loader;
  const { formatBytes, formatHex, align4k, toBcd } = KosEmu.core.utils;
  const { installCoreAccess } = KosEmu.emu;
  const { installEmulatorHost, installEmulatorHostLibRuntime } = KosEmu.emu;
  const { installCoreRuntime } = KosEmu.emu;
  const { installCoreExecute } = KosEmu.emu;
  const { installEmulatorSyscalls } = KosEmu.emu;

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

const FLAG_CF = 0x00000001;
const FLAG_AF = 0x00000010;
const FLAG_PF = 0x00000004;
const FLAG_ZF = 0x00000040;
const FLAG_SF = 0x00000080;
const FLAG_DF = 0x00000400;
const FLAG_OF = 0x00000800;
const ALU_FLAG_MASK = FLAG_CF | FLAG_PF | FLAG_ZF | FLAG_SF | FLAG_OF;

let activeCpuHelperBackend = null;
let jsCpuHelperBackend = null;

function setActiveCpuHelperBackend(backend) {
  activeCpuHelperBackend = backend || null;
}

function getActiveCpuHelperBackend() {
  return activeCpuHelperBackend;
}

function parityEven8Js(value) {
  let v = value & 0xff;
  v ^= v >> 4;
  v &= 0xf;
  return ((0x6996 >> v) & 1) === 0;
}

function parityEven8(value) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.parityEven8 === "function") {
    return !!backend.parityEven8(value >>> 0);
  }
  return parityEven8Js(value);
}

function roundTiesToEvenJs(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const floor = Math.floor(value);
  const frac = value - floor;
  const epsilon = 1e-9 * Math.max(1, Math.abs(value));
  if (frac < 0.5 - epsilon) {
    return floor;
  }
  if (frac > 0.5 + epsilon) {
    return floor + 1;
  }
  return (floor % 2) === 0 ? floor : (floor + 1);
}

function roundTiesToEven(value) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.roundTiesToEven === "function") {
    return Number(backend.roundTiesToEven(Number(value)));
  }
  return roundTiesToEvenJs(value);
}

function x87StoreIntegerValueJs(value, truncate) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return 0;
  }
  return truncate ? Math.trunc(num) : roundTiesToEvenJs(num);
}

function x87StoreIntegerValue(value, truncate) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.x87StoreIntegerValue === "function") {
    return Number(backend.x87StoreIntegerValue(Number(value), !!truncate));
  }
  return x87StoreIntegerValueJs(value, truncate);
}

function x87PackedBcdToNumberJs(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : null;
  if (!source || source.length < 10) {
    return 0;
  }
  let magnitude = 0n;
  let factor = 1n;
  for (let i = 0; i < 9; i += 1) {
    const packed = source[i] & 0xff;
    magnitude += BigInt(packed & 0x0f) * factor;
    factor *= 10n;
    magnitude += BigInt((packed >>> 4) & 0x0f) * factor;
    factor *= 10n;
  }
  const negative = (source[9] & 0x80) !== 0;
  return Number(negative ? -magnitude : magnitude);
}

function x87PackedBcdToNumber(bytes) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.x87PackedBcdToNumber === "function") {
    return Number(backend.x87PackedBcdToNumber(bytes));
  }
  return x87PackedBcdToNumberJs(bytes);
}

function x87NumberToPackedBcdJs(value) {
  const out = new Uint8Array(10);
  const rounded = x87StoreIntegerValueJs(value, false);
  let magnitude = BigInt(Math.abs(rounded));
  for (let i = 0; i < 9; i += 1) {
    const lo = Number(magnitude % 10n) & 0x0f;
    magnitude /= 10n;
    const hi = Number(magnitude % 10n) & 0x0f;
    magnitude /= 10n;
    out[i] = (lo | (hi << 4)) & 0xff;
  }
  if (rounded < 0 || Object.is(rounded, -0)) {
    out[9] = 0x80;
  }
  return out;
}

function x87NumberToPackedBcd(value) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.x87NumberToPackedBcd === "function") {
    return backend.x87NumberToPackedBcd(Number(value));
  }
  return x87NumberToPackedBcdJs(value);
}

function bitScanJs(value, reverse, widthBits) {
  const src = widthValueUnsigned(value >>> 0, widthBits >>> 0);
  if (src === 0) {
    return { zero: true, index: 0 };
  }
  if (reverse) {
    return { zero: false, index: (31 - Math.clz32(src)) >>> 0 };
  }
  const lsb = (src & -src) >>> 0;
  return { zero: false, index: (31 - Math.clz32(lsb)) >>> 0 };
}

function bitScan(value, reverse, widthBits) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.bitScan === "function") {
    return backend.bitScan(value >>> 0, !!reverse, widthBits >>> 0);
  }
  return bitScanJs(value, reverse, widthBits);
}

function bitTestModifyJs(value, bitIndex, widthBits, op, flags) {
  const width = (widthBits >>> 0) === 16 ? 16 : 32;
  const src = widthValueUnsigned(value >>> 0, width);
  const bit = width === 16 ? (bitIndex & 15) : (bitIndex & 31);
  const bitMask = (1 << bit) >>> 0;
  const bitValue = (src & bitMask) !== 0 ? 1 : 0;
  let next = flags >>> 0;
  next = (next & ~FLAG_CF) | (bitValue ? FLAG_CF : 0);
  let result = src >>> 0;
  switch (op & 7) {
    case 4:
      break;
    case 5:
      result = (src | bitMask) >>> 0;
      break;
    case 6:
      result = (src & ~bitMask) >>> 0;
      break;
    case 7:
      result = (src ^ bitMask) >>> 0;
      break;
    default:
      break;
  }
  return { result: widthValueUnsigned(result, width) >>> 0, flags: next >>> 0 };
}

function bitTestModify(value, bitIndex, widthBits, op, flags) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.bitTestModify === "function") {
    return backend.bitTestModify(value >>> 0, bitIndex >>> 0, widthBits >>> 0, op >>> 0, flags >>> 0);
  }
  return bitTestModifyJs(value, bitIndex, widthBits, op, flags);
}

function imulSignedWidthJs(left, right, widthBits, flags) {
  const width = (widthBits >>> 0) === 16 ? 16 : 32;
  const leftValue = width === 16
    ? BigInt.asIntN(16, BigInt(left & 0xffff))
    : BigInt.asIntN(32, BigInt(left >>> 0));
  const rightValue = width === 16
    ? BigInt.asIntN(16, BigInt(right & 0xffff))
    : BigInt.asIntN(32, BigInt(right >>> 0));
  const product = leftValue * rightValue;
  const result = width === 16
    ? (Number(BigInt.asUintN(16, product)) & 0xffff)
    : (Number(BigInt.asUintN(32, product)) >>> 0);
  const fits = width === 16
    ? (product === BigInt.asIntN(16, product))
    : (product === BigInt.asIntN(32, product));
  let next = flags >>> 0;
  next &= ~(FLAG_CF | FLAG_OF);
  if (!fits) {
    next |= FLAG_CF | FLAG_OF;
  }
  return { result: result >>> 0, flags: next >>> 0 };
}

function imulSignedWidth(left, right, widthBits, flags) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.imulSignedWidth === "function") {
    return backend.imulSignedWidth(left >>> 0, right >>> 0, widthBits >>> 0, flags >>> 0);
  }
  return imulSignedWidthJs(left, right, widthBits, flags);
}

function widthMask(widthBits) {
  if (widthBits === 8) {
    return 0xff;
  }
  if (widthBits === 16) {
    return 0xffff;
  }
  return 0xffffffff;
}

function widthSign(widthBits) {
  if (widthBits === 8) {
    return 0x80;
  }
  if (widthBits === 16) {
    return 0x8000;
  }
  return 0x80000000;
}

function widthValueUnsigned(value, widthBits) {
  if (widthBits === 32) {
    return value >>> 0;
  }
  return value & widthMask(widthBits);
}

function buildMenuetPathString(processPath) {
  const raw = String(processPath || "").replace(/\\/g, "/").trim();
  if (!raw) {
    return "";
  }
  const marker = String.fromCharCode(1);
  if (raw.startsWith("/")) {
    return `/${marker}${raw}`;
  }
  return `/${marker}/${raw.replace(/^\/+/, "")}`;
}

function updateLogicFlags(flags, result) {
  let next = flags & ~ALU_FLAG_MASK;
  const res8 = result & 0xff;
  if ((result & 0xffffffff) === 0) {
    next |= FLAG_ZF;
  }
  if (result & 0x80000000) {
    next |= FLAG_SF;
  }
  if (parityEven8(res8)) {
    next |= FLAG_PF;
  }
  return next >>> 0;
}

function updateLogicFlagsWidthJs(flags, result, widthBits) {
  let next = flags & ~ALU_FLAG_MASK;
  const mask = widthMask(widthBits);
  const sign = widthSign(widthBits);
  const res = result & mask;
  if (res === 0) {
    next |= FLAG_ZF;
  }
  if (res & sign) {
    next |= FLAG_SF;
  }
  if (parityEven8(res)) {
    next |= FLAG_PF;
  }
  return next >>> 0;
}

function updateLogicFlagsWidth(flags, result, widthBits) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.updateLogicFlagsWidth === "function") {
    return backend.updateLogicFlagsWidth(flags >>> 0, result >>> 0, widthBits >>> 0) >>> 0;
  }
  return updateLogicFlagsWidthJs(flags, result, widthBits);
}

function updateAddFlagsJs(flags, op1, op2, result, widthBits) {
  const mask = widthBits === 32 ? 0xffffffff : widthMask(widthBits);
  const sign = widthSign(widthBits);
  const a = widthValueUnsigned(op1, widthBits);
  const b = widthValueUnsigned(op2, widthBits);
  const full = a + b;
  const res = widthValueUnsigned(result, widthBits);
  let next = flags & ~(ALU_FLAG_MASK | FLAG_AF);
  if (full > mask) {
    next |= FLAG_CF;
  }
  if (((a ^ b ^ res) & 0x10) !== 0) {
    next |= FLAG_AF;
  }
  if (((~(a ^ b)) & (a ^ res) & sign) !== 0) {
    next |= FLAG_OF;
  }
  if (res === 0) {
    next |= FLAG_ZF;
  }
  if (res & sign) {
    next |= FLAG_SF;
  }
  if (parityEven8(res)) {
    next |= FLAG_PF;
  }
  return next >>> 0;
}

function updateAddFlags(flags, op1, op2, result, widthBits) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.updateAddFlags === "function") {
    return backend.updateAddFlags(flags >>> 0, op1 >>> 0, op2 >>> 0, result >>> 0, widthBits >>> 0) >>> 0;
  }
  return updateAddFlagsJs(flags, op1, op2, result, widthBits);
}

function updateAdcFlagsJs(flags, op1, op2, carry, result, widthBits) {
  const mask = widthBits === 32 ? 0xffffffff : widthMask(widthBits);
  const sign = widthSign(widthBits);
  const a = widthValueUnsigned(op1, widthBits);
  const b = widthValueUnsigned(op2, widthBits);
  const full = a + b + (carry ? 1 : 0);
  const res = widthValueUnsigned(result, widthBits);
  const b2 = (b + (carry ? 1 : 0)) & mask;
  let next = flags & ~(ALU_FLAG_MASK | FLAG_AF);
  if (full > mask) {
    next |= FLAG_CF;
  }
  if (((a ^ b2 ^ res) & 0x10) !== 0) {
    next |= FLAG_AF;
  }
  if (((~(a ^ b2)) & (a ^ res) & sign) !== 0) {
    next |= FLAG_OF;
  }
  if (res === 0) {
    next |= FLAG_ZF;
  }
  if (res & sign) {
    next |= FLAG_SF;
  }
  if (parityEven8(res)) {
    next |= FLAG_PF;
  }
  return next >>> 0;
}

function updateAdcFlags(flags, op1, op2, carry, result, widthBits) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.updateAdcFlags === "function") {
    return backend.updateAdcFlags(flags >>> 0, op1 >>> 0, op2 >>> 0, carry >>> 0, result >>> 0, widthBits >>> 0) >>> 0;
  }
  return updateAdcFlagsJs(flags, op1, op2, carry, result, widthBits);
}

function updateSbbFlagsJs(flags, op1, op2, carry, result, widthBits) {
  const mask = widthBits === 32 ? 0xffffffff : widthMask(widthBits);
  const sign = widthSign(widthBits);
  const a = widthValueUnsigned(op1, widthBits);
  const b = widthValueUnsigned(op2, widthBits);
  const sub = (b + (carry ? 1 : 0)) >>> 0;
  const res = widthValueUnsigned(result, widthBits);
  let next = flags & ~(ALU_FLAG_MASK | FLAG_AF);
  if (a >>> 0 < sub >>> 0) {
    next |= FLAG_CF;
  }
  if (((a ^ sub ^ res) & 0x10) !== 0) {
    next |= FLAG_AF;
  }
  if (((a ^ sub) & (a ^ res) & sign) !== 0) {
    next |= FLAG_OF;
  }
  if (res === 0) {
    next |= FLAG_ZF;
  }
  if (res & sign) {
    next |= FLAG_SF;
  }
  if (parityEven8(res)) {
    next |= FLAG_PF;
  }
  return next >>> 0;
}

function updateSbbFlags(flags, op1, op2, carry, result, widthBits) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.updateSbbFlags === "function") {
    return backend.updateSbbFlags(flags >>> 0, op1 >>> 0, op2 >>> 0, carry >>> 0, result >>> 0, widthBits >>> 0) >>> 0;
  }
  return updateSbbFlagsJs(flags, op1, op2, carry, result, widthBits);
}

function updateSubFlagsJs(flags, op1, op2, result, widthBits) {
  const mask = widthBits === 32 ? 0xffffffff : widthMask(widthBits);
  const sign = widthSign(widthBits);
  const a = widthValueUnsigned(op1, widthBits);
  const b = widthValueUnsigned(op2, widthBits);
  const res = widthValueUnsigned(result, widthBits);
  let next = flags & ~(ALU_FLAG_MASK | FLAG_AF);
  if (b > a) {
    next |= FLAG_CF;
  }
  if (((a ^ b ^ res) & 0x10) !== 0) {
    next |= FLAG_AF;
  }
  if (((a ^ b) & (a ^ res) & sign) !== 0) {
    next |= FLAG_OF;
  }
  if (res === 0) {
    next |= FLAG_ZF;
  }
  if (res & sign) {
    next |= FLAG_SF;
  }
  if (parityEven8(res)) {
    next |= FLAG_PF;
  }
  return next >>> 0;
}

function updateSubFlags(flags, op1, op2, result, widthBits) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.updateSubFlags === "function") {
    return backend.updateSubFlags(flags >>> 0, op1 >>> 0, op2 >>> 0, result >>> 0, widthBits >>> 0) >>> 0;
  }
  return updateSubFlagsJs(flags, op1, op2, result, widthBits);
}

function shiftRotateJs(value, count, widthBits, mode, flags) {
  const mask = widthMask(widthBits);
  const signBit = widthSign(widthBits);
  let v = value & mask;
  let c = count & 0x1f;
  if (c === 0) {
    return { ok: true, result: v >>> 0, flags: flags >>> 0 };
  }

  let result = v >>> 0;
  let cf = (flags & FLAG_CF) ? 1 : 0;
  let next = flags >>> 0;

  switch (mode & 7) {
    case 0: { // ROL
      c %= widthBits;
      if (c === 0) {
        return { ok: true, result: v >>> 0, flags: flags >>> 0 };
      }
      result = ((v << c) | (v >>> (widthBits - c))) & mask;
      cf = result & 1;
      next = (flags & ~(FLAG_CF | FLAG_OF)) >>> 0;
      if (cf) {
        next |= FLAG_CF;
      }
      if (c === 1) {
        const of = (((result & signBit) !== 0) ^ (cf !== 0)) ? 1 : 0;
        if (of) {
          next |= FLAG_OF;
        }
      }
      return { ok: true, result: result >>> 0, flags: next >>> 0 };
    }
    case 1: { // ROR
      c %= widthBits;
      if (c === 0) {
        return { ok: true, result: v >>> 0, flags: flags >>> 0 };
      }
      result = ((v >>> c) | (v << (widthBits - c))) & mask;
      cf = (result & signBit) ? 1 : 0;
      next = (flags & ~(FLAG_CF | FLAG_OF)) >>> 0;
      if (cf) {
        next |= FLAG_CF;
      }
      if (c === 1) {
        const msb = (result & signBit) ? 1 : 0;
        const nextMsb = (result >>> (widthBits - 2)) & 1;
        if ((msb ^ nextMsb) !== 0) {
          next |= FLAG_OF;
        }
      }
      return { ok: true, result: result >>> 0, flags: next >>> 0 };
    }
    case 2: { // RCL
      const mod = widthBits + 1;
      c %= mod;
      if (c === 0) {
        return { ok: true, result: v >>> 0, flags: flags >>> 0 };
      }
      result = v;
      for (let i = 0; i < c; i += 1) {
        const newCf = (result & signBit) ? 1 : 0;
        result = ((result << 1) & mask) | (cf ? 1 : 0);
        cf = newCf;
      }
      next = (flags & ~(FLAG_CF | FLAG_OF)) >>> 0;
      if (cf) {
        next |= FLAG_CF;
      }
      if (c === 1) {
        const msb = (result & signBit) ? 1 : 0;
        if ((msb ^ cf) !== 0) {
          next |= FLAG_OF;
        }
      }
      return { ok: true, result: result >>> 0, flags: next >>> 0 };
    }
    case 3: { // RCR
      const mod = widthBits + 1;
      c %= mod;
      if (c === 0) {
        return { ok: true, result: v >>> 0, flags: flags >>> 0 };
      }
      result = v;
      for (let i = 0; i < c; i += 1) {
        const newCf = result & 1;
        result = (result >>> 1) | (cf ? signBit : 0);
        cf = newCf;
      }
      next = (flags & ~(FLAG_CF | FLAG_OF)) >>> 0;
      if (cf) {
        next |= FLAG_CF;
      }
      if (c === 1) {
        const msb = (result & signBit) ? 1 : 0;
        const nextMsb = (result >>> (widthBits - 2)) & 1;
        if ((msb ^ nextMsb) !== 0) {
          next |= FLAG_OF;
        }
      }
      return { ok: true, result: result >>> 0, flags: next >>> 0 };
    }
    case 4: { // SHL/SAL
      if (c >= widthBits) {
        result = 0;
        cf = 0;
      } else {
        cf = (v >>> (widthBits - c)) & 1;
        result = (v << c) & mask;
      }
      next = (flags & ~ALU_FLAG_MASK) >>> 0;
      if (cf) {
        next |= FLAG_CF;
      }
      if (c === 1) {
        const msb = (result & signBit) ? 1 : 0;
        if ((msb ^ cf) !== 0) {
          next |= FLAG_OF;
        }
      }
      if (result === 0) {
        next |= FLAG_ZF;
      }
      if (result & signBit) {
        next |= FLAG_SF;
      }
      if (parityEven8(result)) {
        next |= FLAG_PF;
      }
      return { ok: true, result: result >>> 0, flags: next >>> 0 };
    }
    case 5: { // SHR
      if (c >= widthBits) {
        result = 0;
        cf = (v >>> (widthBits - 1)) & 1;
      } else {
        cf = (v >>> (c - 1)) & 1;
        result = v >>> c;
      }
      next = (flags & ~ALU_FLAG_MASK) >>> 0;
      if (cf) {
        next |= FLAG_CF;
      }
      if (c === 1) {
        if ((v & signBit) !== 0) {
          next |= FLAG_OF;
        }
      }
      if (result === 0) {
        next |= FLAG_ZF;
      }
      if (result & signBit) {
        next |= FLAG_SF;
      }
      if (parityEven8(result)) {
        next |= FLAG_PF;
      }
      return { ok: true, result: result >>> 0, flags: next >>> 0 };
    }
    case 7: { // SAR
      if (c >= widthBits) {
        result = (v & signBit) ? mask : 0;
        cf = (v & signBit) ? 1 : 0;
      } else {
        cf = (v >>> (c - 1)) & 1;
        result = (v >> c) & mask;
      }
      next = (flags & ~ALU_FLAG_MASK) >>> 0;
      if (cf) {
        next |= FLAG_CF;
      }
      if (c === 1) {
        // OF cleared for SAR
      }
      if (result === 0) {
        next |= FLAG_ZF;
      }
      if (result & signBit) {
        next |= FLAG_SF;
      }
      if (parityEven8(result)) {
        next |= FLAG_PF;
      }
      return { ok: true, result: result >>> 0, flags: next >>> 0 };
    }
    default:
      return { ok: false, result: v >>> 0, flags: flags >>> 0 };
  }
}

function shiftRotate(value, count, widthBits, mode, flags) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.shiftRotate === "function") {
    return backend.shiftRotate(value >>> 0, count >>> 0, widthBits >>> 0, mode >>> 0, flags >>> 0);
  }
  return shiftRotateJs(value, count, widthBits, mode, flags);
}

function doubleShiftJs(value, source, count, widthBits, leftShift, flags) {
  const mask = widthMask(widthBits);
  const signBit = widthSign(widthBits);
  let c = count & 0x1f;
  const dst = value & mask;
  const src = source & mask;
  if (c === 0) {
    return { ok: true, result: dst >>> 0, flags: flags >>> 0 };
  }
  if (c > widthBits) {
    c = widthBits;
  }

  let result = dst >>> 0;
  let cf = 0;
  if (leftShift) {
    if (c === widthBits) {
      result = src >>> 0;
      cf = dst & 1;
    } else {
      result = ((dst << c) | (src >>> (widthBits - c))) & mask;
      cf = (dst >>> (widthBits - c)) & 1;
    }
  } else {
    if (c === widthBits) {
      result = src >>> 0;
      cf = (dst >>> (widthBits - 1)) & 1;
    } else {
      result = ((dst >>> c) | ((src << (widthBits - c)) & mask)) & mask;
      cf = (dst >>> (c - 1)) & 1;
    }
  }

  let next = flags & ~(FLAG_CF | FLAG_OF | FLAG_SF | FLAG_ZF | FLAG_PF);
  if (cf) {
    next |= FLAG_CF;
  }
  if ((result & mask) === 0) {
    next |= FLAG_ZF;
  }
  if (result & signBit) {
    next |= FLAG_SF;
  }
  if (parityEven8(result)) {
    next |= FLAG_PF;
  }
  if (c === 1) {
    if (leftShift) {
      const msb = (result & signBit) !== 0;
      if (msb !== (cf !== 0)) {
        next |= FLAG_OF;
      }
    } else {
      const beforeMsb = (dst & signBit) !== 0;
      const afterMsb = (result & signBit) !== 0;
      if (beforeMsb !== afterMsb) {
        next |= FLAG_OF;
      }
    }
  }
  return { ok: true, result: (result & mask) >>> 0, flags: next >>> 0 };
}

function doubleShift(value, source, count, widthBits, leftShift, flags) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.doubleShift === "function") {
    return backend.doubleShift(value >>> 0, source >>> 0, count >>> 0, widthBits >>> 0, !!leftShift, flags >>> 0);
  }
  return doubleShiftJs(value, source, count, widthBits, leftShift, flags);
}

function getJsCpuHelperBackend() {
  if (!jsCpuHelperBackend) {
    jsCpuHelperBackend = {
      kind: "js",
      parityEven8(value) {
        return parityEven8Js(value);
      },
      roundTiesToEven(value) {
        return roundTiesToEvenJs(value);
      },
      x87StoreIntegerValue(value, truncate) {
        return x87StoreIntegerValueJs(value, truncate);
      },
      x87PackedBcdToNumber(bytes) {
        return x87PackedBcdToNumberJs(bytes);
      },
      x87NumberToPackedBcd(value) {
        return x87NumberToPackedBcdJs(value);
      },
      bitScan(value, reverse, widthBits) {
        return bitScanJs(value, reverse, widthBits);
      },
      bitTestModify(value, bitIndex, widthBits, op, flags) {
        return bitTestModifyJs(value, bitIndex, widthBits, op, flags);
      },
      imulSignedWidth(left, right, widthBits, flags) {
        return imulSignedWidthJs(left, right, widthBits, flags);
      },
      updateLogicFlagsWidth(flags, result, widthBits) {
        return updateLogicFlagsWidthJs(flags, result, widthBits);
      },
      updateAddFlags(flags, op1, op2, result, widthBits) {
        return updateAddFlagsJs(flags, op1, op2, result, widthBits);
      },
      updateAdcFlags(flags, op1, op2, carry, result, widthBits) {
        return updateAdcFlagsJs(flags, op1, op2, carry, result, widthBits);
      },
      updateSubFlags(flags, op1, op2, result, widthBits) {
        return updateSubFlagsJs(flags, op1, op2, result, widthBits);
      },
      updateSbbFlags(flags, op1, op2, carry, result, widthBits) {
        return updateSbbFlagsJs(flags, op1, op2, carry, result, widthBits);
      },
      shiftRotate(value, count, widthBits, mode, flags) {
        return shiftRotateJs(value, count, widthBits, mode, flags);
      },
      doubleShift(value, source, count, widthBits, leftShift, flags) {
        return doubleShiftJs(value, source, count, widthBits, leftShift, flags);
      },
      psubusb32(a, b) {
        return psubusb32(a, b);
      },
      psubusw32(a, b) {
        return psubusw32(a, b);
      },
      pavgb32(a, b) {
        return pavgb32(a, b);
      },
      paddw32(a, b) {
        return paddw32(a, b);
      },
      psubsw32(a, b) {
        return psubsw32(a, b);
      },
      pmullw32(a, b) {
        return pmullw32(a, b);
      },
      psrlw32(a, count) {
        return psrlw32(a, count);
      },
      psraw32(a, count) {
        return psraw32(a, count);
      },
      psllw32(a, count) {
        return psllw32(a, count);
      },
      psrld32(a, count) {
        return psrld32(a, count);
      },
      psrad32(a, count) {
        return psrad32(a, count);
      },
      pslld32(a, count) {
        return pslld32(a, count);
      },
      packsswb64(dstLo, dstHi, srcLo, srcHi) {
        return packsswb64(dstLo, dstHi, srcLo, srcHi);
      },
      packuswb64(dstLo, dstHi, srcLo, srcHi) {
        return packuswb64(dstLo, dstHi, srcLo, srcHi);
      },
      packssdw64(dstLo, dstHi, srcLo, srcHi) {
        return packssdw64(dstLo, dstHi, srcLo, srcHi);
      },
      punpcklbw64(dstLo, srcLo) {
        return punpcklbw64(dstLo, srcLo);
      },
      punpckhbw64(dstHi, srcHi) {
        return punpckhbw64(dstHi, srcHi);
      },
      punpcklwd64(dstLo, srcLo) {
        return punpcklwd64(dstLo, srcLo);
      },
      punpckhwd64(dstHi, srcHi) {
        return punpckhwd64(dstHi, srcHi);
      },
      evalJccCondition(cc, flags) {
        return evalJccConditionJs(cc, flags);
      }
    };
  }
  return jsCpuHelperBackend;
}

function psubusb32(a, b) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.psubusb32 === "function") {
    return backend.psubusb32(a >>> 0, b >>> 0) >>> 0;
  }
  let out = 0;
  for (let i = 0; i < 4; i += 1) {
    const shift = i * 8;
    const av = (a >>> shift) & 0xff;
    const bv = (b >>> shift) & 0xff;
    const dv = av - bv;
    out |= (dv < 0 ? 0 : dv) << shift;
  }
  return out >>> 0;
}

function psubusw32(a, b) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.psubusw32 === "function") {
    return backend.psubusw32(a >>> 0, b >>> 0) >>> 0;
  }
  let out = 0;
  for (let i = 0; i < 2; i += 1) {
    const shift = i * 16;
    const av = (a >>> shift) & 0xffff;
    const bv = (b >>> shift) & 0xffff;
    const dv = av - bv;
    out |= (dv < 0 ? 0 : dv) << shift;
  }
  return out >>> 0;
}

function pavgb32(a, b) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.pavgb32 === "function") {
    return backend.pavgb32(a >>> 0, b >>> 0) >>> 0;
  }
  let out = 0;
  for (let i = 0; i < 4; i += 1) {
    const shift = i * 8;
    const av = (a >>> shift) & 0xff;
    const bv = (b >>> shift) & 0xff;
    const avg = (av + bv + 1) >>> 1;
    out |= avg << shift;
  }
  return out >>> 0;
}

function paddw32(a, b) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.paddw32 === "function") {
    return backend.paddw32(a >>> 0, b >>> 0) >>> 0;
  }
  let out = 0;
  for (let i = 0; i < 2; i += 1) {
    const shift = i * 16;
    const av = (a >>> shift) & 0xffff;
    const bv = (b >>> shift) & 0xffff;
    out |= ((av + bv) & 0xffff) << shift;
  }
  return out >>> 0;
}

function psubsw32(a, b) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.psubsw32 === "function") {
    return backend.psubsw32(a >>> 0, b >>> 0) >>> 0;
  }
  let out = 0;
  for (let i = 0; i < 2; i += 1) {
    const shift = i * 16;
    const av = ((a >>> shift) << 16) >> 16;
    const bv = ((b >>> shift) << 16) >> 16;
    let result = av - bv;
    if (result > 0x7fff) {
      result = 0x7fff;
    } else if (result < -0x8000) {
      result = -0x8000;
    }
    out |= (result & 0xffff) << shift;
  }
  return out >>> 0;
}

function pmullw32(a, b) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.pmullw32 === "function") {
    return backend.pmullw32(a >>> 0, b >>> 0) >>> 0;
  }
  let out = 0;
  for (let i = 0; i < 2; i += 1) {
    const shift = i * 16;
    const av = ((a >>> shift) << 16) >> 16;
    const bv = ((b >>> shift) << 16) >> 16;
    out |= ((Math.imul(av, bv)) & 0xffff) << shift;
  }
  return out >>> 0;
}

function psrlw32(a, count) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.psrlw32 === "function") {
    return backend.psrlw32(a >>> 0, count >>> 0) >>> 0;
  }
  const shift = count >= 16 ? 16 : (count & 0xff);
  let out = 0;
  for (let i = 0; i < 2; i += 1) {
    const laneShift = i * 16;
    const value = (a >>> laneShift) & 0xffff;
    const result = shift >= 16 ? 0 : (value >>> shift);
    out |= (result & 0xffff) << laneShift;
  }
  return out >>> 0;
}

function psraw32(a, count) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.psraw32 === "function") {
    return backend.psraw32(a >>> 0, count >>> 0) >>> 0;
  }
  const shift = count >= 16 ? 16 : (count & 0xff);
  let out = 0;
  for (let i = 0; i < 2; i += 1) {
    const laneShift = i * 16;
    const value = ((a >>> laneShift) << 16) >> 16;
    let result = shift >= 16 ? (value < 0 ? -1 : 0) : (value >> shift);
    out |= (result & 0xffff) << laneShift;
  }
  return out >>> 0;
}

function psllw32(a, count) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.psllw32 === "function") {
    return backend.psllw32(a >>> 0, count >>> 0) >>> 0;
  }
  const shift = count >= 16 ? 16 : (count & 0xff);
  let out = 0;
  for (let i = 0; i < 2; i += 1) {
    const laneShift = i * 16;
    const value = (a >>> laneShift) & 0xffff;
    const result = shift >= 16 ? 0 : ((value << shift) & 0xffff);
    out |= result << laneShift;
  }
  return out >>> 0;
}

function psrld32(a, count) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.psrld32 === "function") {
    return backend.psrld32(a >>> 0, count >>> 0) >>> 0;
  }
  const shift = count >= 32 ? 32 : (count & 0xff);
  return shift >= 32 ? 0 : (a >>> shift);
}

function psrad32(a, count) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.psrad32 === "function") {
    return backend.psrad32(a >>> 0, count >>> 0) >>> 0;
  }
  const shift = count >= 32 ? 32 : (count & 0xff);
  const value = a | 0;
  return shift >= 32 ? (value < 0 ? 0xffffffff : 0) : (value >> shift) >>> 0;
}

function pslld32(a, count) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.pslld32 === "function") {
    return backend.pslld32(a >>> 0, count >>> 0) >>> 0;
  }
  const shift = count >= 32 ? 32 : (count & 0xff);
  return shift >= 32 ? 0 : ((a << shift) >>> 0);
}

function clampSigned8From16(value) {
  let v = ((value & 0xffff) << 16) >> 16;
  if (v > 0x7f) {
    v = 0x7f;
  } else if (v < -0x80) {
    v = -0x80;
  }
  return v & 0xff;
}

function clampUnsigned8From16(value) {
  let v = ((value & 0xffff) << 16) >> 16;
  if (v < 0) {
    v = 0;
  } else if (v > 0xff) {
    v = 0xff;
  }
  return v & 0xff;
}

function clampSigned16From32(value) {
  let v = value | 0;
  if (v > 0x7fff) {
    v = 0x7fff;
  } else if (v < -0x8000) {
    v = -0x8000;
  }
  return v & 0xffff;
}

function packsswb64(dstLo, dstHi, srcLo, srcHi) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.packsswb64 === "function") {
    return backend.packsswb64(dstLo >>> 0, dstHi >>> 0, srcLo >>> 0, srcHi >>> 0);
  }
  const out = new Uint8Array(8);
  out[0] = clampSigned8From16(dstLo & 0xffff);
  out[1] = clampSigned8From16((dstLo >>> 16) & 0xffff);
  out[2] = clampSigned8From16(dstHi & 0xffff);
  out[3] = clampSigned8From16((dstHi >>> 16) & 0xffff);
  out[4] = clampSigned8From16(srcLo & 0xffff);
  out[5] = clampSigned8From16((srcLo >>> 16) & 0xffff);
  out[6] = clampSigned8From16(srcHi & 0xffff);
  out[7] = clampSigned8From16((srcHi >>> 16) & 0xffff);
  return {
    lo: (out[0] | (out[1] << 8) | (out[2] << 16) | (out[3] << 24)) >>> 0,
    hi: (out[4] | (out[5] << 8) | (out[6] << 16) | (out[7] << 24)) >>> 0
  };
}

function packuswb64(dstLo, dstHi, srcLo, srcHi) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.packuswb64 === "function") {
    return backend.packuswb64(dstLo >>> 0, dstHi >>> 0, srcLo >>> 0, srcHi >>> 0);
  }
  const out = new Uint8Array(8);
  out[0] = clampUnsigned8From16(dstLo & 0xffff);
  out[1] = clampUnsigned8From16((dstLo >>> 16) & 0xffff);
  out[2] = clampUnsigned8From16(dstHi & 0xffff);
  out[3] = clampUnsigned8From16((dstHi >>> 16) & 0xffff);
  out[4] = clampUnsigned8From16(srcLo & 0xffff);
  out[5] = clampUnsigned8From16((srcLo >>> 16) & 0xffff);
  out[6] = clampUnsigned8From16(srcHi & 0xffff);
  out[7] = clampUnsigned8From16((srcHi >>> 16) & 0xffff);
  return {
    lo: (out[0] | (out[1] << 8) | (out[2] << 16) | (out[3] << 24)) >>> 0,
    hi: (out[4] | (out[5] << 8) | (out[6] << 16) | (out[7] << 24)) >>> 0
  };
}

function packssdw64(dstLo, dstHi, srcLo, srcHi) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.packssdw64 === "function") {
    return backend.packssdw64(dstLo >>> 0, dstHi >>> 0, srcLo >>> 0, srcHi >>> 0);
  }
  return {
    lo: (clampSigned16From32(dstLo) | (clampSigned16From32(dstHi) << 16)) >>> 0,
    hi: (clampSigned16From32(srcLo) | (clampSigned16From32(srcHi) << 16)) >>> 0
  };
}

function punpcklbw64(dstLo, srcLo) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.punpcklbw64 === "function") {
    return backend.punpcklbw64(dstLo >>> 0, srcLo >>> 0);
  }
  let outLo = 0;
  let outHi = 0;
  for (let i = 0; i < 4; i += 1) {
    const dstByte = (dstLo >>> (i * 8)) & 0xff;
    const srcByte = (srcLo >>> (i * 8)) & 0xff;
    const shift = (i & 1) * 16;
    if (i < 2) {
      outLo |= dstByte << shift;
      outLo |= srcByte << (shift + 8);
    } else {
      outHi |= dstByte << shift;
      outHi |= srcByte << (shift + 8);
    }
  }
  return { lo: outLo >>> 0, hi: outHi >>> 0 };
}

function punpckhbw64(dstHi, srcHi) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.punpckhbw64 === "function") {
    return backend.punpckhbw64(dstHi >>> 0, srcHi >>> 0);
  }
  let outLo = 0;
  let outHi = 0;
  for (let i = 0; i < 4; i += 1) {
    const dstByte = (dstHi >>> (i * 8)) & 0xff;
    const srcByte = (srcHi >>> (i * 8)) & 0xff;
    const shift = (i & 1) * 16;
    if (i < 2) {
      outLo |= dstByte << shift;
      outLo |= srcByte << (shift + 8);
    } else {
      outHi |= dstByte << shift;
      outHi |= srcByte << (shift + 8);
    }
  }
  return { lo: outLo >>> 0, hi: outHi >>> 0 };
}

function punpcklwd64(dstLo, srcLo) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.punpcklwd64 === "function") {
    return backend.punpcklwd64(dstLo >>> 0, srcLo >>> 0);
  }
  const d0 = dstLo & 0xffff;
  const d1 = (dstLo >>> 16) & 0xffff;
  const s0 = srcLo & 0xffff;
  const s1 = (srcLo >>> 16) & 0xffff;
  return {
    lo: ((d0 & 0xffff) | ((s0 & 0xffff) << 16)) >>> 0,
    hi: ((d1 & 0xffff) | ((s1 & 0xffff) << 16)) >>> 0
  };
}

function punpckhwd64(dstHi, srcHi) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.punpckhwd64 === "function") {
    return backend.punpckhwd64(dstHi >>> 0, srcHi >>> 0);
  }
  const d0 = dstHi & 0xffff;
  const d1 = (dstHi >>> 16) & 0xffff;
  const s0 = srcHi & 0xffff;
  const s1 = (srcHi >>> 16) & 0xffff;
  return {
    lo: ((d0 & 0xffff) | ((s0 & 0xffff) << 16)) >>> 0,
    hi: ((d1 & 0xffff) | ((s1 & 0xffff) << 16)) >>> 0
  };
}

function matchBytes(mem, start, pattern) {
  for (let i = 0; i < pattern.length; i += 1) {
    if (mem[start + i] !== pattern[i]) {
      return false;
    }
  }
  return true;
}

const FAST_LOOP_SHADE = new Uint8Array([
  0x0f, 0x6f, 0x07, 0x0f, 0xd8, 0xc1, 0x0f, 0x7f, 0x07, 0x83, 0xc7, 0x08
]);
const FAST_LOOP_MAX = 500000;
const FAST_LOOP_BLUR = new Uint8Array([
  0x0f, 0x6f, 0x07, 0x0f, 0x6f, 0x4f, 0x01, 0x0f, 0x6f, 0x57, 0xff,
  0x0f, 0x6f, 0xd8, 0xf7, 0xd8, 0x0f, 0x6f, 0x24, 0x07, 0xf7, 0xd8,
  0x0f, 0x6f, 0x2c, 0x07, 0x0f, 0xe0, 0xc1, 0x0f, 0xe0, 0xda, 0x0f,
  0xe0, 0xe5, 0x0f, 0xe0, 0xdc, 0x0f, 0xe0, 0xc3, 0x0f, 0x7f, 0x07,
  0x83, 0xc7, 0x08
]);
const FAST_LOOP_BLUR_RIGHT = new Uint8Array([
  0x0f, 0x6f, 0x07, 0x0f, 0x6f, 0x4f, 0x01, 0x0f, 0x6f, 0x14, 0x07,
  0x0f, 0x6f, 0x5c, 0x07, 0x01, 0x0f, 0xe0, 0xc1, 0x0f, 0xe0, 0xda,
  0x0f, 0xe0, 0xc3, 0x0f, 0x7f, 0x07, 0x83, 0xc7, 0x08
]);

function evalJccConditionJs(cc, flags) {
  const of = (flags & FLAG_OF) !== 0;
  const cf = (flags & FLAG_CF) !== 0;
  const zf = (flags & FLAG_ZF) !== 0;
  const sf = (flags & FLAG_SF) !== 0;
  const pf = (flags & FLAG_PF) !== 0;
  switch (cc & 0xf) {
    case 0x0: return of;
    case 0x1: return !of;
    case 0x2: return cf;
    case 0x3: return !cf;
    case 0x4: return zf;
    case 0x5: return !zf;
    case 0x6: return cf || zf;
    case 0x7: return !cf && !zf;
    case 0x8: return sf;
    case 0x9: return !sf;
    case 0xA: return pf;
    case 0xB: return !pf;
    case 0xC: return sf !== of;
    case 0xD: return sf === of;
    case 0xE: return zf || (sf !== of);
    case 0xF: return !zf && (sf === of);
    default: return false;
  }
}

function evalJccCondition(cc, flags) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.evalJccCondition === "function") {
    return !!backend.evalJccCondition(cc >>> 0, flags >>> 0);
  }
  return evalJccConditionJs(cc, flags);
}

function normalizeCpuBackendMode(mode) {
  return String(mode || "").trim().toLowerCase() === "wasm" ? "wasm" : "js";
}

function getCpuBackendAvailability() {
  const emu = KosEmu && KosEmu.emu ? KosEmu.emu : null;
  return {
    js: true,
    wasm: !!(emu && typeof emu.createWasmCpuBackend === "function")
  };
}


class Emulator {
  constructor(surface, log, options) {
    const opts = options || {};
    this.surface = surface;
    this.log = log;
    this.requestedCpuBackend = normalizeCpuBackendMode(opts.cpuBackend);
    this.cpuBackend = this.requestedCpuBackend;
    this.cpuHelperBackend = null;
    this.image = null;
    this.imageData = null;
    this.imageDataRaw = null;
    this.syscallSiteSet = new Set();
    this.softInstructions = true;
    this.softInstructionSites = new Map();
    this.traceSyscalls = false;
    this.traceOpcodes = false;
    this.traceImages = false;
    this.traceFaultBytes = false;
    this.opcodeCounts = new Map();
    this.traceRegs = false;
    this.strictMem = false;
    this.memLimit = 0;
    this.memGrowMax = 64 * 1024 * 1024;
    this.minMemSize = 16 * 1024 * 1024;
    this.running = false;
    this.timer = null;
    this.timerKind = "";
    this.immediatePort = null;
    this.immediatePending = false;
    const isNodeLike =
      typeof process !== "undefined" &&
      process &&
      process.versions &&
      process.versions.node;
    const isWorkerContext =
      typeof WorkerGlobalScope !== "undefined" &&
      typeof self !== "undefined" &&
      self instanceof WorkerGlobalScope;
    this.useImmediateScheduler =
      typeof MessageChannel !== "undefined" &&
      !isNodeLike;
    this.yieldRequested = false;
    this.yieldDelay = 0;
    this.yieldMode = "";
    this.presentYieldPending = false;
    this.repeatCurrentInstruction = false;
    this.waitEventDeadlineAt = 0;
    this.maxInstructions = isWorkerContext ? 1000000 : 800000;
    this.backgroundMaxInstructions = isWorkerContext ? 8000000 : 6000000;
    const isBrowserMainThread = !isNodeLike && !isWorkerContext;
    this.maxSliceMs = isBrowserMainThread ? 8 : 0;
    this.backgroundMaxSliceMs = isBrowserMainThread ? 12 : 0;
    this.sliceDeadlineAt = 0;
    this.sliceTimeCheckInterval = 2048;
    this.sliceTimeCheckCounter = 2048;
    this.lastEip = 0;
    this.lastSyscall = null;
    this.unknownSyscalls = new Set();
    this.cpu = null;
    this.eventQueue = [];
    this.eventMask = 0x7;
    this.lastTimerEventAt = 0;
    this.tscBase = 0;
    this.heapEnabled = false;
    this.heapBase = 0;
    this.heapSize = 0;
    this.heapTop = 0;
    this.heapLowBase = 0;
    this.heapLowSize = 0;
    this.heapLowTop = 0;
    this.heapHighBase = 0;
    this.heapHighSize = 0;
    this.heapHighTop = 0;
    this.stackBase = 0;
    this.heapAllocs = new Map();
    this.heapFreeBlocks = [];
    this.unknownPorts = new Set();
    this.lastImageHash = null;
    this.lastPaletteHash = null;
    this.imageDrawCount = 0;
    this.inRedraw = false;
    this.lastPresentAt = 0;
    this.surfaceDirty = false;
    this.surfaceDirty = false;
    this.lastTimeBcd = null;
    this.onUnknownOpcode = null;
    this.autoFitWindow = false;
    this.onWindowResize = null;
    this.onWindowGeometry = null;
    this.onWindowShape = null;
    this.onStopped = null;
    this.windowOriginX = 0;
    this.windowOriginY = 0;
    this.windowHostX = 0;
    this.windowHostY = 0;
    this.windowDefined = false;
    this.windowStyle = 0;
    this.windowHasCaption = false;
    this.windowTitle = "";
    this.windowClientOffsetX = 0;
    this.windowClientOffsetY = 0;
    this.windowShapePtr = 0;
    this.windowShapeScale = 0;
    this.windowShape = null;
    this.skinHeight = 18;
    this.skin = null;
    this.skinPath = "/sys/default.skn";
    this.skinReady = false;
    this.skinColorTableBytes = null;
    this.skinMarginLeft = 0;
    this.skinMarginRight = 0;
    this.skinMarginTop = 0;
    this.skinMarginBottom = 0;
    this.buttonStyle = 1;
    this.fontSmoothingMode = 1;
    this.fontSizePx = 9;
    this.speakerDisabled = false;
    this.lowLevelHdAccessEnabled = false;
    this.lowLevelPciAccessEnabled = false;
    this.buttons = [];
    this.nextButtonSerial = 1;
    this.activeButtonSerial = 0;
    this.pendingButtonResult = 1;
    this.windowWidth = 0;
    this.windowHeight = 0;
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseScreenX = 0;
    this.mouseScreenY = 0;
    this.mouseButtons = 0;
    this.mouseEventFlags = 0;
    this.mouseScrollX = 0;
    this.mouseScrollY = 0;
    this.mouseInside = false;
    this.mouseEventBuffer = [];
    this.mouseSpeedDivider = 4;
    this.mouseSensitivity = 3;
    this.mouseDoubleClickDelay = 50;
    this.keyboardMode = 0;
    this.controlKeyState = 0;
    this.keyBuffer = [];
    this.lastDrawRectHeight = 0;
    this.cpuBusySamples = [];
    this.cpuBusySampleTotalMs = 0;
    this.cpuBusyActiveStartMs = 0;
    this.decodeCache = new Map();
    this.decodeCacheMax = 50000;
    this.decodeCacheHits = 0;
    this.decodeCacheMisses = 0;
    this.fastLoopCache = new Map();
    this.fastLoopHits = 0;
    this.fastLoopMisses = 0;
    this.basicBlockCache = new Map();
    this.basicBlockPageMap = new Map();
    this.basicBlockHotCounts = new Map();
    this.basicBlockMaxEntries = 32;
    this.basicBlockCacheMax = 10000;
    this.basicBlockImmediateCacheEntries = 4;
    this.basicBlockHotThreshold = 3;
    this.basicBlockHotCountMax = 50000;
    this.basicBlockHits = 0;
    this.basicBlockMisses = 0;
    this.basicBlockBuilds = 0;
    this.basicBlockWarmups = 0;
    this.basicBlockPromotions = 0;
    this.fileProvider = null;
    this.fileInfoProvider = null;
    this.fileMutationProvider = null;
    this.currentFolder = "/sys";
    this.additionalSystemDirs = new Map();
    this.portReservations = new Map();
    this.ipcBufferPtr = 0;
    this.ipcBufferSize = 0;
    this.hostCallStubs = new Map();
    this.loadedHostLibraries = new Map();
    this.loadedDllLibraries = new Map();
    this.hostLibimgImages = new Map();
    this.loadedDrivers = new Map();
    this.nextDriverHandle = 1;
    this.namedMemoryAreas = new Map();
    this.futexState = {
      nextHandle: 1,
      handles: new Map()
    };
    this.sharedNamedMemoryStore = null;
    this.threadLaunchSpec = null;
    this.hostSession = null;
    this.threadSlot = 1;
    this.processId = 0;
    this.processPathOverride = "";
    this.processArgs = "";
    this.threadPriority = 0;
    this.desktopBackgroundMapPtr = 0;
    this.desktopBackgroundMapSize = 0;
    this.debugLine = "";
    this.processReservedSize = 0;
    this.addrSizeOverride = 32;
    this.segCS = 0;
    this.segDS = 0;
    this.segES = 0;
    this.segSS = 0;
    this.segFS = 0;
    this.segGS = 0;
    this.segOverride = 0;
    this.lastStopReason = "";
    this.stopEventEmitted = false;
    this.resetSkinTheme();
  }

  setCpuBackend(mode) {
    if (this.running || this.cpu) {
      throw new Error("Cannot change CPU backend while the emulator is running.");
    }
    const next = normalizeCpuBackendMode(mode);
    this.requestedCpuBackend = next;
    this.cpuBackend = next;
    this.cpuHelperBackend = null;
    return next;
  }

  getCpuBackendInfo() {
    const availability = Emulator.getCpuBackendAvailability();
    return {
      requested: this.requestedCpuBackend,
      active: this.cpuBackend,
      wasmAvailable: !!availability.wasm
    };
  }

  ensureCpuBackendReady() {
    const next = normalizeCpuBackendMode(this.requestedCpuBackend);
    const availability = Emulator.getCpuBackendAvailability();
    if (next === "wasm" && !availability.wasm) {
      throw new Error("WASM CPU backend is not available in this build.");
    }
    if (next === "wasm") {
      const emu = KosEmu && KosEmu.emu ? KosEmu.emu : null;
      if (!emu || typeof emu.createWasmCpuBackend !== "function") {
        throw new Error("WASM CPU backend is not available in this build.");
      }
      this.cpuHelperBackend = emu.createWasmCpuBackend();
    } else {
      this.cpuHelperBackend = null;
    }
    this.cpuBackend = next;
    return this.cpuBackend;
  }

  resetImageAnalysisState() {
    this.syscallSiteSet.clear();
    this.unknownSyscalls.clear();
    this.softInstructionSites.clear();
    this.opcodeCounts.clear();
    this.unknownPorts.clear();
  }

  resetEventState(queueInitialRedraw) {
    this.eventQueue.length = 0;
    this.eventMask = 0x7;
    if (queueInitialRedraw) {
      this.eventQueue.push(1);
    }
    this.lastTimerEventAt = 0;
  }

  resetExecutionState() {
    this.cpu = null;
    this.lastEip = 0;
    this.lastSyscall = null;
    this.tscBase = 0;
    this.yieldRequested = false;
    this.yieldDelay = 0;
    this.yieldMode = "";
    this.presentYieldPending = false;
    this.sliceDeadlineAt = 0;
    this.sliceTimeCheckCounter = this.sliceTimeCheckInterval | 0;
    this.repeatCurrentInstruction = false;
    this.pendingHostFsRead = null;
    this.pendingHostFsInfo = null;
    this.pendingHostFsMutation = null;
    this.waitEventDeadlineAt = 0;
    this.heapEnabled = false;
    this.heapBase = 0;
    this.heapSize = 0;
    this.heapTop = 0;
    this.heapLowBase = 0;
    this.heapLowSize = 0;
    this.heapLowTop = 0;
    this.heapHighBase = 0;
    this.heapHighSize = 0;
    this.heapHighTop = 0;
    this.stackBase = 0;
    this.processReservedSize = 0;
    this.lastImageHash = null;
    this.lastPaletteHash = null;
    this.imageDrawCount = 0;
    this.inRedraw = false;
    this.lastPresentAt = 0;
    this.surfaceDirty = false;
    this.lastRegDumpAt = 0;
    this.lastTimeBcd = null;
    this.cpuBusySamples.length = 0;
    this.cpuBusySampleTotalMs = 0;
    this.cpuBusyActiveStartMs = 0;
    this.lastStopReason = "";
    this.stopEventEmitted = false;
  }

  resetWindowState() {
    this.windowOriginX = 0;
    this.windowOriginY = 0;
    this.windowHostX = 0;
    this.windowHostY = 0;
    this.windowDefined = false;
    this.windowStyle = 0;
    this.windowHasCaption = false;
    this.windowTitle = "";
    this.windowClientOffsetX = 0;
    this.windowClientOffsetY = 0;
    this.windowShapePtr = 0;
    this.windowShapeScale = 0;
    this.windowShape = null;
    this.windowWidth = 0;
    this.windowHeight = 0;
    this.buttonStyle = 1;
    this.fontSmoothingMode = 1;
    this.fontSizePx = 9;
    this.speakerDisabled = false;
    this.lowLevelHdAccessEnabled = false;
    this.lowLevelPciAccessEnabled = false;
    this.resetSkinTheme();
  }

  resetInputState() {
    this.buttons.length = 0;
    this.nextButtonSerial = 1;
    this.activeButtonSerial = 0;
    this.pendingButtonResult = 1;
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseScreenX = 0;
    this.mouseScreenY = 0;
    this.mouseButtons = 0;
    this.mouseEventFlags = 0;
    this.mouseScrollX = 0;
    this.mouseScrollY = 0;
    this.mouseInside = false;
    this.mouseEventBuffer.length = 0;
    this.mouseSpeedDivider = 4;
    this.mouseSensitivity = 3;
    this.mouseDoubleClickDelay = 50;
    this.keyboardMode = 0;
    this.controlKeyState = 0;
    this.keyBuffer.length = 0;
    this.lastDrawRectHeight = 0;
  }

  resetResourceState() {
    this.heapAllocs.clear();
    this.heapFreeBlocks.length = 0;
    this.hostCallStubs.clear();
    this.loadedHostLibraries.clear();
    this.loadedDllLibraries.clear();
    this.hostLibimgImages.clear();
    this.loadedDrivers.clear();
    this.nextDriverHandle = 1;
    if (
      this.sharedNamedMemoryStore &&
      typeof this.sharedNamedMemoryStore.get === "function" &&
      typeof this.sharedNamedMemoryStore.set === "function"
    ) {
      this.namedMemoryAreas = this.sharedNamedMemoryStore;
    } else if (this.namedMemoryAreas && typeof this.namedMemoryAreas.clear === "function") {
      this.namedMemoryAreas.clear();
    } else {
      this.namedMemoryAreas = new Map();
    }
    if (this.futexState && this.futexState.handles instanceof Map) {
      this.futexState.handles.clear();
      this.futexState.nextHandle = 1;
    } else {
      this.futexState = {
        nextHandle: 1,
        handles: new Map()
      };
    }
    this.decodeCache.clear();
    this.decodeCacheHits = 0;
    this.decodeCacheMisses = 0;
    this.fastLoopCache.clear();
    this.fastLoopHits = 0;
    this.fastLoopMisses = 0;
    this.clearBasicBlockCache();
    this.basicBlockHotCounts.clear();
    this.basicBlockHits = 0;
    this.basicBlockMisses = 0;
    this.basicBlockBuilds = 0;
    this.basicBlockWarmups = 0;
    this.basicBlockPromotions = 0;
    this.currentFolder = "/sys";
    if (this.processPathOverride) {
      const processPath = String(this.processPathOverride).replace(/\\/g, "/");
      const slashIndex = processPath.lastIndexOf("/");
      if (slashIndex > 0) {
        this.currentFolder = processPath.slice(0, slashIndex) || "/";
      }
    }
    this.additionalSystemDirs.clear();
    this.portReservations.clear();
    this.ipcBufferPtr = 0;
    this.ipcBufferSize = 0;
    this.desktopBackgroundMapPtr = 0;
    this.desktopBackgroundMapSize = 0;
    this.addrSizeOverride = 32;
    this.segCS = 0;
    this.segDS = 0;
    this.segES = 0;
    this.segSS = 0;
    this.segFS = 0;
    this.segGS = 0;
  }

  load(image) {
    this.image = image;
    this.imageDataRaw = new Uint8Array(image.image);
    this.imageData = new Uint8Array(image.image);
    this.resetImageAnalysisState();
    this.resetExecutionState();
    this.resetEventState(true);
    this.resetWindowState();
    this.resetInputState();
    this.resetResourceState();
    this.ensureSkinThemeLoaded();
    const scanLimit = Math.max(0, Math.min(this.imageData.length >>> 0, this.image.header.imageSize >>> 0));
    const scanData = scanLimit > 0 ? this.imageData.subarray(0, scanLimit) : this.imageData;
    const sites = scanSyscalls(scanData);
    for (const addr of sites) {
      this.syscallSiteSet.add(addr >>> 0);
    }
    if (sites.length) {
      this.log(`Found ${sites.length} syscall sites (no patch).`);
    }
    if (this.softInstructions) {
      const result = scanSoftOps(this.imageData, this.image.header.entry, this.image.header.imageSize);
      let pushaCount = 0;
      let popaCount = 0;
      let testCount = 0;
      let bswapCount = 0;
      let loopCount = 0;
      let shlCount = 0;
      let shrCount = 0;
      let aluCount = 0;
      let shl32Count = 0;
      let shr32Count = 0;
      let mov8Count = 0;
      let mov32Count = 0;
      let xor32Count = 0;
      let or32Count = 0;
      let callCount = 0;
      let retCount = 0;
      let pushCount = 0;
      let popCount = 0;
      let incCount = 0;
      let decCount = 0;
      let andAlCount = 0;
      let jccCount = 0;
      let jmpCount = 0;
      for (const [addr, site] of result.sites.entries()) {
        this.softInstructionSites.set(addr >>> 0, site);
        if (site.type === "pusha") pushaCount += 1;
        if (site.type === "popa") popaCount += 1;
        if (site.type === "testb-imm8") testCount += 1;
        if (site.type === "bswap") bswapCount += 1;
        if (site.type === "loop") loopCount += 1;
        if (site.type === "shlb-mem1") shlCount += 1;
        if (site.type === "shrb-mem-imm") shrCount += 1;
        if (site.type === "alu-imm") aluCount += 1;
        if (site.type === "shl32-imm") shl32Count += 1;
        if (site.type === "shr32-imm") shr32Count += 1;
        if (site.type === "mov8-rm-r" || site.type === "mov8-r-rm") mov8Count += 1;
        if (site.type === "mov32-rm-r" || site.type === "mov32-r-rm") mov32Count += 1;
        if (site.type === "xor32-rm-r") xor32Count += 1;
        if (site.type === "or32-rm-r") or32Count += 1;
        if (site.type === "call-rel32") callCount += 1;
        if (site.type === "ret") retCount += 1;
        if (site.type === "push-r32") pushCount += 1;
        if (site.type === "pop-r32") popCount += 1;
        if (site.type === "inc-r32") incCount += 1;
        if (site.type === "dec-r32") decCount += 1;
        if (site.type === "and-al-imm8") andAlCount += 1;
        if (site.type === "jcc") jccCount += 1;
        if (site.type === "jmp") jmpCount += 1;
      }
      if (result.sites.size) {
        const parts = [];
        if (pushaCount || popaCount) {
          parts.push(`PUSHA=${pushaCount}`, `POPA=${popaCount}`);
        }
        if (testCount) {
          parts.push(`TESTB=${testCount}`);
        }
        if (bswapCount) {
          parts.push(`BSWAP=${bswapCount}`);
        }
        if (loopCount) {
          parts.push(`LOOP=${loopCount}`);
        }
        if (shlCount) {
          parts.push(`SHL=${shlCount}`);
        }
        if (shrCount) {
          parts.push(`SHR=${shrCount}`);
        }
        if (aluCount) {
          parts.push(`ALU=${aluCount}`);
        }
        if (shl32Count) {
          parts.push(`SHL32=${shl32Count}`);
        }
        if (shr32Count) {
          parts.push(`SHR32=${shr32Count}`);
        }
        if (mov8Count) {
          parts.push(`MOV8=${mov8Count}`);
        }
        if (mov32Count) {
          parts.push(`MOV32=${mov32Count}`);
        }
        if (xor32Count) {
          parts.push(`XOR32=${xor32Count}`);
        }
        if (or32Count) {
          parts.push(`OR32=${or32Count}`);
        }
        if (callCount) {
          parts.push(`CALL=${callCount}`);
        }
        if (retCount) {
          parts.push(`RET=${retCount}`);
        }
        if (pushCount) {
          parts.push(`PUSH=${pushCount}`);
        }
        if (popCount) {
          parts.push(`POP=${popCount}`);
        }
        if (incCount) {
          parts.push(`INC=${incCount}`);
        }
        if (decCount) {
          parts.push(`DEC=${decCount}`);
        }
        if (andAlCount) {
          parts.push(`ANDAL=${andAlCount}`);
        }
        if (jccCount) {
          parts.push(`JCC=${jccCount}`);
        }
        if (jmpCount) {
          parts.push(`JMP=${jmpCount}`);
        }
        const detail = parts.length ? ` (${parts.join(", ")})` : "";
        this.log(`Found ${result.sites.size} soft op sites${detail}.`);
      }
      if (result.warnings.length) {
        this.log(`Soft scan warnings: ${result.warnings.join(", ")}`);
      }
    }
    this.log(`Image loaded: ${image.fileName}`);
  }

  run() {
    if (!this.image) {
      this.log("No image loaded; run aborted.");
      return;
    }
    this.lastStopReason = "";
    this.stopEventEmitted = false;
    this.ensureCpuBackendReady();
    this.setupInterpreter();
    this.running = true;
    this.scheduleStep(0);
    this.log(
      this.cpuBackend === "wasm"
        ? "Emulation started (JS interpreter with WASM CPU helpers)."
        : "Emulation started (JS interpreter)."
    );
  }

  emitStopped(reason) {
    const finalReason = reason ? String(reason) : (this.lastStopReason || "stopped");
    this.lastStopReason = finalReason;
    if (this.stopEventEmitted) {
      return;
    }
    this.stopEventEmitted = true;
    if (typeof this.onStopped === "function") {
      try {
        this.onStopped(finalReason);
      } catch (err) {
        this.log(`Stop callback failed: ${err}`);
      }
    }
  }

  stop(reason) {
    if (!this.running && !this.cpu && !this.timer) {
      return;
    }
    const finalReason = reason ? String(reason) : (this.lastStopReason || "stopped");
    this.lastStopReason = finalReason;
    this.running = false;
    this.cancelScheduledStep();
    this.immediatePending = false;
    if (typeof this.syncOwnedNamedMemoryAreas === "function") {
      this.syncOwnedNamedMemoryAreas();
    }
    if (typeof this.releaseProcessNamedMemoryMappings === "function") {
      this.releaseProcessNamedMemoryMappings();
    }
    this.cpu = null;
    this.log("Emulation stopped.");
    this.emitStopped(finalReason);
  }

  setupInterpreter() {
    const image = this.image;
    const threadLaunch = this.threadLaunchSpec || null;
    if (threadLaunch && threadLaunch.sharedMem instanceof Uint8Array) {
      const mem = threadLaunch.sharedMem;
      const view =
        threadLaunch.sharedView instanceof DataView
          ? threadLaunch.sharedView
          : new DataView(mem.buffer, mem.byteOffset || 0, mem.byteLength || mem.length);
      const entry = threadLaunch.entry >>> 0;
      let stack = threadLaunch.stack >>> 0;
      if (!stack || stack > (mem.length >>> 0)) {
        stack = mem.length >>> 0;
      }

      const regs = new Uint32Array(10);
      regs[REG.EIP] = entry >>> 0;
      regs[REG.ESP] = stack >>> 0;
      regs[REG.EFLAGS] = 0x202;
      this.stackBase = stack >>> 0;
      this.processReservedSize = threadLaunch.processReservedSize
        ? (threadLaunch.processReservedSize >>> 0)
        : (mem.length >>> 0);
      this.memLimit = threadLaunch.memLimit
        ? (threadLaunch.memLimit >>> 0)
        : (mem.length >>> 0);
      const xmm = new Uint32Array(32);
      this.cpu = {
        mem,
        view,
        regs,
        fpu: new Float64Array(8),
        fpuSize: 0,
        fpuStatusWord: 0,
        mmx: new Uint32Array(16),
        xmm,
        xmmF: new Float32Array(xmm.buffer),
        memFaultLogged: false
      };
      if (threadLaunch.currentFolder) {
        this.currentFolder = String(threadLaunch.currentFolder);
      }
      if (threadLaunch.additionalSystemDirs instanceof Map) {
        this.additionalSystemDirs = new Map(threadLaunch.additionalSystemDirs);
      }
      if (threadLaunch.hostCallStubs instanceof Map) {
        this.hostCallStubs = threadLaunch.hostCallStubs;
      }
      if (threadLaunch.loadedHostLibraries instanceof Map) {
        this.loadedHostLibraries = threadLaunch.loadedHostLibraries;
      }
      if (threadLaunch.loadedDllLibraries instanceof Map) {
        this.loadedDllLibraries = threadLaunch.loadedDllLibraries;
      }
      if (threadLaunch.hostLibimgImages instanceof Map) {
        this.hostLibimgImages = threadLaunch.hostLibimgImages;
      }
      if (threadLaunch.futexState && threadLaunch.futexState.handles instanceof Map) {
        this.futexState = threadLaunch.futexState;
      }
      if (threadLaunch.threadPriority !== undefined) {
        this.threadPriority = threadLaunch.threadPriority & 0xff;
      }
      this.threadLaunchSpec = null;
      this.log(`Mapped shared ${formatBytes(this.memLimit)}; entry=0x${entry.toString(16)} stack=0x${stack.toString(16)}`);
      const bytes = this.readMemBlock(entry, 16);
      if (bytes) {
        this.log(`Entry bytes: ${formatHex(bytes)}`);
      } else {
        this.log("Entry bytes read failed.");
      }
      return;
    }

    const minMem = this.minMemSize || 0;
    const src = this.imageData || image.image;
    const loadedSize = src ? ((src.length || src.byteLength || 0) >>> 0) : (image.header.imageSize >>> 0);
    const processPath = this.processPathOverride ? String(this.processPathOverride) : (image.fileName || "");
    const processArgs = this.processArgs ? String(this.processArgs) : "";
    const processPathHeader = buildMenuetPathString(processPath);
    const pathPtr = image.header.path >>> 0;
    const argvPtr = image.header.argv >>> 0;
    const pathLimit = pathPtr ? ((pathPtr + Math.min(260, processPathHeader.length + 2)) >>> 0) : 0;
    const argvLimit = argvPtr ? ((argvPtr + Math.min(260, processArgs.length + 1)) >>> 0) : 0;
    const reservedSize = Math.max(
      image.header.memorySize >>> 0,
      loadedSize,
      image.header.stack >>> 0,
      pathLimit,
      argvLimit
    ) >>> 0;
    const memSize = align4k(Math.max(reservedSize, minMem));
    const mem = new Uint8Array(memSize);
    if (src) {
      if (src instanceof Uint8Array) {
        mem.set(src, 0);
      } else {
        mem.set(new Uint8Array(src), 0);
      }
    }

    const entry = image.header.entry >>> 0;
    let stack = image.header.stack >>> 0;
    if (!stack || stack > memSize) {
      stack = memSize;
    }

    const regs = new Uint32Array(10);
    regs[REG.EIP] = entry >>> 0;
    regs[REG.ESP] = stack >>> 0;
    regs[REG.EFLAGS] = 0x202;
    this.stackBase = stack >>> 0;
    this.processReservedSize = reservedSize >>> 0;

    this.memLimit = memSize;
    const xmm = new Uint32Array(32);
    this.cpu = {
      mem,
      view: new DataView(mem.buffer),
      regs,
      fpu: new Float64Array(8),
      fpuSize: 0,
      fpuStatusWord: 0,
      mmx: new Uint32Array(16),
      xmm,
      xmmF: new Float32Array(xmm.buffer),
      memFaultLogged: false
    };
    if (pathPtr) {
      this.writeCString(pathPtr, processPathHeader, 260);
    }
    if (argvPtr) {
      this.writeCString(argvPtr, processArgs, 260);
    }
    if (typeof this.resolveKxImports === "function") {
      this.resolveKxImports();
    }
    this.log(`Mapped ${formatBytes(memSize)}; entry=0x${entry.toString(16)} stack=0x${stack.toString(16)}`);
    const bytes = this.readMemBlock(entry, 16);
    if (bytes) {
      this.log(`Entry bytes: ${formatHex(bytes)}`);
    } else {
      this.log("Entry bytes read failed.");
    }
  }

  scheduleStep(delay) {
    if (delay > 0 || !this.useImmediateScheduler) {
      this.timerKind = "timeout";
      this.timer = setTimeout(() => {
        this.timer = null;
        this.timerKind = "";
        this.step();
      }, delay);
      return;
    }
    if (this.yieldMode === "present" && typeof requestAnimationFrame === "function") {
      this.timerKind = "raf";
      this.timer = requestAnimationFrame(() => {
        this.timer = null;
        this.timerKind = "";
        this.step();
      });
      return;
    }
    if (!this.immediatePort) {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        this.immediatePending = false;
        this.step();
      };
      this.immediatePort = channel.port2;
    }
    if (this.immediatePending) {
      return;
    }
    this.immediatePending = true;
    this.immediatePort.postMessage(0);
  }

  cancelScheduledStep() {
    if (!this.timer) {
      return;
    }
    if (this.timerKind === "raf" && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.timer);
    } else {
      clearTimeout(this.timer);
    }
    this.timer = null;
    this.timerKind = "";
  }

  step() {
    if (!this.running) {
      return;
    }
    this.timer = null;
    this.timerKind = "";
    this.stepInterpreter();
  }

}

  installCoreAccess(Emulator, { REG, formatHex });
  installEmulatorHost(Emulator, {
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
  });
  if (typeof installEmulatorHostLibRuntime === "function") {
    installEmulatorHostLibRuntime(Emulator, {
      REG,
      align4k
    });
  }
  installCoreRuntime(Emulator, { REG, formatHex });
  installCoreExecute(Emulator, {
    REG,
    FLAG_CF,
    FLAG_AF,
    FLAG_PF,
    FLAG_ZF,
    FLAG_SF,
    FLAG_DF,
    FLAG_OF,
    parityEven8,
    roundTiesToEven,
    x87StoreIntegerValue,
    x87PackedBcdToNumber,
    x87NumberToPackedBcd,
    bitScan,
    bitTestModify,
    imulSignedWidth,
    updateLogicFlagsWidth,
    updateAddFlags,
    updateAdcFlags,
    updateSubFlags,
    updateSbbFlags,
    shiftRotate,
    doubleShift,
    psubusb32,
    psubusw32,
    psubsw32,
    paddw32,
    pmullw32,
    pavgb32,
    psrlw32,
    psraw32,
    psllw32,
    psrld32,
    psrad32,
    pslld32,
    packsswb64,
    packuswb64,
    packssdw64,
    punpcklbw64,
    punpckhbw64,
    punpcklwd64,
    punpckhwd64,
    matchBytes,
    FAST_LOOP_SHADE,
    FAST_LOOP_MAX,
    FAST_LOOP_BLUR,
    FAST_LOOP_BLUR_RIGHT,
    evalJccCondition
  });
  if (typeof Emulator.prototype.executeBasicInstruction === "function") {
    const executeBasicInstructionImpl = Emulator.prototype.executeBasicInstruction;
    Emulator.prototype.executeBasicInstruction = function executeBasicInstructionWithBackend(addr) {
      const prevBackend = getActiveCpuHelperBackend();
      setActiveCpuHelperBackend(this && this.cpuBackend === "wasm" ? this.cpuHelperBackend : null);
      try {
        return executeBasicInstructionImpl.call(this, addr >>> 0);
      } finally {
        setActiveCpuHelperBackend(prevBackend);
      }
    };
  }
  installEmulatorSyscalls(Emulator, {
    REG,
    drawText,
    measureText,
    getTextInfo,
    getTextInfoFromString,
    measureKolibriText,
    drawKolibriText,
    toBcd,
    align4k
  });
  Emulator.normalizeCpuBackendMode = normalizeCpuBackendMode;
  Emulator.getCpuBackendAvailability = getCpuBackendAvailability;
  KosEmu.emu.createJsCpuHelperBackend = getJsCpuHelperBackend;
  KosEmu.emu.Emulator = Emulator;
})();

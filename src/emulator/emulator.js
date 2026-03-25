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
const SIMPLE_BLOCK_RECORD_WORDS = 5;
const SIMPLE_BLOCK_OPS = {
  NOP: 0,
  INC_R32: 1,
  DEC_R32: 2,
  BSWAP_R32: 3,
  MOV_R32_R32: 4,
  MOV_R32_IMM32: 5,
  ALU_R32_R32: 6,
  ALU_R32_IMM32: 7,
  ALU_AL_IMM8: 8,
  MOV_R8_R8: 9,
  ALU_R8_IMM8: 10,
  SHIFT_R32_IMM: 11,
  SHIFT_R8_IMM: 12
};

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

function x87CompareCodeJs(left, right) {
  const a = Number(left);
  const b = Number(right);
  if (Number.isNaN(a) || Number.isNaN(b)) {
    return 3;
  }
  if (a > b) {
    return 0;
  }
  if (a < b) {
    return 1;
  }
  return 2;
}

function x87CompareCode(left, right) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.x87CompareCode === "function") {
    return backend.x87CompareCode(Number(left), Number(right)) >>> 0;
  }
  return x87CompareCodeJs(left, right);
}

function shiftPacked64Js(lo, hi, count, leftShift) {
  const shift = count >>> 0;
  let value = (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0);
  if (leftShift) {
    value = shift >= 64 ? 0n : ((value << BigInt(shift)) & 0xffffffffffffffffn);
  } else {
    value = shift >= 64 ? 0n : (value >> BigInt(shift));
  }
  return {
    lo: Number(value & 0xffffffffn) >>> 0,
    hi: Number((value >> 32n) & 0xffffffffn) >>> 0
  };
}

function shiftPacked64(lo, hi, count, leftShift) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.shiftPacked64 === "function") {
    return backend.shiftPacked64(lo >>> 0, hi >>> 0, count >>> 0, !!leftShift);
  }
  return shiftPacked64Js(lo, hi, count, leftShift);
}

function mulFullWidthJs(left, right, widthBits, signed, flags) {
  const width = (widthBits >>> 0) === 16 ? 16 : 32;
  let low = 0;
  let high = 0;
  let overflow = false;
  if (signed) {
    const a = width === 16
      ? BigInt.asIntN(16, BigInt(left & 0xffff))
      : BigInt.asIntN(32, BigInt(left >>> 0));
    const b = width === 16
      ? BigInt.asIntN(16, BigInt(right & 0xffff))
      : BigInt.asIntN(32, BigInt(right >>> 0));
    const product = a * b;
    const bits = BigInt.asUintN(width * 2, product);
    if (width === 16) {
      low = Number(bits & 0xffffn) & 0xffff;
      high = Number((bits >> 16n) & 0xffffn) & 0xffff;
      overflow = product < -32768n || product > 32767n;
    } else {
      low = Number(bits & 0xffffffffn) >>> 0;
      high = Number((bits >> 32n) & 0xffffffffn) >>> 0;
      overflow = product < -0x80000000n || product > 0x7fffffffn;
    }
  } else {
    const mask = width === 16 ? 0xffffn : 0xffffffffn;
    const a = BigInt(width === 16 ? (left & 0xffff) : (left >>> 0));
    const b = BigInt(width === 16 ? (right & 0xffff) : (right >>> 0));
    const product = a * b;
    if (width === 16) {
      low = Number(product & mask) & 0xffff;
      high = Number((product >> 16n) & 0xffffn) & 0xffff;
    } else {
      low = Number(product & mask) >>> 0;
      high = Number((product >> 32n) & 0xffffffffn) >>> 0;
    }
    overflow = product > mask;
  }
  let next = flags >>> 0;
  next &= ~(FLAG_CF | FLAG_OF);
  if (overflow) {
    next |= FLAG_CF | FLAG_OF;
  }
  return { lo: low >>> 0, hi: high >>> 0, flags: next >>> 0 };
}

function mulFullWidth(left, right, widthBits, signed, flags) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.mulFullWidth === "function") {
    return backend.mulFullWidth(left >>> 0, right >>> 0, widthBits >>> 0, !!signed, flags >>> 0);
  }
  return mulFullWidthJs(left, right, widthBits, signed, flags);
}

function divideFullWidthJs(high, low, divisor, widthBits, signed) {
  const width = (widthBits >>> 0) === 16 ? 16 : 32;
  if (signed) {
    const dividend = width === 16
      ? BigInt.asIntN(32, (BigInt(high & 0xffff) << 16n) | BigInt(low & 0xffff))
      : BigInt.asIntN(64, (BigInt(high >>> 0) << 32n) | BigInt(low >>> 0));
    const den = width === 16
      ? BigInt.asIntN(16, BigInt(divisor & 0xffff))
      : BigInt.asIntN(32, BigInt(divisor >>> 0));
    if (den === 0n) {
      return { ok: false, quotient: 0, remainder: 0 };
    }
    const quotient = dividend / den;
    const remainder = dividend % den;
    const minQ = width === 16 ? -32768n : -0x80000000n;
    const maxQ = width === 16 ? 32767n : 0x7fffffffn;
    if (quotient < minQ || quotient > maxQ) {
      return { ok: false, quotient: 0, remainder: 0 };
    }
    const q = width === 16
      ? (Number(BigInt.asUintN(16, quotient)) & 0xffff)
      : (Number(BigInt.asUintN(32, quotient)) >>> 0);
    const r = width === 16
      ? (Number(BigInt.asUintN(16, remainder)) & 0xffff)
      : (Number(BigInt.asUintN(32, remainder)) >>> 0);
    return { ok: true, quotient: q >>> 0, remainder: r >>> 0 };
  }
  const dividend = width === 16
    ? ((BigInt(high & 0xffff) << 16n) | BigInt(low & 0xffff))
    : ((BigInt(high >>> 0) << 32n) | BigInt(low >>> 0));
  const den = width === 16 ? BigInt(divisor & 0xffff) : BigInt(divisor >>> 0);
  if (den === 0n) {
    return { ok: false, quotient: 0, remainder: 0 };
  }
  const quotient = dividend / den;
  const remainder = dividend % den;
  const maxQ = width === 16 ? 0xffffn : 0xffffffffn;
  if (quotient > maxQ) {
    return { ok: false, quotient: 0, remainder: 0 };
  }
  return {
    ok: true,
    quotient: width === 16 ? (Number(quotient) & 0xffff) : (Number(quotient) >>> 0),
    remainder: width === 16 ? (Number(remainder) & 0xffff) : (Number(remainder) >>> 0)
  };
}

function divideFullWidth(high, low, divisor, widthBits, signed) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.divideFullWidth === "function") {
    return backend.divideFullWidth(high >>> 0, low >>> 0, divisor >>> 0, widthBits >>> 0, !!signed);
  }
  return divideFullWidthJs(high, low, divisor, widthBits, signed);
}

function x87F2xm1Js(value) {
  return Math.pow(2, Number(value)) - 1;
}

function x87F2xm1(value) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.x87F2xm1 === "function") {
    return Number(backend.x87F2xm1(Number(value)));
  }
  return x87F2xm1Js(value);
}

function x87Fyl2xJs(y, x) {
  return Number(y) * Math.log2(Number(x));
}

function x87Fyl2x(y, x) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.x87Fyl2x === "function") {
    return Number(backend.x87Fyl2x(Number(y), Number(x)));
  }
  return x87Fyl2xJs(y, x);
}

function x87TanJs(value) {
  return Math.tan(Number(value));
}

function x87Tan(value) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.x87Tan === "function") {
    return Number(backend.x87Tan(Number(value)));
  }
  return x87TanJs(value);
}

function x87Atan2Js(y, x) {
  return Math.atan2(Number(y), Number(x));
}

function x87Atan2(y, x) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.x87Atan2 === "function") {
    return Number(backend.x87Atan2(Number(y), Number(x)));
  }
  return x87Atan2Js(y, x);
}

function x87SqrtJs(value) {
  return Math.sqrt(Number(value));
}

function x87Sqrt(value) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.x87Sqrt === "function") {
    return Number(backend.x87Sqrt(Number(value)));
  }
  return x87SqrtJs(value);
}

function x87SinJs(value) {
  return Math.sin(Number(value));
}

function x87Sin(value) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.x87Sin === "function") {
    return Number(backend.x87Sin(Number(value)));
  }
  return x87SinJs(value);
}

function x87CosJs(value) {
  return Math.cos(Number(value));
}

function x87Cos(value) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.x87Cos === "function") {
    return Number(backend.x87Cos(Number(value)));
  }
  return x87CosJs(value);
}

function x87SinCosJs(value) {
  return {
    sin: Math.sin(Number(value)),
    cos: Math.cos(Number(value))
  };
}

function x87SinCos(value) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.x87SinCos === "function") {
    return backend.x87SinCos(Number(value));
  }
  return x87SinCosJs(value);
}

function x87ScaleJs(st0, st1) {
  return Number(st0) * Math.pow(2, Math.trunc(Number(st1)));
}

function x87Scale(st0, st1) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.x87Scale === "function") {
    return Number(backend.x87Scale(Number(st0), Number(st1)));
  }
  return x87ScaleJs(st0, st1);
}

function sseSqrtJs(value) {
  return Math.sqrt(Number(value));
}

function sseSqrt(value) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.sseSqrt === "function") {
    return Number(backend.sseSqrt(Number(value)));
  }
  return sseSqrtJs(value);
}

function sseReciprocalJs(value) {
  return 1 / Number(value);
}

function sseReciprocal(value) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.sseReciprocal === "function") {
    return Number(backend.sseReciprocal(Number(value)));
  }
  return sseReciprocalJs(value);
}

function sseReciprocalSqrtJs(value) {
  return 1 / Math.sqrt(Number(value));
}

function sseReciprocalSqrt(value) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.sseReciprocalSqrt === "function") {
    return Number(backend.sseReciprocalSqrt(Number(value)));
  }
  return sseReciprocalSqrtJs(value);
}

function sseBinaryFloatJs(left, right, op) {
  const a = Number(left);
  const b = Number(right);
  switch (op >>> 0) {
    case 0:
      return a + b;
    case 1:
      return a - b;
    case 2:
      return a * b;
    case 3:
      return a / b;
    case 4:
      return Math.min(a, b);
    case 5:
      return Math.max(a, b);
    default:
      return Number.NaN;
  }
}

function sseBinaryFloat(left, right, op) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.sseBinaryFloat === "function") {
    return Number(backend.sseBinaryFloat(Number(left), Number(right), op >>> 0));
  }
  return sseBinaryFloatJs(left, right, op);
}

function sseCompareCodeJs(left, right) {
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return 3;
  }
  if (a === b) {
    return 2;
  }
  return a < b ? 1 : 0;
}

function sseCompareCode(left, right) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.sseCompareCode === "function") {
    return backend.sseCompareCode(Number(left), Number(right)) >>> 0;
  }
  return sseCompareCodeJs(left, right) >>> 0;
}

const float32BitcastBuffer = new ArrayBuffer(4);
const float32BitcastF32 = new Float32Array(float32BitcastBuffer);
const float32BitcastU32 = new Uint32Array(float32BitcastBuffer);

function f32BitsToNumber(value) {
  float32BitcastU32[0] = value >>> 0;
  return float32BitcastF32[0];
}

function numberToF32Bits(value) {
  float32BitcastF32[0] = Math.fround(Number(value));
  return float32BitcastU32[0] >>> 0;
}

function sseUnaryFloat32x4Js(v0, v1, v2, v3, op) {
  const apply = op === 0
    ? sseSqrtJs
    : (op === 1 ? sseReciprocalJs : sseReciprocalSqrtJs);
  return [
    numberToF32Bits(apply(f32BitsToNumber(v0))),
    numberToF32Bits(apply(f32BitsToNumber(v1))),
    numberToF32Bits(apply(f32BitsToNumber(v2))),
    numberToF32Bits(apply(f32BitsToNumber(v3)))
  ];
}

function sseUnaryFloat32x4(v0, v1, v2, v3, op) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.sseUnaryFloat32x4 === "function") {
    return backend.sseUnaryFloat32x4(
      v0 >>> 0,
      v1 >>> 0,
      v2 >>> 0,
      v3 >>> 0,
      op >>> 0
    );
  }
  return sseUnaryFloat32x4Js(v0, v1, v2, v3, op);
}

function sseBinaryFloat32x4Js(dst0, dst1, dst2, dst3, src0, src1, src2, src3, op) {
  return [
    numberToF32Bits(sseBinaryFloatJs(f32BitsToNumber(dst0), f32BitsToNumber(src0), op)),
    numberToF32Bits(sseBinaryFloatJs(f32BitsToNumber(dst1), f32BitsToNumber(src1), op)),
    numberToF32Bits(sseBinaryFloatJs(f32BitsToNumber(dst2), f32BitsToNumber(src2), op)),
    numberToF32Bits(sseBinaryFloatJs(f32BitsToNumber(dst3), f32BitsToNumber(src3), op))
  ];
}

function sseBinaryFloat32x4(dst0, dst1, dst2, dst3, src0, src1, src2, src3, op) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.sseBinaryFloat32x4 === "function") {
    return backend.sseBinaryFloat32x4(
      dst0 >>> 0,
      dst1 >>> 0,
      dst2 >>> 0,
      dst3 >>> 0,
      src0 >>> 0,
      src1 >>> 0,
      src2 >>> 0,
      src3 >>> 0,
      op >>> 0
    );
  }
  return sseBinaryFloat32x4Js(dst0, dst1, dst2, dst3, src0, src1, src2, src3, op);
}

function sseBinaryFloat32BitsJs(dst, src, op) {
  return numberToF32Bits(sseBinaryFloatJs(f32BitsToNumber(dst), f32BitsToNumber(src), op));
}

function sseBinaryFloat32Bits(dst, src, op) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.sseBinaryFloat32Bits === "function") {
    return backend.sseBinaryFloat32Bits(dst >>> 0, src >>> 0, op >>> 0) >>> 0;
  }
  return sseBinaryFloat32BitsJs(dst, src, op);
}

function sseCompare32x4Js(dst0, dst1, dst2, dst3, src0, src1, src2, src3, imm) {
  const predicate = imm & 7;
  const out = [0, 0, 0, 0];
  const left = [dst0, dst1, dst2, dst3];
  const right = [src0, src1, src2, src3];
  for (let i = 0; i < 4; i += 1) {
    const code = sseCompareCodeJs(f32BitsToNumber(left[i]), f32BitsToNumber(right[i]));
    const unordered = code === 3;
    let ok = false;
    switch (predicate) {
      case 0: ok = code === 2; break;
      case 1: ok = code === 1; break;
      case 2: ok = code === 1 || code === 2; break;
      case 3: ok = unordered; break;
      case 4: ok = unordered || code !== 2; break;
      case 5: ok = unordered || code === 0 || code === 2; break;
      case 6: ok = unordered || code === 0; break;
      case 7: ok = !unordered; break;
      default: ok = false; break;
    }
    out[i] = ok ? 0xffffffff : 0;
  }
  return out;
}

function sseCompare32x4(dst0, dst1, dst2, dst3, src0, src1, src2, src3, imm) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.sseCompare32x4 === "function") {
    return backend.sseCompare32x4(
      dst0 >>> 0,
      dst1 >>> 0,
      dst2 >>> 0,
      dst3 >>> 0,
      src0 >>> 0,
      src1 >>> 0,
      src2 >>> 0,
      src3 >>> 0,
      imm >>> 0
    );
  }
  return sseCompare32x4Js(dst0, dst1, dst2, dst3, src0, src1, src2, src3, imm);
}

function cvtdq2ps32x4Js(v0, v1, v2, v3) {
  return [
    numberToF32Bits(v0 | 0),
    numberToF32Bits(v1 | 0),
    numberToF32Bits(v2 | 0),
    numberToF32Bits(v3 | 0)
  ];
}

function cvtdq2ps32x4(v0, v1, v2, v3) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.cvtdq2ps32x4 === "function") {
    return backend.cvtdq2ps32x4(v0 >>> 0, v1 >>> 0, v2 >>> 0, v3 >>> 0);
  }
  return cvtdq2ps32x4Js(v0, v1, v2, v3);
}

function haddps32x4Js(dst0, dst1, dst2, dst3, src0, src1, src2, src3) {
  return [
    numberToF32Bits(f32BitsToNumber(dst0) + f32BitsToNumber(dst1)),
    numberToF32Bits(f32BitsToNumber(dst2) + f32BitsToNumber(dst3)),
    numberToF32Bits(f32BitsToNumber(src0) + f32BitsToNumber(src1)),
    numberToF32Bits(f32BitsToNumber(src2) + f32BitsToNumber(src3))
  ];
}

function haddps32x4(dst0, dst1, dst2, dst3, src0, src1, src2, src3) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.haddps32x4 === "function") {
    return backend.haddps32x4(
      dst0 >>> 0,
      dst1 >>> 0,
      dst2 >>> 0,
      dst3 >>> 0,
      src0 >>> 0,
      src1 >>> 0,
      src2 >>> 0,
      src3 >>> 0
    );
  }
  return haddps32x4Js(dst0, dst1, dst2, dst3, src0, src1, src2, src3);
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

function aluBinaryWidthJs(op, left, right, widthBits, flags) {
  const width = (widthBits >>> 0) === 8 ? 8 : ((widthBits >>> 0) === 16 ? 16 : 32);
  const mask = widthMask(width);
  const a = widthValueUnsigned(left, width) >>> 0;
  const b = widthValueUnsigned(right, width) >>> 0;
  let result = a >>> 0;
  let nextFlags = flags >>> 0;
  switch (op >>> 0) {
    case 0:
      result = width === 32 ? ((a + b) >>> 0) : ((a + b) & mask);
      nextFlags = updateAddFlagsJs(nextFlags, a, b, result, width);
      break;
    case 1:
      result = width === 32 ? ((a | b) >>> 0) : ((a | b) & mask);
      nextFlags = updateLogicFlagsWidthJs(nextFlags, result, width);
      break;
    case 2: {
      const carry = (nextFlags & FLAG_CF) !== 0 ? 1 : 0;
      result = width === 32 ? ((a + b + carry) >>> 0) : ((a + b + carry) & mask);
      nextFlags = updateAdcFlagsJs(nextFlags, a, b, carry, result, width);
      break;
    }
    case 3: {
      const carry = (nextFlags & FLAG_CF) !== 0 ? 1 : 0;
      result = width === 32 ? ((a - b - carry) >>> 0) : ((a - b - carry) & mask);
      nextFlags = updateSbbFlagsJs(nextFlags, a, b, carry, result, width);
      break;
    }
    case 4:
      result = width === 32 ? ((a & b) >>> 0) : ((a & b) & mask);
      nextFlags = updateLogicFlagsWidthJs(nextFlags, result, width);
      break;
    case 5:
      result = width === 32 ? ((a - b) >>> 0) : ((a - b) & mask);
      nextFlags = updateSubFlagsJs(nextFlags, a, b, result, width);
      break;
    case 6:
      result = width === 32 ? ((a ^ b) >>> 0) : ((a ^ b) & mask);
      nextFlags = updateLogicFlagsWidthJs(nextFlags, result, width);
      break;
    case 7:
      result = width === 32 ? ((a - b) >>> 0) : ((a - b) & mask);
      nextFlags = updateSubFlagsJs(nextFlags, a, b, result, width);
      break;
    case 8:
      result = width === 32 ? ((a & b) >>> 0) : ((a & b) & mask);
      nextFlags = updateLogicFlagsWidthJs(nextFlags, result, width);
      break;
    default:
      result = 0;
      nextFlags = flags >>> 0;
      break;
  }
  return { result: result >>> 0, flags: nextFlags >>> 0 };
}

function aluBinaryWidth(op, left, right, widthBits, flags) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.aluBinaryWidth === "function") {
    return backend.aluBinaryWidth(op >>> 0, left >>> 0, right >>> 0, widthBits >>> 0, flags >>> 0);
  }
  return aluBinaryWidthJs(op, left, right, widthBits, flags);
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

function executeSimpleBlockJs(planWords, wordCount, regs, flags) {
  const words = planWords instanceof Uint32Array ? planWords : new Uint32Array(planWords || 0);
  if (!regs || typeof regs.length !== "number" || regs.length < 8) {
    return { ok: false, flags: flags >>> 0 };
  }
  const totalWords = Math.min(words.length >>> 0, wordCount >>> 0);
  if (!totalWords || (totalWords % SIMPLE_BLOCK_RECORD_WORDS) !== 0) {
    return { ok: false, flags: flags >>> 0 };
  }
  let nextFlags = flags >>> 0;
  const readReg8 = (index) => {
    const idx = index & 7;
    if (idx <= 3) {
      return regs[idx] & 0xff;
    }
    return (regs[idx - 4] >>> 8) & 0xff;
  };
  const writeReg8 = (index, value) => {
    const idx = index & 7;
    const v = value & 0xff;
    if (idx <= 3) {
      regs[idx] = ((regs[idx] & 0xffffff00) | v) >>> 0;
      return;
    }
    const base = idx - 4;
    regs[base] = ((regs[base] & 0xffff00ff) | (v << 8)) >>> 0;
  };
  for (let offset = 0; offset < totalWords; offset += SIMPLE_BLOCK_RECORD_WORDS) {
    const kind = words[offset] >>> 0;
    const a = words[offset + 1] >>> 0;
    const b = words[offset + 2] >>> 0;
    const c = words[offset + 3] >>> 0;
    const d = words[offset + 4] >>> 0;
    switch (kind) {
      case SIMPLE_BLOCK_OPS.NOP:
        break;
      case SIMPLE_BLOCK_OPS.INC_R32: {
        const reg = a & 7;
        const value = regs[reg] >>> 0;
        const alu = aluBinaryWidthJs(0, value, 1, 32, nextFlags);
        regs[reg] = alu.result >>> 0;
        nextFlags = ((alu.flags & ~FLAG_CF) | (nextFlags & FLAG_CF)) >>> 0;
        break;
      }
      case SIMPLE_BLOCK_OPS.DEC_R32: {
        const reg = a & 7;
        const value = regs[reg] >>> 0;
        const alu = aluBinaryWidthJs(5, value, 1, 32, nextFlags);
        regs[reg] = alu.result >>> 0;
        nextFlags = ((alu.flags & ~FLAG_CF) | (nextFlags & FLAG_CF)) >>> 0;
        break;
      }
      case SIMPLE_BLOCK_OPS.BSWAP_R32: {
        const reg = a & 7;
        regs[reg] = bswap32Js(regs[reg] >>> 0) >>> 0;
        break;
      }
      case SIMPLE_BLOCK_OPS.MOV_R32_R32:
        regs[a & 7] = regs[b & 7] >>> 0;
        break;
      case SIMPLE_BLOCK_OPS.MOV_R32_IMM32:
        regs[a & 7] = b >>> 0;
        break;
      case SIMPLE_BLOCK_OPS.ALU_R32_R32: {
        const lhsReg = a & 7;
        const rhsReg = b & 7;
        const writeResult = (d & 1) !== 0;
        const alu = aluBinaryWidthJs(c >>> 0, regs[lhsReg] >>> 0, regs[rhsReg] >>> 0, 32, nextFlags);
        if (writeResult) {
          regs[lhsReg] = alu.result >>> 0;
        }
        nextFlags = alu.flags >>> 0;
        break;
      }
      case SIMPLE_BLOCK_OPS.ALU_R32_IMM32: {
        const reg = a & 7;
        const writeResult = (d & 1) !== 0;
        const alu = aluBinaryWidthJs(c >>> 0, regs[reg] >>> 0, b >>> 0, 32, nextFlags);
        if (writeResult) {
          regs[reg] = alu.result >>> 0;
        }
        nextFlags = alu.flags >>> 0;
        break;
      }
      case SIMPLE_BLOCK_OPS.ALU_AL_IMM8: {
        const eax = regs[REG.EAX] >>> 0;
        const writeResult = (c & 1) !== 0;
        const alu = aluBinaryWidthJs(a >>> 0, eax & 0xff, b & 0xff, 8, nextFlags);
        if (writeResult) {
          regs[REG.EAX] = ((eax & 0xffffff00) | (alu.result & 0xff)) >>> 0;
        }
        nextFlags = alu.flags >>> 0;
        break;
      }
      case SIMPLE_BLOCK_OPS.MOV_R8_R8:
        writeReg8(a >>> 0, readReg8(b >>> 0));
        break;
      case SIMPLE_BLOCK_OPS.ALU_R8_IMM8: {
        const reg = a & 7;
        const writeResult = (d & 1) !== 0;
        const alu = aluBinaryWidthJs(c >>> 0, readReg8(reg), b & 0xff, 8, nextFlags);
        if (writeResult) {
          writeReg8(reg, alu.result & 0xff);
        }
        nextFlags = alu.flags >>> 0;
        break;
      }
      case SIMPLE_BLOCK_OPS.SHIFT_R32_IMM: {
        const reg = a & 7;
        const shift = b & 0x1f;
        regs[reg] = (c & 1) !== 0
          ? ((regs[reg] >>> shift) >>> 0)
          : ((regs[reg] << shift) >>> 0);
        break;
      }
      case SIMPLE_BLOCK_OPS.SHIFT_R8_IMM: {
        const reg = a & 7;
        const shift = b & 0x1f;
        const value = readReg8(reg);
        writeReg8(reg, (c & 1) !== 0 ? ((value >>> shift) & 0xff) : ((value << shift) & 0xff));
        break;
      }
      default:
        return { ok: false, flags: flags >>> 0 };
    }
  }
  return { ok: true, flags: nextFlags >>> 0 };
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
      x87CompareCode(left, right) {
        return x87CompareCodeJs(left, right);
      },
      shiftPacked64(lo, hi, count, leftShift) {
        return shiftPacked64Js(lo, hi, count, leftShift);
      },
      mulFullWidth(left, right, widthBits, signed, flags) {
        return mulFullWidthJs(left, right, widthBits, signed, flags);
      },
      divideFullWidth(high, low, divisor, widthBits, signed) {
        return divideFullWidthJs(high, low, divisor, widthBits, signed);
      },
      x87F2xm1(value) {
        return x87F2xm1Js(value);
      },
      x87Fyl2x(y, x) {
        return x87Fyl2xJs(y, x);
      },
      x87Tan(value) {
        return x87TanJs(value);
      },
      x87Atan2(y, x) {
        return x87Atan2Js(y, x);
      },
      x87Sqrt(value) {
        return x87SqrtJs(value);
      },
      x87Sin(value) {
        return x87SinJs(value);
      },
      x87Cos(value) {
        return x87CosJs(value);
      },
      x87SinCos(value) {
        return x87SinCosJs(value);
      },
      x87Scale(st0, st1) {
        return x87ScaleJs(st0, st1);
      },
      sseSqrt(value) {
        return sseSqrtJs(value);
      },
      sseReciprocal(value) {
        return sseReciprocalJs(value);
      },
      sseReciprocalSqrt(value) {
        return sseReciprocalSqrtJs(value);
      },
      sseBinaryFloat(left, right, op) {
        return sseBinaryFloatJs(left, right, op);
      },
      sseCompareCode(left, right) {
        return sseCompareCodeJs(left, right);
      },
      sseUnaryFloat32x4(v0, v1, v2, v3, op) {
        return sseUnaryFloat32x4Js(v0, v1, v2, v3, op);
      },
      sseBinaryFloat32x4(dst0, dst1, dst2, dst3, src0, src1, src2, src3, op) {
        return sseBinaryFloat32x4Js(dst0, dst1, dst2, dst3, src0, src1, src2, src3, op);
      },
      sseBinaryFloat32Bits(dst, src, op) {
        return sseBinaryFloat32BitsJs(dst, src, op);
      },
      sseCompare32x4(dst0, dst1, dst2, dst3, src0, src1, src2, src3, imm) {
        return sseCompare32x4Js(dst0, dst1, dst2, dst3, src0, src1, src2, src3, imm);
      },
      cvtdq2ps32x4(v0, v1, v2, v3) {
        return cvtdq2ps32x4Js(v0, v1, v2, v3);
      },
      haddps32x4(dst0, dst1, dst2, dst3, src0, src1, src2, src3) {
        return haddps32x4Js(dst0, dst1, dst2, dst3, src0, src1, src2, src3);
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
      aluBinaryWidth(op, left, right, widthBits, flags) {
        return aluBinaryWidthJs(op, left, right, widthBits, flags);
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
      packedOp32x2(dstLo, dstHi, srcLo, srcHi, op) {
        return packedOp32x2Js(dstLo, dstHi, srcLo, srcHi, op);
      },
      packedOp32x4(dst0, dst1, dst2, dst3, src0, src1, src2, src3, op) {
        return packedOp32x4Js(dst0, dst1, dst2, dst3, src0, src1, src2, src3, op);
      },
      punpckldq32x4(dst0, dst1, src0, src1) {
        return punpckldq32x4Js(dst0, dst1, src0, src1);
      },
      pshufw64(lo, hi, imm) {
        return pshufw64Js(lo, hi, imm);
      },
      movmskBytes64(lo, hi) {
        return movmskBytes64Js(lo, hi);
      },
      movmskBytes128(v0, v1, v2, v3) {
        return movmskBytes128Js(v0, v1, v2, v3);
      },
      movmskFloat32x4(v0, v1, v2, v3) {
        return movmskFloat32x4Js(v0, v1, v2, v3);
      },
      shufps32x4(dst0, dst1, dst2, dst3, src0, src1, src2, src3, imm) {
        return shufps32x4Js(dst0, dst1, dst2, dst3, src0, src1, src2, src3, imm);
      },
      bswap32(value) {
        return bswap32Js(value);
      },
      xaddWidth(dst, src, widthBits, flags) {
        return xaddWidthJs(dst, src, widthBits, flags);
      },
      cmpxchgWidth(accumulator, source, replacement, widthBits, flags) {
        return cmpxchgWidthJs(accumulator, source, replacement, widthBits, flags);
      },
      executeSimpleBlock(planWords, wordCount, regs, flags) {
        return executeSimpleBlockJs(planWords, wordCount, regs, flags);
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

function packedOp32Word(left, right, op) {
  switch (op >>> 0) {
    case 0:
      return (left & right) >>> 0;
    case 1:
      return ((~left) & right) >>> 0;
    case 2:
      return (left | right) >>> 0;
    case 3:
      return (left ^ right) >>> 0;
    case 4:
      return (left >>> 0) === (right >>> 0) ? 0xffffffff : 0;
    default:
      return 0;
  }
}

function packedOp32x2Js(dstLo, dstHi, srcLo, srcHi, op) {
  return {
    lo: packedOp32Word(dstLo >>> 0, srcLo >>> 0, op),
    hi: packedOp32Word(dstHi >>> 0, srcHi >>> 0, op)
  };
}

function packedOp32x2(dstLo, dstHi, srcLo, srcHi, op) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.packedOp32x2 === "function") {
    return backend.packedOp32x2(dstLo >>> 0, dstHi >>> 0, srcLo >>> 0, srcHi >>> 0, op >>> 0);
  }
  return packedOp32x2Js(dstLo, dstHi, srcLo, srcHi, op);
}

function packedOp32x4Js(dst0, dst1, dst2, dst3, src0, src1, src2, src3, op) {
  return [
    packedOp32Word(dst0 >>> 0, src0 >>> 0, op),
    packedOp32Word(dst1 >>> 0, src1 >>> 0, op),
    packedOp32Word(dst2 >>> 0, src2 >>> 0, op),
    packedOp32Word(dst3 >>> 0, src3 >>> 0, op)
  ];
}

function packedOp32x4(dst0, dst1, dst2, dst3, src0, src1, src2, src3, op) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.packedOp32x4 === "function") {
    return backend.packedOp32x4(
      dst0 >>> 0,
      dst1 >>> 0,
      dst2 >>> 0,
      dst3 >>> 0,
      src0 >>> 0,
      src1 >>> 0,
      src2 >>> 0,
      src3 >>> 0,
      op >>> 0
    );
  }
  return packedOp32x4Js(dst0, dst1, dst2, dst3, src0, src1, src2, src3, op);
}

function punpckldq32x4Js(dst0, dst1, src0, src1) {
  return [dst0 >>> 0, src0 >>> 0, dst1 >>> 0, src1 >>> 0];
}

function punpckldq32x4(dst0, dst1, src0, src1) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.punpckldq32x4 === "function") {
    return backend.punpckldq32x4(dst0 >>> 0, dst1 >>> 0, src0 >>> 0, src1 >>> 0);
  }
  return punpckldq32x4Js(dst0, dst1, src0, src1);
}

function pshufw64Js(lo, hi, imm) {
  const srcWords = [
    lo & 0xffff,
    (lo >>> 16) & 0xffff,
    hi & 0xffff,
    (hi >>> 16) & 0xffff
  ];
  const d0 = srcWords[(imm >>> 0) & 3];
  const d1 = srcWords[(imm >>> 2) & 3];
  const d2 = srcWords[(imm >>> 4) & 3];
  const d3 = srcWords[(imm >>> 6) & 3];
  return {
    lo: ((d0 & 0xffff) | ((d1 & 0xffff) << 16)) >>> 0,
    hi: ((d2 & 0xffff) | ((d3 & 0xffff) << 16)) >>> 0
  };
}

function pshufw64(lo, hi, imm) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.pshufw64 === "function") {
    return backend.pshufw64(lo >>> 0, hi >>> 0, imm >>> 0);
  }
  return pshufw64Js(lo, hi, imm);
}

function movmskBytes64Js(lo, hi) {
  let mask = 0;
  mask |= ((lo >>> 7) & 1) << 0;
  mask |= ((lo >>> 15) & 1) << 1;
  mask |= ((lo >>> 23) & 1) << 2;
  mask |= ((lo >>> 31) & 1) << 3;
  mask |= ((hi >>> 7) & 1) << 4;
  mask |= ((hi >>> 15) & 1) << 5;
  mask |= ((hi >>> 23) & 1) << 6;
  mask |= ((hi >>> 31) & 1) << 7;
  return mask >>> 0;
}

function movmskBytes64(lo, hi) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.movmskBytes64 === "function") {
    return backend.movmskBytes64(lo >>> 0, hi >>> 0) >>> 0;
  }
  return movmskBytes64Js(lo, hi);
}

function movmskBytes128Js(v0, v1, v2, v3) {
  let mask = 0;
  const lanes = [v0 >>> 0, v1 >>> 0, v2 >>> 0, v3 >>> 0];
  for (let i = 0; i < 16; i += 1) {
    const lane = lanes[(i >>> 2) & 3];
    const byte = (lane >>> ((i & 3) * 8)) & 0xff;
    mask |= ((byte >>> 7) & 1) << i;
  }
  return mask >>> 0;
}

function movmskBytes128(v0, v1, v2, v3) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.movmskBytes128 === "function") {
    return backend.movmskBytes128(v0 >>> 0, v1 >>> 0, v2 >>> 0, v3 >>> 0) >>> 0;
  }
  return movmskBytes128Js(v0, v1, v2, v3);
}

function movmskFloat32x4Js(v0, v1, v2, v3) {
  let mask = 0;
  if ((v0 >>> 0) & 0x80000000) {
    mask |= 1 << 0;
  }
  if ((v1 >>> 0) & 0x80000000) {
    mask |= 1 << 1;
  }
  if ((v2 >>> 0) & 0x80000000) {
    mask |= 1 << 2;
  }
  if ((v3 >>> 0) & 0x80000000) {
    mask |= 1 << 3;
  }
  return mask >>> 0;
}

function movmskFloat32x4(v0, v1, v2, v3) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.movmskFloat32x4 === "function") {
    return backend.movmskFloat32x4(v0 >>> 0, v1 >>> 0, v2 >>> 0, v3 >>> 0) >>> 0;
  }
  return movmskFloat32x4Js(v0, v1, v2, v3);
}

function shufps32x4Js(dst0, dst1, dst2, dst3, src0, src1, src2, src3, imm) {
  const dst = [dst0 >>> 0, dst1 >>> 0, dst2 >>> 0, dst3 >>> 0];
  const src = [src0 >>> 0, src1 >>> 0, src2 >>> 0, src3 >>> 0];
  return [
    dst[imm & 3] >>> 0,
    dst[(imm >>> 2) & 3] >>> 0,
    src[(imm >>> 4) & 3] >>> 0,
    src[(imm >>> 6) & 3] >>> 0
  ];
}

function shufps32x4(dst0, dst1, dst2, dst3, src0, src1, src2, src3, imm) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.shufps32x4 === "function") {
    return backend.shufps32x4(
      dst0 >>> 0,
      dst1 >>> 0,
      dst2 >>> 0,
      dst3 >>> 0,
      src0 >>> 0,
      src1 >>> 0,
      src2 >>> 0,
      src3 >>> 0,
      imm >>> 0
    );
  }
  return shufps32x4Js(dst0, dst1, dst2, dst3, src0, src1, src2, src3, imm);
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

function bswap32Js(value) {
  const v = value >>> 0;
  return (
    ((v & 0xff) << 24) |
    ((v & 0xff00) << 8) |
    ((v >>> 8) & 0xff00) |
    ((v >>> 24) & 0xff)
  ) >>> 0;
}

function bswap32(value) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.bswap32 === "function") {
    return backend.bswap32(value >>> 0) >>> 0;
  }
  return bswap32Js(value);
}

function xaddWidthJs(dst, src, widthBits, flags) {
  const width = widthBits === 8 ? 8 : (widthBits === 16 ? 16 : 32);
  const originalDst = widthValueUnsigned(dst, width);
  const originalSrc = widthValueUnsigned(src, width);
  const alu = aluBinaryWidthJs(0, originalDst, originalSrc, width, flags >>> 0);
  return {
    dst: widthValueUnsigned(alu.result, width),
    src: originalDst,
    flags: alu.flags >>> 0
  };
}

function xaddWidth(dst, src, widthBits, flags) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.xaddWidth === "function") {
    return backend.xaddWidth(dst >>> 0, src >>> 0, widthBits >>> 0, flags >>> 0);
  }
  return xaddWidthJs(dst, src, widthBits, flags);
}

function cmpxchgWidthJs(accumulator, source, replacement, widthBits, flags) {
  const width = widthBits === 8 ? 8 : (widthBits === 16 ? 16 : 32);
  const acc = widthValueUnsigned(accumulator, width);
  const src = widthValueUnsigned(source, width);
  const repl = widthValueUnsigned(replacement, width);
  const cmp = aluBinaryWidthJs(7, acc, src, width, flags >>> 0);
  const exchanged = acc === src;
  return {
    result: exchanged ? repl : src,
    accumulator: exchanged ? acc : src,
    exchanged,
    flags: cmp.flags >>> 0
  };
}

function cmpxchgWidth(accumulator, source, replacement, widthBits, flags) {
  const backend = getActiveCpuHelperBackend();
  if (backend && typeof backend.cmpxchgWidth === "function") {
    return backend.cmpxchgWidth(
      accumulator >>> 0,
      source >>> 0,
      replacement >>> 0,
      widthBits >>> 0,
      flags >>> 0
    );
  }
  return cmpxchgWidthJs(accumulator, source, replacement, widthBits, flags);
}

function normalizeCpuBackendMode(mode) {
  return String(mode || "").trim().toLowerCase() === "wasm" ? "wasm" : "js";
}

function getCpuSliceProfile(isBrowserMainThread, backend) {
  if (!isBrowserMainThread) {
    return {
      maxSliceMs: 0,
      backgroundMaxSliceMs: 0,
      preDisplayMaxSliceMs: 0
    };
  }
  if (normalizeCpuBackendMode(backend) === "wasm") {
    return {
      maxSliceMs: 16,
      backgroundMaxSliceMs: 20,
      preDisplayMaxSliceMs: 8
    };
  }
  return {
    maxSliceMs: 8,
    backgroundMaxSliceMs: 12,
    preDisplayMaxSliceMs: 0
  };
}

function getCpuBlockProfile(backend) {
  if (normalizeCpuBackendMode(backend) === "wasm") {
    return {
      basicBlockMaxEntries: 48,
      basicBlockImmediateCacheEntries: 2,
      basicBlockHotThreshold: 2
    };
  }
  return {
    basicBlockMaxEntries: 32,
    basicBlockImmediateCacheEntries: 4,
    basicBlockHotThreshold: 3
  };
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
    this.scratchXmmWordsA = new Uint32Array(4);
    this.scratchXmmWordsB = new Uint32Array(4);
    this.scratchQwordA = new Uint32Array(2);
    this.scratchQwordB = new Uint32Array(2);
    this.scratchBytes16A = new Uint8Array(16);
    this.scratchBytes16B = new Uint8Array(16);
    this.scratchBytes16C = new Uint8Array(16);
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
    this.isBrowserMainThread = !isNodeLike && !isWorkerContext;
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
    this.maxSliceMs = 0;
    this.backgroundMaxSliceMs = 0;
    this.preDisplayMaxSliceMs = 0;
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
    this.basicBlockStartCache = new Map();
    this.basicBlockStartCacheMax = 20000;
    this.basicBlockStartHits = 0;
    this.basicBlockStartMisses = 0;
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
    this.softSimpleBlockPrewarmMaxStarts = 256;
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
    this.applyCpuBackendRuntimeProfile(this.cpuBackend);
    this.resetSkinTheme();
  }

  applyCpuBackendRuntimeProfile(mode) {
    const profile = getCpuSliceProfile(this.isBrowserMainThread, mode);
    this.maxSliceMs = profile.maxSliceMs | 0;
    this.backgroundMaxSliceMs = profile.backgroundMaxSliceMs | 0;
    this.preDisplayMaxSliceMs = profile.preDisplayMaxSliceMs | 0;
    const blockProfile = getCpuBlockProfile(mode);
    this.basicBlockMaxEntries = blockProfile.basicBlockMaxEntries | 0;
    this.basicBlockImmediateCacheEntries = blockProfile.basicBlockImmediateCacheEntries | 0;
    this.basicBlockHotThreshold = blockProfile.basicBlockHotThreshold | 0;
  }

  setCpuBackend(mode) {
    if (this.running || this.cpu) {
      throw new Error("Cannot change CPU backend while the emulator is running.");
    }
    const next = normalizeCpuBackendMode(mode);
    this.requestedCpuBackend = next;
    this.cpuBackend = next;
    this.cpuHelperBackend = null;
    this.applyCpuBackendRuntimeProfile(next);
    return next;
  }

  getCpuBackendInfo() {
    const availability = Emulator.getCpuBackendAvailability();
    return {
      requested: this.requestedCpuBackend,
      active: this.cpuBackend,
      wasmAvailable: !!availability.wasm,
      maxSliceMs: this.maxSliceMs | 0,
      backgroundMaxSliceMs: this.backgroundMaxSliceMs | 0,
      preDisplayMaxSliceMs: this.preDisplayMaxSliceMs | 0,
      basicBlockMaxEntries: this.basicBlockMaxEntries | 0,
      basicBlockImmediateCacheEntries: this.basicBlockImmediateCacheEntries | 0,
      basicBlockHotThreshold: this.basicBlockHotThreshold | 0
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
    this.applyCpuBackendRuntimeProfile(next);
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
    this.basicBlockStartCache.clear();
    this.basicBlockStartHits = 0;
    this.basicBlockStartMisses = 0;
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
      if (typeof this.prewarmSoftBasicBlocks === "function") {
        const prepared = this.prewarmSoftBasicBlocks(
          result.sites,
          this.softSimpleBlockPrewarmMaxStarts | 0
        );
        if (prepared > 0) {
          this.log(`Prewarmed ${prepared} soft basic blocks.`);
        }
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
  installCoreRuntime(Emulator, {
    REG,
    formatHex,
    SIMPLE_BLOCK_OPS,
    SIMPLE_BLOCK_RECORD_WORDS
  });
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
    x87CompareCode,
    shiftPacked64,
    mulFullWidth,
    divideFullWidth,
    x87F2xm1,
    x87Fyl2x,
    x87Tan,
    x87Atan2,
    x87Sqrt,
    x87Sin,
    x87Cos,
    x87SinCos,
    x87Scale,
    sseSqrt,
    sseReciprocal,
    sseReciprocalSqrt,
    sseBinaryFloat,
    sseCompareCode,
    sseUnaryFloat32x4,
    sseBinaryFloat32x4,
    sseBinaryFloat32Bits,
    sseCompare32x4,
    cvtdq2ps32x4,
    haddps32x4,
    updateLogicFlagsWidth,
    updateAddFlags,
    updateAdcFlags,
    updateSubFlags,
    updateSbbFlags,
    aluBinaryWidth,
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
    packedOp32x2,
    packedOp32x4,
    punpckldq32x4,
    pshufw64,
    movmskBytes64,
    movmskBytes128,
    movmskFloat32x4,
    shufps32x4,
    bswap32,
    xaddWidth,
    cmpxchgWidth,
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

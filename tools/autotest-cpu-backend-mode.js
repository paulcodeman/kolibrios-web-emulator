const { loadKosRuntime } = require("./ui-harness");

const runtime = loadKosRuntime();
const { Emulator, createHeadlessSurface } = runtime;
const emuApi = global.KosEmu && global.KosEmu.emu ? global.KosEmu.emu : null;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEq(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertDeepEq(actual, expected, message) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) {
    throw new Error(`${message}: expected ${right}, got ${left}`);
  }
}

function assertClose(actual, expected, epsilon, message) {
  if (Number.isNaN(actual) && Number.isNaN(expected)) {
    return;
  }
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) {
    if (Object.is(actual, expected) || actual === expected) {
      return;
    }
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
  const scale = Math.max(1, Math.abs(actual), Math.abs(expected));
  if (Math.abs(actual - expected) > epsilon * scale) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertSameFloat(actual, expected, epsilon, message) {
  if (Object.is(actual, expected)) {
    return;
  }
  if ((actual === 0 || expected === 0) || !Number.isFinite(actual) || !Number.isFinite(expected)) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
  assertClose(actual, expected, epsilon, message);
}

function createLcg(seed) {
  let state = seed >>> 0;
  return function next() {
    state = ((state * 1664525) + 1013904223) >>> 0;
    return state >>> 0;
  };
}

try {
  assertEq(Emulator.normalizeCpuBackendMode("js"), "js", "js mode should stay js");
  assertEq(Emulator.normalizeCpuBackendMode("WASM"), "wasm", "wasm mode should normalize case-insensitively");
  assertEq(Emulator.normalizeCpuBackendMode("weird"), "js", "unknown backend should normalize to js");

  const availability = Emulator.getCpuBackendAvailability();
  assert(availability && availability.js === true, "js backend should always be available");
  assert(availability && availability.wasm === true, "wasm backend should be available after build");
  assert(emuApi && typeof emuApi.createJsCpuHelperBackend === "function", "js helper backend factory should be exposed");
  assert(emuApi && typeof emuApi.createWasmCpuBackend === "function", "wasm helper backend factory should be exposed");

  const jsBackend = emuApi.createJsCpuHelperBackend();
  const wasmBackend = emuApi.createWasmCpuBackend();
  assert(jsBackend && jsBackend.kind === "js", "js helper backend should identify itself");
  assert(wasmBackend && wasmBackend.kind === "wasm", "wasm helper backend should identify itself");
  assertEq(wasmBackend.apiVersion, 1, "wasm helper backend api should match build");
  assert(typeof wasmBackend.psubusb32 === "function", "wasm helper backend should expose MMX helpers");
  assert(typeof wasmBackend.roundTiesToEven === "function", "wasm helper backend should expose x87 helpers");
  assert(typeof wasmBackend.evalJccCondition === "function", "wasm helper backend should expose Jcc helpers");
  assert(typeof wasmBackend.x87PackedBcdToNumber === "function", "wasm helper backend should expose packed BCD helpers");
  assert(typeof wasmBackend.bitScan === "function", "wasm helper backend should expose bit scan helpers");
  assert(typeof wasmBackend.bitTestModify === "function", "wasm helper backend should expose bit test helpers");
  assert(typeof wasmBackend.imulSignedWidth === "function", "wasm helper backend should expose IMUL helpers");
  assert(typeof wasmBackend.x87CompareCode === "function", "wasm helper backend should expose x87 compare helpers");
  assert(typeof wasmBackend.shiftPacked64 === "function", "wasm helper backend should expose 64-bit shift helpers");
  assert(typeof wasmBackend.mulFullWidth === "function", "wasm helper backend should expose full-width multiply helpers");
  assert(typeof wasmBackend.divideFullWidth === "function", "wasm helper backend should expose full-width divide helpers");
  assert(typeof wasmBackend.x87F2xm1 === "function", "wasm helper backend should expose x87 transcendental helpers");
  assert(typeof wasmBackend.sseSqrt === "function", "wasm helper backend should expose SSE sqrt helpers");
  assert(typeof wasmBackend.sseBinaryFloat === "function", "wasm helper backend should expose SSE binary float helpers");
  assert(typeof wasmBackend.sseCompareCode === "function", "wasm helper backend should expose SSE compare helpers");
  assert(typeof wasmBackend.packedOp32x2 === "function", "wasm helper backend should expose packed 64-bit logical helpers");
  assert(typeof wasmBackend.packedOp32x4 === "function", "wasm helper backend should expose packed 128-bit logical helpers");
  assert(typeof wasmBackend.punpckldq32x4 === "function", "wasm helper backend should expose punpckldq helpers");
  assert(typeof wasmBackend.pshufw64 === "function", "wasm helper backend should expose pshufw helpers");
  assert(typeof wasmBackend.movmskBytes64 === "function", "wasm helper backend should expose 64-bit movemask helpers");
  assert(typeof wasmBackend.movmskBytes128 === "function", "wasm helper backend should expose 128-bit movemask helpers");
  assert(typeof wasmBackend.movmskFloat32x4 === "function", "wasm helper backend should expose float movemask helpers");
  assert(typeof wasmBackend.shufps32x4 === "function", "wasm helper backend should expose shufps helpers");

  const nextRand = createLcg(0x4b1d5e77);
  const widths = [8, 16, 32];
  const flagSeeds = [0, 1, 0x40, 0x80, 0x801, 0xffffffff];
  const rotateModes = [0, 1, 2, 3, 4, 5, 6, 7];
  const mmxUnaryCountLimits = [0, 1, 7, 8, 15, 16, 17, 31, 32, 255];

  for (const value of [0, 1, 2, 3, 0x7f, 0x80, 0xff, 0x12345678, 0xffffffff]) {
    assertEq(
      wasmBackend.parityEven8(value),
      jsBackend.parityEven8(value),
      `parityEven8 should match for 0x${(value >>> 0).toString(16)}`
    );
  }

  for (const value of [-3.5, -2.5, -1.6, -1.5, -0.5, 0, 0.5, 1.5, 2.5, 3.5, 123456.5, -123456.5, Number.POSITIVE_INFINITY, Number.NaN]) {
    assertEq(
      wasmBackend.roundTiesToEven(value),
      jsBackend.roundTiesToEven(value),
      `roundTiesToEven should match for ${String(value)}`
    );
    assertEq(
      wasmBackend.x87StoreIntegerValue(value, false),
      jsBackend.x87StoreIntegerValue(value, false),
      `x87StoreIntegerValue(false) should match for ${String(value)}`
    );
    assertEq(
      wasmBackend.x87StoreIntegerValue(value, true),
      jsBackend.x87StoreIntegerValue(value, true),
      `x87StoreIntegerValue(true) should match for ${String(value)}`
    );
  }

  for (const [left, right] of [
    [1, 0],
    [0, 1],
    [5, 5],
    [Number.NaN, 1],
    [1, Number.NaN],
    [-0, 0],
    [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]
  ]) {
    assertEq(
      wasmBackend.x87CompareCode(left, right),
      jsBackend.x87CompareCode(left, right),
      `x87CompareCode should match for ${String(left)} vs ${String(right)}`
    );
  }

  for (const value of [-2, -1, -0.5, 0, 0.25, 0.5, 1, 2, Math.PI / 6, Math.PI / 3]) {
    assertClose(wasmBackend.x87F2xm1(value), jsBackend.x87F2xm1(value), 1e-12, `x87F2xm1 should match for ${value}`);
    assertClose(wasmBackend.x87Tan(value), jsBackend.x87Tan(value), 1e-12, `x87Tan should match for ${value}`);
    assertClose(wasmBackend.x87Sqrt(Math.abs(value)), jsBackend.x87Sqrt(Math.abs(value)), 1e-12, `x87Sqrt should match for ${value}`);
    assertClose(wasmBackend.x87Sin(value), jsBackend.x87Sin(value), 1e-12, `x87Sin should match for ${value}`);
    assertClose(wasmBackend.x87Cos(value), jsBackend.x87Cos(value), 1e-12, `x87Cos should match for ${value}`);
    const wasmSinCos = wasmBackend.x87SinCos(value);
    const jsSinCos = jsBackend.x87SinCos(value);
    assertClose(wasmSinCos.sin, jsSinCos.sin, 1e-12, `x87SinCos.sin should match for ${value}`);
    assertClose(wasmSinCos.cos, jsSinCos.cos, 1e-12, `x87SinCos.cos should match for ${value}`);
  }
  for (const [y, x] of [[1, 2], [2, 1], [-1, 3], [3, -1], [0.5, 0.25]]) {
    assertClose(wasmBackend.x87Fyl2x(y, x), jsBackend.x87Fyl2x(y, x), 1e-12, `x87Fyl2x should match for ${y},${x}`);
    assertClose(wasmBackend.x87Atan2(y, x), jsBackend.x87Atan2(y, x), 1e-12, `x87Atan2 should match for ${y},${x}`);
    assertClose(wasmBackend.x87Scale(y, x), jsBackend.x87Scale(y, x), 1e-12, `x87Scale should match for ${y},${x}`);
  }
  for (const value of [-1, 0, 0.25, 1, 4, 16, Number.POSITIVE_INFINITY]) {
    assertClose(wasmBackend.sseSqrt(value), jsBackend.sseSqrt(value), 1e-12, `sseSqrt should match for ${value}`);
    assertClose(wasmBackend.sseReciprocal(value), jsBackend.sseReciprocal(value), 1e-12, `sseReciprocal should match for ${value}`);
    assertClose(wasmBackend.sseReciprocalSqrt(value), jsBackend.sseReciprocalSqrt(value), 1e-12, `sseReciprocalSqrt should match for ${value}`);
  }
  for (const [left, right] of [
    [1, 2],
    [-3, 5],
    [5, -3],
    [0, 0],
    [-0, 0],
    [0, -0],
    [-0, -0],
    [Number.POSITIVE_INFINITY, 2],
    [2, Number.NEGATIVE_INFINITY],
    [Number.NaN, 1],
    [1, Number.NaN]
  ]) {
    for (const op of [0, 1, 2, 3, 4, 5]) {
      assertSameFloat(
        wasmBackend.sseBinaryFloat(left, right, op),
        jsBackend.sseBinaryFloat(left, right, op),
        1e-12,
        `sseBinaryFloat should match for op=${op}, left=${String(left)}, right=${String(right)}`
      );
    }
  }
  for (const [left, right] of [
    [1, 2],
    [2, 1],
    [1, 1],
    [-0, 0],
    [0, -0],
    [Number.NaN, 1],
    [1, Number.NaN],
    [Number.POSITIVE_INFINITY, 1],
    [1, Number.NEGATIVE_INFINITY]
  ]) {
    assertEq(
      wasmBackend.sseCompareCode(left, right),
      jsBackend.sseCompareCode(left, right),
      `sseCompareCode should match for left=${String(left)}, right=${String(right)}`
    );
  }

  const bcdVectors = [
    { bytes: Uint8Array.from([0x45, 0x23, 0x01, 0, 0, 0, 0, 0, 0, 0x00]), number: 12345 },
    { bytes: Uint8Array.from([0x89, 0x67, 0x45, 0x23, 0x01, 0, 0, 0, 0, 0x80]), number: -123456789 },
    { bytes: Uint8Array.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80]), number: -0 }
  ];
  for (const vector of bcdVectors) {
    assertEq(
      wasmBackend.x87PackedBcdToNumber(vector.bytes),
      jsBackend.x87PackedBcdToNumber(vector.bytes),
      `x87PackedBcdToNumber should match for ${Array.from(vector.bytes).join(",")}`
    );
    assertEq(
      wasmBackend.x87PackedBcdToNumber(vector.bytes),
      vector.number,
      `x87PackedBcdToNumber should decode expected value for ${Array.from(vector.bytes).join(",")}`
    );
  }

  for (const value of [-987654321, -12345.5, -0, 0, 42, 123456789012345, 999999999999999999]) {
    assertDeepEq(
      Array.from(wasmBackend.x87NumberToPackedBcd(value)),
      Array.from(jsBackend.x87NumberToPackedBcd(value)),
      `x87NumberToPackedBcd should match for ${String(value)}`
    );
  }

  for (const width of widths) {
    for (const seedFlags of flagSeeds) {
      for (let i = 0; i < 80; i += 1) {
        const flags = (seedFlags ^ nextRand()) >>> 0;
        const op1 = nextRand();
        const op2 = nextRand();
        const result = nextRand();
        const carry = nextRand() & 1;
        assertEq(
          wasmBackend.updateLogicFlagsWidth(flags, result, width),
          jsBackend.updateLogicFlagsWidth(flags, result, width),
          `updateLogicFlagsWidth should match for width ${width}`
        );
        assertEq(
          wasmBackend.updateAddFlags(flags, op1, op2, result, width),
          jsBackend.updateAddFlags(flags, op1, op2, result, width),
          `updateAddFlags should match for width ${width}`
        );
        assertEq(
          wasmBackend.updateAdcFlags(flags, op1, op2, carry, result, width),
          jsBackend.updateAdcFlags(flags, op1, op2, carry, result, width),
          `updateAdcFlags should match for width ${width}`
        );
        assertEq(
          wasmBackend.updateSubFlags(flags, op1, op2, result, width),
          jsBackend.updateSubFlags(flags, op1, op2, result, width),
          `updateSubFlags should match for width ${width}`
        );
        assertEq(
          wasmBackend.updateSbbFlags(flags, op1, op2, carry, result, width),
          jsBackend.updateSbbFlags(flags, op1, op2, carry, result, width),
          `updateSbbFlags should match for width ${width}`
        );
      }
    }
  }

  const jccFlagVectors = [0, 1, 0x40, 0x80, 0x800, 0x884, 0xffffffff];
  for (const flags of jccFlagVectors) {
    for (let cc = 0; cc < 16; cc += 1) {
      assertEq(
        wasmBackend.evalJccCondition(cc, flags),
        jsBackend.evalJccCondition(cc, flags),
        `evalJccCondition should match for cc=${cc}, flags=0x${flags.toString(16)}`
      );
    }
  }
  for (let i = 0; i < 200; i += 1) {
    const flags = nextRand();
    const cc = nextRand() & 0xf;
    assertEq(
      wasmBackend.evalJccCondition(cc, flags),
      jsBackend.evalJccCondition(cc, flags),
      `evalJccCondition should match for random cc=${cc}, flags=0x${flags.toString(16)}`
    );
  }

  for (const width of [16, 32]) {
    for (const value of [0, 1, 2, 0x10, 0x8000, 0x80000000, 0xffffffff]) {
      for (const reverse of [false, true]) {
        assertDeepEq(
          wasmBackend.bitScan(value, reverse, width),
          jsBackend.bitScan(value, reverse, width),
          `bitScan should match for width=${width}, reverse=${reverse}, value=0x${(value >>> 0).toString(16)}`
        );
      }
    }
    for (let i = 0; i < 120; i += 1) {
      const value = nextRand();
      const reverse = (nextRand() & 1) !== 0;
      assertDeepEq(
        wasmBackend.bitScan(value, reverse, width),
        jsBackend.bitScan(value, reverse, width),
        `bitScan should match for random width=${width}, reverse=${reverse}`
      );
    }
  }

  for (const width of [16, 32]) {
    for (const op of [4, 5, 6, 7]) {
      for (let i = 0; i < 160; i += 1) {
        const value = nextRand();
        const bitIndex = nextRand();
        const flags = nextRand();
        assertDeepEq(
          wasmBackend.bitTestModify(value, bitIndex, width, op, flags),
          jsBackend.bitTestModify(value, bitIndex, width, op, flags),
          `bitTestModify should match for width=${width}, op=${op}`
        );
      }
    }
  }

  for (const width of [16, 32]) {
    for (let i = 0; i < 200; i += 1) {
      const left = nextRand();
      const right = nextRand();
      const flags = nextRand();
      assertDeepEq(
        wasmBackend.imulSignedWidth(left, right, width, flags),
        jsBackend.imulSignedWidth(left, right, width, flags),
        `imulSignedWidth should match for width=${width}`
      );
    }
  }

  for (const count of [0, 1, 7, 8, 15, 31, 32, 33, 63, 64, 80]) {
    const lo = nextRand();
    const hi = nextRand();
    for (const leftShift of [false, true]) {
      assertDeepEq(
        wasmBackend.shiftPacked64(lo, hi, count, leftShift),
        jsBackend.shiftPacked64(lo, hi, count, leftShift),
        `shiftPacked64 should match for count=${count}, left=${leftShift}`
      );
    }
  }

  for (let i = 0; i < 120; i += 1) {
    const a = nextRand();
    const b = nextRand();
    assertEq(wasmBackend.psubusb32(a, b), jsBackend.psubusb32(a, b), "psubusb32 should match");
    assertEq(wasmBackend.psubusw32(a, b), jsBackend.psubusw32(a, b), "psubusw32 should match");
    assertEq(wasmBackend.pavgb32(a, b), jsBackend.pavgb32(a, b), "pavgb32 should match");
    assertEq(wasmBackend.paddw32(a, b), jsBackend.paddw32(a, b), "paddw32 should match");
    assertEq(wasmBackend.psubsw32(a, b), jsBackend.psubsw32(a, b), "psubsw32 should match");
    assertEq(wasmBackend.pmullw32(a, b), jsBackend.pmullw32(a, b), "pmullw32 should match");
  }

  for (let i = 0; i < 120; i += 1) {
    const a = nextRand();
    const count = mmxUnaryCountLimits[i % mmxUnaryCountLimits.length] ^ (nextRand() & 7);
    assertEq(wasmBackend.psrlw32(a, count), jsBackend.psrlw32(a, count), "psrlw32 should match");
    assertEq(wasmBackend.psraw32(a, count), jsBackend.psraw32(a, count), "psraw32 should match");
    assertEq(wasmBackend.psllw32(a, count), jsBackend.psllw32(a, count), "psllw32 should match");
    assertEq(wasmBackend.psrld32(a, count), jsBackend.psrld32(a, count), "psrld32 should match");
    assertEq(wasmBackend.psrad32(a, count), jsBackend.psrad32(a, count), "psrad32 should match");
    assertEq(wasmBackend.pslld32(a, count), jsBackend.pslld32(a, count), "pslld32 should match");
  }

  for (let i = 0; i < 120; i += 1) {
    const dstLo = nextRand();
    const dstHi = nextRand();
    const srcLo = nextRand();
    const srcHi = nextRand();
    assertDeepEq(
      wasmBackend.packsswb64(dstLo, dstHi, srcLo, srcHi),
      jsBackend.packsswb64(dstLo, dstHi, srcLo, srcHi),
      "packsswb64 should match"
    );
    assertDeepEq(
      wasmBackend.packuswb64(dstLo, dstHi, srcLo, srcHi),
      jsBackend.packuswb64(dstLo, dstHi, srcLo, srcHi),
      "packuswb64 should match"
    );
    assertDeepEq(
      wasmBackend.packssdw64(dstLo, dstHi, srcLo, srcHi),
      jsBackend.packssdw64(dstLo, dstHi, srcLo, srcHi),
      "packssdw64 should match"
    );
    assertDeepEq(
      wasmBackend.punpcklbw64(dstLo, srcLo),
      jsBackend.punpcklbw64(dstLo, srcLo),
      "punpcklbw64 should match"
    );
    assertDeepEq(
      wasmBackend.punpckhbw64(dstHi, srcHi),
      jsBackend.punpckhbw64(dstHi, srcHi),
      "punpckhbw64 should match"
    );
    assertDeepEq(
      wasmBackend.punpcklwd64(dstLo, srcLo),
      jsBackend.punpcklwd64(dstLo, srcLo),
      "punpcklwd64 should match"
    );
    assertDeepEq(
      wasmBackend.punpckhwd64(dstHi, srcHi),
      jsBackend.punpckhwd64(dstHi, srcHi),
      "punpckhwd64 should match"
    );
  }

  for (const op of [0, 1, 2, 3, 4]) {
    assertDeepEq(
      wasmBackend.packedOp32x2(0x12345678, 0xffffffff, 0x00ff00ff, 0x12345678, op),
      jsBackend.packedOp32x2(0x12345678, 0xffffffff, 0x00ff00ff, 0x12345678, op),
      `packedOp32x2 should match for op ${op}`
    );
    assertDeepEq(
      wasmBackend.packedOp32x4(0, 0xffffffff, 0x12345678, 0x80000000, 0xffffffff, 0x12345678, 0x12345678, 0x7fffffff, op),
      jsBackend.packedOp32x4(0, 0xffffffff, 0x12345678, 0x80000000, 0xffffffff, 0x12345678, 0x12345678, 0x7fffffff, op),
      `packedOp32x4 should match for op ${op}`
    );
  }

  for (const imm of [0x00, 0x1b, 0x4e, 0x93, 0xff]) {
    assertDeepEq(
      wasmBackend.pshufw64(0x11223344, 0x55667788, imm),
      jsBackend.pshufw64(0x11223344, 0x55667788, imm),
      `pshufw64 should match for imm ${imm}`
    );
    assertDeepEq(
      wasmBackend.shufps32x4(0x3f800000, 0x40000000, 0x40400000, 0x40800000, 0xbf800000, 0xc0000000, 0xc0400000, 0xc0800000, imm),
      jsBackend.shufps32x4(0x3f800000, 0x40000000, 0x40400000, 0x40800000, 0xbf800000, 0xc0000000, 0xc0400000, 0xc0800000, imm),
      `shufps32x4 should match for imm ${imm}`
    );
  }

  for (const [lo, hi] of [
    [0, 0],
    [0xffffffff, 0],
    [0x80808080, 0x7f7f7f7f],
    [0x11223344, 0x55667788]
  ]) {
    assertEq(wasmBackend.movmskBytes64(lo, hi), jsBackend.movmskBytes64(lo, hi), "movmskBytes64 should match");
  }
  for (const [v0, v1, v2, v3] of [
    [0, 0, 0, 0],
    [0x80000000, 0, 0xffffffff, 0x7fffffff],
    [0x80808080, 0x7f7f7f7f, 0xff00ff00, 0x00ff00ff],
    [0x11223344, 0x55667788, 0x99aabbcc, 0xddeeff00]
  ]) {
    assertEq(wasmBackend.movmskBytes128(v0, v1, v2, v3), jsBackend.movmskBytes128(v0, v1, v2, v3), "movmskBytes128 should match");
    assertEq(wasmBackend.movmskFloat32x4(v0, v1, v2, v3), jsBackend.movmskFloat32x4(v0, v1, v2, v3), "movmskFloat32x4 should match");
  }
  for (let i = 0; i < 120; i += 1) {
    const dst0 = nextRand();
    const dst1 = nextRand();
    const dst2 = nextRand();
    const dst3 = nextRand();
    const src0 = nextRand();
    const src1 = nextRand();
    const src2 = nextRand();
    const src3 = nextRand();
    const imm = nextRand() & 0xff;
    assertDeepEq(
      wasmBackend.punpckldq32x4(dst0, dst1, src0, src1),
      jsBackend.punpckldq32x4(dst0, dst1, src0, src1),
      "punpckldq32x4 should match"
    );
    assertDeepEq(
      wasmBackend.pshufw64(dst0, dst1, imm),
      jsBackend.pshufw64(dst0, dst1, imm),
      "pshufw64 random should match"
    );
    assertEq(
      wasmBackend.movmskBytes64(dst0, dst1),
      jsBackend.movmskBytes64(dst0, dst1),
      "movmskBytes64 random should match"
    );
    assertEq(
      wasmBackend.movmskBytes128(dst0, dst1, dst2, dst3),
      jsBackend.movmskBytes128(dst0, dst1, dst2, dst3),
      "movmskBytes128 random should match"
    );
    assertEq(
      wasmBackend.movmskFloat32x4(dst0, dst1, dst2, dst3),
      jsBackend.movmskFloat32x4(dst0, dst1, dst2, dst3),
      "movmskFloat32x4 random should match"
    );
    assertDeepEq(
      wasmBackend.shufps32x4(dst0, dst1, dst2, dst3, src0, src1, src2, src3, imm),
      jsBackend.shufps32x4(dst0, dst1, dst2, dst3, src0, src1, src2, src3, imm),
      "shufps32x4 random should match"
    );
  }

  for (let i = 0; i < 120; i += 1) {
    const dstLo = nextRand();
    const dstHi = nextRand();
    const srcLo = nextRand();
    const srcHi = nextRand();
    const op = nextRand() % 5;
    const dst2 = nextRand();
    const dst3 = nextRand();
    const src2 = nextRand();
    const src3 = nextRand();
    assertDeepEq(
      wasmBackend.packedOp32x2(dstLo, dstHi, srcLo, srcHi, op),
      jsBackend.packedOp32x2(dstLo, dstHi, srcLo, srcHi, op),
      `packedOp32x2 should match for op ${op}`
    );
    assertDeepEq(
      wasmBackend.packedOp32x4(dstLo, dstHi, dst2, dst3, srcLo, srcHi, src2, src3, op),
      jsBackend.packedOp32x4(dstLo, dstHi, dst2, dst3, srcLo, srcHi, src2, src3, op),
      `packedOp32x4 should match for op ${op}`
    );
  }

  for (const width of widths) {
    for (const mode of rotateModes) {
      for (let count = 0; count <= 33; count += 1) {
        const value = nextRand();
        const flags = nextRand();
        assertDeepEq(
          wasmBackend.shiftRotate(value, count, width, mode, flags),
          jsBackend.shiftRotate(value, count, width, mode, flags),
          `shiftRotate should match for width ${width}, mode ${mode}, count ${count}`
        );
      }
    }
    for (const leftShift of [false, true]) {
      for (let count = 0; count <= 33; count += 1) {
        const value = nextRand();
        const source = nextRand();
        const flags = nextRand();
        assertDeepEq(
          wasmBackend.doubleShift(value, source, count, width, leftShift, flags),
          jsBackend.doubleShift(value, source, count, width, leftShift, flags),
          `doubleShift should match for width ${width}, count ${count}, left=${leftShift}`
        );
      }
    }
  }

  for (const width of [16, 32]) {
    for (const signed of [false, true]) {
      for (let i = 0; i < 160; i += 1) {
        const left = nextRand();
        const right = nextRand();
        const flags = nextRand();
        assertDeepEq(
          wasmBackend.mulFullWidth(left, right, width, signed, flags),
          jsBackend.mulFullWidth(left, right, width, signed, flags),
          `mulFullWidth should match for width=${width}, signed=${signed}`
        );
      }
    }
  }

  const divVectors = [
    { high: 0, low: 100, divisor: 3, width: 16, signed: false },
    { high: 0xffff, low: 0xff9c, divisor: 0xfffe, width: 16, signed: true },
    { high: 1, low: 0, divisor: 2, width: 32, signed: false },
    { high: 0xffffffff, low: 0xffffff9c, divisor: 0xfffffffe, width: 32, signed: true },
    { high: 0, low: 1, divisor: 0, width: 32, signed: false }
  ];
  for (const vector of divVectors) {
    assertDeepEq(
      wasmBackend.divideFullWidth(vector.high, vector.low, vector.divisor, vector.width, vector.signed),
      jsBackend.divideFullWidth(vector.high, vector.low, vector.divisor, vector.width, vector.signed),
      `divideFullWidth should match for width=${vector.width}, signed=${vector.signed}`
    );
  }
  for (const width of [16, 32]) {
    for (const signed of [false, true]) {
      for (let i = 0; i < 180; i += 1) {
        const high = nextRand();
        const low = nextRand();
        const divisor = (i % 17 === 0) ? 0 : nextRand();
        assertDeepEq(
          wasmBackend.divideFullWidth(high, low, divisor, width, signed),
          jsBackend.divideFullWidth(high, low, divisor, width, signed),
          `divideFullWidth should match for width=${width}, signed=${signed}`
        );
      }
    }
  }

  const jsEmulator = new Emulator(createHeadlessSurface(8, 8), () => {}, { cpuBackend: "js" });
  assertEq(jsEmulator.getCpuBackendInfo().requested, "js", "constructor should store requested js backend");
  assertEq(jsEmulator.setCpuBackend("wasm"), "wasm", "setCpuBackend should accept wasm requests before launch");
  assertEq(jsEmulator.ensureCpuBackendReady(), "wasm", "wasm backend should become active");
  assert(jsEmulator.cpuHelperBackend && jsEmulator.cpuHelperBackend.kind === "wasm", "emulator should bind wasm helper backend");
  assertEq(jsEmulator.setCpuBackend("js"), "js", "backend should switch back to js before launch");

  console.log("Autotest OK: CPU backend mode exposes working JS/WASM helper backends and matches JS semantics.");
} catch (err) {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(2);
}

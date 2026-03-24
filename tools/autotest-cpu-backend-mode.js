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

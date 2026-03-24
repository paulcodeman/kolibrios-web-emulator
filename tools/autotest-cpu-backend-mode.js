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

  const nextRand = createLcg(0x4b1d5e77);
  const widths = [8, 16, 32];
  const flagSeeds = [0, 1, 0x40, 0x80, 0x801, 0xffffffff];
  const rotateModes = [0, 1, 2, 3, 4, 5, 6, 7];

  for (const value of [0, 1, 2, 3, 0x7f, 0x80, 0xff, 0x12345678, 0xffffffff]) {
    assertEq(
      wasmBackend.parityEven8(value),
      jsBackend.parityEven8(value),
      `parityEven8 should match for 0x${(value >>> 0).toString(16)}`
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

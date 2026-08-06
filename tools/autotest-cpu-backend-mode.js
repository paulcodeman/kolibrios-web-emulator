const { loadKosRuntime } = require("./ui-harness");

const runtime = loadKosRuntime();
const { Emulator, createHeadlessSurface } = runtime;
const emuApi = global.KosEmu && global.KosEmu.emu ? global.KosEmu.emu : null;
const loaderApi = global.KosEmu && global.KosEmu.core ? global.KosEmu.core.loader : null;
const REG_EAX = 0;
const REG_ECX = 1;
const REG_EDX = 2;
const REG_EBX = 3;
const REG_ESP = 4;
const REG_EBP = 5;
const REG_ESI = 6;
const REG_EDI = 7;
const REG_EIP = 8;
const REG_EFLAGS = 9;

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

const f32BitcastBuffer = new ArrayBuffer(4);
const f32BitcastF32 = new Float32Array(f32BitcastBuffer);
const f32BitcastU32 = new Uint32Array(f32BitcastBuffer);

function numberToF32Bits(value) {
  f32BitcastF32[0] = Math.fround(Number(value));
  return f32BitcastU32[0] >>> 0;
}

function createInstructionEmulator(cpuBackend) {
  const surface = createHeadlessSurface(8, 8);
  const emulator = new Emulator(surface, () => {}, { cpuBackend });
  const mem = new Uint8Array(0x2000);
  const regs = new Uint32Array(10);
  regs[REG_ESP] = 0x1800;
  regs[REG_EFLAGS] = 0x202;
  emulator.running = true;
  emulator.cpu = {
    mem,
    view: new DataView(mem.buffer),
    u32: new Uint32Array(mem.buffer),
    regs,
    fpu: new Float64Array(8),
    fpuSize: 0,
    fpuTop: 0,
    fpuStatusWord: 0,
    mmx: new Uint32Array(16),
    xmm: new Uint32Array(32),
    xmmF: new Float32Array(new ArrayBuffer(32 * 4)),
    memFaultLogged: false
  };
  emulator.ensureCpuBackendReady();
  return emulator;
}

function runInstructionScenario(cpuBackend, bytes, setup) {
  const emulator = createInstructionEmulator(cpuBackend);
  for (let i = 0; i < bytes.length; i += 1) {
    emulator.writeMem8(i, bytes[i] & 0xff);
  }
  if (typeof setup === "function") {
    setup(emulator);
  }
  emulator.writeReg(REG_EIP, 0);
  const ok = !!emulator.executeBasicInstruction(0);
  return {
    ok,
    eip: emulator.readReg(REG_EIP) >>> 0,
    eflags: emulator.readReg(REG_EFLAGS) >>> 0,
    eax: emulator.readReg(REG_EAX) >>> 0,
    ecx: emulator.readReg(REG_ECX) >>> 0,
    edx: emulator.readReg(REG_EDX) >>> 0,
    ebx: emulator.readReg(REG_EBX) >>> 0,
    esi: emulator.readReg(REG_ESI) >>> 0,
    edi: emulator.readReg(REG_EDI) >>> 0,
    mem0: emulator.readMem32(0) >>> 0,
    mem4: emulator.readMem32(4) >>> 0,
    mem8: emulator.readMem32(8) >>> 0,
    xmm0: [
      emulator.readXmmU32(0, 0) >>> 0,
      emulator.readXmmU32(0, 1) >>> 0,
      emulator.readXmmU32(0, 2) >>> 0,
      emulator.readXmmU32(0, 3) >>> 0
    ],
    xmm1: [
      emulator.readXmmU32(1, 0) >>> 0,
      emulator.readXmmU32(1, 1) >>> 0,
      emulator.readXmmU32(1, 2) >>> 0,
      emulator.readXmmU32(1, 3) >>> 0
    ]
  };
}

function captureBlockState(emulator, block) {
  const esp = emulator.readReg(REG_ESP) >>> 0;
  const stackPrev = esp >= 4 ? emulator.readMem32((esp - 4) >>> 0) >>> 0 : 0;
  return {
    eip: emulator.readReg(REG_EIP) >>> 0,
    eflags: emulator.readReg(REG_EFLAGS) >>> 0,
    eax: emulator.readReg(REG_EAX) >>> 0,
    ecx: emulator.readReg(REG_ECX) >>> 0,
    edx: emulator.readReg(REG_EDX) >>> 0,
    ebx: emulator.readReg(REG_EBX) >>> 0,
    esp,
    esi: emulator.readReg(REG_ESI) >>> 0,
    edi: emulator.readReg(REG_EDI) >>> 0,
    stackPrev,
    entries: block && block.entries ? block.entries.length >>> 0 : 0,
    simplePlanWords: block && block.simplePlan ? block.simplePlan.wordCount >>> 0 : 0
  };
}

function runCachedBlockScenario(cpuBackend, bytes, setup, options) {
  const emulator = createInstructionEmulator(cpuBackend);
  for (let i = 0; i < bytes.length; i += 1) {
    emulator.writeMem8(i, bytes[i] & 0xff);
  }
  const opts = options || {};
  if (!opts.skipSoftScan && loaderApi && typeof loaderApi.scanSoftOps === "function") {
    const scan = loaderApi.scanSoftOps(emulator.cpu.mem, 0, bytes.length);
    emulator.softInstructionSites = scan && scan.sites instanceof Map ? scan.sites : new Map();
  }
  if (typeof setup === "function") {
    setup(emulator);
  }
  const initialRegs = Array.from(emulator.cpu.regs);
  emulator.writeReg(REG_EIP, 0);
  const built = emulator.executeAndBuildBasicBlock(0, 64);
  const block = emulator.basicBlockCache.get(0) || null;
  const linearState = captureBlockState(emulator, block);
  emulator.cpu.regs.set(initialRegs);
  if (typeof opts.reset === "function") {
    opts.reset(emulator);
  }
  emulator.writeReg(REG_EIP, 0);
  const cached = emulator.executeCachedBasicBlock(0, 64);
  const cachedState = captureBlockState(emulator, block);
  emulator.cpu.regs.set(initialRegs);
  if (typeof opts.reset === "function") {
    opts.reset(emulator);
  }
  emulator.writeReg(REG_EIP, 0);
  const cachedAgain = emulator.executeCachedBasicBlock(0, 64);
  const cachedAgainState = captureBlockState(emulator, block);
  return {
    built: built >>> 0,
    cached: cached >>> 0,
    cachedAgain: cachedAgain >>> 0,
    hasSimplePlan: !!(block && block.simplePlan),
    hasPreparedPlan: !!(block && block.simplePlan && block.simplePlan.prepared),
    linearState,
    cachedState,
    cachedAgainState
  };
}

function runPrewarmedSoftBlockScenario(cpuBackend, bytes, setup) {
  const emulator = createInstructionEmulator(cpuBackend);
  for (let i = 0; i < bytes.length; i += 1) {
    emulator.writeMem8(i, bytes[i] & 0xff);
  }
  if (loaderApi && typeof loaderApi.scanSoftOps === "function") {
    const scan = loaderApi.scanSoftOps(emulator.cpu.mem, 0, bytes.length);
    emulator.softInstructionSites = scan && scan.sites instanceof Map ? scan.sites : new Map();
  }
  if (typeof setup === "function") {
    setup(emulator);
  }
  const prepared = typeof emulator.prewarmSoftBasicBlocks === "function"
    ? (emulator.prewarmSoftBasicBlocks(emulator.softInstructionSites, 64) >>> 0)
    : 0;
  const block = emulator.basicBlockCache.get(0) || null;
  emulator.writeReg(REG_EIP, 0);
  const cached = emulator.executeCachedBasicBlock(0, 64);
  return {
    prepared,
    cached,
    hasBlock: !!block,
    hasPreparedPlan: !!(block && block.simplePlan && block.simplePlan.prepared),
    state: captureBlockState(emulator, block)
  };
}

function runHotSingleEntryCacheScenario(cpuBackend, bytes, setup) {
  const emulator = createInstructionEmulator(cpuBackend);
  for (let i = 0; i < bytes.length; i += 1) {
    emulator.writeMem8(i, bytes[i] & 0xff);
  }
  if (loaderApi && typeof loaderApi.scanSoftOps === "function") {
    const scan = loaderApi.scanSoftOps(emulator.cpu.mem, 0, bytes.length);
    emulator.softInstructionSites = scan && scan.sites instanceof Map ? scan.sites : new Map();
  }
  if (typeof setup === "function") {
    setup(emulator);
  }
  const initialRegs = Array.from(emulator.cpu.regs);
  emulator.writeReg(REG_EIP, 0);
  const builtFirst = emulator.executeAndBuildBasicBlock(0, 64);
  emulator.cpu.regs.set(initialRegs);
  emulator.writeReg(REG_EIP, 0);
  const builtSecond = emulator.executeAndBuildBasicBlock(0, 64);
  const block = emulator.basicBlockCache.get(0) || null;
  const linearState = captureBlockState(emulator, block);
  emulator.cpu.regs.set(initialRegs);
  emulator.writeReg(REG_EIP, 0);
  const cached = emulator.executeCachedBasicBlock(0, 64);
  const cachedState = captureBlockState(emulator, block);
  return {
    builtFirst: builtFirst >>> 0,
    builtSecond: builtSecond >>> 0,
    cached: cached >>> 0,
    hasBlock: !!block,
    hasSimplePlan: !!(block && block.simplePlan),
    hasPreparedPlan: !!(block && block.simplePlan && block.simplePlan.prepared),
    linearState,
    cachedState
  };
}

try {
  assertEq(Emulator.normalizeCpuBackendMode("js"), "js", "js mode should stay js");
  assertEq(Emulator.normalizeCpuBackendMode("AUTO"), "auto", "auto mode should normalize case-insensitively");
  assertEq(Emulator.normalizeCpuBackendMode("WASM"), "wasm", "wasm mode should normalize case-insensitively");
  assertEq(Emulator.normalizeCpuBackendMode("weird"), "js", "unknown backend should normalize to js");

  const availability = Emulator.getCpuBackendAvailability();
  assert(availability && availability.auto === true, "auto backend mode should always be available");
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
  assert(typeof wasmBackend.aluBinaryWidth === "function", "wasm helper backend should expose ALU binary helpers");
  assert(typeof wasmBackend.x87CompareCode === "function", "wasm helper backend should expose x87 compare helpers");
  assert(typeof wasmBackend.shiftPacked64 === "function", "wasm helper backend should expose 64-bit shift helpers");
  assert(typeof wasmBackend.mulFullWidth === "function", "wasm helper backend should expose full-width multiply helpers");
  assert(typeof wasmBackend.divideFullWidth === "function", "wasm helper backend should expose full-width divide helpers");
  assert(typeof wasmBackend.x87F2xm1 === "function", "wasm helper backend should expose x87 transcendental helpers");
  assert(typeof wasmBackend.sseSqrt === "function", "wasm helper backend should expose SSE sqrt helpers");
  assert(typeof wasmBackend.sseBinaryFloat === "function", "wasm helper backend should expose SSE binary float helpers");
  assert(typeof wasmBackend.sseCompareCode === "function", "wasm helper backend should expose SSE compare helpers");
  assert(typeof wasmBackend.sseUnaryFloat32x4 === "function", "wasm helper backend should expose SSE unary vector helpers");
  assert(typeof wasmBackend.sseBinaryFloat32x4 === "function", "wasm helper backend should expose SSE binary vector helpers");
  assert(typeof wasmBackend.sseBinaryFloat32Bits === "function", "wasm helper backend should expose SSE scalar bit helpers");
  assert(typeof wasmBackend.sseCompare32x4 === "function", "wasm helper backend should expose SSE compare vector helpers");
  assert(typeof wasmBackend.cvtdq2ps32x4 === "function", "wasm helper backend should expose cvtdq2ps vector helpers");
  assert(typeof wasmBackend.haddps32x4 === "function", "wasm helper backend should expose haddps vector helpers");
  assert(typeof wasmBackend.packedOp32x2 === "function", "wasm helper backend should expose packed 64-bit logical helpers");
  assert(typeof wasmBackend.packedOp32x4 === "function", "wasm helper backend should expose packed 128-bit logical helpers");
  assert(typeof wasmBackend.punpckldq32x4 === "function", "wasm helper backend should expose punpckldq helpers");
  assert(typeof wasmBackend.pshufw64 === "function", "wasm helper backend should expose pshufw helpers");
  assert(typeof wasmBackend.movmskBytes64 === "function", "wasm helper backend should expose 64-bit movemask helpers");
  assert(typeof wasmBackend.movmskBytes128 === "function", "wasm helper backend should expose 128-bit movemask helpers");
  assert(typeof wasmBackend.movmskFloat32x4 === "function", "wasm helper backend should expose float movemask helpers");
  assert(typeof wasmBackend.shufps32x4 === "function", "wasm helper backend should expose shufps helpers");
  assert(typeof wasmBackend.bswap32 === "function", "wasm helper backend should expose bswap helpers");
  assert(typeof wasmBackend.xaddWidth === "function", "wasm helper backend should expose xadd helpers");
  assert(typeof wasmBackend.cmpxchgWidth === "function", "wasm helper backend should expose cmpxchg helpers");
  assert(typeof wasmBackend.executeSimpleBlock === "function", "wasm helper backend should expose simple block execution");

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

  for (const width of widths) {
    for (const op of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
      for (let i = 0; i < 160; i += 1) {
        const flags = nextRand();
        const left = nextRand();
        const right = nextRand();
        assertDeepEq(
          wasmBackend.aluBinaryWidth(op, left, right, width, flags),
          jsBackend.aluBinaryWidth(op, left, right, width, flags),
          `aluBinaryWidth should match for width=${width}, op=${op}`
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

  for (const op of [0, 1, 2]) {
    assertDeepEq(
      wasmBackend.sseUnaryFloat32x4(
        numberToF32Bits(1),
        numberToF32Bits(4),
        numberToF32Bits(9),
        numberToF32Bits(16),
        op
      ),
      jsBackend.sseUnaryFloat32x4(
        numberToF32Bits(1),
        numberToF32Bits(4),
        numberToF32Bits(9),
        numberToF32Bits(16),
        op
      ),
      `sseUnaryFloat32x4 should match for op=${op}`
    );
  }

  for (const op of [0, 1, 2, 3, 4, 5]) {
    assertDeepEq(
      wasmBackend.sseBinaryFloat32x4(
        numberToF32Bits(1),
        numberToF32Bits(-2),
        numberToF32Bits(3.5),
        numberToF32Bits(-0),
        numberToF32Bits(4),
        numberToF32Bits(0.5),
        numberToF32Bits(-2),
        numberToF32Bits(0),
        op
      ),
      jsBackend.sseBinaryFloat32x4(
        numberToF32Bits(1),
        numberToF32Bits(-2),
        numberToF32Bits(3.5),
        numberToF32Bits(-0),
        numberToF32Bits(4),
        numberToF32Bits(0.5),
        numberToF32Bits(-2),
        numberToF32Bits(0),
        op
      ),
      `sseBinaryFloat32x4 should match for op=${op}`
    );
  }

  for (const op of [0, 1, 2, 3, 4, 5]) {
    assertEq(
      wasmBackend.sseBinaryFloat32Bits(numberToF32Bits(-2.5), numberToF32Bits(4), op),
      jsBackend.sseBinaryFloat32Bits(numberToF32Bits(-2.5), numberToF32Bits(4), op),
      `sseBinaryFloat32Bits should match for op=${op}`
    );
  }

  for (const imm of [0, 1, 2, 3, 4, 5, 6, 7]) {
    assertDeepEq(
      wasmBackend.sseCompare32x4(
        numberToF32Bits(1),
        numberToF32Bits(2),
        numberToF32Bits(2),
        numberToF32Bits(Number.NaN),
        numberToF32Bits(1),
        numberToF32Bits(1),
        numberToF32Bits(3),
        numberToF32Bits(0),
        imm
      ),
      jsBackend.sseCompare32x4(
        numberToF32Bits(1),
        numberToF32Bits(2),
        numberToF32Bits(2),
        numberToF32Bits(Number.NaN),
        numberToF32Bits(1),
        numberToF32Bits(1),
        numberToF32Bits(3),
        numberToF32Bits(0),
        imm
      ),
      `sseCompare32x4 should match for imm=${imm}`
    );
  }

  assertDeepEq(
    wasmBackend.cvtdq2ps32x4(0, 1, 0xffffffff, 0x80000000),
    jsBackend.cvtdq2ps32x4(0, 1, 0xffffffff, 0x80000000),
    "cvtdq2ps32x4 should match"
  );

  assertDeepEq(
    wasmBackend.haddps32x4(
      numberToF32Bits(1),
      numberToF32Bits(2),
      numberToF32Bits(3),
      numberToF32Bits(4),
      numberToF32Bits(5),
      numberToF32Bits(6),
      numberToF32Bits(7),
      numberToF32Bits(8)
    ),
    jsBackend.haddps32x4(
      numberToF32Bits(1),
      numberToF32Bits(2),
      numberToF32Bits(3),
      numberToF32Bits(4),
      numberToF32Bits(5),
      numberToF32Bits(6),
      numberToF32Bits(7),
      numberToF32Bits(8)
    ),
    "haddps32x4 should match"
  );
  for (let i = 0; i < 200; i += 1) {
    const flags = nextRand();
    const cc = nextRand() & 0xf;
    assertEq(
      wasmBackend.evalJccCondition(cc, flags),
      jsBackend.evalJccCondition(cc, flags),
      `evalJccCondition should match for random cc=${cc}, flags=0x${flags.toString(16)}`
    );
  }

  for (const value of [0, 1, 0x12345678, 0xaabbccdd, 0xffffffff]) {
    assertEq(
      wasmBackend.bswap32(value),
      jsBackend.bswap32(value),
      `bswap32 should match for 0x${(value >>> 0).toString(16)}`
    );
  }

  for (const width of widths) {
    for (let i = 0; i < 160; i += 1) {
      const dst = nextRand();
      const src = nextRand();
      const flags = nextRand();
      assertDeepEq(
        wasmBackend.xaddWidth(dst, src, width, flags),
        jsBackend.xaddWidth(dst, src, width, flags),
        `xaddWidth should match for width=${width}`
      );
    }
  }

  for (const width of widths) {
    for (let i = 0; i < 160; i += 1) {
      const accumulator = nextRand();
      const source = nextRand();
      const replacement = nextRand();
      const flags = nextRand();
      assertDeepEq(
        wasmBackend.cmpxchgWidth(accumulator, source, replacement, width, flags),
        jsBackend.cmpxchgWidth(accumulator, source, replacement, width, flags),
        `cmpxchgWidth should match for width=${width}`
      );
    }
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

  const instructionScenarios = [
    {
      name: "or rm32, r32",
      bytes: [0x09, 0xc1],
      setup(emulator) {
        emulator.writeReg(REG_EAX, 0x0f0f0000);
        emulator.writeReg(REG_ECX, 0x00f000f0);
      }
    },
    {
      name: "xor r8, r/m8",
      bytes: [0x32, 0xc1],
      setup(emulator) {
        emulator.writeReg(REG_EAX, 0x0000005a);
        emulator.writeReg(REG_ECX, 0x000000c3);
      }
    },
    {
      name: "and rm8, r8",
      bytes: [0x20, 0xc1],
      setup(emulator) {
        emulator.writeReg(REG_EAX, 0x000000f0);
        emulator.writeReg(REG_ECX, 0x0000005a);
      }
    },
    {
      name: "sub rm8, r8",
      bytes: [0x28, 0xc1],
      setup(emulator) {
        emulator.writeReg(REG_EAX, 0x00000011);
        emulator.writeReg(REG_ECX, 0x00000044);
      }
    },
    {
      name: "cmp r8, r/m8",
      bytes: [0x3a, 0xc1],
      setup(emulator) {
        emulator.writeReg(REG_EAX, 0x00000033);
        emulator.writeReg(REG_ECX, 0x00000099);
      }
    },
    {
      name: "sbb eax, imm32",
      bytes: [0x1d, 0x34, 0x12, 0x00, 0x00],
      setup(emulator) {
        emulator.writeReg(REG_EAX, 0x00008000);
        emulator.writeReg(REG_EFLAGS, 0x203);
      }
    },
    {
      name: "test eax, imm32",
      bytes: [0xa9, 0x0f, 0x00, 0xf0, 0x00],
      setup(emulator) {
        emulator.writeReg(REG_EAX, 0x00f000f0);
      }
    },
    {
      name: "f6 test cl, imm8",
      bytes: [0xf6, 0xc1, 0x0f],
      setup(emulator) {
        emulator.writeReg(REG_ECX, 0x000000a5);
      }
    },
    {
      name: "f7 neg ecx",
      bytes: [0xf7, 0xd9],
      setup(emulator) {
        emulator.writeReg(REG_ECX, 0x00001234);
      }
    },
    {
      name: "0f b1 cmpxchg ecx, edx",
      bytes: [0x0f, 0xb1, 0xd1],
      setup(emulator) {
        emulator.writeReg(REG_EAX, 0x00002222);
        emulator.writeReg(REG_ECX, 0x00001111);
        emulator.writeReg(REG_EDX, 0x00003333);
      }
    },
    {
      name: "0f c1 xadd ecx, edx",
      bytes: [0x0f, 0xc1, 0xd1],
      setup(emulator) {
        emulator.writeReg(REG_ECX, 0x00000020);
        emulator.writeReg(REG_EDX, 0x00000007);
      }
    },
    {
      name: "0f c8 bswap eax",
      bytes: [0x0f, 0xc8],
      setup(emulator) {
        emulator.writeReg(REG_EAX, 0x12345678);
      }
    },
    {
      name: "0f 58 addps xmm0, xmm1",
      bytes: [0x0f, 0x58, 0xc1],
      setup(emulator) {
        emulator.writeXmmU32(0, 0, numberToF32Bits(1));
        emulator.writeXmmU32(0, 1, numberToF32Bits(2));
        emulator.writeXmmU32(0, 2, numberToF32Bits(3));
        emulator.writeXmmU32(0, 3, numberToF32Bits(4));
        emulator.writeXmmU32(1, 0, numberToF32Bits(5));
        emulator.writeXmmU32(1, 1, numberToF32Bits(6));
        emulator.writeXmmU32(1, 2, numberToF32Bits(7));
        emulator.writeXmmU32(1, 3, numberToF32Bits(8));
      }
    },
    {
      name: "0f 58 addps xmm0, [mem]",
      bytes: [0x0f, 0x58, 0x05, 0x00, 0x02, 0x00, 0x00],
      setup(emulator) {
        emulator.writeXmmU32(0, 0, numberToF32Bits(1));
        emulator.writeXmmU32(0, 1, numberToF32Bits(2));
        emulator.writeXmmU32(0, 2, numberToF32Bits(3));
        emulator.writeXmmU32(0, 3, numberToF32Bits(4));
        emulator.writeMem32(0x200, numberToF32Bits(5));
        emulator.writeMem32(0x204, numberToF32Bits(6));
        emulator.writeMem32(0x208, numberToF32Bits(7));
        emulator.writeMem32(0x20c, numberToF32Bits(8));
      }
    },
    {
      name: "0f 51 sqrtps xmm0, xmm1",
      bytes: [0x0f, 0x51, 0xc1],
      setup(emulator) {
        emulator.writeXmmU32(1, 0, numberToF32Bits(1));
        emulator.writeXmmU32(1, 1, numberToF32Bits(4));
        emulator.writeXmmU32(1, 2, numberToF32Bits(9));
        emulator.writeXmmU32(1, 3, numberToF32Bits(16));
      }
    },
    {
      name: "0f c2 cmpps xmm0, xmm1, eq",
      bytes: [0x0f, 0xc2, 0xc1, 0x00],
      setup(emulator) {
        emulator.writeXmmU32(0, 0, numberToF32Bits(1));
        emulator.writeXmmU32(0, 1, numberToF32Bits(2));
        emulator.writeXmmU32(0, 2, numberToF32Bits(Number.NaN));
        emulator.writeXmmU32(0, 3, numberToF32Bits(-0));
        emulator.writeXmmU32(1, 0, numberToF32Bits(1));
        emulator.writeXmmU32(1, 1, numberToF32Bits(3));
        emulator.writeXmmU32(1, 2, numberToF32Bits(0));
        emulator.writeXmmU32(1, 3, numberToF32Bits(0));
      }
    },
    {
      name: "0f 5b cvtdq2ps xmm0, xmm1",
      bytes: [0x0f, 0x5b, 0xc1],
      setup(emulator) {
        emulator.writeXmmU32(1, 0, 0);
        emulator.writeXmmU32(1, 1, 1);
        emulator.writeXmmU32(1, 2, 0xffffffff);
        emulator.writeXmmU32(1, 3, 0x80000000);
      }
    },
    {
      name: "0f 10 movups xmm0, [mem]",
      bytes: [0x0f, 0x10, 0x05, 0x00, 0x02, 0x00, 0x00],
      setup(emulator) {
        emulator.writeMem32(0x200, 0x11223344);
        emulator.writeMem32(0x204, 0x55667788);
        emulator.writeMem32(0x208, 0x99aabbcc);
        emulator.writeMem32(0x20c, 0xddeeff00);
      }
    },
    {
      name: "0f 11 movups [mem], xmm0",
      bytes: [0x0f, 0x11, 0x05, 0x00, 0x02, 0x00, 0x00],
      setup(emulator) {
        emulator.writeXmmU32(0, 0, 0x11223344);
        emulator.writeXmmU32(0, 1, 0x55667788);
        emulator.writeXmmU32(0, 2, 0x99aabbcc);
        emulator.writeXmmU32(0, 3, 0xddeeff00);
      }
    },
    {
      name: "66 0f 28 movaps xmm0, [mem]",
      bytes: [0x66, 0x0f, 0x28, 0x05, 0x00, 0x02, 0x00, 0x00],
      setup(emulator) {
        emulator.writeMem32(0x200, 0x11223344);
        emulator.writeMem32(0x204, 0x55667788);
        emulator.writeMem32(0x208, 0x99aabbcc);
        emulator.writeMem32(0x20c, 0xddeeff00);
      }
    },
    {
      name: "f3 0f 58 addss xmm0, xmm1",
      bytes: [0xf3, 0x0f, 0x58, 0xc1],
      setup(emulator) {
        emulator.writeXmmU32(0, 0, numberToF32Bits(1.5));
        emulator.writeXmmU32(0, 1, numberToF32Bits(100));
        emulator.writeXmmU32(1, 0, numberToF32Bits(2.25));
      }
    },
    {
      name: "f3 0f 58 addss xmm0, [mem]",
      bytes: [0xf3, 0x0f, 0x58, 0x05, 0x00, 0x02, 0x00, 0x00],
      setup(emulator) {
        emulator.writeXmmU32(0, 0, numberToF32Bits(1.5));
        emulator.writeXmmU32(0, 1, numberToF32Bits(100));
        emulator.writeMem32(0x200, numberToF32Bits(2.25));
      }
    },
    {
      name: "66 0f 6e movd xmm0, [mem]",
      bytes: [0x66, 0x0f, 0x6e, 0x05, 0x00, 0x02, 0x00, 0x00],
      setup(emulator) {
        emulator.writeXmmU32(0, 0, 0xffffffff);
        emulator.writeXmmU32(0, 1, 0xffffffff);
        emulator.writeXmmU32(0, 2, 0xffffffff);
        emulator.writeXmmU32(0, 3, 0xffffffff);
        emulator.writeMem32(0x200, 0x11223344);
      }
    },
    {
      name: "0f 13 movlps [mem], xmm0",
      bytes: [0x0f, 0x13, 0x05, 0x00, 0x02, 0x00, 0x00],
      setup(emulator) {
        emulator.writeXmmU32(0, 0, 0x11223344);
        emulator.writeXmmU32(0, 1, 0x55667788);
      }
    },
    {
      name: "f2 0f 7c haddps xmm0, xmm1",
      bytes: [0xf2, 0x0f, 0x7c, 0xc1],
      setup(emulator) {
        emulator.writeXmmU32(0, 0, numberToF32Bits(1));
        emulator.writeXmmU32(0, 1, numberToF32Bits(2));
        emulator.writeXmmU32(0, 2, numberToF32Bits(3));
        emulator.writeXmmU32(0, 3, numberToF32Bits(4));
        emulator.writeXmmU32(1, 0, numberToF32Bits(5));
        emulator.writeXmmU32(1, 1, numberToF32Bits(6));
        emulator.writeXmmU32(1, 2, numberToF32Bits(7));
        emulator.writeXmmU32(1, 3, numberToF32Bits(8));
      }
    },
    {
      name: "f2 0f 7c haddps xmm0, [mem]",
      bytes: [0xf2, 0x0f, 0x7c, 0x05, 0x00, 0x02, 0x00, 0x00],
      setup(emulator) {
        emulator.writeXmmU32(0, 0, numberToF32Bits(1));
        emulator.writeXmmU32(0, 1, numberToF32Bits(2));
        emulator.writeXmmU32(0, 2, numberToF32Bits(3));
        emulator.writeXmmU32(0, 3, numberToF32Bits(4));
        emulator.writeMem32(0x200, numberToF32Bits(5));
        emulator.writeMem32(0x204, numberToF32Bits(6));
        emulator.writeMem32(0x208, numberToF32Bits(7));
        emulator.writeMem32(0x20c, numberToF32Bits(8));
      }
    },
    {
      name: "inc ecx",
      bytes: [0x41],
      setup(emulator) {
        emulator.writeReg(REG_ECX, 0x7fffffff);
        emulator.writeReg(REG_EFLAGS, 0x203);
      }
    },
    {
      name: "66 or rm16, r16",
      bytes: [0x66, 0x09, 0xc1],
      setup(emulator) {
        emulator.writeReg(REG_EAX, 0x00001234);
        emulator.writeReg(REG_ECX, 0x000000f0);
      }
    },
    {
      name: "66 group1 sub ax, imm8",
      bytes: [0x66, 0x83, 0xe8, 0x01],
      setup(emulator) {
        emulator.writeReg(REG_EAX, 0x00008000);
      }
    },
    {
      name: "66 0f b1 cmpxchg cx, dx",
      bytes: [0x66, 0x0f, 0xb1, 0xd1],
      setup(emulator) {
        emulator.writeReg(REG_EAX, 0x00001234);
        emulator.writeReg(REG_ECX, 0x00001111);
        emulator.writeReg(REG_EDX, 0x00002222);
      }
    },
    {
      name: "66 f7 neg cx",
      bytes: [0x66, 0xf7, 0xd9],
      setup(emulator) {
        emulator.writeReg(REG_ECX, 0x00001234);
      }
    },
    {
      name: "cmpsb updates flags and pointers",
      bytes: [0xa6],
      setup(emulator) {
        emulator.writeReg(REG_ESI, 0x100);
        emulator.writeReg(REG_EDI, 0x120);
        emulator.writeMem8(0x100, 0x33);
        emulator.writeMem8(0x120, 0x34);
      }
    },
    {
      name: "repe cmpsb fast path stops on mismatch",
      bytes: [0xf3, 0xa6],
      setup(emulator) {
        emulator.writeReg(REG_ECX, 6);
        emulator.writeReg(REG_ESI, 0x100);
        emulator.writeReg(REG_EDI, 0x120);
        const left = [1, 2, 3, 9, 5, 6];
        const right = [1, 2, 3, 8, 5, 6];
        for (let i = 0; i < left.length; i += 1) {
          emulator.writeMem8(0x100 + i, left[i]);
          emulator.writeMem8(0x120 + i, right[i]);
        }
      }
    },
    {
      name: "repne scasb fast path stops on match",
      bytes: [0xf2, 0xae],
      setup(emulator) {
        emulator.writeReg(REG_EAX, 0x00000044);
        emulator.writeReg(REG_ECX, 6);
        emulator.writeReg(REG_EDI, 0x140);
        const values = [0x10, 0x20, 0x30, 0x44, 0x50, 0x60];
        for (let i = 0; i < values.length; i += 1) {
          emulator.writeMem8(0x140 + i, values[i]);
        }
      }
    }
  ];
  for (const scenario of instructionScenarios) {
    const jsState = runInstructionScenario("js", scenario.bytes, scenario.setup);
    const wasmState = runInstructionScenario("wasm", scenario.bytes, scenario.setup);
    assert(jsState.ok, `instruction scenario should execute in js backend: ${scenario.name}`);
    assert(wasmState.ok, `instruction scenario should execute in wasm backend: ${scenario.name}`);
    assertDeepEq(wasmState, jsState, `instruction scenario should match between js and wasm: ${scenario.name}`);
  }

  const cachedBlockBytes = [
    0xbb, 0x78, 0x56, 0x34, 0x12,
    0x89, 0xd9,
    0x83, 0xc1, 0x07,
    0x0f, 0xcb,
    0x31, 0xd9,
    0x3b, 0xcb,
    0x24, 0xf0,
    0x4b,
    0x90,
    0xc3
  ];
  const cachedBlockSetup = (emulator) => {
    emulator.writeReg(REG_EAX, 0x0000005a);
    emulator.writeReg(REG_EFLAGS, 0x203);
  };
  const jsBlock = runCachedBlockScenario("js", cachedBlockBytes, cachedBlockSetup);
  const wasmBlock = runCachedBlockScenario("wasm", cachedBlockBytes, cachedBlockSetup);
  assert(jsBlock.built >= 2, "cached block scenario should build a multi-entry block");
  assertEq(jsBlock.cached, jsBlock.built, "js cached block should replay the full block");
  assertEq(jsBlock.cachedAgain, jsBlock.built, "js cached block should replay the full block on repeated hit");
  assert(jsBlock.hasSimplePlan, "js cached block should compile a simple block plan");
  assertEq(wasmBlock.cached, wasmBlock.built, "wasm cached block should replay the full block");
  assertEq(wasmBlock.cachedAgain, wasmBlock.built, "wasm cached block should replay the full block on repeated hit");
  assert(wasmBlock.hasSimplePlan, "wasm cached block should compile a simple block plan");
  assert(wasmBlock.hasPreparedPlan, "wasm cached block should prepare a wasm slot-backed block plan");
  assertDeepEq(wasmBlock.linearState, jsBlock.linearState, "cached block linear execution should match between js and wasm");
  assertDeepEq(wasmBlock.cachedState, jsBlock.cachedState, "cached block replay should match between js and wasm");
  assertDeepEq(wasmBlock.cachedAgainState, jsBlock.cachedAgainState, "cached block repeated replay should match between js and wasm");

  const prewarmedSoftBytes = [
    0x41,
    0x89, 0xd9,
    0x83, 0xc1, 0x07,
    0x0f, 0xcb,
    0x31, 0xd9,
    0x24, 0xf0,
    0x4b,
    0xc3
  ];
  const prewarmedSoftSetup = (emulator) => {
    emulator.writeReg(REG_EAX, 0x0000005a);
    emulator.writeReg(REG_EBX, 0x12345678);
    emulator.writeReg(REG_EFLAGS, 0x203);
  };
  const wasmPrewarmed = runPrewarmedSoftBlockScenario("wasm", prewarmedSoftBytes, prewarmedSoftSetup);
  assert(wasmPrewarmed.prepared > 0, "soft block prewarm should cache at least one block");
  assert(wasmPrewarmed.hasBlock, "soft block prewarm should place the entry block into cache");
  assert(wasmPrewarmed.hasPreparedPlan, "soft block prewarm should prepare a wasm slot-backed plan");
  assert(wasmPrewarmed.cached >= 2, "prewarmed soft block should execute through cached path on first hit");

  const cachedByteBlockBytes = [
    0x8a, 0xc3,
    0x80, 0xe0, 0xf0,
    0xf6, 0xc0, 0xc0,
    0x88, 0xc1,
    0x83, 0xc3, 0x01,
    0xc1, 0xe3, 0x04,
    0xc0, 0xeb, 0x01,
    0xd0, 0xe1,
    0xc3
  ];
  const cachedByteBlockSetup = (emulator) => {
    emulator.writeReg(REG_EAX, 0x0000005a);
    emulator.writeReg(REG_EBX, 0x1234567b);
    emulator.writeReg(REG_ECX, 0xabcdef12);
    emulator.writeReg(REG_EFLAGS, 0x203);
  };
  const jsByteBlock = runCachedBlockScenario("js", cachedByteBlockBytes, cachedByteBlockSetup);
  const wasmByteBlock = runCachedBlockScenario("wasm", cachedByteBlockBytes, cachedByteBlockSetup);
  assert(jsByteBlock.built >= 2, "8-bit cached block scenario should build a multi-entry block");
  assertEq(jsByteBlock.cached, jsByteBlock.built, "js 8-bit cached block should replay the full block");
  assertEq(wasmByteBlock.cached, wasmByteBlock.built, "wasm 8-bit cached block should replay the full block");
  assertEq(wasmByteBlock.cachedAgain, wasmByteBlock.built, "wasm 8-bit cached block should replay on repeated hit");
  assert(wasmByteBlock.hasSimplePlan, "wasm 8-bit cached block should compile a simple block plan");
  assert(wasmByteBlock.hasPreparedPlan, "wasm 8-bit cached block should prepare a wasm slot-backed plan");
  assertDeepEq(wasmByteBlock.linearState, jsByteBlock.linearState, "8-bit cached block linear execution should match between js and wasm");
  assertDeepEq(wasmByteBlock.cachedState, jsByteBlock.cachedState, "8-bit cached block replay should match between js and wasm");
  assertDeepEq(wasmByteBlock.cachedAgainState, jsByteBlock.cachedAgainState, "8-bit cached block repeated replay should match between js and wasm");

  const hotSingleEntryBytes = [
    0x40,
    0xc3
  ];
  const hotSingleEntrySetup = (emulator) => {
    emulator.writeReg(REG_EAX, 0x0000005a);
    emulator.writeReg(REG_EFLAGS, 0x203);
  };
  const jsSingleEntryBlock = runHotSingleEntryCacheScenario("js", hotSingleEntryBytes, hotSingleEntrySetup);
  const wasmSingleEntryBlock = runHotSingleEntryCacheScenario("wasm", hotSingleEntryBytes, hotSingleEntrySetup);
  assertEq(jsSingleEntryBlock.builtFirst, 1, "js hot single-entry scenario should execute one instruction on first build");
  assertEq(jsSingleEntryBlock.builtSecond, 1, "js hot single-entry scenario should execute one instruction on second build");
  assert(jsSingleEntryBlock.hasBlock, "js hot single-entry scenario should promote a cached block after warming");
  assert(jsSingleEntryBlock.hasSimplePlan, "js hot single-entry scenario should compile a simple block plan");
  assertEq(jsSingleEntryBlock.cached, 1, "js hot single-entry cached block should replay the single instruction");
  assert(wasmSingleEntryBlock.hasBlock, "wasm hot single-entry scenario should promote a cached block after warming");
  assert(wasmSingleEntryBlock.hasSimplePlan, "wasm hot single-entry scenario should compile a simple block plan");
  assert(wasmSingleEntryBlock.hasPreparedPlan, "wasm hot single-entry scenario should prepare a wasm slot-backed plan");
  assertEq(wasmSingleEntryBlock.cached, 1, "wasm hot single-entry cached block should replay the single instruction");
  assertDeepEq(wasmSingleEntryBlock.linearState, jsSingleEntryBlock.linearState, "hot single-entry linear execution should match between js and wasm");
  assertDeepEq(wasmSingleEntryBlock.cachedState, jsSingleEntryBlock.cachedState, "hot single-entry cached replay should match between js and wasm");

  const jsOnlySimpleBlockBytes = [
    0x50,
    0x59,
    0xf9,
    0xf8,
    0xa8, 0x01,
    0xc3
  ];
  const jsOnlySimpleBlockSetup = (emulator) => {
    emulator.writeReg(REG_EAX, 0x12345679);
    emulator.writeReg(REG_ECX, 0);
    emulator.writeReg(REG_ESP, 0x1800);
    emulator.writeReg(REG_EFLAGS, 0x202);
  };
  const jsOnlyJsBlock = runCachedBlockScenario("js", jsOnlySimpleBlockBytes, jsOnlySimpleBlockSetup);
  const jsOnlyAutoBlock = runCachedBlockScenario("auto", jsOnlySimpleBlockBytes, jsOnlySimpleBlockSetup);
  const jsOnlyWasmBlock = runCachedBlockScenario("wasm", jsOnlySimpleBlockBytes, jsOnlySimpleBlockSetup);
  assert(jsOnlyJsBlock.hasSimplePlan, "js-only simple block scenario should compile a JS simple plan");
  assertEq(jsOnlyJsBlock.cached, jsOnlyJsBlock.built, "js-only simple block cached replay should cover the same entry count");
  assertDeepEq(jsOnlyJsBlock.cachedState, jsOnlyJsBlock.linearState, "js-only simple block cached replay should match linear execution");
  assert(jsOnlyAutoBlock.hasSimplePlan, "auto mode should still cache js-only simple blocks through the JS backend");
  assert(!jsOnlyAutoBlock.hasPreparedPlan, "auto mode should not prepare js-only simple blocks for WASM");
  assertDeepEq(jsOnlyAutoBlock.cachedState, jsOnlyAutoBlock.linearState, "auto js-only simple block replay should match linear execution");
  assert(!jsOnlyWasmBlock.hasSimplePlan, "wasm mode should not compile js-only simple blocks into wasm plans");

  const jsOnlyMemoryBlockBytes = [
    0x8b, 0x43, 0x04,
    0x89, 0x46, 0x08,
    0x3b, 0x4a, 0x0c,
    0x83, 0x45, 0x10, 0x05,
    0x80, 0x43, 0x11, 0x0f,
    0xc6, 0x43, 0x12, 0xaa,
    0xc3
  ];
  const jsOnlyMemoryBlockReset = (emulator) => {
    emulator.writeMem32(0x204, 0x89abcdef);
    emulator.writeMem32(0x40c, 0x12345679);
    emulator.writeMem32(0x510, 0x00000010);
    emulator.writeMem8(0x211, 0x20);
    emulator.writeMem8(0x212, 0x00);
  };
  const jsOnlyMemoryBlockSetup = (emulator) => {
    emulator.writeReg(REG_EAX, 0x11111111);
    emulator.writeReg(REG_EBX, 0x00000200);
    emulator.writeReg(REG_ECX, 0x12345678);
    emulator.writeReg(REG_EDX, 0x00000400);
    emulator.writeReg(REG_ESI, 0x00000300);
    emulator.writeReg(5, 0x00000500);
    emulator.writeReg(REG_EFLAGS, 0x202);
    jsOnlyMemoryBlockReset(emulator);
  };
  const jsOnlyMemoryJsBlock = runCachedBlockScenario("js", jsOnlyMemoryBlockBytes, jsOnlyMemoryBlockSetup, { skipSoftScan: true, reset: jsOnlyMemoryBlockReset });
  const jsOnlyMemoryAutoBlock = runCachedBlockScenario("auto", jsOnlyMemoryBlockBytes, jsOnlyMemoryBlockSetup, { skipSoftScan: true, reset: jsOnlyMemoryBlockReset });
  const jsOnlyMemoryWasmBlock = runCachedBlockScenario("wasm", jsOnlyMemoryBlockBytes, jsOnlyMemoryBlockSetup, { skipSoftScan: true, reset: jsOnlyMemoryBlockReset });
  assert(jsOnlyMemoryJsBlock.hasSimplePlan, "js-only memory simple block scenario should compile a JS simple plan");
  assertEq(jsOnlyMemoryJsBlock.cached, jsOnlyMemoryJsBlock.built, "js-only memory simple block cached replay should cover the same entry count");
  assertDeepEq(jsOnlyMemoryJsBlock.cachedState, jsOnlyMemoryJsBlock.linearState, "js-only memory simple block cached replay should match linear execution");
  assert(jsOnlyMemoryAutoBlock.hasSimplePlan, "auto mode should still cache js-only memory simple blocks through the JS backend");
  assert(!jsOnlyMemoryAutoBlock.hasPreparedPlan, "auto mode should not prepare js-only memory simple blocks for WASM");
  assertDeepEq(jsOnlyMemoryAutoBlock.cachedState, jsOnlyMemoryAutoBlock.linearState, "auto js-only memory simple block replay should match linear execution");
  assert(!jsOnlyMemoryWasmBlock.hasSimplePlan, "wasm mode should not compile js-only memory simple blocks into wasm plans");

  const jsOnlyStringDwordBlockBytes = [
    0xa1, 0x00, 0x02, 0x00, 0x00,
    0xa3, 0x04, 0x02, 0x00, 0x00,
    0xad,
    0xab,
    0xc3
  ];
  const jsOnlyStringDwordBlockReset = (emulator) => {
    emulator.writeMem32(0x200, 0x12345678);
    emulator.writeMem32(0x204, 0);
    emulator.writeMem32(0x300, 0x89abcdef);
    emulator.writeMem32(0x400, 0);
  };
  const jsOnlyStringDwordBlockSetup = (emulator) => {
    emulator.writeReg(REG_EAX, 0);
    emulator.writeReg(REG_ESI, 0x300);
    emulator.writeReg(REG_EDI, 0x400);
    emulator.writeReg(REG_EFLAGS, 0x202);
    jsOnlyStringDwordBlockReset(emulator);
  };
  const jsOnlyStringDwordJsBlock = runCachedBlockScenario("js", jsOnlyStringDwordBlockBytes, jsOnlyStringDwordBlockSetup, { skipSoftScan: true, reset: jsOnlyStringDwordBlockReset });
  const jsOnlyStringDwordAutoBlock = runCachedBlockScenario("auto", jsOnlyStringDwordBlockBytes, jsOnlyStringDwordBlockSetup, { skipSoftScan: true, reset: jsOnlyStringDwordBlockReset });
  const jsOnlyStringDwordWasmBlock = runCachedBlockScenario("wasm", jsOnlyStringDwordBlockBytes, jsOnlyStringDwordBlockSetup, { skipSoftScan: true, reset: jsOnlyStringDwordBlockReset });
  assert(jsOnlyStringDwordJsBlock.hasSimplePlan, "js-only dword string block scenario should compile a JS simple plan");
  assertEq(jsOnlyStringDwordJsBlock.cached, jsOnlyStringDwordJsBlock.built, "js-only dword string block cached replay should cover the same entry count");
  assertDeepEq(jsOnlyStringDwordJsBlock.cachedState, jsOnlyStringDwordJsBlock.linearState, "js-only dword string block cached replay should match linear execution");
  assert(jsOnlyStringDwordAutoBlock.hasSimplePlan, "auto mode should still cache js-only dword string blocks through the JS backend");
  assert(!jsOnlyStringDwordAutoBlock.hasPreparedPlan, "auto mode should not prepare js-only dword string blocks for WASM");
  assertDeepEq(jsOnlyStringDwordAutoBlock.cachedState, jsOnlyStringDwordAutoBlock.linearState, "auto js-only dword string block replay should match linear execution");
  assert(!jsOnlyStringDwordWasmBlock.hasSimplePlan, "wasm mode should not compile js-only dword string blocks into wasm plans");

  const jsOnlyUnaryMemoryBlockBytes = [
    0xf6, 0x43, 0x04, 0x0f,
    0xf6, 0x56, 0x05,
    0xf6, 0x5a, 0x06,
    0xf7, 0x43, 0x08, 0x78, 0x56, 0x34, 0x12,
    0xf7, 0x56, 0x0c,
    0xf7, 0x5a, 0x10,
    0xc3
  ];
  const jsOnlyUnaryMemoryBlockReset = (emulator) => {
    emulator.writeMem8(0x204, 0xf3);
    emulator.writeMem8(0x305, 0x5a);
    emulator.writeMem8(0x406, 0x81);
    emulator.writeMem32(0x208, 0x123456f8);
    emulator.writeMem32(0x30c, 0x0f0f0f0f);
    emulator.writeMem32(0x410, 0x80000001);
  };
  const jsOnlyUnaryMemoryBlockSetup = (emulator) => {
    emulator.writeReg(REG_EBX, 0x00000200);
    emulator.writeReg(REG_ESI, 0x00000300);
    emulator.writeReg(REG_EDX, 0x00000400);
    emulator.writeReg(REG_EFLAGS, 0x203);
    jsOnlyUnaryMemoryBlockReset(emulator);
  };
  const jsOnlyUnaryMemoryJsBlock = runCachedBlockScenario("js", jsOnlyUnaryMemoryBlockBytes, jsOnlyUnaryMemoryBlockSetup, { skipSoftScan: true, reset: jsOnlyUnaryMemoryBlockReset });
  const jsOnlyUnaryMemoryAutoBlock = runCachedBlockScenario("auto", jsOnlyUnaryMemoryBlockBytes, jsOnlyUnaryMemoryBlockSetup, { skipSoftScan: true, reset: jsOnlyUnaryMemoryBlockReset });
  const jsOnlyUnaryMemoryWasmBlock = runCachedBlockScenario("wasm", jsOnlyUnaryMemoryBlockBytes, jsOnlyUnaryMemoryBlockSetup, { skipSoftScan: true, reset: jsOnlyUnaryMemoryBlockReset });
  assert(jsOnlyUnaryMemoryJsBlock.hasSimplePlan, "js-only unary memory block scenario should compile a JS simple plan");
  assertEq(jsOnlyUnaryMemoryJsBlock.cached, jsOnlyUnaryMemoryJsBlock.built, "js-only unary memory block cached replay should cover the same entry count");
  assertDeepEq(jsOnlyUnaryMemoryJsBlock.cachedState, jsOnlyUnaryMemoryJsBlock.linearState, "js-only unary memory block cached replay should match linear execution");
  assert(jsOnlyUnaryMemoryAutoBlock.hasSimplePlan, "auto mode should still cache js-only unary memory blocks through the JS backend");
  assert(!jsOnlyUnaryMemoryAutoBlock.hasPreparedPlan, "auto mode should not prepare js-only unary memory blocks for WASM");
  assertDeepEq(jsOnlyUnaryMemoryAutoBlock.cachedState, jsOnlyUnaryMemoryAutoBlock.linearState, "auto js-only unary memory block replay should match linear execution");
  assert(!jsOnlyUnaryMemoryWasmBlock.hasSimplePlan, "wasm mode should not compile js-only unary memory blocks into wasm plans");

  const jsOnlyAluLeaMemoryBlockBytes = [
    0x8d, 0x43, 0x14,
    0x31, 0x45, 0x18,
    0x09, 0x4e, 0x1c,
    0x01, 0x53, 0x20,
    0x39, 0x7a, 0x24,
    0x03, 0x43, 0x28,
    0x33, 0x4e, 0x2c,
    0x23, 0x53, 0x30,
    0x2b, 0x7a, 0x34,
    0x3b, 0x6e, 0x38,
    0xc3
  ];
  const jsOnlyAluLeaMemoryBlockReset = (emulator) => {
    emulator.writeMem32(0x518, 0x00ff00ff);
    emulator.writeMem32(0x31c, 0x0000f0f0);
    emulator.writeMem32(0x220, 0x11111111);
    emulator.writeMem32(0x424, 0x01020304);
    emulator.writeMem32(0x228, 0x10000001);
    emulator.writeMem32(0x32c, 0xff00ff00);
    emulator.writeMem32(0x230, 0xf0f0f0f0);
    emulator.writeMem32(0x434, 0x00000010);
    emulator.writeMem32(0x338, 0x12345678);
  };
  const jsOnlyAluLeaMemoryBlockSetup = (emulator) => {
    emulator.writeReg(REG_EAX, 0x01020304);
    emulator.writeReg(REG_ECX, 0x00000f0f);
    emulator.writeReg(REG_EDX, 0x00000400);
    emulator.writeReg(REG_EBX, 0x00000200);
    emulator.writeReg(REG_EBP, 0x00000500);
    emulator.writeReg(REG_ESI, 0x00000300);
    emulator.writeReg(REG_EDI, 0x000000ff);
    emulator.writeReg(REG_EFLAGS, 0x203);
    jsOnlyAluLeaMemoryBlockReset(emulator);
  };
  const jsOnlyAluLeaMemoryJsBlock = runCachedBlockScenario("js", jsOnlyAluLeaMemoryBlockBytes, jsOnlyAluLeaMemoryBlockSetup, { skipSoftScan: true, reset: jsOnlyAluLeaMemoryBlockReset });
  const jsOnlyAluLeaMemoryAutoBlock = runCachedBlockScenario("auto", jsOnlyAluLeaMemoryBlockBytes, jsOnlyAluLeaMemoryBlockSetup, { skipSoftScan: true, reset: jsOnlyAluLeaMemoryBlockReset });
  const jsOnlyAluLeaMemoryWasmBlock = runCachedBlockScenario("wasm", jsOnlyAluLeaMemoryBlockBytes, jsOnlyAluLeaMemoryBlockSetup, { skipSoftScan: true, reset: jsOnlyAluLeaMemoryBlockReset });
  assert(jsOnlyAluLeaMemoryJsBlock.hasSimplePlan, "js-only lea/alu memory block scenario should compile a JS simple plan");
  assertEq(jsOnlyAluLeaMemoryJsBlock.cached, jsOnlyAluLeaMemoryJsBlock.built, "js-only lea/alu memory block cached replay should cover the same entry count");
  assertDeepEq(jsOnlyAluLeaMemoryJsBlock.cachedState, jsOnlyAluLeaMemoryJsBlock.linearState, "js-only lea/alu memory block cached replay should match linear execution");
  assert(jsOnlyAluLeaMemoryAutoBlock.hasSimplePlan, "auto mode should still cache js-only lea/alu memory blocks through the JS backend");
  assert(!jsOnlyAluLeaMemoryAutoBlock.hasPreparedPlan, "auto mode should not prepare js-only lea/alu memory blocks for WASM");
  assertDeepEq(jsOnlyAluLeaMemoryAutoBlock.cachedState, jsOnlyAluLeaMemoryAutoBlock.linearState, "auto js-only lea/alu memory block replay should match linear execution");
  assert(!jsOnlyAluLeaMemoryWasmBlock.hasSimplePlan, "wasm mode should not compile js-only lea/alu memory blocks into wasm plans");

  const jsOnlyByteMemoryBlockBytes = [
    0x8a, 0x43, 0x04,
    0x88, 0x46, 0x05,
    0x30, 0x5a, 0x06,
    0x32, 0x4b, 0x07,
    0x38, 0x56, 0x08,
    0x3a, 0x43, 0x09,
    0xfe, 0x43, 0x0a,
    0xfe, 0x4e, 0x0b,
    0x0f, 0xb6, 0x53, 0x0c,
    0x0f, 0xbe, 0x4e, 0x0d,
    0xc3
  ];
  const jsOnlyByteMemoryBlockReset = (emulator) => {
    emulator.writeMem8(0x204, 0x91);
    emulator.writeMem8(0x305, 0x00);
    emulator.writeMem8(0x406, 0x55);
    emulator.writeMem8(0x207, 0xaa);
    emulator.writeMem8(0x308, 0x10);
    emulator.writeMem8(0x209, 0x7f);
    emulator.writeMem8(0x20a, 0xff);
    emulator.writeMem8(0x30b, 0x01);
    emulator.writeMem8(0x40c, 0x80);
    emulator.writeMem8(0x30d, 0xf0);
  };
  const jsOnlyByteMemoryBlockSetup = (emulator) => {
    emulator.writeReg(REG_EAX, 0x00000012);
    emulator.writeReg(REG_EBX, 0x00000200);
    emulator.writeReg(REG_ECX, 0x00000034);
    emulator.writeReg(REG_EDX, 0x00000400);
    emulator.writeReg(REG_ESI, 0x00000300);
    emulator.writeReg(REG_EFLAGS, 0x203);
    jsOnlyByteMemoryBlockReset(emulator);
  };
  const jsOnlyByteMemoryJsBlock = runCachedBlockScenario("js", jsOnlyByteMemoryBlockBytes, jsOnlyByteMemoryBlockSetup, { skipSoftScan: true, reset: jsOnlyByteMemoryBlockReset });
  const jsOnlyByteMemoryAutoBlock = runCachedBlockScenario("auto", jsOnlyByteMemoryBlockBytes, jsOnlyByteMemoryBlockSetup, { skipSoftScan: true, reset: jsOnlyByteMemoryBlockReset });
  const jsOnlyByteMemoryWasmBlock = runCachedBlockScenario("wasm", jsOnlyByteMemoryBlockBytes, jsOnlyByteMemoryBlockSetup, { skipSoftScan: true, reset: jsOnlyByteMemoryBlockReset });
  assert(jsOnlyByteMemoryJsBlock.hasSimplePlan, "js-only byte memory block scenario should compile a JS simple plan");
  assertEq(jsOnlyByteMemoryJsBlock.cached, jsOnlyByteMemoryJsBlock.built, "js-only byte memory block cached replay should cover the same entry count");
  assertDeepEq(jsOnlyByteMemoryJsBlock.cachedState, jsOnlyByteMemoryJsBlock.linearState, "js-only byte memory block cached replay should match linear execution");
  assert(jsOnlyByteMemoryAutoBlock.hasSimplePlan, "auto mode should still cache js-only byte memory blocks through the JS backend");
  assert(!jsOnlyByteMemoryAutoBlock.hasPreparedPlan, "auto mode should not prepare js-only byte memory blocks for WASM");
  assertDeepEq(jsOnlyByteMemoryAutoBlock.cachedState, jsOnlyByteMemoryAutoBlock.linearState, "auto js-only byte memory block replay should match linear execution");
  assert(!jsOnlyByteMemoryWasmBlock.hasSimplePlan, "wasm mode should not compile js-only byte memory blocks into wasm plans");

  const genericSingleEntryBytes = [
    0xc6, 0xc0, 0x12,
    0xc3
  ];
  const genericSingleEntrySetup = (emulator) => {
    emulator.writeReg(REG_EAX, 0xabcdef00);
    emulator.writeReg(REG_EFLAGS, 0x203);
  };
  const jsGenericSingleEntryBlock = runHotSingleEntryCacheScenario("js", genericSingleEntryBytes, genericSingleEntrySetup);
  const wasmGenericSingleEntryBlock = runHotSingleEntryCacheScenario("wasm", genericSingleEntryBytes, genericSingleEntrySetup);
  assertEq(jsGenericSingleEntryBlock.builtFirst, 1, "js generic hot single-entry scenario should execute one instruction on first build");
  assertEq(jsGenericSingleEntryBlock.builtSecond, 1, "js generic hot single-entry scenario should execute one instruction on second build");
  assert(jsGenericSingleEntryBlock.hasBlock, "js generic hot single-entry scenario should promote a cached block after warming");
  assert(jsGenericSingleEntryBlock.hasSimplePlan, "js generic hot single-entry scenario should now compile a simple plan");
  assertEq(jsGenericSingleEntryBlock.cached, 1, "js generic hot single-entry cached block should replay the single instruction");
  assert(wasmGenericSingleEntryBlock.hasBlock, "wasm generic hot single-entry scenario should promote a cached block after warming");
  assert(wasmGenericSingleEntryBlock.hasSimplePlan, "wasm generic hot single-entry scenario should now compile a simple plan");
  assert(wasmGenericSingleEntryBlock.hasPreparedPlan, "wasm generic hot single-entry scenario should allocate a prepared simple plan");
  assertEq(wasmGenericSingleEntryBlock.cached, 1, "wasm generic hot single-entry cached block should replay the single instruction");
  assertDeepEq(wasmGenericSingleEntryBlock.linearState, jsGenericSingleEntryBlock.linearState, "generic hot single-entry linear execution should match between js and wasm");
  assertDeepEq(wasmGenericSingleEntryBlock.cachedState, jsGenericSingleEntryBlock.cachedState, "generic hot single-entry cached replay should match between js and wasm");

  const cachedByteRegRegBlockBytes = [
    0xb0, 0x5a,
    0xb3, 0x7b,
    0x30, 0xd8,
    0x88, 0xd9,
    0x02, 0xcb,
    0x84, 0xc9,
    0x38, 0xd8,
    0xc3
  ];
  const cachedByteRegRegSetup = (emulator) => {
    emulator.writeReg(REG_EFLAGS, 0x203);
  };
  const jsByteRegRegBlock = runCachedBlockScenario("js", cachedByteRegRegBlockBytes, cachedByteRegRegSetup);
  const wasmByteRegRegBlock = runCachedBlockScenario("wasm", cachedByteRegRegBlockBytes, cachedByteRegRegSetup);
  assert(jsByteRegRegBlock.built >= 2, "8-bit reg/reg cached block scenario should build a multi-entry block");
  assertEq(jsByteRegRegBlock.cached, jsByteRegRegBlock.built, "js 8-bit reg/reg cached block should replay the full block");
  assertEq(wasmByteRegRegBlock.cached, wasmByteRegRegBlock.built, "wasm 8-bit reg/reg cached block should replay the full block");
  assertEq(wasmByteRegRegBlock.cachedAgain, wasmByteRegRegBlock.built, "wasm 8-bit reg/reg cached block should replay on repeated hit");
  assert(wasmByteRegRegBlock.hasSimplePlan, "wasm 8-bit reg/reg cached block should compile a simple block plan");
  assert(wasmByteRegRegBlock.hasPreparedPlan, "wasm 8-bit reg/reg cached block should prepare a wasm slot-backed plan");
  assertDeepEq(wasmByteRegRegBlock.linearState, jsByteRegRegBlock.linearState, "8-bit reg/reg cached block linear execution should match between js and wasm");
  assertDeepEq(wasmByteRegRegBlock.cachedState, jsByteRegRegBlock.cachedState, "8-bit reg/reg cached block replay should match between js and wasm");
  assertDeepEq(wasmByteRegRegBlock.cachedAgainState, jsByteRegRegBlock.cachedAgainState, "8-bit reg/reg cached block repeated replay should match between js and wasm");

  const cachedByteMixedBlockBytes = [
    0xb1, 0x02,
    0xb0, 0x5a,
    0xb3, 0x7b,
    0x10, 0xd8,
    0x18, 0xc3,
    0x86, 0xd9,
    0xd2, 0xe3,
    0xfe, 0xcb,
    0xf6, 0xd3,
    0xf6, 0xdb,
    0xc3
  ];
  const cachedByteMixedSetup = (emulator) => {
    emulator.writeReg(REG_EFLAGS, 0x203);
  };
  const jsByteMixedBlock = runCachedBlockScenario("js", cachedByteMixedBlockBytes, cachedByteMixedSetup);
  const wasmByteMixedBlock = runCachedBlockScenario("wasm", cachedByteMixedBlockBytes, cachedByteMixedSetup);
  assert(jsByteMixedBlock.built >= 2, "8-bit mixed cached block scenario should build a multi-entry block");
  assertEq(jsByteMixedBlock.cached, jsByteMixedBlock.built, "js 8-bit mixed cached block should replay the full block");
  assertEq(wasmByteMixedBlock.cached, wasmByteMixedBlock.built, "wasm 8-bit mixed cached block should replay the full block");
  assertEq(wasmByteMixedBlock.cachedAgain, wasmByteMixedBlock.built, "wasm 8-bit mixed cached block should replay on repeated hit");
  assert(wasmByteMixedBlock.hasSimplePlan, "wasm 8-bit mixed cached block should compile a simple block plan");
  assert(wasmByteMixedBlock.hasPreparedPlan, "wasm 8-bit mixed cached block should prepare a wasm slot-backed plan");
  assertDeepEq(wasmByteMixedBlock.linearState, jsByteMixedBlock.linearState, "8-bit mixed cached block linear execution should match between js and wasm");
  assertDeepEq(wasmByteMixedBlock.cachedState, jsByteMixedBlock.cachedState, "8-bit mixed cached block replay should match between js and wasm");
  assertDeepEq(wasmByteMixedBlock.cachedAgainState, jsByteMixedBlock.cachedAgainState, "8-bit mixed cached block repeated replay should match between js and wasm");

  const cachedDwordMixedBlockBytes = [
    0xb8, 0x11, 0x22, 0x33, 0x44,
    0xbb, 0x05, 0x06, 0x07, 0x08,
    0xb1, 0x04,
    0x11, 0xd8,
    0x19, 0xd8,
    0x87, 0xd8,
    0xd3, 0xe0,
    0xff, 0xc8,
    0xf7, 0xd0,
    0xf7, 0xdb,
    0xc3
  ];
  const cachedDwordMixedSetup = (emulator) => {
    emulator.writeReg(REG_EFLAGS, 0x203);
  };
  const jsDwordMixedBlock = runCachedBlockScenario("js", cachedDwordMixedBlockBytes, cachedDwordMixedSetup);
  const wasmDwordMixedBlock = runCachedBlockScenario("wasm", cachedDwordMixedBlockBytes, cachedDwordMixedSetup);
  assert(jsDwordMixedBlock.built >= 2, "32-bit mixed cached block scenario should build a multi-entry block");
  assertEq(jsDwordMixedBlock.cached, jsDwordMixedBlock.built, "js 32-bit mixed cached block should replay the full block");
  assertEq(wasmDwordMixedBlock.cached, wasmDwordMixedBlock.built, "wasm 32-bit mixed cached block should replay the full block");
  assertEq(wasmDwordMixedBlock.cachedAgain, wasmDwordMixedBlock.built, "wasm 32-bit mixed cached block should replay on repeated hit");
  assert(wasmDwordMixedBlock.hasSimplePlan, "wasm 32-bit mixed cached block should compile a simple block plan");
  assert(wasmDwordMixedBlock.hasPreparedPlan, "wasm 32-bit mixed cached block should prepare a wasm slot-backed plan");
  assertDeepEq(wasmDwordMixedBlock.linearState, jsDwordMixedBlock.linearState, "32-bit mixed cached block linear execution should match between js and wasm");
  assertDeepEq(wasmDwordMixedBlock.cachedState, jsDwordMixedBlock.cachedState, "32-bit mixed cached block replay should match between js and wasm");
  assertDeepEq(wasmDwordMixedBlock.cachedAgainState, jsDwordMixedBlock.cachedAgainState, "32-bit mixed cached block repeated replay should match between js and wasm");

  const cached0fFlagBlockBytes = [
    0xb0, 0x80,
    0xb2, 0x7f,
    0x0f, 0xbe, 0xd8,
    0x0f, 0xb6, 0xca,
    0x0f, 0xbc, 0xd9,
    0x0f, 0x95, 0xc0,
    0x0f, 0xba, 0xf9, 0x04,
    0x0f, 0xa3, 0xd9,
    0xc3
  ];
  const cached0fFlagSetup = (emulator) => {
    emulator.writeReg(REG_EFLAGS, 0x203);
  };
  const js0fFlagBlock = runCachedBlockScenario("js", cached0fFlagBlockBytes, cached0fFlagSetup);
  const wasm0fFlagBlock = runCachedBlockScenario("wasm", cached0fFlagBlockBytes, cached0fFlagSetup);
  assert(js0fFlagBlock.built >= 2, "0F flag cached block scenario should build a multi-entry block");
  assertEq(js0fFlagBlock.cached, js0fFlagBlock.built, "js 0F flag cached block should replay the full block");
  assertEq(wasm0fFlagBlock.cached, wasm0fFlagBlock.built, "wasm 0F flag cached block should replay the full block");
  assertEq(wasm0fFlagBlock.cachedAgain, wasm0fFlagBlock.built, "wasm 0F flag cached block should replay on repeated hit");
  assert(wasm0fFlagBlock.hasSimplePlan, "wasm 0F flag cached block should compile a simple block plan");
  assert(wasm0fFlagBlock.hasPreparedPlan, "wasm 0F flag cached block should prepare a wasm slot-backed plan");
  assertDeepEq(wasm0fFlagBlock.linearState, js0fFlagBlock.linearState, "0F flag cached block linear execution should match between js and wasm");
  assertDeepEq(wasm0fFlagBlock.cachedState, js0fFlagBlock.cachedState, "0F flag cached block replay should match between js and wasm");
  assertDeepEq(wasm0fFlagBlock.cachedAgainState, js0fFlagBlock.cachedAgainState, "0F flag cached block repeated replay should match between js and wasm");

  const cached0fArithBlockBytes = [
    0xb8, 0x05, 0x00, 0x00, 0x00,
    0xb9, 0x05, 0x00, 0x00, 0x00,
    0xba, 0x09, 0x00, 0x00, 0x00,
    0xbb, 0x03, 0x00, 0x00, 0x00,
    0x0f, 0xb1, 0xd1,
    0x0f, 0x44, 0xd9,
    0x0f, 0xaf, 0xd9,
    0x0f, 0xc1, 0xd9,
    0xc3
  ];
  const cached0fArithSetup = (emulator) => {
    emulator.writeReg(REG_EFLAGS, 0x203);
  };
  const js0fArithBlock = runCachedBlockScenario("js", cached0fArithBlockBytes, cached0fArithSetup);
  const wasm0fArithBlock = runCachedBlockScenario("wasm", cached0fArithBlockBytes, cached0fArithSetup);
  assert(js0fArithBlock.built >= 2, "0F arithmetic cached block scenario should build a multi-entry block");
  assertEq(js0fArithBlock.cached, js0fArithBlock.built, "js 0F arithmetic cached block should replay the full block");
  assertEq(wasm0fArithBlock.cached, wasm0fArithBlock.built, "wasm 0F arithmetic cached block should replay the full block");
  assertEq(wasm0fArithBlock.cachedAgain, wasm0fArithBlock.built, "wasm 0F arithmetic cached block should replay on repeated hit");
  assert(wasm0fArithBlock.hasSimplePlan, "wasm 0F arithmetic cached block should compile a simple block plan");
  assert(wasm0fArithBlock.hasPreparedPlan, "wasm 0F arithmetic cached block should prepare a wasm slot-backed plan");
  assertDeepEq(wasm0fArithBlock.linearState, js0fArithBlock.linearState, "0F arithmetic cached block linear execution should match between js and wasm");
  assertDeepEq(wasm0fArithBlock.cachedState, js0fArithBlock.cachedState, "0F arithmetic cached block replay should match between js and wasm");
  assertDeepEq(wasm0fArithBlock.cachedAgainState, js0fArithBlock.cachedAgainState, "0F arithmetic cached block repeated replay should match between js and wasm");

  const cached0fXadd8BlockBytes = [
    0xb0, 0x05,
    0xb1, 0x07,
    0x0f, 0xc0, 0xc8,
    0x84, 0xc0,
    0xc3
  ];
  const cached0fXadd8Setup = (emulator) => {
    emulator.writeReg(REG_EFLAGS, 0x203);
  };
  const js0fXadd8Block = runCachedBlockScenario("js", cached0fXadd8BlockBytes, cached0fXadd8Setup);
  const wasm0fXadd8Block = runCachedBlockScenario("wasm", cached0fXadd8BlockBytes, cached0fXadd8Setup);
  assert(js0fXadd8Block.built >= 2, "0F xadd8 cached block scenario should build a multi-entry block");
  assertEq(js0fXadd8Block.cached, js0fXadd8Block.built, "js 0F xadd8 cached block should replay the full block");
  assertEq(wasm0fXadd8Block.cached, wasm0fXadd8Block.built, "wasm 0F xadd8 cached block should replay the full block");
  assertEq(wasm0fXadd8Block.cachedAgain, wasm0fXadd8Block.built, "wasm 0F xadd8 cached block should replay on repeated hit");
  assert(wasm0fXadd8Block.hasSimplePlan, "wasm 0F xadd8 cached block should compile a simple block plan");
  assert(wasm0fXadd8Block.hasPreparedPlan, "wasm 0F xadd8 cached block should prepare a wasm slot-backed plan");
  assertDeepEq(wasm0fXadd8Block.linearState, js0fXadd8Block.linearState, "0F xadd8 cached block linear execution should match between js and wasm");
  assertDeepEq(wasm0fXadd8Block.cachedState, js0fXadd8Block.cachedState, "0F xadd8 cached block replay should match between js and wasm");
  assertDeepEq(wasm0fXadd8Block.cachedAgainState, js0fXadd8Block.cachedAgainState, "0F xadd8 cached block repeated replay should match between js and wasm");

  const jsEmulator = new Emulator(createHeadlessSurface(8, 8), () => {}, { cpuBackend: "js" });
  assertEq(jsEmulator.getCpuBackendInfo().requested, "js", "constructor should store requested js backend");
  assertEq(jsEmulator.ensureCpuBackendReady(), "js", "js backend should become active");
  assert(jsEmulator.cpuHelperBackend && jsEmulator.cpuHelperBackend.kind === "js", "emulator should bind js helper backend");
  assertEq(jsEmulator.getCpuBackendInfo().basicBlockMaxEntries, 48, "js backend should use the larger basic block window");
  assertEq(jsEmulator.getCpuBackendInfo().basicBlockImmediateCacheEntries, 2, "js backend should cache short blocks earlier");
  assertEq(jsEmulator.getCpuBackendInfo().basicBlockHotThreshold, 2, "js backend should promote hot blocks earlier");
  assertEq(jsEmulator.setCpuBackend("wasm"), "wasm", "setCpuBackend should accept wasm requests before launch");
  assertEq(jsEmulator.ensureCpuBackendReady(), "wasm", "wasm backend should become active");
  assert(jsEmulator.cpuHelperBackend && jsEmulator.cpuHelperBackend.kind === "wasm", "emulator should bind wasm helper backend");
  assertEq(jsEmulator.getCpuBackendInfo().basicBlockMaxEntries, 48, "wasm backend should use larger basic block windows");
  assertEq(jsEmulator.getCpuBackendInfo().basicBlockImmediateCacheEntries, 2, "wasm backend should cache short blocks immediately");
  assertEq(jsEmulator.getCpuBackendInfo().basicBlockHotThreshold, 2, "wasm backend should promote hot blocks earlier");
  assertEq(jsEmulator.setCpuBackend("js"), "js", "backend should switch back to js before launch");

  const autoEmulator = new Emulator(createHeadlessSurface(8, 8), () => {}, { cpuBackend: "auto" });
  assertEq(autoEmulator.ensureCpuBackendReady(), "auto", "auto backend should become active");
  assert(autoEmulator.cpuHelperBackend && autoEmulator.cpuHelperBackend.kind === "js", "auto backend should use js helpers for the base interpreter path");
  assert(autoEmulator.cpuWasmHelperBackend && autoEmulator.cpuWasmHelperBackend.kind === "wasm", "auto backend should keep a wasm helper backend for promoted blocks");

  const startCacheEmulator = createInstructionEmulator("wasm");
  startCacheEmulator.writeMem8(0, 0x40); // inc eax
  startCacheEmulator.writeMem8(1, 0xc3); // ret
  assertEq(startCacheEmulator.canStartBasicBlockAt(0), true, "basic block start cache should allow non-terminator start");
  assertEq(startCacheEmulator.canStartBasicBlockAt(0), true, "basic block start cache should return the same result on repeated lookup");
  assert(startCacheEmulator.basicBlockStartHits > 0, "basic block start cache should record hits on repeated lookup");
  startCacheEmulator.writeMem8(0, 0xc3);
  assertEq(startCacheEmulator.canStartBasicBlockAt(0), false, "basic block start cache should invalidate after code writes");

  const dynamicSoftEmulator = createInstructionEmulator("js");
  dynamicSoftEmulator.softInstructionSites.clear();
  dynamicSoftEmulator.writeMem8(0, 0x74);
  dynamicSoftEmulator.writeMem8(1, 0x02);
  dynamicSoftEmulator.writeMem8(2, 0x90);
  dynamicSoftEmulator.writeMem8(3, 0x90);
  dynamicSoftEmulator.writeReg(REG_EFLAGS, 0x242);
  dynamicSoftEmulator.writeReg(REG_EIP, 0);
  assertEq(dynamicSoftEmulator.executeBasicInstruction(0), true, "dynamic soft-site jcc should execute through the soft path");
  assertEq(dynamicSoftEmulator.readReg(REG_EIP) >>> 0, 4, "dynamic soft-site jcc should take the cached short jump");
  const firstDynamicSite = dynamicSoftEmulator.getDynamicSoftInstructionSite(0);
  assert(firstDynamicSite && firstDynamicSite.type === "jcc", "dynamic soft-site cache should remember a short jcc site");
  dynamicSoftEmulator.writeMem8(0, 0xeb);
  dynamicSoftEmulator.writeMem8(1, 0xfe);
  dynamicSoftEmulator.writeReg(REG_EIP, 0);
  assertEq(dynamicSoftEmulator.executeBasicInstruction(0), true, "dynamic soft-site cache should re-decode after code writes");
  assertEq(dynamicSoftEmulator.readReg(REG_EIP) >>> 0, 0, "dynamic soft-site cache should follow the updated short jump target");
  const secondDynamicSite = dynamicSoftEmulator.getDynamicSoftInstructionSite(0);
  assert(secondDynamicSite && secondDynamicSite.type === "jmp", "dynamic soft-site cache should refresh when branch bytes change");

  console.log("Autotest OK: CPU backend mode exposes working JS/WASM helper backends and matches JS semantics.");
} catch (err) {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(2);
}

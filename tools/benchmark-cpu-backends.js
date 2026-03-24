const { loadKosRuntime } = require("./ui-harness");

const runtime = loadKosRuntime();
const { Emulator, createHeadlessSurface } = runtime;

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

function createInstructionEmulator(cpuBackend) {
  const surface = createHeadlessSurface(8, 8);
  const emulator = new Emulator(surface, () => {}, { cpuBackend });
  const mem = new Uint8Array(0x4000);
  const regs = new Uint32Array(10);
  regs[REG_ESP] = 0x3800;
  regs[REG_EBP] = 0x3800;
  regs[REG_EFLAGS] = 0x202;
  emulator.running = true;
  emulator.cpu = {
    mem,
    view: new DataView(mem.buffer),
    regs,
    fpu: new Float64Array(8),
    fpuSize: 0,
    fpuStatusWord: 0,
    mmx: new Uint32Array(16),
    xmm: new Uint32Array(32),
    xmmF: new Float32Array(new ArrayBuffer(32 * 4)),
    memFaultLogged: false
  };
  emulator.ensureCpuBackendReady();
  return emulator;
}

function numberToF32Bits(value) {
  const buffer = new ArrayBuffer(4);
  const f32 = new Float32Array(buffer);
  const u32 = new Uint32Array(buffer);
  f32[0] = Math.fround(Number(value));
  return u32[0] >>> 0;
}

function setXmmF32(emulator, regIndex, lane, value) {
  emulator.writeXmmU32(regIndex, lane, numberToF32Bits(value));
}

function nowMs() {
  if (typeof performance !== "undefined" && performance && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function benchmarkScenario(cpuBackend, scenario) {
  const emulator = createInstructionEmulator(cpuBackend);
  const bytes = scenario.bytes;
  for (let i = 0; i < bytes.length; i += 1) {
    emulator.writeMem8(i, bytes[i] & 0xff);
  }
  if (typeof scenario.setup === "function") {
    scenario.setup(emulator);
  }
  const warmup = Math.max(1000, Math.min(5000, (scenario.iterations / 20) | 0));
  for (let i = 0; i < warmup; i += 1) {
    if (typeof scenario.beforeEach === "function") {
      scenario.beforeEach(emulator, i);
    }
    emulator.writeReg(REG_EIP, 0);
    if (!emulator.executeBasicInstruction(0)) {
      throw new Error(`Warmup failed for ${scenario.name} on ${cpuBackend}`);
    }
  }
  const start = nowMs();
  for (let i = 0; i < scenario.iterations; i += 1) {
    if (typeof scenario.beforeEach === "function") {
      scenario.beforeEach(emulator, i);
    }
    emulator.writeReg(REG_EIP, 0);
    if (!emulator.executeBasicInstruction(0)) {
      throw new Error(`Benchmark failed for ${scenario.name} on ${cpuBackend} at iteration ${i}`);
    }
  }
  const elapsedMs = Math.max(0.001, nowMs() - start);
  return {
    elapsedMs,
    iterationsPerSec: (scenario.iterations * 1000) / elapsedMs
  };
}

const scenarios = [
  {
    name: "addps xmm0,xmm1",
    bytes: [0x0f, 0x58, 0xc1],
    iterations: Number(process.argv[2] || 250000),
    setup(emulator) {
      setXmmF32(emulator, 0, 0, 1.25);
      setXmmF32(emulator, 0, 1, 2.5);
      setXmmF32(emulator, 0, 2, 3.75);
      setXmmF32(emulator, 0, 3, 4.5);
      setXmmF32(emulator, 1, 0, 0.25);
      setXmmF32(emulator, 1, 1, 0.5);
      setXmmF32(emulator, 1, 2, 0.75);
      setXmmF32(emulator, 1, 3, 1.25);
    }
  },
  {
    name: "addps xmm0,[m128]",
    bytes: [0x0f, 0x58, 0x05, 0x00, 0x02, 0x00, 0x00],
    iterations: Number(process.argv[2] || 220000),
    setup(emulator) {
      setXmmF32(emulator, 0, 0, 1.25);
      setXmmF32(emulator, 0, 1, 2.5);
      setXmmF32(emulator, 0, 2, 3.75);
      setXmmF32(emulator, 0, 3, 4.5);
      emulator.writeMem32(0x200, numberToF32Bits(0.25));
      emulator.writeMem32(0x204, numberToF32Bits(0.5));
      emulator.writeMem32(0x208, numberToF32Bits(0.75));
      emulator.writeMem32(0x20c, numberToF32Bits(1.25));
    }
  },
  {
    name: "addss xmm0,[m32]",
    bytes: [0xf3, 0x0f, 0x58, 0x05, 0x00, 0x02, 0x00, 0x00],
    iterations: Number(process.argv[2] || 260000),
    setup(emulator) {
      setXmmF32(emulator, 0, 0, 1.25);
      setXmmF32(emulator, 0, 1, 99.0);
      emulator.writeMem32(0x200, numberToF32Bits(0.5));
    }
  },
  {
    name: "imul eax,ecx",
    bytes: [0x0f, 0xaf, 0xc1],
    iterations: Number(process.argv[2] || 400000),
    setup(emulator) {
      emulator.writeReg(REG_EAX, 0x10203040);
      emulator.writeReg(REG_ECX, 0x00010003);
    }
  },
  {
    name: "repe cmpsb",
    bytes: [0xf3, 0xa6],
    iterations: Number(process.argv[2] || 120000),
    setup(emulator) {
      const left = emulator.cpu.mem;
      const rightBase = 0x200;
      const pattern = [1, 2, 3, 4, 5, 6, 7, 9];
      const compare = [1, 2, 3, 4, 5, 6, 7, 8];
      for (let i = 0; i < pattern.length; i += 1) {
        left[0x100 + i] = pattern[i];
        left[rightBase + i] = compare[i];
      }
    },
    beforeEach(emulator) {
      emulator.writeReg(REG_ECX, 8);
      emulator.writeReg(REG_ESI, 0x100);
      emulator.writeReg(REG_EDI, 0x200);
      emulator.writeReg(REG_EFLAGS, 0x202);
    }
  }
];

console.log("CPU backend benchmark");
for (const scenario of scenarios) {
  const js = benchmarkScenario("js", scenario);
  const wasm = benchmarkScenario("wasm", scenario);
  const speedup = wasm.elapsedMs > 0 ? (js.elapsedMs / wasm.elapsedMs) : 0;
  console.log(
    `${scenario.name}: ` +
    `js=${js.elapsedMs.toFixed(2)}ms (${js.iterationsPerSec.toFixed(0)}/s), ` +
    `wasm=${wasm.elapsedMs.toFixed(2)}ms (${wasm.iterationsPerSec.toFixed(0)}/s), ` +
    `speedup=${speedup.toFixed(2)}x`
  );
}

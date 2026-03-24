const { loadKosRuntime } = require("./ui-harness");

const { Emulator, createHeadlessSurface } = loadKosRuntime();

const REG_EIP = 8;
const REG_ESP = 4;
const REG_EFLAGS = 9;

function assertClose(actual, expected, label) {
  const diff = Math.abs(actual - expected);
  if (!(diff <= 1e-9)) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function createBareEmulator(cpuBackend) {
  const surface = createHeadlessSurface(8, 8);
  const emulator = new Emulator(surface, () => {}, { cpuBackend });
  const mem = new Uint8Array(0x1000);
  const regs = new Uint32Array(10);
  regs[REG_ESP] = 0x1000;
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

try {
  for (const cpuBackend of ["js", "wasm"]) {
    const rounder = createBareEmulator(cpuBackend);
    rounder.writeMem8(0, 0xd9);
    rounder.writeMem8(1, 0xfc); // frndint
    rounder.writeReg(REG_EIP, 0);
    rounder.fpuPush(1.5);
    if (!rounder.executeBasicInstruction(0)) {
      throw new Error(`FRNDINT instruction was not handled for backend ${cpuBackend}.`);
    }
    assertClose(rounder.fpuPeek(), 2, `FRNDINT should round ST0 to nearest-even integer (${cpuBackend})`);

    const scaler = createBareEmulator(cpuBackend);
    scaler.writeMem8(0, 0xd9);
    scaler.writeMem8(1, 0xfd); // fscale
    scaler.writeReg(REG_EIP, 0);
    scaler.fpuPush(3.9);
    scaler.fpuPush(1.25);
    if (!scaler.executeBasicInstruction(0)) {
      throw new Error(`FSCALE instruction was not handled for backend ${cpuBackend}.`);
    }
    assertClose(scaler.fpuPeek(), 10, `FSCALE should scale ST0 by 2^trunc(ST1) (${cpuBackend})`);

    const incTop = createBareEmulator(cpuBackend);
    incTop.writeMem8(0, 0xd9);
    incTop.writeMem8(1, 0xf7); // fincstp
    incTop.writeReg(REG_EIP, 0);
    incTop.fpuPush(3);
    incTop.fpuPush(2);
    incTop.fpuPush(1);
    if (!incTop.executeBasicInstruction(0)) {
      throw new Error(`FINCSTP instruction was not handled for backend ${cpuBackend}.`);
    }
    assertClose(incTop.fpuPeek(), 2, `FINCSTP should advance TOP to the next stack entry (${cpuBackend})`);
    if ((incTop.cpu.fpuSize | 0) !== 2) {
      throw new Error(`FINCSTP should reduce the visible stack size in the simplified model (${cpuBackend}), got ${incTop.cpu.fpuSize}.`);
    }
  }

  console.log("Autotest OK: x87 D9 FC/FD/F7 keep FRNDINT, FSCALE, and FINCSTP semantics aligned on JS and WASM helper backends.");
} catch (err) {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(2);
}

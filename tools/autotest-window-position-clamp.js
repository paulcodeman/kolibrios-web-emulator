const { loadKosRuntime } = require("./ui-harness");

const { Emulator, createHeadlessSurface } = loadKosRuntime();

const REG = {
  ECX: 1,
  EDX: 2,
  EBX: 3,
  ESI: 6,
  EDI: 7
};

function assertEq(actual, expected, message) {
  if ((actual | 0) !== (expected | 0)) {
    throw new Error(`${message}: expected ${expected | 0}, got ${actual | 0}`);
  }
}

function packSigned16Pair(high, low) {
  return ((((high & 0xffff) << 16) >>> 0) | (low & 0xffff)) >>> 0;
}

try {
  const regs = new Uint32Array(10);
  const emulator = new Emulator(createHeadlessSurface(8, 8), () => {});

  emulator.readReg = (reg) => regs[reg] >>> 0;
  emulator.writeReg = (reg, value) => {
    regs[reg] = value >>> 0;
  };
  emulator.getHostScreenInfo = () => ({
    width: 1000,
    height: 700
  });

  regs[REG.EBX] = packSigned16Pair(999, 275);
  regs[REG.ECX] = packSigned16Pair(345, 326);
  regs[REG.EDX] = (3 << 24) >>> 0;
  regs[REG.ESI] = 0;
  regs[REG.EDI] = 0;
  emulator.sysCreateWindow();

  assertEq(emulator.windowHostX, 724, "new windows should clamp to the right screen edge instead of jumping to x=0");
  assertEq(emulator.windowHostY, 345, "calendar Y position should stay unchanged when it already fits");
  assertEq(emulator.windowWidth, 276, "outer width should stay at requested width when it fits the screen");
  assertEq(emulator.windowHeight, 327, "outer height should stay at requested height when it fits the screen");

  console.log("Autotest OK: sysCreateWindow clamps off-screen windows to the visible edge instead of resetting them to origin.");
} catch (err) {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(2);
}

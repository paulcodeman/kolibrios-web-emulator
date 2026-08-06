const { loadKosRuntime } = require("./ui-harness");

const { Emulator, createHeadlessSurface } = loadKosRuntime();

const REG = {
  ECX: 1,
  EDX: 2,
  EBX: 3
};

function assertEqual(actual, expected, label) {
  if ((actual >>> 0) !== (expected >>> 0)) {
    throw new Error(
      `${label}: expected 0x${(expected >>> 0).toString(16)}, got 0x${(actual >>> 0).toString(16)}`
    );
  }
}

function assertClear(surface, label) {
  for (let i = 0; i < surface.buffer32.length; i += 1) {
    assertEqual(surface.buffer32[i], 0xff000000, `${label} pixel ${i}`);
  }
}

try {
  const surface = createHeadlessSurface(4, 2);
  const emulator = new Emulator(surface, () => {});
  const mem = new Uint8Array(0x1000);
  const regs = new Uint32Array(10);
  emulator.cpu = {
    mem,
    view: new DataView(mem.buffer),
    regs
  };
  emulator.windowDefined = true;
  emulator.windowOriginX = 0;
  emulator.windowOriginY = 0;
  emulator.windowClientOffsetX = 0;
  emulator.windowClientOffsetY = 0;

  const srcPtr = 0x100;
  mem.set([
    0x33, 0x22, 0x11,
    0x66, 0x55, 0x44
  ], srcPtr);
  regs[REG.EBX] = srcPtr;
  regs[REG.EDX] = 0;

  surface.clear(0);
  regs[REG.ECX] = 0xffff0001;
  emulator.sysDrawImage();
  assertClear(surface, "wrapped negative width");

  regs[REG.ECX] = 0x00018000;
  emulator.sysDrawImage();
  assertClear(surface, "wrapped negative height");

  regs[REG.ECX] = 0x00020001;
  emulator.sysDrawImage();
  assertEqual(surface.buffer32[0], 0xff332211, "valid image first pixel");
  assertEqual(surface.buffer32[1], 0xff665544, "valid image second pixel");

  console.log("Autotest OK: function 7 rejects wrapped negative dimensions and accepts valid images.");
} catch (err) {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(2);
}

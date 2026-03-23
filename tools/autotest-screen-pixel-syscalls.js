const { loadKosRuntime } = require("./ui-harness");

const { Emulator, createHeadlessSurface } = loadKosRuntime();

const REG = {
  EAX: 0,
  ECX: 1,
  EDX: 2,
  EBX: 3
};

function assertEq(actual, expected, message) {
  if ((actual >>> 0) !== (expected >>> 0)) {
    throw new Error(`${message}: expected 0x${(expected >>> 0).toString(16)}, got 0x${(actual >>> 0).toString(16)}`);
  }
}

try {
  const surface = createHeadlessSurface(4, 3);
  const emulator = new Emulator(surface, () => {});
  const regs = new Uint32Array(10);

  emulator.readReg = (reg) => regs[reg] >>> 0;
  emulator.writeReg = (reg, value) => {
    regs[reg] = value >>> 0;
  };
  emulator.getHostScreenSize = () => ({
    width: 40,
    height: 30
  });

  emulator.sysScreenSize();
  assertEq(regs[REG.EAX], ((39 << 16) | 29) >>> 0, "screen size should use host screen dimensions");

  emulator.hostSession = {
    getScreenWorkArea() {
      return {
        left: 2,
        top: 3,
        right: 35,
        bottom: 26
      };
    }
  };
  regs[REG.EBX] = 5;
  emulator.sysStyleSettings();
  assertEq(regs[REG.EAX], ((2 << 16) | 35) >>> 0, "work area X range should come from host work area");
  assertEq(regs[REG.EBX], ((3 << 16) | 26) >>> 0, "work area Y range should come from host work area");

  emulator.hostSession = null;
  regs[REG.EBX] = 5;
  emulator.sysStyleSettings();
  assertEq(regs[REG.EAX], 39, "work area fallback X range should use host screen extents");
  assertEq(regs[REG.EBX], 29, "work area fallback Y range should use host screen extents");

  emulator.windowDefined = true;
  emulator.windowHostX = 5;
  emulator.windowHostY = 7;
  emulator.windowWidth = 4;
  emulator.windowHeight = 3;
  emulator.threadSlot = 9;
  emulator.windowShape = {
    width: 4,
    height: 3,
    data: new Uint8Array([
      1, 1, 1, 1,
      1, 1, 0, 1,
      1, 1, 1, 1
    ])
  };
  surface.clear(0);
  surface.setPixel(1, 1, 0x123456);

  regs[REG.EBX] = 6;
  regs[REG.ECX] = 8;
  emulator.sysPixelOwner();
  assertEq(regs[REG.EAX], 9, "pixel owner fallback should return current thread for visible window pixels");

  regs[REG.EBX] = 7;
  regs[REG.ECX] = 8;
  emulator.sysPixelOwner();
  assertEq(regs[REG.EAX], 1, "pixel owner fallback should expose desktop through transparent window shape pixels");

  regs[REG.EBX] = (8 * 40 + 6) >>> 0;
  emulator.sysPixelColor();
  assertEq(regs[REG.EAX], 0x123456, "pixel color fallback should decode surface pixels using host coordinates");

  console.log("Autotest OK: screen and pixel syscalls share the host-screen fallback helpers correctly.");
} catch (err) {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(2);
}

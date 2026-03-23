const { loadKosRuntime } = require("./ui-harness");

const { Emulator, createHeadlessSurface } = loadKosRuntime();

function assertEq(actual, expected, label) {
  if ((actual >>> 0) !== (expected >>> 0)) {
    throw new Error(`${label}: expected 0x${(expected >>> 0).toString(16)}, got 0x${(actual >>> 0).toString(16)}`);
  }
}

function getSurfaceRgb(surface, x, y) {
  const value = surface.buffer32[(y * surface.width + x) >>> 0] >>> 0;
  const r = value & 0xff;
  const g = (value >>> 8) & 0xff;
  const b = (value >>> 16) & 0xff;
  return ((r << 16) | (g << 8) | b) >>> 0;
}

function writeBgrx(mem, offset, color) {
  const base = offset >>> 0;
  mem[base] = color & 0xff;
  mem[base + 1] = (color >>> 8) & 0xff;
  mem[base + 2] = (color >>> 16) & 0xff;
  mem[base + 3] = 0;
}

try {
  const surface = createHeadlessSurface(8, 4);
  surface.clear(0xffffff);

  const emulator = new Emulator(surface, () => {});
  const mem = new Uint8Array(256);
  const view = new DataView(mem.buffer);
  emulator.readMem8 = (addr) => mem[addr >>> 0] & 0xff;
  emulator.readMem16 = (addr) => view.getUint16(addr >>> 0, true) >>> 0;
  emulator.readMem32 = (addr) => view.getUint32(addr >>> 0, true) >>> 0;

  const fullWidth = 5;
  const fullHeight = 2;
  const fullStride = fullWidth * 4;
  const basePtr = 32;
  const colors = [
    0x110000, 0x220000, 0x330000, 0x440000, 0x550000,
    0x001100, 0x002200, 0x003300, 0x004400, 0x005500
  ];
  for (let y = 0; y < fullHeight; y += 1) {
    for (let x = 0; x < fullWidth; x += 1) {
      const offset = basePtr + y * fullStride + x * 4;
      writeBgrx(mem, offset, colors[y * fullWidth + x]);
    }
  }

  const rectX = 1;
  const rectY = 0;
  const rectWidth = 2;
  const rectHeight = 2;
  const rectPtr = basePtr + rectY * fullStride + rectX * 4;
  const rowOffset = (fullWidth - rectWidth) * 4;
  const size = ((rectWidth & 0xffff) << 16) | (rectHeight & 0xffff);

  emulator.drawImageFromMemory(rectPtr >>> 0, size >>> 0, 0, 32, 0, rowOffset);

  assertEq(getSurfaceRgb(surface, 0, 0), 0x220000, "top-left pixel");
  assertEq(getSurfaceRgb(surface, 1, 0), 0x330000, "top-right pixel");
  assertEq(getSurfaceRgb(surface, 0, 1), 0x002200, "bottom-left pixel");
  assertEq(getSurfaceRgb(surface, 1, 1), 0x003300, "bottom-right pixel");

  console.log("Autotest OK: function 65 row offset semantics match partial PresentRect blits.");
} catch (err) {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(2);
}

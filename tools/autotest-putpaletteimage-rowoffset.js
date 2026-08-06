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
  const mem = new Uint8Array(2048);
  const view = new DataView(mem.buffer);
  emulator.cpu = {
    mem,
    view,
    u32: new Uint32Array(mem.buffer),
    regs: new Uint32Array(10),
    fpu: new Float64Array(8),
    fpuSize: 0,
    fpuTop: 0,
    fpuStatusWord: 0,
    mmx: new Uint32Array(16),
    xmm: new Uint32Array(32),
    xmmF: new Float32Array(32),
    memFaultLogged: false
  };

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

  const indexedPtr = 256;
  const palettePtr = 512;
  mem.set([0, 1, 2, 3], indexedPtr);
  const paletteColors = [0x102030, 0x405060, 0x708090, 0xa0b0c0];
  for (let i = 0; i < paletteColors.length; i += 1) {
    view.setUint32(palettePtr + i * 4, paletteColors[i], true);
  }
  emulator.drawImageFromMemory(indexedPtr, (2 << 16) | 2, 4 << 16, 8, palettePtr, 0);

  assertEq(getSurfaceRgb(surface, 4, 0), 0x102030, "indexed top-left pixel");
  assertEq(getSurfaceRgb(surface, 5, 0), 0x405060, "indexed top-right pixel");
  assertEq(getSurfaceRgb(surface, 4, 1), 0x708090, "indexed bottom-left pixel");
  assertEq(getSurfaceRgb(surface, 5, 1), 0xa0b0c0, "indexed bottom-right pixel");

  console.log("Autotest OK: function 65 fast 8/32-bpp paths preserve palette and row-offset semantics.");
} catch (err) {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(2);
}

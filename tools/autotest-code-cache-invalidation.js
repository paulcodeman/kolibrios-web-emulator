const { loadKosRuntime } = require("./ui-harness");

const { Emulator, createHeadlessSurface } = loadKosRuntime();

function assertTrue(value, label) {
  if (!value) {
    throw new Error(label);
  }
}

function createBareEmulator() {
  const emulator = new Emulator(createHeadlessSurface(8, 8), () => {});
  const mem = new Uint8Array(0x4000);
  const regs = new Uint32Array(10);
  const xmm = new Uint32Array(32);
  regs[4] = 0x3f00;
  regs[8] = 0;
  regs[9] = 0x202;
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
    xmm,
    xmmF: new Float32Array(xmm.buffer),
    memFaultLogged: false
  };
  emulator.running = true;
  return emulator;
}

try {
  const decode = createBareEmulator();
  decode.cpu.mem.set([0x01, 0x05, 0x00, 0x08, 0x00, 0x00], 0);
  decode.getCachedModRmInfo(0, decode.cpu.mem.subarray(0, 16), 1);
  assertTrue(decode.decodeCache.has(0), "decode fixture should populate the cache");
  decode.writeMem32(0x800, 1);
  assertTrue(decode.decodeCache.has(0), "data in another 64-byte chunk must retain decoded code");
  decode.writeMem32(0x30, 2);
  assertTrue(decode.decodeCache.has(0), "non-overlapping data in the same 64-byte chunk must retain decoded code");
  decode.writeMem8(1, 0x0d);
  assertTrue(!decode.decodeCache.has(0), "an overlapping code write must invalidate decoded code");

  decode.cacheDecodeEntry(0x0ff8, { marker: 1 });
  assertTrue(decode.decodeCache.has(0x0ff8), "cross-page fixture should populate the cache");
  decode.writeMem8(0x1000, 0x90);
  assertTrue(!decode.decodeCache.has(0x0ff8), "a write to the tail of a cross-page instruction must invalidate it");

  const blocks = createBareEmulator();
  blocks.cpu.mem.set([0x40, 0x43], 0);
  assertTrue(
    blocks.cacheBasicBlock([{ addr: 0, next: 1 }, { addr: 1, next: 2 }]),
    "basic-block fixture should populate the cache"
  );
  blocks.writeMem32(0x800, 1);
  assertTrue(blocks.basicBlockCache.has(0), "separate data chunk must retain the basic block");
  blocks.writeMem8(0, 0x90);
  assertTrue(!blocks.basicBlockCache.has(0), "an overlapping write must invalidate the basic block");

  const starts = createBareEmulator();
  starts.cpu.mem.fill(0x90, 0, 32);
  assertTrue(starts.getCachedBasicBlockStartState(0), "start-state fixture should populate the cache");
  assertTrue(starts.basicBlockStartCache.has(0), "start-state cache should contain address zero");
  starts.writeMem8(0, 0x40);
  assertTrue(!starts.basicBlockStartCache.has(0), "an overlapping write must invalidate start-state data");

  console.log("Autotest OK: 64-byte cache guards retain data writes and invalidate overlapping or cross-page code writes.");
} catch (err) {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(2);
}

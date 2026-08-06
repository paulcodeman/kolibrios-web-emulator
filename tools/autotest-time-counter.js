const { loadKosRuntime } = require("./ui-harness");

const { Emulator, createHeadlessSurface } = loadKosRuntime();

const REG = {
  EAX: 0,
  EDX: 2,
  EBX: 3
};

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function readHighPrecisionNs(emulator, elapsedMs) {
  emulator.readTimeCounter32 = () => elapsedMs >>> 0;
  emulator.writeReg(REG.EBX, 10);
  emulator.sysSystemInfo();
  return (
    (BigInt(emulator.readReg(REG.EDX) >>> 0) << 32n) |
    BigInt(emulator.readReg(REG.EAX) >>> 0)
  );
}

try {
  const emulator = new Emulator(createHeadlessSurface(8, 8), () => {});
  emulator.cpu = { regs: new Uint32Array(10) };

  emulator.readTimeCounter32 = () => 5000000;
  emulator.writeReg(REG.EBX, 9);
  emulator.sysSystemInfo();
  assertEqual(emulator.readReg(REG.EAX) >>> 0, 500000, "centisecond counter");

  const first = readHighPrecisionNs(emulator, 5000000);
  const second = readHighPrecisionNs(emulator, 5000001);
  assertEqual(first, 5000000000000n, "nanosecond counter scale");
  assertEqual(second - first, 1000000n, "one millisecond delta");

  console.log("Autotest OK: system time counters use centiseconds and nanoseconds at the correct scale.");
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

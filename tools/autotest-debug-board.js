const { HeadlessUiHarness, loadKosRuntime } = require("./ui-harness");

const { Emulator, createHeadlessSurface } = loadKosRuntime();

const REG_EAX = 0;
const REG_ECX = 1;
const REG_EBX = 3;

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

function createBareEmulator(hostSession) {
  const surface = createHeadlessSurface(32, 32);
  const regs = new Uint32Array(10);
  const emulator = new Emulator(surface, () => {});
  emulator.hostSession = hostSession || null;
  emulator.readReg = (reg) => regs[reg] >>> 0;
  emulator.writeReg = (reg, value) => {
    regs[reg] = value >>> 0;
  };
  return { emulator, regs };
}

function boardWrite(emulator, regs, byte) {
  regs[REG_EBX] = 1;
  regs[REG_ECX] = byte & 0xff;
  emulator.sysDebugBoard();
}

function boardRead(emulator, regs) {
  regs[REG_EBX] = 2;
  emulator.sysDebugBoard();
  return {
    hasByte: (regs[REG_EBX] >>> 0) !== 0,
    byte: regs[REG_EAX] & 0xff
  };
}

function drainBoard(hostSession) {
  const out = [];
  for (;;) {
    const next = hostSession.readDebugBoardByte();
    if (!next || !next.hasByte) {
      break;
    }
    out.push(String.fromCharCode(next.byte & 0xff));
  }
  return out.join("");
}

try {
  {
    const harness = new HeadlessUiHarness();
    const writer = createBareEmulator(harness);
    const reader = createBareEmulator(harness);
    const text = "I: hello from app\r\n";

    for (let i = 0; i < text.length; i += 1) {
      boardWrite(writer.emulator, writer.regs, text.charCodeAt(i) & 0xff);
    }

    let actual = "";
    for (let i = 0; i < text.length; i += 1) {
      const next = boardRead(reader.emulator, reader.regs);
      assert(next.hasByte, `reader should receive byte ${i + 1}`);
      actual += String.fromCharCode(next.byte & 0xff);
    }

    const tail = boardRead(reader.emulator, reader.regs);
    assertEq(actual, text, "debug board should carry guest bytes between emulators");
    assertEq(tail.hasByte, false, "debug board should be empty after consuming all bytes");
  }

  {
    const harness = new HeadlessUiHarness();
    const writer = createBareEmulator(harness);
    let text = "";
    for (let i = 0; i < 600; i += 1) {
      const byte = 65 + (i % 26);
      text += String.fromCharCode(byte);
      boardWrite(writer.emulator, writer.regs, byte);
    }

    const drained = drainBoard(harness);
    assertEq(drained.length, 512, "debug board should cap retained bytes to the queue capacity");
    assertEq(
      drained,
      text.slice(text.length - drained.length),
      "debug board overflow should preserve the newest bytes"
    );
  }

  {
    const harness = new HeadlessUiHarness();
    const process = {
      pid: 7,
      slot: 3,
      displayPath: "/SYS/TEST",
      logs: []
    };

    harness.logForProcess(process, "Interpreter error: test failure");

    const mirrored = drainBoard(harness);
    assertEq(
      mirrored,
      "E: /SYS/TEST: Interpreter error: test failure\r\n",
      "host-side emulator errors should be mirrored into the debug board"
    );
  }

  console.log("Autotest OK: debug board accepts guest writes, preserves newest bytes, and mirrors emulator errors.");
} catch (err) {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(2);
}

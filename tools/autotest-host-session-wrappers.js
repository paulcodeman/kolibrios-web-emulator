const { loadKosRuntime } = require("./ui-harness");

const { Emulator, createHeadlessSurface } = loadKosRuntime();

function assertEq(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  const logs = [];
  const emulator = new Emulator(createHeadlessSurface(8, 8), (message) => {
    logs.push(String(message));
  });
  emulator.threadSlot = 7;
  emulator.processId = 123;

  assertEq(emulator.getHostMaxThreadSlot(), 7, "missing host session should fall back to current thread slot");
  assertEq(emulator.getHostActiveThreadSlot(), 7, "missing active thread query should fall back to current thread slot");
  assertEq(emulator.getHostThreadSlotByProcessId(123), 7, "own pid should fall back to current thread slot");
  assertEq(emulator.getHostThreadSlotByProcessId(999), 0, "other pid should fall back to zero");
  assertEq(emulator.focusHostThreadSlot(4), 7, "focus fallback should return current thread slot");
  assertEq(emulator.unfocusHostThreadSlot(4), 7, "unfocus fallback should return active thread slot fallback");
  assertEq(emulator.createHostThread(1, 2) >>> 0, 0xffffffff >>> 0, "create thread fallback should return failure handle");
  assertEq(emulator.startHostApplication("/sys/test", "", 0).errorCode >>> 0, 5, "missing startApplication should return not-supported");

  let wakeCount = 0;
  emulator.hostSession = {
    getMaxThreadSlot() {
      return 12;
    },
    getActiveThreadSlot() {
      return 5;
    },
    getThreadSlotByProcessId(pid) {
      return pid === 555 ? 8 : 0;
    },
    getThreadInfo(slot) {
      return { slot, ok: true };
    },
    getWindowStackSlot(position) {
      return position + 10;
    },
    focusThreadSlot(slot) {
      return slot + 1;
    },
    unfocusThreadSlot(slot) {
      return slot - 1;
    },
    terminateThreadSlot(slot) {
      return slot === 4;
    },
    terminateProcessId(pid) {
      return pid === 9;
    },
    startApplication() {
      return { errorCode: 0, pid: 77 };
    },
    createThread() {
      return { tid: 88 };
    },
    sendIpcMessage(payload) {
      return payload && payload.targetPid === 66 ? 0 : 4;
    },
    wakeSiblingThreads() {
      wakeCount += 1;
    }
  };

  assertEq(emulator.getHostMaxThreadSlot(), 12, "host max thread slot should use host session result");
  assertEq(emulator.getHostActiveThreadSlot(), 5, "host active thread slot should use host session result");
  assertEq(emulator.getHostThreadSlotByProcessId(555), 8, "host pid lookup should use host session result");
  assert(emulator.getHostThreadInfo(3).ok === true, "host thread info should use host session result");
  assertEq(emulator.getHostWindowStackSlot(2), 12, "host window stack lookup should use host session result");
  assertEq(emulator.focusHostThreadSlot(4), 5, "focus wrapper should return host session result");
  assertEq(emulator.unfocusHostThreadSlot(4), 3, "unfocus wrapper should return host session result");
  assertEq(emulator.terminateHostThreadSlot(4), true, "terminate thread wrapper should use host session result");
  assertEq(emulator.terminateHostProcessId(9), true, "terminate process wrapper should use host session result");
  assertEq(emulator.startHostApplication("/sys/test", "", 0).pid >>> 0, 77, "start application wrapper should normalize host result");
  assertEq(emulator.createHostThread(1, 2) >>> 0, 88, "create thread wrapper should normalize host result");

  emulator.readMemBlock = (addr, size) => {
    const bytes = new Uint8Array(size >>> 0);
    bytes.fill(0xaa);
    return bytes;
  };
  assertEq(emulator.sendHostIpcMessage(66, 0x1000, 3) >>> 0, 0, "sendHostIpcMessage should forward to host session");
  emulator.wakeHostSiblingThreads(true);
  assertEq(wakeCount, 1, "wakeHostSiblingThreads should forward to host session");

  emulator.hostSession.getActiveThreadSlot = () => {
    throw new Error("boom");
  };
  assertEq(emulator.getHostActiveThreadSlot(), 7, "host session errors should fall back for active thread slot");

  emulator.hostSession.startApplication = () => {
    throw new Error("boom");
  };
  assertEq(emulator.startHostApplication("/sys/test", "", 0).errorCode >>> 0, 31, "startApplication errors should preserve the dedicated error fallback");
  assert(logs.some((line) => line.includes("Host session startApplication")), "host session failures should be logged");

  console.log("Autotest OK: host session wrappers share common fallback handling without changing results.");
} catch (err) {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(2);
}

const { loadKosRuntime } = require("./ui-harness");

const { Emulator, createHeadlessSurface } = loadKosRuntime();

const REG_EIP = 8;

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

function createTimedEmulator(windowDefined) {
  const surface = createHeadlessSurface(32, 32);
  const emulator = new Emulator(surface, () => {});
  let now = 0;
  let eip = 0;
  let executed = 0;
  let scheduled = null;

  emulator.running = true;
  emulator.cpu = {};
  emulator.windowDefined = !!windowDefined;
  emulator.useImmediateScheduler = true;
  emulator.maxInstructions = 20;
  emulator.backgroundMaxInstructions = 20;
  emulator.maxSliceMs = 5;
  emulator.backgroundMaxSliceMs = 9;
  emulator.sliceTimeCheckInterval = 1;
  emulator.syscallSiteSet = new Set();
  emulator.softInstructions = false;

  emulator.getWallClockMs = () => now;
  emulator.readReg = (reg) => (reg === REG_EIP ? (eip >>> 0) : 0);
  emulator.writeReg = (reg, value) => {
    if (reg === REG_EIP) {
      eip = value >>> 0;
    }
  };
  emulator.readMem8 = () => 0x90;
  emulator.executeBasicInstruction = () => {
    executed += 1;
    now += 3;
    eip = (eip + 1) >>> 0;
    return true;
  };
  emulator.scheduleStep = (delay) => {
    scheduled = {
      delay: delay | 0,
      mode: emulator.yieldMode || ""
    };
  };

  return {
    emulator,
    getExecuted() {
      return executed;
    },
    getScheduled() {
      return scheduled;
    },
    resetRun(nextWindowDefined) {
      now = 0;
      eip = 0;
      executed = 0;
      scheduled = null;
      emulator.running = true;
      emulator.windowDefined = !!nextWindowDefined;
    }
  };
}

try {
  const foreground = createTimedEmulator(true);
  foreground.emulator.basicBlockImmediateCacheEntries = 2;
  foreground.emulator.basicBlockHotThreshold = 1;

  foreground.emulator.stepInterpreter();

  assertEq(foreground.getExecuted(), 2, "foreground time slice should stop a linear basic block after the deadline");
  assertEq(foreground.emulator.basicBlockCache.size, 1, "foreground run should cache the partial hot block");
  assert(
    foreground.getScheduled() && foreground.getScheduled().delay === 0 && foreground.getScheduled().mode === "",
    "foreground timeslice yield should stay on the immediate scheduler"
  );

  foreground.resetRun(true);
  foreground.emulator.stepInterpreter();

  assertEq(foreground.getExecuted(), 2, "cached basic block execution should honor the same time slice deadline");
  assert(foreground.emulator.basicBlockHits >= 1, "second foreground run should execute through the cached block path");

  const background = createTimedEmulator(false);
  background.emulator.executeCachedBasicBlock = () => 0;
  background.emulator.executeAndBuildBasicBlock = () => 0;

  background.emulator.stepInterpreter();

  assertEq(background.getExecuted(), 3, "background startup should use the larger pre-window slice budget");
  assert(
    background.getScheduled() && background.getScheduled().delay === 0 && background.getScheduled().mode === "",
    "background timeslice yield should remain an immediate reschedule"
  );

  console.log("Autotest OK: interpreter time slicing limits long slices without breaking basic-block execution.");
} catch (err) {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(2);
}

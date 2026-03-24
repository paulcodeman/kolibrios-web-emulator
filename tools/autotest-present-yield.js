const { loadKosRuntime } = require("./ui-harness");

const { Emulator, createHeadlessSurface } = loadKosRuntime();

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

try {
  {
    const surface = createHeadlessSurface(64, 64);
    let presentCalls = 0;
    surface.present = () => {
      presentCalls += 1;
    };

    const emulator = new Emulator(surface, () => {});
    emulator.running = true;
    emulator.cpu = {};
    emulator.windowDefined = true;
    emulator.useImmediateScheduler = true;
    emulator.maxInstructions = 3;
    emulator.backgroundMaxInstructions = 3;
    emulator.syscallSiteSet = new Set();
    emulator.softInstructions = false;
    emulator.readReg = () => 0;
    emulator.readMem8 = () => 0x90;
    emulator.executeCachedBasicBlock = () => 0;
    emulator.executeAndBuildBasicBlock = () => 0;

    let executed = 0;
    emulator.executeBasicInstruction = () => {
      executed += 1;
      emulator.presentIfNeeded(false);
      return true;
    };

    let scheduled = null;
    emulator.scheduleStep = (delay) => {
      scheduled = {
        delay: delay | 0,
        mode: emulator.yieldMode || ""
      };
    };

    emulator.stepInterpreter();

    assertEq(executed, 3, "present should not stop the current interpreter slice");
    assertEq(presentCalls, 1, "present throttling should still coalesce repeated flushes");
    assert(scheduled && scheduled.mode === "", "present throttling should not switch the scheduler into frame-wait mode");
    assertEq(scheduled && scheduled.delay, 0, "deferred present should not add an extra scheduler sleep");
  }

  {
    const surface = createHeadlessSurface(64, 64);
    let presentCalls = 0;
    surface.present = () => {
      presentCalls += 1;
    };

    const emulator = new Emulator(surface, () => {});
    let now = 0;
    emulator.getWallClockMs = () => now;
    emulator.running = true;
    emulator.cpu = {};
    emulator.windowDefined = true;
    emulator.useImmediateScheduler = true;
    emulator.maxInstructions = 20;
    emulator.backgroundMaxInstructions = 20;
    emulator.maxSliceMs = 5;
    emulator.sliceTimeCheckInterval = 1;
    emulator.syscallSiteSet = new Set();
    emulator.softInstructions = false;
    emulator.readReg = () => 0;
    emulator.readMem8 = () => 0x90;
    emulator.executeCachedBasicBlock = () => 0;
    emulator.executeAndBuildBasicBlock = () => 0;

    let executed = 0;
    emulator.executeBasicInstruction = () => {
      executed += 1;
      now += 3;
      emulator.presentIfNeeded(false);
      return true;
    };

    let scheduled = null;
    emulator.scheduleStep = (delay) => {
      scheduled = {
        delay: delay | 0,
        mode: emulator.yieldMode || ""
      };
    };

    emulator.stepInterpreter();

    assertEq(executed, 2, "timeslice should still stop the busy slice");
    assertEq(presentCalls, 1, "deferred present should flush once at the end of a timeslice-yielded slice");
    assertEq(emulator.surfaceDirty, false, "deferred present flush should clear the dirty surface flag");
    assert(scheduled && scheduled.mode === "", "timeslice present batching should stay on the immediate scheduler");
    assertEq(scheduled && scheduled.delay, 0, "timeslice present batching should not add an extra scheduler sleep");
  }

  console.log("Autotest OK: present batching flushes once per slice without adding extra frame delay.");
} catch (err) {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(2);
}

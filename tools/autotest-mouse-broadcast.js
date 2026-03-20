const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

const DEFAULT_TARGET = path.resolve(
  __dirname,
  "../../upstream-kolibrios/programs/demos/bcdclk/trunk/bcdclk.kex"
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms | 0)));
}

function assertEq(actual, expected, label) {
  if ((actual >>> 0) !== (expected >>> 0)) {
    throw new Error(`${label}: expected ${expected >>> 0}, got ${actual >>> 0}`);
  }
}

function freezeProcess(process) {
  if (!process || !process.emulator) {
    return;
  }
  if (typeof process.emulator.cancelScheduledStep === "function") {
    process.emulator.cancelScheduledStep();
  }
  process.emulator.immediatePending = false;
  if (!process.savedWakeExecution) {
    process.savedWakeExecution = process.emulator.wakeExecution;
  }
  process.emulator.wakeExecution = function frozenWakeExecution() {};
}

function resetMouseEvents(process, mask) {
  const emulator = process.emulator;
  emulator.eventQueue.length = 0;
  emulator.mouseEventFlags = 0;
  emulator.mouseScrollX = 0;
  emulator.mouseScrollY = 0;
  emulator.eventMask = mask >>> 0;
}

function checkEvent(process) {
  process.emulator.sysCheckEvent();
  return process.emulator.readReg(0) >>> 0;
}

async function main() {
  const target = path.resolve(process.argv[2] || DEFAULT_TARGET);
  const harness = new HeadlessUiHarness({
    launchDelayMs: 220,
    defaultTimeoutMs: 5000,
    actionDelayMs: 0
  });

  try {
    await harness.launch(target);
    const first = harness.getActiveProcess();
    if (!first || !first.emulator) {
      throw new Error("Primary process failed to launch.");
    }

    const second = harness.createProcess({
      image: first.image,
      fileName: first.fileName,
      targetPath: first.targetPath,
      processPath: first.processPath,
      displayPath: first.displayPath,
      processArgs: first.processArgs,
      pid: harness.nextPid++,
      slot: harness.nextSlot++,
      initialX: (first.actualX + 80) | 0,
      initialY: (first.actualY + 40) | 0
    });
    if (!second || !second.emulator) {
      throw new Error("Secondary process failed to launch.");
    }
    await sleep(250);
    if (!second.emulator.windowDefined) {
      throw new Error("Secondary process did not define a window in time.");
    }

    freezeProcess(first);
    freezeProcess(second);
    second.actualX = ((first.actualX | 0) + Math.max(80, (first.surface.width | 0) + 40)) | 0;
    second.actualY = first.actualY | 0;
    second.requestedX = second.actualX | 0;
    second.requestedY = second.actualY | 0;
    harness.setActiveProcess(first);

    const firstPointX = ((first.actualX | 0) + 12) | 0;
    const firstPointY = ((first.actualY | 0) + 12) | 0;
    const secondPointX = ((second.actualX | 0) + 12) | 0;
    const secondPointY = ((second.actualY | 0) + 12) | 0;

    resetMouseEvents(first, 0x27);
    resetMouseEvents(second, 0x27);
    harness.forwardGlobalMouseState(firstPointX, firstPointY, 0, 0, 0, true, 0, 0);
    assertEq(checkEvent(second), 6, "inactive window without filters should receive mouse event");

    resetMouseEvents(first, 0x27);
    resetMouseEvents(second, 0x80000027);
    harness.forwardGlobalMouseState(firstPointX, firstPointY, 0, 0, 0, true, 0, 0);
    assertEq(checkEvent(second), 0, "bit31 should block inactive mouse event");

    resetMouseEvents(first, 0x27);
    resetMouseEvents(second, 0x40000027);
    harness.forwardGlobalMouseState(firstPointX, firstPointY, 0, 0, 0, true, 0, 0);
    assertEq(checkEvent(second), 0, "bit30 should block outside-cursor mouse event");

    resetMouseEvents(first, 0x27);
    resetMouseEvents(second, 0x40000027);
    harness.forwardGlobalMouseState(secondPointX, secondPointY, 0, 0, 0, true, 0, 0);
    assertEq(checkEvent(second), 6, "bit30 should allow mouse event when cursor is inside the window");

    console.log("Autotest OK: global mouse routing respects inactive and cursor filters.");
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

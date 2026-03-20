const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

const DEFAULT_ROOT = process.env.KOS_ROOT || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms | 0)));
}

async function main() {
  const rootDir = path.resolve(process.argv[2] || DEFAULT_ROOT);
  const target = path.join(rootDir, "demos", "FIREWORK");
  const harness = new HeadlessUiHarness({
    launchDelayMs: 220,
    defaultTimeoutMs: 5000,
    actionDelayMs: 0
  });

  try {
    await harness.launch(target);
    await sleep(800);

    const process = harness.getActiveProcess();
    if (!process || !process.emulator) {
      throw new Error("FIREWORK did not create an active emulator process.");
    }
    const mouseEventBit = 1 << 5;
    if ((process.emulator.eventMask & mouseEventBit) !== 0) {
      throw new Error(`Expected FIREWORK mouse event bit to be masked off, got eventMask=${process.emulator.eventMask >>> 0}.`);
    }

    let wakeCount = 0;
    const originalWakeExecution = process.emulator.wakeExecution;
    process.emulator.wakeExecution = function patchedWakeExecution() {
      wakeCount += 1;
      return originalWakeExecution.apply(this, arguments);
    };

    for (let i = 0; i < 24; i += 1) {
      const screenX = (process.actualX + 24 + (i % 40)) | 0;
      const screenY = (process.actualY + 24 + (i % 24)) | 0;
      const localX = (screenX - (process.actualX | 0)) | 0;
      const localY = (screenY - (process.actualY | 0)) | 0;
      process.emulator.setMouseState(localX, localY, 0, true, 0, 0, 0, 0, true, screenX, screenY);
    }

    process.emulator.wakeExecution = originalWakeExecution;

    if (wakeCount !== 0) {
      throw new Error(`Masked mouse move still woke FIREWORK ${wakeCount} time(s).`);
    }

    console.log(`Autotest OK: FIREWORK masked mouse move did not wake emulator (eventMask=${process.emulator.eventMask >>> 0}).`);
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

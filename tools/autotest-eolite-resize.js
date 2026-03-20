const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

const DEFAULT_ROOT = process.env.KOS_ROOT || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms | 0)));
}

async function waitForWindowSize(harness, expected, timeoutMs) {
  const deadline = Date.now() + Math.max(100, timeoutMs | 0);
  while (Date.now() < deadline) {
    const snapshot = harness.captureSnapshot({ includeLogs: true });
    if (
      snapshot &&
      snapshot.window &&
      snapshot.window.defined &&
      (snapshot.window.width | 0) === (expected.width | 0) &&
      (snapshot.window.height | 0) === (expected.height | 0)
    ) {
      return snapshot;
    }
    await sleep(25);
  }
  throw new Error(`Timed out waiting for window ${expected.width}x${expected.height}.`);
}

async function main() {
  const rootDir = path.resolve(process.argv[2] || DEFAULT_ROOT);
  const target = path.join(rootDir, "File Managers", "EOLITE");
  const harness = new HeadlessUiHarness({
    launchDelayMs: 220,
    defaultTimeoutMs: 5000
  });

  try {
    await harness.launch(target);
    await sleep(4000);

    const process = harness.getActiveProcess();
    if (!process || !process.emulator || typeof process.emulator.applyHostWindowGeometry !== "function") {
      throw new Error("EOLITE host geometry control is unavailable.");
    }

    process.emulator.applyHostWindowGeometry({ width: 640, height: 520 }, { forceRedraw: true });
    const grown = await waitForWindowSize(harness, { width: 640, height: 520 }, 2500);
    if (grown.logs.some((line) => /^Unhandled /.test(line))) {
      throw new Error("Unhandled path hit while growing EOLITE window.");
    }

    process.emulator.applyHostWindowGeometry({ width: 300, height: 200 }, { forceRedraw: true });
    const corrected = await waitForWindowSize(harness, { width: 481, height: 357 }, 2500);
    if (corrected.logs.some((line) => /^Unhandled /.test(line))) {
      throw new Error("Unhandled path hit while shrinking EOLITE window.");
    }

    console.log(
      `Autotest OK: EOLITE resize path handled 640x520 grow and corrected back to ${corrected.window.width}x${corrected.window.height}.`
    );
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

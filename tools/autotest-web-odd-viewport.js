const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

const DEFAULT_ROOT = process.env.KOS_ROOT || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root";
const VIEWPORT_WIDTH = 999;
const VIEWPORT_HEIGHT = 699;
const REPORTED_WIDTH = 998;
const REPORTED_HEIGHT = 698;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms | 0)));
}

function hasUnhandledLogs(snapshot) {
  return Array.isArray(snapshot.logs) && snapshot.logs.some((line) => /^Unhandled |Interpreter error|Host session /.test(line));
}

async function main() {
  const rootDir = path.resolve(process.argv[2] || DEFAULT_ROOT);
  const target = path.join(rootDir, "demos", "web");
  const harness = new HeadlessUiHarness({
    width: VIEWPORT_WIDTH,
    height: VIEWPORT_HEIGHT,
    launchDelayMs: 220,
    defaultTimeoutMs: 10000,
    actionDelayMs: 40
  });

  try {
    await harness.launch(target);
    await sleep(1800);
    const snapshot = harness.captureSnapshot({ includeSurfaceHash: true, includeLogs: true });

    if (!snapshot.running) {
      throw new Error("WEB stopped on odd viewport.");
    }
    if (!snapshot.window || !snapshot.window.defined) {
      throw new Error("WEB failed to define a window on odd viewport.");
    }
    if ((snapshot.window.width | 0) !== REPORTED_WIDTH || (snapshot.window.height | 0) !== REPORTED_HEIGHT) {
      throw new Error(
        `WEB odd-viewport size mismatch: expected ${REPORTED_WIDTH}x${REPORTED_HEIGHT}, got ` +
        `${snapshot.window.width}x${snapshot.window.height}.`
      );
    }
    if ((snapshot.surface.presentCount | 0) < 1) {
      throw new Error("WEB never presented a frame on odd viewport.");
    }
    if (hasUnhandledLogs(snapshot)) {
      throw new Error("WEB odd-viewport test hit an unhandled emulator path.");
    }

    console.log(
      `Autotest OK: WEB survives odd viewport by using even reported size ` +
      `(${snapshot.window.width}x${snapshot.window.height}, hash ${snapshot.surface.hash}).`
    );
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

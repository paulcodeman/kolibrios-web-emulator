const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

const DEFAULT_ROOT = process.env.KOS_ROOT || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root";
const VIEWPORT_WIDTH = 1000;
const VIEWPORT_HEIGHT = 700;

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
    await sleep(1400);
    const snapshot = harness.captureSnapshot({ includeSurfaceHash: true, includeLogs: true });

    if (!snapshot.running) {
      throw new Error("WEB stopped before viewport-size verification.");
    }
    if (!snapshot.window || !snapshot.window.defined) {
      throw new Error("WEB did not define a window.");
    }
    if ((snapshot.window.width | 0) !== VIEWPORT_WIDTH || (snapshot.window.height | 0) !== VIEWPORT_HEIGHT) {
      throw new Error(
        `WEB window size mismatch: expected ${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}, got ` +
        `${snapshot.window.width}x${snapshot.window.height}.`
      );
    }
    if ((snapshot.window.originX | 0) !== 0 || (snapshot.window.originY | 0) !== 0) {
      throw new Error(`WEB window origin mismatch: expected 0x0, got ${snapshot.window.originX}x${snapshot.window.originY}.`);
    }
    if ((snapshot.surface.width | 0) !== VIEWPORT_WIDTH || (snapshot.surface.height | 0) !== VIEWPORT_HEIGHT) {
      throw new Error(
        `WEB surface size mismatch: expected ${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}, got ` +
        `${snapshot.surface.width}x${snapshot.surface.height}.`
      );
    }
    if (hasUnhandledLogs(snapshot)) {
      throw new Error("WEB viewport test hit an unhandled emulator path.");
    }

    console.log(
      `Autotest OK: WEB uses the host viewport size ` +
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

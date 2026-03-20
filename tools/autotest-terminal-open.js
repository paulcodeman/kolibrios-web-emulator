const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

const DEFAULT_ROOT = process.env.KOS_ROOT || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root";

function hasUnhandledLogs(snapshot) {
  return Array.isArray(snapshot.logs) && snapshot.logs.some((line) => /^Unhandled |Interpreter error|Host session /.test(line));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms | 0)));
}

async function main() {
  const rootDir = path.resolve(process.argv[2] || DEFAULT_ROOT);
  const target = path.join(rootDir, "TERMINAL");
  const harness = new HeadlessUiHarness({
    launchDelayMs: 220,
    defaultTimeoutMs: 5000,
    actionDelayMs: 40
  });

  try {
    await harness.launch(target);
    await sleep(400);
    await harness.clickButton({ label: "Open" }, 2500, { settleMs: 300 });
    const snapshot = await harness.waitUntil((state) => {
      if (!state.window || !state.window.defined) {
        return null;
      }
      if ((state.pid >>> 0) === 1) {
        return null;
      }
      if ((state.window.width | 0) < 600 || (state.window.height | 0) < 400) {
        return null;
      }
      return harness.captureSnapshot({ includeSurfaceHash: true, includeLogs: true });
    }, "TERMINAL console window", 4000);

    if ((snapshot.pid >>> 0) === 1 || (snapshot.slot >>> 0) === 1) {
      throw new Error("TERMINAL stayed on the setup dialog instead of switching to the console thread.");
    }
    if ((snapshot.window.originX | 0) < 0 || (snapshot.window.originY | 0) < 0) {
      throw new Error(`TERMINAL console window opened outside the visible area at ${snapshot.window.originX}x${snapshot.window.originY}.`);
    }
    if ((snapshot.window.originX + snapshot.window.width) > harness.baseWidth) {
      throw new Error(`TERMINAL console window overflowed the visible width: x=${snapshot.window.originX}, width=${snapshot.window.width}, viewport=${harness.baseWidth}.`);
    }
    if ((snapshot.window.originY + snapshot.window.height) > harness.baseHeight) {
      throw new Error(`TERMINAL console window overflowed the visible height: y=${snapshot.window.originY}, height=${snapshot.window.height}, viewport=${harness.baseHeight}.`);
    }
    if (hasUnhandledLogs(snapshot)) {
      throw new Error("TERMINAL console open path hit an unhandled emulator path.");
    }

    console.log(
      `Autotest OK: TERMINAL opened console pid=${snapshot.pid} at ${snapshot.window.originX}x${snapshot.window.originY}, ` +
      `window ${snapshot.window.width}x${snapshot.window.height}, hash=${snapshot.surface.hash}.`
    );
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

const DEFAULT_ROOT = process.env.KOS_ROOT || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root";

function hasUnhandledLogs(processes) {
  return processes.some((process) =>
    Array.isArray(process.logs) &&
    process.logs.some((line) => /^Unhandled |Interpreter error|Host session |KX import /.test(line))
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms | 0)));
}

async function main() {
  const rootDir = path.resolve(process.argv[2] || DEFAULT_ROOT);
  const target = path.join(rootDir, "SHELL");
  const harness = new HeadlessUiHarness({
    launchDelayMs: 220,
    defaultTimeoutMs: 5000,
    actionDelayMs: 40
  });

  try {
    await harness.launch(target);
    await sleep(1500);
    const snapshot = harness.captureSnapshot({ includeSurfaceHash: true, includeLogs: true });
    const processes = harness.processes.map((process) => ({
      pid: process.pid >>> 0,
      slot: process.slot >>> 0,
      stopped: !!process.stopped,
      removed: !!process.removed,
      logs: (process.logs || []).slice()
    }));

    if (!snapshot.running || !snapshot.window || !snapshot.window.defined) {
      throw new Error("SHELL did not produce a running window.");
    }
    if ((snapshot.pid >>> 0) === 1 || (snapshot.slot >>> 0) === 1) {
      throw new Error("SHELL did not switch to the console thread.");
    }
    if ((snapshot.window.width | 0) < 600 || (snapshot.window.height | 0) < 400) {
      throw new Error(`SHELL console window size is too small: ${snapshot.window.width}x${snapshot.window.height}.`);
    }
    if (typeof snapshot.title !== "string" || !snapshot.title.startsWith("SHELL")) {
      throw new Error(`Unexpected SHELL window title: '${snapshot.title || ""}'.`);
    }
    if (hasUnhandledLogs(processes)) {
      throw new Error("SHELL launch path hit an unhandled emulator path.");
    }

    console.log(
      `Autotest OK: SHELL opened console pid=${snapshot.pid} slot=${snapshot.slot}, ` +
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

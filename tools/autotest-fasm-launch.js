const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

const DEFAULT_ROOT = process.env.KOS_ROOT || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root";

function hasUnhandledLogs(snapshot) {
  return Array.isArray(snapshot.logs) && snapshot.logs.some((line) => /^Unhandled |Interpreter error|Host session |KX import /.test(line));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms | 0)));
}

async function main() {
  const rootDir = path.resolve(process.argv[2] || DEFAULT_ROOT);
  const target = path.join(rootDir, "DEVELOP", "FASM");
  const harness = new HeadlessUiHarness({
    launchDelayMs: 220,
    defaultTimeoutMs: 5000,
    actionDelayMs: 40
  });

  try {
    await harness.launch(target);
    await sleep(2500);
    const snapshot = harness.captureSnapshot({ includeSurfaceHash: true, includeLogs: true });

    if (!snapshot.running || !snapshot.window || !snapshot.window.defined) {
      throw new Error("FASM did not keep a running window.");
    }
    if ((snapshot.window.width | 0) < 430 || (snapshot.window.height | 0) < 380) {
      throw new Error(`FASM window size is too small: ${snapshot.window.width}x${snapshot.window.height}.`);
    }
    if (typeof snapshot.title !== "string" || !snapshot.title.startsWith("flat assembler")) {
      throw new Error(`Unexpected FASM caption: '${snapshot.title || ""}'.`);
    }
    if (!snapshot.surface || snapshot.surface.hash === "0x4b404b43") {
      throw new Error("FASM surface is still stuck at the initial blank frame.");
    }
    if ((snapshot.buttons || []).length < 4) {
      throw new Error(`FASM did not expose the expected launcher controls: ${(snapshot.buttons || []).length}.`);
    }
    if (hasUnhandledLogs(snapshot)) {
      throw new Error("FASM launch path hit an unhandled emulator path.");
    }

    console.log(
      `Autotest OK: FASM window ${snapshot.window.width}x${snapshot.window.height}, ` +
      `caption='${snapshot.title}', controls=${snapshot.buttons.length}, hash=${snapshot.surface.hash}.`
    );
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

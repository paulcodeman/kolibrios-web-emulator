const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

const DEFAULT_ROOT = process.env.KOS_ROOT || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root";
const EXPECTED_HELP_HASH = "0x87c6a4dc";
const KNOWN_BAD_HASH = "0xd4ed0a1c";

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

    for (const step of [
      { code: "KeyH", key: "h" },
      { code: "KeyE", key: "e" },
      { code: "KeyL", key: "l" },
      { code: "KeyP", key: "p" },
      { code: "Enter", key: "Enter" }
    ]) {
      await harness.pressDomKey({
        ...step,
        holdMs: 10,
        settleMs: 80
      });
    }

    await sleep(2500);

    const snapshot = harness.captureSnapshot({ includeSurfaceHash: true, includeLogs: true });
    const processes = harness.processes.map((process) => ({
      pid: process.pid >>> 0,
      slot: process.slot >>> 0,
      stopped: !!process.stopped,
      removed: !!process.removed,
      logs: (process.logs || []).slice()
    }));

    if (!snapshot.running || !snapshot.window || !snapshot.window.defined) {
      throw new Error("SHELL did not stay running during help command.");
    }
    if (typeof snapshot.title !== "string" || !snapshot.title.startsWith("SHELL")) {
      throw new Error(`Unexpected SHELL window title: '${snapshot.title || ""}'.`);
    }
    if (hasUnhandledLogs(processes)) {
      throw new Error("SHELL help path hit an unhandled emulator path.");
    }
    if (snapshot.surface.hash === KNOWN_BAD_HASH) {
      throw new Error("SHELL help path regressed to the single-letter command output.");
    }
    if (snapshot.surface.hash !== EXPECTED_HELP_HASH) {
      throw new Error(
        `Unexpected SHELL help surface hash ${snapshot.surface.hash}; expected ${EXPECTED_HELP_HASH}.`
      );
    }

    console.log(`Autotest OK: SHELL help rendered hash=${snapshot.surface.hash}.`);
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

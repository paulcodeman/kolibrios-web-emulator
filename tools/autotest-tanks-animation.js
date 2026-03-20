const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

const DEFAULT_ROOT = process.env.KOS_ROOT || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms | 0)));
}

function hasUnhandledLogs(snapshot) {
  return Array.isArray(snapshot.logs) && snapshot.logs.some((line) => /^Unhandled |Interpreter error|Host session /.test(line));
}

async function main() {
  const rootDir = path.resolve(process.argv[2] || DEFAULT_ROOT);
  const target = path.join(rootDir, "games", "tanks");
  const harness = new HeadlessUiHarness({
    launchDelayMs: 220,
    defaultTimeoutMs: 10000,
    actionDelayMs: 40
  });

  try {
    await harness.launch(target);
    await sleep(1200);
    await harness.pressDomKey({ code: "Enter", key: "Enter", settleMs: 300 });
    await sleep(1200);

    const first = harness.captureSnapshot({ includeSurfaceHash: true, includeLogs: true });
    await sleep(1500);
    const second = harness.captureSnapshot({ includeSurfaceHash: true, includeLogs: true });

    if (!first.running || !second.running) {
      throw new Error("TANKS stopped while the gameplay animation test was running.");
    }
    if (first.surface.hash === second.surface.hash) {
      throw new Error(`TANKS gameplay frame is still frozen without input: hash=${first.surface.hash}.`);
    }
    if ((second.surface.presentCount | 0) <= (first.surface.presentCount | 0)) {
      throw new Error(
        `TANKS present counter did not advance after start: ${first.surface.presentCount} -> ${second.surface.presentCount}.`
      );
    }
    if (hasUnhandledLogs(second)) {
      throw new Error("TANKS gameplay animation hit an unhandled emulator path.");
    }

    console.log(
      `Autotest OK: TANKS gameplay animates without extra input ` +
      `(hash ${first.surface.hash} -> ${second.surface.hash}, presents ${first.surface.presentCount} -> ${second.surface.presentCount}).`
    );
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

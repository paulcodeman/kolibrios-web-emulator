const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

const DEFAULT_ROOT = process.env.KOS_ROOT || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root";

function hasText(snapshot, expected) {
  return snapshot.texts.some((item) => item.text.includes(expected));
}

function hasNumber(snapshot, expected) {
  return snapshot.numbers.some((item) => item.text === expected);
}

async function runScancode(rootDir) {
  const target = path.join(rootDir, "DEVELOP", "SCANCODE");
  const harness = new HeadlessUiHarness({
    launchDelayMs: 120,
    actionDelayMs: 16,
    defaultTimeoutMs: 3000
  });
  try {
    await harness.launch(target);
    await harness.pressDomKey({
      code: "ArrowUp",
      key: "ArrowUp",
      holdMs: 10,
      settleMs: 160
    });
    const snapshot = harness.captureSnapshot({ includeSurfaceHash: true, includeLogs: true });
    if (!snapshot.running) {
      throw new Error("SCANCODE stopped during keyboard test.");
    }
    if (!hasNumber(snapshot, "000224") || !hasNumber(snapshot, "000072") || !hasNumber(snapshot, "000200")) {
      throw new Error("SCANCODE did not record the expected extended scancode stream.");
    }
    if (!hasText(snapshot, "Ext") || !hasText(snapshot, "Down") || !hasText(snapshot, "Up")) {
      throw new Error("SCANCODE did not draw the expected extended key labels.");
    }
    return snapshot.surface.hash;
  } finally {
    harness.close();
  }
}

async function runLines(rootDir) {
  const target = path.join(rootDir, "GAMES", "LINES");
  const harness = new HeadlessUiHarness({
    launchDelayMs: 250,
    actionDelayMs: 20,
    defaultTimeoutMs: 3000
  });
  try {
    await harness.launch(target);
    const before = harness.captureSnapshot({ includeSurfaceHash: true });
    await harness.pressDomKey({
      code: "F2",
      key: "F2",
      holdMs: 10,
      settleMs: 150
    });
    const after = harness.captureSnapshot({ includeSurfaceHash: true, includeLogs: true });
    if (!after.running) {
      throw new Error("LINES stopped after F2.");
    }
    if (before.surface.hash === after.surface.hash) {
      throw new Error("LINES surface hash did not change after F2 new-game hotkey.");
    }
    return after.surface.hash;
  } finally {
    harness.close();
  }
}

async function runZkey(rootDir) {
  const target = path.join(rootDir, "ZKEY");
  const harness = new HeadlessUiHarness({
    launchDelayMs: 250,
    defaultTimeoutMs: 3000
  });
  try {
    await harness.launch(target);
    const snapshot = harness.captureSnapshot({ includeSurfaceHash: true, includeLogs: true });
    if (!snapshot.running) {
      throw new Error("ZKEY did not stay running.");
    }
    if (!String(snapshot.title || "").includes("ZKEY")) {
      throw new Error("ZKEY window title was not captured.");
    }
    if (snapshot.buttons.length < 80) {
      throw new Error(`ZKEY rendered too few buttons: ${snapshot.buttons.length}`);
    }
    return snapshot.surface.hash;
  } finally {
    harness.close();
  }
}

async function main() {
  const rootDir = path.resolve(process.argv[2] || DEFAULT_ROOT);
  const scancodeHash = await runScancode(rootDir);
  const linesHash = await runLines(rootDir);
  const zkeyHash = await runZkey(rootDir);
  console.log(
    `Autotest OK: SCANCODE ext-keys hash=${scancodeHash}, LINES hotkey hash=${linesHash}, ZKEY launch hash=${zkeyHash}.`
  );
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

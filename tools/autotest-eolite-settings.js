const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

const DEFAULT_ROOT = process.env.KOS_ROOT || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root";

function hasUnhandledLogs(snapshot) {
  return Array.isArray(snapshot.logs) && snapshot.logs.some((line) => /^Unhandled |Interpreter error|Host session /.test(line));
}

function findVisibleButton(snapshot, id) {
  return snapshot.buttons.find((button) => (button.id >>> 0) === (id >>> 0) && !button.hidden) || null;
}

async function clickButtonById(harness, snapshot, id, settleMs) {
  const button = findVisibleButton(snapshot, id);
  if (!button) {
    throw new Error(`EOLITE settings button ${id} is not visible.`);
  }
  const x = button.screenX + Math.max(0, Math.floor(button.width / 2));
  const y = button.screenY + Math.max(0, Math.floor(button.height / 2));
  await harness.clickScreen(x, y, { settleMs: settleMs === undefined ? 800 : settleMs });
  return harness.captureSnapshot({ includeSurfaceHash: true, includeLogs: true });
}

async function main() {
  const rootDir = path.resolve(process.argv[2] || DEFAULT_ROOT);
  const target = path.join(rootDir, "EOLITE");
  const harness = new HeadlessUiHarness({
    launchDelayMs: 220,
    defaultTimeoutMs: 5000,
    actionDelayMs: 40
  });

  try {
    await harness.launch(target);
    await new Promise((resolve) => setTimeout(resolve, 4000));

    await harness.clickScreen(100, 191, { settleMs: 1000 });
    let snapshot = harness.captureSnapshot({ includeSurfaceHash: true, includeLogs: true });
    if ((snapshot.pid >>> 0) === 1) {
      throw new Error("EOLITE settings did not switch to the popup thread.");
    }
    if (!findVisibleButton(snapshot, 1007) || !findVisibleButton(snapshot, 1004)) {
      throw new Error("EOLITE settings popup did not render expected controls.");
    }
    if (hasUnhandledLogs(snapshot)) {
      throw new Error("EOLITE settings popup hit an unhandled emulator path on open.");
    }

    await harness.clickScreen(170, -86, { settleMs: 300 });
    await harness.pressDomKey({ code: "KeyA", key: "a", settleMs: 300 });
    snapshot = harness.captureSnapshot({ includeSurfaceHash: true, includeLogs: true });
    if (!snapshot.texts.some((item) => item.text && item.text.includes("sys") && item.text !== "/sys")) {
      throw new Error("EOLITE settings edit box did not react to keyboard input.");
    }
    if (hasUnhandledLogs(snapshot)) {
      throw new Error("EOLITE settings edit box input hit an unhandled emulator path.");
    }

    snapshot = await clickButtonById(harness, snapshot, 1007);
    if (!snapshot.texts.some((item) => item.text === "14")) {
      throw new Error("EOLITE settings font-size '+' did not update the value to 14.");
    }
    if (hasUnhandledLogs(snapshot)) {
      throw new Error("EOLITE settings font-size '+' hit an unhandled emulator path.");
    }

    const beforeCheckboxHash = snapshot.surface.hash;
    snapshot = await clickButtonById(harness, snapshot, 1004);
    if (!snapshot.surface || snapshot.surface.hash === beforeCheckboxHash) {
      throw new Error("EOLITE settings checkbox click did not change the rendered popup state.");
    }
    if (hasUnhandledLogs(snapshot)) {
      throw new Error("EOLITE settings checkbox click hit an unhandled emulator path.");
    }

    console.log(
      `Autotest OK: EOLITE settings pid=${snapshot.pid} slot=${snapshot.slot}, controls active, hash=${snapshot.surface.hash}.`
    );
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

const path = require("path");
const { HeadlessUiHarness, loadKosRuntime } = require("./ui-harness");

const DEFAULT_ROOT = process.env.KOS_ROOT || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root";
const REG_EAX = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms | 0)));
}

function hasUnhandledLogs(snapshot) {
  return Array.isArray(snapshot.logs) && snapshot.logs.some((line) => /^Unhandled |Interpreter error|Host session /.test(line));
}

function getAh(value) {
  return (value >>> 8) & 0xff;
}

function formatKeys(values) {
  if (!Array.isArray(values) || !values.length) {
    return "none";
  }
  return values
    .map((value) => `0x${(value >>> 0).toString(16).padStart(8, "0")}`)
    .join(", ");
}

function makeKeyboardEvent(code, key) {
  return {
    code,
    key,
    getModifierState() {
      return false;
    }
  };
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
    const keyboard = loadKosRuntime().ui && loadKosRuntime().ui.keyboard;
    if (!keyboard || typeof keyboard.translateDomKeyboardEvent !== "function") {
      throw new Error("Browser keyboard translator is not available.");
    }

    const leftInfo = keyboard.translateDomKeyboardEvent(makeKeyboardEvent("ArrowLeft", "ArrowLeft"));
    const spaceInfo = keyboard.translateDomKeyboardEvent(makeKeyboardEvent("Space", " "));
    if (!leftInfo || (leftInfo.asciiCode | 0) !== 176) {
      throw new Error(`ArrowLeft is translated incorrectly: ${JSON.stringify(leftInfo)}.`);
    }
    if (!spaceInfo || (spaceInfo.asciiCode | 0) !== 32) {
      throw new Error(`Space is translated incorrectly: ${JSON.stringify(spaceInfo)}.`);
    }

    await harness.launch(target);
    await sleep(1200);
    await harness.pressDomKey({ code: "Enter", key: "Enter", settleMs: 300 });
    await sleep(800);

    const process = harness.getActiveProcess();
    if (!process || !process.emulator) {
      throw new Error("TANKS process is not active after launch.");
    }

    const emulator = process.emulator;
    const originalSysGetKey = emulator.sysGetKey;
    const deliveredKeys = [];
    emulator.sysGetKey = function patchedSysGetKey() {
      const result = originalSysGetKey.apply(this, arguments);
      const value = this.readReg(REG_EAX) >>> 0;
      if (value !== 1) {
        deliveredKeys.push(value >>> 0);
      }
      return result;
    };

    try {
      await harness.pressDomKey({ code: "ArrowLeft", key: "ArrowLeft", settleMs: 250 });
      await harness.pressDomKey({ code: "Space", key: " ", settleMs: 250 });
      const afterShot = harness.captureSnapshot({ includeSurfaceHash: true, includeLogs: true });
      await sleep(1200);
      const later = harness.captureSnapshot({ includeSurfaceHash: true, includeLogs: true });

      if (!deliveredKeys.some((value) => getAh(value) === 176)) {
        throw new Error(`TANKS did not receive ArrowLeft in AH. Delivered keys: ${formatKeys(deliveredKeys)}.`);
      }
      if (!deliveredKeys.some((value) => getAh(value) === 32)) {
        throw new Error(`TANKS did not receive Space in AH. Delivered keys: ${formatKeys(deliveredKeys)}.`);
      }
      if (!later.running) {
        throw new Error("TANKS stopped after movement/shoot input.");
      }
      if (afterShot.surface.hash === later.surface.hash) {
        throw new Error(`TANKS frame stopped changing after shot: hash=${afterShot.surface.hash}.`);
      }
      if ((later.surface.presentCount | 0) <= (afterShot.surface.presentCount | 0)) {
        throw new Error(
          `TANKS present counter stopped after shot: ${afterShot.surface.presentCount} -> ${later.surface.presentCount}.`
        );
      }
      if (hasUnhandledLogs(later)) {
        throw new Error("TANKS movement/shoot path hit an unhandled emulator path.");
      }

      console.log(
        `Autotest OK: TANKS receives ArrowLeft/Space and keeps animating after shot ` +
        `(keys ${formatKeys(deliveredKeys)}, presents ${afterShot.surface.presentCount} -> ${later.surface.presentCount}).`
      );
    } finally {
      emulator.sysGetKey = originalSysGetKey;
    }
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

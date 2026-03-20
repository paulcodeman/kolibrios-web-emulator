const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

const DEFAULT_ROOT = process.env.KOS_ROOT || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms | 0)));
}

function hasUnhandledLogs(source) {
  const logs = Array.isArray(source) ? source : (source && Array.isArray(source.logs) ? source.logs : []);
  return logs.some((line) => /^Unhandled |Interpreter error|Host session |KX import /.test(line));
}

function collectTexts(snapshot) {
  return (snapshot.texts || []).map((item) => item.text || "").filter(Boolean).join("");
}

function assertCompileSnapshot(snapshot, iteration) {
  const text = collectTexts(snapshot);
  if (!snapshot.running || !snapshot.window || !snapshot.window.defined) {
    throw new Error(`FASM did not survive compile #${iteration}.`);
  }
  if (/out of memory/i.test(text)) {
    throw new Error(`FASM compile #${iteration} still reports out of memory.`);
  }
  if (/error:/i.test(text)) {
    throw new Error(`FASM compile #${iteration} still reports an assembler error.`);
  }
  if (hasUnhandledLogs(snapshot)) {
    throw new Error(`FASM compile #${iteration} hit an unhandled emulator path.`);
  }
}

function clickButtonRaw(harness, label) {
  const process = harness.getActiveProcess();
  if (!process || !process.emulator) {
    throw new Error("No active process to receive raw button click.");
  }
  const snapshot = harness.captureSnapshot();
  const button = (snapshot.buttons || []).find((item) => String(item.label || "").trim() === label);
  if (!button) {
    throw new Error(`Button not found: ${label}`);
  }
  const screenX = (button.screenX + Math.max(0, Math.floor(button.width / 2))) | 0;
  const screenY = (button.screenY + Math.max(0, Math.floor(button.height / 2))) | 0;
  const localX = (screenX - (process.actualX | 0)) | 0;
  const localY = (screenY - (process.actualY | 0)) | 0;
  process.emulator.setMouseState(localX, localY, 0, true, 0, 0, 0, 0, true, screenX, screenY);
  process.emulator.setMouseState(localX, localY, 1, true, 1, 0, 0, 0, false, screenX, screenY);
  process.emulator.setMouseState(localX, localY, 0, true, 0, 1, 0, 0, false, screenX, screenY);
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

    await harness.clickButton({ label: "Компил." }, 5000, { settleMs: 0 });
    await sleep(2500);
    const firstCompileSnapshot = harness.captureSnapshot({ includeLogs: true, includeSurfaceHash: true });
    assertCompileSnapshot(firstCompileSnapshot, 1);

    await harness.clickButton({ label: "Компил." }, 5000, { settleMs: 0 });
    await sleep(2500);
    const secondCompileSnapshot = harness.captureSnapshot({ includeLogs: true, includeSurfaceHash: true });
    assertCompileSnapshot(secondCompileSnapshot, 2);

    clickButtonRaw(harness, "Отладка");
    await sleep(4000);

    const stack = harness.getWindowStack();
    const launchedProcess = stack.find((process) => {
      if (!process || process.pid === 1 || !process.emulator) {
        return false;
      }
      const title = String(process.emulator.windowTitle || "");
      const processPath = String(process.processPath || "");
      return title.startsWith("Kolibri Debugger") || processPath === "/sys/EXAMPLE";
    }) || null;
    if (!launchedProcess || !launchedProcess.emulator || !launchedProcess.emulator.running) {
      throw new Error("FASM debug button did not launch a child window.");
    }
    if (!launchedProcess.emulator.windowDefined) {
      throw new Error("FASM debug child launched without a defined window.");
    }
    if (hasUnhandledLogs(launchedProcess)) {
      throw new Error("FASM debug child launch path still hits an unhandled emulator path.");
    }
    if (String(launchedProcess.processPath || "") === "/sys/EXAMPLE" &&
        String(launchedProcess.emulator.windowTitle || "") !== "Пример программы") {
      throw new Error(
        `FASM debug child title is still mis-decoded: '${launchedProcess.emulator.windowTitle || ""}'.`
      );
    }

    console.log(
      `Autotest OK: FASM compile stays alive twice ` +
      `(hashes=${firstCompileSnapshot.surface.hash},${secondCompileSnapshot.surface.hash}) ` +
      `and debug opens '${launchedProcess.emulator.windowTitle}' ` +
      `${launchedProcess.emulator.windowWidth}x${launchedProcess.emulator.windowHeight}.`
    );
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

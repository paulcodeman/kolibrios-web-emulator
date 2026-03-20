const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

async function main() {
  const target = path.resolve(process.argv[2] || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root\\LAUNCHER");
  const outNow = path.resolve(
    process.argv[3] || path.join(__dirname, "..", "artifacts", "captures", "LAUNCHER-desktop-assets.png")
  );
  const outLate = path.resolve(
    process.argv[4] || path.join(__dirname, "..", "artifacts", "captures", "LAUNCHER-desktop-assets-late.png")
  );
  const lateDelayMs = Math.max(0, Number(process.argv[5] || 20000) | 0);
  const harness = new HeadlessUiHarness({
    launchDelayMs: 220,
    defaultTimeoutMs: 45000,
    viewportWidth: 1000,
    viewportHeight: 700,
    echoLogs: process.env.KOS_TRACE_HARNESS === "1"
  });

  try {
    await harness.launch(target);
    await harness.waitUntil(() => {
      const state = harness.captureDesktopSnapshot({ includeSurfaceHash: true });
      const taskbar = state.processes.find((item) => (
        item.displayPath === "/SYS/@TASKBAR" &&
        item.windowDefined &&
        item.presentCount > 0
      )) || null;
      if (!taskbar) {
        return null;
      }
      if (!harness.isNamedMemoryAreaReady("ICONS32")) {
        return null;
      }
      if ((harness.desktopBackgroundWidth | 0) <= 0 || (harness.desktopBackgroundHeight | 0) <= 0) {
        return null;
      }
      return state;
    }, "launcher desktop ready", 30000);

    const first = harness.saveScreenshot(outNow, { desktop: true });
    await new Promise((resolve) => setTimeout(resolve, lateDelayMs));
    const second = harness.saveScreenshot(outLate, { desktop: true });
    console.log(
      `Captured launcher desktop: now=${path.basename(first.path)} late=${path.basename(second.path)} ` +
      `bg=${harness.desktopBackgroundWidth}x${harness.desktopBackgroundHeight} delay=${lateDelayMs}ms`
    );
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

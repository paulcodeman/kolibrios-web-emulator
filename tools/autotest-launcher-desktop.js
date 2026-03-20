const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

async function main() {
  const target = path.resolve(process.argv[2] || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root\\LAUNCHER");
  const harness = new HeadlessUiHarness({
    launchDelayMs: 220,
    defaultTimeoutMs: 20000,
    viewportWidth: 1000,
    viewportHeight: 700,
    echoLogs: process.env.KOS_TRACE_HARNESS === "1"
  });

  try {
    await harness.launch(target);
    const snapshot = await harness.waitUntil(() => {
      const state = harness.captureDesktopSnapshot({ includeSurfaceHash: true });
      const taskbar = state.processes.find((item) => item.displayPath === "/SYS/@TASKBAR" && item.windowDefined && item.presentCount > 0) || null;
      const searchap = state.processes.find((item) => item.displayPath === "/SYS/SEARCHAP") || null;
      if (!taskbar || !searchap) {
        return null;
      }
      const reported = state.screen && state.screen.reported ? state.screen.reported : null;
      const workArea = state.screen && state.screen.workArea ? state.screen.workArea : null;
      if (!reported || !workArea) {
        return null;
      }
      if ((workArea.bottom | 0) >= ((reported.height | 0) - 1)) {
        return null;
      }
      return state;
    }, "launcher desktop shell", 15000);

    const taskbar = snapshot.processes.find((item) => item.displayPath === "/SYS/@TASKBAR");
    console.log(
      `Autotest OK: LAUNCHER desktop ${snapshot.desktopSurface.width}x${snapshot.desktopSurface.height} ` +
      `taskbar=${taskbar.width}x${taskbar.height} workAreaBottom=${snapshot.screen.workArea.bottom} ` +
      `hash=${snapshot.desktopSurface.hash}`
    );
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

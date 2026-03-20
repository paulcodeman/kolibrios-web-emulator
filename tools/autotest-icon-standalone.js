const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

async function main() {
  const target = path.resolve(process.argv[2] || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root\\@ICON");
  const harness = new HeadlessUiHarness({
    launchDelayMs: 220,
    defaultTimeoutMs: 15000,
    viewportWidth: 1000,
    viewportHeight: 700,
    echoLogs: process.env.KOS_TRACE_HARNESS === "1"
  });

  try {
    const blank = harness.captureDesktopSnapshot({ includeSurfaceHash: true });
    const blankHash = blank.desktopSurface.hash;
    const blankWidth = blank.desktopSurface.width | 0;
    const blankHeight = blank.desktopSurface.height | 0;

    await harness.launch(target);
    const snapshot = await harness.waitUntil(() => {
      const state = harness.captureDesktopSnapshot({ includeSurfaceHash: true });
      if (state.desktopSurface.hash === blankHash) {
        return null;
      }
      const iconThreads = harness.processes.filter((process) => (process.displayPath || "").toUpperCase().includes("@ICON"));
      if (!iconThreads.length) {
        return null;
      }
      return { state, iconThreads };
    }, "standalone @ICON desktop draw", 12000);

    const iconThreads = snapshot.iconThreads;
    const noWindow = iconThreads.every((process) => !process.emulator || !process.emulator.windowDefined);
    if (!noWindow) {
      throw new Error("Standalone @ICON unexpectedly created a normal window.");
    }

    console.log(
      `Autotest OK: @ICON desktop changed ${blankWidth}x${blankHeight} ` +
      `from ${blankHash} to ${snapshot.state.desktopSurface.hash} without normal window`
    );
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

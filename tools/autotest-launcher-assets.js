const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

async function main() {
  const target = path.resolve(process.argv[2] || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root\\LAUNCHER");
  const harness = new HeadlessUiHarness({
    launchDelayMs: 220,
    defaultTimeoutMs: 25000,
    viewportWidth: 1000,
    viewportHeight: 700,
    echoLogs: process.env.KOS_TRACE_HARNESS === "1"
  });

  try {
    await harness.launch(target);
    await harness.waitUntil(() => {
      const state = harness.captureDesktopSnapshot({ includeSurfaceHash: true });
      const taskbar = state.processes.find((item) => item.displayPath === "/SYS/@TASKBAR" && item.windowDefined && item.presentCount > 0) || null;
      return taskbar ? state : null;
    }, "launcher taskbar", 12000);
    const finalState = await harness.waitUntil(() => {
      if (!harness.isNamedMemoryAreaReady("ICONS32")) {
        return null;
      }
      if ((harness.desktopBackgroundWidth | 0) <= 0 || (harness.desktopBackgroundHeight | 0) <= 0) {
        return null;
      }
      return harness.captureDesktopSnapshot({ includeSurfaceHash: true });
    }, "launcher desktop assets", 15000);
    const iconProcess = harness.processes.find((process) => process.displayPath === "/SYS/@ICON") || null;
    if (iconProcess && iconProcess.logs.some((line) => line.includes("Unhandled syscall 34"))) {
      throw new Error("@ICON still logs 'Unhandled syscall 34'.");
    }
    const unhandled = harness.processes.flatMap((process) => (
      process.logs
        .filter((line) => line.includes("Unhandled syscall"))
        .map((line) => `${process.displayPath || process.processPath}: ${line}`)
    ));
    if (unhandled.length) {
      throw new Error(`Launcher services still log unhandled syscalls:\n${unhandled.join("\n")}`);
    }

    console.log(
      `Autotest OK: desktop assets hash=${finalState.desktopSurface.hash} ` +
      `bg=${harness.desktopBackgroundWidth}x${harness.desktopBackgroundHeight} iconsReady=1`
    );
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

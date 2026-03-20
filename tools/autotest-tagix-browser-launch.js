const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

async function main() {
  const defaultTargetPath = path.resolve(__dirname, "../../kolibrios-gccgo-sdk/apps/tagix_browser/tagix_browser.kex");
  const targetPath = process.argv[2] || defaultTargetPath;
  const timeoutMs = Number(process.argv[3] || 30000);
  const harness = new HeadlessUiHarness({
    width: 1000,
    height: 700,
    launchDelayMs: 80,
    actionDelayMs: 12,
    defaultTimeoutMs: 2000
  });
  try {
    await harness.launch(targetPath);
    const start = Date.now();
    const processState = harness.processes[0] || null;
    while (Date.now() - start < timeoutMs) {
      if (!processState || !processState.emulator || !processState.emulator.running) {
        break;
      }
      if (processState.emulator.windowDefined && processState.presentCount > 0) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!processState || !processState.emulator || !processState.emulator.windowDefined) {
      throw new Error(`Tagix Browser window was not created within ${timeoutMs} ms`);
    }
    if (processState.presentCount <= 0) {
      throw new Error("Tagix Browser did not present a frame");
    }
    const title = String(processState.windowTitle || processState.emulator.windowTitle || "").trim();
    if (title !== "Tagix Browser") {
      throw new Error(`Unexpected window title: '${title}'`);
    }
    console.log(
      `Autotest OK: TAGIX_BROWSER window ${processState.emulator.windowWidth}x${processState.emulator.windowHeight}` +
      ` title='${title}' presents=${processState.presentCount} image='${path.basename(targetPath)}'`
    );
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});

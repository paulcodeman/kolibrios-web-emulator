const path = require("path");
const { HeadlessUiHarness, loadKosRuntime } = require("./ui-harness");

async function main() {
  const defaultTargetPath = path.resolve(__dirname, "../../kolibrios-gccgo-sdk/apps/tagix_browser/tagix_browser.kex");
  const targetPath = process.argv[2] || defaultTargetPath;
  const timeoutMs = Number(process.argv[3] || 30000);
  const runtime = loadKosRuntime();
  const { Emulator } = runtime;
  const originalLoadRegisteredHostDll = Emulator.prototype.loadRegisteredHostDll;
  let httpRegisteredLoads = 0;

  Emulator.prototype.loadRegisteredHostDll = function patchedLoadRegisteredHostDll(path) {
    const normalized = String(path || "").replace(/\\/g, "/").toLowerCase();
    if (normalized === "http.obj" || normalized.endsWith("/http.obj")) {
      httpRegisteredLoads += 1;
    }
    return originalLoadRegisteredHostDll.call(this, path);
  };

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
    if (httpRegisteredLoads <= 0) {
      throw new Error("Custom host module path for http.obj was not used");
    }
    if (!processState || !processState.emulator || !processState.emulator.windowDefined) {
      throw new Error(`Tagix Browser window was not created within ${timeoutMs} ms`);
    }
    const hostDllPtr = processState.emulator.loadBuiltInHostDll("http.obj");
    if (!hostDllPtr) {
      throw new Error("Host module lookup for http.obj returned 0");
    }
    if (!processState.emulator.findHostDllExport(hostDllPtr >>> 0, "http_get")) {
      throw new Error("Host module http.obj is missing export 'http_get'");
    }
    console.log(`Autotest OK: host module http.obj engaged ${httpRegisteredLoads} time(s)`);
  } finally {
    Emulator.prototype.loadRegisteredHostDll = originalLoadRegisteredHostDll;
    harness.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});

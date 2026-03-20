const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

async function main() {
  const target = path.resolve(process.argv[2] || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root\\CPU");
  const harness = new HeadlessUiHarness({
    launchDelayMs: 150,
    defaultTimeoutMs: 12000,
    viewportWidth: 1000,
    viewportHeight: 700,
    echoLogs: process.env.KOS_TRACE_HARNESS === "1"
  });

  try {
    await harness.launch(target);
    const process = harness.getActiveProcess();
    if (!process) {
      throw new Error("CPU app did not start.");
    }
    const result = await harness.waitUntil(() => {
      const info = harness.getThreadInfo(process.slot >>> 0);
      if (!info || (info.cpuUsage >>> 0) === 0) {
        return null;
      }
      const snapshot = harness.captureSnapshot({ includeSurfaceHash: true });
      const firstRow = snapshot.numbers
        .filter((item) => (item.screenY | 0) === 47)
        .slice()
        .sort((a, b) => (a.screenX | 0) - (b.screenX | 0));
      if (firstRow.length < 4) {
        return null;
      }
      const cpuCycles = Number.parseInt(firstRow[2].text, 10);
      if (!Number.isFinite(cpuCycles) || cpuCycles <= 0) {
        return null;
      }
      return {
        cpuUsage: info.cpuUsage >>> 0,
        cpuCycles: cpuCycles >>> 0,
        cpuPercent: Number.parseInt(firstRow[3].text, 10) || 0,
        hash: snapshot.surface.hash
      };
    }, "CPU usage visible", 8000);

    console.log(
      `Autotest OK: CPU app shows cpuUsage=${result.cpuUsage} cycles=${result.cpuCycles} percent=${result.cpuPercent} ` +
      `hash=${result.hash}`
    );
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

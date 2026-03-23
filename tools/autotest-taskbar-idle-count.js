const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms | 0)));
}

async function main() {
  const target = path.resolve(process.argv[2] || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root\\LAUNCHER");
  const harness = new HeadlessUiHarness({
    width: 1000,
    height: 700,
    launchDelayMs: 220,
    defaultTimeoutMs: 25000,
    actionDelayMs: 40,
    echoLogs: process.env.KOS_TRACE_HARNESS === "1"
  });

  try {
    await harness.launch(target);
    const taskbar = await harness.waitUntil(() => (
      harness.processes.find((item) => (
        item &&
        !item.removed &&
        item.displayPath === "/SYS/@TASKBAR" &&
        item.emulator &&
        item.emulator.windowDefined
      )) || null
    ), "launcher taskbar", 15000);

    const freq = harness.getReportedCpuFrequencyHz() >>> 0;
    const baselineIdle = await harness.waitUntil(() => {
      const idle = harness.getIdleCount() >>> 0;
      return idle >= Math.round(freq * 0.85) ? idle : null;
    }, "launcher idle settle", 8000);
    const baselineBusy = Math.max(0, freq - (baselineIdle >>> 0)) >>> 0;

    taskbar.emulator.noteCpuBusyTime(250);
    await sleep(20);

    const injectedIdle = harness.getIdleCount() >>> 0;
    const injectedBusy = Math.max(0, freq - injectedIdle) >>> 0;
    if (injectedBusy <= baselineBusy + Math.round(freq * 0.15)) {
      throw new Error(
        `Injected busy sample did not propagate to idle count: ` +
        `baselineBusy=${baselineBusy} injectedBusy=${injectedBusy} freq=${freq}.`
      );
    }

    await sleep(1200);

    const recoveredIdle = harness.getIdleCount() >>> 0;
    const recoveredBusy = Math.max(0, freq - recoveredIdle) >>> 0;
    if (recoveredBusy >= injectedBusy - Math.round(freq * 0.10)) {
      throw new Error(
        `Idle count did not recover after busy sample expiry: ` +
        `injectedBusy=${injectedBusy} recoveredBusy=${recoveredBusy} freq=${freq}.`
      );
    }

    console.log(
      `Autotest OK: taskbar idle count busy=${baselineBusy} -> ${injectedBusy} -> ${recoveredBusy} ` +
      `freq=${freq}.`
    );
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

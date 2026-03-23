const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

function assertEq(actual, expected, message) {
  if ((actual >>> 0) !== (expected >>> 0)) {
    throw new Error(`${message}: expected ${expected >>> 0}, got ${actual >>> 0}`);
  }
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
    await harness.waitUntil(() => harness.processes.find((process) => (
      process &&
      !process.removed &&
      String(process.displayPath || "").toUpperCase() === "/SYS/@TASKBAR"
    )), "launcher taskbar", 15000);

    const total = harness.getReportedTotalRamBytes() >>> 0;
    const processUsed = harness.processes.reduce((sum, process) => {
      if (!process || process.removed) {
        return sum;
      }
      return (sum + (harness.getApproxProcessMemoryBytes(process) >>> 0)) >>> 0;
    }, 0) >>> 0;
    const reserved = harness.getConfiguredSystemReservedRamBytes() >>> 0;
    const used = harness.getReportedUsedRamBytes() >>> 0;
    const free = harness.getReportedFreeRamBytes() >>> 0;

    assertEq(total, 512 * 1024 * 1024, "launcher session should report the default virtual system RAM");
    assertEq(used, (processUsed + reserved) >>> 0, "used RAM should include process usage plus virtual system overhead");
    assertEq(free, Math.max(0, total - used) >>> 0, "free RAM should be derived from virtual total minus committed process memory");
    if (used < (8 * 1024 * 1024)) {
      throw new Error(`Expected launcher stack to use noticeable RAM, got only ${used >>> 0} bytes.`);
    }

    console.log(`Autotest OK: virtual RAM total=${total >>> 0} used=${used >>> 0} free=${free >>> 0}.`);
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

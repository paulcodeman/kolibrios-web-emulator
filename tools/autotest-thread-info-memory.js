const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

function assertEq(actual, expected, message) {
  if ((actual >>> 0) !== (expected >>> 0)) {
    throw new Error(`${message}: expected ${expected >>> 0}, got ${actual >>> 0}`);
  }
}

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
    const cpuProcess = harness.getActiveProcess();
    if (!cpuProcess) {
      throw new Error("CPU app did not start.");
    }

    const launched = harness.startApplication({ path: "/sys/SHELL" });
    if (!launched || (launched.errorCode >>> 0) !== 0 || !(launched.pid >>> 0)) {
      throw new Error(`Failed to start /sys/SHELL from CPU session: ${JSON.stringify(launched)}`);
    }

    const shellProcess = await harness.waitUntil(() => {
      const candidates = harness.processes.filter((item) => (
        item &&
        !item.removed &&
        String(item.displayPath || "").toUpperCase() === "/SYS/SHELL" &&
        item.emulator
      ));
      return candidates.length ? candidates[candidates.length - 1] : null;
    }, "CPU shell window", 8000);

    const processes = [cpuProcess, shellProcess];
    for (let i = 0; i < processes.length; i += 1) {
      const process = processes[i];
      const info = harness.getThreadInfo(process.slot >>> 0);
      if (!info) {
        throw new Error(`Missing thread info for slot ${process.slot >>> 0}.`);
      }
      const approx = harness.getApproxProcessMemoryBytes(process) >>> 0;
      const memLimit = process.emulator ? (process.emulator.memLimit >>> 0) : 0;
      assertEq(info.usedMemory, approx, `${process.displayPath} should report committed memory in SF_THREAD_INFO.used_memory`);
      if (approx < memLimit && (info.usedMemory >>> 0) >= (memLimit >>> 0)) {
        throw new Error(`${process.displayPath} still reports memory limit ${memLimit >>> 0} instead of committed ${approx >>> 0}.`);
      }
    }

    console.log(
      `Autotest OK: SF_THREAD_INFO reports committed memory for CPU=${harness.getThreadInfo(cpuProcess.slot >>> 0).usedMemory >>> 0} ` +
      `SHELL=${harness.getThreadInfo(shellProcess.slot >>> 0).usedMemory >>> 0}.`
    );
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

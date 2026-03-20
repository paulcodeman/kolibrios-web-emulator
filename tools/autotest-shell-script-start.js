const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

const DEFAULT_ROOT = process.env.KOS_ROOT || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root";

function hasBadLogs(processes) {
  return processes.some((process) =>
    Array.isArray(process.logs) &&
    process.logs.some((line) => /Start app failed .*\.shell|Failed to parse .*\.shell|Unsupported magic '#SHS/.test(line))
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms | 0)));
}

async function main() {
  const rootDir = path.resolve(process.argv[2] || DEFAULT_ROOT);
  const target = path.join(rootDir, "CALC");
  const harness = new HeadlessUiHarness({
    launchDelayMs: 220,
    defaultTimeoutMs: 5000,
    actionDelayMs: 40
  });

  try {
    await harness.launch(target);
    await sleep(300);
    const result = harness.startApplication({
      path: "/sys/settings/.shell",
      params: ""
    });
    if (!result || (result.errorCode >>> 0) !== 0 || !(result.pid >>> 0)) {
      throw new Error(`startApplication('/sys/settings/.shell') failed with errorCode=${result ? result.errorCode : "<none>"}.`);
    }
    await sleep(1800);
    const shellProcess = harness.processes.find((process) => (process.pid >>> 0) === (result.pid >>> 0)) || null;
    if (!shellProcess || !shellProcess.emulator || !shellProcess.emulator.running) {
      throw new Error("Shell script start did not leave a running SHELL process.");
    }
    if (hasBadLogs(harness.processes)) {
      throw new Error("Shell script start still emitted parse/start failures for .shell.");
    }

    console.log(`Autotest OK: .shell start redirected to SHELL pid=${result.pid}.`);
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

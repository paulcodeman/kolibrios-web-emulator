const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

const DEFAULT_ROOT = process.env.KOS_ROOT || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root";

const REG = {
  EAX: 0,
  ECX: 1,
  EDX: 2,
  EBX: 3
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms | 0)));
}

async function main() {
  const rootDir = path.resolve(process.argv[2] || DEFAULT_ROOT);
  const target = path.join(rootDir, "SHELL");
  const harness = new HeadlessUiHarness({
    launchDelayMs: 220,
    defaultTimeoutMs: 10000,
    actionDelayMs: 40
  });

  try {
    await harness.launch(target);
    await sleep(1200);

    const launched = harness.startApplication({ path: "/sys/SHELL" });
    if (!launched || (launched.errorCode >>> 0) !== 0 || !(launched.pid >>> 0)) {
      throw new Error(`Failed to start second /sys/SHELL: ${JSON.stringify(launched)}`);
    }

    await harness.waitUntil(() => harness.processes.filter((process) => !process.removed).length >= 2, "second shell", 8000);
    const active = harness.getActiveProcess();
    if (!active || !active.emulator) {
      throw new Error("Missing active process for shutdown syscall.");
    }

    active.emulator.writeReg(REG.EAX, 18);
    active.emulator.writeReg(REG.EBX, 9);
    active.emulator.writeReg(REG.ECX, 2);
    active.emulator.handleSyscall();

    await harness.waitUntil(() => harness.processes.length === 0, "system shutdown cleanup", 4000);

    if ((harness.lastSystemAction >>> 0) !== 2) {
      throw new Error(`Expected last system action 2, got ${harness.lastSystemAction >>> 0}.`);
    }
    if (harness.processes.length !== 0) {
      throw new Error(`Shutdown left ${harness.processes.length} processes alive.`);
    }

    console.log("Autotest OK: system shutdown syscall stopped all processes.");
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

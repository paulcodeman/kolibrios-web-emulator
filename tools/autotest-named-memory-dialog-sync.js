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
    const ownerProcess = harness.getActiveProcess();
    if (!ownerProcess || !ownerProcess.emulator) {
      throw new Error("Owner process did not start.");
    }

    const launched = harness.startApplication({ path: "/sys/SHELL" });
    if (!launched || (launched.errorCode >>> 0) !== 0 || !(launched.pid >>> 0)) {
      throw new Error(`Failed to start /sys/SHELL: ${JSON.stringify(launched)}`);
    }

    const writerProcess = await harness.waitUntil(() => {
      const candidates = harness.processes.filter((item) => (
        item &&
        !item.removed &&
        String(item.displayPath || item.processPath || "").toUpperCase() === "/SYS/SHELL" &&
        item.emulator
      ));
      return candidates.length ? candidates[candidates.length - 1] : null;
    }, "dialog writer process", 8000);

    const ownerEmulator = ownerProcess.emulator;
    const writerEmulator = writerProcess.emulator;
    const area = ownerEmulator.createNamedMemoryArea("TEST_COLOR_DIALOG", 4096, 1, {
      ownerAccess: 1
    });
    if (!area) {
      throw new Error("Failed to create named memory area.");
    }

    const ownerMapping = ownerEmulator.mapNamedMemoryAreaForCurrentProcess(area, 1);
    const writerMapping = writerEmulator.mapNamedMemoryAreaForCurrentProcess(area, 1);
    if (!ownerMapping || !writerMapping) {
      throw new Error("Failed to map named memory area for both processes.");
    }

    ownerEmulator.writeMem8(ownerMapping.ptr >>> 0, 0);
    ownerEmulator.writeMem8((ownerMapping.ptr + 1) >>> 0, 0);
    ownerEmulator.writeMem32((ownerMapping.ptr + 20) >>> 0, 0);

    writerEmulator.writeMem8(writerMapping.ptr >>> 0, 1);
    writerEmulator.writeMem8((writerMapping.ptr + 1) >>> 0, 0);
    writerEmulator.writeMem32((writerMapping.ptr + 20) >>> 0, 0x00112233);
    writerEmulator.sysTerminate();

    const status =
      (ownerEmulator.readMem8(ownerMapping.ptr >>> 0) & 0xff) |
      ((ownerEmulator.readMem8((ownerMapping.ptr + 1) >>> 0) & 0xff) << 8);
    const color = ownerEmulator.readMem32((ownerMapping.ptr + 20) >>> 0) >>> 0;

    assertEq(status, 1, "Owner process should observe shared dialog status after writer stops");
    assertEq(color, 0x00112233, "Owner process should observe shared dialog color after writer stops");
    if (!writerProcess.removed) {
      throw new Error("Writer process should be removed after syscall termination.");
    }

    console.log(
      `Autotest OK: shared dialog mapping propagated status=${status >>> 0} color=0x${color.toString(16).padStart(8, "0")}.`
    );
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

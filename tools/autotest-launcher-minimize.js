const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms | 0)));
}

function requireThreadInfo(harness, slot, label) {
  const info = harness.getThreadInfo(slot >>> 0);
  if (!info) {
    throw new Error(`Missing thread info for ${label} slot ${slot >>> 0}.`);
  }
  return info;
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
    await harness.waitUntil(() => {
      const state = harness.captureDesktopSnapshot();
      return state.processes.find((item) => item.displayPath === "/SYS/@TASKBAR" && item.windowDefined && item.presentCount > 0) || null;
    }, "launcher taskbar", 15000);

    const launched = harness.startApplication({ path: "/sys/SHELL" });
    if (!launched || (launched.errorCode >>> 0) !== 0 || !(launched.pid >>> 0)) {
      throw new Error(`Failed to start /sys/SHELL from launcher session: ${JSON.stringify(launched)}`);
    }

    const shellProcess = await harness.waitUntil(() => {
      const candidates = harness.processes.filter((item) => (
        item &&
        !item.removed &&
        (item.pid >>> 0) >= (launched.pid >>> 0) &&
        String(item.displayPath || "").toUpperCase() === "/SYS/SHELL" &&
        item.emulator &&
        item.emulator.windowDefined &&
        item.surface
      ));
      if (!candidates.length) {
        return null;
      }
      candidates.sort((a, b) => (b.pid >>> 0) - (a.pid >>> 0));
      return candidates[0];
    }, "launcher shell window", 10000);

    const shellSlot = shellProcess.slot >>> 0;
    if ((harness.getActiveThreadSlot() >>> 0) !== shellSlot) {
      throw new Error(`Expected launched shell to be active on slot ${shellSlot}, got ${harness.getActiveThreadSlot() >>> 0}.`);
    }

    let info = requireThreadInfo(harness, shellSlot, "shell before minimize");
    if ((info.windowState & 0x02) !== 0) {
      throw new Error("Shell unexpectedly starts minimized.");
    }

    if (!harness.minimizeTopWindow()) {
      throw new Error("minimizeTopWindow() did not minimize the active shell window.");
    }
    await sleep(40);

    info = requireThreadInfo(harness, shellSlot, "shell after top minimize");
    if ((info.windowState & 0x02) === 0) {
      throw new Error("Shell did not report WINDOW_STATE_MINIMIZED after minimizeTopWindow().");
    }
    if ((harness.getActiveThreadSlot() >>> 0) === shellSlot) {
      throw new Error("Minimized shell remained the active window after minimizeTopWindow().");
    }

    const restoredSlot = harness.focusThreadSlot(shellSlot) >>> 0;
    if (restoredSlot !== shellSlot) {
      throw new Error(`focusThreadSlot did not restore shell slot ${shellSlot}; got ${restoredSlot}.`);
    }
    await sleep(40);

    info = requireThreadInfo(harness, shellSlot, "shell after focus restore");
    if ((info.windowState & 0x02) !== 0) {
      throw new Error("Shell stayed minimized after focusThreadSlot restore.");
    }

    const foreignMinResult = harness.controlForeignWindow(0, shellSlot) >>> 0;
    if (foreignMinResult !== 0) {
      throw new Error(`controlForeignWindow(0, slot) failed with 0x${foreignMinResult.toString(16)}.`);
    }
    await sleep(40);

    info = requireThreadInfo(harness, shellSlot, "shell after foreign minimize");
    if ((info.windowState & 0x02) === 0) {
      throw new Error("Shell did not report WINDOW_STATE_MINIMIZED after controlForeignWindow minimize.");
    }

    const activeBeforeRestore = harness.getActiveThreadSlot() >>> 0;
    const foreignRestoreResult = harness.controlForeignWindow(2, shellSlot) >>> 0;
    if (foreignRestoreResult !== 0) {
      throw new Error(`controlForeignWindow(2, slot) failed with 0x${foreignRestoreResult.toString(16)}.`);
    }
    await sleep(40);

    info = requireThreadInfo(harness, shellSlot, "shell after foreign restore");
    if ((info.windowState & 0x02) !== 0) {
      throw new Error("Shell stayed minimized after controlForeignWindow restore.");
    }
    if ((harness.getActiveThreadSlot() >>> 0) !== activeBeforeRestore) {
      throw new Error("controlForeignWindow restore unexpectedly changed the active window.");
    }

    const desktop = harness.captureDesktopSnapshot({ includeSurfaceHash: true });
    const shellEntry = desktop.processes.find((item) => (item.slot >>> 0) === shellSlot) || null;
    if (!shellEntry || shellEntry.minimized) {
      throw new Error("Restored shell is still marked minimized in desktop snapshot.");
    }

    console.log(
      `Autotest OK: launcher minimize flow shellSlot=${shellSlot} ` +
      `active=${harness.getActiveThreadSlot() >>> 0} hash=${desktop.desktopSurface.hash || "n/a"}`
    );
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

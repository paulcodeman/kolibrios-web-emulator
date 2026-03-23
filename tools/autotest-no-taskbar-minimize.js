const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

const DEFAULT_ROOT = process.env.KOS_ROOT || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root";
const WINDOW_STATE_MINIMIZED = 0x02;

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
  const rootDir = path.resolve(process.argv[2] || DEFAULT_ROOT);
  const target = path.join(rootDir, "SHELL");
  const harness = new HeadlessUiHarness({
    launchDelayMs: 220,
    defaultTimeoutMs: 5000,
    actionDelayMs: 40
  });

  try {
    await harness.launch(target);
    await sleep(1500);

    const snapshot = harness.captureSnapshot({ includeSurfaceHash: true });
    if (!snapshot.running || !snapshot.window || !snapshot.window.defined) {
      throw new Error("SHELL did not produce a running window.");
    }

    const shellSlot = snapshot.slot >>> 0;
    if (harness.hasTaskbarWindow()) {
      throw new Error("Taskbar unexpectedly exists in standalone launch scenario.");
    }
    if ((harness.getActiveThreadSlot() >>> 0) !== shellSlot) {
      throw new Error(`Expected standalone shell slot ${shellSlot} to stay active.`);
    }

    let info = requireThreadInfo(harness, shellSlot, "shell before standalone minimize");
    if ((info.windowState & WINDOW_STATE_MINIMIZED) !== 0) {
      throw new Error("Standalone shell unexpectedly starts minimized.");
    }

    if (harness.minimizeTopWindow()) {
      throw new Error("minimizeTopWindow() should not hide a window when no taskbar is present.");
    }
    await sleep(40);

    info = requireThreadInfo(harness, shellSlot, "shell after standalone minimize");
    if ((info.windowState & WINDOW_STATE_MINIMIZED) !== 0) {
      throw new Error("Standalone shell became minimized without a taskbar.");
    }
    if ((harness.getActiveThreadSlot() >>> 0) !== shellSlot) {
      throw new Error("Standalone shell lost focus after rejected minimize.");
    }

    const desktop = harness.captureDesktopSnapshot({ includeSurfaceHash: true });
    const shellEntry = desktop.processes.find((item) => (item.slot >>> 0) === shellSlot) || null;
    if (!shellEntry || shellEntry.minimized) {
      throw new Error("Standalone shell disappeared from desktop snapshot after rejected minimize.");
    }

    console.log(
      `Autotest OK: standalone minimize guard kept shell slot=${shellSlot} ` +
      `visible hash=${desktop.desktopSurface.hash || "n/a"}.`
    );
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

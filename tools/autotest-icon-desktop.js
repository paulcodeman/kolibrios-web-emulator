const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

function countLabelPixels(surface, x, y, width, height) {
  if (!surface || !surface.buffer32) {
    return 0;
  }
  const w = surface.width | 0;
  const h = surface.height | 0;
  const x0 = Math.max(0, x | 0);
  const y0 = Math.max(0, y | 0);
  const x1 = Math.min(w, (x + width) | 0);
  const y1 = Math.min(h, (y + height) | 0);
  const background = surface.buffer32[Math.min(h - 1, Math.max(0, y0)) * w + Math.min(w - 1, Math.max(0, x0))] >>> 0;
  let changed = 0;
  for (let py = y0; py < y1; py += 1) {
    const row = py * w;
    for (let px = x0; px < x1; px += 1) {
      if ((surface.buffer32[row + px] >>> 0) !== background) {
        changed += 1;
      }
    }
  }
  return changed;
}

async function main() {
  const target = path.resolve(process.argv[2] || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root\\@ICON");
  const harness = new HeadlessUiHarness({
    launchDelayMs: 220,
    defaultTimeoutMs: 20000,
    viewportWidth: 1000,
    viewportHeight: 700,
    echoLogs: process.env.KOS_TRACE_HARNESS === "1"
  });

  try {
    await harness.launch(target);
    const drawn = await harness.waitUntil(() => {
      const state = harness.captureDesktopSnapshot({ includeSurfaceHash: true });
      const iconThreads = harness.processes.filter((process) => (process.displayPath || "").toUpperCase().includes("@ICON"));
      return iconThreads.length ? state : null;
    }, "standalone @ICON desktop draw", 12000);

    const desktopSurface = harness.desktopSurface;
    const labelPixels = countLabelPixels(desktopSurface, 0, 42, 68, 20);
    if (labelPixels < 20) {
      throw new Error(`@ICON label area still looks blank: only ${labelPixels} changed pixels.`);
    }

    const beforeCount = harness.processes.length;
    await harness.clickDesktop(239, 20, { settleMs: 1800 });
    const launched = await harness.waitUntil(() => {
      const extra = harness.processes.find((process) => {
        const displayPath = (process.displayPath || "").toUpperCase();
        const title = process.emulator ? String(process.emulator.windowTitle || "") : "";
        return displayPath.includes("CALCPLUS") && title === "Calc+" && !!(process.emulator && process.emulator.windowDefined);
      });
      return extra || null;
    }, "desktop icon app launch", 8000);

    console.log(
      `Autotest OK: @ICON labels=${labelPixels} launch='${launched.displayPath}' ` +
      `processes=${beforeCount}->${harness.processes.length} hash=${drawn.desktopSurface.hash}`
    );
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

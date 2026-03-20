const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

function countChangedPixels(surface, x, y, width, height) {
  if (!surface || !surface.buffer32) {
    return 0;
  }
  const w = surface.width | 0;
  const h = surface.height | 0;
  const x0 = Math.max(0, x | 0);
  const y0 = Math.max(0, y | 0);
  const x1 = Math.min(w, (x + width) | 0);
  const y1 = Math.min(h, (y + height) | 0);
  const sampleX = Math.min(w - 1, Math.max(0, x0));
  const sampleY = Math.min(h - 1, Math.max(0, y0));
  const background = surface.buffer32[(sampleY * w) + sampleX] >>> 0;
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
    await harness.waitUntil(() => {
      const labelPixels = countChangedPixels(harness.desktopSurface, 0, 42, 68, 20);
      return labelPixels >= 20 ? labelPixels : null;
    }, "initial @ICON labels", 12000);

    const desktop = harness.desktopSurface;
    const width = Math.max(1, desktop ? (desktop.width | 0) : 1);
    const height = Math.max(1, desktop ? (desktop.height | 0) : 1);
    const white = new Uint8Array(width * height * 4);
    for (let i = 0; i < white.length; i += 4) {
      white[i] = 0xff;
      white[i + 1] = 0xff;
      white[i + 2] = 0xff;
      white[i + 3] = 0xff;
    }

    harness.putDesktopImage(white, width, height, 0, 0, 0xffffffff);

    const restored = await harness.waitUntil(() => {
      const labelPixels = countChangedPixels(harness.desktopSurface, 0, 42, 68, 20);
      return labelPixels >= 20 ? labelPixels : null;
    }, "desktop icon redraw after foreign desktop blit", 5000);

    console.log(`Autotest OK: @ICON restored ${restored} label pixels after desktop blit ${width}x${height}.`);
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

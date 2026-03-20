const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

const DEFAULT_ROOT = process.env.KOS_ROOT || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root";

function hasUnhandledLogs(snapshot) {
  return Array.isArray(snapshot.logs) && snapshot.logs.some((line) => /^Unhandled |Interpreter error|Host session /.test(line));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms | 0)));
}

function countUniqueColors(surface, x0, y0, width, height) {
  if (!surface || !surface.buffer32) {
    return 0;
  }
  const colors = new Set();
  const startX = Math.max(0, x0 | 0);
  const startY = Math.max(0, y0 | 0);
  const endX = Math.min(surface.width | 0, (startX + Math.max(1, width | 0)) | 0);
  const endY = Math.min(surface.height | 0, (startY + Math.max(1, height | 0)) | 0);
  for (let y = startY; y < endY; y += 1) {
    let index = y * (surface.width | 0) + startX;
    for (let x = startX; x < endX; x += 1) {
      colors.add(surface.buffer32[index++] >>> 0);
    }
  }
  return colors.size;
}

async function main() {
  const rootDir = path.resolve(process.argv[2] || DEFAULT_ROOT);
  const target = path.join(rootDir, "ALLGAMES");
  const harness = new HeadlessUiHarness({
    launchDelayMs: 220,
    defaultTimeoutMs: 18000,
    actionDelayMs: 40
  });

  try {
    await harness.launch(target);
    const snapshot = await harness.waitUntil((state) => {
      if (!state.window || !state.window.defined) {
        return null;
      }
      if (!state.title || !state.title.includes("Колибри")) {
        return null;
      }
      if ((state.window.height | 0) < 600) {
        return null;
      }
      return harness.captureSnapshot({ includeSurfaceHash: true, includeLogs: true });
    }, "ALLGAMES main window with mounted KolibriOS entries", 18000);

    await sleep(300);
    const process = harness.getActiveProcess();
    if (!process || !process.surface) {
      throw new Error("ALLGAMES did not keep an active rendered process.");
    }

    const iconX = ((snapshot.window.clientOffsetX | 0) + 26) | 0;
    const iconY = ((snapshot.window.clientOffsetY | 0) + 5) | 0;
    const uniqueColors = countUniqueColors(process.surface, iconX, iconY, 32, 32);

    if (uniqueColors < 6) {
      throw new Error(`ALLGAMES first icon region still looks blank: only ${uniqueColors} unique colors.`);
    }
    if (hasUnhandledLogs(snapshot)) {
      throw new Error("ALLGAMES icon path hit an unhandled emulator path.");
    }

    console.log(
      `Autotest OK: ALLGAMES rendered icons (title='${snapshot.title}', window=${snapshot.window.width}x${snapshot.window.height}, ` +
      `iconColors=${uniqueColors}, hash=${snapshot.surface.hash}).`
    );
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

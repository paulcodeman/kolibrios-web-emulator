const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

const DEFAULT_ROOT = process.env.KOS_ROOT || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms | 0)));
}

function scanGearViewport(surface, width, height) {
  const left = Math.max(24, Math.floor(width * 0.08));
  const right = Math.max(left + 1, Math.min(width - 24, Math.floor(width * 0.92)));
  const top = Math.max(90, Math.floor(height * 0.22));
  const bottom = Math.max(top + 1, Math.min(height - 24, Math.floor(height * 0.90)));
  const stepX = Math.max(1, Math.floor((right - left) / 36));
  const stepY = Math.max(1, Math.floor((bottom - top) / 28));
  let nonBlack = 0;
  let colored = 0;
  let samples = 0;

  for (let y = top; y < bottom; y += stepY) {
    const row = y * (surface.width | 0);
    for (let x = left; x < right; x += stepX) {
      const pixel = surface.buffer32[row + x] >>> 0;
      const r = pixel & 0xff;
      const g = (pixel >>> 8) & 0xff;
      const b = (pixel >>> 16) & 0xff;
      samples += 1;
      if ((pixel & 0x00ffffff) !== 0) {
        nonBlack += 1;
      }
      if (r !== g || g !== b) {
        colored += 1;
      }
    }
  }

  return { samples, nonBlack, colored };
}

async function main() {
  const rootDir = path.resolve(process.argv[2] || DEFAULT_ROOT);
  const target = path.join(rootDir, "3D", "GEARS");
  const harness = new HeadlessUiHarness({
    launchDelayMs: 220,
    defaultTimeoutMs: 5000,
    actionDelayMs: 40
  });

  try {
    await harness.launch(target);
    await sleep(2500);

    const processState = harness.getActiveProcess();
    if (!processState || !processState.emulator || !processState.surface) {
      throw new Error("GEARS did not create an active process surface.");
    }
    const emulator = processState.emulator;
    const surface = processState.surface;
    const width = Math.max(1, emulator.windowWidth | 0 || surface.width | 0);
    const height = Math.max(1, emulator.windowHeight | 0 || surface.height | 0);
    const scan = scanGearViewport(surface, width, height);
    const snapshot = harness.captureSnapshot({ includeSurfaceHash: true, includeLogs: true });

    if (!snapshot.running || !snapshot.window || !snapshot.window.defined) {
      throw new Error("GEARS did not keep a running window.");
    }
    if (String(snapshot.title || "").trim() !== "TinyGL in KolibriOS") {
      throw new Error(`Unexpected GEARS caption: '${snapshot.title || ""}'.`);
    }
    if ((snapshot.surface.presentCount | 0) < 3) {
      throw new Error(`GEARS did not present enough frames: ${snapshot.surface.presentCount}.`);
    }
    if (scan.nonBlack < 40) {
      throw new Error(
        `GEARS viewport stayed mostly black: ${scan.nonBlack}/${scan.samples} non-black samples, ` +
        `${scan.colored}/${scan.samples} colored.`
      );
    }
    if (scan.colored < 12) {
      throw new Error(
        `GEARS viewport did not render the expected colored 3D content: ` +
        `${scan.colored}/${scan.samples} colored samples.`
      );
    }

    console.log(
      `Autotest OK: GEARS window ${snapshot.window.width}x${snapshot.window.height}, ` +
      `title='${snapshot.title}', presents=${snapshot.surface.presentCount}, ` +
      `viewport=${scan.nonBlack}/${scan.samples} non-black, ${scan.colored}/${scan.samples} colored, ` +
      `hash=${snapshot.surface.hash}.`
    );
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

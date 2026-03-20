const fs = require("fs");
const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms | 0)));
}

function makeDefaultOutputPath(targetPath, delayMs) {
  const baseName = path.basename(targetPath).replace(/[^\w.-]+/g, "_");
  return path.resolve(__dirname, "..", "artifacts", "captures", `${baseName}-${delayMs}ms.png`);
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: node tools/capture-frame.js <file.kex> [delay_ms] [out.png]");
    process.exit(1);
  }

  const delayMs = Math.max(0, Number(process.argv[3] || 10000) | 0);
  const targetPath = path.resolve(target);
  const outPath = path.resolve(process.argv[4] || makeDefaultOutputPath(targetPath, delayMs));
  if (!fs.existsSync(targetPath)) {
    console.error(`Target not found: ${targetPath}`);
    process.exit(1);
  }

  const harness = new HeadlessUiHarness({
    launchDelayMs: 220,
    defaultTimeoutMs: Math.max(5000, delayMs + 2000),
    echoLogs: process.env.KOS_TRACE_HARNESS === "1"
  });

  try {
    await harness.launch(targetPath);
    await sleep(delayMs);
    const snapshot = harness.captureSnapshot({ includeSurfaceHash: true, includeLogs: true });
    const image = harness.saveScreenshot(outPath);
    console.log(JSON.stringify({
      target: targetPath,
      output: image.path,
      delayMs,
      title: snapshot.title || "",
      running: snapshot.running,
      window: snapshot.window,
      surface: {
        width: snapshot.surface ? snapshot.surface.width : 0,
        height: snapshot.surface ? snapshot.surface.height : 0,
        hash: snapshot.surface ? snapshot.surface.hash : ""
      },
      image
    }, null, 2));
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

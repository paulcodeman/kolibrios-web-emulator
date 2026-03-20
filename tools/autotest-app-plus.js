const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

const DEFAULT_ROOT = process.env.KOS_ROOT || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root";

function hasText(snapshot, expected) {
  const needle = String(expected || "").toUpperCase();
  return snapshot.texts.some((item) => String(item.text || "").toUpperCase().includes(needle));
}

async function main() {
  const rootDir = path.resolve(process.argv[2] || DEFAULT_ROOT);
  const target = path.join(rootDir, "APP_PLUS");
  const harness = new HeadlessUiHarness({
    launchDelayMs: 180,
    defaultTimeoutMs: 2000
  });

  try {
    await harness.launch(target);
    const snapshot = harness.captureSnapshot({ includeSurfaceHash: true, includeLogs: true });
    if (!snapshot.running) {
      throw new Error("APP_PLUS stopped during launch.");
    }
    if (!snapshot.window || !snapshot.window.defined) {
      throw new Error("APP_PLUS did not define a window.");
    }
    if (!snapshot.buttons.some((item) => item.id === 10) || !snapshot.buttons.some((item) => item.id === 11)) {
      throw new Error("APP_PLUS did not draw the expected action buttons.");
    }
    if (!hasText(snapshot, "/KOLIBRIOS/")) {
      throw new Error("APP_PLUS did not render the expected /KOLIBRIOS/ warning text.");
    }
    if (snapshot.logs.some((line) => line.includes("Unhandled syscall 68 sub 22"))) {
      throw new Error("APP_PLUS still hit unhandled syscall 68.22.");
    }
    console.log(
      `Autotest OK: APP_PLUS window ${snapshot.window.width}x${snapshot.window.height}, buttons=${snapshot.buttons.length}, hash=${snapshot.surface.hash}.`
    );
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

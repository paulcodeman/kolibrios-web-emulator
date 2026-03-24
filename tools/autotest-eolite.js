const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

const DEFAULT_ROOT = process.env.KOS_ROOT || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root";

async function main() {
  const rootDir = path.resolve(process.argv[2] || DEFAULT_ROOT);
  const target = path.join(rootDir, "EOLITE");
  const harness = new HeadlessUiHarness({
    launchDelayMs: 220,
    defaultTimeoutMs: 5000
  });

  try {
    await harness.launch(target);
    await new Promise((resolve) => setTimeout(resolve, 4000));

    const snapshot = harness.captureSnapshot({ includeSurfaceHash: true, includeLogs: true });
    if (!snapshot.running) {
      throw new Error("EOLITE stopped during launch.");
    }
    if (!snapshot.window || !snapshot.window.defined) {
      throw new Error("EOLITE did not define a window.");
    }
    if (!/Eolite File Manager/i.test(snapshot.title || "")) {
      throw new Error(`Unexpected EOLITE title: '${snapshot.title || ""}'`);
    }
    if (!snapshot.texts.some((item) => String(item.text || "").includes("F10"))) {
      throw new Error("EOLITE did not render the expected toolbar/menu text.");
    }
    if (snapshot.unknownOpcodes.length) {
      throw new Error(`EOLITE hit unknown opcodes: ${JSON.stringify(snapshot.unknownOpcodes)}`);
    }
    if (snapshot.logs.some((line) => /^Unhandled /.test(line))) {
      throw new Error("EOLITE still hit an unhandled syscall or opcode path.");
    }

    console.log(
      `Autotest OK: EOLITE window ${snapshot.window.width}x${snapshot.window.height}, texts=${snapshot.texts.length}, hash=${snapshot.surface.hash}.`
    );
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

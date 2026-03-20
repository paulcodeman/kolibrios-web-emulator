const fs = require("fs");
const path = require("path");
const { HeadlessUiHarness, loadScenarioFile } = require("./ui-harness");

const rootDir = process.env.KOS_ROOT || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root";
const defaultPath = path.resolve(rootDir, "CALC");
const target = process.argv[2] ? path.resolve(process.argv[2]) : defaultPath;
const scenarioPath = path.resolve(__dirname, "scenario-calc-multiply.json");

if (!fs.existsSync(target)) {
  console.error("CALC not found.");
  console.error("Usage: node tools/autotest-calc-ui.js <path-to-calc> [timeout_ms]");
  console.error(`Default path tried: ${defaultPath}`);
  process.exit(1);
}

const timeoutArg = Number(process.argv[3] || 2500);
const scenario = loadScenarioFile(scenarioPath);
if (Number.isFinite(timeoutArg) && timeoutArg > 0) {
  scenario.timeoutMs = timeoutArg | 0;
}

(async () => {
  const harness = new HeadlessUiHarness({
    echoLogs: process.env.KOS_TRACE_HARNESS === "1"
  });
  try {
    await harness.launch(target);
    const snapshot = await harness.runScenario(scenario);
    const hasExpectedNumber = snapshot.numbers.some((item) => item.text.includes("15"));
    if (!hasExpectedNumber) {
      throw new Error("Scenario completed without visible number '15'.");
    }
    console.log(
      `Autotest OK: CALC UI produced 15 (window ${snapshot.window.width}x${snapshot.window.height}, hash ${snapshot.surface.hash}).`
    );
    process.exit(0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error(JSON.stringify(harness.captureSnapshot({ includeSurfaceHash: true, includeLogs: true }), null, 2));
    process.exit(2);
  } finally {
    harness.close();
  }
})().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});

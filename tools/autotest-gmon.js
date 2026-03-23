const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

async function main() {
  const target = path.resolve(process.argv[2] || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root\\GMON");
  const harness = new HeadlessUiHarness({
    launchDelayMs: 150,
    defaultTimeoutMs: 12000,
    viewportWidth: 1000,
    viewportHeight: 700,
    echoLogs: process.env.KOS_TRACE_HARNESS === "1"
  });

  try {
    await harness.launch(target);
    const result = await harness.waitUntil((snapshot) => {
      const cpuLoadDraw = snapshot.numbers
        .filter((item) => (item.screenY | 0) === 30)
        .slice()
        .sort((a, b) => (a.screenX | 0) - (b.screenX | 0))[0] || null;
      const memLoadDraw = snapshot.numbers
        .filter((item) => (item.screenY | 0) === 40)
        .slice()
        .sort((a, b) => (a.screenX | 0) - (b.screenX | 0))[0] || null;
      const freqDraw = snapshot.numbers
        .filter((item) => (item.screenY | 0) === 295)
        .slice()
        .sort((a, b) => (a.screenX | 0) - (b.screenX | 0))[0] || null;
      const familyModel = snapshot.numbers
        .filter((item) => (item.screenY | 0) === 285)
        .slice()
        .sort((a, b) => (a.screenX | 0) - (b.screenX | 0));
      const multiplierDraw = snapshot.texts
        .filter((item) => (item.screenY | 0) === 315 && /[0-9]/.test(item.text))
        .slice()
        .sort((a, b) => (a.screenX | 0) - (b.screenX | 0))[0] || null;
      if (!cpuLoadDraw || !memLoadDraw || !freqDraw || familyModel.length < 2 || !multiplierDraw) {
        return null;
      }
      const cpuLoad = Number.parseInt(cpuLoadDraw.text, 10);
      const memLoad = Number.parseInt(memLoadDraw.text, 10);
      const cpuFreqMhz = Number.parseInt(freqDraw.text, 10);
      if (!Number.isFinite(cpuLoad) || cpuLoad >= 100) {
        return null;
      }
      if (!Number.isFinite(memLoad) || memLoad <= 1 || memLoad >= 100) {
        return null;
      }
      if (!Number.isFinite(cpuFreqMhz) || cpuFreqMhz < 1000) {
        return null;
      }
      if (familyModel[0].text === "0" && familyModel[1].text === "0") {
        return null;
      }
      return {
        cpuLoad: cpuLoad | 0,
        memLoad: memLoad | 0,
        cpuFreqMhz: cpuFreqMhz | 0,
        family: familyModel[0].text,
        model: familyModel[1].text,
        multiplier: multiplierDraw.text
      };
    }, "GMON cpu info visible", 8000);
    const finalSnapshot = harness.captureSnapshot({ includeSurfaceHash: true });

    console.log(
      `Autotest OK: GMON cpuLoad=${result.cpuLoad} memLoad=${result.memLoad} freqMHz=${result.cpuFreqMhz} ` +
      `family=${result.family} model=${result.model} multiplier=${result.multiplier} ` +
      `hash=${finalSnapshot.surface && finalSnapshot.surface.hash ? finalSnapshot.surface.hash : "<none>"}`
    );
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

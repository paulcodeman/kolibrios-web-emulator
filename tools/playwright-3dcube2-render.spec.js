const path = require("path");
const { test, expect } = require("playwright/test");

const LAUNCHER_URL = `file:///${path.resolve(__dirname, "..", "launcher.html").replace(/\\/g, "/")}`;

test.setTimeout(60000);

test("3dcube2 keeps presenting frames in launcher", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    window.__readCubeState = () => {
      const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
      if (!session || !Array.isArray(session.processes)) {
        return null;
      }
      const process = session.processes.find((item) => (
        String(item && (item.displayPath || item.processPath || "")).toUpperCase() === "/3D/3DCUBE2" &&
        item &&
        !item.removed
      )) || null;
      if (!process || !process.emulator || !process.surface || !(process.surface.buffer32 instanceof Uint32Array)) {
        return null;
      }
      const buffer = process.surface.buffer32;
      let whiteSamples = 0;
      let blackSamples = 0;
      let coloredSamples = 0;
      let totalSamples = 0;
      for (let i = 0; i < buffer.length; i += 257) {
        const pixel = buffer[i] & 0x00ffffff;
        totalSamples += 1;
        if (pixel === 0xffffff) {
          whiteSamples += 1;
        } else if (pixel === 0x000000) {
          blackSamples += 1;
        }
        const r = (pixel >>> 16) & 0xff;
        const g = (pixel >>> 8) & 0xff;
        const b = pixel & 0xff;
        if (!(r === g && g === b)) {
          coloredSamples += 1;
        }
      }
      return {
        nowMs: performance.now(),
        lastPresentAt: Number(process.emulator.lastPresentAt || 0),
        surfaceDirty: !!process.emulator.surfaceDirty,
        active: session.getActiveProcess && session.getActiveProcess() === process,
        whiteSamples,
        blackSamples,
        coloredSamples,
        totalSamples
      };
    };
  });
  await page.goto(LAUNCHER_URL);
  await page.waitForFunction(() => !!window.__app && !!window.__app.sessionManager);
  await page.waitForFunction(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    return !!(
      session &&
      Array.isArray(session.processes) &&
      session.processes.some((process) => (
        String(process && (process.displayPath || process.processPath || "")).toUpperCase() === "/SYS/@TASKBAR" &&
        process &&
        process.emulator &&
        process.emulator.windowDefined &&
        !process.removed
      ))
    );
  }, null, { timeout: 20000 });

  const launch = await page.evaluate(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    if (!session || typeof session.launchPath !== "function") {
      return null;
    }
    const process = session.launchPath("/3D/3DCUBE2", { activate: true });
    if (!process) {
      return null;
    }
    window.__cubePid = process.pid >>> 0;
    return { pid: process.pid >>> 0 };
  });

  expect(launch).not.toBeNull();
  expect(launch.pid).toBeGreaterThan(0);

  await page.waitForFunction(() => {
    const state = typeof window.__readCubeState === "function" ? window.__readCubeState() : null;
    return !!state && state.coloredSamples > 8;
  }, null, { timeout: 10000 });

  await page.waitForTimeout(7000);

  const first = await page.evaluate(() => window.__readCubeState());
  await page.waitForTimeout(1200);
  const second = await page.evaluate(() => window.__readCubeState());

  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(first.whiteSamples).toBeGreaterThan(80);
  expect(first.coloredSamples).toBeGreaterThan(20);
  expect(first.nowMs - first.lastPresentAt).toBeLessThan(2000);
  expect(second.nowMs - second.lastPresentAt).toBeLessThan(2000);
  expect(second.lastPresentAt).toBeGreaterThan(first.lastPresentAt);
  expect(second.surfaceDirty).toBe(false);

  await page.screenshot({
    path: testInfo.outputPath("3dcube2-render.png"),
    fullPage: true
  });
});

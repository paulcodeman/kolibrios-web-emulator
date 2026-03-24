const path = require("path");
const { test, expect } = require("playwright/test");

const LAUNCHER_URL = `file:///${path.resolve(__dirname, "..", "launcher.html").replace(/\\/g, "/")}`;

test.setTimeout(60000);

test("dbgboard renders messages from the debug board queue", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    window.__readDbgboardState = () => {
      const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
      if (!session || !Array.isArray(session.processes)) {
        return null;
      }
      const matches = session.processes.filter((process) => (
        String(process && (process.displayPath || process.processPath || "")).toUpperCase() === "/DEVELOP/DBGBOARD" &&
        process &&
        !process.removed &&
        process.emulator &&
        process.emulator.windowDefined &&
        process.surface &&
        process.surface.buffer32 instanceof Uint32Array
      ));
      if (!matches.length) {
        return null;
      }
      const process = matches[matches.length - 1];
      const buffer = process.surface.buffer32;
      let hash = 2166136261 >>> 0;
      let nonBlack = 0;
      let total = 0;
      for (let i = 0; i < buffer.length; i += 1) {
        const pixel = buffer[i] & 0x00ffffff;
        hash ^= buffer[i] >>> 0;
        hash = Math.imul(hash, 16777619) >>> 0;
        total += 1;
        if (pixel !== 0x000000) {
          nonBlack += 1;
        }
      }
      return {
        pid: process.pid >>> 0,
        hash: `0x${hash.toString(16)}`,
        nonBlack,
        total,
        presentAt: Number(process.emulator.lastPresentAt || 0)
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
    const process = session.launchPath("/develop/dbgboard", { activate: true });
    if (!process) {
      return null;
    }
    window.__dbgboardPid = process.pid >>> 0;
    return { pid: process.pid >>> 0 };
  });

  expect(launch).not.toBeNull();
  expect(launch.pid).toBeGreaterThan(0);

  await page.waitForFunction(() => {
    const state = typeof window.__readDbgboardState === "function" ? window.__readDbgboardState() : null;
    if (!state) {
      return false;
    }
    window.__dbgboardVisiblePid = state.pid >>> 0;
    return true;
  }, null, { timeout: 10000 });

  const before = await page.evaluate(() => (
    typeof window.__readDbgboardState === "function" ? window.__readDbgboardState() : null
  ));

  expect(before).not.toBeNull();
  expect(before.pid).toBeGreaterThan(0);
  expect(before.nonBlack).toBeGreaterThan(12);

  await page.evaluate(() => {
    window.__app.sessionManager.writeDebugBoardMessage("I: dbgboard test message\r\n");
  });

  await page.waitForFunction((initialHash) => {
    const state = typeof window.__readDbgboardState === "function" ? window.__readDbgboardState() : null;
    return !!state && state.hash !== initialHash;
  }, before.hash, { timeout: 8000 });

  const after = await page.evaluate(() => (
    typeof window.__readDbgboardState === "function" ? window.__readDbgboardState() : null
  ));

  expect(after).not.toBeNull();
  expect(after.pid).toBe(before.pid);
  expect(after.hash).not.toBe(before.hash);
  expect(after.nonBlack).toBeGreaterThan(12);
  expect(after.presentAt).toBeGreaterThanOrEqual(before.presentAt);

  await page.screenshot({
    path: testInfo.outputPath("dbgboard-board.png"),
    fullPage: true
  });
});

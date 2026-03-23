const path = require("path");
const { test, expect } = require("playwright/test");

const LAUNCHER_URL = `file:///${path.resolve(__dirname, "..", "launcher.html").replace(/\\/g, "/")}`;

test("browser session reports virtual system RAM instead of host RAM", async ({ page }) => {
  await page.goto(LAUNCHER_URL);
  await page.waitForFunction(() => !!window.__app && !!window.__app.sessionManager);
  await page.waitForFunction(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    return !!(
      session &&
      Array.isArray(session.processes) &&
      session.processes.some((process) => {
        const pathText = String(process && (process.displayPath || process.processPath || ""));
        return pathText.toUpperCase() === "/SYS/@TASKBAR" && process.emulator && process.emulator.windowDefined;
      })
    );
  }, null, { timeout: 20000 });

  const state = await page.evaluate(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    if (!session) {
      return null;
    }
    const processUsed = session.processes.reduce((sum, process) => {
      if (!process || process.removed) {
        return sum;
      }
      return (sum + (session.getApproxProcessMemoryBytes(process) >>> 0)) >>> 0;
    }, 0) >>> 0;
    return {
      total: session.getReportedTotalRamBytes() >>> 0,
      free: session.getReportedFreeRamBytes() >>> 0,
      used: session.getReportedUsedRamBytes() >>> 0,
      processUsed,
      reserved: session.getConfiguredSystemReservedRamBytes() >>> 0
    };
  });

  expect(state).not.toBeNull();
  expect(state.total).toBe(512 * 1024 * 1024);
  expect(state.used).toBe(state.processUsed + state.reserved);
  expect(state.free).toBe(state.total - state.used);
  expect(state.used).toBeGreaterThan(16 * 1024 * 1024);
});

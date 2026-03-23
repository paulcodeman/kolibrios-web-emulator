const path = require("path");
const { test, expect } = require("playwright/test");

const LAUNCHER_URL = `file:///${path.resolve(__dirname, "..", "launcher.html").replace(/\\/g, "/")}`;

test("mtdbg closes from system close button", async ({ page }) => {
  await page.goto(LAUNCHER_URL);
  await page.waitForFunction(() => !!window.__app && !!window.__app.sessionManager && !!window.__app.browserFsRoot);
  await page.waitForTimeout(2500);

  const pid = await page.evaluate(() => {
    const session = window.__app.sessionManager;
    const process = session.launchPath("/sys/develop/mtdbg", { activate: true });
    return process.pid >>> 0;
  });

  await page.waitForFunction((targetPid) => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    return !!(session && session.processes.some((item) => (item.pid >>> 0) === (targetPid >>> 0) && !item.removed));
  }, pid);

  await page.evaluate((targetPid) => {
    const session = window.__app.sessionManager;
    const process = session.processes.find((item) => (item.pid >>> 0) === (targetPid >>> 0)) || null;
    if (!process) {
      throw new Error("MTDBG process not found.");
    }
    process.performSystemButton("close");
  }, pid);

  await page.waitForFunction((targetPid) => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    return !!(session && !session.processes.some((item) => (item.pid >>> 0) === (targetPid >>> 0) && !item.removed));
  }, pid);

  const state = await page.evaluate((targetPid) => {
    const session = window.__app.sessionManager;
    return {
      stillPresent: session.processes.some((item) => (item.pid >>> 0) === (targetPid >>> 0) && !item.removed),
      activePath: session.getActiveProcess() ? String(session.getActiveProcess().displayPath || session.getActiveProcess().processPath || "") : ""
    };
  }, pid);

  expect(state.stillPresent).toBe(false);
});

const path = require("path");
const { test, expect } = require("playwright/test");

const LAUNCHER_URL = `file:///${path.resolve(__dirname, "..", "launcher.html").replace(/\\/g, "/")}`;

test("mtdbg window size stays stable after launch", async ({ page }) => {
  await page.goto(LAUNCHER_URL);
  await page.waitForFunction(() => !!window.__app && !!window.__app.sessionManager && !!window.__app.browserFsRoot);
  await page.waitForTimeout(2500);

  const pid = await page.evaluate(() => {
    const session = window.__app.sessionManager;
    const process = session.launchPath("/sys/develop/mtdbg", { activate: true });
    return process.pid >>> 0;
  });

  await page.waitForTimeout(800);
  const first = await page.evaluate((targetPid) => {
    const session = window.__app.sessionManager;
    const process = session.processes.find((item) => (item.pid >>> 0) === (targetPid >>> 0)) || null;
    if (!process) {
      return null;
    }
    const client = process.getClientBounds();
    return {
      width: process.windowWidth | 0,
      height: process.windowHeight | 0,
      clientWidth: client.width | 0,
      clientHeight: client.height | 0
    };
  }, pid);

  await page.waitForTimeout(1200);
  const second = await page.evaluate((targetPid) => {
    const session = window.__app.sessionManager;
    const process = session.processes.find((item) => (item.pid >>> 0) === (targetPid >>> 0)) || null;
    if (!process) {
      return null;
    }
    const client = process.getClientBounds();
    return {
      width: process.windowWidth | 0,
      height: process.windowHeight | 0,
      clientWidth: client.width | 0,
      clientHeight: client.height | 0
    };
  }, pid);

  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(first.width).toBeGreaterThan(0);
  expect(first.height).toBeGreaterThan(0);
  expect(first.width).toBeLessThanOrEqual(890);
  expect(first.height).toBeLessThanOrEqual(760);
  expect(second.width).toBe(first.width);
  expect(second.height).toBe(first.height);
  expect(second.clientWidth).toBe(first.clientWidth);
  expect(second.clientHeight).toBe(first.clientHeight);
});

const path = require("path");
const { test, expect } = require("playwright/test");

const LAUNCHER_URL = `file:///${path.resolve(__dirname, "..", "launcher.html").replace(/\\/g, "/")}`;

test.setTimeout(60000);

test("tinypad context menu reopens after popup thread closes", async ({ page }) => {
  await page.goto(LAUNCHER_URL);
  await page.waitForFunction(() => !!window.__app && !!window.__app.sessionManager);
  await page.waitForFunction(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    if (!session || !Array.isArray(session.processes)) {
      return false;
    }
    return session.processes.some((process) => {
      const pathText = String(process && (process.displayPath || process.processPath || ""));
      return pathText.toUpperCase() === "/SYS/@TASKBAR" && process.emulator && process.emulator.windowDefined && !process.removed;
    });
  }, null, { timeout: 20000 });

  await page.evaluate(async () => {
    const session = window.__app.sessionManager;
    await window.__app.browserFsRoot.mutationProvider("create-file", "/rd/1/tinypad-context.txt", {
      data: new TextEncoder().encode("hello world\nsecond line\n")
    });
    const process = session.launchPath("/sys/tinypad", {
      activate: true,
      processArgs: "/rd/1/tinypad-context.txt"
    });
    if (!process) {
      throw new Error("Failed to launch TINYPAD.");
    }
    window.__tinypadPid = process.pid >>> 0;
    window.__tinypadGroup = process.threadGroupId >>> 0;
  });

  await page.waitForFunction(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    const targetPid = window.__tinypadPid >>> 0;
    if (!session || !targetPid || !Array.isArray(session.processes)) {
      return false;
    }
    const process = session.processes.find((item) => (item.pid >>> 0) === targetPid && !item.removed) || null;
    return !!(process && process.displayReady && process.emulator && process.emulator.windowDefined);
  }, null, { timeout: 10000 });

  await page.waitForTimeout(1200);

  const clickPoint = await page.evaluate(() => {
    const session = window.__app.sessionManager;
    const targetPid = window.__tinypadPid >>> 0;
    const process = session.processes.find((item) => (item.pid >>> 0) === targetPid && !item.removed) || null;
    if (!process) {
      return null;
    }
    const client = process.getClientBounds();
    return {
      x: ((process.actualX | 0) + (client.x | 0) + 40) | 0,
      y: ((process.actualY | 0) + 70) | 0
    };
  });

  expect(clickPoint).not.toBeNull();

  async function popupCount() {
    return page.evaluate(() => {
      const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
      const targetPid = window.__tinypadPid >>> 0;
      const groupId = window.__tinypadGroup >>> 0;
      if (!session || !targetPid || !groupId || !Array.isArray(session.processes)) {
        return 0;
      }
      return session.processes.filter((process) => (
        process &&
        !process.removed &&
        (process.threadGroupId >>> 0) === groupId &&
        (process.pid >>> 0) !== targetPid &&
        process.emulator &&
        process.emulator.windowDefined
      )).length;
    });
  }

  await page.mouse.click(clickPoint.x, clickPoint.y, { button: "right", delay: 80 });
  await page.waitForFunction(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    const targetPid = window.__tinypadPid >>> 0;
    const groupId = window.__tinypadGroup >>> 0;
    if (!session || !targetPid || !groupId || !Array.isArray(session.processes)) {
      return false;
    }
    return session.processes.some((process) => (
      process &&
      !process.removed &&
      (process.threadGroupId >>> 0) === groupId &&
      (process.pid >>> 0) !== targetPid &&
      process.emulator &&
      process.emulator.windowDefined
    ));
  }, null, { timeout: 5000 });
  expect(await popupCount()).toBe(1);

  await page.keyboard.press("Escape");
  await page.waitForFunction(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    const targetPid = window.__tinypadPid >>> 0;
    const groupId = window.__tinypadGroup >>> 0;
    if (!session || !targetPid || !groupId || !Array.isArray(session.processes)) {
      return false;
    }
    return !session.processes.some((process) => (
      process &&
      !process.removed &&
      (process.threadGroupId >>> 0) === groupId &&
      (process.pid >>> 0) !== targetPid &&
      process.emulator &&
      process.emulator.windowDefined
    ));
  }, null, { timeout: 5000 });
  expect(await popupCount()).toBe(0);

  await page.mouse.click(clickPoint.x, clickPoint.y, { button: "right", delay: 80 });
  await page.waitForFunction(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    const targetPid = window.__tinypadPid >>> 0;
    const groupId = window.__tinypadGroup >>> 0;
    if (!session || !targetPid || !groupId || !Array.isArray(session.processes)) {
      return false;
    }
    return session.processes.some((process) => (
      process &&
      !process.removed &&
      (process.threadGroupId >>> 0) === groupId &&
      (process.pid >>> 0) !== targetPid &&
      process.emulator &&
      process.emulator.windowDefined
    ));
  }, null, { timeout: 5000 });
  expect(await popupCount()).toBe(1);
});

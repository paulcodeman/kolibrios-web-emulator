const path = require("path");
const { test, expect } = require("playwright/test");

const LAUNCHER_URL = `file:///${path.resolve(__dirname, "..", "launcher.html").replace(/\\/g, "/")}`;

test.setTimeout(60000);

test("tinypad top menu opens popup window", async ({ page }) => {
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

  const launch = await page.evaluate(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    if (!session || typeof session.launchPath !== "function") {
      return null;
    }
    const process = session.launchPath("/sys/tinypad", { activate: true });
    if (!process) {
      return null;
    }
    window.__tinypadPid = process.pid >>> 0;
    window.__tinypadGroup = process.threadGroupId >>> 0;
    return {
      pid: process.pid >>> 0
    };
  });

  expect(launch).not.toBeNull();
  expect(launch.pid).toBeGreaterThan(0);

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
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    const targetPid = window.__tinypadPid >>> 0;
    if (!session || !targetPid || !Array.isArray(session.processes)) {
      return null;
    }
    const process = session.processes.find((item) => (item.pid >>> 0) === targetPid && !item.removed) || null;
    if (!process) {
      return null;
    }
    return {
      x: ((process.actualX | 0) + 18) | 0,
      y: ((process.actualY | 0) + 30) | 0
    };
  });

  expect(clickPoint).not.toBeNull();
  await page.mouse.move(clickPoint.x, clickPoint.y);
  await page.waitForTimeout(120);
  await page.mouse.down();
  await page.waitForTimeout(120);
  await page.mouse.up();

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

  const state = await page.evaluate(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    const targetPid = window.__tinypadPid >>> 0;
    const groupId = window.__tinypadGroup >>> 0;
    if (!session || !targetPid || !groupId || !Array.isArray(session.processes)) {
      return null;
    }
    const popup = session.processes.find((process) => (
      process &&
      !process.removed &&
      (process.threadGroupId >>> 0) === groupId &&
      (process.pid >>> 0) !== targetPid &&
      process.emulator &&
      process.emulator.windowDefined
    )) || null;
    return {
      hasTaskbar: session.processes.some((process) => {
        const pathText = String(process && (process.displayPath || process.processPath || ""));
        return pathText.toUpperCase() === "/SYS/@TASKBAR" && process.emulator && process.emulator.windowDefined && !process.removed;
      }),
      activePid: session.activeProcess ? (session.activeProcess.pid >>> 0) : 0,
      popupPid: popup ? (popup.pid >>> 0) : 0,
      popupWidth: popup ? (popup.windowWidth | 0) : 0,
      popupHeight: popup ? (popup.windowHeight | 0) : 0
    };
  });

  expect(state).not.toBeNull();
  expect(state.hasTaskbar).toBe(true);
  expect(state.popupPid).toBeGreaterThan(0);
  expect(state.activePid).toBe(state.popupPid);
  expect(state.popupWidth).toBeGreaterThan(100);
  expect(state.popupHeight).toBeGreaterThan(60);
});

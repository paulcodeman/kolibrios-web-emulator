const path = require("path");
const { test, expect } = require("playwright/test");

const LAUNCHER_URL = `file:///${path.resolve(__dirname, "..", "launcher.html").replace(/\\/g, "/")}`;

test("calendar launch clamps to the right edge on launcher desktop", async ({ page }) => {
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
  await page.waitForTimeout(1500);

  const launch = await page.evaluate(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    if (!session || typeof session.startApplication !== "function") {
      return null;
    }
    return session.startApplication({ path: "/sys/CALENDAR" });
  });

  expect(launch).not.toBeNull();
  expect(launch.errorCode).toBe(0);

  await page.waitForFunction(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    return !!(
      session &&
      Array.isArray(session.processes) &&
      session.processes.some((process) => {
        const pathText = String(process && (process.displayPath || process.processPath || ""));
        return pathText.toUpperCase() === "/SYS/CALENDAR" && process.emulator && process.emulator.windowDefined && !process.removed;
      })
    );
  }, null, { timeout: 10000 });

  const opened = await page.evaluate(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    if (!session) {
      return null;
    }
    const taskbar = session.processes.find((process) => {
      const pathText = String(process && (process.displayPath || process.processPath || ""));
      return pathText.toUpperCase() === "/SYS/@TASKBAR" && process.emulator && process.emulator.windowDefined;
    }) || null;
    const calendar = session.processes.find((process) => {
      const pathText = String(process && (process.displayPath || process.processPath || ""));
      return pathText.toUpperCase() === "/SYS/CALENDAR" && process.emulator && process.emulator.windowDefined && !process.removed;
    }) || null;
    if (!taskbar || !calendar) {
      return null;
    }
    return {
      viewportWidth: window.innerWidth | 0,
      taskbarX: taskbar.actualX | 0,
      taskbarW: taskbar.windowWidth | 0,
      calendarX: calendar.actualX | 0,
      calendarW: calendar.windowWidth | 0
    };
  });

  expect(opened).not.toBeNull();
  expect(opened.calendarX).toBeGreaterThan(Math.floor(opened.viewportWidth / 2));
  expect(opened.calendarX + opened.calendarW).toBeLessThanOrEqual(opened.viewportWidth);
});

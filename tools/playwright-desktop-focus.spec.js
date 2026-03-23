const path = require("path");
const { test, expect } = require("playwright/test");

const LAUNCHER_URL = `file:///${path.resolve(__dirname, "..", "launcher.html").replace(/\\/g, "/")}`;

test("desktop click clears active window focus", async ({ page }) => {
  await page.goto(LAUNCHER_URL);
  await page.waitForFunction(() => !!window.__app && !!window.__app.sessionManager && !!window.__app.browserFsRoot);
  await page.waitForTimeout(2500);
  await page.waitForFunction(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    if (!session || typeof session.getVisibleWindowStack !== "function") {
      return false;
    }
    return session.getVisibleWindowStack().some((process) => process && process.rootEl && process.shellEl);
  }, null, { timeout: 20000 });

  const before = await page.evaluate(() => {
    const session = window.__app.sessionManager;
    const process = session.getVisibleWindowStack().find((item) => item && item.rootEl && item.shellEl) || null;
    if (!process) {
      throw new Error("No visible window process to activate.");
    }
    session.setActiveProcess(process);
    process.focusShell();
    window.__desktopFocusPid = process.pid >>> 0;
    return {
      activeWindowCount: document.querySelectorAll(".workspace-window.active").length
    };
  });

  expect(before.activeWindowCount).toBeGreaterThan(0);

  await page.evaluate(() => {
    const session = window.__app.sessionManager;
    const canvas = session && session.desktopCanvasEl ? session.desktopCanvasEl : null;
    if (!canvas) {
      throw new Error("Missing desktop canvas.");
    }
    const rect = canvas.getBoundingClientRect();
    session.handleDesktopMouseDown({
      preventDefault() {},
      clientX: Math.floor(rect.left + 80),
      clientY: Math.floor(rect.top + 80),
      button: 0,
      buttons: 1
    });
  });

  await page.waitForTimeout(300);

  const after = await page.evaluate(() => {
    const session = window.__app.sessionManager;
    return {
      activePath: session.getActiveProcess() ? String(session.getActiveProcess().displayPath || session.getActiveProcess().processPath || "") : "",
      activeWindowCount: document.querySelectorAll(".workspace-window.active").length
    };
  });

  expect(after.activePath).toBe("");
  expect(after.activeWindowCount).toBe(0);
});

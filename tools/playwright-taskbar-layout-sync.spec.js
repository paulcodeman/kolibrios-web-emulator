const path = require("path");
const { test, expect } = require("playwright/test");

const LAUNCHER_URL = `file:///${path.resolve(__dirname, "..", "launcher.html").replace(/\\/g, "/")}`;

test.setTimeout(60000);

function findTaskbarProcess(session) {
  if (!session || !Array.isArray(session.processes)) {
    return null;
  }
  return session.processes.find((process) => {
    const pathText = String(process && (process.displayPath || process.processPath || ""));
    return pathText.toUpperCase() === "/SYS/@TASKBAR" && process.emulator && process.emulator.windowDefined && !process.removed;
  }) || null;
}

test("launcher syncs guest keyboard language from browser layout", async ({ page }) => {
  await page.goto(LAUNCHER_URL);
  await page.waitForFunction(() => !!window.__app && !!window.__app.sessionManager);
  await page.waitForFunction(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    return !!findTaskbarProcess(session);

    function findTaskbarProcess(innerSession) {
      if (!innerSession || !Array.isArray(innerSession.processes)) {
        return null;
      }
      return innerSession.processes.find((process) => {
        const pathText = String(process && (process.displayPath || process.processPath || ""));
        return pathText.toUpperCase() === "/SYS/@TASKBAR" && process.emulator && process.emulator.windowDefined && !process.removed;
      }) || null;
    }
  }, null, { timeout: 20000 });

  await page.evaluate(() => {
    const session = window.__app.sessionManager;
    session.setKeyboardLanguageId(1);
  });
  await page.waitForFunction(() => window.__app.sessionManager.getKeyboardLanguageId() === 1);

  const layoutState = await page.evaluate(async () => {
    const keyboardStub = navigator.keyboard || {};
    Object.defineProperty(keyboardStub, "getLayoutMap", {
      configurable: true,
      value: async () => new Map([
        ["KeyQ", "й"],
        ["KeyW", "ц"],
        ["KeyE", "у"],
        ["KeyR", "к"],
        ["KeyT", "е"],
        ["KeyY", "н"],
        ["KeyA", "ф"],
        ["KeyS", "ы"],
        ["KeyD", "в"],
        ["KeyF", "а"]
      ])
    });
    if (!navigator.keyboard) {
      Object.defineProperty(navigator, "keyboard", {
        configurable: true,
        value: keyboardStub
      });
    }
    await window.__app.refreshBrowserKeyboardLanguage();
    return {
      languageId: window.__app.sessionManager.getKeyboardLanguageId() >>> 0,
      keyA: (window.__app.sessionManager.getKeyboardLayout(1) || [])[0x1e] >>> 0
    };
  });
  expect(layoutState.languageId).toBe(4);
  expect(layoutState.keyA).toBe(228);

  await page.evaluate(() => {
    const session = window.__app.sessionManager;
    const process = session.launchPath("/sys/tinypad", { activate: true });
    if (!process) {
      throw new Error("Failed to launch TINYPAD.");
    }
    window.__tinypadPid = process.pid >>> 0;
  });
  await page.waitForFunction(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    const targetPid = window.__tinypadPid >>> 0;
    return !!(
      session &&
      targetPid &&
      session.processes.some((item) => (item.pid >>> 0) === targetPid && !item.removed && item.shellEl)
    );
  });

  const keydownState = await page.evaluate(() => {
    const session = window.__app.sessionManager;
    session.setKeyboardLanguageId(1);
    const targetPid = window.__tinypadPid >>> 0;
    const process = session.processes.find((item) => (item.pid >>> 0) === targetPid && !item.removed) || null;
    if (!process || !process.shellEl) {
      throw new Error("TINYPAD process shell is unavailable.");
    }
    process.shellEl.dispatchEvent(new KeyboardEvent("keydown", {
      key: "ф",
      code: "KeyA",
      bubbles: true,
      cancelable: true
    }));
    return {
      languageId: session.getKeyboardLanguageId() >>> 0,
      keyA: (session.getKeyboardLayout(1) || [])[0x1e] >>> 0
    };
  });
  expect(keydownState.languageId).toBe(4);
  expect(keydownState.keyA).toBe(228);

  const state = await page.evaluate(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    const taskbar = (() => {
      if (!session || !Array.isArray(session.processes)) {
        return null;
      }
      return session.processes.find((process) => {
        const pathText = String(process && (process.displayPath || process.processPath || ""));
        return pathText.toUpperCase() === "/SYS/@TASKBAR" && process.emulator && process.emulator.windowDefined && !process.removed;
      }) || null;
    })();
    return {
      languageId: session ? (session.getKeyboardLanguageId() >>> 0) : 0,
      hasTaskbar: !!taskbar
    };
  });

  expect(state.languageId).toBe(4);
  expect(state.hasTaskbar).toBe(true);
});

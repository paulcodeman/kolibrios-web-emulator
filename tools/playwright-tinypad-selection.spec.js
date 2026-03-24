const path = require("path");
const { test, expect } = require("playwright/test");

const LAUNCHER_URL = `file:///${path.resolve(__dirname, "..", "launcher.html").replace(/\\/g, "/")}`;

test.setTimeout(60000);

test("tinypad preserves drag selection across buffered mouse events", async ({ page }) => {
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
    await window.__app.browserFsRoot.mutationProvider("create-file", "/rd/1/tinypad-select.txt", {
      data: new TextEncoder().encode("hello world\nsecond line\n")
    });
    const process = session.launchPath("/sys/tinypad", {
      activate: true,
      processArgs: "/rd/1/tinypad-select.txt"
    });
    if (!process) {
      throw new Error("Failed to launch TINYPAD.");
    }
    window.__tinypadPid = process.pid >>> 0;
  });

  await page.waitForFunction(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    const targetPid = window.__tinypadPid >>> 0;
    if (!session || !targetPid || !Array.isArray(session.processes)) {
      return false;
    }
    const process = session.processes.find((item) => (item.pid >>> 0) === targetPid && !item.removed) || null;
    return !!(process && process.displayReady && process.emulator && process.emulator.windowDefined && process.surface && process.surface.buffer32);
  }, null, { timeout: 10000 });

  await page.waitForTimeout(1200);

  const before = await page.evaluate(() => {
    const session = window.__app.sessionManager;
    const targetPid = window.__tinypadPid >>> 0;
    const process = session.processes.find((item) => (item.pid >>> 0) === targetPid && !item.removed) || null;
    if (!process || !process.surface || !(process.surface.buffer32 instanceof Uint32Array)) {
      return null;
    }
    const width = process.surface.width | 0;
    let selectedPixels = 0;
    for (let y = 64; y < 78; y += 1) {
      for (let x = 8; x < 110; x += 1) {
        if ((process.surface.buffer32[(y * width) + x] >>> 0) === 0xff6a240a) {
          selectedPixels += 1;
        }
      }
    }
    return {
      selectedPixels
    };
  });

  expect(before).not.toBeNull();
  expect(before.selectedPixels).toBe(0);

  await page.evaluate(() => {
    const session = window.__app.sessionManager;
    const targetPid = window.__tinypadPid >>> 0;
    const process = session.processes.find((item) => (item.pid >>> 0) === targetPid && !item.removed) || null;
    if (!process) {
      throw new Error("TINYPAD process is unavailable.");
    }
    const client = process.getClientBounds();
    const startX = ((process.actualX | 0) + (client.x | 0) + 12) | 0;
    const startY = ((process.actualY | 0) + 70) | 0;
    const endX = ((process.actualX | 0) + (client.x | 0) + 92) | 0;

    session.setActiveProcess(process);
    process.focusShell();
    session.forwardGlobalMouseEvent(startX, startY, 1, 1, 0, false, 0, 0, {
      primaryProcess: process,
      primaryInside: true
    });
    session.forwardGlobalMouseEvent(endX, startY, 1, 0, 0, true, 0, 0, {
      primaryProcess: process,
      primaryInside: true
    });
    session.forwardGlobalMouseEvent(endX, startY, 0, 0, 1, false, 0, 0, {
      primaryProcess: process,
      primaryInside: true
    });
  });

  await page.waitForFunction(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    const targetPid = window.__tinypadPid >>> 0;
    if (!session || !targetPid || !Array.isArray(session.processes)) {
      return false;
    }
    const process = session.processes.find((item) => (item.pid >>> 0) === targetPid && !item.removed) || null;
    if (!process || !process.surface || !(process.surface.buffer32 instanceof Uint32Array)) {
      return false;
    }
    const width = process.surface.width | 0;
    let selectedPixels = 0;
    for (let y = 64; y < 78; y += 1) {
      for (let x = 8; x < 110; x += 1) {
        if ((process.surface.buffer32[(y * width) + x] >>> 0) === 0xff6a240a) {
          selectedPixels += 1;
        }
      }
    }
    return selectedPixels > 300;
  }, null, { timeout: 5000 });

  const after = await page.evaluate(() => {
    const session = window.__app.sessionManager;
    const targetPid = window.__tinypadPid >>> 0;
    const process = session.processes.find((item) => (item.pid >>> 0) === targetPid && !item.removed) || null;
    if (!process || !process.surface || !(process.surface.buffer32 instanceof Uint32Array)) {
      return null;
    }
    const width = process.surface.width | 0;
    let selectedPixels = 0;
    for (let y = 64; y < 78; y += 1) {
      for (let x = 8; x < 110; x += 1) {
        if ((process.surface.buffer32[(y * width) + x] >>> 0) === 0xff6a240a) {
          selectedPixels += 1;
        }
      }
    }
    return {
      selectedPixels
    };
  });

  expect(after).not.toBeNull();
  expect(after.selectedPixels).toBeGreaterThan(300);
});

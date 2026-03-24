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

test("tinypad context menu action redraws the parent editor", async ({ page }) => {
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
    await window.__app.browserFsRoot.mutationProvider("create-file", "/rd/1/tinypad-context-action.txt", {
      data: new TextEncoder().encode("hello world\nsecond line\n")
    });
    const process = session.launchPath("/sys/tinypad", {
      activate: true,
      processArgs: "/rd/1/tinypad-context-action.txt"
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
    return !!(process && process.displayReady && process.emulator && process.emulator.windowDefined && process.surface && process.surface.buffer32);
  }, null, { timeout: 10000 });

  await page.waitForTimeout(1200);

  const state = await page.evaluate(() => {
    const session = window.__app.sessionManager;
    const targetPid = window.__tinypadPid >>> 0;
    const groupId = window.__tinypadGroup >>> 0;
    const process = session.processes.find((item) => (item.pid >>> 0) === targetPid && !item.removed) || null;
    if (!process || !process.surface || !(process.surface.buffer32 instanceof Uint32Array)) {
      return null;
    }
    const client = process.getClientBounds();
    const width = process.surface.width | 0;
    let selectedPixels = 0;
    for (let y = 46; y < 82; y += 1) {
      for (let x = 8; x < 120; x += 1) {
        if ((process.surface.buffer32[(y * width) + x] >>> 0) === 0xff6a240a) {
          selectedPixels += 1;
        }
      }
    }
    return {
      selectedPixels,
      mainClickX: ((process.actualX | 0) + (client.x | 0) + 40) | 0,
      mainClickY: ((process.actualY | 0) + 70) | 0,
      groupId
    };
  });

  expect(state).not.toBeNull();
  expect(state.selectedPixels).toBe(0);

  await page.mouse.click(state.mainClickX, state.mainClickY, { button: "right", delay: 80 });

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

  const popupPoint = await page.evaluate(() => {
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
    if (!popup) {
      return null;
    }
    return {
      x: ((popup.actualX | 0) + 56) | 0,
      y: ((popup.actualY | 0) + 78) | 0
    };
  });

  expect(popupPoint).not.toBeNull();

  await page.mouse.move(popupPoint.x, popupPoint.y);
  await page.waitForTimeout(200);
  await page.mouse.click(popupPoint.x, popupPoint.y, { button: "left", delay: 80 });

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
    for (let y = 46; y < 82; y += 1) {
      for (let x = 8; x < 120; x += 1) {
        if ((process.surface.buffer32[(y * width) + x] >>> 0) === 0xff6a240a) {
          selectedPixels += 1;
        }
      }
    }
    return selectedPixels > 3000;
  }, null, { timeout: 5000 });
});

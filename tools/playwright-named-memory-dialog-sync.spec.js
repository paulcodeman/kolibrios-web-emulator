const path = require("path");
const { test, expect } = require("playwright/test");

const LAUNCHER_URL = `file:///${path.resolve(__dirname, "..", "launcher.html").replace(/\\/g, "/")}`;

test("browser session propagates named memory dialog results back to the owner mapping", async ({ page }) => {
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

  const launchResults = await page.evaluate(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    if (!session || typeof session.startApplication !== "function") {
      return null;
    }
    return {
      owner: session.startApplication({ path: "/CPU" }),
      writer: session.startApplication({ path: "/sys/SHELL" })
    };
  });

  expect(launchResults).not.toBeNull();
  expect(launchResults.owner.errorCode).toBe(0);
  expect(launchResults.writer.errorCode).toBe(0);

  await page.waitForFunction(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    if (!session || !Array.isArray(session.processes)) {
      return false;
    }
    let hasOwner = false;
    let hasWriter = false;
    for (let i = 0; i < session.processes.length; i += 1) {
      const process = session.processes[i];
      const pathText = String(process && (process.displayPath || process.processPath || "")).toUpperCase();
      if (pathText === "/CPU" && process.emulator) {
        hasOwner = true;
      } else if (pathText === "/SYS/SHELL" && process.emulator) {
        hasWriter = true;
      }
    }
    return hasOwner && hasWriter;
  }, null, { timeout: 10000 });

  const result = await page.evaluate(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    if (!session || !Array.isArray(session.processes)) {
      return null;
    }
    const owner = session.processes.find((item) => (
      item &&
      !item.removed &&
      String(item.displayPath || item.processPath || "").toUpperCase() === "/CPU" &&
      item.emulator
    )) || null;
    const writer = session.processes.find((item) => (
      item &&
      !item.removed &&
      String(item.displayPath || item.processPath || "").toUpperCase() === "/SYS/SHELL" &&
      item.emulator
    )) || null;
    if (!owner || !writer) {
      return null;
    }

    const ownerEmulator = owner.emulator;
    const writerEmulator = writer.emulator;
    const area = ownerEmulator.createNamedMemoryArea("TEST_COLOR_DIALOG", 4096, 1, {
      ownerAccess: 1
    });
    if (!area) {
      return null;
    }

    const ownerMapping = ownerEmulator.mapNamedMemoryAreaForCurrentProcess(area, 1);
    const writerMapping = writerEmulator.mapNamedMemoryAreaForCurrentProcess(area, 1);
    if (!ownerMapping || !writerMapping) {
      return null;
    }

    ownerEmulator.writeMem8(ownerMapping.ptr >>> 0, 0);
    ownerEmulator.writeMem8((ownerMapping.ptr + 1) >>> 0, 0);
    ownerEmulator.writeMem32((ownerMapping.ptr + 20) >>> 0, 0);

    writerEmulator.writeMem8(writerMapping.ptr >>> 0, 1);
    writerEmulator.writeMem8((writerMapping.ptr + 1) >>> 0, 0);
    writerEmulator.writeMem32((writerMapping.ptr + 20) >>> 0, 0x00112233);
    writerEmulator.sysTerminate();

    return {
      writerRemoved: !!writer.removed,
      status:
        (ownerEmulator.readMem8(ownerMapping.ptr >>> 0) & 0xff) |
        ((ownerEmulator.readMem8((ownerMapping.ptr + 1) >>> 0) & 0xff) << 8),
      color: ownerEmulator.readMem32((ownerMapping.ptr + 20) >>> 0) >>> 0
    };
  });

  expect(result).not.toBeNull();
  expect(result.writerRemoved).toBe(true);
  expect(result.status).toBe(1);
  expect(result.color).toBe(0x00112233);
});

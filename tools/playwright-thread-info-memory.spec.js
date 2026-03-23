const path = require("path");
const { test, expect } = require("playwright/test");

const LAUNCHER_URL = `file:///${path.resolve(__dirname, "..", "launcher.html").replace(/\\/g, "/")}`;

test("browser session thread info reports committed process memory", async ({ page }) => {
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
      cpu: session.startApplication({ path: "/CPU" }),
      shell: session.startApplication({ path: "/sys/SHELL" })
    };
  });

  expect(launchResults).not.toBeNull();
  expect(launchResults.cpu.errorCode).toBe(0);
  expect(launchResults.shell.errorCode).toBe(0);

  await page.waitForFunction(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    if (!session || !Array.isArray(session.processes)) {
      return false;
    }
    let hasCpu = false;
    let hasShell = false;
    for (let i = 0; i < session.processes.length; i += 1) {
      const process = session.processes[i];
      const pathText = String(process && (process.displayPath || process.processPath || "")).toUpperCase();
      if (pathText === "/CPU" && process.emulator) {
        hasCpu = true;
      } else if (pathText === "/SYS/SHELL" && process.emulator) {
        hasShell = true;
      }
    }
    return hasCpu && hasShell;
  }, null, { timeout: 10000 });

  const info = await page.evaluate(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    if (!session) {
      return null;
    }
    const collect = (targetPath) => {
      const process = session.processes.find((item) => (
        item &&
        !item.removed &&
        String(item.displayPath || item.processPath || "").toUpperCase() === targetPath &&
        item.emulator
      )) || null;
      if (!process) {
        return null;
      }
      const thread = session.getThreadInfo(process.slot >>> 0);
      return {
        path: targetPath,
        usedMemory: thread ? (thread.usedMemory >>> 0) : 0,
        committed: typeof process.emulator.getCommittedProcessMemoryBytes === "function"
          ? (process.emulator.getCommittedProcessMemoryBytes() >>> 0)
          : 0,
        memLimit: process.emulator.memLimit >>> 0
      };
    };
    return {
      cpu: collect("/CPU"),
      shell: collect("/SYS/SHELL")
    };
  });

  expect(info).not.toBeNull();
  expect(info.cpu).not.toBeNull();
  expect(info.shell).not.toBeNull();
  expect(info.cpu.usedMemory).toBe(info.cpu.committed);
  expect(info.shell.usedMemory).toBe(info.shell.committed);
  expect(info.cpu.usedMemory).toBeLessThan(info.cpu.memLimit);
  expect(info.shell.usedMemory).toBeLessThan(info.shell.memLimit);
});

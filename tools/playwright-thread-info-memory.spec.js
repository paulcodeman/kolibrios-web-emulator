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
      shell: session.startApplication({ path: "/sys/SHELL" }),
      gapShell: session.startApplication({ path: "/sys/SHELL" })
    };
  });

  expect(launchResults).not.toBeNull();
  expect(launchResults.cpu.errorCode).toBe(0);
  expect(launchResults.shell.errorCode).toBe(0);
  expect(launchResults.gapShell.errorCode).toBe(0);

  await page.waitForFunction(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    if (!session || !Array.isArray(session.processes)) {
      return false;
    }
    let hasCpu = false;
    let shellCount = 0;
    for (let i = 0; i < session.processes.length; i += 1) {
      const process = session.processes[i];
      const pathText = String(process && (process.displayPath || process.processPath || "")).toUpperCase();
      if (pathText === "/CPU" && process.emulator) {
        hasCpu = true;
      } else if (pathText === "/SYS/SHELL" && process.emulator) {
        shellCount += 1;
      }
    }
    return hasCpu && shellCount >= 2;
  }, null, { timeout: 10000 });

  const info = await page.evaluate(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    if (!session) {
      return null;
    }
    const REG = { EAX: 0, ECX: 1, EBX: 3 };
    const readWord = (emulator, ptr) => (
      (emulator.readMem8(ptr >>> 0) & 0xff) |
      ((emulator.readMem8((ptr + 1) >>> 0) & 0xff) << 8)
    ) >>> 0;
    const callThreadInfo = (emulator, slot) => {
      emulator.heapInit();
      const ptr = emulator.heapAllocInternal(1024);
      emulator.writeReg(REG.EBX, ptr >>> 0);
      emulator.writeReg(REG.ECX, slot >>> 0);
      emulator.sysThreadInfo();
      return {
        maxSlot: emulator.readReg(REG.EAX) >>> 0,
        slotState: readWord(emulator, (ptr + 0x32) >>> 0)
      };
    };
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
      shell: collect("/SYS/SHELL"),
      gapInfo: (() => {
        const cpuProcess = session.processes.find((item) => (
          item &&
          !item.removed &&
          String(item.displayPath || item.processPath || "").toUpperCase() === "/CPU" &&
          item.emulator
        )) || null;
        const shells = session.processes
          .filter((item) => (
            item &&
            !item.removed &&
            String(item.displayPath || item.processPath || "").toUpperCase() === "/SYS/SHELL" &&
            item.emulator
          ))
          .slice()
          .sort((a, b) => (a.slot >>> 0) - (b.slot >>> 0));
        if (!cpuProcess || shells.length < 2) {
          return null;
        }
        const firstShell = shells[0];
        const lastShell = shells[shells.length - 1];
        firstShell.emulator.sysTerminate();
        const call = callThreadInfo(cpuProcess.emulator, firstShell.slot >>> 0);
        return {
          firstShellRemoved: !!firstShell.removed,
          firstShellSlot: firstShell.slot >>> 0,
          lastShellSlot: lastShell.slot >>> 0,
          maxSlot: call.maxSlot >>> 0,
          slotState: call.slotState >>> 0
        };
      })()
    };
  });

  expect(info).not.toBeNull();
  expect(info.cpu).not.toBeNull();
  expect(info.shell).not.toBeNull();
  expect(info.gapInfo).not.toBeNull();
  expect(info.cpu.usedMemory).toBe(info.cpu.committed);
  expect(info.shell.usedMemory).toBe(info.shell.committed);
  expect(info.cpu.usedMemory).toBeLessThan(info.cpu.memLimit);
  expect(info.shell.usedMemory).toBeLessThan(info.shell.memLimit);
  expect(info.gapInfo.firstShellRemoved).toBe(true);
  expect(info.gapInfo.slotState).toBe(9);
  expect(info.gapInfo.maxSlot).toBe(info.gapInfo.lastShellSlot);
});

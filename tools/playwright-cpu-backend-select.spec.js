const path = require("path");
const { test, expect } = require("playwright/test");

const LAUNCHER_URL = `file:///${path.resolve(__dirname, "..", "launcher.html").replace(/\\/g, "/")}`;

test.setTimeout(60000);

async function waitForLauncherReady(page) {
  await page.waitForFunction(() => !!window.__app && !!window.__app.sessionManager);
  await page.waitForFunction(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    return !!(
      session &&
      Array.isArray(session.processes) &&
      session.processes.some((process) => (
        String(process && (process.displayPath || process.processPath || "")).toUpperCase() === "/SYS/@TASKBAR" &&
        process &&
        process.emulator &&
        process.emulator.windowDefined &&
        !process.removed
      ))
    );
  }, null, { timeout: 20000 });
}

test("launcher CPU backend selector updates session mode and launches apps in wasm mode", async ({ page }) => {
  await page.goto(LAUNCHER_URL);
  await waitForLauncherReady(page);

  const initial = await page.evaluate(() => ({
    appMode: window.__app.currentCpuBackendConfig(),
    sessionMode: window.__app.sessionManager.getCpuBackendMode(),
    wasmLabel: window.__app.cpuBackendSelect
      ? window.__app.cpuBackendSelect.querySelector('option[value="wasm"]').textContent
      : ""
  }));

  expect(initial.appMode).toBe("wasm");
  expect(initial.sessionMode).toBe("wasm");
  expect(initial.wasmLabel).toContain("WASM CPU");
  expect(initial.wasmLabel).not.toContain("not built");

  const changed = await page.evaluate(() => {
    const select = window.__app.cpuBackendSelect;
    select.value = "wasm";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return {
      appMode: window.__app.currentCpuBackendConfig(),
      sessionMode: window.__app.sessionManager.getCpuBackendMode()
    };
  });

  expect(changed.appMode).toBe("wasm");
  expect(changed.sessionMode).toBe("wasm");

  await page.evaluate(() => {
    window.__app.sessionManager.launchPath("/sys/tinypad", { activate: true });
  });

  await page.waitForFunction(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    return !!(
      session &&
      Array.isArray(session.processes) &&
      session.processes.some((process) => (
        String(process && (process.displayPath || process.processPath || "")).toUpperCase() === "/SYS/TINYPAD" &&
        process &&
        process.emulator &&
        process.emulator.windowDefined &&
        !process.removed
      ))
    );
  }, null, { timeout: 20000 });

  const launched = await page.evaluate(() => {
    const session = window.__app.sessionManager;
    const process = session.processes.find((entry) => (
      String(entry && (entry.displayPath || entry.processPath || "")).toUpperCase() === "/SYS/TINYPAD" &&
      entry &&
      entry.emulator &&
      entry.emulator.windowDefined &&
      !entry.removed
    ));
    return process && process.emulator && typeof process.emulator.getCpuBackendInfo === "function"
      ? process.emulator.getCpuBackendInfo()
      : null;
  });

  expect(launched).not.toBeNull();
  expect(launched.active).toBe("wasm");
  expect(launched.requested).toBe("wasm");
  expect(launched.wasmAvailable).toBe(true);
  expect(launched.maxSliceMs).toBe(16);
  expect(launched.backgroundMaxSliceMs).toBe(20);
  expect(launched.preDisplayMaxSliceMs).toBe(8);
  expect(launched.basicBlockMaxEntries).toBe(48);
  expect(launched.basicBlockImmediateCacheEntries).toBe(2);
  expect(launched.basicBlockHotThreshold).toBe(2);
});

test("launcher persists selected CPU backend across reloads", async ({ page }) => {
  await page.goto(LAUNCHER_URL);
  await waitForLauncherReady(page);

  await page.evaluate(() => {
    localStorage.removeItem("kosemu.cpuBackendMode");
  });
  await page.reload();
  await waitForLauncherReady(page);

  const initial = await page.evaluate(() => ({
    selectValue: window.__app.cpuBackendSelect ? window.__app.cpuBackendSelect.value : "",
    appMode: window.__app.currentCpuBackendConfig(),
    sessionMode: window.__app.sessionManager.getCpuBackendMode()
  }));
  expect(initial.selectValue).toBe("wasm");
  expect(initial.appMode).toBe("wasm");
  expect(initial.sessionMode).toBe("wasm");

  await page.evaluate(() => {
    const select = window.__app.cpuBackendSelect;
    select.value = "js";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });

  const changed = await page.evaluate(() => ({
    stored: localStorage.getItem("kosemu.cpuBackendMode"),
    selectValue: window.__app.cpuBackendSelect ? window.__app.cpuBackendSelect.value : "",
    appMode: window.__app.currentCpuBackendConfig(),
    sessionMode: window.__app.sessionManager.getCpuBackendMode()
  }));
  expect(changed.stored).toBe("js");
  expect(changed.selectValue).toBe("js");
  expect(changed.appMode).toBe("js");
  expect(changed.sessionMode).toBe("js");

  await page.reload();
  await waitForLauncherReady(page);

  const reloaded = await page.evaluate(() => ({
    stored: localStorage.getItem("kosemu.cpuBackendMode"),
    selectValue: window.__app.cpuBackendSelect ? window.__app.cpuBackendSelect.value : "",
    appMode: window.__app.currentCpuBackendConfig(),
    sessionMode: window.__app.sessionManager.getCpuBackendMode()
  }));
  expect(reloaded.stored).toBe("js");
  expect(reloaded.selectValue).toBe("js");
  expect(reloaded.appMode).toBe("js");
  expect(reloaded.sessionMode).toBe("js");
});

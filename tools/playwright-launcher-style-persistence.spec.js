const path = require("path");
const { test, expect } = require("playwright/test");

const LAUNCHER_URL = `file:///${path.resolve(__dirname, "..", "launcher.html").replace(/\\/g, "/")}`;

async function waitForLauncherReady(page) {
  await page.waitForFunction(() => !!window.__app && !!window.__app.sessionManager);
  await page.waitForFunction(() => {
    const app = window.__app;
    const session = app && app.sessionManager ? app.sessionManager : null;
    return !!(
      app &&
      app.browserFsRoot &&
      session &&
      Array.isArray(session.processes) &&
      session.processes.some((process) => String(process && (process.displayPath || "")).toUpperCase() === "/SYS/@TASKBAR")
    );
  }, null, { timeout: 20000 });
}

async function waitForLauncherBoot(page) {
  await page.goto(LAUNCHER_URL);
  await waitForLauncherReady(page);
}

test("bundled launcher persists system style settings", async ({ page }) => {
  await waitForLauncherBoot(page);

  const updated = await page.evaluate(async () => {
    const app = window.__app;
    const session = app && app.sessionManager ? app.sessionManager : null;
    const root = app && app.browserFsRoot ? app.browserFsRoot : null;
    if (!session || !root) {
      throw new Error("Missing launcher session.");
    }
    const nextValue = (session.systemButtonStyle | 0) === 0 ? 1 : 0;
    const data = new TextEncoder().encode(
      `[style]\r\nbuttons_gradient=${nextValue}\r\nskin=/sys/default.skn\r\n`
    );
    const result = root.mutationProvider("create-file", "/sys/settings/system.ini", { data });
    if (!result || (result.errorCode >>> 0) !== 0) {
      throw new Error(`system.ini write failed: ${result ? result.errorCode : "no result"}`);
    }
    await root.flushPending();
    session.refreshSkinThemes();
    return {
      nextValue,
      systemButtonStyle: session.systemButtonStyle | 0,
      processButtonStyles: session.processes.map((process) => (
        process && process.emulator ? (process.emulator.buttonStyle | 0) : -1
      ))
    };
  });

  expect(updated.systemButtonStyle).toBe(updated.nextValue);
  expect(updated.processButtonStyles.length).toBeGreaterThan(0);
  expect(updated.processButtonStyles.every((value) => value === updated.nextValue)).toBe(true);

  await page.reload();
  await waitForLauncherReady(page);

  const persisted = await page.evaluate(() => {
    const app = window.__app;
    const session = app && app.sessionManager ? app.sessionManager : null;
    return {
      systemButtonStyle: session ? (session.systemButtonStyle | 0) : -1,
      processButtonStyles: session && Array.isArray(session.processes)
        ? session.processes.map((process) => (
          process && process.emulator ? (process.emulator.buttonStyle | 0) : -1
        ))
        : []
    };
  });

  expect(persisted.systemButtonStyle).toBe(updated.nextValue);
  expect(persisted.processButtonStyles.length).toBeGreaterThan(0);
  expect(persisted.processButtonStyles.every((value) => value === updated.nextValue)).toBe(true);
});

test("bundled launcher restore defaults clears persisted overlay", async ({ page }) => {
  await waitForLauncherBoot(page);

  const baseline = await page.evaluate(() => {
    const app = window.__app;
    const session = app && app.sessionManager ? app.sessionManager : null;
    return {
      systemButtonStyle: session ? (session.systemButtonStyle | 0) : -1
    };
  });

  const changed = await page.evaluate(async () => {
    const app = window.__app;
    const session = app && app.sessionManager ? app.sessionManager : null;
    const root = app && app.browserFsRoot ? app.browserFsRoot : null;
    if (!session || !root) {
      throw new Error("Missing launcher session.");
    }
    const nextValue = (session.systemButtonStyle | 0) === 0 ? 1 : 0;
    const data = new TextEncoder().encode(
      `[style]\r\nbuttons_gradient=${nextValue}\r\nskin=/sys/default.skn\r\n`
    );
    const result = root.mutationProvider("create-file", "/sys/settings/system.ini", { data });
    if (!result || (result.errorCode >>> 0) !== 0) {
      throw new Error(`system.ini write failed: ${result ? result.errorCode : "no result"}`);
    }
    await root.flushPending();
    session.refreshSkinThemes();
    return {
      nextValue,
      systemButtonStyle: session.systemButtonStyle | 0
    };
  });

  expect(changed.systemButtonStyle).toBe(changed.nextValue);
  expect(changed.systemButtonStyle).not.toBe(baseline.systemButtonStyle);

  await page.evaluate(() => {
    document.body.classList.add("launcher-overlays-visible");
  });
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#restoreDefaultsBtn").click();
  await page.waitForLoadState("domcontentloaded");
  await waitForLauncherReady(page);

  const restored = await page.evaluate(() => {
    const app = window.__app;
    const session = app && app.sessionManager ? app.sessionManager : null;
    const root = app && app.browserFsRoot ? app.browserFsRoot : null;
    return {
      systemButtonStyle: session ? (session.systemButtonStyle | 0) : -1,
      rootSummary: root ? String(root.summaryText()) : ""
    };
  });

  expect(restored.systemButtonStyle).toBe(baseline.systemButtonStyle);
  expect(restored.rootSummary).toContain("bundled");
});

const path = require("path");
const { test, expect } = require("playwright/test");

const LAUNCHER_URL = `file:///${path.resolve(__dirname, "..", "launcher.html").replace(/\\/g, "/")}`;

test("bundled launcher page boots desktop", async ({ page }, testInfo) => {
  await page.goto(LAUNCHER_URL);
  await page.waitForFunction(() => !!window.__app && !!window.__app.sessionManager);
  await page.waitForFunction(() => {
    const app = window.__app;
    const session = app && app.sessionManager ? app.sessionManager : null;
    return !!(
      app &&
      app.browserFsRoot &&
      session &&
      Array.isArray(session.processes) &&
      session.processes.some((process) => {
        const pathText = String(process && (process.displayPath || process.processPath || ""));
        return pathText.toUpperCase() === "/SYS/@TASKBAR";
      })
    );
  }, null, { timeout: 20000 });

  const state = await page.evaluate(() => {
    const app = window.__app;
    const session = app && app.sessionManager ? app.sessionManager : null;
    const workspace = document.getElementById("workspace");
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      rootSummary: app && app.browserFsRoot ? String(app.browserFsRoot.summaryText()) : "",
      processCount: session && Array.isArray(session.processes) ? session.processes.length : 0,
      hasTaskbar: !!(
        session &&
        Array.isArray(session.processes) &&
        session.processes.some((process) => {
          const pathText = String(process && (process.displayPath || process.processPath || ""));
          return pathText.toUpperCase() === "/SYS/@TASKBAR";
        })
      ),
      workspaceWidth: workspace ? workspace.clientWidth : 0,
      workspaceHeight: workspace ? workspace.clientHeight : 0
    };
  });

  expect(state.backgroundColor).toBe("rgb(0, 0, 0)");
  expect(state.rootSummary).toContain("bundled");
  expect(state.hasTaskbar).toBe(true);
  expect(state.processCount).toBeGreaterThan(0);
  expect(state.workspaceWidth).toBeGreaterThanOrEqual(state.innerWidth - 2);
  expect(state.workspaceHeight).toBeGreaterThanOrEqual(state.innerHeight - 2);

  await page.evaluate(() => {
    const app = window.__app;
    app.launcherOverlayHoldMs = 120;
    app.launcherOverlayVisibleMs = 650;
    app.launcherOverlayEdgeRevealPx = 24;
  });
  await page.waitForTimeout(120);
  await page.waitForFunction(() => {
    const toolbar = document.querySelector(".launcher-toolbar");
    return !!toolbar && Number(getComputedStyle(toolbar).opacity) < 0.1;
  });

  await page.mouse.move(160, 2);
  await page.waitForFunction(() => {
    const toolbar = document.querySelector(".launcher-toolbar");
    return !!toolbar && Number(getComputedStyle(toolbar).opacity) > 0.9;
  });
  await page.waitForFunction(() => {
    const toolbar = document.querySelector(".launcher-toolbar");
    return !!toolbar && Number(getComputedStyle(toolbar).opacity) < 0.1;
  }, null, { timeout: 2500 });

  await page.evaluate(() => {
    const app = window.__app;
    app.launcherOverlayHoldMs = 120;
    app.launcherOverlayVisibleMs = 3000;
  });
  await page.evaluate(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    if (!session) {
      throw new Error("Missing session manager.");
    }
    const original = session.handleViewportResize.bind(session);
    session.__fullscreenResizeCount = 0;
    session.handleViewportResize = function patchedHandleViewportResize(...args) {
      session.__fullscreenResizeCount = ((session.__fullscreenResizeCount | 0) + 1) | 0;
      return original(...args);
    };
  });

  await page.mouse.move(360, 260);
  await page.mouse.down();
  await page.waitForTimeout(180);
  await page.mouse.up();
  await page.waitForFunction(() => {
    const toolbar = document.querySelector(".launcher-toolbar");
    return !!toolbar && Number(getComputedStyle(toolbar).opacity) > 0.9;
  });

  const button = page.locator("#fullscreenBtn");
  await button.click();
  await page.waitForFunction(() => {
    const workspace = document.getElementById("workspace");
    return !!workspace && document.fullscreenElement === workspace;
  });
  await page.waitForFunction(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    return !!session && (session.__fullscreenResizeCount | 0) >= 1;
  });

  await page.evaluate(async () => {
    if (document.fullscreenElement && typeof document.exitFullscreen === "function") {
      await document.exitFullscreen();
    }
  });
  await page.waitForFunction(() => document.fullscreenElement === null);
  await page.waitForFunction(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    return !!session && (session.__fullscreenResizeCount | 0) >= 2;
  });

  await page.screenshot({
    path: testInfo.outputPath("launcher-page.png"),
    fullPage: true
  });
});

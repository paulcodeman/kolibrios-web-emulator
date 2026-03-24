const path = require("path");
const { test, expect } = require("playwright/test");

const LAUNCHER_URL = `file:///${path.resolve(__dirname, "..", "launcher.html").replace(/\\/g, "/")}`;

function expectRightClickSequence(calls) {
  expect(calls).toEqual([
    { pressMask: 2, releaseMask: 0, buttons: 2 },
    { pressMask: 0, releaseMask: 2, buttons: 0 }
  ]);
}

test("desktop touch tap launches icon and sends move before left click", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "CDP touch dispatch is Chromium-only.");

  await page.goto(LAUNCHER_URL);
  await page.waitForFunction(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    return !!(
      session &&
      Array.isArray(session.processes) &&
      session.processes.some((process) => String(process && (process.displayPath || process.processPath || "")).toUpperCase() === "/SYS/@TASKBAR")
    );
  }, null, { timeout: 20000 });

  await page.evaluate(() => {
    const session = window.__app.sessionManager;
    const original = session.forwardGlobalMouseEvent.bind(session);
    window.__desktopTouchTapDebug = {
      beforeCount: session.processes.length,
      events: []
    };
    session.forwardGlobalMouseEvent = function patchedForwardGlobalMouseEvent(screenX, screenY, buttons, pressMask, releaseMask, moved, wheelX, wheelY, options) {
      if ((pressMask | 0) !== 0 || (releaseMask | 0) !== 0 || moved) {
        window.__desktopTouchTapDebug.events.push({
          screenX: screenX | 0,
          screenY: screenY | 0,
          buttons: buttons | 0,
          pressMask: pressMask | 0,
          releaseMask: releaseMask | 0,
          moved: !!moved
        });
      }
      return original(screenX, screenY, buttons, pressMask, releaseMask, moved, wheelX, wheelY, options);
    };
  });

  const workspaceRect = await page.locator("#workspace").boundingBox();
  expect(workspaceRect).not.toBeNull();
  const x = Math.floor(workspaceRect.x + 24);
  const y = Math.floor(workspaceRect.y + 24);
  const client = await context.newCDPSession(page);

  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, radiusX: 8, radiusY: 8, force: 1, id: 1 }],
    modifiers: 0
  });
  await page.waitForTimeout(80);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
    modifiers: 0
  });
  await page.waitForTimeout(500);

  const state = await page.evaluate(() => {
    const debug = window.__desktopTouchTapDebug;
    return {
      beforeCount: debug.beforeCount | 0,
      afterCount: window.__app.sessionManager.processes.length,
      events: debug.events.slice()
    };
  });

  expect(state.afterCount).toBeGreaterThan(state.beforeCount);
  expect(state.events).toEqual([
    { screenX: 24, screenY: 24, buttons: 0, pressMask: 0, releaseMask: 0, moved: true },
    { screenX: 24, screenY: 24, buttons: 1, pressMask: 1, releaseMask: 0, moved: false },
    { screenX: 24, screenY: 24, buttons: 0, pressMask: 0, releaseMask: 1, moved: false }
  ]);
});

test("desktop touch long press opens right click before release", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "CDP touch dispatch is Chromium-only.");

  await page.goto(LAUNCHER_URL);
  await page.waitForFunction(() => !!window.__app && !!window.__app.sessionManager && !!window.__app.sessionManager.desktopCanvasEl);

  await page.evaluate(() => {
    const session = window.__app.sessionManager;
    const original = session.forwardGlobalMouseEvent.bind(session);
    const state = {
      beforeCount: session.getVisibleWindowStack().length,
      calls: []
    };
    session.forwardGlobalMouseEvent = function patchedForwardGlobalMouseEvent(screenX, screenY, buttons, pressMask, releaseMask, moved, wheelX, wheelY, options) {
      if ((pressMask | 0) !== 0 || (releaseMask | 0) !== 0) {
        state.calls.push({
          buttons: buttons | 0,
          pressMask: pressMask | 0,
          releaseMask: releaseMask | 0
        });
      }
      return original(screenX, screenY, buttons, pressMask, releaseMask, moved, wheelX, wheelY, options);
    };
    window.__desktopTouchLongPressDebug = state;
  });

  const rect = await page.locator(".workspace-desktop-canvas").boundingBox();
  expect(rect).not.toBeNull();
  const x = Math.floor(rect.x + 180);
  const y = Math.floor(rect.y + 180);
  const client = await context.newCDPSession(page);

  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, radiusX: 8, radiusY: 8, force: 1, id: 1 }],
    modifiers: 0
  });
  await page.waitForTimeout(700);

  const afterDelay = await page.evaluate(() => {
    const session = window.__app.sessionManager;
    const state = window.__desktopTouchLongPressDebug;
    return {
      beforeCount: state.beforeCount | 0,
      count: session.getVisibleWindowStack().length,
      calls: state.calls.slice()
    };
  });

  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
    modifiers: 0
  });
  await page.waitForTimeout(120);

  const afterEnd = await page.evaluate(() => {
    const state = window.__desktopTouchLongPressDebug;
    return {
      calls: state.calls.slice()
    };
  });

  expectRightClickSequence(afterDelay.calls);
  expect(afterDelay.count).toBeGreaterThan(afterDelay.beforeCount);
  expect(afterEnd.calls).toEqual(afterDelay.calls);
});

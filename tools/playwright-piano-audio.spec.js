const path = require("path");
const { test, expect } = require("playwright/test");

const LAUNCHER_URL = `file:///${path.resolve(__dirname, "..", "launcher.html").replace(/\\/g, "/")}`;

test.setTimeout(60000);

async function waitForLauncherReady(page) {
  await page.goto(LAUNCHER_URL);
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

test("piano speaker syscall reaches browser audio host", async ({ page }) => {
  await waitForLauncherReady(page);

  const launch = await page.evaluate(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    if (!session || typeof session.launchPath !== "function") {
      return null;
    }
    const process = session.launchPath("/media/piano", { activate: true });
    if (!process) {
      return null;
    }
    window.__pianoPid = process.pid >>> 0;
    return {
      pid: process.pid >>> 0
    };
  });

  expect(launch).not.toBeNull();
  expect(launch.pid).toBeGreaterThan(0);

  await page.waitForFunction(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    const targetPid = window.__pianoPid >>> 0;
    if (!session || !targetPid || !Array.isArray(session.processes)) {
      return false;
    }
    const process = session.processes.find((item) => (item.pid >>> 0) === targetPid && !item.removed) || null;
    return !!(process && process.displayReady && process.emulator && process.emulator.windowDefined);
  }, null, { timeout: 10000 });

  await page.waitForTimeout(600);

  const clickState = await page.evaluate(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    const targetPid = window.__pianoPid >>> 0;
    if (!session || !targetPid || !Array.isArray(session.processes)) {
      return null;
    }
    const process = session.processes.find((item) => (item.pid >>> 0) === targetPid && !item.removed) || null;
    if (!process || !process.emulator || !Array.isArray(process.emulator.buttons)) {
      return null;
    }
    const button = process.emulator.buttons.find((item) => ((item.id >>> 0) & 0x00ffffff) === 0x21 && !item.hidden)
      || process.emulator.buttons.find((item) => !item.hidden)
      || null;
    if (!button) {
      return null;
    }
    const pos = typeof process.emulator.applyWindowOffset === "function"
      ? process.emulator.applyWindowOffset(button.x | 0, button.y | 0)
      : { x: button.x | 0, y: button.y | 0 };
    const before = typeof session.getSpeakerPlaybackInfo === "function"
      ? session.getSpeakerPlaybackInfo()
      : null;
    return {
      x: ((process.actualX | 0) + (pos.x | 0) + Math.max(1, ((button.width | 0) >> 1))) | 0,
      y: ((process.actualY | 0) + (pos.y | 0) + Math.max(1, ((button.height | 0) >> 1))) | 0,
      playCount: before ? (before.playCount >>> 0) : 0
    };
  });

  expect(clickState).not.toBeNull();

  await page.mouse.move(clickState.x, clickState.y);
  await page.waitForTimeout(100);
  await page.mouse.click(clickState.x, clickState.y, { button: "left", delay: 80 });

  await page.waitForFunction((previousPlayCount) => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    const info = session && typeof session.getSpeakerPlaybackInfo === "function"
      ? session.getSpeakerPlaybackInfo()
      : null;
    return !!(info && (info.playCount >>> 0) > (previousPlayCount >>> 0) && info.last && (info.last.toneCount >>> 0) > 0);
  }, clickState.playCount, { timeout: 10000 });

  const info = await page.evaluate(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    return session && typeof session.getSpeakerPlaybackInfo === "function"
      ? session.getSpeakerPlaybackInfo()
      : null;
  });

  expect(info).not.toBeNull();
  expect(info.audioAvailable).toBe(true);
  expect(info.playCount).toBeGreaterThan(clickState.playCount);
  expect(info.last).not.toBeNull();
  expect(String(info.last.processPath || "").toUpperCase()).toBe("/MEDIA/PIANO");
  expect(info.last.itemCount).toBeGreaterThan(0);
  expect(info.last.toneCount).toBeGreaterThan(0);
  expect(info.last.totalDurationMs).toBeGreaterThan(0);
});

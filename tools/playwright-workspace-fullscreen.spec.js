const path = require("path");
const { test, expect } = require("playwright/test");

const INDEX_URL = `file:///${path.resolve(__dirname, "..", "index.html").replace(/\\/g, "/")}`;

test("workspace fullscreen toggle", async ({ page }) => {
  await page.addInitScript(() => {
    window.addEventListener("DOMContentLoaded", () => {
      const proto = window.KosEmu && window.KosEmu.ui && window.KosEmu.ui.App
        ? window.KosEmu.ui.App.prototype
        : null;
      if (!proto || proto.__capturePatched) {
        return;
      }
      const originalStart = proto.start;
      proto.start = function patchedStart(...args) {
        window.__app = this;
        return originalStart.apply(this, args);
      };
      proto.__capturePatched = true;
      proto.restorePersistedRootFolder = function skipPersistedRoot() {};
    }, { once: true });
  });

  await page.goto(INDEX_URL);
  await page.waitForFunction(() => !!window.__app);

  const button = page.locator("#fullscreenBtn");
  await expect(button).toHaveText("Fullscreen");
  await expect(button).toBeEnabled();

  await button.click();
  await page.waitForFunction(() => {
    const screenPanel = document.getElementById("screenPanel");
    return !!screenPanel && document.fullscreenElement === screenPanel;
  });
  await page.waitForFunction(() => {
    const buttonEl = document.getElementById("fullscreenBtn");
    return !!buttonEl && buttonEl.textContent === "Windowed";
  });

  await page.evaluate(async () => {
    if (document.fullscreenElement && typeof document.exitFullscreen === "function") {
      await document.exitFullscreen();
    }
  });
  await page.waitForFunction(() => document.fullscreenElement === null);
  await expect(button).toHaveText("Fullscreen");
});

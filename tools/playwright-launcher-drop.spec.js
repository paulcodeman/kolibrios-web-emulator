const fs = require("fs");
const path = require("path");
const { test, expect } = require("playwright/test");
const { buildHostCandidates } = require("./kos-fs");

const ROOT_DIR = process.env.KOS_ROOT || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root";
const LAUNCHER_URL = `file:///${path.resolve(__dirname, "..", "launcher.html").replace(/\\/g, "/")}`;

function normalizeKosPath(kpath) {
  if (!kpath || typeof kpath !== "string") {
    return "";
  }
  let text = kpath.replace(/\\/g, "/").trim();
  if (!text) {
    return "";
  }
  if (!text.startsWith("/")) {
    text = `/${text}`;
  }
  return text.replace(/\/+/g, "/");
}

function resolveExistingHostPath(kpath) {
  const candidates = buildHostCandidates(ROOT_DIR, ROOT_DIR, normalizeKosPath(kpath));
  for (let i = 0; i < candidates.length; i += 1) {
    if (fs.existsSync(candidates[i])) {
      return candidates[i];
    }
  }
  throw new Error(`Missing host path for '${kpath}'`);
}

function readBase64(kpath) {
  return fs.readFileSync(resolveExistingHostPath(kpath)).toString("base64");
}

test("launcher drop on toolbar launches image on desktop", async ({ page }) => {
  const demoBase64 = readBase64("DEMOS/BCDCLK");

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

  await page.evaluate(({ base64 }) => {
    function decodeBase64(text) {
      const raw = atob(text);
      const out = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) {
        out[i] = raw.charCodeAt(i) & 0xff;
      }
      return out;
    }

    const target = document.querySelector(".launcher-toolbar");
    const data = decodeBase64(base64);
    const file = new File([data], "BCDCLK", { type: "application/octet-stream" });
    const transfer = new DataTransfer();
    transfer.items.add(file);

    for (const type of ["dragenter", "dragover", "drop"]) {
      const event = new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer
      });
      target.dispatchEvent(event);
    }
  }, { base64: demoBase64 });

  await page.waitForFunction(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    if (!session || !Array.isArray(session.processes)) {
      return false;
    }
    return session.processes.some((process) => (
      process &&
      !process.removed &&
      process.emulator &&
      process.emulator.windowDefined &&
      String(process.displayPath || "").toUpperCase() === "BCDCLK"
    ));
  }, null, { timeout: 12000 });

  const state = await page.evaluate(() => {
    const app = window.__app;
    const session = app && app.sessionManager ? app.sessionManager : null;
    const process = session && Array.isArray(session.processes)
      ? session.processes.find((item) => (
        item &&
        !item.removed &&
        item.emulator &&
        item.emulator.windowDefined &&
        String(item.displayPath || "").toUpperCase() === "BCDCLK"
      )) || null
      : null;
    return {
      pid: process ? (process.pid >>> 0) : 0,
      title: process && process.emulator ? String(process.emulator.windowTitle || "") : "",
      displayPath: process ? String(process.displayPath || "") : "",
      infoText: app && app.infoEl ? String(app.infoEl.textContent || "") : ""
    };
  });

  expect(state.pid).toBeGreaterThan(0);
  expect(state.title).toBe("BCD Clock");
  expect(state.displayPath).toBe("BCDCLK");
  expect(state.infoText).toContain("BCDCLK");
});

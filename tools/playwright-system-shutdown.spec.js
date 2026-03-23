const fs = require("fs");
const path = require("path");
const { test, expect } = require("playwright/test");
const { buildHostCandidates } = require("./kos-fs");

const ROOT_DIR = process.env.KOS_ROOT || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root";
const INDEX_URL = `file:///${path.resolve(__dirname, "..", "index.html").replace(/\\/g, "/")}`;

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

test("system shutdown syscall stops processes and exits fullscreen", async ({ page }) => {
  const demoBase64 = readBase64("DEMOS/BCDCLK");

  await page.addInitScript(() => {
    window.addEventListener("DOMContentLoaded", () => {
      const proto = window.KosEmu && window.KosEmu.ui && window.KosEmu.ui.App
        ? window.KosEmu.ui.App.prototype
        : null;
      if (!proto || proto.__shutdownCapturePatched) {
        return;
      }
      const originalStart = proto.start;
      proto.start = function patchedStart(...args) {
        window.__app = this;
        return originalStart.apply(this, args);
      };
      proto.__shutdownCapturePatched = true;
      proto.restorePersistedRootFolder = function skipPersistedRoot() {};
    }, { once: true });
  });

  await page.goto(INDEX_URL);
  await page.waitForFunction(() => !!window.__app && !!window.KosEmu);

  await page.evaluate(({ base64 }) => {
    function decodeBase64(text) {
      const raw = atob(text);
      const out = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) {
        out[i] = raw.charCodeAt(i) & 0xff;
      }
      return out;
    }

    const app = window.__app;
    const runtime = window.KosEmu;
    const bytes = decodeBase64(base64);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const image = runtime.parseKex(buffer, "BCDCLK");
    app.currentImage = image;
    app.currentFileBuffer = buffer.slice(0);
    app.currentFileName = "BCDCLK";
    app.runBtn.disabled = false;
    app.handleRun();
  }, { base64: demoBase64 });

  await page.waitForFunction(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    return !!session && Array.isArray(session.processes) && session.processes.some((process) => !process.removed);
  });

  const button = page.locator("#fullscreenBtn");
  await button.click();
  await page.waitForFunction(() => {
    const workspace = document.getElementById("workspace");
    return !!workspace && document.fullscreenElement === workspace;
  });

  await page.evaluate(() => {
    const REG_EAX = 0;
    const REG_ECX = 1;
    const REG_EBX = 3;
    const session = window.__app.sessionManager;
    const process = session.getActiveProcess();
    if (!process || !process.emulator) {
      throw new Error("Missing active process for system shutdown syscall.");
    }
    process.emulator.writeReg(REG_EAX, 18);
    process.emulator.writeReg(REG_EBX, 9);
    process.emulator.writeReg(REG_ECX, 2);
    process.emulator.handleSyscall();
  });

  await page.waitForFunction(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    return (
      document.fullscreenElement === null &&
      !!session &&
      Array.isArray(session.processes) &&
      session.processes.length === 0
    );
  });

  await expect(button).toHaveText("Fullscreen");
  const state = await page.evaluate(() => {
    const app = window.__app;
    const session = app && app.sessionManager ? app.sessionManager : null;
    const empty = document.getElementById("workspaceEmpty");
    return {
      processCount: session && Array.isArray(session.processes) ? session.processes.length : -1,
      emptyVisible: !!(empty && !empty.hidden)
    };
  });

  expect(state.processCount).toBe(0);
  expect(state.emptyVisible).toBe(true);
});

const fs = require("fs");
const path = require("path");
const { test, expect } = require("playwright/test");
const { buildHostCandidates } = require("./kos-fs");

const ROOT_DIR = process.env.KOS_ROOT || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root";
const INDEX_URL = `file:///${path.resolve(__dirname, "..", "index.html").replace(/\\/g, "/")}`;
const LAUNCHER_PATH = path.join(ROOT_DIR, "LAUNCHER");
const FILES = [
  "LAUNCHER",
  "SYS/@TASKBAR",
  "SYS/@ICON",
  "SYS/@RESHARE",
  "SYS/@SS",
  "SYS/@VOLUME",
  "SYS/@DOCKY",
  "SYS/@HA",
  "SYS/NETWORK/@ZEROCONF",
  "SYS/SEARCHAP",
  "SYS/NETWORK/NETCFG",
  "SYS/ESKIN",
  "SYS/LOADDRV",
  "SYS/SETUP",
  "SYS/TMPDISK",
  "sys/default.skn",
  "SYS/ICONS16.PNG",
  "sys/icons32.png",
  "SYS/ICONS32.PNG",
  "sys/media/palitra",
  "SYS/SETTINGS/AUTORUN.DAT",
  "SYS/SETTINGS/HA.CFG",
  "SYS/settings/taskbar.ini",
  "sys/settings/icon.ini",
  "sys/settings/lang.ini",
  "sys/settings/system.ini",
  "sys/settings/network.ini",
  "sys/settings/Docky.ini",
  "sys/settings/keymap.key",
  "sys/settings/volume.dat",
  "sys/lib/archiver.obj",
  "sys/lib/box_lib.obj",
  "sys/lib/cnv_png.obj",
  "sys/lib/libimg.obj",
  "sys/lib/libini.obj",
  "sys/lib/libio.obj",
  "SYS/libini.obj",
  "sys/drivers/RDC.sys",
  "sys/drivers/SDHCI.sys",
  "sys/drivers/SOUND.sys",
  "sys/drivers/tmpdisk.sys"
];

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
  const candidates = buildHostCandidates(ROOT_DIR, path.dirname(LAUNCHER_PATH), normalizeKosPath(kpath));
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

function buildFileSet() {
  const files = Object.create(null);
  for (let i = 0; i < FILES.length; i += 1) {
    const kosPath = normalizeKosPath(FILES[i]);
    try {
      files[kosPath] = readBase64(FILES[i]);
    } catch (err) {
      if (process.env.KOS_TRACE_PLAYWRIGHT === "1") {
        console.warn(String(err));
      }
    }
  }
  return files;
}

test("launcher browser path", async ({ page }, testInfo) => {
  const fileSet = buildFileSet();
  const launcherBytes = readBase64("LAUNCHER");
  const force2d = process.env.KOS_FORCE_2D === "1";

  await page.addInitScript((opts) => {
    if (opts && opts.force2d) {
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function patchedGetContext(type, ...args) {
        if (type === "webgl2") {
          return null;
        }
        return originalGetContext.call(this, type, ...args);
      };
    }
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
  }, { force2d });

  await page.goto(INDEX_URL);
  await page.waitForFunction(() => !!window.__app && !!window.KosEmu);

  await page.evaluate(({ files, launcherBase64 }) => {
    function decodeBase64(base64) {
      const raw = atob(base64);
      const out = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) {
        out[i] = raw.charCodeAt(i) & 0xff;
      }
      return out;
    }

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

    function dirname(kpath) {
      const normalized = normalizeKosPath(kpath);
      const index = normalized.lastIndexOf("/");
      if (index <= 0) {
        return "/";
      }
      return normalized.slice(0, index);
    }

    function basename(kpath) {
      const normalized = normalizeKosPath(kpath);
      const index = normalized.lastIndexOf("/");
      return index >= 0 ? normalized.slice(index + 1) : normalized;
    }

    function buildFileIndex(base64Map) {
      const fileMap = new Map();
      const dirMap = new Map();
      const ensureDir = (dirPath) => {
        const normalized = normalizeKosPath(dirPath || "/") || "/";
        if (!dirMap.has(normalized)) {
          dirMap.set(normalized, new Map());
        }
        return dirMap.get(normalized);
      };
      ensureDir("/");
      for (const [rawPath, base64] of Object.entries(base64Map || {})) {
        const kosPath = normalizeKosPath(rawPath);
        if (!kosPath) {
          continue;
        }
        const bytes = decodeBase64(base64);
        fileMap.set(kosPath, bytes);
        let current = dirname(kosPath);
        const parts = kosPath.slice(1).split("/").filter(Boolean);
        let walk = "";
        for (let i = 0; i < parts.length - 1; i += 1) {
          walk = `${walk}/${parts[i]}`;
          ensureDir(walk);
        }
        ensureDir(current).set(basename(kosPath), {
          name: basename(kosPath),
          isDirectory: false,
          size: bytes.length >>> 0,
          mtimeMs: 0
        });
      }
      for (const dirPath of Array.from(dirMap.keys())) {
        if (dirPath === "/") {
          continue;
        }
        const parent = dirname(dirPath);
        const name = basename(dirPath);
        ensureDir(parent).set(name, {
          name,
          isDirectory: true,
          size: 0,
          mtimeMs: 0
        });
      }
      return { fileMap, dirMap };
    }

    const app = window.__app;
    const runtime = window.KosEmu;
    const indexed = buildFileIndex(files);
    app.browserFsRoot = {
      label: "playwright-root",
      permission: "granted",
      summaryText() {
        return "playwright-root";
      },
      flushPending() {},
      fileProvider(kpath) {
        const key = normalizeKosPath(kpath);
        const bytes = indexed.fileMap.get(key);
        return bytes ? bytes.slice() : null;
      },
      fileInfoProvider(kpath, kind) {
        const key = normalizeKosPath(kpath) || "/";
        const bytes = indexed.fileMap.get(key);
        const dir = indexed.dirMap.get(key);
        if (!bytes && !dir) {
          return null;
        }
        const info = {
          path: key,
          hostPath: key,
          exists: true,
          isDirectory: !!dir,
          size: bytes ? (bytes.length >>> 0) : 0,
          mtimeMs: 0
        };
        if ((kind || "stat") === "list") {
          info.entries = dir ? Array.from(dir.values()) : [];
        }
        return info;
      },
      mutationProvider() {
        return { errorCode: 2, written: 0 };
      }
    };
    app.updateFsRootStatus();

    const bytes = decodeBase64(launcherBase64);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const image = runtime.parseKex(buffer, "LAUNCHER");
    app.currentImage = image;
    app.currentFileBuffer = buffer.slice(0);
    app.currentFileName = "LAUNCHER";
    app.runBtn.disabled = false;
    app.handleRun();
  }, {
    files: fileSet,
    launcherBase64: launcherBytes
  });

  await page.waitForTimeout(12000);
  const state = await page.evaluate(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    const desktopCtor =
      session && session.desktopSurface && session.desktopSurface.constructor
        ? session.desktopSurface.constructor.name
        : "";
    const taskbar = session && Array.isArray(session.processes)
      ? (session.processes.find((item) => item.displayPath === "/SYS/@TASKBAR") || null)
      : null;
    return {
      desktopCtor,
      taskbarCtor: taskbar && taskbar.surface && taskbar.surface.constructor ? taskbar.surface.constructor.name : "",
      processCount: session && Array.isArray(session.processes) ? session.processes.length : 0,
      logText: String(document.getElementById("log") ? document.getElementById("log").textContent || "" : "")
    };
  });
  expect(state.desktopCtor).toBe("Canvas2DSurface");
  expect(state.taskbarCtor).toBeTruthy();
  expect(state.processCount).toBeGreaterThan(0);
  expect(state.logText.includes("desktop: WebGL2 surface enabled.")).toBe(false);
  await page.screenshot({
    path: testInfo.outputPath(force2d ? "launcher-browser-path-2d.png" : "launcher-browser-path.png"),
    fullPage: true
  });
});

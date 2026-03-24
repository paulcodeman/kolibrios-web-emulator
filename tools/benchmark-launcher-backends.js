const path = require("path");
const { chromium } = require("playwright");

const LAUNCHER_URL = `file:///${path.resolve(__dirname, "..", "launcher.html").replace(/\\/g, "/")}`;
const DEFAULT_APP_PATH = "/3D/3DCUBE2";
const DEFAULT_ITERATIONS = Math.max(1, parseInt(process.argv[2] || "3", 10) || 3);
const DEFAULT_SAMPLE_MS = Math.max(250, parseInt(process.argv[3] || "1500", 10) || 1500);
const DEFAULT_APP = String(process.argv[4] || DEFAULT_APP_PATH);
function nowMs() {
  if (typeof performance !== "undefined" && performance && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function upperPath(value) {
  return String(value || "").replace(/\\/g, "/").toUpperCase();
}

function median(values) {
  const list = values
    .filter((value) => Number.isFinite(Number(value)))
    .map((value) => Number(value))
    .sort((a, b) => a - b);
  if (!list.length) {
    return 0;
  }
  const mid = list.length >> 1;
  if ((list.length & 1) !== 0) {
    return list[mid];
  }
  return (list[mid - 1] + list[mid]) / 2;
}

function average(values) {
  const list = values
    .filter((value) => Number.isFinite(Number(value)))
    .map((value) => Number(value));
  if (!list.length) {
    return 0;
  }
  const total = list.reduce((sum, value) => sum + value, 0);
  return total / list.length;
}

function formatMs(value) {
  return `${Number(value || 0).toFixed(1)} ms`;
}

function formatRatio(jsValue, wasmValue, higherIsBetter) {
  const left = Number(jsValue) || 0;
  const right = Number(wasmValue) || 0;
  if (!(left > 0) || !(right > 0)) {
    return "n/a";
  }
  const ratio = higherIsBetter ? (right / left) : (left / right);
  return `${ratio.toFixed(2)}x`;
}

async function waitForLauncherReady(page) {
  await page.waitForFunction(() => !!window.__app && !!window.__app.sessionManager, null, { timeout: 20000 });
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

async function collectLauncherSnapshot(page, appPath) {
  return page.evaluate((targetPath) => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    if (!session) {
      return null;
    }
    const targetKey = String(targetPath || "").replace(/\\/g, "/").toUpperCase();
    const processes = Array.isArray(session.processes) ? session.processes : [];
    const taskbar = processes.find((process) => (
      String(process && (process.displayPath || process.processPath || "")).toUpperCase() === "/SYS/@TASKBAR" &&
      process &&
      process.emulator &&
      process.emulator.windowDefined &&
      !process.removed
    )) || null;
    const app = processes.find((process) => (
      String(process && (process.displayPath || process.processPath || "")).toUpperCase() === targetKey &&
      process &&
      process.emulator &&
      process.emulator.windowDefined &&
      !process.removed
    )) || null;
    return {
      freqHz: typeof session.getReportedCpuFrequencyHz === "function" ? (session.getReportedCpuFrequencyHz() >>> 0) : 0,
      busyCount: typeof session.getSystemBusyCount === "function" ? (session.getSystemBusyCount() >>> 0) : 0,
      idleCount: typeof session.getIdleCount === "function" ? (session.getIdleCount() >>> 0) : 0,
      processCount: processes.filter((process) => !!process && !process.removed).length,
      readyCount: processes.filter((process) => !!process && !process.removed && process.displayReady).length,
      windowCount: processes.filter((process) => !!process && !process.removed && process.emulator && process.emulator.windowDefined).length,
      taskbarDisplayReady: !!(taskbar && taskbar.displayReady),
      appDisplayReady: !!(app && app.displayReady),
      appCpu: app && app.emulator && typeof app.emulator.getCpuBackendInfo === "function"
        ? app.emulator.getCpuBackendInfo()
        : null
    };
  }, appPath);
}

async function waitForLauncherStable(page, appPath) {
  const start = nowMs();
  let stableTicks = 0;
  let lastKey = "";
  let lastSnapshot = null;
  while ((nowMs() - start) < 12000) {
    lastSnapshot = await collectLauncherSnapshot(page, appPath);
    const key = lastSnapshot
      ? `${lastSnapshot.processCount}:${lastSnapshot.readyCount}:${lastSnapshot.windowCount}`
      : "";
    if (key && key === lastKey) {
      stableTicks += 1;
      if (stableTicks >= 2) {
        return {
          stableReached: true,
          stableMs: nowMs() - start,
          snapshot: lastSnapshot
        };
      }
    } else {
      stableTicks = 0;
      lastKey = key;
    }
    await page.waitForTimeout(250);
  }
  return {
    stableReached: false,
    stableMs: nowMs() - start,
    snapshot: lastSnapshot
  };
}

async function runLauncherBenchmark(browser, backend, iterationIndex, sampleMs, appPath) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  try {
    await context.addInitScript((mode) => {
      try {
        localStorage.setItem("kosemu.cpuBackendMode", String(mode || ""));
      } catch (err) {
        void err;
      }
    }, backend);
    const page = await context.newPage();

    const bootStart = nowMs();
    await page.goto(LAUNCHER_URL, { waitUntil: "load" });
    await waitForLauncherReady(page);
    const bootReadyMs = nowMs() - bootStart;

    const stable = await waitForLauncherStable(page, appPath);
    const bootStableMs = bootReadyMs + (stable.stableMs || 0);
    const bootSnapshot = stable.snapshot || await collectLauncherSnapshot(page, appPath);

    const launchStart = nowMs();
    await page.evaluate((targetPath) => {
      const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
      if (!session || typeof session.launchPath !== "function") {
        throw new Error("Launcher session is not ready.");
      }
      session.launchPath(String(targetPath || ""), { activate: true });
    }, appPath);
    await page.waitForFunction((targetPath) => {
      const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
      if (!session || !Array.isArray(session.processes)) {
        return false;
      }
      const targetKey = String(targetPath || "").replace(/\\/g, "/").toUpperCase();
      return session.processes.some((process) => (
        String(process && (process.displayPath || process.processPath || "")).toUpperCase() === targetKey &&
        process &&
        process.emulator &&
        process.emulator.windowDefined &&
        process.displayReady &&
        !process.removed
      ));
    }, appPath, { timeout: 20000 });
    const appLaunchMs = nowMs() - launchStart;

    const beforeSample = await collectLauncherSnapshot(page, appPath);
    await page.waitForTimeout(sampleMs);
    const afterSample = await collectLauncherSnapshot(page, appPath);

    return {
      backend,
      iteration: iterationIndex,
      appPath,
      sampleMs,
      bootReadyMs,
      bootStableMs,
      stableReached: !!stable.stableReached,
      processCount: bootSnapshot ? (bootSnapshot.processCount >>> 0) : 0,
      readyCount: bootSnapshot ? (bootSnapshot.readyCount >>> 0) : 0,
      windowCount: bootSnapshot ? (bootSnapshot.windowCount >>> 0) : 0,
      taskbarDisplayReady: !!(bootSnapshot && bootSnapshot.taskbarDisplayReady),
      appLaunchMs,
      busyCount: afterSample ? (afterSample.busyCount >>> 0) : 0,
      idleCount: afterSample ? (afterSample.idleCount >>> 0) : 0,
      freqHz: afterSample ? (afterSample.freqHz >>> 0) : 0,
      appCpu: afterSample ? afterSample.appCpu : null
    };
  } finally {
    await context.close();
  }
}

function printRun(result) {
  console.log(
    `${result.backend.toUpperCase()}#${result.iteration}: ` +
    `bootReady=${formatMs(result.bootReadyMs)} ` +
    `bootStable=${formatMs(result.bootStableMs)}${result.stableReached ? "" : " (timeout)"} ` +
    `launch=${formatMs(result.appLaunchMs)} ` +
    `busy=${result.busyCount}/${result.freqHz} ` +
    `idle=${result.idleCount}/${result.freqHz}`
  );
}

function summarizeBackend(results, backend) {
  const list = results.filter((entry) => entry.backend === backend);
  return {
    backend,
    runs: list.length,
    bootReadyMs: median(list.map((entry) => entry.bootReadyMs)),
    bootStableMs: median(list.map((entry) => entry.bootStableMs)),
    appLaunchMs: median(list.map((entry) => entry.appLaunchMs)),
    busyCount: average(list.map((entry) => entry.busyCount)),
    idleCount: average(list.map((entry) => entry.idleCount)),
    freqHz: average(list.map((entry) => entry.freqHz))
  };
}

async function main() {
  console.log(
    `Launcher benchmark: iterations=${DEFAULT_ITERATIONS}, sampleMs=${DEFAULT_SAMPLE_MS}, ` +
    `app=${DEFAULT_APP}`
  );
  const browser = await chromium.launch({
    headless: true
  });
  try {
    const results = [];
    for (let i = 0; i < DEFAULT_ITERATIONS; i += 1) {
      for (const backend of ["js", "wasm"]) {
        const result = await runLauncherBenchmark(
          browser,
          backend,
          i + 1,
          DEFAULT_SAMPLE_MS,
          DEFAULT_APP
        );
        results.push(result);
        printRun(result);
      }
    }

    const js = summarizeBackend(results, "js");
    const wasm = summarizeBackend(results, "wasm");

    console.log("");
    console.log("Median summary");
    console.log(
      `bootReady: JS=${formatMs(js.bootReadyMs)} WASM=${formatMs(wasm.bootReadyMs)} ` +
      `speedup=${formatRatio(js.bootReadyMs, wasm.bootReadyMs, false)}`
    );
    console.log(
      `bootStable: JS=${formatMs(js.bootStableMs)} WASM=${formatMs(wasm.bootStableMs)} ` +
      `speedup=${formatRatio(js.bootStableMs, wasm.bootStableMs, false)}`
    );
    console.log(
      `appLaunch: JS=${formatMs(js.appLaunchMs)} WASM=${formatMs(wasm.appLaunchMs)} ` +
      `speedup=${formatRatio(js.appLaunchMs, wasm.appLaunchMs, false)}`
    );
    console.log(
      `systemBusyCount(avg): JS=${js.busyCount.toFixed(0)}/${js.freqHz.toFixed(0)} ` +
      `WASM=${wasm.busyCount.toFixed(0)}/${wasm.freqHz.toFixed(0)}`
    );
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

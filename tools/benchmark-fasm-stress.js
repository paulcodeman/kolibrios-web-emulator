const path = require("path");
const { HeadlessUiHarness } = require("./ui-harness");

const DEFAULT_ROOT = process.env.KOS_ROOT || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root";
const DEFAULT_BACKEND = String(process.argv[2] || "js");
const DEFAULT_ITERATIONS = Math.max(1, parseInt(process.argv[3] || "5", 10) || 5);
const DEFAULT_COMPILE_TIMEOUT_MS = Math.max(500, parseInt(process.argv[4] || "5000", 10) || 5000);
const DEFAULT_POLL_MS = 100;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms | 0)));
}

function nowMs() {
  if (typeof performance !== "undefined" && performance && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function collectTexts(snapshot) {
  return (snapshot && snapshot.texts ? snapshot.texts : [])
    .map((item) => item.text || "")
    .filter(Boolean)
    .join("");
}

function hasUnhandledLogs(snapshot) {
  const logs = snapshot && Array.isArray(snapshot.logs) ? snapshot.logs : [];
  return logs.some((line) => /^Unhandled |Interpreter error|Host session |KX import /.test(line));
}

function captureCounters(emulator) {
  return {
    decodeCacheHits: emulator ? (emulator.decodeCacheHits >>> 0) : 0,
    decodeCacheMisses: emulator ? (emulator.decodeCacheMisses >>> 0) : 0,
    fastLoopHits: emulator ? (emulator.fastLoopHits >>> 0) : 0,
    fastLoopMisses: emulator ? (emulator.fastLoopMisses >>> 0) : 0,
    basicBlockHits: emulator ? (emulator.basicBlockHits >>> 0) : 0,
    basicBlockMisses: emulator ? (emulator.basicBlockMisses >>> 0) : 0,
    basicBlockBuilds: emulator ? (emulator.basicBlockBuilds >>> 0) : 0,
    basicBlockWarmups: emulator ? (emulator.basicBlockWarmups >>> 0) : 0,
    basicBlockPromotions: emulator ? (emulator.basicBlockPromotions >>> 0) : 0
  };
}

function diffCounters(after, before) {
  const result = {};
  const keys = Object.keys(after || {});
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    result[key] = Math.max(0, ((after && after[key]) >>> 0) - ((before && before[key]) >>> 0));
  }
  return result;
}

async function waitForCompileOutcome(harness, baselineHash, timeoutMs) {
  const deadline = Date.now() + Math.max(250, timeoutMs | 0);
  let lastHash = String(baselineHash || "");
  let stableTicks = 0;
  let sawVisualChange = false;
  while (Date.now() <= deadline) {
    const snapshot = harness.captureSnapshot({ includeSurfaceHash: true, includeLogs: true });
    const nextHash = snapshot && snapshot.surface ? String(snapshot.surface.hash || "") : "";
    if (nextHash && nextHash !== lastHash) {
      sawVisualChange = true;
      lastHash = nextHash;
      stableTicks = 0;
    } else {
      stableTicks += 1;
    }
    const text = collectTexts(snapshot);
    const hasError = /error:/i.test(text);
    const hasOutOfMemory = /out of memory/i.test(text);
    if ((sawVisualChange && stableTicks >= 3) || hasError || hasOutOfMemory) {
      return {
        snapshot,
        elapsedMs: Math.max(0, timeoutMs - Math.max(0, deadline - Date.now())),
        sawVisualChange,
        stableTicks
      };
    }
    await sleep(DEFAULT_POLL_MS);
  }
  return {
    snapshot: harness.captureSnapshot({ includeSurfaceHash: true, includeLogs: true }),
    elapsedMs: Math.max(0, timeoutMs),
    sawVisualChange,
    stableTicks
  };
}

async function main() {
  const cpuBackend = DEFAULT_BACKEND;
  const rootDir = path.resolve(process.argv[5] || DEFAULT_ROOT);
  const target = path.join(rootDir, "DEVELOP", "FASM");
  const harness = new HeadlessUiHarness({
    cpuBackend,
    launchDelayMs: 220,
    defaultTimeoutMs: Math.max(6000, DEFAULT_COMPILE_TIMEOUT_MS + 1000),
    actionDelayMs: 40
  });

  try {
    const launchStart = nowMs();
    await harness.launch(target);
    await harness.waitUntil((snapshot) => {
      return snapshot && snapshot.running && snapshot.window && snapshot.window.defined &&
        typeof snapshot.title === "string" && snapshot.title.startsWith("flat assembler");
    }, "FASM launch", 10000);
    await sleep(2500);
    const launchMs = nowMs() - launchStart;

    const initialSnapshot = harness.captureSnapshot({ includeSurfaceHash: true, includeLogs: true });
    const process = harness.getActiveProcess();
    const emulator = process && process.emulator ? process.emulator : null;
    const iterations = [];

    for (let i = 0; i < DEFAULT_ITERATIONS; i += 1) {
      const beforeSnapshot = harness.captureSnapshot({ includeSurfaceHash: true, includeLogs: true });
      const beforeCounters = captureCounters(emulator);
      const beforeHash = beforeSnapshot && beforeSnapshot.surface ? String(beforeSnapshot.surface.hash || "") : "";
      const clickStart = nowMs();
      await harness.clickButton({ label: "Компил." }, 5000, { settleMs: 0 });
      const outcome = await waitForCompileOutcome(harness, beforeHash, DEFAULT_COMPILE_TIMEOUT_MS);
      const elapsedMs = nowMs() - clickStart;
      const afterSnapshot = outcome.snapshot;
      const afterCounters = captureCounters(emulator);
      const text = collectTexts(afterSnapshot);
      iterations.push({
        iteration: i + 1,
        elapsedMs: Number(elapsedMs.toFixed(1)),
        sawVisualChange: !!outcome.sawVisualChange,
        surfaceHash: afterSnapshot && afterSnapshot.surface ? String(afterSnapshot.surface.hash || "") : "",
        hasError: /error:/i.test(text),
        hasOutOfMemory: /out of memory/i.test(text),
        hasUnhandledLogs: hasUnhandledLogs(afterSnapshot),
        counters: diffCounters(afterCounters, beforeCounters)
      });
    }

    const summary = {
      cpuBackend,
      launchMs: Number(launchMs.toFixed(1)),
      iterations: DEFAULT_ITERATIONS,
      compileTimeoutMs: DEFAULT_COMPILE_TIMEOUT_MS,
      initialHash: initialSnapshot && initialSnapshot.surface ? String(initialSnapshot.surface.hash || "") : "",
      cpuInfo: emulator && typeof emulator.getCpuBackendInfo === "function" ? emulator.getCpuBackendInfo() : null,
      totals: iterations.reduce((acc, item) => {
        acc.elapsedMs += Number(item.elapsedMs) || 0;
        acc.visualChanges += item.sawVisualChange ? 1 : 0;
        acc.errors += item.hasError ? 1 : 0;
        acc.outOfMemory += item.hasOutOfMemory ? 1 : 0;
        acc.unhandled += item.hasUnhandledLogs ? 1 : 0;
        const keys = Object.keys(item.counters || {});
        for (let k = 0; k < keys.length; k += 1) {
          const key = keys[k];
          acc.counters[key] = (acc.counters[key] || 0) + ((item.counters[key] >>> 0) || 0);
        }
        return acc;
      }, {
        elapsedMs: 0,
        visualChanges: 0,
        errors: 0,
        outOfMemory: 0,
        unhandled: 0,
        counters: {}
      })
    };

    console.log(JSON.stringify({
      target,
      summary,
      iterations
    }, null, 2));
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

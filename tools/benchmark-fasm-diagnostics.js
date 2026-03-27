const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { performance } = require("perf_hooks");
const {
  buildExternalAppProcessPath,
  createDefaultFileProviders,
  loadKosRuntime,
  readTargetImage
} = require("./ui-harness");

const DEFAULT_ROOT = process.env.KOS_ROOT || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root";
const DEFAULT_FASM = process.env.FASM_EXE || "C:\\Users\\Paul\\Desktop\\Kem\\tools\\fasm\\FASM.EXE";
const DEFAULT_BACKEND = String(process.argv[2] || "js");
const DEFAULT_LOOP_SCALE = Math.max(1, parseInt(process.argv[3] || "1", 10) || 1);
const DEFAULT_ROUNDS = Math.max(1, parseInt(process.argv[4] || "3", 10) || 3);
const DEFAULT_TIMEOUT_MS = Math.max(1000, parseInt(process.argv[5] || "20000", 10) || 20000);
const EXTRA_ARGS = process.argv.slice(6);
const DEFAULT_LIVE_SYSCALLS = !EXTRA_ARGS.includes("--no-live-syscalls");
const DEFAULT_TRACE_SYSCALLS = EXTRA_ARGS.includes("--trace-syscalls");
const DEFAULT_LIVE_SYSCALL_EVERY = readNumberFlag(EXTRA_ARGS, "--live-sys-every=", 4096, 1);
const DEFAULT_LIVE_SYSCALL_MS = readNumberFlag(EXTRA_ARGS, "--live-sys-ms=", 250, 1);
const DEFAULT_TRACE_SYSCALL_LIMIT = readNumberFlag(EXTRA_ARGS, "--trace-syscalls-limit=", 120, 0);
const OUTPUT_DIR = path.resolve(__dirname, "..", "artifacts", "fasm-diagnostics");
const ASM_SOURCE = path.resolve(__dirname, "fasm-emulator-diagnostics.asm");

const PHASE = {
  REG32: 1,
  MEM32: 2,
  BYTE: 3,
  STRING: 4,
  BRANCH: 5,
  GENERIC: 6,
  SYSCALL: 7,
  DONE: 0xffffffff >>> 0
};

const PHASE_DEFS = [
  { id: PHASE.REG32, name: "reg32_simple", iterBase: 280000 },
  { id: PHASE.MEM32, name: "mem32_simple", iterBase: 160000 },
  { id: PHASE.BYTE, name: "byte_memory", iterBase: 160000 },
  { id: PHASE.STRING, name: "string_dword", iterBase: 120000 },
  { id: PHASE.BRANCH, name: "branch_call", iterBase: 220000 },
  { id: PHASE.GENERIC, name: "generic_cached", iterBase: 260000 },
  { id: PHASE.SYSCALL, name: "syscall_time_counter", iterBase: 80000 }
];
const PHASE_NAME_BY_ID = new Map(PHASE_DEFS.map((item) => [item.id >>> 0, item.name]));

const BENCH = {
  state: 0x00010000 >>> 0,
  phase: 0x0001000c >>> 0,
  round: 0x00010010 >>> 0,
  checksum: 0x00010014 >>> 0,
  flags: 0x00010018 >>> 0,
  resultBase: 0x00010100 >>> 0
};

const TIMED_METHODS = [
  "executeCachedBasicBlock",
  "executeSimpleCachedBasicBlock",
  "executeAndBuildBasicBlock",
  "executeLinearBasicBlock",
  "executeBasicInstruction",
  "handleSoftInstruction",
  "handleSyscall",
  "invalidateBasicBlocksForWrite"
];

function nowMs() {
  return performance.now();
}

function readNumberFlag(args, prefix, defaultValue, minValue) {
  for (let i = 0; i < args.length; i += 1) {
    const item = String(args[i] || "");
    if (!item.startsWith(prefix)) {
      continue;
    }
    const parsed = parseInt(item.slice(prefix.length), 10);
    if (Number.isFinite(parsed)) {
      return Math.max(minValue, parsed);
    }
  }
  return defaultValue;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function hasUnhandledLogs(logs) {
  return (logs || []).some((line) => /^Unhandled |Interpreter error|Host session |KX import /.test(String(line || "")));
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

function diffNumericMaps(after, before) {
  const result = {};
  const keys = Object.keys(after || {});
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    result[key] = (Number(after[key]) || 0) - (Number(before && before[key]) || 0);
  }
  return result;
}

function cloneTimedStats(stats) {
  const next = {};
  const keys = Object.keys(stats || {});
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const item = stats[key] || {};
    next[key] = Number(item.ms) || 0;
    next[`${key}.count`] = item.count | 0;
  }
  return next;
}

function createTimedStats() {
  const stats = {};
  for (let i = 0; i < TIMED_METHODS.length; i += 1) {
    stats[TIMED_METHODS[i]] = { count: 0, ms: 0 };
  }
  return stats;
}

function wrapTimedMethod(target, name, stats, hooks) {
  if (!target || typeof target[name] !== "function") {
    return;
  }
  const original = target[name];
  target[name] = function wrappedTimedMethod(...args) {
    if (hooks && typeof hooks.before === "function") {
      hooks.before(this, args);
    }
    const start = nowMs();
    try {
      return original.apply(this, args);
    } finally {
      const elapsed = nowMs() - start;
      const slot = stats[name];
      if (slot) {
        slot.count += 1;
        slot.ms += elapsed;
      }
      if (hooks && typeof hooks.after === "function") {
        hooks.after(this, args, elapsed);
      }
    }
  };
}

function median(values) {
  if (!values.length) {
    return 0;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >>> 1;
  if ((sorted.length & 1) !== 0) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function average(values) {
  if (!values.length) {
    return 0;
  }
  let total = 0;
  for (let i = 0; i < values.length; i += 1) {
    total += Number(values[i]) || 0;
  }
  return total / values.length;
}

function formatMs(value) {
  return `${Number(value || 0).toFixed(2)}ms`;
}

function formatRate(iterations, ms) {
  if (!(ms > 0)) {
    return "n/a";
  }
  const perSec = (Number(iterations) || 0) * 1000 / ms;
  return `${perSec.toFixed(0)}/s`;
}

function phaseNameOf(phaseId) {
  const nextPhaseId = phaseId >>> 0;
  if (nextPhaseId === 0) {
    return "boot";
  }
  if (nextPhaseId === PHASE.DONE) {
    return "done";
  }
  return PHASE_NAME_BY_ID.get(nextPhaseId) || `phase_${nextPhaseId}`;
}

function formatSyscallSignature(sc) {
  if (!sc) {
    return "unknown";
  }
  const eax = sc.eax >>> 0;
  const ebx = sc.ebx >>> 0;
  return `syscall ${eax} ebx=0x${ebx.toString(16)}`;
}

function createSyscallTracker(options) {
  return {
    live: !!(options && options.live),
    liveEvery: Math.max(1, options && options.liveEvery || DEFAULT_LIVE_SYSCALL_EVERY),
    liveMs: Math.max(1, options && options.liveMs || DEFAULT_LIVE_SYSCALL_MS),
    rawTrace: !!(options && options.rawTrace),
    rawTraceLimit: Math.max(0, options && options.rawTraceLimit || DEFAULT_TRACE_SYSCALL_LIMIT),
    rawPrinted: 0,
    rawSuppressed: 0,
    rawSuppressionNotified: false,
    totalCount: 0,
    currentPhase: 0,
    currentRound: 0,
    byPhase: Object.create(null)
  };
}

function ensureSyscallPhaseSlot(tracker, phaseId) {
  const phaseKey = String(phaseId >>> 0);
  let slot = tracker.byPhase[phaseKey];
  if (!slot) {
    slot = tracker.byPhase[phaseKey] = {
      phaseId: phaseId >>> 0,
      phaseName: phaseNameOf(phaseId >>> 0),
      totalCount: 0,
      signatures: Object.create(null),
      lastSignature: "",
      lastEmitCount: 0,
      lastEmitTs: 0
    };
  }
  return slot;
}

function emitLivePhaseTransition(tracker, phaseId, round) {
  tracker.currentPhase = phaseId >>> 0;
  tracker.currentRound = round | 0;
  if (tracker.live) {
    console.error(`[phase] round ${tracker.currentRound} -> ${phaseNameOf(tracker.currentPhase)}`);
  }
}

function recordSyscallEvent(tracker, phaseId, round, sc, ts) {
  const slot = ensureSyscallPhaseSlot(tracker, phaseId >>> 0);
  const signature = formatSyscallSignature(sc);
  tracker.currentPhase = phaseId >>> 0;
  tracker.currentRound = round | 0;
  tracker.totalCount += 1;
  slot.totalCount += 1;
  slot.lastSignature = signature;
  slot.signatures[signature] = (slot.signatures[signature] | 0) + 1;
  if (!tracker.live) {
    return;
  }
  const shouldEmit = (slot.totalCount - slot.lastEmitCount) >= tracker.liveEvery || (ts - slot.lastEmitTs) >= tracker.liveMs;
  if (shouldEmit) {
    slot.lastEmitCount = slot.totalCount;
    slot.lastEmitTs = ts;
    console.error(
      `[live] round ${round | 0} ${slot.phaseName}: syscalls=${slot.totalCount} ` +
      `last=${signature}`
    );
  }
}

function emitRawSyscallTrace(tracker, text) {
  if (!tracker.rawTrace) {
    return;
  }
  const line = String(text || "");
  if (!/^syscall |^memory grow /.test(line)) {
    return;
  }
  if (tracker.rawPrinted < tracker.rawTraceLimit) {
    tracker.rawPrinted += 1;
    console.error(`[trace][round ${tracker.currentRound} ${phaseNameOf(tracker.currentPhase)}] ${line}`);
    return;
  }
  tracker.rawSuppressed += 1;
  if (!tracker.rawSuppressionNotified) {
    tracker.rawSuppressionNotified = true;
    console.error(`[trace] raw syscall log limit reached at ${tracker.rawTraceLimit} lines; further lines are suppressed`);
  }
}

function summarizeSyscalls(tracker) {
  return Object.keys(tracker.byPhase)
    .map((key) => tracker.byPhase[key])
    .filter((slot) => slot.totalCount > 0)
    .sort((a, b) => a.phaseId - b.phaseId)
    .map((slot) => ({
      phaseId: slot.phaseId,
      phaseName: slot.phaseName,
      totalCount: slot.totalCount,
      topSignatures: Object.keys(slot.signatures)
        .map((name) => ({ name, count: slot.signatures[name] | 0 }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6)
    }));
}

function readPhaseResults(emulator, rounds) {
  const rows = [];
  for (let round = 0; round < rounds; round += 1) {
    for (let i = 0; i < PHASE_DEFS.length; i += 1) {
      const index = (round * PHASE_DEFS.length + i) >>> 0;
      const addr = (BENCH.resultBase + ((index << 2) >>> 0)) >>> 0;
      rows.push({
        round,
        phaseId: PHASE_DEFS[i].id,
        phaseName: PHASE_DEFS[i].name,
        value: emulator.readMem32(addr) >>> 0
      });
    }
  }
  return rows;
}

function assembleBenchmark(loopScale, rounds) {
  ensureDir(OUTPUT_DIR);
  const outputName = `emulator-diagnostics-loop${loopScale}-rounds${rounds}.kex`;
  const outputPath = path.join(OUTPUT_DIR, outputName);
  const wrapperPath = path.join(OUTPUT_DIR, `emulator-diagnostics-loop${loopScale}-rounds${rounds}.build.asm`);
  const includePath = ASM_SOURCE.replace(/\\/g, "/");
  fs.writeFileSync(
    wrapperPath,
    [
      `DIAG_LOOP_SCALE equ ${loopScale}`,
      `DIAG_BENCH_ROUNDS equ ${rounds}`,
      `include '${includePath}'`,
      ""
    ].join("\r\n"),
    "utf8"
  );
  const result = spawnSync(
    DEFAULT_FASM,
    [wrapperPath, outputPath],
    {
      cwd: path.dirname(ASM_SOURCE),
      encoding: "utf8"
    }
  );
  if (result.status !== 0) {
    const message = [
      result.stdout || "",
      result.stderr || ""
    ].filter(Boolean).join("\n").trim();
    throw new Error(`FASM assemble failed.\n${message}`);
  }
  return {
    outputPath,
    stdout: String(result.stdout || "").trim()
  };
}

function analyzeEvents(events, loopScale, rounds) {
  const intervals = [];
  for (let i = 0; i + 1 < events.length; i += 1) {
    const current = events[i];
    const next = events[i + 1];
    if (!current || !next) {
      continue;
    }
    if ((current.phase >>> 0) === PHASE.DONE) {
      continue;
    }
    const def = PHASE_DEFS.find((item) => item.id === (current.phase >>> 0));
    if (!def) {
      continue;
    }
    intervals.push({
      phaseId: def.id,
      phaseName: def.name,
      round: current.round | 0,
      elapsedMs: Math.max(0, next.ts - current.ts),
      iterations: (def.iterBase * loopScale) | 0,
      counters: diffNumericMaps(next.counters, current.counters),
      timed: diffNumericMaps(next.timed, current.timed)
    });
  }
  const measuredIntervals = intervals.filter((item) => item.round >= (rounds > 1 ? 1 : 0));
  const summary = PHASE_DEFS.map((def) => {
    const rows = measuredIntervals.filter((item) => item.phaseId === def.id);
    const times = rows.map((item) => item.elapsedMs);
    const timedSummary = {};
    for (let i = 0; i < TIMED_METHODS.length; i += 1) {
      const method = TIMED_METHODS[i];
      timedSummary[method] = {
        avgMs: average(rows.map((item) => Number(item.timed[method]) || 0)),
        medianMs: median(rows.map((item) => Number(item.timed[method]) || 0)),
        avgCount: average(rows.map((item) => Number(item.timed[`${method}.count`]) || 0))
      };
    }
    return {
      phaseId: def.id,
      phaseName: def.name,
      iterations: (def.iterBase * loopScale) | 0,
      runs: rows.length,
      avgMs: average(times),
      medianMs: median(times),
      avgCounters: {
        basicBlockHits: average(rows.map((item) => Number(item.counters.basicBlockHits) || 0)),
        basicBlockMisses: average(rows.map((item) => Number(item.counters.basicBlockMisses) || 0)),
        basicBlockBuilds: average(rows.map((item) => Number(item.counters.basicBlockBuilds) || 0)),
        decodeCacheHits: average(rows.map((item) => Number(item.counters.decodeCacheHits) || 0)),
        decodeCacheMisses: average(rows.map((item) => Number(item.counters.decodeCacheMisses) || 0)),
        fastLoopHits: average(rows.map((item) => Number(item.counters.fastLoopHits) || 0))
      },
      timedSummary
    };
  });
  return {
    intervals,
    measuredIntervals,
    summary
  };
}

async function main() {
  const cpuBackend = DEFAULT_BACKEND;
  const loopScale = DEFAULT_LOOP_SCALE;
  const rounds = DEFAULT_ROUNDS;
  const timeoutMs = DEFAULT_TIMEOUT_MS;
  const liveSyscalls = DEFAULT_LIVE_SYSCALLS;
  const traceSyscalls = DEFAULT_TRACE_SYSCALLS;
  const rootDir = path.resolve(DEFAULT_ROOT);
  const assemble = assembleBenchmark(loopScale, rounds);
  const target = assemble.outputPath;
  const image = readTargetImage(target);
  const { Emulator, createHeadlessSurface } = loadKosRuntime();
  const surface = createHeadlessSurface(64, 64);
  const logs = [];
  let unhandledLogDetected = false;
  const syscallTracker = createSyscallTracker({
    live: liveSyscalls,
    liveEvery: DEFAULT_LIVE_SYSCALL_EVERY,
    liveMs: DEFAULT_LIVE_SYSCALL_MS,
    rawTrace: traceSyscalls,
    rawTraceLimit: DEFAULT_TRACE_SYSCALL_LIMIT
  });
  const emulator = new Emulator(surface, (msg) => {
    const line = String(msg || "");
    if (/^Unhandled |Interpreter error|Host session |KX import /.test(line)) {
      unhandledLogDetected = true;
    }
    if (logs.length < 2048) {
      logs.push(line);
    }
    emitRawSyscallTrace(syscallTracker, line);
  }, {
    cpuBackend
  });
  emulator.traceSyscalls = traceSyscalls;
  const providers = createDefaultFileProviders(target, rootDir);
  emulator.processPathOverride = buildExternalAppProcessPath(target);
  emulator.fileProvider = providers.fileProvider;
  emulator.fileInfoProvider = providers.fileInfoProvider;
  emulator.fileMutationProvider = providers.fileMutationProvider;

  const timedStats = createTimedStats();
  for (let i = 0; i < TIMED_METHODS.length; i += 1) {
    if (TIMED_METHODS[i] === "handleSyscall") {
      wrapTimedMethod(emulator, TIMED_METHODS[i], timedStats, {
        after(instance) {
          recordSyscallEvent(
            syscallTracker,
            syscallTracker.currentPhase,
            syscallTracker.currentRound,
            instance.lastSyscall,
            nowMs()
          );
        }
      });
      continue;
    }
    wrapTimedMethod(emulator, TIMED_METHODS[i], timedStats);
  }

  const events = [];
  const originalWriteMem32 = emulator.writeMem32.bind(emulator);
  emulator.writeMem32 = (addr, value) => {
    const nextAddr = addr >>> 0;
    const nextValue = value >>> 0;
    if (nextAddr === BENCH.phase) {
      const round = emulator.readMem32(BENCH.round) >>> 0;
      emitLivePhaseTransition(syscallTracker, nextValue >>> 0, round);
      events.push({
        ts: nowMs(),
        phase: nextValue >>> 0,
        round,
        counters: captureCounters(emulator),
        timed: cloneTimedStats(timedStats)
      });
    }
    return originalWriteMem32(addr, value);
  };

  emulator.load(image);

  const stopped = new Promise((resolve) => {
    emulator.onStopped = (reason) => resolve(String(reason || ""));
  });

  let timeoutHandle = null;
  const timeoutPromise = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => {
      emulator.stop("benchmark-timeout");
      resolve("benchmark-timeout");
    }, timeoutMs);
  });

  const runStart = nowMs();
  emulator.run();
  const stopReason = await Promise.race([stopped, timeoutPromise]);
  clearTimeout(timeoutHandle);
  const runElapsedMs = nowMs() - runStart;

  const finalCounters = captureCounters(emulator);
  const finalTimed = cloneTimedStats(timedStats);
  if (!events.length || (events[events.length - 1].phase >>> 0) !== PHASE.DONE) {
    events.push({
      ts: nowMs(),
      phase: PHASE.DONE,
      round: emulator.readMem32(BENCH.round) >>> 0,
      counters: finalCounters,
      timed: finalTimed
    });
  }

  const analysis = analyzeEvents(events, loopScale, rounds);
  const results = readPhaseResults(emulator, rounds);
  const checksum = emulator.readMem32(BENCH.checksum) >>> 0;
  const flags = emulator.readMem32(BENCH.flags) >>> 0;
  const cpuInfo = typeof emulator.getCpuBackendInfo === "function" ? emulator.getCpuBackendInfo() : null;

  console.log(`Built benchmark image: ${path.relative(process.cwd(), target)}`);
  console.log(`Backend: ${cpuBackend}`);
  console.log(`Rounds: ${rounds} (round 0 = warmup)`);
  console.log(`Run time: ${formatMs(runElapsedMs)}`);
  console.log(`Stop reason: ${stopReason}`);
  console.log(`Checksum: 0x${checksum.toString(16)}`);
  console.log(`Unhandled logs: ${unhandledLogDetected ? "yes" : "no"}`);
  console.log(`Live syscall tracking: ${liveSyscalls ? "on" : "off"}`);
  console.log(`Raw syscall trace: ${traceSyscalls ? `on (limit ${DEFAULT_TRACE_SYSCALL_LIMIT})` : "off"}`);
  console.log("");
  console.log("Per-phase median (measured rounds only):");
  for (let i = 0; i < analysis.summary.length; i += 1) {
    const item = analysis.summary[i];
    const topTimed = Object.keys(item.timedSummary)
      .map((name) => ({
        name,
        medianMs: item.timedSummary[name].medianMs
      }))
      .filter((entry) => entry.medianMs > 0.01)
      .sort((a, b) => b.medianMs - a.medianMs)
      .slice(0, 3);
    console.log(
      `- ${item.phaseName}: ${formatMs(item.medianMs)} ` +
      `(${formatRate(item.iterations, item.medianMs)}), ` +
      `bbHit=${item.avgCounters.basicBlockHits.toFixed(0)}, bbMiss=${item.avgCounters.basicBlockMisses.toFixed(0)}, ` +
      `decodeHit=${item.avgCounters.decodeCacheHits.toFixed(0)}`
    );
    if (topTimed.length) {
      console.log(`  timed: ${topTimed.map((entry) => `${entry.name}=${formatMs(entry.medianMs)}`).join(", ")}`);
    }
  }
  console.log("");
  console.log("Syscall summary:");
  for (const item of summarizeSyscalls(syscallTracker)) {
    console.log(
      `- ${item.phaseName}: ${item.totalCount} calls, ` +
      item.topSignatures.map((entry) => `${entry.name} x${entry.count}`).join(", ")
    );
  }
  console.log("");
  console.log("Per-round intervals:");
  for (let i = 0; i < analysis.intervals.length; i += 1) {
    const row = analysis.intervals[i];
    console.log(
      `- round ${row.round} ${row.phaseName}: ${formatMs(row.elapsedMs)} ` +
      `(${formatRate(row.iterations, row.elapsedMs)})`
    );
  }
  console.log("");
  console.log(JSON.stringify({
    target,
    cpuBackend,
    loopScale,
    rounds,
    timeoutMs,
    runElapsedMs: Number(runElapsedMs.toFixed(3)),
    stopReason,
    checksum,
    flags,
    cpuInfo,
    unhandledLogs: unhandledLogDetected,
    syscallTracking: {
      live: liveSyscalls,
      rawTrace: traceSyscalls,
      rawPrinted: syscallTracker.rawPrinted,
      rawSuppressed: syscallTracker.rawSuppressed,
      totalCount: syscallTracker.totalCount,
      summary: summarizeSyscalls(syscallTracker)
    },
    counters: finalCounters,
    timed: finalTimed,
    analysis,
    results
  }, null, 2));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
});

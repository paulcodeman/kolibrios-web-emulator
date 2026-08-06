const path = require("path");
const { spawnSync } = require("child_process");
const { performance } = require("perf_hooks");
const { loadKosRuntime } = require("./ui-harness");

const runtime = loadKosRuntime();
const { Emulator, createHeadlessSurface } = runtime;

const REG_EAX = 0;
const REG_ECX = 1;
const REG_EDX = 2;
const REG_EBX = 3;
const REG_ESP = 4;
const REG_EBP = 5;
const REG_ESI = 6;
const REG_EDI = 7;
const REG_EIP = 8;
const REG_EFLAGS = 9;

let sink = 0;

function parseOptions(argv) {
  const options = {
    scale: 1,
    samples: 5,
    json: false,
    headlessPath: "",
    headlessMs: 100
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || "");
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--quick") {
      options.scale = 0.25;
      options.samples = 3;
    } else if (arg === "--headless") {
      options.headlessPath = String(argv[i + 1] || "temp_plasma.kex");
      i += 1;
    } else if (arg === "--headless-ms") {
      options.headlessMs = Math.max(10, Number(argv[i + 1]) | 0);
      i += 1;
    } else if (arg === "--samples") {
      options.samples = Math.max(1, Number(argv[i + 1]) | 0);
      i += 1;
    } else if (/^\d+(?:\.\d+)?$/.test(arg)) {
      options.scale = Math.max(0.05, Number(arg));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = sorted.length >>> 1;
  return (sorted.length & 1) !== 0
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function createBareEmulator(width, height, memorySize) {
  const surface = createHeadlessSurface(width || 8, height || 8);
  const emulator = new Emulator(surface, () => {}, { cpuBackend: "js" });
  const mem = new Uint8Array(memorySize || 0x10000);
  const regs = new Uint32Array(10);
  const xmm = new Uint32Array(32);
  regs[REG_ESP] = Math.max(0, mem.length - 0x100) >>> 0;
  regs[REG_EBP] = regs[REG_ESP];
  regs[REG_EFLAGS] = 0x202;
  emulator.running = true;
  emulator.cpu = {
    mem,
    view: new DataView(mem.buffer),
    u32: new Uint32Array(mem.buffer),
    regs,
    fpu: new Float64Array(8),
    fpuSize: 0,
    fpuTop: 0,
    fpuStatusWord: 0,
    mmx: new Uint32Array(16),
    xmm,
    xmmF: new Float32Array(xmm.buffer),
    memFaultLogged: false
  };
  emulator.ensureCpuBackendReady();
  return emulator;
}

function installBytes(emulator, bytes, address) {
  const start = address >>> 0;
  emulator.cpu.mem.set(bytes, start);
}

function measureCase(test, options) {
  const iterations = Math.max(1, Math.round(test.iterations * options.scale));
  const state = test.create();
  const warmupIterations = Math.max(1, Math.min(iterations, Math.round(iterations * 0.08)));
  for (let i = 0; i < 2; i += 1) {
    if (test.prepare) test.prepare(state);
    sink ^= test.run(state, warmupIterations) >>> 0;
  }

  const times = [];
  let lastValue = 0;
  for (let sample = 0; sample < options.samples; sample += 1) {
    if (test.prepare) test.prepare(state);
    const started = performance.now();
    lastValue = test.run(state, iterations) >>> 0;
    const elapsedMs = performance.now() - started;
    if (!(elapsedMs > 0) || !Number.isFinite(elapsedMs)) {
      throw new Error(`${test.name}: invalid elapsed time ${elapsedMs}`);
    }
    times.push(elapsedMs);
    sink ^= lastValue;
  }
  if (test.verify) test.verify(state, lastValue);

  const elapsedMs = median(times);
  const totalUnits = iterations * test.unitsPerIteration;
  return {
    group: test.group,
    name: test.name,
    unit: test.unit,
    iterations,
    unitsPerIteration: test.unitsPerIteration,
    elapsedMs,
    minMs: Math.min(...times),
    maxMs: Math.max(...times),
    nsPerUnit: (elapsedMs * 1000000) / totalUnits,
    unitsPerSecond: (totalUnits * 1000) / elapsedMs
  };
}

function makeTests() {
  return [
    {
      group: "CPU instruction",
      name: "cached simple block (6 ops)",
      unit: "guest instruction",
      iterations: 350000,
      unitsPerIteration: 6,
      create() {
        const emulator = createBareEmulator();
        installBytes(emulator, [
          0x40,             // inc eax
          0x43,             // inc ebx
          0x01, 0xd8,       // add eax, ebx
          0x31, 0xc2,       // xor edx, eax
          0xd1, 0xc0,       // rol eax, 1
          0x90              // nop
        ], 0);
        const entries = [
          { addr: 0, next: 1 },
          { addr: 1, next: 2 },
          { addr: 2, next: 4 },
          { addr: 4, next: 6 },
          { addr: 6, next: 8 },
          { addr: 8, next: 9 }
        ];
        if (!emulator.cacheBasicBlock(entries)) {
          throw new Error("Could not build cached simple block benchmark fixture.");
        }
        const block = emulator.basicBlockCache.get(0);
        if (!block || !block.simplePlan) {
          throw new Error("Simple block benchmark did not produce a fast plan.");
        }
        emulator.cpu.regs[REG_EBX] = 3;
        return emulator;
      },
      run(emulator, iterations) {
        const regs = emulator.cpu.regs;
        let total = 0;
        for (let i = 0; i < iterations; i += 1) {
          regs[REG_EIP] = 0;
          total += emulator.executeCachedBasicBlock(0, 6);
        }
        if (total !== iterations * 6) {
          throw new Error(`Cached block executed ${total} instructions, expected ${iterations * 6}.`);
        }
        return regs[REG_EAX] ^ regs[REG_EDX];
      }
    },
    {
      group: "CPU instruction",
      name: "ADD eax, ebx (register)",
      unit: "guest instruction",
      iterations: 1200000,
      unitsPerIteration: 1,
      create() {
        const emulator = createBareEmulator();
        installBytes(emulator, [0x01, 0xd8], 0);
        emulator.cpu.regs[REG_EBX] = 3;
        return emulator;
      },
      run(emulator, iterations) {
        const regs = emulator.cpu.regs;
        for (let i = 0; i < iterations; i += 1) {
          regs[REG_EIP] = 0;
          if (!emulator.executeBasicInstruction(0)) throw new Error("ADD was not handled.");
        }
        return regs[REG_EAX];
      }
    },
    {
      group: "CPU instruction",
      name: "ADD [m32], eax (memory RMW)",
      unit: "guest instruction",
      iterations: 650000,
      unitsPerIteration: 1,
      create() {
        const emulator = createBareEmulator();
        installBytes(emulator, [0x01, 0x05, 0x00, 0x20, 0x00, 0x00], 0);
        emulator.cpu.regs[REG_EAX] = 3;
        return emulator;
      },
      run(emulator, iterations) {
        const regs = emulator.cpu.regs;
        for (let i = 0; i < iterations; i += 1) {
          regs[REG_EIP] = 0;
          if (!emulator.executeBasicInstruction(0)) throw new Error("Memory ADD was not handled.");
        }
        return emulator.readMem32(0x2000);
      }
    },
    {
      group: "CPU instruction",
      name: "ADD [same 64B chunk], eax (exact mask)",
      unit: "guest instruction",
      iterations: 250000,
      unitsPerIteration: 1,
      create() {
        const emulator = createBareEmulator();
        installBytes(emulator, [0x01, 0x05, 0x30, 0x00, 0x00, 0x00], 0);
        emulator.cpu.regs[REG_EAX] = 3;
        return emulator;
      },
      run(emulator, iterations) {
        const regs = emulator.cpu.regs;
        for (let i = 0; i < iterations; i += 1) {
          regs[REG_EIP] = 0;
          if (!emulator.executeBasicInstruction(0)) throw new Error("Same-page memory ADD was not handled.");
        }
        return emulator.readMem32(0x30);
      }
    },
    {
      group: "CPU instruction",
      name: "ADDPS xmm0, xmm1 (SSE)",
      unit: "guest instruction",
      iterations: 600000,
      unitsPerIteration: 1,
      create() {
        const emulator = createBareEmulator();
        installBytes(emulator, [0x0f, 0x58, 0xc1], 0);
        emulator.cpu.xmmF.set([1, 2, 3, 4], 0);
        emulator.cpu.xmmF.set([0.25, 0.5, 0.75, 1], 4);
        return emulator;
      },
      prepare(emulator) {
        emulator.cpu.xmmF.set([1, 2, 3, 4], 0);
      },
      run(emulator, iterations) {
        const regs = emulator.cpu.regs;
        for (let i = 0; i < iterations; i += 1) {
          regs[REG_EIP] = 0;
          if (!emulator.executeBasicInstruction(0)) throw new Error("ADDPS was not handled.");
        }
        return emulator.cpu.xmm[0];
      }
    },
    {
      group: "CPU instruction",
      name: "FADD st0, st1 (x87)",
      unit: "guest instruction",
      iterations: 500000,
      unitsPerIteration: 1,
      create() {
        const emulator = createBareEmulator();
        installBytes(emulator, [0xd8, 0xc1], 0);
        return emulator;
      },
      prepare(emulator) {
        emulator.cpu.fpu.fill(0);
        emulator.cpu.fpu[0] = 1;
        emulator.cpu.fpu[1] = 0.125;
        emulator.cpu.fpuSize = 2;
        emulator.cpu.fpuTop = 0;
      },
      run(emulator, iterations) {
        const regs = emulator.cpu.regs;
        for (let i = 0; i < iterations; i += 1) {
          regs[REG_EIP] = 0;
          if (!emulator.executeBasicInstruction(0)) throw new Error("FADD was not handled.");
        }
        return Math.trunc(emulator.fpuPeek());
      }
    },
    {
      group: "Runtime dispatch",
      name: "timeslice check (no clock read)",
      unit: "check",
      iterations: 5000000,
      unitsPerIteration: 1,
      create() {
        const emulator = createBareEmulator();
        emulator.sliceDeadlineAt = performance.now() + 60000;
        emulator.sliceTimeCheckInterval = 2048;
        emulator.sliceTimeCheckCounter = 2048;
        return emulator;
      },
      run(emulator, iterations) {
        let yielded = 0;
        for (let i = 0; i < iterations; i += 1) {
          if (emulator.shouldYieldForTimeslice()) yielded += 1;
        }
        return yielded;
      }
    },
    {
      group: "Runtime dispatch",
      name: "int 0x40 dispatch (set event mask)",
      unit: "syscall",
      iterations: 700000,
      unitsPerIteration: 1,
      create() {
        return createBareEmulator();
      },
      run(emulator, iterations) {
        const regs = emulator.cpu.regs;
        for (let i = 0; i < iterations; i += 1) {
          regs[REG_EAX] = 40;
          regs[REG_EBX] = 7;
          emulator.handleSyscall();
        }
        return emulator.eventMask;
      },
      verify(emulator) {
        if ((emulator.eventMask >>> 0) !== 7) {
          throw new Error(`Syscall dispatch corrupted event mask: ${emulator.eventMask}.`);
        }
      }
    },
    {
      group: "Memory",
      name: "readMem32 aligned",
      unit: "byte",
      iterations: 5000000,
      unitsPerIteration: 4,
      create() {
        const emulator = createBareEmulator();
        emulator.cpu.u32[0x2000 >>> 2] = 0x12345678;
        return emulator;
      },
      run(emulator, iterations) {
        let value = 0;
        for (let i = 0; i < iterations; i += 1) value ^= emulator.readMem32(0x2000);
        return value;
      }
    },
    {
      group: "Memory",
      name: "readMem32 unaligned",
      unit: "byte",
      iterations: 5000000,
      unitsPerIteration: 4,
      create() {
        const emulator = createBareEmulator();
        emulator.cpu.view.setUint32(0x2001, 0x12345678, true);
        return emulator;
      },
      run(emulator, iterations) {
        let value = 0;
        for (let i = 0; i < iterations; i += 1) value ^= emulator.readMem32(0x2001);
        return value;
      }
    },
    {
      group: "Memory",
      name: "writeMem32 data page",
      unit: "byte",
      iterations: 3000000,
      unitsPerIteration: 4,
      create() {
        return createBareEmulator();
      },
      run(emulator, iterations) {
        for (let i = 0; i < iterations; i += 1) emulator.writeMem32(0x2000, i);
        return emulator.cpu.u32[0x2000 >>> 2];
      }
    },
    {
      group: "Memory",
      name: "REP MOVSD bulk copy (4 KiB)",
      unit: "byte",
      iterations: 12000,
      unitsPerIteration: 4096,
      create() {
        const emulator = createBareEmulator(8, 8, 0x20000);
        installBytes(emulator, [0xf3, 0xa5], 0);
        for (let i = 0; i < 4096; i += 1) emulator.cpu.mem[0x4000 + i] = i & 0xff;
        return emulator;
      },
      run(emulator, iterations) {
        const regs = emulator.cpu.regs;
        for (let i = 0; i < iterations; i += 1) {
          regs[REG_EIP] = 0;
          regs[REG_ECX] = 1024;
          regs[REG_ESI] = 0x4000;
          regs[REG_EDI] = 0x8000;
          regs[REG_EFLAGS] = 0x202;
          if (!emulator.executeBasicInstruction(0)) throw new Error("REP MOVSD was not handled.");
        }
        return emulator.cpu.mem[0x8fff];
      },
      verify(emulator) {
        if (emulator.cpu.mem[0x8000] !== 0 || emulator.cpu.mem[0x8fff] !== 0xff) {
          throw new Error("REP MOVSD copied incorrect data.");
        }
      }
    },
    {
      group: "Graphics",
      name: "surface clear (Uint32Array.fill)",
      unit: "pixel",
      iterations: 220,
      unitsPerIteration: 640 * 480,
      create() {
        return createHeadlessSurface(640, 480);
      },
      run(surface, iterations) {
        for (let i = 0; i < iterations; i += 1) surface.clear(i & 0xffffff);
        return surface.buffer32[0];
      }
    },
    {
      group: "Graphics",
      name: "24-bpp image blit (direct buffer)",
      unit: "pixel",
      iterations: 55,
      unitsPerIteration: 640 * 480,
      create() {
        const emulator = createBareEmulator(640, 480, 0x200000);
        const src = 0x10000;
        const bytes = 640 * 480 * 3;
        for (let i = 0; i < bytes; i += 1) emulator.cpu.mem[src + i] = i & 0xff;
        return { emulator, src };
      },
      run(state, iterations) {
        for (let i = 0; i < iterations; i += 1) {
          if (!state.emulator.blit24ToSurfaceBuffer(state.src, 640, 480, 0, 0, 640 * 3)) {
            throw new Error("Direct 24-bpp blit rejected benchmark image.");
          }
        }
        return state.emulator.surface.buffer32[640 * 480 - 1];
      }
    },
    {
      group: "Graphics",
      name: "8-bpp paletted image draw",
      unit: "pixel",
      iterations: 45,
      unitsPerIteration: 320 * 200,
      create() {
        const emulator = createBareEmulator(640, 480, 0x80000);
        const src = 0x10000;
        const palette = 0x30000;
        for (let i = 0; i < 320 * 200; i += 1) emulator.cpu.mem[src + i] = i & 0xff;
        for (let i = 0; i < 256; i += 1) emulator.cpu.u32[(palette >>> 2) + i] = (i << 16) | (i << 8) | i;
        emulator.windowDefined = true;
        emulator.windowWidth = 640;
        emulator.windowHeight = 480;
        emulator.inRedraw = true;
        return { emulator, src, palette };
      },
      run(state, iterations) {
        for (let i = 0; i < iterations; i += 1) {
          state.emulator.drawImageFromMemory(
            state.src,
            (320 << 16) | 200,
            0,
            8,
            state.palette,
            0
          );
        }
        return state.emulator.surface.buffer32[319];
      }
    },
    {
      group: "Graphics",
      name: "32-bpp image draw",
      unit: "pixel",
      iterations: 45,
      unitsPerIteration: 320 * 200,
      create() {
        const emulator = createBareEmulator(640, 480, 0x80000);
        const src = 0x10000;
        for (let i = 0; i < 320 * 200; i += 1) emulator.cpu.u32[(src >>> 2) + i] = i & 0xffffff;
        emulator.windowDefined = true;
        emulator.windowWidth = 640;
        emulator.windowHeight = 480;
        emulator.inRedraw = true;
        return { emulator, src };
      },
      run(state, iterations) {
        for (let i = 0; i < iterations; i += 1) {
          state.emulator.drawImageFromMemory(state.src, (320 << 16) | 200, 0, 32, 0, 0);
        }
        return state.emulator.surface.buffer32[319];
      }
    },
    {
      group: "Graphics",
      name: "rectangle fill via setPixel",
      unit: "pixel",
      iterations: 35,
      unitsPerIteration: 640 * 480,
      create() {
        const emulator = createBareEmulator(640, 480);
        emulator.windowDefined = true;
        emulator.windowWidth = 640;
        emulator.windowHeight = 480;
        emulator.inRedraw = true;
        return emulator;
      },
      run(emulator, iterations) {
        const regs = emulator.cpu.regs;
        regs[REG_EBX] = (0 << 16) | 640;
        regs[REG_ECX] = (0 << 16) | 480;
        regs[REG_EDX] = 0x123456;
        for (let i = 0; i < iterations; i += 1) emulator.sysDrawRect();
        return emulator.surface.buffer32[640 * 480 - 1];
      }
    }
  ];
}

function formatRate(result) {
  if (result.unit === "byte") {
    return `${(result.unitsPerSecond / (1024 * 1024)).toFixed(1)} MiB/s`;
  }
  if (result.unit === "pixel") {
    return `${(result.unitsPerSecond / 1000000).toFixed(1)} MPixel/s`;
  }
  return `${(result.unitsPerSecond / 1000000).toFixed(2)} M/s`;
}

function printResults(results, probe, options) {
  console.log(`KolibriOS emulator hotspot benchmark (Node ${process.version}, scale=${options.scale}, samples=${options.samples})`);
  const groups = [...new Set(results.map((result) => result.group))];
  for (const group of groups) {
    console.log(`\n${group} - slowest first`);
    const list = results
      .filter((result) => result.group === group)
      .slice()
      .sort((a, b) => b.nsPerUnit - a.nsPerUnit);
    for (let i = 0; i < list.length; i += 1) {
      const result = list[i];
      console.log(
        `${String(i + 1).padStart(2)}. ${result.name.padEnd(38)} ` +
        `${result.nsPerUnit.toFixed(2).padStart(9)} ns/${result.unit}  ${formatRate(result).padStart(15)}`
      );
    }
  }
  if (probe) {
    console.log("\nHeadless responsiveness");
    console.log(
      `${path.basename(probe.path)}: requested=${probe.requestedMs} ms, ` +
      `wall=${probe.wallMs.toFixed(1)} ms, timer drift=${probe.timerDriftMs.toFixed(1)} ms ` +
      `(${probe.slowdown.toFixed(1)}x requested duration)`
    );
  }
  console.log(`\nverification sink=0x${(sink >>> 0).toString(16).padStart(8, "0")}`);
}

function runHeadlessProbe(filePath, requestedMs) {
  const target = path.resolve(filePath);
  const runner = path.resolve(__dirname, "node-runner.js");
  const started = performance.now();
  const child = spawnSync(process.execPath, [runner, target, String(requestedMs)], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    timeout: 60000,
    windowsHide: true
  });
  const wallMs = performance.now() - started;
  if (child.error) throw child.error;
  if (child.status !== 0) {
    throw new Error(`Headless probe failed (${child.status}): ${child.stderr || child.stdout}`);
  }
  return {
    path: target,
    requestedMs,
    wallMs,
    timerDriftMs: Math.max(0, wallMs - requestedMs),
    slowdown: wallMs / requestedMs
  };
}

function main() {
  const options = parseOptions(process.argv.slice(2));
  const results = makeTests().map((test) => measureCase(test, options));
  const probe = options.headlessPath
    ? runHeadlessProbe(options.headlessPath, options.headlessMs)
    : null;
  if (options.json) {
    console.log(JSON.stringify({
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        scale: options.scale,
        samples: options.samples
      },
      results,
      headlessProbe: probe,
      verificationSink: sink >>> 0
    }, null, 2));
  } else {
    printResults(results, probe, options);
  }
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(2);
}

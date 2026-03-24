const {
  buildExternalAppProcessPath,
  createDefaultFileProviders,
  loadKosRuntime,
  readTargetImage
} = require("./ui-harness");

const target = process.argv[2];
if (!target) {
  console.error("Usage: node tools/node-runner.js <file.kex>");
  process.exit(1);
}
const maxMs = Number(process.argv[3] || 2000);

(async () => {
  const { Emulator, createHeadlessSurface } = loadKosRuntime();
  const image = readTargetImage(target);

  const surface = createHeadlessSurface(800, 600);
  const emulator = new Emulator(surface, (msg) => console.log(msg), {
    cpuBackend: process.env.KOS_CPU_BACKEND
  });
  const rootDir = process.env.KOS_ROOT || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root";
  const providers = createDefaultFileProviders(target, rootDir);
  emulator.processPathOverride = buildExternalAppProcessPath(target);
  emulator.fileProvider = providers.fileProvider;
  emulator.fileInfoProvider = providers.fileInfoProvider;
  emulator.fileMutationProvider = providers.fileMutationProvider;
  emulator.traceOpcodes = process.env.KOS_TRACE_OPCODES === "1";
  emulator.traceSyscalls = process.env.KOS_TRACE_SYSCALLS === "1";
  emulator.traceFaultBytes = process.env.KOS_TRACE_FAULT === "1";
  emulator.strictMem = process.env.KOS_STRICT_MEM === "1";
  const watchMemEnv = process.env.KOS_WATCH_MEM;
  if (watchMemEnv) {
    const watchAddr = Number.parseInt(watchMemEnv, 0) >>> 0;
    const watchLenEnv = process.env.KOS_WATCH_MEM_LEN;
    const watchLen = watchLenEnv ? Number.parseInt(watchLenEnv, 0) >>> 0 : 1;
    const watchMemBytes = process.env.KOS_WATCH_MEM_BYTES === "1";
    const watchEnd = (watchAddr + (watchLen || 1)) >>> 0;
    const logMem = (addr, size, value, kind) => {
      const start = addr >>> 0;
      const end = (start + (size >>> 0)) >>> 0;
      if (start < watchEnd && end > watchAddr) {
        const eip = emulator.readReg(8) >>> 0;
        let detail = "";
        if (value !== undefined) {
          if (typeof value === "number") {
            detail = ` value=0x${(value >>> 0).toString(16)}`;
          } else if (value && value.length !== undefined) {
            const bytes = Array.from(value).slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join(" ");
            detail = ` bytes=${bytes}`;
          }
        }
        if (watchMemBytes) {
          const instr = emulator.readMemBlock(eip, 16);
          if (instr) {
            const ib = Array.from(instr).map((b) => b.toString(16).padStart(2, "0")).join(" ");
            detail += ` instr=${ib}`;
          }
        }
        console.log(`watch mem ${kind} addr=0x${start.toString(16)} size=${size} eip=0x${eip.toString(16)}${detail}`);
      }
    };
    const origWriteMem8 = emulator.writeMem8.bind(emulator);
    const origWriteMem16 = emulator.writeMem16.bind(emulator);
    const origWriteMem32 = emulator.writeMem32.bind(emulator);
    const origWriteMemBlock = emulator.writeMemBlock.bind(emulator);
    emulator.writeMem8 = (addr, value) => {
      logMem(addr, 1, value, "w8");
      return origWriteMem8(addr, value);
    };
    emulator.writeMem16 = (addr, value) => {
      logMem(addr, 2, value, "w16");
      return origWriteMem16(addr, value);
    };
    emulator.writeMem32 = (addr, value) => {
      logMem(addr, 4, value, "w32");
      return origWriteMem32(addr, value);
    };
    emulator.writeMemBlock = (addr, bytes) => {
      logMem(addr, bytes.length || 0, bytes, "block");
      return origWriteMemBlock(addr, bytes);
    };
  }
  const watchRegEnv = process.env.KOS_WATCH_REG;
  if (watchRegEnv) {
    const regMap = {
      eax: 0, ecx: 1, edx: 2, ebx: 3,
      esp: 4, ebp: 5, esi: 6, edi: 7,
      eip: 8, eflags: 9
    };
    const key = String(watchRegEnv).trim().toLowerCase();
    const watchReg = Object.prototype.hasOwnProperty.call(regMap, key)
      ? regMap[key]
      : Number.parseInt(key, 0);
    const watchMinEnv = process.env.KOS_WATCH_REG_MIN;
    const watchMin = watchMinEnv ? Number.parseInt(watchMinEnv, 0) >>> 0 : null;
    const watchBytes = process.env.KOS_WATCH_REG_BYTES === "1";
    const watchDumpLenEnv = process.env.KOS_WATCH_REG_DUMP;
    const watchDumpLen = watchDumpLenEnv ? Number.parseInt(watchDumpLenEnv, 0) : 0;
    const watchDumpOffsetEnv = process.env.KOS_WATCH_REG_DUMP_OFFSET;
    const watchDumpOffset = watchDumpOffsetEnv ? Number.parseInt(watchDumpOffsetEnv, 0) : 0;
    const watchExtraEnv = process.env.KOS_WATCH_REG_EXTRA;
    let watchExtra = null;
    if (watchExtraEnv) {
      const extraKey = String(watchExtraEnv).trim().toLowerCase();
      watchExtra = Object.prototype.hasOwnProperty.call(regMap, extraKey)
        ? regMap[extraKey]
        : Number.parseInt(extraKey, 0);
      if (!Number.isFinite(watchExtra)) {
        watchExtra = null;
      }
    }
    if (Number.isFinite(watchReg)) {
      const origWriteReg = emulator.writeReg.bind(emulator);
      emulator.writeReg = (reg, value) => {
        if (reg === watchReg) {
          const v = value >>> 0;
          if (watchMin === null || v >= watchMin) {
            const eip = emulator.readReg(8) >>> 0;
            let extra = "";
            if (watchExtra !== null) {
              const extraVal = emulator.readReg(watchExtra) >>> 0;
              extra = ` extra=0x${extraVal.toString(16)}`;
            }
            let detail = "";
            if (watchBytes) {
              const bytes = emulator.readMemBlock(eip, 16);
              if (bytes) {
                detail = ` bytes=${Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join(" ")}`;
              }
            }
            if (watchDumpLen > 0) {
              const dumpAddr = (eip + watchDumpOffset) >>> 0;
              const dump = emulator.readMemBlock(dumpAddr, watchDumpLen);
              if (dump) {
                detail += ` dump@${watchDumpOffset}=` +
                  Array.from(dump).map((b) => b.toString(16).padStart(2, "0")).join(" ");
              }
            }
            console.log(`watch reg ${key} <- 0x${v.toString(16)} eip=0x${eip.toString(16)}${extra}${detail}`);
          }
        }
        return origWriteReg(reg, value);
      };
    }
  }
  emulator.load(image);
  emulator.run();

  if (Number.isFinite(maxMs) && maxMs > 0) {
    setTimeout(() => {
      emulator.stop();
      console.log(`Stopped after ${maxMs} ms`);
      process.exit(0);
    }, maxMs);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

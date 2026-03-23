const { loadKosRuntime } = require("./ui-harness");

const { Emulator, createHeadlessSurface } = loadKosRuntime();

const REG = {
  EAX: 0,
  EBX: 3
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEq(actual, expected, message) {
  if ((actual >>> 0) !== (expected >>> 0)) {
    throw new Error(`${message}: expected 0x${(expected >>> 0).toString(16)}, got 0x${(actual >>> 0).toString(16)}`);
  }
}

try {
  const regs = new Uint32Array(10);
  const emulator = new Emulator(createHeadlessSurface(8, 8), () => {});
  emulator.writeReg = (reg, value) => {
    regs[reg] = value >>> 0;
  };

  const infoPtr = 0x100;
  let currentSub = 0;
  emulator.readMem32 = (addr) => (addr >>> 0) === infoPtr ? (currentSub >>> 0) : 0;

  const handlers = {
    0: "sysFileRead",
    1: "sysFileReadDir",
    2: "sysFileCreate",
    3: "sysFileWrite",
    4: "sysFileSetEnd",
    5: "sysFileGetInfo",
    6: "sysFileSetInfo",
    7: "sysFileStartApp",
    8: "sysFileDelete",
    9: "sysFileCreateFolder",
    10: "sysFileRenameMove"
  };

  for (const [subText, handlerName] of Object.entries(handlers)) {
    let called = null;
    currentSub = Number(subText) >>> 0;
    emulator[handlerName] = (ptr, encoded) => {
      called = {
        ptr: ptr >>> 0,
        encoded: !!encoded
      };
    };
    emulator.sysFileDispatch(infoPtr, true);
    assert(called !== null, `dispatch should call ${handlerName} for sub ${subText}`);
    assertEq(called.ptr, infoPtr, `${handlerName} should receive the same info pointer`);
    assert(called.encoded === true, `${handlerName} should receive the encoded flag`);
  }

  regs.fill(0);
  emulator.sysFileDispatch(0, false);
  assertEq(regs[REG.EAX], 7, "null infoPtr should return invalid-parameter error");
  assertEq(regs[REG.EBX], 0, "null infoPtr should clear EBX");

  regs.fill(0);
  currentSub = 99;
  emulator.sysFileDispatch(infoPtr, false);
  assertEq(regs[REG.EAX], 2, "unknown file API subcall should return not-implemented");
  assertEq(regs[REG.EBX], 0, "unknown file API subcall should clear EBX");

  console.log("Autotest OK: file API dispatch uses the handler table without changing subcall routing.");
} catch (err) {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(2);
}

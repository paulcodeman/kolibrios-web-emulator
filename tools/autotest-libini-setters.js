const { loadKosRuntime } = require("./ui-harness");

const { Emulator } = loadKosRuntime().emu;
const { createHeadlessSurface } = loadKosRuntime().gfx.surface;
const helpers = loadKosRuntime().emu.hostLibHelpers || {};

const REG = {
  EAX: 0,
  ESP: 4,
  EIP: 8
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

function encodeLatin1(text) {
  return new Uint8Array(Buffer.from(String(text || ""), "latin1"));
}

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
}

function createCpuState(byteLength) {
  const mem = new Uint8Array(byteLength >>> 0);
  const xmm = new Uint32Array(32);
  return {
    mem,
    view: new DataView(mem.buffer),
    regs: new Uint32Array(10),
    fpu: new Float64Array(8),
    fpuSize: 0,
    fpuStatusWord: 0,
    mmx: new Uint32Array(16),
    xmm,
    xmmF: new Float32Array(xmm.buffer),
    memFaultLogged: false
  };
}

function writeAscii(emulator, ptr, text) {
  emulator.writeCString(ptr >>> 0, String(text || ""), String(text || "").length + 1);
}

function invokeStub(emulator, stubPtr, args) {
  const esp = 0x6000;
  emulator.writeReg(REG.ESP, esp >>> 0);
  emulator.writeMem32(esp >>> 0, 0x12345678);
  for (let i = 0; i < args.length; i += 1) {
    emulator.writeMem32((esp + 4 + i * 4) >>> 0, args[i] >>> 0);
  }
  const handled = emulator.invokeHostCallStub(stubPtr >>> 0);
  assert(handled, `Host stub 0x${(stubPtr >>> 0).toString(16)} was not invoked.`);
  return emulator.readReg(REG.EAX) >>> 0;
}

try {
  assert(typeof helpers.findIniValue === "function", "Missing INI helper export.");
  const emulator = new Emulator(createHeadlessSurface(8, 8), () => {});
  emulator.cpu = createCpuState(1 << 20);
  emulator.memLimit = emulator.cpu.mem.length >>> 0;
  emulator.processReservedSize = 0x2000;
  emulator.stackBase = 0x4000;

  const fileStore = new Map();
  fileStore.set(
    normalizePath("/sys/settings/system.ini"),
    encodeLatin1("[style]\r\nbuttons_gradient=1\r\nskin=/sys/default.skn\r\n")
  );

  emulator.fileProvider = (kpath) => {
    const bytes = fileStore.get(normalizePath(kpath)) || null;
    return bytes ? bytes.slice() : null;
  };
  emulator.fileMutationProvider = (op, kpath, options) => {
    if (op !== "create-file") {
      return { errorCode: 2, written: 0 };
    }
    const bytes = options && options.data instanceof Uint8Array ? options.data.slice() : new Uint8Array(0);
    fileStore.set(normalizePath(kpath), bytes);
    return { errorCode: 0, written: bytes.length >>> 0 };
  };

  const loaded = {
    path: "/sys/lib/libini.obj",
    exportPtr: emulator.createHostDllExportTable("autotest-libini", [
      { name: "ini_set_int", value: 0x11111111 },
      { name: "ini_set_str", value: 0x22222222 }
    ])
  };
  assert(loaded.exportPtr, "Failed to create test DLL export table.");
  emulator.applyHostLibraryOverrides(loaded);

  const setIntSlot = emulator.findHostDllExportValueSlot(loaded.exportPtr, "ini_set_int") >>> 0;
  const setStrSlot = emulator.findHostDllExportValueSlot(loaded.exportPtr, "ini_set_str") >>> 0;
  const setIntStub = emulator.readMem32(setIntSlot) >>> 0;
  const setStrStub = emulator.readMem32(setStrSlot) >>> 0;
  assert(setIntStub && setIntStub !== 0x11111111, "ini_set_int override stub was not installed.");
  assert(setStrStub && setStrStub !== 0x22222222, "ini_set_str override stub was not installed.");

  const filePtr = 0x1000;
  const sectionPtr = 0x1100;
  const keyPtr = 0x1200;
  const valuePtr = 0x1300;
  writeAscii(emulator, filePtr, "/sys/settings/system.ini");
  writeAscii(emulator, sectionPtr, "style");
  writeAscii(emulator, keyPtr, "buttons_gradient");

  const setIntResult = invokeStub(emulator, setIntStub, [filePtr, sectionPtr, keyPtr, 0]);
  assertEq(setIntResult, 0, "ini_set_int should succeed");
  let stored = fileStore.get(normalizePath("/sys/settings/system.ini"));
  assert(stored instanceof Uint8Array, "system.ini should remain present after ini_set_int.");
  assertEq(
    helpers.parseIniIntString(helpers.findIniValue(stored, "style", "buttons_gradient")),
    0,
    "ini_set_int should update buttons_gradient"
  );

  writeAscii(emulator, keyPtr, "skin");
  writeAscii(emulator, valuePtr, "/sys/default.skn");
  const setStrResult = invokeStub(emulator, setStrStub, [filePtr, sectionPtr, keyPtr, valuePtr, 16]);
  assertEq(setStrResult, 0, "ini_set_str should succeed");
  stored = fileStore.get(normalizePath("/sys/settings/system.ini"));
  assert(stored instanceof Uint8Array, "system.ini should remain present after ini_set_str.");
  assert(
    helpers.findIniValue(stored, "style", "skin") === "/sys/default.skn",
    "ini_set_str should update the saved skin path"
  );

  console.log("Autotest OK: libini host overrides persist ini_set_int/ini_set_str into system.ini.");
} catch (err) {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(2);
}

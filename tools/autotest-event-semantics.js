const fs = require("fs");
const path = require("path");
const { loadKosRuntime } = require("./ui-harness");

const defaultPath = path.resolve(
  __dirname,
  "../../upstream-kolibrios/programs/demos/bcdclk/trunk/bcdclk.kex"
);

const target = process.argv[2] ? path.resolve(process.argv[2]) : defaultPath;
if (!fs.existsSync(target)) {
  console.error("Event semantics test image not found.");
  console.error("Usage: node tools/autotest-event-semantics.js <path-to-kex>");
  console.error(`Default path tried: ${defaultPath}`);
  process.exit(1);
}

const { Emulator, parseKex, createHeadlessSurface } = loadKosRuntime();

const REG = {
  EAX: 0,
  ECX: 1,
  EDX: 2,
  EBX: 3,
  ESI: 6,
  EDI: 7
};

const data = fs.readFileSync(target);
const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
const image = parseKex(buffer, path.basename(target));
const surface = createHeadlessSurface(800, 600);
const emulator = new Emulator(surface, () => {});

let activeSlot = 1;
emulator.hostSession = {
  getActiveThreadSlot() {
    return activeSlot >>> 0;
  },
  getMaxThreadSlot() {
    return Math.max(1, activeSlot >>> 0) >>> 0;
  }
};

function setReg(index, value) {
  emulator.writeReg(index, value >>> 0);
}

function getEax() {
  return emulator.readReg(REG.EAX) >>> 0;
}

function checkEvent() {
  emulator.sysCheckEvent();
  return getEax();
}

function getKey() {
  emulator.sysGetKey();
  return getEax();
}

function getButton() {
  emulator.sysGetButton();
  return getEax();
}

function clearEventState() {
  emulator.eventQueue.length = 0;
  emulator.keyBuffer.length = 0;
  emulator.pendingButtonResult = 1;
  emulator.mouseEventFlags = 0;
  emulator.mouseScrollX = 0;
  emulator.mouseScrollY = 0;
}

function queueButton(id, mouseMask) {
  emulator.pendingButtonResult = ((((id >>> 0) & 0x00ffffff) << 8) | ((mouseMask | 0) & 0xff)) >>> 0;
  emulator.queueEvent(3);
}

function assertEq(actual, expected, label) {
  if ((actual >>> 0) !== (expected >>> 0)) {
    throw new Error(`${label}: expected ${expected >>> 0}, got ${actual >>> 0}`);
  }
}

try {
  emulator.load(image);
  emulator.setupInterpreter();
  activeSlot = emulator.threadSlot >>> 0;

  assertEq(checkEvent(), 1, "initial redraw event");
  assertEq(checkEvent(), 1, "redraw event should persist until function 0");
  setReg(REG.EBX, ((20 & 0xffff) << 16) | 120);
  setReg(REG.ECX, ((20 & 0xffff) << 16) | 80);
  setReg(REG.EDX, 0x03000000);
  setReg(REG.ESI, 0);
  setReg(REG.EDI, 0);
  emulator.sysCreateWindow();
  assertEq(checkEvent(), 0, "function 0 should clear redraw event");

  clearEventState();
  emulator.queueBrowserKeyEvent({
    asciiCode: 65,
    scanCode: 30,
    controlKeys: 0,
    hotkey: false,
    released: false,
    extended: false,
    modifier: false,
    lockKey: false
  });
  assertEq(checkEvent(), 2, "key event should be reported");
  assertEq(checkEvent(), 2, "key event should persist until function 2");
  if (getKey() === 1) {
    throw new Error("function 2 unexpectedly reported an empty active key buffer");
  }
  assertEq(checkEvent(), 0, "key event should clear after reading the last buffered key");

  clearEventState();
  emulator.queueBrowserKeyEvent({
    asciiCode: 66,
    scanCode: 48,
    controlKeys: 0,
    hotkey: false,
    released: false,
    extended: false,
    modifier: false,
    lockKey: false
  });
  activeSlot = ((emulator.threadSlot + 1) >>> 0) || 1;
  assertEq(getKey(), 1, "inactive window should see an empty key buffer");
  assertEq(checkEvent(), 0, "inactive window should not receive event 2");
  activeSlot = emulator.threadSlot >>> 0;
  assertEq(checkEvent(), 2, "buffered key should become visible again after activation");
  if (getKey() === 1) {
    throw new Error("reactivated window unexpectedly lost its buffered key");
  }

  clearEventState();
  activeSlot = emulator.threadSlot >>> 0;
  queueButton(0x1234, 0);
  assertEq(checkEvent(), 3, "button event should be reported");
  assertEq(checkEvent(), 3, "button event should persist until function 17");
  if (getButton() === 1) {
    throw new Error("function 17 unexpectedly reported an empty active button buffer");
  }
  assertEq(checkEvent(), 0, "button event should clear after function 17");

  clearEventState();
  queueButton(0x4321, 0);
  activeSlot = ((emulator.threadSlot + 1) >>> 0) || 1;
  assertEq(getButton(), 1, "inactive window should see an empty button buffer");
  assertEq(checkEvent(), 0, "inactive window should not receive event 3");
  activeSlot = emulator.threadSlot >>> 0;
  assertEq(checkEvent(), 3, "buffered button should become visible again after activation");
  if (getButton() === 1) {
    throw new Error("reactivated window unexpectedly lost its buffered button");
  }

  clearEventState();
  activeSlot = emulator.threadSlot >>> 0;
  emulator.eventMask = 0x7;
  emulator.setMouseState(40, 40, 0, true, 0, 0, 0, 0, true, 40, 40);
  assertEq(checkEvent(), 0, "masked mouse event should stay hidden");
  emulator.eventMask = 0x27;
  assertEq(checkEvent(), 6, "mouse event should be delivered after unmasking");

  console.log("Autotest OK: event semantics match KolibriOS persistence and mask behavior.");
  process.exit(0);
} catch (err) {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
}

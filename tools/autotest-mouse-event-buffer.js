const fs = require("fs");
const path = require("path");
const { loadKosRuntime } = require("./ui-harness");

const defaultPath = path.resolve(
  __dirname,
  "../../upstream-kolibrios/programs/demos/bcdclk/trunk/bcdclk.kex"
);

const target = process.argv[2] ? path.resolve(process.argv[2]) : defaultPath;
if (!fs.existsSync(target)) {
  console.error("Mouse event buffer test image not found.");
  console.error("Usage: node tools/autotest-mouse-event-buffer.js <path-to-kex>");
  console.error(`Default path tried: ${defaultPath}`);
  process.exit(1);
}

const { Emulator, parseKex, createHeadlessSurface } = loadKosRuntime();

const REG = {
  EAX: 0,
  EBX: 3
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

function readMouse(sub) {
  setReg(REG.EBX, sub >>> 0);
  emulator.sysMouse();
  return getEax();
}

function clearMouseState() {
  emulator.eventQueue.length = 0;
  emulator.mouseButtons = 0;
  emulator.mouseEventFlags = 0;
  emulator.mouseScrollX = 0;
  emulator.mouseScrollY = 0;
  emulator.mouseInside = false;
  emulator.mouseEventBuffer.length = 0;
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

  clearMouseState();
  emulator.eventMask = 0x27;
  emulator.setMouseState(10, 10, 1, true, 1, 0, 0, 0, false, 10, 10);
  emulator.setMouseState(30, 10, 1, true, 0, 0, 0, 0, true, 30, 10);
  emulator.setMouseState(30, 10, 0, true, 0, 1, 0, 0, false, 30, 10);

  assertEq(checkEvent(), 6, "mouse press should be reported first");
  assertEq(readMouse(1), ((10 << 16) | 10) >>> 0, "first mouse position should preserve the press point");
  assertEq(readMouse(2), 1, "first mouse state should keep left button pressed");
  assertEq(readMouse(3), 0x00000101, "first mouse state should expose left press flags");

  assertEq(checkEvent(), 6, "mouse move should stay queued after press");
  assertEq(readMouse(1), ((30 << 16) | 10) >>> 0, "second mouse position should preserve the move point");
  assertEq(readMouse(2), 1, "second mouse state should keep left button pressed");
  assertEq(readMouse(3), 0x00000001, "second mouse state should expose move with held button");

  assertEq(checkEvent(), 6, "mouse release should stay queued after move");
  assertEq(readMouse(1), ((30 << 16) | 10) >>> 0, "third mouse position should preserve the release point");
  assertEq(readMouse(2), 0, "third mouse state should release the left button");
  assertEq(readMouse(3), 0x00010000, "third mouse state should expose left release flags");

  assertEq(checkEvent(), 0, "mouse queue should drain after buffered sequence");

  console.log("Autotest OK: buffered mouse events preserve press, move, and release ordering.");
  process.exit(0);
} catch (err) {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
}

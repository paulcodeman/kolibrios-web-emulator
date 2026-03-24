const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REG = {
  EAX: 0,
  ECX: 1,
  EDX: 2,
  EBX: 3,
  ESP: 4,
  EBP: 5,
  ESI: 6,
  EDI: 7
};

const RUNTIME_SCRIPTS = [
  "../src/boot.js",
  "../src/core/utils.js",
  "../src/core/loader.js",
  "../src/gfx/text.js",
  "../src/gfx/kolibri-font-assets.js",
  "../src/gfx/kolibri-font.js",
  "../src/gfx/kolibri-skin-assets.js",
  "../src/gfx/kolibri-skin.js",
  "../src/gfx/surface.js",
  "../src/emulator/core-access.js",
  "../src/emulator/host-libs/registry.js",
  "../src/emulator/host-libs/http.obj.js",
  "../src/emulator/host-libs/cnv_png.obj.js",
  "../src/emulator/host-libs/libimg.obj.js",
  "../src/emulator/host-libs/libini.obj.js",
  "../src/emulator/host-libs/runtime.js",
  "../src/emulator/emulator-host.js",
  "../src/emulator/core-runtime.js",
  "../src/emulator/core-execute.js",
  "../src/emulator/emulator-syscalls.js",
  "../src/emulator/emulator.js",
  "../src/app.js"
];

function loadRuntime() {
  for (const rel of RUNTIME_SCRIPTS) {
    const filePath = path.resolve(__dirname, rel);
    const code = fs.readFileSync(filePath, "utf8");
    vm.runInThisContext(code, { filename: rel });
  }
  return global.KosEmu;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createSyntheticEmulator() {
  const runtime = loadRuntime();
  const emulator = new runtime.Emulator(runtime.createHeadlessSurface(64, 64), () => {});
  const mem = new Uint8Array(2 * 1024 * 1024);
  emulator.cpu = {
    regs: new Uint32Array(10),
    mem,
    view: new DataView(mem.buffer)
  };
  emulator.memLimit = mem.length >>> 0;
  return emulator;
}

function writeSockaddr(emu, ptr, port, addr) {
  emu.writeMem16(ptr >>> 0, 2);
  emu.writeMem8((ptr + 2) >>> 0, (port >>> 8) & 0xff);
  emu.writeMem8((ptr + 3) >>> 0, port & 0xff);
  emu.writeMem8((ptr + 4) >>> 0, (addr >>> 24) & 0xff);
  emu.writeMem8((ptr + 5) >>> 0, (addr >>> 16) & 0xff);
  emu.writeMem8((ptr + 6) >>> 0, (addr >>> 8) & 0xff);
  emu.writeMem8((ptr + 7) >>> 0, addr & 0xff);
  for (let i = 8; i < 16; i += 1) {
    emu.writeMem8((ptr + i) >>> 0, 0);
  }
}

function syscall75(emu, sub, ecx = 0, edx = 0, esi = 0, edi = 0) {
  emu.writeReg(REG.EAX, 75);
  emu.writeReg(REG.EBX, sub >>> 0);
  emu.writeReg(REG.ECX, ecx >>> 0);
  emu.writeReg(REG.EDX, edx >>> 0);
  emu.writeReg(REG.ESI, esi >>> 0);
  emu.writeReg(REG.EDI, edi >>> 0);
  emu.sysNetworkSocket();
  return {
    eax: emu.readReg(REG.EAX) >>> 0,
    ebx: emu.readReg(REG.EBX) >>> 0
  };
}

function syscall76(emu, ebx, ecx = 0, esi = 0, edi = 0) {
  emu.writeReg(REG.EAX, 76);
  emu.writeReg(REG.EBX, ebx >>> 0);
  emu.writeReg(REG.ECX, ecx >>> 0);
  emu.writeReg(REG.ESI, esi >>> 0);
  emu.writeReg(REG.EDI, edi >>> 0);
  emu.sysNetworkProtocol();
  return {
    eax: emu.readReg(REG.EAX) >>> 0,
    ebx: emu.readReg(REG.EBX) >>> 0
  };
}

function main() {
  const emu = createSyntheticEmulator();

  const listenSock = syscall75(emu, 0, 2, 1, 0).eax >>> 0;
  writeSockaddr(emu, 0x1000, 1234, 0x7f000001);
  let result = syscall75(emu, 2, listenSock, 0x1000, 16);
  assert(result.eax === 0 && result.ebx === 0, "TCP bind failed");
  result = syscall75(emu, 3, listenSock, 2);
  assert(result.eax === 0 && result.ebx === 0, "TCP listen failed");

  const clientSock = syscall75(emu, 0, 2, 1, 0).eax >>> 0;
  result = syscall75(emu, 4, clientSock, 0x1000, 16);
  assert(result.eax === 0 && result.ebx === 0, "TCP connect failed");
  result = syscall75(emu, 5, listenSock, 0x1100, 16);
  assert(result.eax !== 0xffffffff && result.ebx === 0, "TCP accept failed");
  const acceptedSock = result.eax >>> 0;

  emu.writeMemBlock(0x1200, Buffer.from("hello"));
  result = syscall75(emu, 6, clientSock, 0x1200, 5, 0);
  assert(result.eax === 5, "TCP send failed");
  result = syscall75(emu, 7, acceptedSock, 0x1300, 16, 0x02);
  assert(result.eax === 5, "TCP peek receive failed");
  result = syscall75(emu, 7, acceptedSock, 0x1300, 16, 0);
  assert(result.eax === 5, "TCP receive failed");
  assert(Buffer.from(emu.readMemBlock(0x1300, 5)).toString("latin1") === "hello", "TCP payload mismatch");

  const udpSender = syscall75(emu, 0, 2, 2, 0).eax >>> 0;
  const udpReceiver = syscall75(emu, 0, 2, 2, 0).eax >>> 0;
  writeSockaddr(emu, 0x1400, 5555, 0);
  result = syscall75(emu, 2, udpReceiver, 0x1400, 16);
  assert(result.eax === 0, "UDP bind failed");
  writeSockaddr(emu, 0x1410, 5555, 0x7f000001);
  result = syscall75(emu, 4, udpSender, 0x1410, 16);
  assert(result.eax === 0, "UDP connect failed");
  emu.writeMemBlock(0x1420, Buffer.from("udp"));
  result = syscall75(emu, 6, udpSender, 0x1420, 3, 0);
  assert(result.eax === 3, "UDP send failed");
  result = syscall75(emu, 7, udpReceiver, 0x1430, 8, 0);
  assert(result.eax === 3, "UDP receive failed");
  assert(Buffer.from(emu.readMemBlock(0x1430, 3)).toString("latin1") === "udp", "UDP payload mismatch");

  emu.writeMem32(0x1500, 0xffff);
  emu.writeMem32(0x1504, 1 << 31);
  emu.writeMem32(0x1508, 4);
  emu.writeMem32(0x150c, 1);
  result = syscall75(emu, 8, clientSock, 0x1500);
  assert(result.eax === 0, "setsockopt SO_NONBLOCK failed");

  emu.writeMem32(0x1510, 0xffff);
  emu.writeMem32(0x1514, 1 << 31);
  emu.writeMem32(0x1518, 4);
  emu.writeMem32(0x151c, 0);
  result = syscall75(emu, 9, clientSock, 0x1510);
  assert(result.eax === 0, "getsockopt SO_NONBLOCK failed");
  assert(emu.readMem32(0x151c) === 1, "getsockopt SO_NONBLOCK value mismatch");

  const arpEntryPtr = 0x1600;
  emu.writeMem32(arpEntryPtr, 0xc0a80001);
  for (let i = 0; i < 6; i += 1) {
    emu.writeMem8((arpEntryPtr + 4 + i) >>> 0, (i + 1) & 0xff);
  }
  emu.writeMem16((arpEntryPtr + 10) >>> 0, 1);
  emu.writeMem16((arpEntryPtr + 12) >>> 0, 60);
  result = syscall76(emu, 0x50004 | (1 << 8), 0, arpEntryPtr, 0);
  assert(result.eax === 0, "ARP add failed");
  result = syscall76(emu, 0x50002 | (1 << 8));
  assert(result.eax === 1, "ARP count failed");
  result = syscall76(emu, 0x50003 | (1 << 8), 0, 0, 0x1610);
  assert(result.eax === 0, "ARP read failed");
  assert(emu.readMem32(0x1610) === 0xc0a80001, "ARP entry IP mismatch");
  result = syscall76(emu, 0x50005 | (1 << 8), 0xffffffff);
  assert(result.eax === 0, "ARP clear failed");

  console.log("Autotest OK: synthetic network syscall smoke.");
}

main();

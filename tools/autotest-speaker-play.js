const { HeadlessUiHarness, loadKosRuntime } = require("./ui-harness");

const { Emulator, createHeadlessSurface } = loadKosRuntime();

const REG_EAX = 0;
const REG_EBX = 3;
const REG_ESI = 6;
const REG_EFLAGS = 9;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEq(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertApprox(actual, expected, epsilon, message) {
  if (Math.abs(actual - expected) > epsilon) {
    throw new Error(`${message}: expected ${expected} +/- ${epsilon}, got ${actual}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms | 0)));
}

function createSpeakerEmulator(hostSession) {
  const surface = createHeadlessSurface(32, 32);
  const emulator = new Emulator(surface, () => {});
  const mem = new Uint8Array(0x10000);
  const regs = new Uint32Array(10);
  const xmm = new Uint32Array(32);
  regs[REG_EFLAGS] = 0x202;
  emulator.cpu = {
    mem,
    view: new DataView(mem.buffer),
    regs,
    fpu: new Float64Array(8),
    fpuSize: 0,
    fpuStatusWord: 0,
    mmx: new Uint32Array(16),
    xmm,
    xmmF: new Float32Array(xmm.buffer),
    memFaultLogged: false
  };
  emulator.memLimit = mem.length >>> 0;
  emulator.processReservedSize = mem.length >>> 0;
  emulator.hostSession = hostSession || null;
  emulator.processId = 17;
  emulator.threadSlot = 5;
  return { emulator, regs, mem };
}

function invokeSpeakerPlay(emulator, regs, ptr) {
  regs[REG_EBX] = 55;
  regs[REG_ESI] = ptr >>> 0;
  emulator.sysSpeakerPlay();
  return regs[REG_EAX] >>> 0;
}

async function main() {
  {
    let captured = null;
    const hostSession = {
      getSpeakerDisabled() {
        return false;
      },
      playSpeakerSequence(request) {
        captured = request;
        return 0;
      }
    };
    const { emulator, regs, mem } = createSpeakerEmulator(hostSession);
    const ptr = 0x100;
    mem.set([0x90, 0x21, 0x00], ptr);

    const result = invokeSpeakerPlay(emulator, regs, ptr);

    assertEq(result, 0, "speaker play should succeed for a valid note buffer");
    assert(captured, "host session should receive parsed speaker request");
    assertEq(captured.ownerPid >>> 0, 17, "speaker request should carry owner pid");
    assertEq(captured.ownerSlot >>> 0, 5, "speaker request should carry owner slot");
    assertEq(captured.totalDurationMs >>> 0, 150, "PIANO note should decode to 150 ms");
    assertEq(captured.items.length, 1, "single note buffer should decode to one item");
    assertEq(captured.items[0].kind, "tone", "PIANO note should decode as tone");
    assertEq(captured.items[0].durationMs >>> 0, 150, "decoded note duration should match control byte");
    assertApprox(captured.items[0].frequencyHz, 261.66, 1.5, "decoded note frequency should match note code 0x21");
  }

  {
    const harness = new HeadlessUiHarness();
    const { emulator, regs, mem } = createSpeakerEmulator(harness);
    const ptr = 0x180;
    mem.set([0x90, 0x21, 0x00], ptr);

    assertEq(invokeSpeakerPlay(emulator, regs, ptr), 0, "first speaker play should start");
    assertEq(invokeSpeakerPlay(emulator, regs, ptr), 55, "speaker should report busy while note is active");
    assertEq(harness.getSpeakerPlaybackInfo().busy, true, "harness should expose busy playback state");

    await sleep(190);

    assertEq(harness.getSpeakerPlaybackInfo().busy, false, "busy state should clear after note duration");
    assertEq(invokeSpeakerPlay(emulator, regs, ptr), 0, "speaker should accept a new note after playback ends");
    assertEq(harness.getSpeakerPlaybackInfo().playCount >>> 0, 2, "successful plays should increment play counter");
    harness.close();
  }

  {
    const harness = new HeadlessUiHarness();
    const { emulator, regs, mem } = createSpeakerEmulator(harness);
    const ptr = 0x1c0;
    mem.set([0x90, 0x21, 0x00], ptr);

    harness.setSpeakerDisabled(true);
    assertEq(invokeSpeakerPlay(emulator, regs, ptr), 55, "disabled speaker should reject play requests");
    assertEq(harness.getSpeakerPlaybackInfo().playCount >>> 0, 0, "rejected plays should not increment play counter");
    harness.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});

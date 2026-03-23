const path = require("path");
const { HeadlessUiHarness, readTargetImage, buildExternalAppProcessPath } = require("./ui-harness");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEq(actual, expected, message) {
  if ((actual >>> 0) !== (expected >>> 0)) {
    throw new Error(`${message}: expected ${expected >>> 0}, got ${actual >>> 0}`);
  }
}

async function main() {
  const target = path.resolve(process.argv[2] || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root\\SHELL");
  const harness = new HeadlessUiHarness({
    launchDelayMs: 180,
    defaultTimeoutMs: 12000
  });

  try {
    await harness.launch(target);
    const first = harness.getActiveProcess();
    assert(first && first.emulator, "Initial process failed to launch.");

    harness.setSystemButtonStyle(0);
    assertEq(first.emulator.buttonStyle, 0, "Active process should receive the session button style");

    const skinResult = harness.setSystemSkinPath("/SYS/DEFAULT.SKN", first.emulator);
    assertEq(skinResult, 0, "setSystemSkinPath should accept the default skin");
    assert(String(first.emulator.skinPath || "").toUpperCase() === "/SYS/DEFAULT.SKN", "Active process should keep the session skin path");

    const colorTable = first.emulator.getSkinColorTableBytes().slice();
    colorTable[0] = ((colorTable[0] ^ 0x5a) & 0xff) >>> 0;
    harness.setSystemSkinColorTable(colorTable);
    assertEq(first.emulator.getSkinColorTableBytes()[0], colorTable[0], "Active process should receive the session color table");

    const second = harness.createProcess({
      image: readTargetImage(target),
      fileName: path.basename(target),
      targetPath: target,
      processPath: buildExternalAppProcessPath(target),
      displayPath: `${buildExternalAppProcessPath(target)}#2`,
      processArgs: "",
      pid: harness.nextPid++,
      slot: harness.nextSlot++,
      groupLeaderPid: 0,
      threadGroupId: 0,
      initialX: 32,
      initialY: 32
    });
    assert(second && second.emulator, "Second process failed to launch.");

    assertEq(second.emulator.buttonStyle, 0, "New process should inherit the session button style");
    assertEq(second.emulator.getSkinColorTableBytes()[0], colorTable[0], "New process should inherit the session color table");
    assert(
      String(second.emulator.skinPath || "").toUpperCase() === "/SYS/DEFAULT.SKN",
      "New process should inherit the session skin path"
    );

    console.log(
      `Autotest OK: session-wide style state applies to existing and new windows ` +
      `buttonStyle=${second.emulator.buttonStyle} color0=${second.emulator.getSkinColorTableBytes()[0]}`
    );
  } finally {
    harness.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(2);
});

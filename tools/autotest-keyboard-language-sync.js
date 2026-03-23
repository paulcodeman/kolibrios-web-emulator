const { loadKosRuntime } = require("./ui-harness");

function assertEqual(actual, expected, message) {
  if ((actual >>> 0) !== (expected >>> 0)) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function main() {
  const runtime = loadKosRuntime();
  const keyboard = runtime && runtime.ui ? runtime.ui.keyboard : null;
  if (!keyboard) {
    throw new Error("Keyboard helpers are unavailable.");
  }

  assertEqual(keyboard.inferKeyboardLanguageIdFromText("a"), 1, "Latin key should map to EN");
  assertEqual(keyboard.inferKeyboardLanguageIdFromText("ф"), 4, "Cyrillic key should map to RU");
  assertEqual(keyboard.inferKeyboardLanguageIdFromText("і"), 7, "Ukrainian key should map to UA");
  assertEqual(keyboard.inferKeyboardLanguageIdFromText("ў"), 9, "Belarusian key should map to BE");

  assertEqual(
    keyboard.inferKeyboardLanguageIdFromLayoutMap(new Map([
      ["KeyQ", "q"],
      ["KeyA", "a"],
      ["KeyY", "y"],
      ["KeyZ", "z"]
    ])),
    1,
    "QWERTY layout should map to EN"
  );
  assertEqual(
    keyboard.inferKeyboardLanguageIdFromLayoutMap(new Map([
      ["KeyQ", "a"],
      ["KeyA", "q"],
      ["KeyY", "y"],
      ["KeyZ", "z"]
    ])),
    5,
    "AZERTY layout should map to FR"
  );
  assertEqual(
    keyboard.inferKeyboardLanguageIdFromLayoutMap(new Map([
      ["KeyQ", "q"],
      ["KeyA", "a"],
      ["KeyY", "z"],
      ["KeyZ", "y"]
    ])),
    3,
    "QWERTZ layout should map to GE"
  );
  assertEqual(
    keyboard.inferKeyboardLanguageIdFromLayoutMap(new Map([
      ["KeyQ", "й"],
      ["KeyA", "ф"],
      ["KeyY", "н"],
      ["KeyZ", "я"]
    ])),
    4,
    "Cyrillic layout should map to RU"
  );

  const ruLayouts = keyboard.buildKeyboardLayoutsFromLayoutMap(new Map([
    ["KeyQ", "й"],
    ["KeyW", "ц"],
    ["KeyE", "у"],
    ["KeyR", "к"],
    ["KeyT", "е"],
    ["KeyA", "ф"],
    ["KeyS", "ы"],
    ["KeyD", "в"],
    ["KeyF", "а"],
    ["KeyZ", "я"],
    ["KeyX", "ч"],
    ["KeyC", "с"]
  ]), 4);
  assertEqual(ruLayouts.normal[0x1e], 228, "RU normal KeyA should map to cp866 'ф'");
  assertEqual(ruLayouts.shift[0x1e], 148, "RU shift KeyA should map to cp866 'Ф'");

  console.log("Autotest OK: keyboard language inference helpers.");
}

try {
  main();
} catch (err) {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(2);
}

const { loadKosRuntime } = require("./ui-harness");

function decodeCp866Glyphs(glyphs, cp866CodePoints) {
  let out = "";
  for (let i = 0; i < glyphs.length; i += 1) {
    const value = glyphs[i] & 0xff;
    const codePoint = cp866CodePoints[value] !== undefined ? (cp866CodePoints[value] >>> 0) : value;
    out += String.fromCodePoint(codePoint);
  }
  return out;
}

function createDomKeyEvent(key, code) {
  return {
    key,
    code,
    getModifierState() {
      return false;
    }
  };
}

function assertKeyboardCase(keyboard, key, code, expectedAscii, expectedScan) {
  const translated = keyboard.translateDomKeyboardEvent(createDomKeyEvent(key, code));
  if (!translated) {
    throw new Error(`Keyboard translation dropped '${key}' (${code}).`);
  }
  if ((translated.asciiCode & 0xff) !== (expectedAscii & 0xff)) {
    throw new Error(
      `Keyboard translation for '${key}' (${code}) returned ascii=0x${(translated.asciiCode & 0xff).toString(16)} ` +
      `instead of 0x${(expectedAscii & 0xff).toString(16)}.`
    );
  }
  if ((translated.scanCode & 0xff) !== (expectedScan & 0xff)) {
    throw new Error(
      `Keyboard translation for '${key}' (${code}) returned scan=0x${(translated.scanCode & 0xff).toString(16)} ` +
      `instead of 0x${(expectedScan & 0xff).toString(16)}.`
    );
  }
}

function main() {
  const runtime = loadKosRuntime();
  const keyboard = runtime.ui && runtime.ui.keyboard;
  const kolibriText = runtime.gfx && runtime.gfx.kolibriText;
  const assets = runtime.gfx && runtime.gfx.kolibriFontAssets;
  if (!keyboard || typeof keyboard.translateDomKeyboardEvent !== "function") {
    throw new Error("Browser keyboard helpers are unavailable.");
  }
  if (!kolibriText || typeof kolibriText.getTextInfoFromString !== "function") {
    throw new Error("Kolibri text helpers are unavailable.");
  }
  if (!assets || !Array.isArray(assets.cp866CodePoints)) {
    throw new Error("CP866 font table is unavailable.");
  }

  assertKeyboardCase(keyboard, "ф", "KeyA", 0xe4, 0x1e);
  assertKeyboardCase(keyboard, "Ё", "Backquote", 0xf0, 0x29);
  assertKeyboardCase(keyboard, "я", "KeyZ", 0xef, 0x2c);
  assertKeyboardCase(keyboard, "A", "KeyA", 0x41, 0x1e);

  const title = "Пример программы";
  const textInfo = kolibriText.getTextInfoFromString(title, 1);
  const decoded = decodeCp866Glyphs(textInfo.glyphs || [], assets.cp866CodePoints);
  if (decoded !== title) {
    throw new Error(`CP866 round-trip failed: '${decoded}' != '${title}'.`);
  }

  console.log("Autotest OK: CP866 keyboard input and title encoding round-trip work.");
}

main();

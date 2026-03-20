(() => {
  const KosEmu = globalThis.KosEmu;
  const assets = KosEmu.gfx.kolibriFontAssets;
  if (!assets) {
    throw new Error("kolibri-font-assets.js must be loaded before kolibri-font.js");
  }

  let charMt = null;
  let charUni = null;
  let cp866Map = null;
  let cp866ReverseMap = null;

  function decodeBase64(base64) {
    if (typeof Buffer !== "undefined") {
      return new Uint8Array(Buffer.from(base64, "base64"));
    }
    if (typeof atob === "function") {
      const raw = atob(base64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) {
        bytes[i] = raw.charCodeAt(i) & 0xff;
      }
      return bytes;
    }
    throw new Error("No base64 decoder available.");
  }

  function ensureAssets() {
    if (!charMt) {
      charMt = decodeBase64(assets.charMtBase64 || "");
      charUni = decodeBase64(assets.charUniBase64 || "");
      cp866Map = assets.cp866CodePoints || [];
      cp866ReverseMap = null;
    }
  }

  function getCp866ReverseMap() {
    ensureAssets();
    if (!cp866ReverseMap) {
      cp866ReverseMap = new Map();
      for (let i = 0; i < cp866Map.length; i += 1) {
        const codePoint = cp866Map[i] >>> 0;
        if (!cp866ReverseMap.has(codePoint)) {
          cp866ReverseMap.set(codePoint, i & 0xff);
        }
      }
    }
    return cp866ReverseMap;
  }

  function encodeCp866CodePoint(codePoint) {
    const value = codePoint >>> 0;
    if (value <= 0x7f) {
      return value & 0xff;
    }
    const reverse = getCp866ReverseMap();
    if (reverse.has(value)) {
      return reverse.get(value) & 0xff;
    }
    if (value <= 0xff) {
      return value & 0xff;
    }
    return 0;
  }

  function decodeCp866(bytes, zeroTerm, maxChars, unicodeMode) {
    ensureAssets();
    const glyphs = [];
    const limit = Math.max(0, maxChars | 0);
    for (let i = 0; i < bytes.length && glyphs.length < limit; i += 1) {
      const value = bytes[i] & 0xff;
      if (zeroTerm && value === 0) {
        break;
      }
      glyphs.push(unicodeMode ? (cp866Map[value] >>> 0) : value);
    }
    return glyphs;
  }

  function decodeUtf16Le(bytes, zeroTerm, maxChars) {
    const glyphs = [];
    const limit = Math.max(0, maxChars | 0);
    for (let i = 0; i + 1 < bytes.length && glyphs.length < limit; i += 2) {
      const value = (bytes[i] | (bytes[i + 1] << 8)) >>> 0;
      if (zeroTerm && value === 0) {
        break;
      }
      glyphs.push(value >>> 0);
    }
    return glyphs;
  }

  function decodeUtf8(bytes, zeroTerm, maxChars) {
    const glyphs = [];
    const limit = Math.max(0, maxChars | 0);
    let pos = 0;
    while (pos < bytes.length && glyphs.length < limit) {
      const b0 = bytes[pos] & 0xff;
      if (zeroTerm && b0 === 0) {
        break;
      }
      if (b0 < 0x80) {
        glyphs.push(b0);
        pos += 1;
        continue;
      }
      if ((b0 & 0xe0) === 0xc0 && pos + 1 < bytes.length) {
        const b1 = bytes[pos + 1] & 0x3f;
        glyphs.push((((b0 & 0x1f) << 6) | b1) >>> 0);
        pos += 2;
        continue;
      }
      if ((b0 & 0xf0) === 0xe0 && pos + 2 < bytes.length) {
        const b1 = bytes[pos + 1] & 0x3f;
        const b2 = bytes[pos + 2] & 0x3f;
        glyphs.push((((b0 & 0x0f) << 12) | (b1 << 6) | b2) >>> 0);
        pos += 3;
        continue;
      }
      if ((b0 & 0xf8) === 0xf0 && pos + 3 < bytes.length) {
        const b1 = bytes[pos + 1] & 0x3f;
        const b2 = bytes[pos + 2] & 0x3f;
        const b3 = bytes[pos + 3] & 0x3f;
        glyphs.push((((b0 & 0x07) << 18) | (b1 << 12) | (b2 << 6) | b3) >>> 0);
        pos += 4;
        continue;
      }
      glyphs.push(0);
      pos += 1;
    }
    return glyphs;
  }

  function getTextInfo(bytes, zeroTerm, maxChars, fontMode) {
    const mode = fontMode & 3;
    if (mode === 0) {
      return {
        mode,
        glyphs: decodeCp866(bytes, zeroTerm, maxChars, false),
        cellWidth: 6,
        cellHeight: 9
      };
    }
    if (mode === 1) {
      return {
        mode,
        glyphs: decodeCp866(bytes, zeroTerm, maxChars, true),
        cellWidth: 8,
        cellHeight: 16
      };
    }
    if (mode === 2) {
      return {
        mode,
        glyphs: decodeUtf16Le(bytes, zeroTerm, maxChars),
        cellWidth: 8,
        cellHeight: 16
      };
    }
    return {
      mode,
      glyphs: decodeUtf8(bytes, zeroTerm, maxChars),
      cellWidth: 8,
      cellHeight: 16
    };
  }

  function getTextInfoFromString(text, fontMode) {
    const mode = fontMode & 3;
    const glyphs = [];
    const source = String(text || "");
    if (mode === 0 || mode === 1) {
      for (const ch of source) {
        const codePoint = ch.codePointAt(0) >>> 0;
        const encoded = encodeCp866CodePoint(codePoint);
        glyphs.push(encoded !== 0 || codePoint === 0 ? encoded : 0x3f);
      }
    } else {
      for (const ch of source) {
        glyphs.push(ch.codePointAt(0) >>> 0);
      }
    }
    return {
      mode,
      glyphs,
      cellWidth: mode === 0 ? 6 : 8,
      cellHeight: mode === 0 ? 9 : 16
    };
  }

  function measureKolibriText(textInfo, scale) {
    const mul = Math.max(1, scale | 0);
    return {
      width: (textInfo.glyphs.length * textInfo.cellWidth * mul) >>> 0,
      height: (textInfo.cellHeight * mul) >>> 0
    };
  }

  function getGlyphRows(mode, glyph) {
    ensureAssets();
    if (mode === 0) {
      const index = (glyph & 0xff) * 9;
      return charMt.subarray(index, index + 9);
    }
    const total = Math.floor(charUni.length / 16);
    const clamped = glyph >= 0 && glyph < total ? glyph : 0;
    const index = clamped * 16;
    return charUni.subarray(index, index + 16);
  }

  function drawGlyph(surface, x, y, color, rows, width, scale) {
    const mul = Math.max(1, scale | 0);
    for (let row = 0; row < rows.length; row += 1) {
      const bits = rows[row] & 0xff;
      for (let col = 0; col < width; col += 1) {
        if (((bits >>> col) & 1) === 0) {
          continue;
        }
        const px = x + col * mul;
        const py = y + row * mul;
        for (let dy = 0; dy < mul; dy += 1) {
          for (let dx = 0; dx < mul; dx += 1) {
            surface.setPixel(px + dx, py + dy, color);
          }
        }
      }
    }
  }

  function drawKolibriText(surface, x, y, color, textInfo, scale) {
    const mul = Math.max(1, scale | 0);
    let cursorX = x | 0;
    for (let i = 0; i < textInfo.glyphs.length; i += 1) {
      const glyph = textInfo.glyphs[i] >>> 0;
      const rows = getGlyphRows(textInfo.mode, glyph);
      drawGlyph(surface, cursorX, y | 0, color, rows, textInfo.cellWidth, mul);
      cursorX += textInfo.cellWidth * mul;
    }
  }

  KosEmu.gfx.kolibriText = {
    getTextInfo,
    getTextInfoFromString,
    encodeCp866CodePoint,
    measureKolibriText,
    drawKolibriText
  };
})();

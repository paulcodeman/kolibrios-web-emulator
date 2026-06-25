(() => {
  const KosEmu = globalThis.KosEmu;
  const emu = KosEmu && KosEmu.emu ? KosEmu.emu : null;
  if (!emu || typeof emu.registerHostDllOverride !== "function") {
    return;
  }

  function getHostLibHelpers() {
    return emu && emu.hostLibHelpers ? emu.hostLibHelpers : null;
  }

  function decodeWithHostPng(bytes) {
    const helpers = getHostLibHelpers();
    const decodePngToBgra = helpers && typeof helpers.decodePngToBgra === "function"
      ? helpers.decodePngToBgra
      : null;
    return decodePngToBgra && bytes ? decodePngToBgra(bytes) : null;
  }

  function canUseHostDecodedImage(decoded) {
    if (!decoded) {
      return false;
    }
    const colorType = decoded.colorType >>> 0;
    return colorType === 2 || colorType === 6;
  }

  function buildLibimgOverrides() {
    return [
      {
        name: "img_from_file",
        argBytes: 4,
        handler(context) {
          const pathPtr = this.readMem32(context.argPtr) >>> 0;
          const path = pathPtr ? this.readCString(pathPtr, 4096) : "";
          if (!path) {
            return this.continueAtOriginalDllExport(context);
          }
          const fileBytes = this.maybeUnpackHostFile(this.loadHostFile(path), path);
          const decoded = decodeWithHostPng(fileBytes);
          if (!canUseHostDecodedImage(decoded)) {
            return this.continueAtOriginalDllExport(context);
          }
          if (this.traceSyscalls) {
            const first = decoded.pixels.length >= 4
              ? `${decoded.pixels[0]},${decoded.pixels[1]},${decoded.pixels[2]},${decoded.pixels[3]}`
              : "empty";
            this.log(`host img_from_file '${path}' -> ${decoded.width}x${decoded.height} first=${first}`);
          }
          return {
            eax: this.allocateHostLibimgImage(decoded.width | 0, decoded.height | 0, decoded.pixels) >>> 0
          };
        }
      },
      {
        name: "img_decode",
        argBytes: 12,
        handler(context) {
          const dataPtr = this.readMem32(context.argPtr) >>> 0;
          const dataLen = this.readMem32((context.argPtr + 4) >>> 0) >>> 0;
          const bytes = dataPtr && dataLen ? this.readMemBlock(dataPtr, dataLen) : null;
          const decoded = decodeWithHostPng(bytes);
          if (!canUseHostDecodedImage(decoded)) {
            return this.continueAtOriginalDllExport(context);
          }
          return {
            eax: this.allocateHostLibimgImage(decoded.width | 0, decoded.height | 0, decoded.pixels) >>> 0
          };
        }
      },
      {
        name: "img_to_rgb2",
        argBytes: 8,
        handler(context) {
          const imagePtr = this.readMem32(context.argPtr) >>> 0;
          const outPtr = this.readMem32((context.argPtr + 4) >>> 0) >>> 0;
          const meta = this.hostLibimgImages instanceof Map ? (this.hostLibimgImages.get(imagePtr) || null) : null;
          if (!meta || !outPtr || (meta.type >>> 0) !== 3) {
            return this.continueAtOriginalDllExport(context);
          }
          const pixels = this.readMemBlock(meta.dataPtr >>> 0, meta.byteLength >>> 0);
          if (!(pixels instanceof Uint8Array) || pixels.length !== (meta.byteLength >>> 0)) {
            return { eax: 0 };
          }
          const bgr = new Uint8Array(((meta.width >>> 0) * (meta.height >>> 0) * 3) >>> 0);
          for (let src = 0, dst = 0; (src + 3) < pixels.length && (dst + 2) < bgr.length; src += 4, dst += 3) {
            bgr[dst] = pixels[src] & 0xff;
            bgr[dst + 1] = pixels[src + 1] & 0xff;
            bgr[dst + 2] = pixels[src + 2] & 0xff;
          }
          this.writeMemBlock(outPtr >>> 0, bgr);
          return { eax: 1 };
        }
      },
      {
        name: "img_blend",
        argBytes: 32,
        handler(context) {
          const bottomPtr = this.readMem32(context.argPtr) >>> 0;
          const topPtr = this.readMem32((context.argPtr + 4) >>> 0) >>> 0;
          let dstX = this.readMem32((context.argPtr + 8) >>> 0) | 0;
          let dstY = this.readMem32((context.argPtr + 12) >>> 0) | 0;
          let srcX = this.readMem32((context.argPtr + 16) >>> 0) | 0;
          let srcY = this.readMem32((context.argPtr + 20) >>> 0) | 0;
          let copyWidth = this.readMem32((context.argPtr + 24) >>> 0) | 0;
          let copyHeight = this.readMem32((context.argPtr + 28) >>> 0) | 0;
          if (!bottomPtr || !topPtr || copyWidth <= 0 || copyHeight <= 0 || !this.cpu || !this.cpu.mem) {
            return this.continueAtOriginalDllExport(context);
          }
          const bottomType = this.readMem32((bottomPtr + 20) >>> 0) >>> 0;
          const topType = this.readMem32((topPtr + 20) >>> 0) >>> 0;
          if (bottomType !== 3 || topType !== 3) {
            return this.continueAtOriginalDllExport(context);
          }
          const bottomWidth = this.readMem32((bottomPtr + 4) >>> 0) | 0;
          const bottomHeight = this.readMem32((bottomPtr + 8) >>> 0) | 0;
          const topWidth = this.readMem32((topPtr + 4) >>> 0) | 0;
          const topHeight = this.readMem32((topPtr + 8) >>> 0) | 0;
          const bottomDataPtr = this.readMem32((bottomPtr + 24) >>> 0) >>> 0;
          const topDataPtr = this.readMem32((topPtr + 24) >>> 0) >>> 0;
          if (!bottomDataPtr || !topDataPtr || bottomWidth <= 0 || bottomHeight <= 0 || topWidth <= 0 || topHeight <= 0) {
            return this.continueAtOriginalDllExport(context);
          }
          if (srcX < 0) {
            copyWidth += srcX;
            dstX -= srcX;
            srcX = 0;
          }
          if (srcY < 0) {
            copyHeight += srcY;
            dstY -= srcY;
            srcY = 0;
          }
          if (dstX < 0) {
            copyWidth += dstX;
            srcX -= dstX;
            dstX = 0;
          }
          if (dstY < 0) {
            copyHeight += dstY;
            srcY -= dstY;
            dstY = 0;
          }
          if ((srcX + copyWidth) > topWidth) {
            copyWidth = topWidth - srcX;
          }
          if ((srcY + copyHeight) > topHeight) {
            copyHeight = topHeight - srcY;
          }
          if ((dstX + copyWidth) > bottomWidth) {
            copyWidth = bottomWidth - dstX;
          }
          if ((dstY + copyHeight) > bottomHeight) {
            copyHeight = bottomHeight - dstY;
          }
          if (copyWidth <= 0 || copyHeight <= 0) {
            return { eax: bottomPtr >>> 0 };
          }
          const mem = this.cpu.mem;
          const srcStride = (topWidth * 4) | 0;
          const dstStride = (bottomWidth * 4) | 0;
          const requiredSrcEnd = (topDataPtr + ((srcY + copyHeight - 1) * srcStride + (srcX + copyWidth) * 4)) >>> 0;
          const requiredDstEnd = (bottomDataPtr + ((dstY + copyHeight - 1) * dstStride + (dstX + copyWidth) * 4)) >>> 0;
          if (
            requiredSrcEnd > (this.memLimit >>> 0) ||
            requiredDstEnd > (this.memLimit >>> 0) ||
            requiredSrcEnd > (mem.length >>> 0) ||
            requiredDstEnd > (mem.length >>> 0)
          ) {
            return this.continueAtOriginalDllExport(context);
          }
          for (let y = 0; y < copyHeight; y += 1) {
            let srcRow = (topDataPtr + ((srcY + y) * srcStride) + (srcX * 4)) >>> 0;
            let dstRow = (bottomDataPtr + ((dstY + y) * dstStride) + (dstX * 4)) >>> 0;
            for (let x = 0; x < copyWidth; x += 1) {
              const sb = mem[srcRow] & 0xff;
              const sg = mem[(srcRow + 1) >>> 0] & 0xff;
              const sr = mem[(srcRow + 2) >>> 0] & 0xff;
              const sa = mem[(srcRow + 3) >>> 0] & 0xff;
              if (sa === 0) {
                srcRow = (srcRow + 4) >>> 0;
                dstRow = (dstRow + 4) >>> 0;
                continue;
              }
              if (sa === 255) {
                mem[dstRow] = sb & 0xff;
                mem[(dstRow + 1) >>> 0] = sg & 0xff;
                mem[(dstRow + 2) >>> 0] = sr & 0xff;
                mem[(dstRow + 3) >>> 0] = 0xff;
                srcRow = (srcRow + 4) >>> 0;
                dstRow = (dstRow + 4) >>> 0;
                continue;
              }
              const db = mem[dstRow] & 0xff;
              const dg = mem[(dstRow + 1) >>> 0] & 0xff;
              const dr = mem[(dstRow + 2) >>> 0] & 0xff;
              const da = mem[(dstRow + 3) >>> 0] & 0xff;
              const invSa = 255 - sa;
              const outA = sa + ((((da * invSa) + 127) / 255) | 0);
              let outB = 0;
              let outG = 0;
              let outR = 0;
              if (outA > 0) {
                const srcPartB = sb * sa;
                const srcPartG = sg * sa;
                const srcPartR = sr * sa;
                const dstFactor = ((((da * invSa) + 127) / 255) | 0);
                outB = (((srcPartB + db * dstFactor + (outA >> 1)) / outA) | 0);
                outG = (((srcPartG + dg * dstFactor + (outA >> 1)) / outA) | 0);
                outR = (((srcPartR + dr * dstFactor + (outA >> 1)) / outA) | 0);
              }
              mem[dstRow] = outB & 0xff;
              mem[(dstRow + 1) >>> 0] = outG & 0xff;
              mem[(dstRow + 2) >>> 0] = outR & 0xff;
              mem[(dstRow + 3) >>> 0] = outA & 0xff;
              srcRow = (srcRow + 4) >>> 0;
              dstRow = (dstRow + 4) >>> 0;
            }
          }
          return { eax: bottomPtr >>> 0 };
        }
      },
      {
        name: "img_destroy",
        argBytes: 4,
        handler(context) {
          const imagePtr = this.readMem32(context.argPtr) >>> 0;
          const meta = this.hostLibimgImages instanceof Map ? (this.hostLibimgImages.get(imagePtr) || null) : null;
          if (!meta) {
            return this.continueAtOriginalDllExport(context);
          }
          this.hostLibimgImages.delete(imagePtr >>> 0);
          if (meta.palettePtr) {
            this.freeHeapBlock(meta.palettePtr >>> 0);
          }
          this.freeHeapBlock(meta.dataPtr >>> 0);
          this.freeHeapBlock(imagePtr >>> 0);
          return { eax: 1 };
        }
      }
    ];
  }

  emu.registerHostDllOverride("libimg.obj", function applyLibimgHostOverrides(loaded) {
    this.applyHostDllOverrideSet(loaded, "libimg", buildLibimgOverrides());
  });
})();

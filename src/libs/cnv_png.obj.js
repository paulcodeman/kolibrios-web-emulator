(() => {
  const KosEmu = globalThis.KosEmu;
  const emu = KosEmu && KosEmu.emu ? KosEmu.emu : null;
  if (!emu || typeof emu.registerHostDllOverride !== "function") {
    return;
  }

  function getHostLibHelpers() {
    return emu && emu.hostLibHelpers ? emu.hostLibHelpers : null;
  }

  function buildCnvPngOverrides() {
    return [
      {
        name: "START",
        argBytes: 4,
        handler(context) {
          const helpers = getHostLibHelpers();
          const decodePngToBgra = helpers && typeof helpers.decodePngToBgra === "function"
            ? helpers.decodePngToBgra
            : null;
          const infoPtr = this.readMem32(context.argPtr) >>> 0;
          const filePtr = infoPtr ? (this.readMem32(infoPtr) >>> 0) : 0;
          const fileSize = infoPtr ? (this.readMem32((infoPtr + 12) >>> 0) >>> 0) : 0;
          const bytes = filePtr && fileSize ? this.readMemBlock(filePtr, fileSize) : null;
          const decoded = decodePngToBgra && bytes ? decodePngToBgra(bytes) : null;
          if (!decoded) {
            return this.continueAtOriginalDllExport(context);
          }
          const rawPtr = this.allocateHostRawImage(decoded.width | 0, decoded.height | 0, decoded.pixels);
          const errorCode = rawPtr ? 0 : 2;
          if (infoPtr) {
            this.writeMem32((infoPtr + 4) >>> 0, rawPtr >>> 0);
            this.writeMem32((infoPtr + 8) >>> 0, errorCode >>> 0);
          }
          return { eax: errorCode >>> 0 };
        }
      }
    ];
  }

  emu.registerHostDllOverride("cnv_png.obj", function applyCnvPngHostOverrides(loaded) {
    this.applyHostDllOverrideSet(loaded, "cnv_png", buildCnvPngOverrides());
  });
})();

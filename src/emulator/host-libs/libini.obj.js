(() => {
  const KosEmu = globalThis.KosEmu;
  const emu = KosEmu && KosEmu.emu ? KosEmu.emu : null;
  if (!emu || typeof emu.registerHostDllOverride !== "function") {
    return;
  }

  function getHostLibHelpers() {
    return emu && emu.hostLibHelpers ? emu.hostLibHelpers : null;
  }

  function buildLibiniOverrides() {
    return [
      {
        name: "ini_enum_sections",
        argBytes: 8,
        handler(context) {
          const filePtr = this.readMem32(context.argPtr) >>> 0;
          const callbackPtr = this.readMem32((context.argPtr + 4) >>> 0) >>> 0;
          const filePath = filePtr ? this.readCString(filePtr, 4096) : "";
          if (this.traceSyscalls) {
            this.log(`host ini_enum_sections '${filePath}' callback=0x${callbackPtr.toString(16)}`);
          }
          return this.startHostIniEnumSections(context, filePath, filePtr >>> 0, callbackPtr >>> 0);
        }
      },
      {
        name: "ini_get_str",
        argBytes: 24,
        handler(context) {
          const helpers = getHostLibHelpers();
          const findIniValue = helpers && typeof helpers.findIniValue === "function" ? helpers.findIniValue : null;
          const filePtr = this.readMem32(context.argPtr) >>> 0;
          const sectionPtr = this.readMem32((context.argPtr + 4) >>> 0) >>> 0;
          const keyPtr = this.readMem32((context.argPtr + 8) >>> 0) >>> 0;
          const bufferPtr = this.readMem32((context.argPtr + 12) >>> 0) >>> 0;
          const bufferLen = this.readMem32((context.argPtr + 16) >>> 0) >>> 0;
          const defaultPtr = this.readMem32((context.argPtr + 20) >>> 0) >>> 0;
          const filePath = filePtr ? this.readCString(filePtr, 4096) : "";
          const sectionName = sectionPtr ? this.readCString(sectionPtr, 256) : "";
          const keyName = keyPtr ? this.readCString(keyPtr, 256) : "";
          const defaultValue = defaultPtr ? this.readCString(defaultPtr, Math.max(1, Math.min(4096, bufferLen || 4096))) : "";
          const fileBytes = filePath ? this.loadHostFile(this.resolveKosPath(filePath)) : null;
          const foundValue = findIniValue ? findIniValue(fileBytes, sectionName, keyName) : null;
          const value = foundValue === null ? defaultValue : foundValue;
          if (bufferPtr && bufferLen) {
            this.writeCString(bufferPtr >>> 0, value, Math.max(1, bufferLen | 0));
          }
          if (this.traceSyscalls) {
            const state = foundValue === null ? "default" : "found";
            this.log(`host ini_get_str '${filePath}' [${sectionName}] ${keyName} -> '${value}' (${state})`);
          }
          return { eax: foundValue === null ? (0xffffffff >>> 0) : 0 };
        }
      },
      {
        name: "ini_get_int",
        argBytes: 16,
        handler(context) {
          const helpers = getHostLibHelpers();
          const findIniValue = helpers && typeof helpers.findIniValue === "function" ? helpers.findIniValue : null;
          const parseIniIntString = helpers && typeof helpers.parseIniIntString === "function"
            ? helpers.parseIniIntString
            : null;
          const filePtr = this.readMem32(context.argPtr) >>> 0;
          const sectionPtr = this.readMem32((context.argPtr + 4) >>> 0) >>> 0;
          const keyPtr = this.readMem32((context.argPtr + 8) >>> 0) >>> 0;
          const defaultValue = this.readMem32((context.argPtr + 12) >>> 0) | 0;
          const filePath = filePtr ? this.readCString(filePtr, 4096) : "";
          const sectionName = sectionPtr ? this.readCString(sectionPtr, 256) : "";
          const keyName = keyPtr ? this.readCString(keyPtr, 256) : "";
          const fileBytes = filePath ? this.loadHostFile(this.resolveKosPath(filePath)) : null;
          const foundValue = findIniValue ? findIniValue(fileBytes, sectionName, keyName) : null;
          const parsedValue = foundValue === null || !parseIniIntString ? null : parseIniIntString(foundValue);
          const result = parsedValue === null ? defaultValue : parsedValue;
          if (this.traceSyscalls) {
            const state = parsedValue === null ? "default" : "found";
            this.log(`host ini_get_int '${filePath}' [${sectionName}] ${keyName} -> ${result} (${state})`);
          }
          return { eax: result >>> 0 };
        }
      },
      {
        name: "ini_get_bool",
        argBytes: 16,
        handler(context) {
          const helpers = getHostLibHelpers();
          const findIniValue = helpers && typeof helpers.findIniValue === "function" ? helpers.findIniValue : null;
          const parseIniBoolString = helpers && typeof helpers.parseIniBoolString === "function"
            ? helpers.parseIniBoolString
            : null;
          const filePtr = this.readMem32(context.argPtr) >>> 0;
          const sectionPtr = this.readMem32((context.argPtr + 4) >>> 0) >>> 0;
          const keyPtr = this.readMem32((context.argPtr + 8) >>> 0) >>> 0;
          const defaultValue = this.readMem32((context.argPtr + 12) >>> 0) | 0;
          const filePath = filePtr ? this.readCString(filePtr, 4096) : "";
          const sectionName = sectionPtr ? this.readCString(sectionPtr, 256) : "";
          const keyName = keyPtr ? this.readCString(keyPtr, 256) : "";
          const fileBytes = filePath ? this.loadHostFile(this.resolveKosPath(filePath)) : null;
          const foundValue = findIniValue ? findIniValue(fileBytes, sectionName, keyName) : null;
          const parsedValue = foundValue === null || !parseIniBoolString ? null : parseIniBoolString(foundValue);
          const result = parsedValue === null ? defaultValue : parsedValue;
          if (this.traceSyscalls) {
            const state = parsedValue === null ? "default" : "found";
            this.log(`host ini_get_bool '${filePath}' [${sectionName}] ${keyName} -> ${result} (${state})`);
          }
          return { eax: result >>> 0 };
        }
      }
    ];
  }

  function applyLibiniOverrides(loaded) {
    this.applyHostDllOverrideSet(loaded, "libini", buildLibiniOverrides());
  }

  emu.registerHostDllOverride("libini.obj", applyLibiniOverrides);
  emu.registerHostDllOverride("libconfig.obj", applyLibiniOverrides);
})();

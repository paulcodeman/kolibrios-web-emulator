(() => {
  const KosEmu = globalThis.KosEmu;
  const emu = KosEmu && KosEmu.emu ? KosEmu.emu : null;
  if (!emu || typeof emu.registerHostDllModule !== "function") {
    return;
  }

  function buildProcLibExports() {
    return [
      {
        name: "lib_init",
        argBytes: 0,
        handler() {
          return { eax: 0 };
        }
      },
      { name: "version", value: 1 },
      { name: "Version_OpenDialog", value: 0x00010001 },
      { name: "Version_ColorDialog", value: 0x00010001 },
      {
        name: "OpenDialog_init",
        argBytes: 4,
        handler({ argPtr }) {
          const dialogPtr = this.readMem32(argPtr) >>> 0;
          if (dialogPtr) {
            this.writeMem32((dialogPtr + 0x20) >>> 0, 0);
          }
          return { eax: 0 };
        }
      },
      {
        name: "OpenDialog_start",
        argBytes: 4,
        handler({ argPtr }) {
          const dialogPtr = this.readMem32(argPtr) >>> 0;
          if (dialogPtr) {
            this.writeMem32((dialogPtr + 0x20) >>> 0, 0);
          }
          return { eax: 0 };
        }
      },
      {
        name: "OpenDialog_set_file_name",
        argBytes: 8,
        handler() {
          return { eax: 0 };
        }
      },
      {
        name: "OpenDialog_set_file_ext",
        argBytes: 8,
        handler() {
          return { eax: 0 };
        }
      },
      {
        name: "ColorDialog_init",
        argBytes: 4,
        handler() {
          return { eax: 0 };
        }
      },
      {
        name: "ColorDialog_start",
        argBytes: 4,
        handler() {
          return { eax: 0 };
        }
      }
    ];
  }

  emu.registerHostDllModule("proc_lib.obj", function createProcLibHostDll(info) {
    const resolvedPath = info && info.resolvedPath ? info.resolvedPath : "/sys/lib/proc_lib.obj";
    return {
      cacheKey: resolvedPath,
      exports: buildProcLibExports()
    };
  });
})();

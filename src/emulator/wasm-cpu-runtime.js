(() => {
  const KosEmu = globalThis.KosEmu;
  if (!KosEmu || !KosEmu.emu || typeof WebAssembly !== "object") {
    return;
  }

  const emu = KosEmu.emu;
  const cache = {
    bytes: null,
    module: null,
    instance: null,
    backend: null
  };

  function decodeBase64(base64) {
    if (typeof Buffer !== "undefined") {
      return new Uint8Array(Buffer.from(base64, "base64"));
    }
    if (typeof atob === "function") {
      const raw = atob(base64);
      const out = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) {
        out[i] = raw.charCodeAt(i) & 0xff;
      }
      return out;
    }
    throw new Error("No base64 decoder available for WASM CPU backend.");
  }

  function getAsset() {
    const asset = emu.wasmCpuAsset;
    if (!asset || typeof asset.base64 !== "string" || !asset.base64) {
      throw new Error("WASM CPU asset is missing.");
    }
    return asset;
  }

  function getBytes() {
    if (!cache.bytes) {
      cache.bytes = decodeBase64(getAsset().base64);
    }
    return cache.bytes;
  }

  function getInstance() {
    if (!cache.instance) {
      const bytes = getBytes();
      cache.module = new WebAssembly.Module(bytes);
      cache.instance = new WebAssembly.Instance(cache.module, {});
    }
    return cache.instance;
  }

  function readPackedShiftResult(exports, prefix) {
    return {
      ok: !!exports[`get_${prefix}_last_ok`]?.(),
      result: (exports[`get_${prefix}_last_result`]?.() || 0) >>> 0,
      flags: (exports[`get_${prefix}_last_flags`]?.() || 0) >>> 0
    };
  }

  function createWasmCpuBackend() {
    if (cache.backend) {
      return cache.backend;
    }
    const exports = getInstance().exports;
    if (
      typeof exports.update_logic_flags_width !== "function" ||
      typeof exports.update_add_flags !== "function" ||
      typeof exports.update_adc_flags !== "function" ||
      typeof exports.update_sub_flags !== "function" ||
      typeof exports.update_sbb_flags !== "function" ||
      typeof exports.shift_rotate_exec !== "function" ||
      typeof exports.double_shift_exec !== "function"
    ) {
      throw new Error("WASM CPU backend exports are incomplete.");
    }
    cache.backend = {
      kind: "wasm",
      apiVersion: typeof exports.api_version === "function" ? (exports.api_version() >>> 0) : 0,
      parityEven8(value) {
        return !!exports.parity_even8(value >>> 0);
      },
      updateLogicFlagsWidth(flags, result, widthBits) {
        return exports.update_logic_flags_width(flags >>> 0, result >>> 0, widthBits >>> 0) >>> 0;
      },
      updateAddFlags(flags, op1, op2, result, widthBits) {
        return exports.update_add_flags(flags >>> 0, op1 >>> 0, op2 >>> 0, result >>> 0, widthBits >>> 0) >>> 0;
      },
      updateAdcFlags(flags, op1, op2, carry, result, widthBits) {
        return exports.update_adc_flags(flags >>> 0, op1 >>> 0, op2 >>> 0, carry >>> 0, result >>> 0, widthBits >>> 0) >>> 0;
      },
      updateSubFlags(flags, op1, op2, result, widthBits) {
        return exports.update_sub_flags(flags >>> 0, op1 >>> 0, op2 >>> 0, result >>> 0, widthBits >>> 0) >>> 0;
      },
      updateSbbFlags(flags, op1, op2, carry, result, widthBits) {
        return exports.update_sbb_flags(flags >>> 0, op1 >>> 0, op2 >>> 0, carry >>> 0, result >>> 0, widthBits >>> 0) >>> 0;
      },
      shiftRotate(value, count, widthBits, mode, flags) {
        exports.shift_rotate_exec(value >>> 0, count >>> 0, widthBits >>> 0, mode >>> 0, flags >>> 0);
        return readPackedShiftResult(exports, "shift_rotate");
      },
      doubleShift(value, source, count, widthBits, leftShift, flags) {
        exports.double_shift_exec(value >>> 0, source >>> 0, count >>> 0, widthBits >>> 0, leftShift ? 1 : 0, flags >>> 0);
        return readPackedShiftResult(exports, "double_shift");
      }
    };
    return cache.backend;
  }

  emu.createWasmCpuBackend = createWasmCpuBackend;
  emu.getWasmCpuBuildInfo = function getWasmCpuBuildInfo() {
    const asset = getAsset();
    return {
      byteLength: asset.byteLength | 0,
      sha256: asset.sha256 || "",
      zigVersion: asset.zigVersion || "",
      source: asset.source || ""
    };
  };
})();

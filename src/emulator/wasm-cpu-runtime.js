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

  function readPacked64Result(exports) {
    return {
      lo: (exports.get_packed64_last_lo?.() || 0) >>> 0,
      hi: (exports.get_packed64_last_hi?.() || 0) >>> 0
    };
  }

  function readPacked128Result(exports) {
    return [
      (exports.get_packed128_last_lane?.(0) || 0) >>> 0,
      (exports.get_packed128_last_lane?.(1) || 0) >>> 0,
      (exports.get_packed128_last_lane?.(2) || 0) >>> 0,
      (exports.get_packed128_last_lane?.(3) || 0) >>> 0
    ];
  }

  function readPackedBcdResult(exports) {
    const out = new Uint8Array(10);
    for (let i = 0; i < out.length; i += 1) {
      out[i] = (exports.get_packed_bcd_last_byte?.(i >>> 0) || 0) & 0xff;
    }
    return out;
  }

  function readBitScanResult(exports) {
    return {
      zero: !!exports.get_bit_scan_last_zero?.(),
      index: (exports.get_bit_scan_last_index?.() || 0) >>> 0
    };
  }

  function readBitTestResult(exports) {
    return {
      result: (exports.get_bit_test_last_result?.() || 0) >>> 0,
      flags: (exports.get_bit_test_last_flags?.() || 0) >>> 0
    };
  }

  function readImulResult(exports) {
    return {
      result: (exports.get_imul_last_result?.() || 0) >>> 0,
      flags: (exports.get_imul_last_flags?.() || 0) >>> 0
    };
  }

  function readAluResult(exports) {
    return {
      result: (exports.get_alu_last_result?.() || 0) >>> 0,
      flags: (exports.get_alu_last_flags?.() || 0) >>> 0
    };
  }

  function readXaddResult(exports) {
    return {
      dst: (exports.get_xadd_last_dst?.() || 0) >>> 0,
      src: (exports.get_xadd_last_src?.() || 0) >>> 0,
      flags: (exports.get_xadd_last_flags?.() || 0) >>> 0
    };
  }

  function readCmpxchgResult(exports) {
    return {
      result: (exports.get_cmpxchg_last_result?.() || 0) >>> 0,
      accumulator: (exports.get_cmpxchg_last_accumulator?.() || 0) >>> 0,
      exchanged: !!exports.get_cmpxchg_last_exchanged?.(),
      flags: (exports.get_cmpxchg_last_flags?.() || 0) >>> 0
    };
  }

  function readShiftPacked64Result(exports) {
    return {
      lo: (exports.get_shift_packed64_last_lo?.() || 0) >>> 0,
      hi: (exports.get_shift_packed64_last_hi?.() || 0) >>> 0
    };
  }

  function readMulResult(exports) {
    return {
      lo: (exports.get_mul_last_lo?.() || 0) >>> 0,
      hi: (exports.get_mul_last_hi?.() || 0) >>> 0,
      flags: (exports.get_mul_last_flags?.() || 0) >>> 0
    };
  }

  function readDivResult(exports) {
    return {
      ok: !!exports.get_div_last_ok?.(),
      quotient: (exports.get_div_last_quotient?.() || 0) >>> 0,
      remainder: (exports.get_div_last_remainder?.() || 0) >>> 0
    };
  }

  function readX87SinCosResult(exports) {
    return {
      sin: Number(exports.get_x87_sincos_last_sin?.() || 0),
      cos: Number(exports.get_x87_sincos_last_cos?.() || 0)
    };
  }

  function createWasmCpuBackend() {
    if (cache.backend) {
      return cache.backend;
    }
    const exports = getInstance().exports;
    if (
      typeof exports.update_logic_flags_width !== "function" ||
      typeof exports.round_ties_to_even !== "function" ||
      typeof exports.x87_store_integer_value !== "function" ||
      typeof exports.x87_packed_bcd_to_number !== "function" ||
      typeof exports.x87_number_to_packed_bcd_exec !== "function" ||
      typeof exports.get_packed_bcd_last_byte !== "function" ||
      typeof exports.update_add_flags !== "function" ||
      typeof exports.update_adc_flags !== "function" ||
      typeof exports.update_sub_flags !== "function" ||
      typeof exports.update_sbb_flags !== "function" ||
      typeof exports.eval_jcc_condition !== "function" ||
      typeof exports.bswap32 !== "function" ||
      typeof exports.bit_scan_exec !== "function" ||
      typeof exports.get_bit_scan_last_index !== "function" ||
      typeof exports.get_bit_scan_last_zero !== "function" ||
      typeof exports.bit_test_modify_exec !== "function" ||
      typeof exports.get_bit_test_last_result !== "function" ||
      typeof exports.get_bit_test_last_flags !== "function" ||
      typeof exports.imul_signed_width_exec !== "function" ||
      typeof exports.get_imul_last_result !== "function" ||
      typeof exports.get_imul_last_flags !== "function" ||
      typeof exports.alu_binary_width_exec !== "function" ||
      typeof exports.get_alu_last_result !== "function" ||
      typeof exports.get_alu_last_flags !== "function" ||
      typeof exports.xadd_width_exec !== "function" ||
      typeof exports.get_xadd_last_dst !== "function" ||
      typeof exports.get_xadd_last_src !== "function" ||
      typeof exports.get_xadd_last_flags !== "function" ||
      typeof exports.cmpxchg_width_exec !== "function" ||
      typeof exports.get_cmpxchg_last_result !== "function" ||
      typeof exports.get_cmpxchg_last_accumulator !== "function" ||
      typeof exports.get_cmpxchg_last_flags !== "function" ||
      typeof exports.get_cmpxchg_last_exchanged !== "function" ||
      typeof exports.x87_compare_code !== "function" ||
      typeof exports.shift_packed64_exec !== "function" ||
      typeof exports.get_shift_packed64_last_lo !== "function" ||
      typeof exports.get_shift_packed64_last_hi !== "function" ||
      typeof exports.mul_full_width_exec !== "function" ||
      typeof exports.get_mul_last_lo !== "function" ||
      typeof exports.get_mul_last_hi !== "function" ||
      typeof exports.get_mul_last_flags !== "function" ||
      typeof exports.divide_full_width_exec !== "function" ||
      typeof exports.get_div_last_ok !== "function" ||
      typeof exports.get_div_last_quotient !== "function" ||
      typeof exports.get_div_last_remainder !== "function" ||
      typeof exports.x87_f2xm1 !== "function" ||
      typeof exports.x87_fyl2x !== "function" ||
      typeof exports.x87_tan !== "function" ||
      typeof exports.x87_atan2 !== "function" ||
      typeof exports.x87_sqrt !== "function" ||
      typeof exports.x87_sin !== "function" ||
      typeof exports.x87_cos !== "function" ||
      typeof exports.x87_sincos_exec !== "function" ||
      typeof exports.get_x87_sincos_last_sin !== "function" ||
      typeof exports.get_x87_sincos_last_cos !== "function" ||
      typeof exports.x87_scale !== "function" ||
      typeof exports.sse_sqrt !== "function" ||
      typeof exports.sse_reciprocal !== "function" ||
      typeof exports.sse_reciprocal_sqrt !== "function" ||
      typeof exports.sse_binary_float !== "function" ||
      typeof exports.sse_compare_code !== "function" ||
      typeof exports.sse_unary_float32x4_exec !== "function" ||
      typeof exports.sse_binary_float32x4_exec !== "function" ||
      typeof exports.sse_binary_float32_bits !== "function" ||
      typeof exports.sse_compare32x4_exec !== "function" ||
      typeof exports.cvtdq2ps32x4_exec !== "function" ||
      typeof exports.haddps32x4_exec !== "function" ||
      typeof exports.shift_rotate_exec !== "function" ||
      typeof exports.double_shift_exec !== "function" ||
      typeof exports.psubusb32 !== "function" ||
      typeof exports.packed_op32x2_exec !== "function" ||
      typeof exports.packed_op32x4_exec !== "function" ||
      typeof exports.punpckldq32x4_exec !== "function" ||
      typeof exports.pshufw64_exec !== "function" ||
      typeof exports.movmsk_bytes64 !== "function" ||
      typeof exports.movmsk_bytes128 !== "function" ||
      typeof exports.movmsk_float32x4 !== "function" ||
      typeof exports.shufps32x4_exec !== "function" ||
      typeof exports.get_packed128_last_lane !== "function" ||
      typeof exports.packsswb64_exec !== "function"
    ) {
      throw new Error("WASM CPU backend exports are incomplete.");
    }
    cache.backend = {
      kind: "wasm",
      apiVersion: typeof exports.api_version === "function" ? (exports.api_version() >>> 0) : 0,
      parityEven8(value) {
        return !!exports.parity_even8(value >>> 0);
      },
      roundTiesToEven(value) {
        return Number(exports.round_ties_to_even(Number(value)));
      },
      x87StoreIntegerValue(value, truncate) {
        return Number(exports.x87_store_integer_value(Number(value), truncate ? 1 : 0));
      },
      x87PackedBcdToNumber(bytes) {
        const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
        return Number(exports.x87_packed_bcd_to_number(
          source[0] >>> 0,
          source[1] >>> 0,
          source[2] >>> 0,
          source[3] >>> 0,
          source[4] >>> 0,
          source[5] >>> 0,
          source[6] >>> 0,
          source[7] >>> 0,
          source[8] >>> 0,
          source[9] >>> 0
        ));
      },
      x87NumberToPackedBcd(value) {
        exports.x87_number_to_packed_bcd_exec(Number(value));
        return readPackedBcdResult(exports);
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
      evalJccCondition(cc, flags) {
        return !!exports.eval_jcc_condition(cc >>> 0, flags >>> 0);
      },
      bswap32(value) {
        return exports.bswap32(value >>> 0) >>> 0;
      },
      bitScan(value, reverse, widthBits) {
        exports.bit_scan_exec(value >>> 0, reverse ? 1 : 0, widthBits >>> 0);
        return readBitScanResult(exports);
      },
      bitTestModify(value, bitIndex, widthBits, op, flags) {
        exports.bit_test_modify_exec(value >>> 0, bitIndex >>> 0, widthBits >>> 0, op >>> 0, flags >>> 0);
        return readBitTestResult(exports);
      },
      xaddWidth(dst, src, widthBits, flags) {
        exports.xadd_width_exec(dst >>> 0, src >>> 0, widthBits >>> 0, flags >>> 0);
        return readXaddResult(exports);
      },
      cmpxchgWidth(accumulator, source, replacement, widthBits, flags) {
        exports.cmpxchg_width_exec(
          accumulator >>> 0,
          source >>> 0,
          replacement >>> 0,
          widthBits >>> 0,
          flags >>> 0
        );
        return readCmpxchgResult(exports);
      },
      imulSignedWidth(left, right, widthBits, flags) {
        exports.imul_signed_width_exec(left >>> 0, right >>> 0, widthBits >>> 0, flags >>> 0);
        return readImulResult(exports);
      },
      aluBinaryWidth(op, left, right, widthBits, flags) {
        exports.alu_binary_width_exec(op >>> 0, left >>> 0, right >>> 0, widthBits >>> 0, flags >>> 0);
        return readAluResult(exports);
      },
      x87CompareCode(left, right) {
        return exports.x87_compare_code(Number(left), Number(right)) >>> 0;
      },
      shiftPacked64(lo, hi, count, leftShift) {
        exports.shift_packed64_exec(lo >>> 0, hi >>> 0, count >>> 0, leftShift ? 1 : 0);
        return readShiftPacked64Result(exports);
      },
      mulFullWidth(left, right, widthBits, signed, flags) {
        exports.mul_full_width_exec(left >>> 0, right >>> 0, widthBits >>> 0, signed ? 1 : 0, flags >>> 0);
        return readMulResult(exports);
      },
      divideFullWidth(high, low, divisor, widthBits, signed) {
        exports.divide_full_width_exec(high >>> 0, low >>> 0, divisor >>> 0, widthBits >>> 0, signed ? 1 : 0);
        return readDivResult(exports);
      },
      x87F2xm1(value) {
        return Number(exports.x87_f2xm1(Number(value)));
      },
      x87Fyl2x(y, x) {
        return Number(exports.x87_fyl2x(Number(y), Number(x)));
      },
      x87Tan(value) {
        return Number(exports.x87_tan(Number(value)));
      },
      x87Atan2(y, x) {
        return Number(exports.x87_atan2(Number(y), Number(x)));
      },
      x87Sqrt(value) {
        return Number(exports.x87_sqrt(Number(value)));
      },
      x87Sin(value) {
        return Number(exports.x87_sin(Number(value)));
      },
      x87Cos(value) {
        return Number(exports.x87_cos(Number(value)));
      },
      x87SinCos(value) {
        exports.x87_sincos_exec(Number(value));
        return readX87SinCosResult(exports);
      },
      x87Scale(st0, st1) {
        return Number(exports.x87_scale(Number(st0), Number(st1)));
      },
      sseSqrt(value) {
        return Number(exports.sse_sqrt(Number(value)));
      },
      sseReciprocal(value) {
        return Number(exports.sse_reciprocal(Number(value)));
      },
      sseReciprocalSqrt(value) {
        return Number(exports.sse_reciprocal_sqrt(Number(value)));
      },
      sseBinaryFloat(left, right, op) {
        return Number(exports.sse_binary_float(Number(left), Number(right), op >>> 0));
      },
      sseCompareCode(left, right) {
        return exports.sse_compare_code(Number(left), Number(right)) >>> 0;
      },
      sseUnaryFloat32x4(v0, v1, v2, v3, op) {
        exports.sse_unary_float32x4_exec(v0 >>> 0, v1 >>> 0, v2 >>> 0, v3 >>> 0, op >>> 0);
        return readPacked128Result(exports);
      },
      sseBinaryFloat32x4(dst0, dst1, dst2, dst3, src0, src1, src2, src3, op) {
        exports.sse_binary_float32x4_exec(
          dst0 >>> 0,
          dst1 >>> 0,
          dst2 >>> 0,
          dst3 >>> 0,
          src0 >>> 0,
          src1 >>> 0,
          src2 >>> 0,
          src3 >>> 0,
          op >>> 0
        );
        return readPacked128Result(exports);
      },
      sseBinaryFloat32Bits(dst, src, op) {
        return exports.sse_binary_float32_bits(dst >>> 0, src >>> 0, op >>> 0) >>> 0;
      },
      sseCompare32x4(dst0, dst1, dst2, dst3, src0, src1, src2, src3, imm) {
        exports.sse_compare32x4_exec(
          dst0 >>> 0,
          dst1 >>> 0,
          dst2 >>> 0,
          dst3 >>> 0,
          src0 >>> 0,
          src1 >>> 0,
          src2 >>> 0,
          src3 >>> 0,
          imm >>> 0
        );
        return readPacked128Result(exports);
      },
      cvtdq2ps32x4(v0, v1, v2, v3) {
        exports.cvtdq2ps32x4_exec(v0 >>> 0, v1 >>> 0, v2 >>> 0, v3 >>> 0);
        return readPacked128Result(exports);
      },
      haddps32x4(dst0, dst1, dst2, dst3, src0, src1, src2, src3) {
        exports.haddps32x4_exec(
          dst0 >>> 0,
          dst1 >>> 0,
          dst2 >>> 0,
          dst3 >>> 0,
          src0 >>> 0,
          src1 >>> 0,
          src2 >>> 0,
          src3 >>> 0
        );
        return readPacked128Result(exports);
      },
      shiftRotate(value, count, widthBits, mode, flags) {
        exports.shift_rotate_exec(value >>> 0, count >>> 0, widthBits >>> 0, mode >>> 0, flags >>> 0);
        return readPackedShiftResult(exports, "shift_rotate");
      },
      doubleShift(value, source, count, widthBits, leftShift, flags) {
        exports.double_shift_exec(value >>> 0, source >>> 0, count >>> 0, widthBits >>> 0, leftShift ? 1 : 0, flags >>> 0);
        return readPackedShiftResult(exports, "double_shift");
      },
      psubusb32(a, b) {
        return exports.psubusb32(a >>> 0, b >>> 0) >>> 0;
      },
      psubusw32(a, b) {
        return exports.psubusw32(a >>> 0, b >>> 0) >>> 0;
      },
      pavgb32(a, b) {
        return exports.pavgb32(a >>> 0, b >>> 0) >>> 0;
      },
      paddw32(a, b) {
        return exports.paddw32(a >>> 0, b >>> 0) >>> 0;
      },
      psubsw32(a, b) {
        return exports.psubsw32(a >>> 0, b >>> 0) >>> 0;
      },
      pmullw32(a, b) {
        return exports.pmullw32(a >>> 0, b >>> 0) >>> 0;
      },
      psrlw32(a, count) {
        return exports.psrlw32(a >>> 0, count >>> 0) >>> 0;
      },
      psraw32(a, count) {
        return exports.psraw32(a >>> 0, count >>> 0) >>> 0;
      },
      psllw32(a, count) {
        return exports.psllw32(a >>> 0, count >>> 0) >>> 0;
      },
      psrld32(a, count) {
        return exports.psrld32(a >>> 0, count >>> 0) >>> 0;
      },
      psrad32(a, count) {
        return exports.psrad32(a >>> 0, count >>> 0) >>> 0;
      },
      pslld32(a, count) {
        return exports.pslld32(a >>> 0, count >>> 0) >>> 0;
      },
      packedOp32x2(dstLo, dstHi, srcLo, srcHi, op) {
        exports.packed_op32x2_exec(dstLo >>> 0, dstHi >>> 0, srcLo >>> 0, srcHi >>> 0, op >>> 0);
        return readPacked64Result(exports);
      },
      packedOp32x4(dst0, dst1, dst2, dst3, src0, src1, src2, src3, op) {
        exports.packed_op32x4_exec(
          dst0 >>> 0,
          dst1 >>> 0,
          dst2 >>> 0,
          dst3 >>> 0,
          src0 >>> 0,
          src1 >>> 0,
          src2 >>> 0,
          src3 >>> 0,
          op >>> 0
        );
        return readPacked128Result(exports);
      },
      punpckldq32x4(dst0, dst1, src0, src1) {
        exports.punpckldq32x4_exec(dst0 >>> 0, dst1 >>> 0, src0 >>> 0, src1 >>> 0);
        return readPacked128Result(exports);
      },
      pshufw64(lo, hi, imm) {
        exports.pshufw64_exec(lo >>> 0, hi >>> 0, imm >>> 0);
        return readPacked64Result(exports);
      },
      movmskBytes64(lo, hi) {
        return exports.movmsk_bytes64(lo >>> 0, hi >>> 0) >>> 0;
      },
      movmskBytes128(v0, v1, v2, v3) {
        return exports.movmsk_bytes128(v0 >>> 0, v1 >>> 0, v2 >>> 0, v3 >>> 0) >>> 0;
      },
      movmskFloat32x4(v0, v1, v2, v3) {
        return exports.movmsk_float32x4(v0 >>> 0, v1 >>> 0, v2 >>> 0, v3 >>> 0) >>> 0;
      },
      shufps32x4(dst0, dst1, dst2, dst3, src0, src1, src2, src3, imm) {
        exports.shufps32x4_exec(
          dst0 >>> 0,
          dst1 >>> 0,
          dst2 >>> 0,
          dst3 >>> 0,
          src0 >>> 0,
          src1 >>> 0,
          src2 >>> 0,
          src3 >>> 0,
          imm >>> 0
        );
        return readPacked128Result(exports);
      },
      packsswb64(dstLo, dstHi, srcLo, srcHi) {
        exports.packsswb64_exec(dstLo >>> 0, dstHi >>> 0, srcLo >>> 0, srcHi >>> 0);
        return readPacked64Result(exports);
      },
      packuswb64(dstLo, dstHi, srcLo, srcHi) {
        exports.packuswb64_exec(dstLo >>> 0, dstHi >>> 0, srcLo >>> 0, srcHi >>> 0);
        return readPacked64Result(exports);
      },
      packssdw64(dstLo, dstHi, srcLo, srcHi) {
        exports.packssdw64_exec(dstLo >>> 0, dstHi >>> 0, srcLo >>> 0, srcHi >>> 0);
        return readPacked64Result(exports);
      },
      punpcklbw64(dstLo, srcLo) {
        exports.punpcklbw64_exec(dstLo >>> 0, srcLo >>> 0);
        return readPacked64Result(exports);
      },
      punpckhbw64(dstHi, srcHi) {
        exports.punpckhbw64_exec(dstHi >>> 0, srcHi >>> 0);
        return readPacked64Result(exports);
      },
      punpcklwd64(dstLo, srcLo) {
        exports.punpcklwd64_exec(dstLo >>> 0, srcLo >>> 0);
        return readPacked64Result(exports);
      },
      punpckhwd64(dstHi, srcHi) {
        exports.punpckhwd64_exec(dstHi >>> 0, srcHi >>> 0);
        return readPacked64Result(exports);
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

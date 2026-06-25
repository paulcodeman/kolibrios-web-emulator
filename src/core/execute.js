(() => {
  const KosEmu = globalThis.KosEmu;

  function installCoreExecute(Emulator, shared) {
    if (!Emulator || !Emulator.prototype) {
      throw new Error("installCoreExecute requires an Emulator class.");
    }
    const {
      REG,
      FLAG_CF,
      FLAG_AF,
      FLAG_PF,
      FLAG_ZF,
      FLAG_SF,
      FLAG_DF,
      FLAG_OF,
      parityEven8,
      roundTiesToEven,
      x87StoreIntegerValue,
      x87PackedBcdToNumber,
      x87NumberToPackedBcd,
      bitScan,
      bitTestModify,
      imulSignedWidth,
      x87CompareCode,
      shiftPacked64,
      mulFullWidth,
      divideFullWidth,
      x87F2xm1,
      x87Fyl2x,
      x87Tan,
      x87Atan2,
      x87Sqrt,
      x87Sin,
      x87Cos,
      x87SinCos,
      x87Scale,
      sseSqrt,
      sseReciprocal,
      sseReciprocalSqrt,
      sseBinaryFloat,
      sseCompareCode,
      sseUnaryFloat32x4,
      sseBinaryFloat32x4,
      sseBinaryFloat32Bits,
      sseCompare32x4,
      cvtdq2ps32x4,
      haddps32x4,
      updateLogicFlagsWidth,
      updateAddFlags,
      updateAdcFlags,
      updateSubFlags,
      updateSbbFlags,
      aluBinaryWidth,
      shiftRotate,
      doubleShift,
      psubusb32,
      psubusw32,
      psubsw32,
      paddw32,
      pmullw32,
      pavgb32,
      psrlw32,
      psraw32,
      psllw32,
      psrld32,
      psrad32,
      pslld32,
      packsswb64,
      packuswb64,
      packssdw64,
      punpcklbw64,
      punpckhbw64,
      punpcklwd64,
      punpckhwd64,
      packedOp32x2,
      packedOp32x4,
      punpckldq32x4,
      pshufw64,
      movmskBytes64,
      movmskBytes128,
      movmskFloat32x4,
      shufps32x4,
      bswap32,
      xaddWidth,
      cmpxchgWidth,
      matchBytes,
      FAST_LOOP_SHADE,
      FAST_LOOP_MAX,
      FAST_LOOP_BLUR,
      FAST_LOOP_BLUR_RIGHT,
      evalJccCondition
    } = shared || {};
    const FAST_RUNTIME_COPY_LOOP_FWD = new Uint8Array([0x39, 0xcf, 0x74, 0x03, 0xa4, 0xeb, 0xf9]);
    const FAST_RUNTIME_COPY_LOOP_BWD = new Uint8Array([0x49, 0x8a, 0x1c, 0x0a, 0x88, 0x1c, 0x08, 0x75, 0xf7]);
    const SOFT_KIND_NONE = 0;
    const SOFT_KIND_JCC = 1;
    const SOFT_KIND_JMP = 2;
    const SOFT_KIND_CALL_REL32 = 3;
    const SOFT_KIND_RET = 4;
    const SOFT_KIND_LOOP = 5;
    const SOFT_KIND_BSWAP = 6;

    function getSoftSiteFastKind(site) {
      if (!site || !site.type) {
        return SOFT_KIND_NONE;
      }
      const cached = site.fastKind | 0;
      if (cached) {
        return cached;
      }
      let kind = SOFT_KIND_NONE;
      switch (site.type) {
        case "jcc":
          kind = SOFT_KIND_JCC;
          break;
        case "jmp":
          kind = SOFT_KIND_JMP;
          break;
        case "call-rel32":
          kind = SOFT_KIND_CALL_REL32;
          break;
        case "ret":
          kind = SOFT_KIND_RET;
          break;
        case "loop":
          kind = SOFT_KIND_LOOP;
          break;
        case "bswap":
          kind = SOFT_KIND_BSWAP;
          break;
        default:
          kind = SOFT_KIND_NONE;
          break;
      }
      site.fastKind = kind;
      return kind;
    }

    function stopInterpreterFault(emulator, reason, message) {
      if (emulator && typeof emulator.log === "function") {
        emulator.log(message);
      }
      if (emulator) {
        emulator.running = false;
      }
      if (emulator && typeof emulator.emitStopped === "function") {
        emulator.emitStopped(reason || "cpu-fault");
      }
      return true;
    }

    Object.assign(Emulator.prototype, {
      promoteDynamicSoftInstruction(addr) {
        if (
          !this.softInstructions ||
          typeof this.getSoftInstructionSite !== "function"
        ) {
          return null;
        }
        const current = addr >>> 0;
        const site = this.getSoftInstructionSite(current);
        if (!site) {
          return null;
        }
        return this.handleSoftInstruction(current, site);
      },

      invokeUnknownOpcodeHandler(eip) {
        if (typeof this.onUnknownOpcode !== "function") {
          return false;
        }
        const beforeEip = this.readReg(REG.EIP) >>> 0;
        const bytes = this.readMemBlock(eip >>> 0, 16);
        const opcode = bytes && bytes.length ? bytes[0] : this.readMem8(eip >>> 0);
        try {
          const handled = !!this.onUnknownOpcode({
            emulator: this,
            eip: eip >>> 0,
            opcode: opcode >>> 0,
            bytes: bytes || null
          });
          if (!handled) {
            return false;
          }
        } catch (err) {
          this.log(`Unknown opcode handler failed at 0x${(eip >>> 0).toString(16)}: ${err}`);
          return false;
        }
        const afterEip = this.readReg(REG.EIP) >>> 0;
        if (afterEip === beforeEip) {
          this.log(`Unknown opcode handler did not advance EIP at 0x${(eip >>> 0).toString(16)}`);
          return false;
        }
        return true;
      },

      handleInvalidOpcode(eip) {
        if (this.handleSoftInstruction(eip)) {
          return true;
        }
        if (this.executeBasicInstruction(eip)) {
          return true;
        }
        if (this.invokeUnknownOpcodeHandler(eip)) {
          return true;
        }
        return false;
      },

      setFpuCompareStatus(c0, c2, c3) {
        if (!this.cpu) {
          return;
        }
        let status = this.cpu.fpuStatusWord >>> 0;
        status &= ~((1 << 8) | (1 << 10) | (1 << 14));
        if (c0) {
          status |= 1 << 8;
        }
        if (c2) {
          status |= 1 << 10;
        }
        if (c3) {
          status |= 1 << 14;
        }
        this.cpu.fpuStatusWord = status & 0xffff;
      },

      fpuCompareValues(a, b) {
        const code = x87CompareCode(a, b);
        if (code === 3) {
          this.setFpuCompareStatus(1, 1, 1);
        } else if (code === 0) {
          this.setFpuCompareStatus(0, 0, 0);
        } else if (code === 1) {
          this.setFpuCompareStatus(1, 0, 0);
        } else {
          this.setFpuCompareStatus(0, 0, 1);
        }
      },

      setFpuCompareEflags(a, b) {
        const code = x87CompareCode(a, b);
        let eflags = this.readReg(REG.EFLAGS) >>> 0;
        eflags &= ~(FLAG_CF | FLAG_AF | FLAG_PF | FLAG_ZF | FLAG_SF | FLAG_OF);
        if (code === 3) {
          eflags |= FLAG_CF | FLAG_PF | FLAG_ZF;
        } else if (code === 1) {
          eflags |= FLAG_CF;
        } else if (code === 2) {
          eflags |= FLAG_ZF;
        }
        this.writeReg(REG.EFLAGS, eflags >>> 0);
      },

      handleFpuDb(addr) {
        const bytes = this.readMemBlock(addr, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
        const len = 1 + modrmInfo.size;
        const reg = modrmInfo.reg & 7;
        if (modrmInfo.mod === 3) {
          if (reg === 4) {
            this.fpuReset();
          }
          this.writeReg(REG.EIP, (addr + len) >>> 0);
          return true;
        }
        const ea = this.calcEffectiveAddress(modrmInfo);
        if (ea === null) {
          return false;
        }
        switch (reg) {
          case 0: { // fild m32
            const val = this.readMem32(ea) | 0;
            this.fpuPush(val);
            break;
          }
          case 1: { // fisttp m32
            const val = x87StoreIntegerValue(this.fpuPop(), true);
            this.writeMem32(ea, val | 0);
            break;
          }
          case 3: { // fistp m32
            const val = x87StoreIntegerValue(this.fpuPop(), false);
            this.writeMem32(ea, val | 0);
            break;
          }
          case 2: { // fist m32
            const val = x87StoreIntegerValue(this.fpuPeek(), false);
            this.writeMem32(ea, val | 0);
            break;
          }
          case 5: { // fld tbyte
            this.fpuPush(0);
            break;
          }
          case 7: { // fstp tbyte
            this.fpuPop();
            break;
          }
          default:
            return false;
        }
        this.writeReg(REG.EIP, (addr + len) >>> 0);
        return true;
      },

      handleFpuD9(addr) {
        const bytes = this.readMemBlock(addr, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
        const len = 1 + modrmInfo.size;
        const reg = modrmInfo.reg & 7;
        if (modrmInfo.mod !== 3) {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          if (reg === 0) { // fld m32real
            const value = this.readMemFloat32(ea);
            this.fpuPush(value);
          } else if (reg === 2) { // fst m32real
            const value = this.fpuPeek();
            this.writeMemFloat32(ea, value);
          } else if (reg === 3) { // fstp m32real
            const value = this.fpuPop();
            this.writeMemFloat32(ea, value);
          }
          this.writeReg(REG.EIP, (addr + len) >>> 0);
          return true;
        }
    
        const stIndex = modrmInfo.rm & 7;
        if (reg === 0) { // fld st(i)
          const value = this.fpuGet(stIndex);
          this.fpuPush(value);
        } else if (reg === 1) { // fxch st(i)
          this.fpuSwap(stIndex);
        } else if (reg === 2) { // fnop
          // no-op
        } else if (reg === 4) { // misc unary
          const st0 = this.fpuPeek();
          if (stIndex === 0) {
            this.fpuSet(0, -st0);
          } else if (stIndex === 1) {
            this.fpuSet(0, Math.abs(st0));
          } else if (stIndex === 4) {
            this.fpuCompareValues(st0, 0.0);
          } else if (stIndex === 5) { // fxam
            const fpu = this.cpu ? this.cpu : null;
            const val = fpu && fpu.fpuSize > 0 ? fpu.fpu[fpu.fpuTop | 0] : NaN;
            let c3 = 0, c2 = 0, c0 = 0, c1 = 0;
            if (!fpu || fpu.fpuSize === 0) {
              c3 = 1; c0 = 1; // empty
            } else if (Object.is(val, 0)) {
              c3 = 1; // zero
              if (Object.is(val, -0)) c1 = 1;
            } else if (!isFinite(val)) {
              if (isNaN(val)) { c0 = 1; } // NaN
              else { c2 = 1; c0 = 1; } // Infinity
            } else if (Math.abs(val) >= 2.2250738585072014e-308) {
              c2 = 1; // normal
              if (val < 0) c1 = 1;
            } else {
              c2 = 1; c3 = 1; // denormal
              if (val < 0) c1 = 1;
            }
            let sw = fpu ? (fpu.fpuStatusWord & ~0x4700) : 0;
            if (c3) sw |= 0x4000;
            if (c2) sw |= 0x0400;
            if (c1) sw |= 0x0200;
            if (c0) sw |= 0x0100;
            if (fpu) fpu.fpuStatusWord = sw;
          }
        } else if (reg === 5) { // constants
          switch (stIndex) {
            case 0: this.fpuPush(1.0); break;
            case 1: this.fpuPush(Math.log2(10)); break;
            case 2: this.fpuPush(Math.LOG2E); break;
            case 3: this.fpuPush(Math.PI); break;
            case 4: this.fpuPush(Math.log10(2)); break;
            case 5: this.fpuPush(Math.LN2); break;
            case 6: this.fpuPush(0.0); break;
            default: break;
          }
        } else if (reg === 6) {
          const st0 = this.fpuPeek();
          if (stIndex === 0) {
            this.fpuSet(0, x87F2xm1(st0));
          } else if (stIndex === 1) {
            const st1 = this.fpuGet(1);
            this.fpuSet(1, x87Fyl2x(st1, st0));
            this.fpuPop();
          } else if (stIndex === 2) {
            this.fpuSet(0, x87Tan(st0));
            this.fpuPush(1.0);
          } else if (stIndex === 3) {
            const st1 = this.fpuGet(1);
            this.fpuSet(1, x87Atan2(st1, st0));
            this.fpuPop();
          } else if (stIndex === 4) { // fxtract
            const fpu = this.cpu;
            const size = fpu ? (fpu.fpuSize | 0) : 0;
            if (size >= 1) {
              const top = fpu.fpuTop | 0;
              const val = fpu.fpu[top];
              let exponent;
              let significand;
              if (val === 0) {
                exponent = 0;
                significand = 0;
              } else {
                const absVal = Math.abs(val);
                exponent = Math.floor(Math.log2(absVal));
                significand = val / Math.pow(2, exponent);
              }
              fpu.fpu[top] = significand;
              if (size < 8) {
                const nextSlot = (top + size) & 7;
                fpu.fpu[nextSlot] = exponent;
                fpu.fpuSize = size + 1;
              }
            }
          } else if (stIndex === 5) { // fprem1
            const st1 = this.fpuGet(1);
            this.fpuSet(0, x87Fprem1(st0, st1));
          } else if (stIndex === 6) { // fdecstp
            if (this.cpu) {
              this.cpu.fpuTop = (this.cpu.fpuTop + 7) & 7;
            }
          } else if (stIndex === 7) { // fincstp
            if (this.cpu) {
              this.cpu.fpuTop = (this.cpu.fpuTop + 1) & 7;
            }
          }
        } else if (reg === 7) {
          const st0 = this.fpuPeek();
          if (stIndex === 0) { // fprem
            const st1 = this.fpuGet(1);
            this.fpuSet(0, x87Fprem(st0, st1));
          } else if (stIndex === 1) { // fyl2xp1
            const st1 = this.fpuGet(1);
            this.fpuSet(1, x87Fyl2xp1(st1, st0));
            this.fpuPop();
          } else if (stIndex === 2) {
            this.fpuSet(0, x87Sqrt(st0));
          } else if (stIndex === 3) {
            const sincos = x87SinCos(st0);
            this.fpuSet(0, sincos.sin);
            this.fpuPush(sincos.cos);
          } else if (stIndex === 4) {
            this.fpuSet(0, roundTiesToEven(st0));
          } else if (stIndex === 5) {
            const st1 = this.fpuGet(1);
            this.fpuSet(0, x87Scale(st0, st1));
          } else if (stIndex === 6) {
            this.fpuSet(0, x87Sin(st0));
          } else if (stIndex === 7) {
            this.fpuSet(0, x87Cos(st0));
          }
        }
        this.writeReg(REG.EIP, (addr + len) >>> 0);
        return true;
      },

      handleFpuDe(addr) {
        const bytes = this.readMemBlock(addr, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
        const len = 1 + modrmInfo.size;
        const reg = modrmInfo.reg & 7;
        if (modrmInfo.mod !== 3) {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          const intVal = this.readMem16Signed(ea);
          const st0 = this.fpuPeek();
          let result = st0;
          switch (reg) {
            case 0: result = st0 + intVal; break; // fiadd
            case 1: result = st0 * intVal; break; // fimul
            case 4: result = st0 - intVal; break; // fisub
            case 5: result = intVal - st0; break; // fisubr
            case 6: result = st0 / intVal; break; // fidiv
            case 7: result = intVal / st0; break; // fidivr
            case 2:
            case 3:
              this.fpuCompareValues(st0, intVal);
              // ficom/ficomp: ignore flags
              if (reg === 3) {
                this.fpuPop();
              }
              this.writeReg(REG.EIP, (addr + len) >>> 0);
              return true;
            default:
              return false;
          }
          this.fpuSet(0, result);
          this.writeReg(REG.EIP, (addr + len) >>> 0);
          return true;
        }
    
        const stIndex = modrmInfo.rm & 7;
        const st0 = this.fpuPeek();
        const sti = this.fpuGet(stIndex);
        if (reg === 3 && stIndex === 1) {
          this.fpuCompareValues(st0, sti);
          this.fpuPop();
          this.fpuPop();
          this.writeReg(REG.EIP, (addr + len) >>> 0);
          return true;
        }
        switch (reg) {
          case 0: // faddp st(i), st0
            this.fpuSet(stIndex, sti + st0);
            this.fpuPop();
            break;
          case 1: // fmulp st(i), st0
            this.fpuSet(stIndex, sti * st0);
            this.fpuPop();
            break;
          case 4: // fsubrp st(i), st0
            this.fpuSet(stIndex, st0 - sti);
            this.fpuPop();
            break;
          case 5: // fsubp st(i), st0
            this.fpuSet(stIndex, sti - st0);
            this.fpuPop();
            break;
          case 6: // fdivrp st(i), st0
            this.fpuSet(stIndex, st0 / sti);
            this.fpuPop();
            break;
          case 7: // fdivp st(i), st0
            this.fpuSet(stIndex, sti / st0);
            this.fpuPop();
            break;
          case 2:
          case 3:
            this.fpuCompareValues(st0, sti);
            if (reg === 3) {
              this.fpuPop();
            }
            break;
          default:
            return false;
        }
        this.writeReg(REG.EIP, (addr + len) >>> 0);
        return true;
      },

      handleFpuDc(addr) {
        const bytes = this.readMemBlock(addr, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
        const len = 1 + modrmInfo.size;
        const reg = modrmInfo.reg & 7;
        if (modrmInfo.mod !== 3) {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          const memVal = this.readMemFloat64(ea);
          const st0 = this.fpuPeek();
          let result = st0;
          switch (reg) {
            case 0: result = st0 + memVal; break; // fadd
            case 1: result = st0 * memVal; break; // fmul
            case 4: result = st0 - memVal; break; // fsub
            case 5: result = memVal - st0; break; // fsubr
            case 6: result = st0 / memVal; break; // fdiv
            case 7: result = memVal / st0; break; // fdivr
            case 2:
            case 3:
              this.fpuCompareValues(st0, memVal);
              // fcom/fcomp: ignore flags
              if (reg === 3) {
                this.fpuPop();
              }
              this.writeReg(REG.EIP, (addr + len) >>> 0);
              return true;
            default:
              return false;
          }
          this.fpuSet(0, result);
          this.writeReg(REG.EIP, (addr + len) >>> 0);
          return true;
        }
    
        const stIndex = modrmInfo.rm & 7;
        const st0 = this.fpuPeek();
        const sti = this.fpuGet(stIndex);
        switch (reg) {
          case 0: this.fpuSet(stIndex, sti + st0); break; // fadd st(i), st0
          case 1: this.fpuSet(stIndex, sti * st0); break; // fmul st(i), st0
          case 4: this.fpuSet(stIndex, st0 - sti); break; // fsubr st(i), st0
          case 5: this.fpuSet(stIndex, sti - st0); break; // fsub st(i), st0
          case 6: this.fpuSet(stIndex, st0 / sti); break; // fdivr st(i), st0
          case 7: this.fpuSet(stIndex, sti / st0); break; // fdiv st(i), st0
          case 2:
          case 3:
            this.fpuCompareValues(st0, sti);
            if (reg === 3) {
              this.fpuPop();
            }
            break;
          default:
            return false;
        }
        this.writeReg(REG.EIP, (addr + len) >>> 0);
        return true;
      },

      handleFpuDa(addr) {
        const bytes = this.readMemBlock(addr, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
        const len = 1 + modrmInfo.size;
        const reg = modrmInfo.reg & 7;
        if (modrmInfo.mod !== 3) {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          const intVal = this.readMem32(ea) | 0;
          const st0 = this.fpuPeek();
          let result = st0;
          switch (reg) {
            case 0: result = st0 + intVal; break; // fiadd
            case 1: result = st0 * intVal; break; // fimul
            case 4: result = st0 - intVal; break; // fisub
            case 5: result = intVal - st0; break; // fisubr
            case 6: result = st0 / intVal; break; // fidiv
            case 7: result = intVal / st0; break; // fidivr
            case 2:
            case 3:
              this.fpuCompareValues(st0, intVal);
              // ficom/ficomp: ignore flags
              if (reg === 3) {
                this.fpuPop();
              }
              this.writeReg(REG.EIP, (addr + len) >>> 0);
              return true;
            default:
              return false;
          }
          this.fpuSet(0, result);
          this.writeReg(REG.EIP, (addr + len) >>> 0);
          return true;
        }
        const stIndex = modrmInfo.rm & 7;
        if (reg === 5 && stIndex === 1) {
          const st0 = this.fpuPeek();
          const st1 = this.fpuGet(1);
          this.fpuCompareValues(st0, st1);
          this.fpuPop();
          this.fpuPop();
          this.writeReg(REG.EIP, (addr + len) >>> 0);
          return true;
        }
        return false;
      },

      handleFpuDd(addr) {
        const bytes = this.readMemBlock(addr, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
        const len = 1 + modrmInfo.size;
        const reg = modrmInfo.reg & 7;
        if (modrmInfo.mod !== 3) {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          switch (reg) {
            case 0: { // fld m64real
              const value = this.readMemFloat64(ea);
              this.fpuPush(value);
              break;
            }
            case 2: { // fst m64real
              const value = this.fpuPeek();
              this.writeMemFloat64(ea, value);
              break;
            }
            case 3: { // fstp m64real
              const value = this.fpuPop();
              this.writeMemFloat64(ea, value);
              break;
            }
            case 4: // frstor (ignored)
              break;
            default:
              return false;
          }
          this.writeReg(REG.EIP, (addr + len) >>> 0);
          return true;
        }
    
        const stIndex = modrmInfo.rm & 7;
        switch (reg) {
          case 2: { // fst st(i)
            const value = this.fpuPeek();
            this.fpuSet(stIndex, value);
            break;
          }
          case 3: { // fstp st(i)
            const value = this.fpuPeek();
            this.fpuSet(stIndex, value);
            this.fpuPop();
            break;
          }
          case 0: // ffree st(i)
            break;
          default:
            return false;
        }
        this.writeReg(REG.EIP, (addr + len) >>> 0);
        return true;
      },

      handleFpuD8(addr) {
        const bytes = this.readMemBlock(addr, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
        const len = 1 + modrmInfo.size;
        const reg = modrmInfo.reg & 7;
        if (modrmInfo.mod !== 3) {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          const memVal = this.readMemFloat32(ea);
          const st0 = this.fpuPeek();
          let result = st0;
          switch (reg) {
            case 0: result = st0 + memVal; break; // fadd
            case 1: result = st0 * memVal; break; // fmul
            case 4: result = st0 - memVal; break; // fsub
            case 5: result = memVal - st0; break; // fsubr
            case 6: result = st0 / memVal; break; // fdiv
            case 7: result = memVal / st0; break; // fdivr
            case 2:
            case 3:
              this.fpuCompareValues(st0, memVal);
              if (reg === 3) {
                this.fpuPop();
              }
              this.writeReg(REG.EIP, (addr + len) >>> 0);
              return true;
            default:
              return false;
          }
          this.fpuSet(0, result);
          this.writeReg(REG.EIP, (addr + len) >>> 0);
          return true;
        }
    
        const stIndex = modrmInfo.rm & 7;
        const st0 = this.fpuPeek();
        const sti = this.fpuGet(stIndex);
        switch (reg) {
          case 0: this.fpuSet(0, st0 + sti); break;
          case 1: this.fpuSet(0, st0 * sti); break;
          case 4: this.fpuSet(0, st0 - sti); break;
          case 5: this.fpuSet(0, sti - st0); break;
          case 6: this.fpuSet(0, st0 / sti); break;
          case 7: this.fpuSet(0, sti / st0); break;
          case 2:
          case 3:
            this.fpuCompareValues(st0, sti);
            if (reg === 3) {
              this.fpuPop();
            }
            break;
          default:
            return false;
        }
        this.writeReg(REG.EIP, (addr + len) >>> 0);
        return true;
      },

      handleFpuDf(addr) {
        const bytes = this.readMemBlock(addr, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
        const len = 1 + modrmInfo.size;
        const reg = modrmInfo.reg & 7;
        if (modrmInfo.mod !== 3) {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          switch (reg) {
            case 0: { // fild m16
              const val = this.readMem16Signed(ea);
              this.fpuPush(val);
              break;
            }
            case 1: { // fisttp m16
              const val = x87StoreIntegerValue(this.fpuPop(), true);
              this.writeMem16(ea, val | 0);
              break;
            }
            case 3: { // fistp m16
              const val = x87StoreIntegerValue(this.fpuPop(), false);
              this.writeMem16(ea, val | 0);
              break;
            }
            case 2: { // fist m16
              const val = x87StoreIntegerValue(this.fpuPeek(), false);
              this.writeMem16(ea, val | 0);
              break;
            }
            case 4: { // fbld m80bcd
              const value = this.readMemBlock(ea, 10);
              if (!(value instanceof Uint8Array) || value.length < 10) {
                return false;
              }
              this.fpuPush(x87PackedBcdToNumber(value));
              break;
            }
            case 5: { // fild m64
              const val = this.readMem64(ea);
              this.fpuPush(Number(val));
              break;
            }
            case 6: { // fbstp m80bcd
              const value = this.fpuPop();
              this.writeMemBlock(ea, x87NumberToPackedBcd(value));
              break;
            }
            case 7: { // fistp m64
              const val = x87StoreIntegerValue(this.fpuPop(), false);
              this.writeMem64(ea, BigInt(val));
              break;
            }
            default:
              return false;
          }
          this.writeReg(REG.EIP, (addr + len) >>> 0);
          return true;
        }
    
        const stIndex = modrmInfo.rm & 7;
        if (reg === 4) {
          // FSTSW AX
          const eax = this.readReg(REG.EAX);
          const status = this.cpu ? (this.cpu.fpuStatusWord & 0xffff) : 0;
          const next = (eax & 0xffff0000) | status;
          this.writeReg(REG.EAX, next >>> 0);
          this.writeReg(REG.EIP, (addr + len) >>> 0);
          return true;
        }
        if (reg === 5 || reg === 6) {
          const st0 = this.fpuPeek();
          const sti = this.fpuGet(stIndex);
          this.setFpuCompareEflags(st0, sti);
          this.fpuPop();
          this.writeReg(REG.EIP, (addr + len) >>> 0);
          return true;
        }
        if (reg === 0) { // ffreep st(i)
          this.fpuPop();
          this.writeReg(REG.EIP, (addr + len) >>> 0);
          return true;
        }
        return false;
      },

      fpuReset() {
        if (!this.cpu) {
          return;
        }
        this.cpu.fpu.fill(0);
        this.cpu.fpuSize = 0;
        this.cpu.fpuTop = 0;
        this.cpu.fpuStatusWord = 0;
      },

      fpuGet(index) {
        if (!this.cpu) {
          return 0;
        }
        const idx = index | 0;
        if (idx < 0 || idx >= 8) {
          return 0;
        }
        if (idx >= this.cpu.fpuSize) {
          return 0;
        }
        const slot = (this.cpu.fpuTop + idx) & 7;
        return this.cpu.fpu[slot];
      },

      fpuSet(index, value) {
        if (!this.cpu) {
          return;
        }
        const idx = index | 0;
        if (idx < 0 || idx >= 8) {
          return;
        }
        const slot = (this.cpu.fpuTop + idx) & 7;
        this.cpu.fpu[slot] = Number(value) || 0;
        if (idx >= this.cpu.fpuSize) {
          const size = this.cpu.fpuSize | 0;
          for (let i = size; i < idx; i += 1) {
            this.cpu.fpu[(this.cpu.fpuTop + i) & 7] = 0;
          }
          this.cpu.fpuSize = Math.min(8, idx + 1);
        }
      },

      fpuSwap(index) {
        if (!this.cpu) {
          return;
        }
        const idx = index | 0;
        if (idx < 0 || idx >= this.cpu.fpuSize) {
          return;
        }
        const fpu = this.cpu.fpu;
        const top = this.cpu.fpuTop | 0;
        const slot = (top + idx) & 7;
        const tmp = fpu[top];
        fpu[top] = fpu[slot];
        fpu[slot] = tmp;
      },

      fpuPush(value) {
        if (!this.cpu) {
          return;
        }
        const fpu = this.cpu.fpu;
        const size = this.cpu.fpuSize | 0;
        const v = Number(value) || 0;
        this.cpu.fpuTop = (this.cpu.fpuTop + 7) & 7;
        fpu[this.cpu.fpuTop] = v;
        this.cpu.fpuSize = size < 8 ? (size + 1) : 8;
      },

      fpuPop() {
        if (!this.cpu) {
          return 0;
        }
        const size = this.cpu.fpuSize | 0;
        if (size <= 0) {
          return 0;
        }
        const fpu = this.cpu.fpu;
        const top = this.cpu.fpuTop | 0;
        const value = fpu[top];
        fpu[top] = 0;
        this.cpu.fpuTop = (top + 1) & 7;
        this.cpu.fpuSize = size - 1;
        return value;
      },

      fpuPeek() {
        if (!this.cpu || this.cpu.fpuSize <= 0) {
          return 0;
        }
        return this.cpu.fpu[this.cpu.fpuTop];
      },

      executeLoopInstruction(addr, opcode, length) {
        const addrSize = this.getActiveAddressSize();
        let count = this.readCountReg(addrSize);
        count = addrSize === 16 ? ((count - 1) & 0xffff) : ((count - 1) >>> 0);
        this.writeCountReg(addrSize, count);
    
        const zf = (this.readReg(REG.EFLAGS) & FLAG_ZF) !== 0;
        let take = count !== 0;
        if (take && opcode === 0xe0) {
          take = !zf;
        } else if (take && opcode === 0xe1) {
          take = zf;
        }
    
        const rel8 = (this.readMem8((addr + 1) >>> 0) << 24) >> 24;
        const next = (addr + (length || 2)) >>> 0;
        this.writeReg(REG.EIP, take ? (next + rel8) >>> 0 : next);
        return true;
      },

      executeStringInstruction(addr, repPrefix, operandSizeOverride) {
        const opcode = this.readMem8(addr);
        const df = (this.readReg(REG.EFLAGS) & 0x400) !== 0;
        const operandSize = operandSizeOverride === 2 ? 2 : 4;
        const addrSize = this.getActiveAddressSize();
        let count = 1;
        const checkRep = repPrefix === 0xf3 || repPrefix === 0xf2;
        let ecx = checkRep ? (this.readCountReg(addrSize) >>> 0) : 0;
        if (checkRep) {
          count = ecx >>> 0;
          if (count === 0) {
            this.writeReg(REG.EIP, (addr + 1) >>> 0);
            return true;
          }
        }
        const step = df ? -1 : 1;
        let esi = this.readAddrSizedReg(REG.ESI, addrSize) >>> 0;
        let edi = this.readAddrSizedReg(REG.EDI, addrSize) >>> 0;
        let eax = this.readReg(REG.EAX) >>> 0;
        let flags = this.readReg(REG.EFLAGS) >>> 0;
        if (checkRep) {
          const fast = this.tryFastRepStringInstruction(opcode, operandSize, addrSize, df, count, esi, edi, eax, repPrefix, flags);
          if (fast) {
            this.writeAddrSizedReg(REG.ESI, fast.esi >>> 0, addrSize);
            this.writeAddrSizedReg(REG.EDI, fast.edi >>> 0, addrSize);
            this.writeReg(REG.EAX, eax >>> 0);
            this.writeReg(REG.EFLAGS, ((fast.flags >>> 0) || 0) >>> 0);
            this.writeCountReg(addrSize, fast.ecx >>> 0);
            this.writeReg(REG.EIP, (addr + 1) >>> 0);
            return true;
          }
        }
        for (let i = 0; i < count; i += 1) {
          let checkZf = false;
          if (opcode === 0xa4) { // MOVSB
            const value = this.readMem8(esi);
            this.writeMem8(edi, value);
            esi = this.advanceAddrSizedValue(esi, step, addrSize);
            edi = this.advanceAddrSizedValue(edi, step, addrSize);
          } else if (opcode === 0xa5) { // MOVSW/MOVSD
            if (operandSize === 2) {
              const value = this.readMem16(esi);
              this.writeMem16(edi, value);
              const delta = step * 2;
              esi = this.advanceAddrSizedValue(esi, delta, addrSize);
              edi = this.advanceAddrSizedValue(edi, delta, addrSize);
            } else {
              const value = this.readMem32(esi);
              this.writeMem32(edi, value);
              const delta = step * 4;
              esi = this.advanceAddrSizedValue(esi, delta, addrSize);
              edi = this.advanceAddrSizedValue(edi, delta, addrSize);
            }
          } else if (opcode === 0xaa) { // STOSB
            const value = eax & 0xff;
            if (this.checkInterpreterMem(edi, 1)) {
              this.invalidateBasicBlocksForWrite(edi, 1);
              this.cpu.mem[edi] = value & 0xff;
            }
            edi = this.advanceAddrSizedValue(edi, step, addrSize);
          } else if (opcode === 0xab) { // STOSW/STOSD
            if (operandSize === 2) {
              this.writeMem16(edi, eax & 0xffff);
              const delta = step * 2;
              edi = this.advanceAddrSizedValue(edi, delta, addrSize);
            } else {
              this.writeMem32(edi, eax >>> 0);
              const delta = step * 4;
              edi = this.advanceAddrSizedValue(edi, delta, addrSize);
            }
          } else if (opcode === 0xac) { // LODSB
            const value = this.readMem8(esi);
            eax = ((eax & 0xffffff00) | (value & 0xff)) >>> 0;
            esi = this.advanceAddrSizedValue(esi, step, addrSize);
          } else if (opcode === 0xad) { // LODSW/LODSD
            if (operandSize === 2) {
              const value = this.readMem16(esi);
              eax = ((eax & 0xffff0000) | (value & 0xffff)) >>> 0;
              const delta = step * 2;
              esi = this.advanceAddrSizedValue(esi, delta, addrSize);
            } else {
              const value = this.readMem32(esi);
              eax = value >>> 0;
              const delta = step * 4;
              esi = this.advanceAddrSizedValue(esi, delta, addrSize);
            }
          } else if (opcode === 0xa6) { // CMPSB
            const src = this.readMem8(esi);
            const dst = this.readMem8(edi);
            const alu = aluBinaryWidth(7, src, dst, 8, flags);
            flags = alu.flags >>> 0;
            checkZf = true;
            esi = this.advanceAddrSizedValue(esi, step, addrSize);
            edi = this.advanceAddrSizedValue(edi, step, addrSize);
          } else if (opcode === 0xa7) { // CMPSW/CMPSD
            if (operandSize === 2) {
              const src = this.readMem16(esi);
              const dst = this.readMem16(edi);
              const alu = aluBinaryWidth(7, src, dst, 16, flags);
              flags = alu.flags >>> 0;
              const delta = step * 2;
              esi = this.advanceAddrSizedValue(esi, delta, addrSize);
              edi = this.advanceAddrSizedValue(edi, delta, addrSize);
            } else {
              const src = this.readMem32(esi);
              const dst = this.readMem32(edi);
              const alu = aluBinaryWidth(7, src, dst, 32, flags);
              flags = alu.flags >>> 0;
              const delta = step * 4;
              esi = this.advanceAddrSizedValue(esi, delta, addrSize);
              edi = this.advanceAddrSizedValue(edi, delta, addrSize);
            }
            checkZf = true;
          } else if (opcode === 0xae) { // SCASB
            const dst = this.readMem8(edi);
            const al = eax & 0xff;
            const alu = aluBinaryWidth(7, al, dst, 8, flags);
            flags = alu.flags >>> 0;
            checkZf = true;
            edi = this.advanceAddrSizedValue(edi, step, addrSize);
          } else if (opcode === 0xaf) { // SCASW/SCASD
            if (operandSize === 2) {
              const dst = this.readMem16(edi);
              const ax = eax & 0xffff;
              const alu = aluBinaryWidth(7, ax, dst, 16, flags);
              flags = alu.flags >>> 0;
              const delta = step * 2;
              edi = this.advanceAddrSizedValue(edi, delta, addrSize);
            } else {
              const dst = this.readMem32(edi);
              const alu = aluBinaryWidth(7, eax, dst, 32, flags);
              flags = alu.flags >>> 0;
              const delta = step * 4;
              edi = this.advanceAddrSizedValue(edi, delta, addrSize);
            }
            checkZf = true;
          } else if (opcode === 0x6c) { // INSB
            const port = this.readReg(REG.EDX) & 0xffff;
            const value = this.ioRead8(port) & 0xff;
            this.writeMem8(edi, value);
            edi = this.advanceAddrSizedValue(edi, step, addrSize);
          } else if (opcode === 0x6d) { // INSW/INSD
            const port = this.readReg(REG.EDX) & 0xffff;
            if (operandSize === 2) {
              const value = this.ioRead32(port) & 0xffff;
              this.writeMem16(edi, value);
              const delta = step * 2;
              edi = this.advanceAddrSizedValue(edi, delta, addrSize);
            } else {
              const value = this.ioRead32(port) >>> 0;
              this.writeMem32(edi, value);
              const delta = step * 4;
              edi = this.advanceAddrSizedValue(edi, delta, addrSize);
            }
          } else if (opcode === 0x6e) { // OUTSB
            const port = this.readReg(REG.EDX) & 0xffff;
            const value = this.readMem8(esi) & 0xff;
            this.ioWrite8(port, value);
            esi = this.advanceAddrSizedValue(esi, step, addrSize);
          } else if (opcode === 0x6f) { // OUTSW/OUTSD
            const port = this.readReg(REG.EDX) & 0xffff;
            if (operandSize === 2) {
              const value = this.readMem16(esi) & 0xffff;
              this.ioWrite32(port, value);
              const delta = step * 2;
              esi = this.advanceAddrSizedValue(esi, delta, addrSize);
            } else {
              const value = this.readMem32(esi) >>> 0;
              this.ioWrite32(port, value);
              const delta = step * 4;
              esi = this.advanceAddrSizedValue(esi, delta, addrSize);
            }
          } else {
            return false;
          }
          if (checkRep) {
            ecx = (ecx - 1) >>> 0;
            if (ecx === 0) {
              break;
            }
            if (checkZf) {
              const zf = (flags & FLAG_ZF) !== 0;
              if ((repPrefix === 0xf3 && !zf) || (repPrefix === 0xf2 && zf)) {
                break;
              }
            }
          }
        }
        this.writeAddrSizedReg(REG.ESI, esi, addrSize);
        this.writeAddrSizedReg(REG.EDI, edi, addrSize);
        this.writeReg(REG.EAX, eax >>> 0);
        this.writeReg(REG.EFLAGS, flags >>> 0);
        if (checkRep) {
          this.writeCountReg(addrSize, ecx >>> 0);
        }
        this.writeReg(REG.EIP, (addr + 1) >>> 0);
        return true;
      },
      executeBasicInstruction(addr) {
    const opcode = this.readMem8(addr);
    if (!this.running) {
      return false;
    }
    if (opcode === 0x67) {
      const prevAddrSize = this.addrSizeOverride;
      this.addrSizeOverride = 16;
      let ok = false;
      try {
        ok = this.executeBasicInstruction((addr + 1) >>> 0);
      } finally {
        this.addrSizeOverride = prevAddrSize;
      }
      return ok;
    }
    if (opcode === 0xf0) { // lock prefix (single-threaded: ignore)
      return this.executeBasicInstruction((addr + 1) >>> 0);
    }
    if (opcode === 0x66) {
      const op2 = this.readMem8((addr + 1) >>> 0);
      if (op2 >= 0x50 && op2 <= 0x57) { // push r16
        const regIdx = op2 - 0x50;
        const value = this.readReg16ByIndex(regIdx);
        let esp = this.readReg(REG.ESP) >>> 0;
        esp = (esp - 2) >>> 0;
        this.writeMem16(esp, value & 0xffff);
        this.writeReg(REG.ESP, esp >>> 0);
        this.writeReg(REG.EIP, (addr + 2) >>> 0);
        return true;
      }
      if (op2 >= 0x58 && op2 <= 0x5f) { // pop r16
        const regIdx = op2 - 0x58;
        let esp = this.readReg(REG.ESP) >>> 0;
        const value = this.readMem16(esp);
        esp = (esp + 2) >>> 0;
        this.writeReg(REG.ESP, esp >>> 0);
        this.writeReg16ByIndex(regIdx, value & 0xffff);
        this.writeReg(REG.EIP, (addr + 2) >>> 0);
        return true;
      }
      if (op2 === 0x68) { // push imm16
        const imm16 = this.readMem16((addr + 2) >>> 0) & 0xffff;
        let esp = this.readReg(REG.ESP) >>> 0;
        esp = (esp - 2) >>> 0;
        this.writeMem16(esp, imm16);
        this.writeReg(REG.ESP, esp >>> 0);
        this.writeReg(REG.EIP, (addr + 4) >>> 0);
        return true;
      }
      if (op2 === 0x6a) { // push imm8 (sign-extend to 16)
        const imm8 = (this.readMem8((addr + 2) >>> 0) << 24) >> 24;
        const value = imm8 & 0xffff;
        let esp = this.readReg(REG.ESP) >>> 0;
        esp = (esp - 2) >>> 0;
        this.writeMem16(esp, value);
        this.writeReg(REG.ESP, esp >>> 0);
        this.writeReg(REG.EIP, (addr + 3) >>> 0);
        return true;
      }
      if (op2 === 0x62) { // bound r16, m16&16
        const bytes = this.readMemBlock(addr + 1, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
        if (modrmInfo.mod === 3) {
          return stopInterpreterFault(
            this,
            "invalid-opcode",
            `BOUND requires a memory operand at 0x${(addr >>> 0).toString(16)}`
          );
        }
        const ea = this.calcEffectiveAddress(modrmInfo);
        if (ea === null) {
          return false;
        }
        const index = (this.readReg16ByIndex(modrmInfo.reg) << 16) >> 16;
        const lower = (this.readMem16(ea) << 16) >> 16;
        const upper = (this.readMem16((ea + 2) >>> 0) << 16) >> 16;
        if (index < lower || index > upper) {
          return stopInterpreterFault(
            this,
            "bound-range",
            `BOUND fault at 0x${(addr >>> 0).toString(16)}: ${index} outside [${lower}, ${upper}]`
          );
        }
        this.writeReg(REG.EIP, (addr + 2 + modrmInfo.size) >>> 0);
        return true;
      }
      if (op2 === 0x8f) { // pop r/m16
        const bytes = this.readMemBlock(addr + 1, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
        if ((modrmInfo.reg & 7) !== 0) {
          return stopInterpreterFault(
            this,
            "invalid-opcode",
            `Invalid 66 8F /${modrmInfo.reg & 7} POP encoding at 0x${(addr >>> 0).toString(16)}`
          );
        }
        let esp = this.readReg(REG.ESP) >>> 0;
        const value = this.readMem16(esp);
        esp = (esp + 2) >>> 0;
        this.writeReg(REG.ESP, esp >>> 0);
        if (modrmInfo.mod === 3) {
          this.writeReg16ByIndex(modrmInfo.rm, value & 0xffff);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          this.writeMem16(ea, value & 0xffff);
        }
        this.writeReg(REG.EIP, (addr + 2 + modrmInfo.size) >>> 0);
        return true;
      }
      if (op2 === 0x0f) {
        const op3 = this.readMem8((addr + 2) >>> 0);
        if (op3 >= 0x40 && op3 <= 0x4f) { // cmovcc r16, r/m16
          const bytes = this.readMemBlock(addr + 1, 16);
          if (!bytes) {
            return false;
          }
          const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
          const flags = this.readReg(REG.EFLAGS);
          if (evalJccCondition(op3 & 0x0f, flags)) {
            let value = 0;
            if (modrmInfo.mod === 3) {
              value = this.readReg16ByIndex(modrmInfo.rm) & 0xffff;
            } else {
              const ea = this.calcEffectiveAddress(modrmInfo);
              if (ea === null) {
                return false;
              }
              value = this.readMem16(ea) & 0xffff;
            }
            this.writeReg16ByIndex(modrmInfo.reg, value & 0xffff);
          }
          this.writeReg(REG.EIP, (addr + 3 + modrmInfo.size) >>> 0);
          return true;
        }
        if (op3 === 0x7e) { // movd/movq xmm -> r/m
          const bytes = this.readMemBlock(addr + 1, 24);
          if (!bytes) {
            return false;
          }
          const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
          const regIdx = modrmInfo.reg & 7;
          const value = this.readXmm64U32(regIdx, 0, this.scratchQwordA);
          if (modrmInfo.mod === 3) {
            const dstIdx = modrmInfo.rm & 7;
            this.writeXmm64U32(dstIdx, 0, value);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea === null) {
              return false;
            }
            if (!this.writeMem64U32(ea, value)) {
              return false;
            }
          }
          this.writeReg(REG.EIP, (addr + 3 + modrmInfo.size) >>> 0);
          return true;
        }
        if (op3 === 0x62) { // punpckldq xmm, xmm/m128
          const bytes = this.readMemBlock(addr + 1, 32);
          if (!bytes) {
            return false;
          }
          const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
          const regIdx = modrmInfo.reg & 7;
          const src = this.readModrmXmmLow64SourceU32(modrmInfo, this.scratchQwordA);
          if (!src) {
            return false;
          }
          const dst = this.readXmm64U32(regIdx, 0, this.scratchQwordB);
          const out = punpckldq32x4(
            dst[0],
            dst[1],
            src[0],
            src[1]
          );
          this.writeXmm128U32(regIdx, out);
          this.writeReg(REG.EIP, (addr + 3 + modrmInfo.size) >>> 0);
          return true;
        }
        if (op3 === 0x76) { // pcmpeqd xmm, xmm/m128
          const bytes = this.readMemBlock(addr + 1, 32);
          if (!bytes) {
            return false;
          }
          const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
          const regIdx = modrmInfo.reg & 7;
          const src = this.readModrmXmmSourceU32(modrmInfo, this.scratchXmmWordsA);
          if (!src) {
            return false;
          }
          const dst = this.readXmm128U32(regIdx, this.scratchXmmWordsB);
          const out = packedOp32x4(
            dst[0],
            dst[1],
            dst[2],
            dst[3],
            src[0],
            src[1],
            src[2],
            src[3],
            4
          );
          this.writeXmm128U32(regIdx, out);
          this.writeReg(REG.EIP, (addr + 3 + modrmInfo.size) >>> 0);
          return true;
        }
        if (op3 === 0xd7) { // pmovmskb r32, xmm/m128
          const bytes = this.readMemBlock(addr + 1, 32);
          if (!bytes) {
            return false;
          }
          const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
          const dstIdx = modrmInfo.reg & 7;
          let mask = 0;
          if (modrmInfo.mod === 3) {
            const srcIdx = modrmInfo.rm & 7;
            const src = this.readXmm128U32(srcIdx, this.scratchXmmWordsA);
            mask = movmskBytes128(
              src[0],
              src[1],
              src[2],
              src[3]
            ) >>> 0;
          } else {
            const src = this.readModrmXmmSourceU32(modrmInfo, this.scratchXmmWordsA);
            if (!src) {
              return false;
            }
            mask = movmskBytes128(
              src[0],
              src[1],
              src[2],
              src[3]
            ) >>> 0;
          }
          this.writeReg32ByIndex(dstIdx, mask >>> 0);
          this.writeReg(REG.EIP, (addr + 3 + modrmInfo.size) >>> 0);
          return true;
        }
        if (op3 === 0xb1) { // cmpxchg r/m16, r16
          const bytes = this.readMemBlock(addr + 1, 16);
          if (!bytes) {
            return false;
          }
          const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
          const eax = this.readReg(REG.EAX) & 0xffff;
          let ea = 0;
          let src = 0;
          if (modrmInfo.mod === 3) {
            src = this.readReg16ByIndex(modrmInfo.rm) & 0xffff;
          } else {
            const targetEa = this.calcEffectiveAddress(modrmInfo);
            if (targetEa === null) {
              return false;
            }
            ea = targetEa >>> 0;
            src = this.readMem16(ea) & 0xffff;
          }
          const regVal = this.readReg16ByIndex(modrmInfo.reg) & 0xffff;
          const result = cmpxchgWidth(eax, src, regVal, 16, this.readReg(REG.EFLAGS));
          if (result.exchanged) {
            if (modrmInfo.mod === 3) {
              this.writeReg16ByIndex(modrmInfo.rm, result.result & 0xffff);
            } else {
              this.writeMem16(ea >>> 0, result.result & 0xffff);
            }
          } else {
            this.writeReg16ByIndex(0, result.accumulator & 0xffff);
          }
          this.writeReg(REG.EFLAGS, result.flags >>> 0);
          this.writeReg(REG.EIP, (addr + 4 + modrmInfo.size) >>> 0);
          return true;
        }
        if (op3 === 0xc1) { // xadd r/m16, r16
          const bytes = this.readMemBlock(addr + 1, 16);
          if (!bytes) {
            return false;
          }
          const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
          const src = this.readReg16ByIndex(modrmInfo.reg) & 0xffff;
          let ea = 0;
          let dst = 0;
          if (modrmInfo.mod === 3) {
            dst = this.readReg16ByIndex(modrmInfo.rm) & 0xffff;
          } else {
            const targetEa = this.calcEffectiveAddress(modrmInfo);
            if (targetEa === null) {
              return false;
            }
            ea = targetEa >>> 0;
            dst = this.readMem16(ea) & 0xffff;
          }
          const result = xaddWidth(dst, src, 16, this.readReg(REG.EFLAGS));
          this.writeReg16ByIndex(modrmInfo.reg, result.src & 0xffff);
          if (modrmInfo.mod === 3) {
            this.writeReg16ByIndex(modrmInfo.rm, result.dst & 0xffff);
          } else {
            this.writeMem16(ea >>> 0, result.dst & 0xffff);
          }
          this.writeReg(REG.EFLAGS, result.flags >>> 0);
          this.writeReg(REG.EIP, (addr + 4 + modrmInfo.size) >>> 0);
          return true;
        }
        if (op3 === 0xa3 || op3 === 0xab || op3 === 0xb3 || op3 === 0xbb) { // bt/bts/btr/btc r/m16, r16
          const bytes = this.readMemBlock(addr + 1, 16);
          if (!bytes) {
            return false;
          }
          const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
          const bitIndex = this.readReg16ByIndex(modrmInfo.reg) & 0xffff;
          let value = 0;
          let ea = 0;
          if (modrmInfo.mod === 3) {
            value = this.readReg16ByIndex(modrmInfo.rm) & 0xffff;
          } else {
            const base = this.calcEffectiveAddress(modrmInfo);
            if (base === null) {
              return false;
            }
            const wordOffset = (bitIndex >>> 4) >>> 0;
            ea = (base + (wordOffset * 2)) >>> 0;
            value = this.readMem16(ea) & 0xffff;
          }
          const op = op3 === 0xa3 ? 4 : (op3 === 0xab ? 5 : (op3 === 0xb3 ? 6 : 7));
          const result = bitTestModify(value, bitIndex, 16, op, this.readReg(REG.EFLAGS));
          if (op !== 4) {
            const nextVal = result.result & 0xffff;
            if (modrmInfo.mod === 3) {
              this.writeReg16ByIndex(modrmInfo.rm, nextVal & 0xffff);
            } else {
              this.writeMem16(ea >>> 0, nextVal & 0xffff);
            }
          }
          this.writeReg(REG.EFLAGS, result.flags >>> 0);
          this.writeReg(REG.EIP, (addr + 3 + modrmInfo.size) >>> 0);
          return true;
        }
      }
      if (op2 === 0xff) { // group 5 (push r/m16)
        const bytes = this.readMemBlock(addr + 1, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
        const regField = modrmInfo.reg & 7;
        if (regField === 0 || regField === 1) { // inc/dec r/m16
          let value = 0;
          if (modrmInfo.mod === 3) {
            value = this.readReg16ByIndex(modrmInfo.rm);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea === null) {
              return false;
            }
            value = this.readMem16(ea);
          }
          const origFlags = this.readReg(REG.EFLAGS);
          const alu = aluBinaryWidth(regField === 0 ? 0 : 5, value, 1, 16, origFlags);
          let flags = alu.flags >>> 0;
          flags = (flags & ~FLAG_CF) | (origFlags & FLAG_CF);
          if (modrmInfo.mod === 3) {
            this.writeReg16ByIndex(modrmInfo.rm, alu.result & 0xffff);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea === null) {
              return false;
            }
            this.writeMem16(ea, alu.result & 0xffff);
          }
          this.writeReg(REG.EFLAGS, flags >>> 0);
          this.writeReg(REG.EIP, (addr + 2 + modrmInfo.size) >>> 0);
          return true;
        }
        if (regField === 2 || regField === 4) { // call/jmp r/m16
          let target = 0;
          if (modrmInfo.mod === 3) {
            target = this.readReg16ByIndex(modrmInfo.rm);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea === null) {
              return false;
            }
            target = this.readMem16(ea);
          }
          if (regField === 2) {
            const next = (addr + 2 + modrmInfo.size) >>> 0;
            let esp = this.readReg(REG.ESP) >>> 0;
            esp = (esp - 2) >>> 0;
            this.writeMem16(esp, next & 0xffff);
            this.writeReg(REG.ESP, esp >>> 0);
          }
          this.writeReg(REG.EIP, target & 0xffff);
          return true;
        }
        if (regField === 3 || regField === 5) { // call/jmp far m16:16
          if (modrmInfo.mod === 3) {
            return stopInterpreterFault(
              this,
              "invalid-opcode",
              `Far control transfer requires a memory operand at 0x${(addr >>> 0).toString(16)}`
            );
          }
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          const target = this.readMem16(ea) & 0xffff;
          const selector = this.readMem16((ea + 2) >>> 0) & 0xffff;
          if (regField === 3) {
            const next = (addr + 2 + modrmInfo.size) >>> 0;
            let esp = this.readReg(REG.ESP) >>> 0;
            esp = (esp - 2) >>> 0;
            this.writeMem16(esp, this.segCS & 0xffff);
            esp = (esp - 2) >>> 0;
            this.writeMem16(esp, next & 0xffff);
            this.writeReg(REG.ESP, esp >>> 0);
          }
          this.segCS = selector & 0xffff;
          this.writeReg(REG.EIP, target & 0xffff);
          return true;
        }
        if (regField === 7) {
          return stopInterpreterFault(
            this,
            "invalid-opcode",
            `Invalid FF /7 opcode at 0x${(addr >>> 0).toString(16)}`
          );
        }
        if (regField !== 6) {
          return false;
        }
        let value = 0;
        if (modrmInfo.mod === 3) {
          value = this.readReg16ByIndex(modrmInfo.rm);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          value = this.readMem16(ea);
        }
        let esp = this.readReg(REG.ESP) >>> 0;
        esp = (esp - 2) >>> 0;
        this.writeMem16(esp, value & 0xffff);
        this.writeReg(REG.ESP, esp >>> 0);
        this.writeReg(REG.EIP, (addr + 2 + modrmInfo.size) >>> 0);
        return true;
      }
      if (op2 === 0x80 || op2 === 0x82) { // group1 r/m8, imm8
        const bytes = this.readMemBlock(addr + 1, 20);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
        const regField = modrmInfo.reg & 7;
        const immOffset = 1 + modrmInfo.size;
        const imm = bytes[immOffset] & 0xff;
        let op1 = 0;
        if (modrmInfo.mod === 3) {
          op1 = this.readReg8ByIndex(modrmInfo.rm);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          op1 = this.readMem8(ea);
        }
        if (regField > 7) {
          return false;
        }
        const alu = aluBinaryWidth(regField, op1, imm, 8, this.readReg(REG.EFLAGS));
        if (regField !== 7) {
          if (modrmInfo.mod === 3) {
            this.writeReg8ByIndex(modrmInfo.rm, alu.result & 0xff);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea === null) {
              return false;
            }
            this.writeMem8(ea, alu.result & 0xff);
          }
        }
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
        this.writeReg(REG.EIP, (addr + 2 + modrmInfo.size + 1) >>> 0);
        return true;
      }
      if (op2 === 0x81 || op2 === 0x83) { // group1 r/m16, imm16/imm8
        const bytes = this.readMemBlock(addr + 1, 20);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
        const regField = modrmInfo.reg & 7;
        const immOffset = 1 + modrmInfo.size;
        let imm = 0;
        if (op2 === 0x81) {
          imm = (bytes[immOffset] | (bytes[immOffset + 1] << 8)) & 0xffff;
        } else {
          const imm8 = (bytes[immOffset] << 24) >> 24;
          imm = imm8 & 0xffff;
        }
        let op1 = 0;
        if (modrmInfo.mod === 3) {
          op1 = this.readReg16ByIndex(modrmInfo.rm);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          op1 = this.readMem16(ea);
        }
        if (regField > 7) {
          return false;
        }
        const alu = aluBinaryWidth(regField, op1, imm, 16, this.readReg(REG.EFLAGS));
        if (regField !== 7) {
          if (modrmInfo.mod === 3) {
            this.writeReg16ByIndex(modrmInfo.rm, alu.result & 0xffff);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea === null) {
              return false;
            }
            this.writeMem16(ea, alu.result & 0xffff);
          }
        }
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
        const immSize = op2 === 0x81 ? 2 : 1;
        this.writeReg(REG.EIP, (addr + 2 + modrmInfo.size + immSize) >>> 0);
        return true;
      }
      if (op2 === 0x69 || op2 === 0x6b) { // imul r16, r/m16, imm16/imm8
        const bytes = this.readMemBlock((addr + 1) >>> 0, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
        let src = 0;
        if (modrmInfo.mod === 3) {
          src = this.readReg16ByIndex(modrmInfo.rm) & 0xffff;
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          src = this.readMem16(ea) & 0xffff;
        }
        let imm = 0;
        if (op2 === 0x69) {
          const idx = 1 + modrmInfo.size;
          imm = (bytes[idx] | (bytes[idx + 1] << 8)) & 0xffff;
        } else {
          imm = ((bytes[1 + modrmInfo.size] << 24) >> 24) & 0xffff;
        }
        const result = imulSignedWidth(src, imm, 16, this.readReg(REG.EFLAGS));
        this.writeReg16ByIndex(modrmInfo.reg, result.result & 0xffff);
        this.writeReg(REG.EFLAGS, result.flags >>> 0);
        const immSize = op2 === 0x69 ? 2 : 1;
        this.writeReg(REG.EIP, (addr + 2 + modrmInfo.size + immSize) >>> 0);
        return true;
      }
      if (op2 === 0x9c) { // pushf (16-bit)
        const flags = this.readReg(REG.EFLAGS) & 0xffff;
        let esp = this.readReg(REG.ESP) >>> 0;
        esp = (esp - 2) >>> 0;
        this.writeMem16(esp, flags);
        this.writeReg(REG.ESP, esp >>> 0);
        this.writeReg(REG.EIP, (addr + 2) >>> 0);
        return true;
      }
      if (op2 === 0x9d) { // popf (16-bit)
        let esp = this.readReg(REG.ESP) >>> 0;
        const value = this.readMem16(esp);
        esp = (esp + 2) >>> 0;
        this.writeReg(REG.ESP, esp >>> 0);
        const flags = this.readReg(REG.EFLAGS);
        const next = (flags & 0xffff0000) | (value & 0xffff);
        this.writeReg(REG.EFLAGS, next >>> 0);
        this.writeReg(REG.EIP, (addr + 2) >>> 0);
        return true;
      }
      if (op2 === 0x60 || op2 === 0x61) { // pusha/popa 16-bit
        let esp = this.readReg(REG.ESP) >>> 0;
        if (op2 === 0x60) {
          const regs = [
            this.readReg(REG.EAX),
            this.readReg(REG.ECX),
            this.readReg(REG.EDX),
            this.readReg(REG.EBX),
            this.readReg(REG.ESP),
            this.readReg(REG.EBP),
            this.readReg(REG.ESI),
            this.readReg(REG.EDI)
          ];
          const sp = esp & 0xffff;
          for (let i = 0; i < regs.length; i += 1) {
            const val = (i === 4 ? sp : (regs[i] & 0xffff)) & 0xffff;
            esp = (esp - 2) >>> 0;
            this.writeMem16(esp, val);
          }
          this.writeReg(REG.ESP, esp >>> 0);
        } else {
          const pop16 = () => {
            const v = this.readMem16(esp);
            esp = (esp + 2) >>> 0;
            return v & 0xffff;
          };
          const di = pop16();
          const si = pop16();
          const bp = pop16();
          pop16(); // skip SP
          const bx = pop16();
          const dx = pop16();
          const cx = pop16();
          const ax = pop16();
          this.writeReg16ByIndex(7, di);
          this.writeReg16ByIndex(6, si);
          this.writeReg16ByIndex(5, bp);
          this.writeReg16ByIndex(3, bx);
          this.writeReg16ByIndex(2, dx);
          this.writeReg16ByIndex(1, cx);
          this.writeReg16ByIndex(0, ax);
          this.writeReg(REG.ESP, esp >>> 0);
        }
        this.writeReg(REG.EIP, (addr + 2) >>> 0);
        return true;
      }
      if (op2 === 0xc3) { // ret (16-bit)
        let esp = this.readReg(REG.ESP) >>> 0;
        const target = this.readMem16(esp);
        esp = (esp + 2) >>> 0;
        this.writeReg(REG.ESP, esp >>> 0);
        this.writeReg(REG.EIP, target & 0xffff);
        return true;
      }
      if (op2 === 0xc2) { // ret imm16 (16-bit)
        const imm = this.readMem16((addr + 2) >>> 0) & 0xffff;
        let esp = this.readReg(REG.ESP) >>> 0;
        const target = this.readMem16(esp);
        esp = (esp + 2 + imm) >>> 0;
        this.writeReg(REG.ESP, esp >>> 0);
        this.writeReg(REG.EIP, target & 0xffff);
        return true;
      }
      if (op2 === 0xcb) { // retf (16-bit)
        let esp = this.readReg(REG.ESP) >>> 0;
        const target = this.readMem16(esp);
        esp = (esp + 2) >>> 0;
        const selector = this.readMem16(esp) & 0xffff;
        esp = (esp + 2) >>> 0;
        this.writeReg(REG.ESP, esp >>> 0);
        this.segCS = selector & 0xffff;
        this.writeReg(REG.EIP, target & 0xffff);
        return true;
      }
      if (op2 === 0xca) { // retf imm16 (16-bit)
        const imm = this.readMem16((addr + 2) >>> 0) & 0xffff;
        let esp = this.readReg(REG.ESP) >>> 0;
        const target = this.readMem16(esp);
        esp = (esp + 2) >>> 0;
        const selector = this.readMem16(esp) & 0xffff;
        esp = (esp + 2) >>> 0;
        esp = (esp + imm) >>> 0;
        this.writeReg(REG.ESP, esp >>> 0);
        this.segCS = selector & 0xffff;
        this.writeReg(REG.EIP, target & 0xffff);
        return true;
      }
      if (op2 === 0x0f) {
        const op3 = this.readMem8((addr + 2) >>> 0);
        if (op3 === 0x71 || op3 === 0x72 || op3 === 0x73) {
          const bytes = this.readMemBlock(addr + 1, 20);
          if (!bytes) {
            return false;
          }
          const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
          const imm = bytes[2 + modrmInfo.size] & 0xff;
          const len = 4 + modrmInfo.size;
          if (modrmInfo.mod !== 3) {
            return false;
          }
          const regField = modrmInfo.reg & 7;
          const regIdx = modrmInfo.rm & 7;
          const count = imm & 0xff;
          const xmmWords = this.readXmm128U32(regIdx, this.scratchXmmWordsA);
          if (op3 === 0x71) {
            for (let i = 0; i < 4; i += 1) {
              const value = xmmWords[i] >>> 0;
              let nextVal = value >>> 0;
              if (regField === 2) {
                nextVal = psrlw32(value, count) >>> 0;
              } else if (regField === 4) {
                nextVal = psraw32(value, count) >>> 0;
              } else if (regField === 6) {
                nextVal = psllw32(value, count) >>> 0;
              } else {
                return false;
              }
              xmmWords[i] = nextVal >>> 0;
            }
            this.writeXmm128U32(regIdx, xmmWords);
          } else if (op3 === 0x72) {
            for (let i = 0; i < 4; i += 1) {
              const value = xmmWords[i] >>> 0;
              let nextVal = value >>> 0;
              if (regField === 2) {
                nextVal = psrld32(value, count) >>> 0;
              } else if (regField === 4) {
                nextVal = psrad32(value, count) >>> 0;
              } else if (regField === 6) {
                nextVal = pslld32(value, count) >>> 0;
              } else {
                return false;
              }
              xmmWords[i] = nextVal >>> 0;
            }
            this.writeXmm128U32(regIdx, xmmWords);
          } else if (regField === 3 || regField === 7) {
            const shift = Math.min(16, count);
            const bytesArr = this.scratchBytes16A;
            for (let i = 0; i < 4; i += 1) {
              const v = xmmWords[i] >>> 0;
              bytesArr[i * 4] = v & 0xff;
              bytesArr[i * 4 + 1] = (v >>> 8) & 0xff;
              bytesArr[i * 4 + 2] = (v >>> 16) & 0xff;
              bytesArr[i * 4 + 3] = (v >>> 24) & 0xff;
            }
            const out = this.scratchBytes16B;
            out.fill(0);
            if (shift < 16) {
              if (regField === 3) {
                for (let i = shift; i < 16; i += 1) {
                  out[i - shift] = bytesArr[i];
                }
              } else {
                for (let i = 0; i < 16 - shift; i += 1) {
                  out[i + shift] = bytesArr[i];
                }
              }
            }
            for (let i = 0; i < 4; i += 1) {
              const v =
                out[i * 4] |
                (out[i * 4 + 1] << 8) |
                (out[i * 4 + 2] << 16) |
                (out[i * 4 + 3] << 24);
              xmmWords[i] = v >>> 0;
            }
            this.writeXmm128U32(regIdx, xmmWords);
          } else if (regField === 2 || regField === 6) {
            const shift = Math.min(63, count) & 0x3f;
            for (let lane = 0; lane < 2; lane += 1) {
              const lo = xmmWords[lane * 2] >>> 0;
              const hi = xmmWords[lane * 2 + 1] >>> 0;
              const shifted = shiftPacked64(lo, hi, shift, regField === 6);
              xmmWords[lane * 2] = shifted.lo >>> 0;
              xmmWords[lane * 2 + 1] = shifted.hi >>> 0;
            }
            this.writeXmm128U32(regIdx, xmmWords);
          } else {
            return false;
          }
          this.writeReg(REG.EIP, (addr + len) >>> 0);
          return true;
        }
        if (op3 === 0xba) {
          const bytes = this.readMemBlock(addr + 1, 16);
          if (!bytes) {
            return false;
          }
          const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
          const imm = bytes[2 + modrmInfo.size] & 0xff;
          const bitIndex = imm & 0xff;
          let value = 0;
          let ea = 0;
          if (modrmInfo.mod === 3) {
            value = this.readReg16ByIndex(modrmInfo.rm) & 0xffff;
          } else {
            const base = this.calcEffectiveAddress(modrmInfo);
            if (base === null) {
              return false;
            }
            const wordOffset = (bitIndex >>> 4) >>> 0;
            ea = (base + (wordOffset * 2)) >>> 0;
            value = this.readMem16(ea) & 0xffff;
          }
          const op = modrmInfo.reg & 7;
          if (op !== 4 && op !== 5 && op !== 6 && op !== 7) {
            return stopInterpreterFault(
              this,
              "invalid-opcode",
              `Invalid 66 0F BA /${op} opcode at 0x${(addr >>> 0).toString(16)}`
            );
          }
          const result = bitTestModify(value, bitIndex, 16, op, this.readReg(REG.EFLAGS));
          if (op !== 4) {
            const nextVal = result.result & 0xffff;
            if (modrmInfo.mod === 3) {
              this.writeReg16ByIndex(modrmInfo.rm, nextVal & 0xffff);
            } else {
              this.writeMem16(ea, nextVal & 0xffff);
            }
          }
          this.writeReg(REG.EFLAGS, result.flags >>> 0);
          this.writeReg(REG.EIP, (addr + 4 + modrmInfo.size) >>> 0);
          return true;
        }
        if (op3 === 0x6b || op3 === 0x67) {
          const bytes = this.readMemBlock(addr + 1, 32);
          if (!bytes) {
            return false;
          }
          const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
          const len = 3 + modrmInfo.size;
          const regIdx = modrmInfo.reg & 7;
          const src = this.readModrmXmmSourceU32(modrmInfo, this.scratchXmmWordsA);
          if (!src) {
            return false;
          }
          const dst = this.readXmm128U32(regIdx, this.scratchXmmWordsB);
          if (op3 === 0x6b) { // packssdw xmm, xmm/m128
            const low = packssdw64(dst[0], dst[1], dst[2], dst[3]);
            const high = packssdw64(src[0], src[1], src[2], src[3]);
            this.scratchXmmWordsB[0] = low.lo >>> 0;
            this.scratchXmmWordsB[1] = low.hi >>> 0;
            this.scratchXmmWordsB[2] = high.lo >>> 0;
            this.scratchXmmWordsB[3] = high.hi >>> 0;
            this.writeXmm128U32(regIdx, this.scratchXmmWordsB);
          } else { // packuswb xmm, xmm/m128
            const low = packuswb64(dst[0], dst[1], dst[2], dst[3]);
            const high = packuswb64(src[0], src[1], src[2], src[3]);
            this.scratchXmmWordsB[0] = low.lo >>> 0;
            this.scratchXmmWordsB[1] = low.hi >>> 0;
            this.scratchXmmWordsB[2] = high.lo >>> 0;
            this.scratchXmmWordsB[3] = high.hi >>> 0;
            this.writeXmm128U32(regIdx, this.scratchXmmWordsB);
          }
          this.writeReg(REG.EIP, (addr + len) >>> 0);
          return true;
        }
        if (op3 === 0xa4 || op3 === 0xa5 || op3 === 0xac || op3 === 0xad) {
          const bytes = this.readMemBlock(addr + 1, 16);
          if (!bytes) {
            return false;
          }
          const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
          const count = (op3 === 0xa5 || op3 === 0xad)
            ? (this.readReg(REG.ECX) & 0xff)
            : (bytes[2 + modrmInfo.size] & 0xff);
          let dest = 0;
          if (modrmInfo.mod === 3) {
            dest = this.readReg16ByIndex(modrmInfo.rm);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea === null) {
              return false;
            }
            dest = this.readMem16(ea);
          }
          const src = this.readReg16ByIndex(modrmInfo.reg);
          const flags = this.readReg(REG.EFLAGS);
          const res = doubleShift(dest, src, count, 16, op3 === 0xa4 || op3 === 0xa5, flags);
          if (!res.ok) {
            return false;
          }
          const result = res.result & 0xffff;
          if (modrmInfo.mod === 3) {
            this.writeReg16ByIndex(modrmInfo.rm, result);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea === null) {
              return false;
            }
            this.writeMem16(ea, result);
          }
          this.writeReg(REG.EFLAGS, res.flags >>> 0);
          const len = (op3 === 0xa5 || op3 === 0xad) ? (3 + modrmInfo.size) : (4 + modrmInfo.size);
          this.writeReg(REG.EIP, (addr + len) >>> 0);
          return true;
        }
      }
      if (op2 === 0x8b || op2 === 0x89 || op2 === 0x8d) {
        const bytes = this.readMemBlock(addr + 1, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
        const len = 2 + modrmInfo.size;
        if (op2 === 0x8d) { // lea r16, m
          if (modrmInfo.mod === 3) {
            return false;
          }
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          this.writeReg16ByIndex(modrmInfo.reg, ea & 0xffff);
          this.writeReg(REG.EIP, (addr + len) >>> 0);
          return true;
        }
        if (op2 === 0x8b) { // mov r16, r/m16
          let value = 0;
          if (modrmInfo.mod === 3) {
            value = this.readReg16ByIndex(modrmInfo.rm);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea === null) {
              return false;
            }
            value = this.readMem16(ea);
          }
          this.writeReg16ByIndex(modrmInfo.reg, value & 0xffff);
          this.writeReg(REG.EIP, (addr + len) >>> 0);
          return true;
        }
        // op2 === 0x89: mov r/m16, r16
        const value = this.readReg16ByIndex(modrmInfo.reg);
        if (modrmInfo.mod === 3) {
          this.writeReg16ByIndex(modrmInfo.rm, value & 0xffff);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          this.writeMem16(ea, value & 0xffff);
        }
        this.writeReg(REG.EIP, (addr + len) >>> 0);
        return true;
      }
      if (op2 === 0xc7) {
        const bytes = this.readMemBlock(addr + 1, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
        const immOffset = 1 + modrmInfo.size;
        const imm16 = (bytes[immOffset] | (bytes[immOffset + 1] << 8)) & 0xffff;
        if (modrmInfo.mod === 3) {
          const regIdx = modrmInfo.rm & 7;
          const regVal = this.readReg32ByIndex(regIdx);
          const nextVal = (regVal & 0xffff0000) | imm16;
          this.writeReg32ByIndex(regIdx, nextVal >>> 0);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          this.writeMem16(ea, imm16);
        }
        this.writeReg(REG.EIP, (addr + 1 + immOffset + 2) >>> 0);
        return true;
      }
      if (op2 === 0xa1 || op2 === 0xa3) {
        const imm =
          this.readMem8((addr + 2) >>> 0) |
          (this.readMem8((addr + 3) >>> 0) << 8) |
          (this.readMem8((addr + 4) >>> 0) << 16) |
          (this.readMem8((addr + 5) >>> 0) << 24);
        const ea = imm >>> 0;
        if (op2 === 0xa1) {
          const value = this.readMem16(ea);
          const eax = this.readReg(REG.EAX);
          const next = (eax & 0xffff0000) | (value & 0xffff);
          this.writeReg(REG.EAX, next >>> 0);
        } else {
          const eax = this.readReg(REG.EAX);
          this.writeMem16(ea, eax & 0xffff);
        }
        this.writeReg(REG.EIP, (addr + 6) >>> 0);
        return true;
      }
      if (
        op2 === 0x05 ||
        op2 === 0x0d ||
        op2 === 0x15 ||
        op2 === 0x25 ||
        op2 === 0x2d ||
        op2 === 0x35 ||
        op2 === 0x3d ||
        op2 === 0xa9
      ) {
        const imm16 = this.readMem16((addr + 2) >>> 0) & 0xffff;
        const ax = this.readReg(REG.EAX) & 0xffff;
        const op = op2 === 0x05 ? 0
          : (op2 === 0x0d ? 1
            : (op2 === 0x15 ? 2
              : (op2 === 0x25 ? 4
                : (op2 === 0x2d ? 5
                  : (op2 === 0x35 ? 6
                    : (op2 === 0x3d ? 7 : 8))))));
        const alu = aluBinaryWidth(op, ax, imm16, 16, this.readReg(REG.EFLAGS));
        if (op2 !== 0x3d && op2 !== 0xa9) {
          this.writeReg(REG.EAX, (this.readReg(REG.EAX) & 0xffff0000) | (alu.result & 0xffff));
        }
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
        this.writeReg(REG.EIP, (addr + 4) >>> 0);
        return true;
      }
      if (
        op2 === 0x89 || op2 === 0x8b ||
        op2 === 0x01 || op2 === 0x03 ||
        op2 === 0x09 || op2 === 0x0b ||
        op2 === 0x21 || op2 === 0x23 ||
        op2 === 0x29 || op2 === 0x39 ||
        op2 === 0x2b || op2 === 0x3b ||
        op2 === 0x85
      ) {
        const bytes = this.readMemBlock(addr + 1, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
        const regVal = this.readReg16ByIndex(modrmInfo.reg);
        let rmVal = 0;
        if (modrmInfo.mod === 3) {
          rmVal = this.readReg16ByIndex(modrmInfo.rm);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          rmVal = this.readMem16(ea);
        }
        if (op2 === 0x89) { // mov r/m16, r16
          if (modrmInfo.mod === 3) {
            this.writeReg16ByIndex(modrmInfo.rm, regVal);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea === null) {
              return false;
            }
            this.writeMem16(ea, regVal);
          }
        } else if (op2 === 0x8b) { // mov r16, r/m16
          this.writeReg16ByIndex(modrmInfo.reg, rmVal);
        } else if (op2 === 0x01 || op2 === 0x09 || op2 === 0x21 || op2 === 0x29) {
          const op = op2 === 0x01 ? 0 : (op2 === 0x09 ? 1 : (op2 === 0x21 ? 4 : 5));
          const alu = aluBinaryWidth(op, rmVal, regVal, 16, this.readReg(REG.EFLAGS));
          this.writeReg(REG.EFLAGS, alu.flags >>> 0);
          if (modrmInfo.mod === 3) {
            this.writeReg16ByIndex(modrmInfo.rm, alu.result & 0xffff);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea === null) {
              return false;
            }
            this.writeMem16(ea, alu.result & 0xffff);
          }
        } else if (op2 === 0x03 || op2 === 0x0b || op2 === 0x23 || op2 === 0x2b) {
          const op = op2 === 0x03 ? 0 : (op2 === 0x0b ? 1 : (op2 === 0x23 ? 4 : 5));
          const alu = aluBinaryWidth(op, regVal, rmVal, 16, this.readReg(REG.EFLAGS));
          this.writeReg(REG.EFLAGS, alu.flags >>> 0);
          this.writeReg16ByIndex(modrmInfo.reg, alu.result & 0xffff);
        } else if (op2 === 0x39) {
          const alu = aluBinaryWidth(7, rmVal, regVal, 16, this.readReg(REG.EFLAGS));
          this.writeReg(REG.EFLAGS, alu.flags >>> 0);
        } else if (op2 === 0x3b) {
          const alu = aluBinaryWidth(7, regVal, rmVal, 16, this.readReg(REG.EFLAGS));
          this.writeReg(REG.EFLAGS, alu.flags >>> 0);
        } else if (op2 === 0x85) {
          const alu = aluBinaryWidth(8, rmVal, regVal, 16, this.readReg(REG.EFLAGS));
          this.writeReg(REG.EFLAGS, alu.flags >>> 0);
        }
        this.writeReg(REG.EIP, (addr + 2 + modrmInfo.size) >>> 0);
        return true;
      }
      if (op2 === 0x31 || op2 === 0x33) { // xor r/m16, r16 | xor r16, r/m16
        const bytes = this.readMemBlock(addr + 1, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
        const regVal = this.readReg16ByIndex(modrmInfo.reg) & 0xffff;
        let rmVal = 0;
        if (modrmInfo.mod === 3) {
          rmVal = this.readReg16ByIndex(modrmInfo.rm) & 0xffff;
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          rmVal = this.readMem16(ea) & 0xffff;
        }
        const alu = op2 === 0x31
          ? aluBinaryWidth(6, rmVal, regVal, 16, this.readReg(REG.EFLAGS))
          : aluBinaryWidth(6, regVal, rmVal, 16, this.readReg(REG.EFLAGS));
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
        if (op2 === 0x31) {
          if (modrmInfo.mod === 3) {
            this.writeReg16ByIndex(modrmInfo.rm, alu.result & 0xffff);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea === null) {
              return false;
            }
            this.writeMem16(ea, alu.result & 0xffff);
          }
        } else {
          this.writeReg16ByIndex(modrmInfo.reg, alu.result & 0xffff);
        }
        this.writeReg(REG.EIP, (addr + 2 + modrmInfo.size) >>> 0);
        return true;
      }
      if (op2 === 0x87) { // xchg r/m16, r16
        const bytes = this.readMemBlock(addr + 1, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
        const regVal = this.readReg16ByIndex(modrmInfo.reg) & 0xffff;
        if (modrmInfo.mod === 3) {
          const rmVal = this.readReg16ByIndex(modrmInfo.rm) & 0xffff;
          this.writeReg16ByIndex(modrmInfo.reg, rmVal);
          this.writeReg16ByIndex(modrmInfo.rm, regVal);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          const rmVal = this.readMem16(ea) & 0xffff;
          this.writeMem16(ea, regVal);
          this.writeReg16ByIndex(modrmInfo.reg, rmVal);
        }
        this.writeReg(REG.EIP, (addr + 2 + modrmInfo.size) >>> 0);
        return true;
      }
      if (op2 >= 0xb8 && op2 <= 0xbf) {
        const regIdx = op2 - 0xb8;
        const imm16 = this.readMem16((addr + 2) >>> 0);
        this.writeReg16ByIndex(regIdx, imm16);
        this.writeReg(REG.EIP, (addr + 4) >>> 0);
        return true;
      }
      if (op2 === 0x80 || op2 === 0x82) {
        const bytes = this.readMemBlock(addr + 1, 24);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
        const regField = modrmInfo.reg & 7;
        const imm = bytes[1 + modrmInfo.size] & 0xff;
        let op1 = 0;
        if (modrmInfo.mod === 3) {
          op1 = this.readReg8ByIndex(modrmInfo.rm);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          op1 = this.readMem8(ea);
        }
        if (regField > 7) {
          return false;
        }
        const alu = aluBinaryWidth(regField, op1, imm, 8, this.readReg(REG.EFLAGS));
        if (regField !== 7) {
          if (modrmInfo.mod === 3) {
            this.writeReg8ByIndex(modrmInfo.rm, alu.result & 0xff);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea === null) {
              return false;
            }
            this.writeMem8(ea, alu.result & 0xff);
          }
        }
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
        this.writeReg(REG.EIP, (addr + 2 + modrmInfo.size + 1) >>> 0);
        return true;
      }
      if (op2 === 0x81 || op2 === 0x83) {
        const bytes = this.readMemBlock(addr + 1, 24);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
        const regField = modrmInfo.reg & 7;
        let imm = 0;
        if (op2 === 0x81) {
          imm = this.readMem16((addr + 2 + modrmInfo.size) >>> 0) & 0xffff;
        } else {
          imm = ((bytes[1 + modrmInfo.size] << 24) >> 24) & 0xffff;
        }
        let op1 = 0;
        if (modrmInfo.mod === 3) {
          op1 = this.readReg16ByIndex(modrmInfo.rm);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          op1 = this.readMem16(ea);
        }
        if (regField > 7) {
          return false;
        }
        const alu = aluBinaryWidth(regField, op1, imm, 16, this.readReg(REG.EFLAGS));
        if (regField !== 7) {
          if (modrmInfo.mod === 3) {
            this.writeReg16ByIndex(modrmInfo.rm, alu.result & 0xffff);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea === null) {
              return false;
            }
            this.writeMem16(ea, alu.result & 0xffff);
          }
        }
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
        const len = op2 === 0x81 ? (2 + modrmInfo.size + 2) : (2 + modrmInfo.size + 1);
        this.writeReg(REG.EIP, (addr + len) >>> 0);
        return true;
      }
      if (op2 === 0xf7) {
        const bytes = this.readMemBlock(addr + 1, 20);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
        const regField = modrmInfo.reg & 7;
        const immOffset = 1 + modrmInfo.size;
        const readOp = () => {
          if (modrmInfo.mod === 3) {
            return this.readReg16ByIndex(modrmInfo.rm);
          }
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return null;
          }
          return this.readMem16(ea);
        };
        const writeOp = (value) => {
          if (modrmInfo.mod === 3) {
            this.writeReg16ByIndex(modrmInfo.rm, value & 0xffff);
            return true;
          }
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          this.writeMem16(ea, value & 0xffff);
          return true;
        };

        if (regField === 0 || regField === 1) {
          const imm = this.readMem16((addr + 2 + modrmInfo.size) >>> 0);
          const op = readOp();
          if (op === null) {
            return false;
          }
          const alu = aluBinaryWidth(8, op, imm, 16, this.readReg(REG.EFLAGS));
          this.writeReg(REG.EFLAGS, alu.flags >>> 0);
          this.writeReg(REG.EIP, (addr + 2 + modrmInfo.size + 2) >>> 0);
          return true;
        }
        if (regField === 2) {
          const op = readOp();
          if (op === null) {
            return false;
          }
          if (!writeOp((~op) & 0xffff)) {
            return false;
          }
          this.writeReg(REG.EIP, (addr + 2 + modrmInfo.size) >>> 0);
          return true;
        }
        if (regField === 3) {
          const op = readOp();
          if (op === null) {
            return false;
          }
          const alu = aluBinaryWidth(5, 0, op, 16, this.readReg(REG.EFLAGS));
          this.writeReg(REG.EFLAGS, alu.flags >>> 0);
          if (!writeOp(alu.result & 0xffff)) {
            return false;
          }
          this.writeReg(REG.EIP, (addr + 2 + modrmInfo.size) >>> 0);
          return true;
        }
        if (regField === 4 || regField === 5) {
          const op = readOp();
          if (op === null) {
            return false;
          }
          const eax = this.readReg(REG.EAX) >>> 0;
          const result = mulFullWidth(eax & 0xffff, op & 0xffff, 16, regField === 5, this.readReg(REG.EFLAGS));
          this.writeReg(REG.EAX, (eax & 0xffff0000) | (result.lo & 0xffff));
          const edx = this.readReg(REG.EDX) >>> 0;
          this.writeReg(REG.EDX, (edx & 0xffff0000) | (result.hi & 0xffff));
          this.writeReg(REG.EFLAGS, result.flags >>> 0);
          this.writeReg(REG.EIP, (addr + 2 + modrmInfo.size) >>> 0);
          return true;
        }
        if (regField === 6 || regField === 7) {
          const op = readOp();
          if (op === null || op === 0) {
            return false;
          }
          const eax = this.readReg(REG.EAX) >>> 0;
          const edx = this.readReg(REG.EDX) >>> 0;
          const div = divideFullWidth(edx & 0xffff, eax & 0xffff, op & 0xffff, 16, regField === 7);
          if (!div.ok) {
            return false;
          }
          this.writeReg(REG.EAX, (eax & 0xffff0000) | (div.quotient & 0xffff));
          this.writeReg(REG.EDX, (edx & 0xffff0000) | (div.remainder & 0xffff));
          this.writeReg(REG.EIP, (addr + 2 + modrmInfo.size) >>> 0);
          return true;
        }
        return false;
      }
      if (op2 >= 0x40 && op2 <= 0x47) {
        const regIdx = op2 - 0x40;
        const value = this.readReg16ByIndex(regIdx);
        const origFlags = this.readReg(REG.EFLAGS);
        const alu = aluBinaryWidth(0, value, 1, 16, origFlags);
        let flags = alu.flags >>> 0;
        flags = (flags & ~FLAG_CF) | (origFlags & FLAG_CF);
        this.writeReg16ByIndex(regIdx, alu.result & 0xffff);
        this.writeReg(REG.EFLAGS, flags >>> 0);
        this.writeReg(REG.EIP, (addr + 2) >>> 0);
        return true;
      }
      if (op2 >= 0x48 && op2 <= 0x4f) {
        const regIdx = op2 - 0x48;
        const value = this.readReg16ByIndex(regIdx);
        const origFlags = this.readReg(REG.EFLAGS);
        const alu = aluBinaryWidth(5, value, 1, 16, origFlags);
        let flags = alu.flags >>> 0;
        flags = (flags & ~FLAG_CF) | (origFlags & FLAG_CF);
        this.writeReg16ByIndex(regIdx, alu.result & 0xffff);
        this.writeReg(REG.EFLAGS, flags >>> 0);
        this.writeReg(REG.EIP, (addr + 2) >>> 0);
        return true;
      }
      if (op2 === 0xd1 || op2 === 0xc1 || op2 === 0xd3) {
        const bytes = this.readMemBlock(addr + 1, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
        const regField = modrmInfo.reg & 7;
        const shift =
          op2 === 0xd1
            ? 1
            : (op2 === 0xd3 ? (this.readReg(REG.ECX) & 0xff) : (bytes[1 + modrmInfo.size] & 0xff));
        let value = 0;
        if (modrmInfo.mod === 3) {
          value = this.readReg16ByIndex(modrmInfo.rm);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          value = this.readMem16(ea);
        }
        const flags = this.readReg(REG.EFLAGS);
        const res = shiftRotate(value, shift, 16, regField, flags);
        if (!res.ok) {
          return false;
        }
        const result = res.result & 0xffff;
        if (modrmInfo.mod === 3) {
          this.writeReg16ByIndex(modrmInfo.rm, result);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          this.writeMem16(ea, result);
        }
        this.writeReg(REG.EFLAGS, res.flags >>> 0);
        const len = op2 === 0xc1 ? (2 + modrmInfo.size + 1) : (2 + modrmInfo.size);
        this.writeReg(REG.EIP, (addr + len) >>> 0);
        return true;
      }
      if (op2 === 0xf3 || op2 === 0xf2) {
        const op3 = this.readMem8((addr + 2) >>> 0);
        if (
          op3 === 0xa4 || op3 === 0xa5 || op3 === 0xaa || op3 === 0xab ||
          op3 === 0xac || op3 === 0xad || op3 === 0xa6 || op3 === 0xa7 ||
          op3 === 0xae || op3 === 0xaf || op3 === 0x6c || op3 === 0x6d ||
          op3 === 0x6e || op3 === 0x6f
        ) {
          return this.executeStringInstruction((addr + 2) >>> 0, op2, 2);
        }
      }
      if (
        op2 === 0xa4 || op2 === 0xa5 || op2 === 0xaa || op2 === 0xab ||
        op2 === 0xac || op2 === 0xad || op2 === 0xa6 || op2 === 0xa7 ||
        op2 === 0xae || op2 === 0xaf || op2 === 0x6c || op2 === 0x6d ||
        op2 === 0x6e || op2 === 0x6f
      ) {
        return this.executeStringInstruction((addr + 1) >>> 0, 0, 2);
      }
      this.writeReg(REG.EIP, (addr + 1) >>> 0);
      return true;
    }
    if (opcode === 0x2e || opcode === 0x36 || opcode === 0x3e || opcode === 0x26 || opcode === 0x64 || opcode === 0x65) {
      const prevSeg = this.segOverride;
      this.segOverride = opcode;
      let ok = false;
      try {
        ok = this.executeBasicInstruction((addr + 1) >>> 0);
      } finally {
        this.segOverride = prevSeg;
      }
      return ok;
    }
    if (opcode === 0xf3 || opcode === 0xf2) {
      const next = (addr + 1) >>> 0;
      const op2 = this.readMem8(next);
      if (op2 === 0x66) {
        const op3 = this.readMem8((addr + 2) >>> 0);
        if (
          op3 === 0xa4 || op3 === 0xa5 || op3 === 0xaa || op3 === 0xab ||
          op3 === 0xac || op3 === 0xad || op3 === 0xa6 || op3 === 0xa7 ||
          op3 === 0xae || op3 === 0xaf || op3 === 0x6c || op3 === 0x6d ||
          op3 === 0x6e || op3 === 0x6f
        ) {
          return this.executeStringInstruction((addr + 2) >>> 0, opcode, 2);
        }
      }
      if (
        op2 === 0xa4 || op2 === 0xa5 || op2 === 0xaa || op2 === 0xab ||
        op2 === 0xac || op2 === 0xad || op2 === 0xa6 || op2 === 0xa7 ||
        op2 === 0xae || op2 === 0xaf || op2 === 0x6c || op2 === 0x6d ||
        op2 === 0x6e || op2 === 0x6f
      ) {
        return this.executeStringInstruction(next, opcode, 4);
      }
      if (op2 === 0x0f) {
        const ok = this.executeSseInstruction(addr, opcode);
        if (ok) {
          return true;
        }
      }
      this.writeReg(REG.EIP, next);
      return true;
    }
    const _fastHandler = this._opcodeFastTable && this._opcodeFastTable[opcode];
    if (_fastHandler) {
      return _fastHandler.call(this, addr);
    }
    switch (opcode) {
    case 0x06:
    case 0x0e:
    case 0x16:
    case 0x1e:
    if (opcode === 0x06 || opcode === 0x0e || opcode === 0x16 || opcode === 0x1e) { // push seg
      const seg =
        opcode === 0x06 ? this.segES :
        opcode === 0x0e ? this.segCS :
        opcode === 0x16 ? this.segSS :
        this.segDS;
      let esp = this.readReg(REG.ESP) >>> 0;
      esp = (esp - 2) >>> 0;
      this.writeMem16(esp, seg & 0xffff);
      this.writeReg(REG.ESP, esp >>> 0);
      this.writeReg(REG.EIP, (addr + 1) >>> 0);
      return true;
    }
    case 0x07:
    case 0x17:
    case 0x1f:
    if (opcode === 0x07 || opcode === 0x17 || opcode === 0x1f) { // pop seg
      let esp = this.readReg(REG.ESP) >>> 0;
      const value = this.readMem16(esp);
      esp = (esp + 2) >>> 0;
      this.writeReg(REG.ESP, esp >>> 0);
      if (opcode === 0x07) {
        this.segES = value & 0xffff;
      } else if (opcode === 0x17) {
        this.segSS = value & 0xffff;
      } else {
        this.segDS = value & 0xffff;
      }
      this.writeReg(REG.EIP, (addr + 1) >>> 0);
      return true;
    }
    case 0x6c:
    case 0x6d:
    case 0x6e:
    case 0x6f:
    case 0xa4:
    case 0xa5:
    case 0xa6:
    case 0xa7:
    case 0xaa:
    case 0xab:
    case 0xac:
    case 0xad:
    case 0xae:
    case 0xaf:
    if (
      opcode === 0xa4 ||
      opcode === 0xa5 ||
      opcode === 0xaa ||
      opcode === 0xab ||
      opcode === 0xac ||
      opcode === 0xad ||
      opcode === 0xa6 ||
      opcode === 0xa7 ||
      opcode === 0xae ||
      opcode === 0xaf ||
      opcode === 0x6c ||
      opcode === 0x6d ||
      opcode === 0x6e ||
      opcode === 0x6f
    ) {
      return this.executeStringInstruction(addr, 0, 4);
    }
    case 0xd7:
    if (opcode === 0xd7) { // XLAT
      const eax = this.readReg(REG.EAX) >>> 0;
      const al = eax & 0xff;
      const ebx = this.readReg(REG.EBX) >>> 0;
      const addr8 = (ebx + al) >>> 0;
      const value = this.readMem8(addr8) & 0xff;
      this.writeReg(REG.EAX, ((eax & 0xffffff00) | value) >>> 0);
      this.writeReg(REG.EIP, (addr + 1) >>> 0);
      return true;
    }
    case 0x98:
    if (opcode === 0x98) { // CWDE
      const ax = this.readReg(REG.EAX) & 0xffff;
      const eax = (ax << 16) >> 16;
      this.writeReg(REG.EAX, eax >>> 0);
      this.writeReg(REG.EIP, (addr + 1) >>> 0);
      return true;
    }
    case 0x90:
    if (opcode === 0x90) {
      this.writeReg(REG.EIP, (addr + 1) >>> 0);
      return true;
    }
    case 0x91:
    case 0x92:
    case 0x93:
    case 0x94:
    case 0x95:
    case 0x96:
    case 0x97:
    if (opcode >= 0x91 && opcode <= 0x97) {
      const regIdx = opcode - 0x90;
      const eax = this.readReg(REG.EAX);
      const other = this.readReg32ByIndex(regIdx);
      this.writeReg(REG.EAX, other >>> 0);
      this.writeReg32ByIndex(regIdx, eax >>> 0);
      this.writeReg(REG.EIP, (addr + 1) >>> 0);
      return true;
    }
    case 0x99:
    if (opcode === 0x99) {
      const eax = this.readReg(REG.EAX) >>> 0;
      const edx = (eax & 0x80000000) ? 0xffffffff : 0x00000000;
      this.writeReg(REG.EDX, edx >>> 0);
      this.writeReg(REG.EIP, (addr + 1) >>> 0);
      return true;
    }
    case 0x9e:
    if (opcode === 0x9e) { // sahf
      const eax = this.readReg(REG.EAX) >>> 0;
      const ah = (eax >>> 8) & 0xff;
      let flags = this.readReg(REG.EFLAGS);
      flags &= ~(FLAG_SF | FLAG_ZF | FLAG_AF | FLAG_PF | FLAG_CF);
      if (ah & 0x80) flags |= FLAG_SF;
      if (ah & 0x40) flags |= FLAG_ZF;
      if (ah & 0x10) flags |= FLAG_AF;
      if (ah & 0x04) flags |= FLAG_PF;
      if (ah & 0x01) flags |= FLAG_CF;
      this.writeReg(REG.EFLAGS, flags >>> 0);
      this.writeReg(REG.EIP, (addr + 1) >>> 0);
      return true;
    }
    case 0x27:
    case 0x2f:
    if (opcode === 0x27 || opcode === 0x2f) { // DAA/DAS
      let eax = this.readReg(REG.EAX) >>> 0;
      let al = eax & 0xff;
      const oldAl = al;
      let flags = this.readReg(REG.EFLAGS) >>> 0;
      const cf = (flags & FLAG_CF) !== 0;
      const af = (flags & FLAG_AF) !== 0;
      if (((al & 0x0f) > 9) || af) {
        al = opcode === 0x27 ? ((al + 6) & 0xff) : ((al - 6) & 0xff);
        flags |= FLAG_AF;
      } else {
        flags &= ~FLAG_AF;
      }
      if (oldAl > 0x99 || cf) {
        al = opcode === 0x27 ? ((al + 0x60) & 0xff) : ((al - 0x60) & 0xff);
        flags |= FLAG_CF;
      } else {
        flags &= ~FLAG_CF;
      }
      flags &= ~(FLAG_ZF | FLAG_SF | FLAG_PF);
      if (al === 0) flags |= FLAG_ZF;
      if (al & 0x80) flags |= FLAG_SF;
      if (parityEven8(al)) flags |= FLAG_PF;
      eax = (eax & 0xffffff00) | al;
      this.writeReg(REG.EAX, eax >>> 0);
      this.writeReg(REG.EFLAGS, flags >>> 0);
      this.writeReg(REG.EIP, (addr + 1) >>> 0);
      return true;
    }
    case 0x37:
    case 0x3f:
    if (opcode === 0x37 || opcode === 0x3f) { // AAA/AAS
      let eax = this.readReg(REG.EAX) >>> 0;
      let al = eax & 0xff;
      let ah = (eax >>> 8) & 0xff;
      let flags = this.readReg(REG.EFLAGS) >>> 0;
      if (((al & 0x0f) > 9) || (flags & FLAG_AF)) {
        al = opcode === 0x37 ? ((al + 6) & 0xff) : ((al - 6) & 0xff);
        ah = opcode === 0x37 ? ((ah + 1) & 0xff) : ((ah - 1) & 0xff);
        flags |= (FLAG_CF | FLAG_AF);
      } else {
        flags &= ~(FLAG_CF | FLAG_AF);
      }
      al &= 0x0f;
      this.writeReg8ByIndex(0, al);
      this.writeReg8ByIndex(4, ah);
      this.writeReg(REG.EFLAGS, flags >>> 0);
      this.writeReg(REG.EIP, (addr + 1) >>> 0);
      return true;
    }
    case 0xd4:
    case 0xd5:
    if (opcode === 0xd4 || opcode === 0xd5) { // AAM/AAD
      const imm = this.readMem8((addr + 1) >>> 0) & 0xff;
      if (imm === 0) {
        return false;
      }
      let eax = this.readReg(REG.EAX) >>> 0;
      let al = eax & 0xff;
      let ah = (eax >>> 8) & 0xff;
      if (opcode === 0xd4) {
        ah = Math.floor(al / imm) & 0xff;
        al = (al % imm) & 0xff;
      } else {
        al = ((ah * imm + al) & 0xff);
        ah = 0;
      }
      this.writeReg8ByIndex(0, al);
      this.writeReg8ByIndex(4, ah);
      let flags = this.readReg(REG.EFLAGS) >>> 0;
      flags &= ~(FLAG_ZF | FLAG_SF | FLAG_PF);
      if (al === 0) flags |= FLAG_ZF;
      if (al & 0x80) flags |= FLAG_SF;
      if (parityEven8(al)) flags |= FLAG_PF;
      this.writeReg(REG.EFLAGS, flags >>> 0);
      this.writeReg(REG.EIP, (addr + 2) >>> 0);
      return true;
    }
    case 0x9c:
    if (opcode === 0x9c) { // pushf
      const flags = this.readReg(REG.EFLAGS) >>> 0;
      let esp = this.readReg(REG.ESP) >>> 0;
      esp = (esp - 4) >>> 0;
      this.writeMem32(esp, flags >>> 0);
      this.writeReg(REG.ESP, esp >>> 0);
      this.writeReg(REG.EIP, (addr + 1) >>> 0);
      return true;
    }
    case 0x9d:
    if (opcode === 0x9d) { // popf
      let esp = this.readReg(REG.ESP);
      const flags = this.readMem32(esp);
      esp = (esp + 4) >>> 0;
      this.writeReg(REG.EFLAGS, flags >>> 0);
      this.writeReg(REG.ESP, esp >>> 0);
      this.writeReg(REG.EIP, (addr + 1) >>> 0);
      return true;
    }
    case 0xfc:
    if (opcode === 0xfc) { // cld
      const flags = this.readReg(REG.EFLAGS) & ~FLAG_DF;
      this.writeReg(REG.EFLAGS, flags >>> 0);
      this.writeReg(REG.EIP, (addr + 1) >>> 0);
      return true;
    }
    case 0xfa:
    case 0xfb:
    if (opcode === 0xfa || opcode === 0xfb) { // cli/sti
      this.writeReg(REG.EIP, (addr + 1) >>> 0);
      return true;
    }
    case 0xfd:
    if (opcode === 0xfd) { // std
      const flags = this.readReg(REG.EFLAGS) | FLAG_DF;
      this.writeReg(REG.EFLAGS, flags >>> 0);
      this.writeReg(REG.EIP, (addr + 1) >>> 0);
      return true;
    }
    case 0xf8:
    if (opcode === 0xf8) { // clc
      const flags = this.readReg(REG.EFLAGS) & ~FLAG_CF;
      this.writeReg(REG.EFLAGS, flags >>> 0);
      this.writeReg(REG.EIP, (addr + 1) >>> 0);
      return true;
    }
    case 0xf9:
    if (opcode === 0xf9) { // stc
      const flags = this.readReg(REG.EFLAGS) | FLAG_CF;
      this.writeReg(REG.EFLAGS, flags >>> 0);
      this.writeReg(REG.EIP, (addr + 1) >>> 0);
      return true;
    }
    case 0xf5:
    if (opcode === 0xf5) { // cmc
      const flags = this.readReg(REG.EFLAGS) ^ FLAG_CF;
      this.writeReg(REG.EFLAGS, flags >>> 0);
      this.writeReg(REG.EIP, (addr + 1) >>> 0);
      return true;
    }
    case 0xb8:
    case 0xb9:
    case 0xba:
    case 0xbb:
    case 0xbc:
    case 0xbd:
    case 0xbe:
    case 0xbf:
    if (opcode >= 0xb8 && opcode <= 0xbf) {
      const regIdx = opcode - 0xb8;
      const imm = this.readMem32((addr + 1) >>> 0);
      this.writeReg32ByIndex(regIdx, imm >>> 0);
      this.writeReg(REG.EIP, (addr + 5) >>> 0);
      return true;
    }
    case 0xb0:
    case 0xb1:
    case 0xb2:
    case 0xb3:
    case 0xb4:
    case 0xb5:
    case 0xb6:
    case 0xb7:
    if (opcode >= 0xb0 && opcode <= 0xb7) {
      const regIdx = opcode - 0xb0;
      const imm = this.readMem8((addr + 1) >>> 0);
      this.writeReg8ByIndex(regIdx, imm);
      this.writeReg(REG.EIP, (addr + 2) >>> 0);
      return true;
    }
    case 0x68:
    if (opcode === 0x68) {
      const imm = this.readMem32((addr + 1) >>> 0);
      let esp = this.readReg(REG.ESP);
      esp = (esp - 4) >>> 0;
      this.writeMem32(esp, imm >>> 0);
      this.writeReg(REG.ESP, esp);
      this.writeReg(REG.EIP, (addr + 5) >>> 0);
      return true;
    }
    case 0x6a:
    if (opcode === 0x6a) {
      const imm8 = (this.readMem8((addr + 1) >>> 0) << 24) >> 24;
      let esp = this.readReg(REG.ESP);
      esp = (esp - 4) >>> 0;
      this.writeMem32(esp, imm8 >>> 0);
      this.writeReg(REG.ESP, esp);
      this.writeReg(REG.EIP, (addr + 2) >>> 0);
      return true;
    }
    case 0x60:
    if (opcode === 0x60) {
      let esp = this.readReg(REG.ESP);
      const eax = this.readReg(REG.EAX);
      const ecx = this.readReg(REG.ECX);
      const edx = this.readReg(REG.EDX);
      const ebx = this.readReg(REG.EBX);
      const ebp = this.readReg(REG.EBP);
      const esi = this.readReg(REG.ESI);
      const edi = this.readReg(REG.EDI);
      const espOrig = esp >>> 0;

      esp = (esp - 4) >>> 0; this.writeMem32(esp, eax);
      esp = (esp - 4) >>> 0; this.writeMem32(esp, ecx);
      esp = (esp - 4) >>> 0; this.writeMem32(esp, edx);
      esp = (esp - 4) >>> 0; this.writeMem32(esp, ebx);
      esp = (esp - 4) >>> 0; this.writeMem32(esp, espOrig);
      esp = (esp - 4) >>> 0; this.writeMem32(esp, ebp);
      esp = (esp - 4) >>> 0; this.writeMem32(esp, esi);
      esp = (esp - 4) >>> 0; this.writeMem32(esp, edi);

      this.writeReg(REG.ESP, esp >>> 0);
      this.writeReg(REG.EIP, (addr + 1) >>> 0);
      return true;
    }
    case 0x61:
    if (opcode === 0x61) {
      let esp = this.readReg(REG.ESP);
      const edi = this.readMem32(esp); esp = (esp + 4) >>> 0;
      const esi = this.readMem32(esp); esp = (esp + 4) >>> 0;
      const ebp = this.readMem32(esp); esp = (esp + 4) >>> 0;
      esp = (esp + 4) >>> 0; // skip ESP
      const ebx = this.readMem32(esp); esp = (esp + 4) >>> 0;
      const edx = this.readMem32(esp); esp = (esp + 4) >>> 0;
      const ecx = this.readMem32(esp); esp = (esp + 4) >>> 0;
      const eax = this.readMem32(esp); esp = (esp + 4) >>> 0;
      this.writeReg(REG.EDI, edi);
      this.writeReg(REG.ESI, esi);
      this.writeReg(REG.EBP, ebp);
      this.writeReg(REG.EBX, ebx);
      this.writeReg(REG.EDX, edx);
      this.writeReg(REG.ECX, ecx);
      this.writeReg(REG.EAX, eax);
      this.writeReg(REG.ESP, esp >>> 0);
      this.writeReg(REG.EIP, (addr + 1) >>> 0);
      return true;
    }
    case 0x62:
    if (opcode === 0x62) { // BOUND r32, m32&32
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      if (modrmInfo.mod === 3) {
        return stopInterpreterFault(
          this,
          "invalid-opcode",
          `BOUND requires a memory operand at 0x${(addr >>> 0).toString(16)}`
        );
      }
      const ea = this.calcEffectiveAddress(modrmInfo);
      if (ea === null) {
        return false;
      }
      const index = this.readReg32ByIndex(modrmInfo.reg) | 0;
      const lower = this.readMem32(ea) | 0;
      const upper = this.readMem32((ea + 4) >>> 0) | 0;
      if (index < lower || index > upper) {
        return stopInterpreterFault(
          this,
          "bound-range",
          `BOUND fault at 0x${(addr >>> 0).toString(16)}: ${index} outside [${lower}, ${upper}]`
        );
      }
      this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size) >>> 0);
      return true;
    }
    case 0x63:
    if (opcode === 0x63) { // ARPL r/m16, r16
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      const src = this.readReg16ByIndex(modrmInfo.reg) & 0xffff;
      let dst = 0;
      if (modrmInfo.mod === 3) {
        dst = this.readReg16ByIndex(modrmInfo.rm) & 0xffff;
      } else {
        const ea = this.calcEffectiveAddress(modrmInfo);
        if (ea === null) {
          return false;
        }
        dst = this.readMem16(ea) & 0xffff;
      }
      let flags = this.readReg(REG.EFLAGS);
      if ((dst & 3) < (src & 3)) {
        dst = (dst & ~3) | (src & 3);
        flags |= FLAG_ZF;
      } else {
        flags &= ~FLAG_ZF;
      }
      if (modrmInfo.mod === 3) {
        this.writeReg16ByIndex(modrmInfo.rm, dst & 0xffff);
      } else {
        const ea = this.calcEffectiveAddress(modrmInfo);
        if (ea === null) {
          return false;
        }
        this.writeMem16(ea, dst & 0xffff);
      }
      this.writeReg(REG.EFLAGS, flags >>> 0);
      this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size) >>> 0);
      return true;
    }
    case 0xe8:
    if (opcode === 0xe8) {
      const promoted = this.promoteDynamicSoftInstruction(addr);
      if (promoted !== null) {
        return !!promoted;
      }
      const rel = this.readMem32((addr + 1) >>> 0) | 0;
      const next = (addr + 5) >>> 0;
      const target = (next + rel) >>> 0;
      let esp = this.readReg(REG.ESP);
      esp = (esp - 4) >>> 0;
      this.writeMem32(esp, next);
      this.writeReg(REG.ESP, esp);
      this.writeReg(REG.EIP, target);
      return true;
    }
    case 0x9a:
    if (opcode === 0x9a) { // call ptr16:32
      const offset = this.readMem32((addr + 1) >>> 0) >>> 0;
      const selector = this.readMem16((addr + 5) >>> 0) & 0xffff;
      const next = (addr + 7) >>> 0;
      let esp = this.readReg(REG.ESP) >>> 0;
      esp = (esp - 2) >>> 0;
      this.writeMem16(esp, this.segCS & 0xffff);
      esp = (esp - 4) >>> 0;
      this.writeMem32(esp, next >>> 0);
      this.writeReg(REG.ESP, esp >>> 0);
      this.segCS = selector & 0xffff;
      this.writeReg(REG.EIP, offset >>> 0);
      return true;
    }
    case 0xc2:
    if (opcode === 0xc2) { // ret imm16
      const imm = this.readMem16((addr + 1) >>> 0) >>> 0;
      let esp = this.readReg(REG.ESP);
      const target = this.readMem32(esp);
      esp = (esp + 4 + imm) >>> 0;
      this.writeReg(REG.ESP, esp);
      this.writeReg(REG.EIP, target >>> 0);
      return true;
    }
    case 0xca:
    if (opcode === 0xca) { // retf imm16
      const imm = this.readMem16((addr + 1) >>> 0) >>> 0;
      let esp = this.readReg(REG.ESP) >>> 0;
      const target = this.readMem32(esp); esp = (esp + 4) >>> 0;
      const selector = this.readMem16(esp); esp = (esp + 2) >>> 0;
      esp = (esp + imm) >>> 0;
      this.writeReg(REG.ESP, esp >>> 0);
      this.segCS = selector & 0xffff;
      this.writeReg(REG.EIP, target >>> 0);
      return true;
    }
    case 0xc3:
    if (opcode === 0xc3) {
      const promoted = this.promoteDynamicSoftInstruction(addr);
      if (promoted !== null) {
        return !!promoted;
      }
      let esp = this.readReg(REG.ESP);
      const target = this.readMem32(esp);
      esp = (esp + 4) >>> 0;
      this.writeReg(REG.ESP, esp);
      this.writeReg(REG.EIP, target >>> 0);
      return true;
    }
    case 0xcb:
    if (opcode === 0xcb) { // retf
      let esp = this.readReg(REG.ESP) >>> 0;
      const target = this.readMem32(esp); esp = (esp + 4) >>> 0;
      const selector = this.readMem16(esp); esp = (esp + 2) >>> 0;
      this.writeReg(REG.ESP, esp >>> 0);
      this.segCS = selector & 0xffff;
      this.writeReg(REG.EIP, target >>> 0);
      return true;
    }
    case 0xc8:
    if (opcode === 0xc8) { // ENTER imm16, imm8
      const imm = this.readMem16((addr + 1) >>> 0) & 0xffff;
      const level = this.readMem8((addr + 3) >>> 0) & 0x1f;
      let esp = this.readReg(REG.ESP) >>> 0;
      const oldEbp = this.readReg(REG.EBP) >>> 0;
      esp = (esp - 4) >>> 0;
      this.writeMem32(esp, oldEbp >>> 0);
      const frame = esp >>> 0;
      let nestingEbp = oldEbp >>> 0;
      for (let i = 1; i < level; i += 1) {
        nestingEbp = (nestingEbp - 4) >>> 0;
        const value = this.readMem32(nestingEbp);
        esp = (esp - 4) >>> 0;
        this.writeMem32(esp, value >>> 0);
      }
      if (level > 0) {
        esp = (esp - 4) >>> 0;
        this.writeMem32(esp, frame >>> 0);
      }
      this.writeReg(REG.EBP, frame >>> 0);
      esp = (esp - imm) >>> 0;
      this.writeReg(REG.ESP, esp >>> 0);
      this.writeReg(REG.EIP, (addr + 4) >>> 0);
      return true;
    }
    case 0xc9:
    if (opcode === 0xc9) { // LEAVE
      let esp = this.readReg(REG.EBP) >>> 0;
      const nextEbp = this.readMem32(esp);
      esp = (esp + 4) >>> 0;
      this.writeReg(REG.EBP, nextEbp >>> 0);
      this.writeReg(REG.ESP, esp >>> 0);
      this.writeReg(REG.EIP, (addr + 1) >>> 0);
      return true;
    }
    case 0xcf:
    if (opcode === 0xcf) { // IRET
      let esp = this.readReg(REG.ESP) >>> 0;
      const nextEip = this.readMem32(esp); esp = (esp + 4) >>> 0;
      esp = (esp + 4) >>> 0; // skip CS
      const nextFlags = this.readMem32(esp); esp = (esp + 4) >>> 0;
      this.writeReg(REG.EIP, nextEip >>> 0);
      this.writeReg(REG.EFLAGS, nextFlags >>> 0);
      this.writeReg(REG.ESP, esp >>> 0);
      return true;
    }
    case 0xe3:
    if (opcode === 0xe3) { // JECXZ/JCXZ
      const promoted = this.promoteDynamicSoftInstruction(addr);
      if (promoted !== null) {
        return !!promoted;
      }
      const rel8 = (this.readMem8((addr + 1) >>> 0) << 24) >> 24;
      const next = (addr + 2) >>> 0;
      const check = this.readCountReg(this.getActiveAddressSize());
      this.writeReg(REG.EIP, check === 0 ? (next + rel8) >>> 0 : next);
      return true;
    }
    case 0xe0:
    case 0xe1:
    case 0xe2:
    if (opcode === 0xe0 || opcode === 0xe1 || opcode === 0xe2) {
      const promoted = this.promoteDynamicSoftInstruction(addr);
      if (promoted !== null) {
        return !!promoted;
      }
      return this.executeLoopInstruction(addr, opcode, 2);
    }
    case 0xe9:
    if (opcode === 0xe9) {
      const promoted = this.promoteDynamicSoftInstruction(addr);
      if (promoted !== null) {
        return !!promoted;
      }
      const rel = this.readMem32((addr + 1) >>> 0) | 0;
      const next = (addr + 5) >>> 0;
      this.writeReg(REG.EIP, (next + rel) >>> 0);
      return true;
    }
    case 0xea:
    if (opcode === 0xea) { // jmp ptr16:32
      const offset = this.readMem32((addr + 1) >>> 0) >>> 0;
      const selector = this.readMem16((addr + 5) >>> 0) & 0xffff;
      this.segCS = selector & 0xffff;
      this.writeReg(REG.EIP, offset >>> 0);
      return true;
    }
    case 0xeb:
    if (opcode === 0xeb) {
      const promoted = this.promoteDynamicSoftInstruction(addr);
      if (promoted !== null) {
        return !!promoted;
      }
      const rel8 = (this.readMem8((addr + 1) >>> 0) << 24) >> 24;
      const next = (addr + 2) >>> 0;
      this.writeReg(REG.EIP, (next + rel8) >>> 0);
      return true;
    }
    case 0x08:
    case 0x0a:
    if (opcode === 0x08 || opcode === 0x0a) {
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      if (opcode === 0x08) {
        const rhs = this.readReg8ByIndex(modrmInfo.reg);
        if (modrmInfo.mod === 3) {
          const lhs = this.readReg8ByIndex(modrmInfo.rm);
          const alu = aluBinaryWidth(1, lhs, rhs, 8, this.readReg(REG.EFLAGS));
          this.writeReg8ByIndex(modrmInfo.rm, alu.result & 0xff);
          this.writeReg(REG.EFLAGS, alu.flags >>> 0);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          const lhs = this.readMem8(ea);
          const alu = aluBinaryWidth(1, lhs, rhs, 8, this.readReg(REG.EFLAGS));
          this.writeMem8(ea, alu.result & 0xff);
          this.writeReg(REG.EFLAGS, alu.flags >>> 0);
        }
      } else {
        let rhs = 0;
        if (modrmInfo.mod === 3) {
          rhs = this.readReg8ByIndex(modrmInfo.rm);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          rhs = this.readMem8(ea);
        }
        const lhs = this.readReg8ByIndex(modrmInfo.reg);
        const alu = aluBinaryWidth(1, lhs, rhs, 8, this.readReg(REG.EFLAGS));
        this.writeReg8ByIndex(modrmInfo.reg, alu.result & 0xff);
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      }
      this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size) >>> 0);
      return true;
    }
    case 0x09:
    if (opcode === 0x09) {
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      let lhs = 0;
      const rhs = this.readReg32ByIndex(modrmInfo.reg);
      if (modrmInfo.mod === 3) {
        lhs = this.readReg32ByIndex(modrmInfo.rm);
        const alu = aluBinaryWidth(1, lhs, rhs, 32, this.readReg(REG.EFLAGS));
        this.writeReg32ByIndex(modrmInfo.rm, alu.result >>> 0);
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      } else {
        const ea = this.calcEffectiveAddress(modrmInfo);
        if (ea === null) {
          return false;
        }
        lhs = this.readMem32(ea);
        const alu = aluBinaryWidth(1, lhs, rhs, 32, this.readReg(REG.EFLAGS));
        this.writeMem32(ea, alu.result >>> 0);
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      }
      this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size) >>> 0);
      return true;
    }
    case 0x0b:
    if (opcode === 0x0b) {
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      let rhs = 0;
      if (modrmInfo.mod === 3) {
        rhs = this.readReg32ByIndex(modrmInfo.rm);
      } else {
        const ea = this.calcEffectiveAddress(modrmInfo);
        if (ea === null) {
          return false;
        }
        rhs = this.readMem32(ea);
      }
      const lhs = this.readReg32ByIndex(modrmInfo.reg);
      const alu = aluBinaryWidth(1, lhs, rhs, 32, this.readReg(REG.EFLAGS));
      this.writeReg32ByIndex(modrmInfo.reg, alu.result >>> 0);
      this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size) >>> 0);
      return true;
    }
    case 0x31:
    if (opcode === 0x31) {
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      let lhs = 0;
      const rhs = this.readReg32ByIndex(modrmInfo.reg);
      if (modrmInfo.mod === 3) {
        lhs = this.readReg32ByIndex(modrmInfo.rm);
        const alu = aluBinaryWidth(6, lhs, rhs, 32, this.readReg(REG.EFLAGS));
        this.writeReg32ByIndex(modrmInfo.rm, alu.result >>> 0);
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      } else {
        const ea = this.calcEffectiveAddress(modrmInfo);
        if (ea === null) {
          return false;
        }
        lhs = this.readMem32(ea);
        const alu = aluBinaryWidth(6, lhs, rhs, 32, this.readReg(REG.EFLAGS));
        this.writeMem32(ea, alu.result >>> 0);
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      }
      this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size) >>> 0);
      return true;
    }
    case 0x33:
    if (opcode === 0x33) {
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      let rhs = 0;
      if (modrmInfo.mod === 3) {
        rhs = this.readReg32ByIndex(modrmInfo.rm);
      } else {
        const ea = this.calcEffectiveAddress(modrmInfo);
        if (ea === null) {
          return false;
        }
        rhs = this.readMem32(ea);
      }
      const lhs = this.readReg32ByIndex(modrmInfo.reg);
      const alu = aluBinaryWidth(6, lhs, rhs, 32, this.readReg(REG.EFLAGS));
      this.writeReg32ByIndex(modrmInfo.reg, alu.result >>> 0);
      this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size) >>> 0);
      return true;
    }
    case 0x69:
    case 0x6b:
    if (opcode === 0x69 || opcode === 0x6b) {
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      let src = 0;
      if (modrmInfo.mod === 3) {
        src = this.readReg32ByIndex(modrmInfo.rm);
      } else {
        const ea = this.calcEffectiveAddress(modrmInfo);
        if (ea === null) {
          return false;
        }
        src = this.readMem32(ea);
      }
      let imm = 0;
      if (opcode === 0x69) {
        const idx = 1 + modrmInfo.size;
        imm =
          bytes[idx] |
          (bytes[idx + 1] << 8) |
          (bytes[idx + 2] << 16) |
          (bytes[idx + 3] << 24);
      } else {
        imm = (bytes[1 + modrmInfo.size] << 24) >> 24;
      }
      const result = imulSignedWidth(src, imm, 32, this.readReg(REG.EFLAGS));
      this.writeReg32ByIndex(modrmInfo.reg, result.result >>> 0);
      this.writeReg(REG.EFLAGS, result.flags >>> 0);
      const immSize = opcode === 0x69 ? 4 : 1;
      this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size + immSize) >>> 0);
      return true;
    }
    case 0xfe:
    if (opcode === 0xfe) {
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      const reg = modrmInfo.reg & 7;
      if (reg !== 0 && reg !== 1) {
        return stopInterpreterFault(
          this,
          "invalid-opcode",
          `Invalid FE /${reg} opcode at 0x${(addr >>> 0).toString(16)}`
        );
      }
      let value = 0;
      if (modrmInfo.mod === 3) {
        value = this.readReg8ByIndex(modrmInfo.rm);
        value = reg === 0 ? (value + 1) & 0xff : (value - 1) & 0xff;
        this.writeReg8ByIndex(modrmInfo.rm, value);
      } else {
        const ea = this.calcEffectiveAddress(modrmInfo);
        if (ea === null) {
          return false;
        }
        value = this.readMem8(ea);
        value = reg === 0 ? (value + 1) & 0xff : (value - 1) & 0xff;
        this.writeMem8(ea, value);
      }
      let flags = this.readReg(REG.EFLAGS);
      if (reg === 0) {
        const alu = aluBinaryWidth(0, (value - 1) & 0xff, 1, 8, flags);
        flags = alu.flags >>> 0;
      } else {
        const alu = aluBinaryWidth(5, (value + 1) & 0xff, 1, 8, flags);
        flags = alu.flags >>> 0;
      }
      const orig = this.readReg(REG.EFLAGS);
      flags = (flags & ~FLAG_CF) | (orig & FLAG_CF);
      this.writeReg(REG.EFLAGS, flags >>> 0);
      this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size) >>> 0);
      return true;
    }
    case 0xff:
    if (opcode === 0xff) {
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      const reg = modrmInfo.reg & 7;
      const len = 1 + modrmInfo.size;
      if (reg === 0 || reg === 1) {
        let value = 0;
        if (modrmInfo.mod === 3) {
          value = this.readReg32ByIndex(modrmInfo.rm);
          const next = reg === 0 ? (value + 1) | 0 : (value - 1) | 0;
          this.writeReg32ByIndex(modrmInfo.rm, next >>> 0);
          const origFlags = this.readReg(REG.EFLAGS);
          const alu = aluBinaryWidth(reg === 0 ? 0 : 5, value, 1, 32, origFlags);
          let flags = alu.flags >>> 0;
          flags = (flags & ~FLAG_CF) | (origFlags & FLAG_CF);
          this.writeReg(REG.EFLAGS, flags >>> 0);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          value = this.readMem32(ea);
          const next = reg === 0 ? (value + 1) | 0 : (value - 1) | 0;
          this.writeMem32(ea, next >>> 0);
          const origFlags = this.readReg(REG.EFLAGS);
          const alu = aluBinaryWidth(reg === 0 ? 0 : 5, value, 1, 32, origFlags);
          let flags = alu.flags >>> 0;
          flags = (flags & ~FLAG_CF) | (origFlags & FLAG_CF);
          this.writeReg(REG.EFLAGS, flags >>> 0);
        }
        this.writeReg(REG.EIP, (addr + len) >>> 0);
        return true;
      }
      if (reg === 2 || reg === 4) {
        let target = 0;
        if (modrmInfo.mod === 3) {
          target = this.readReg32ByIndex(modrmInfo.rm) >>> 0;
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          target = this.readMem32(ea) >>> 0;
        }
        if (reg === 2) {
          const next = (addr + len) >>> 0;
          let esp = this.readReg(REG.ESP);
          esp = (esp - 4) >>> 0;
          this.writeMem32(esp, next);
          this.writeReg(REG.ESP, esp);
          this.writeReg(REG.EIP, target >>> 0);
        } else {
          this.writeReg(REG.EIP, target >>> 0);
        }
        return true;
      }
      if (reg === 3 || reg === 5) {
        if (modrmInfo.mod === 3) {
          return stopInterpreterFault(
            this,
            "invalid-opcode",
            `Far control transfer requires a memory operand at 0x${(addr >>> 0).toString(16)}`
          );
        }
        const ea = this.calcEffectiveAddress(modrmInfo);
        if (ea === null) {
          return false;
        }
        const target = this.readMem32(ea) >>> 0;
        const selector = this.readMem16((ea + 4) >>> 0) & 0xffff;
        if (reg === 3) {
          const next = (addr + len) >>> 0;
          let esp = this.readReg(REG.ESP) >>> 0;
          esp = (esp - 2) >>> 0;
          this.writeMem16(esp, this.segCS & 0xffff);
          esp = (esp - 4) >>> 0;
          this.writeMem32(esp, next >>> 0);
          this.writeReg(REG.ESP, esp >>> 0);
        }
        this.segCS = selector & 0xffff;
        this.writeReg(REG.EIP, target >>> 0);
        return true;
      }
      if (reg === 6) {
        let value = 0;
        if (modrmInfo.mod === 3) {
          value = this.readReg32ByIndex(modrmInfo.rm);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          value = this.readMem32(ea);
        }
        let esp = this.readReg(REG.ESP);
        esp = (esp - 4) >>> 0;
        this.writeMem32(esp, value >>> 0);
        this.writeReg(REG.ESP, esp);
        this.writeReg(REG.EIP, (addr + len) >>> 0);
        return true;
      }
      if (reg === 7) {
        return stopInterpreterFault(
          this,
          "invalid-opcode",
          `Invalid FF /7 opcode at 0x${(addr >>> 0).toString(16)}`
        );
      }
      return false;
    }
    case 0x88:
    case 0x8a:
    if (opcode === 0x88 || opcode === 0x8a) {
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      if (opcode === 0x88) {
        const value = this.readReg8ByIndex(modrmInfo.reg);
        if (modrmInfo.mod === 3) {
          this.writeReg8ByIndex(modrmInfo.rm, value);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          this.writeMem8(ea, value);
        }
      } else {
        let value = 0;
        if (modrmInfo.mod === 3) {
          value = this.readReg8ByIndex(modrmInfo.rm);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          value = this.readMem8(ea);
        }
        this.writeReg8ByIndex(modrmInfo.reg, value);
      }
      this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size) >>> 0);
      return true;
    }
    case 0xaa:
    if (opcode === 0xaa) {
      const al = this.readReg(REG.EAX) & 0xff;
      const addrSize = this.getActiveAddressSize();
      const df = (this.readReg(REG.EFLAGS) & FLAG_DF) !== 0;
      const edi = this.readAddrSizedReg(REG.EDI, addrSize) >>> 0;
      if (this.checkInterpreterMem(edi, 1)) {
        this.invalidateBasicBlocksForWrite(edi, 1);
        this.cpu.mem[edi] = al & 0xff;
      }
      this.writeAddrSizedReg(REG.EDI, this.advanceAddrSizedValue(edi, df ? -1 : 1, addrSize), addrSize);
      this.writeReg(REG.EIP, (addr + 1) >>> 0);
      return true;
    }
    case 0xc6:
    case 0xc7:
    if (opcode === 0xc6 || opcode === 0xc7) {
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      const immOffset = 1 + modrmInfo.size;
      if (opcode === 0xc6) {
        const imm8 = bytes[immOffset] & 0xff;
        if (modrmInfo.mod === 3) {
          this.writeReg8ByIndex(modrmInfo.rm, imm8);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          this.writeMem8(ea, imm8);
        }
        this.writeReg(REG.EIP, (addr + immOffset + 1) >>> 0);
        return true;
      }
      const imm =
        bytes[immOffset] |
        (bytes[immOffset + 1] << 8) |
        (bytes[immOffset + 2] << 16) |
        (bytes[immOffset + 3] << 24);
      if (modrmInfo.mod === 3) {
        this.writeReg32ByIndex(modrmInfo.rm, imm >>> 0);
      } else {
        const ea = this.calcEffectiveAddress(modrmInfo);
        if (ea === null) {
          return false;
        }
        this.writeMem32(ea, imm >>> 0);
      }
      this.writeReg(REG.EIP, (addr + immOffset + 4) >>> 0);
      return true;
    }
    case 0x89:
    case 0x8b:
    case 0x8d:
    if (opcode === 0x8b || opcode === 0x89 || opcode === 0x8d) {
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      if (opcode === 0x8d) {
        let value = 0;
        if (modrmInfo.mod === 3) {
          value = this.readReg32ByIndex(modrmInfo.rm);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          value = ea >>> 0;
        }
        this.writeReg32ByIndex(modrmInfo.reg, value >>> 0);
        this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size) >>> 0);
        return true;
      }
      if (opcode === 0x8b) {
        let value = 0;
        if (modrmInfo.mod === 3) {
          value = this.readReg32ByIndex(modrmInfo.rm);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          value = this.readMem32(ea);
        }
        this.writeReg32ByIndex(modrmInfo.reg, value >>> 0);
      } else {
        const value = this.readReg32ByIndex(modrmInfo.reg);
        if (modrmInfo.mod === 3) {
          this.writeReg32ByIndex(modrmInfo.rm, value);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          this.writeMem32(ea, value);
        }
      }
      this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size) >>> 0);
      return true;
    }
    case 0xe6:
    case 0xe7:
    case 0xee:
    case 0xef:
    if (opcode === 0xee || opcode === 0xef || opcode === 0xe6 || opcode === 0xe7) {
      const dx = this.readReg(REG.EDX) & 0xffff;
      if (opcode === 0xe6 || opcode === 0xe7) {
        const port = this.readMem8((addr + 1) >>> 0) & 0xff;
        if (opcode === 0xe6) {
          this.ioWrite8(port, this.readReg(REG.EAX) & 0xff);
        } else {
          this.ioWrite32(port, this.readReg(REG.EAX) >>> 0);
        }
        this.writeReg(REG.EIP, (addr + 2) >>> 0);
        return true;
      }
      if (opcode === 0xee) {
        this.ioWrite8(dx, this.readReg(REG.EAX) & 0xff);
      } else {
        this.ioWrite32(dx, this.readReg(REG.EAX) >>> 0);
      }
      this.writeReg(REG.EIP, (addr + 1) >>> 0);
      return true;
    }
    case 0xe4:
    case 0xe5:
    case 0xec:
    case 0xed:
    if (opcode === 0xec || opcode === 0xed || opcode === 0xe4 || opcode === 0xe5) {
      if (opcode === 0xe4 || opcode === 0xe5) {
        const port = this.readMem8((addr + 1) >>> 0) & 0xff;
        if (opcode === 0xe4) {
          const value = this.ioRead8(port) & 0xff;
          this.writeReg8ByIndex(0, value);
        } else {
          const value = this.ioRead32(port) >>> 0;
          this.writeReg(REG.EAX, value);
        }
        this.writeReg(REG.EIP, (addr + 2) >>> 0);
        return true;
      }
      const dx = this.readReg(REG.EDX) & 0xffff;
      if (opcode === 0xec) {
        const value = this.ioRead8(dx) & 0xff;
        this.writeReg8ByIndex(0, value);
      } else {
        const value = this.ioRead32(dx) >>> 0;
        this.writeReg(REG.EAX, value);
      }
      this.writeReg(REG.EIP, (addr + 1) >>> 0);
      return true;
    }
    case 0xa4:
    case 0xa5:
    case 0xab:
    if (opcode === 0xa4 || opcode === 0xa5 || opcode === 0xab) {
      return this.executeStringInstruction(addr, 0, 4);
    }
    case 0x30:
    case 0x32:
    if (opcode === 0x30 || opcode === 0x32) {
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      const regVal = this.readReg8ByIndex(modrmInfo.reg);
      let rmVal = 0;
      if (modrmInfo.mod === 3) {
        rmVal = this.readReg8ByIndex(modrmInfo.rm);
      } else {
        const ea = this.calcEffectiveAddress(modrmInfo);
        if (ea === null) {
          return false;
        }
        rmVal = this.readMem8(ea);
      }
      const alu = opcode === 0x30
        ? aluBinaryWidth(6, rmVal, regVal, 8, this.readReg(REG.EFLAGS))
        : aluBinaryWidth(6, regVal, rmVal, 8, this.readReg(REG.EFLAGS));
      if (opcode === 0x30) {
        if (modrmInfo.mod === 3) {
          this.writeReg8ByIndex(modrmInfo.rm, alu.result & 0xff);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          this.writeMem8(ea, alu.result & 0xff);
        }
      } else {
        this.writeReg8ByIndex(modrmInfo.reg, alu.result & 0xff);
      }
      this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size) >>> 0);
      return true;
    }
    case 0x20:
    case 0x22:
    if (opcode === 0x20 || opcode === 0x22) {
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      const regVal = this.readReg8ByIndex(modrmInfo.reg);
      let rmVal = 0;
      if (modrmInfo.mod === 3) {
        rmVal = this.readReg8ByIndex(modrmInfo.rm);
      } else {
        const ea = this.calcEffectiveAddress(modrmInfo);
        if (ea === null) {
          return false;
        }
        rmVal = this.readMem8(ea);
      }
      if (opcode === 0x20) { // and r/m8, r8
        const alu = aluBinaryWidth(4, rmVal, regVal, 8, this.readReg(REG.EFLAGS));
        if (modrmInfo.mod === 3) {
          this.writeReg8ByIndex(modrmInfo.rm, alu.result & 0xff);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          this.writeMem8(ea, alu.result & 0xff);
        }
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      } else { // and r8, r/m8
        const alu = aluBinaryWidth(4, regVal, rmVal, 8, this.readReg(REG.EFLAGS));
        this.writeReg8ByIndex(modrmInfo.reg, alu.result & 0xff);
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      }
      this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size) >>> 0);
      return true;
    }
    case 0x21:
    case 0x23:
    if (opcode === 0x21 || opcode === 0x23) {
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      const rhs = this.readReg32ByIndex(modrmInfo.reg);
      let lhs = 0;
      if (modrmInfo.mod === 3) {
        lhs = this.readReg32ByIndex(modrmInfo.rm);
      } else {
        const ea = this.calcEffectiveAddress(modrmInfo);
        if (ea === null) {
          return false;
        }
        lhs = this.readMem32(ea);
      }
      if (opcode === 0x21) {
        const alu = aluBinaryWidth(4, lhs, rhs, 32, this.readReg(REG.EFLAGS));
        if (modrmInfo.mod === 3) {
          this.writeReg32ByIndex(modrmInfo.rm, alu.result >>> 0);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          this.writeMem32(ea, alu.result >>> 0);
        }
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      } else {
        const alu = aluBinaryWidth(4, rhs, lhs, 32, this.readReg(REG.EFLAGS));
        this.writeReg32ByIndex(modrmInfo.reg, alu.result >>> 0);
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      }
      this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size) >>> 0);
      return true;
    }
    case 0x28:
    case 0x29:
    case 0x2a:
    case 0x2b:
    if (opcode === 0x28 || opcode === 0x2a || opcode === 0x29 || opcode === 0x2b) {
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      const isByte = opcode === 0x28 || opcode === 0x2a;
      const regVal = isByte
        ? this.readReg8ByIndex(modrmInfo.reg)
        : this.readReg32ByIndex(modrmInfo.reg);
      let rmVal = 0;
      if (modrmInfo.mod === 3) {
        rmVal = isByte
          ? this.readReg8ByIndex(modrmInfo.rm)
          : this.readReg32ByIndex(modrmInfo.rm);
      } else {
        const ea = this.calcEffectiveAddress(modrmInfo);
        if (ea === null) {
          return false;
        }
        rmVal = isByte ? this.readMem8(ea) : this.readMem32(ea);
      }
      if (opcode === 0x28 || opcode === 0x29) {
        const alu = aluBinaryWidth(5, rmVal, regVal, isByte ? 8 : 32, this.readReg(REG.EFLAGS));
        if (modrmInfo.mod === 3) {
          if (isByte) {
            this.writeReg8ByIndex(modrmInfo.rm, alu.result & 0xff);
          } else {
            this.writeReg32ByIndex(modrmInfo.rm, alu.result >>> 0);
          }
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          if (isByte) {
            this.writeMem8(ea, alu.result & 0xff);
          } else {
            this.writeMem32(ea, alu.result >>> 0);
          }
        }
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      } else {
        const alu = aluBinaryWidth(5, regVal, rmVal, isByte ? 8 : 32, this.readReg(REG.EFLAGS));
        if (isByte) {
          this.writeReg8ByIndex(modrmInfo.reg, alu.result & 0xff);
        } else {
          this.writeReg32ByIndex(modrmInfo.reg, alu.result >>> 0);
        }
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      }
      this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size) >>> 0);
      return true;
    }
    case 0x38:
    case 0x3a:
    if (opcode === 0x38 || opcode === 0x3a) {
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      const regVal = this.readReg8ByIndex(modrmInfo.reg);
      let rmVal = 0;
      if (modrmInfo.mod === 3) {
        rmVal = this.readReg8ByIndex(modrmInfo.rm);
      } else {
        const ea = this.calcEffectiveAddress(modrmInfo);
        if (ea === null) {
          return false;
        }
        rmVal = this.readMem8(ea);
      }
      if (opcode === 0x38) { // cmp r/m8, r8
        const alu = aluBinaryWidth(7, rmVal, regVal, 8, this.readReg(REG.EFLAGS));
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      } else { // cmp r8, r/m8
        const alu = aluBinaryWidth(7, regVal, rmVal, 8, this.readReg(REG.EFLAGS));
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      }
      this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size) >>> 0);
      return true;
    }
    case 0x1c:
    case 0x1d:
    if (opcode === 0x1c || opcode === 0x1d) {
      if (opcode === 0x1c) {
        const imm = this.readMem8((addr + 1) >>> 0) & 0xff;
        const eax = this.readReg(REG.EAX);
        const al = eax & 0xff;
        const alu = aluBinaryWidth(3, al, imm, 8, this.readReg(REG.EFLAGS));
        this.writeReg(REG.EAX, ((eax & 0xffffff00) | (alu.result & 0xff)) >>> 0);
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
        this.writeReg(REG.EIP, (addr + 2) >>> 0);
        return true;
      }
      const imm =
        this.readMem8((addr + 1) >>> 0) |
        (this.readMem8((addr + 2) >>> 0) << 8) |
        (this.readMem8((addr + 3) >>> 0) << 16) |
        (this.readMem8((addr + 4) >>> 0) << 24);
      const eax = this.readReg(REG.EAX);
      const alu = aluBinaryWidth(3, eax, imm, 32, this.readReg(REG.EFLAGS));
      this.writeReg(REG.EAX, alu.result >>> 0);
      this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      this.writeReg(REG.EIP, (addr + 5) >>> 0);
      return true;
    }
    case 0x04:
    case 0x0c:
    case 0x14:
    case 0x24:
    case 0x2c:
    case 0x34:
    case 0x3c:
    if (
      opcode === 0x04 || // add al, imm8
      opcode === 0x0c || // or al, imm8
      opcode === 0x14 || // adc al, imm8
      opcode === 0x24 || // and al, imm8
      opcode === 0x2c || // sub al, imm8
      opcode === 0x34 || // xor al, imm8
      opcode === 0x3c // cmp al, imm8
    ) {
      const imm = this.readMem8((addr + 1) >>> 0) & 0xff;
      const eax = this.readReg(REG.EAX);
      const al = eax & 0xff;
      const op = opcode === 0x04 ? 0
        : (opcode === 0x0c ? 1
          : (opcode === 0x14 ? 2
            : (opcode === 0x24 ? 4
              : (opcode === 0x2c ? 5
                : (opcode === 0x34 ? 6 : 7)))));
      const alu = aluBinaryWidth(op, al, imm, 8, this.readReg(REG.EFLAGS));
      if (opcode !== 0x3c) {
        this.writeReg(REG.EAX, ((eax & 0xffffff00) | (alu.result & 0xff)) >>> 0);
      }
      this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      this.writeReg(REG.EIP, (addr + 2) >>> 0);
      return true;
    }
    case 0x05:
    case 0x0d:
    case 0x15:
    case 0x25:
    case 0x2d:
    case 0x35:
    case 0x3d:
    if (
      opcode === 0x05 ||
      opcode === 0x0d ||
      opcode === 0x15 ||
      opcode === 0x25 ||
      opcode === 0x2d ||
      opcode === 0x35 ||
      opcode === 0x3d
    ) {
      const imm =
        this.readMem8((addr + 1) >>> 0) |
        (this.readMem8((addr + 2) >>> 0) << 8) |
        (this.readMem8((addr + 3) >>> 0) << 16) |
        (this.readMem8((addr + 4) >>> 0) << 24);
      const eax = this.readReg(REG.EAX);
      const op = opcode === 0x05 ? 0
        : (opcode === 0x0d ? 1
          : (opcode === 0x15 ? 2
            : (opcode === 0x25 ? 4
              : (opcode === 0x2d ? 5
                : (opcode === 0x35 ? 6 : 7)))));
      const alu = aluBinaryWidth(op, eax, imm, 32, this.readReg(REG.EFLAGS));
      if (opcode !== 0x3d) {
        this.writeReg(REG.EAX, alu.result >>> 0);
      }
      this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      this.writeReg(REG.EIP, (addr + 5) >>> 0);
      return true;
    }
    case 0xf6:
    if (opcode === 0xf6) {
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      const regField = modrmInfo.reg & 7;
      const immOffset = 1 + modrmInfo.size;
      const readOp = () => {
        if (modrmInfo.mod === 3) {
          return this.readReg8ByIndex(modrmInfo.rm);
        }
        const ea = this.calcEffectiveAddress(modrmInfo);
        if (ea === null) {
          return null;
        }
        return this.readMem8(ea);
      };
      const writeOp = (value) => {
        if (modrmInfo.mod === 3) {
          this.writeReg8ByIndex(modrmInfo.rm, value & 0xff);
          return true;
        }
        const ea = this.calcEffectiveAddress(modrmInfo);
        if (ea === null) {
          return false;
        }
        this.writeMem8(ea, value & 0xff);
        return true;
      };

      if (regField === 0 || regField === 1) {
        const imm = bytes[immOffset] & 0xff;
        const value = readOp();
        if (value === null) {
          return false;
        }
        const alu = aluBinaryWidth(8, value, imm, 8, this.readReg(REG.EFLAGS));
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
        this.writeReg(REG.EIP, (addr + immOffset + 1) >>> 0);
        return true;
      }
      if (regField === 2) {
        const value = readOp();
        if (value === null) {
          return false;
        }
        if (!writeOp((~value) & 0xff)) {
          return false;
        }
        this.writeReg(REG.EIP, (addr + immOffset) >>> 0);
        return true;
      }
      if (regField === 3) {
        const value = readOp();
        if (value === null) {
          return false;
        }
        const alu = aluBinaryWidth(5, 0, value, 8, this.readReg(REG.EFLAGS));
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
        if (!writeOp(alu.result & 0xff)) {
          return false;
        }
        this.writeReg(REG.EIP, (addr + immOffset) >>> 0);
        return true;
      }
      if (regField === 4 || regField === 5) {
        const value = readOp();
        if (value === null) {
          return false;
        }
        const eax = this.readReg(REG.EAX) >>> 0;
        if (regField === 4) {
          const prod = (eax & 0xff) * (value & 0xff);
          const ax = prod & 0xffff;
          this.writeReg(REG.EAX, (eax & 0xffff0000) | ax);
          let flags = this.readReg(REG.EFLAGS);
          const carry = (ax & 0xff00) !== 0;
          flags = carry ? (flags | FLAG_CF | FLAG_OF) : (flags & ~(FLAG_CF | FLAG_OF));
          this.writeReg(REG.EFLAGS, flags >>> 0);
        } else {
          const a = ((eax & 0xff) << 24) >> 24;
          const b = ((value & 0xff) << 24) >> 24;
          const prod = a * b;
          const ax = prod & 0xffff;
          this.writeReg(REG.EAX, (eax & 0xffff0000) | (ax & 0xffff));
          let flags = this.readReg(REG.EFLAGS);
          const upper = (ax >> 8) & 0xff;
          const signExt = (ax & 0x80) ? 0xff : 0x00;
          const carry = upper !== signExt;
          flags = carry ? (flags | FLAG_CF | FLAG_OF) : (flags & ~(FLAG_CF | FLAG_OF));
          this.writeReg(REG.EFLAGS, flags >>> 0);
        }
        this.writeReg(REG.EIP, (addr + immOffset) >>> 0);
        return true;
      }
      if (regField === 6 || regField === 7) {
        const divisor = readOp();
        if (divisor === null || divisor === 0) {
          return false;
        }
        const eax = this.readReg(REG.EAX) >>> 0;
        if (regField === 6) {
          const dividend = eax & 0xffff;
          const quot = Math.floor(dividend / (divisor & 0xff));
          const rem = dividend % (divisor & 0xff);
          if (quot > 0xff) {
            return false;
          }
          const nextAx = ((rem & 0xff) << 8) | (quot & 0xff);
          this.writeReg(REG.EAX, (eax & 0xffff0000) | nextAx);
        } else {
          const dividend = ((eax & 0xffff) << 16) >> 16;
          const divs = ((divisor & 0xff) << 24) >> 24;
          if (divs === 0) {
            return false;
          }
          const quot = (dividend / divs) | 0;
          const rem = (dividend % divs) | 0;
          if (quot < -128 || quot > 127) {
            return false;
          }
          const nextAx = ((rem & 0xff) << 8) | (quot & 0xff);
          this.writeReg(REG.EAX, (eax & 0xffff0000) | (nextAx & 0xffff));
        }
        this.writeReg(REG.EIP, (addr + immOffset) >>> 0);
        return true;
      }
      return false;
    }
    case 0x24:
    if (opcode === 0x24) {
      const imm = this.readMem8((addr + 1) >>> 0) & 0xff;
      const eax = this.readReg(REG.EAX);
      const al = eax & 0xff;
      const alu = aluBinaryWidth(4, al, imm, 8, this.readReg(REG.EFLAGS));
      this.writeReg(REG.EAX, ((eax & 0xffffff00) | (alu.result & 0xff)) >>> 0);
      this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      this.writeReg(REG.EIP, (addr + 2) >>> 0);
      return true;
    }
    case 0xa8:
    if (opcode === 0xa8) {
      const imm = this.readMem8((addr + 1) >>> 0) & 0xff;
      const eax = this.readReg(REG.EAX);
      const al = eax & 0xff;
      const alu = aluBinaryWidth(8, al, imm, 8, this.readReg(REG.EFLAGS));
      this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      this.writeReg(REG.EIP, (addr + 2) >>> 0);
      return true;
    }
    case 0xa9:
    if (opcode === 0xa9) {
      const imm = this.readMem32((addr + 1) >>> 0) >>> 0;
      const eax = this.readReg(REG.EAX) >>> 0;
      const alu = aluBinaryWidth(8, eax, imm, 32, this.readReg(REG.EFLAGS));
      this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      this.writeReg(REG.EIP, (addr + 5) >>> 0);
      return true;
    }
    case 0x3c:
    if (opcode === 0x3c) {
      const imm = this.readMem8((addr + 1) >>> 0) & 0xff;
      const eax = this.readReg(REG.EAX);
      const al = eax & 0xff;
      const alu = aluBinaryWidth(7, al, imm, 8, this.readReg(REG.EFLAGS));
      this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      this.writeReg(REG.EIP, (addr + 2) >>> 0);
      return true;
    }
    case 0x80:
    case 0x81:
    case 0x82:
    case 0x83:
    if (opcode === 0x80 || opcode === 0x81 || opcode === 0x82 || opcode === 0x83) {
      const bytes = this.readMemBlock(addr, 20);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      const regField = modrmInfo.reg & 7;
      const widthBits = (opcode === 0x80 || opcode === 0x82) ? 8 : 32;
      let imm = 0;
      if (opcode === 0x81) {
        const idx = 1 + modrmInfo.size;
        imm =
          bytes[idx] |
          (bytes[idx + 1] << 8) |
          (bytes[idx + 2] << 16) |
          (bytes[idx + 3] << 24);
      } else if (opcode === 0x82) {
        imm = bytes[1 + modrmInfo.size] & 0xff;
      } else {
        imm = (bytes[1 + modrmInfo.size] << 24) >> 24;
      }
      let op1 = 0;
      if (widthBits === 8) {
        if (modrmInfo.mod === 3) {
          op1 = this.readReg8ByIndex(modrmInfo.rm);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          op1 = this.readMem8(ea);
        }
      } else {
        if (modrmInfo.mod === 3) {
          op1 = this.readReg32ByIndex(modrmInfo.rm);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          op1 = this.readMem32(ea);
        }
      }

      if (regField > 7) {
        return false;
      }
      const alu = aluBinaryWidth(regField, op1, imm, widthBits, this.readReg(REG.EFLAGS));
      const result = alu.result >>> 0;
      const flags = alu.flags >>> 0;

      if (regField !== 7) {
        if (widthBits === 8) {
          if (modrmInfo.mod === 3) {
            this.writeReg8ByIndex(modrmInfo.rm, result & 0xff);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea === null) {
              return false;
            }
            this.writeMem8(ea, result & 0xff);
          }
        } else if (modrmInfo.mod === 3) {
          this.writeReg32ByIndex(modrmInfo.rm, result >>> 0);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          this.writeMem32(ea, result >>> 0);
        }
      }

      this.writeReg(REG.EFLAGS, flags >>> 0);
      const len = opcode === 0x81 ? (1 + modrmInfo.size + 4) : (1 + modrmInfo.size + 1);
      this.writeReg(REG.EIP, (addr + len) >>> 0);
      return true;
    }
    case 0x80:
    case 0x81:
    case 0x82:
    case 0x83:
    if (opcode === 0x80 || opcode === 0x81 || opcode === 0x82 || opcode === 0x83) {
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      const regField = modrmInfo.reg & 7;
      const widthBits = (opcode === 0x80 || opcode === 0x82) ? 8 : 32;
      let imm = 0;
      if (opcode === 0x81) {
        const idx = 1 + modrmInfo.size;
        imm =
          bytes[idx] |
          (bytes[idx + 1] << 8) |
          (bytes[idx + 2] << 16) |
          (bytes[idx + 3] << 24);
      } else if (opcode === 0x82) {
        imm = bytes[1 + modrmInfo.size] & 0xff;
      } else {
        imm = (bytes[1 + modrmInfo.size] << 24) >> 24;
      }
      let op1 = 0;
      if (widthBits === 8) {
        if (modrmInfo.mod === 3) {
          op1 = this.readReg8ByIndex(modrmInfo.rm);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          op1 = this.readMem8(ea);
        }
      } else {
        if (modrmInfo.mod === 3) {
          op1 = this.readReg32ByIndex(modrmInfo.rm);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          op1 = this.readMem32(ea);
        }
      }
      if (regField !== 0 && regField !== 1 && regField !== 4 && regField !== 5 && regField !== 7) {
        return false;
      }
      const alu = aluBinaryWidth(regField, op1, imm, widthBits, this.readReg(REG.EFLAGS));
      const result = alu.result >>> 0;
      const flags = alu.flags >>> 0;
      if (regField !== 7) {
        if (widthBits === 8) {
          if (modrmInfo.mod === 3) {
            this.writeReg8ByIndex(modrmInfo.rm, result);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea === null) {
              return false;
            }
            this.writeMem8(ea, result);
          }
        } else {
          if (modrmInfo.mod === 3) {
            this.writeReg32ByIndex(modrmInfo.rm, result >>> 0);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea === null) {
              return false;
            }
            this.writeMem32(ea, result >>> 0);
          }
        }
      }
      this.writeReg(REG.EFLAGS, flags >>> 0);
      let immSize = opcode === 0x81 ? 4 : 1;
      this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size + immSize) >>> 0);
      return true;
    }
    case 0x00:
    case 0x02:
    if (opcode === 0x00 || opcode === 0x02) {
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      if (opcode === 0x00) {
        const src = this.readReg8ByIndex(modrmInfo.reg);
        if (modrmInfo.mod === 3) {
          const dst = this.readReg8ByIndex(modrmInfo.rm);
          const alu = aluBinaryWidth(0, dst, src, 8, this.readReg(REG.EFLAGS));
          this.writeReg8ByIndex(modrmInfo.rm, alu.result & 0xff);
          this.writeReg(REG.EFLAGS, alu.flags >>> 0);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          const dst = this.readMem8(ea);
          const alu = aluBinaryWidth(0, dst, src, 8, this.readReg(REG.EFLAGS));
          this.writeMem8(ea, alu.result & 0xff);
          this.writeReg(REG.EFLAGS, alu.flags >>> 0);
        }
      } else {
        let src = 0;
        if (modrmInfo.mod === 3) {
          src = this.readReg8ByIndex(modrmInfo.rm);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          src = this.readMem8(ea);
        }
        const dst = this.readReg8ByIndex(modrmInfo.reg);
        const alu = aluBinaryWidth(0, dst, src, 8, this.readReg(REG.EFLAGS));
        this.writeReg8ByIndex(modrmInfo.reg, alu.result & 0xff);
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      }
      this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size) >>> 0);
      return true;
    }
    case 0x40:
    case 0x41:
    case 0x42:
    case 0x43:
    case 0x44:
    case 0x45:
    case 0x46:
    case 0x47:
    case 0x48:
    case 0x49:
    case 0x4a:
    case 0x4b:
    case 0x4c:
    case 0x4d:
    case 0x4e:
    case 0x4f:
    if (opcode >= 0x40 && opcode <= 0x4f) {
      const regIdx = opcode & 7;
      const value = this.readReg32ByIndex(regIdx);
      const delta = opcode < 0x48 ? 1 : -1;
      const result = (value + delta) | 0;
      const origFlags = this.readReg(REG.EFLAGS);
      const alu = aluBinaryWidth(opcode < 0x48 ? 0 : 5, value, 1, 32, origFlags);
      let flags = alu.flags >>> 0;
      flags = (flags & ~FLAG_CF) | (origFlags & FLAG_CF);
      this.writeReg32ByIndex(regIdx, result >>> 0);
      this.writeReg(REG.EFLAGS, flags >>> 0);
      this.writeReg(REG.EIP, (addr + 1) >>> 0);
      return true;
    }
    case 0x39:
    case 0x3b:
    if (opcode === 0x3b || opcode === 0x39) {
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      let lhs = 0;
      let rhs = 0;
      if (opcode === 0x3b) {
        lhs = this.readReg32ByIndex(modrmInfo.reg);
        if (modrmInfo.mod === 3) {
          rhs = this.readReg32ByIndex(modrmInfo.rm);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          rhs = this.readMem32(ea);
        }
      } else {
        rhs = this.readReg32ByIndex(modrmInfo.reg);
        if (modrmInfo.mod === 3) {
          lhs = this.readReg32ByIndex(modrmInfo.rm);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          lhs = this.readMem32(ea);
        }
      }
      const alu = aluBinaryWidth(7, lhs, rhs, 32, this.readReg(REG.EFLAGS));
      this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size) >>> 0);
      return true;
    }
    case 0x10:
    case 0x12:
    if (opcode === 0x10 || opcode === 0x12) {
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      if (opcode === 0x10) {
        const src = this.readReg8ByIndex(modrmInfo.reg);
        if (modrmInfo.mod === 3) {
          const dst = this.readReg8ByIndex(modrmInfo.rm);
          const alu = aluBinaryWidth(2, dst, src, 8, this.readReg(REG.EFLAGS));
          this.writeReg8ByIndex(modrmInfo.rm, alu.result & 0xff);
          this.writeReg(REG.EFLAGS, alu.flags >>> 0);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          const dst = this.readMem8(ea);
          const alu = aluBinaryWidth(2, dst, src, 8, this.readReg(REG.EFLAGS));
          this.writeMem8(ea, alu.result & 0xff);
          this.writeReg(REG.EFLAGS, alu.flags >>> 0);
        }
      } else {
        let src = 0;
        if (modrmInfo.mod === 3) {
          src = this.readReg8ByIndex(modrmInfo.rm);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          src = this.readMem8(ea);
        }
        const dst = this.readReg8ByIndex(modrmInfo.reg);
        const alu = aluBinaryWidth(2, dst, src, 8, this.readReg(REG.EFLAGS));
        this.writeReg8ByIndex(modrmInfo.reg, alu.result & 0xff);
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      }
      this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size) >>> 0);
      return true;
    }
    case 0x18:
    case 0x1a:
    if (opcode === 0x18 || opcode === 0x1a) {
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      if (opcode === 0x18) {
        const src = this.readReg8ByIndex(modrmInfo.reg);
        if (modrmInfo.mod === 3) {
          const dst = this.readReg8ByIndex(modrmInfo.rm);
          const alu = aluBinaryWidth(3, dst, src, 8, this.readReg(REG.EFLAGS));
          this.writeReg8ByIndex(modrmInfo.rm, alu.result & 0xff);
          this.writeReg(REG.EFLAGS, alu.flags >>> 0);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          const dst = this.readMem8(ea);
          const alu = aluBinaryWidth(3, dst, src, 8, this.readReg(REG.EFLAGS));
          this.writeMem8(ea, alu.result & 0xff);
          this.writeReg(REG.EFLAGS, alu.flags >>> 0);
        }
      } else {
        let src = 0;
        if (modrmInfo.mod === 3) {
          src = this.readReg8ByIndex(modrmInfo.rm);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          src = this.readMem8(ea);
        }
        const dst = this.readReg8ByIndex(modrmInfo.reg);
        const alu = aluBinaryWidth(3, dst, src, 8, this.readReg(REG.EFLAGS));
        this.writeReg8ByIndex(modrmInfo.reg, alu.result & 0xff);
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      }
      this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size) >>> 0);
      return true;
    }
    case 0x11:
    case 0x13:
    if (opcode === 0x11 || opcode === 0x13) {
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      if (opcode === 0x11) {
        const src = this.readReg32ByIndex(modrmInfo.reg);
        if (modrmInfo.mod === 3) {
          const dst = this.readReg32ByIndex(modrmInfo.rm);
          const alu = aluBinaryWidth(2, dst, src, 32, this.readReg(REG.EFLAGS));
          this.writeReg32ByIndex(modrmInfo.rm, alu.result >>> 0);
          this.writeReg(REG.EFLAGS, alu.flags >>> 0);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          const dst = this.readMem32(ea);
          const alu = aluBinaryWidth(2, dst, src, 32, this.readReg(REG.EFLAGS));
          this.writeMem32(ea, alu.result >>> 0);
          this.writeReg(REG.EFLAGS, alu.flags >>> 0);
        }
      } else {
        let src = 0;
        if (modrmInfo.mod === 3) {
          src = this.readReg32ByIndex(modrmInfo.rm);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          src = this.readMem32(ea);
        }
        const dst = this.readReg32ByIndex(modrmInfo.reg);
        const alu = aluBinaryWidth(2, dst, src, 32, this.readReg(REG.EFLAGS));
        this.writeReg32ByIndex(modrmInfo.reg, alu.result >>> 0);
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      }
      this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size) >>> 0);
      return true;
    }
    case 0x01:
    case 0x03:
    if (opcode === 0x03 || opcode === 0x01) {
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      if (opcode === 0x03) {
        let src = 0;
        if (modrmInfo.mod === 3) {
          src = this.readReg32ByIndex(modrmInfo.rm);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          src = this.readMem32(ea);
        }
        const dst = this.readReg32ByIndex(modrmInfo.reg);
        const alu = aluBinaryWidth(0, dst, src, 32, this.readReg(REG.EFLAGS));
        this.writeReg32ByIndex(modrmInfo.reg, alu.result >>> 0);
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      } else {
        const src = this.readReg32ByIndex(modrmInfo.reg);
        if (modrmInfo.mod === 3) {
          const dst = this.readReg32ByIndex(modrmInfo.rm);
          const alu = aluBinaryWidth(0, dst, src, 32, this.readReg(REG.EFLAGS));
          this.writeReg32ByIndex(modrmInfo.rm, alu.result >>> 0);
          this.writeReg(REG.EFLAGS, alu.flags >>> 0);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          const dst = this.readMem32(ea);
          const alu = aluBinaryWidth(0, dst, src, 32, this.readReg(REG.EFLAGS));
          this.writeMem32(ea, alu.result >>> 0);
          this.writeReg(REG.EFLAGS, alu.flags >>> 0);
        }
      }
      this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size) >>> 0);
      return true;
    }
    case 0x29:
    case 0x2b:
    if (opcode === 0x2b || opcode === 0x29) {
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      if (opcode === 0x2b) {
        let src = 0;
        if (modrmInfo.mod === 3) {
          src = this.readReg32ByIndex(modrmInfo.rm);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          src = this.readMem32(ea);
        }
        const dst = this.readReg32ByIndex(modrmInfo.reg);
        const alu = aluBinaryWidth(5, dst, src, 32, this.readReg(REG.EFLAGS));
        this.writeReg32ByIndex(modrmInfo.reg, alu.result >>> 0);
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      } else {
        const src = this.readReg32ByIndex(modrmInfo.reg);
        if (modrmInfo.mod === 3) {
          const dst = this.readReg32ByIndex(modrmInfo.rm);
          const alu = aluBinaryWidth(5, dst, src, 32, this.readReg(REG.EFLAGS));
          this.writeReg32ByIndex(modrmInfo.rm, alu.result >>> 0);
          this.writeReg(REG.EFLAGS, alu.flags >>> 0);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          const dst = this.readMem32(ea);
          const alu = aluBinaryWidth(5, dst, src, 32, this.readReg(REG.EFLAGS));
          this.writeMem32(ea, alu.result >>> 0);
          this.writeReg(REG.EFLAGS, alu.flags >>> 0);
        }
      }
      this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size) >>> 0);
      return true;
    }
    case 0x84:
    case 0x85:
    if (opcode === 0x85 || opcode === 0x84) {
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      let lhs = 0;
      let rhs = 0;
      if (opcode === 0x85) {
        rhs = this.readReg32ByIndex(modrmInfo.reg);
        if (modrmInfo.mod === 3) {
          lhs = this.readReg32ByIndex(modrmInfo.rm);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          lhs = this.readMem32(ea);
        }
        const alu = aluBinaryWidth(8, lhs, rhs, 32, this.readReg(REG.EFLAGS));
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      } else {
        rhs = this.readReg8ByIndex(modrmInfo.reg);
        if (modrmInfo.mod === 3) {
          lhs = this.readReg8ByIndex(modrmInfo.rm);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          lhs = this.readMem8(ea);
        }
        const alu = aluBinaryWidth(8, lhs, rhs, 8, this.readReg(REG.EFLAGS));
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      }
      this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size) >>> 0);
      return true;
    }
    case 0x87:
    if (opcode === 0x87) {
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      const regVal = this.readReg32ByIndex(modrmInfo.reg);
      if (modrmInfo.mod === 3) {
        const rmVal = this.readReg32ByIndex(modrmInfo.rm);
        this.writeReg32ByIndex(modrmInfo.reg, rmVal >>> 0);
        this.writeReg32ByIndex(modrmInfo.rm, regVal >>> 0);
      } else {
        const ea = this.calcEffectiveAddress(modrmInfo);
        if (ea === null) {
          return false;
        }
        const rmVal = this.readMem32(ea);
        this.writeMem32(ea, regVal >>> 0);
        this.writeReg32ByIndex(modrmInfo.reg, rmVal >>> 0);
      }
      this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size) >>> 0);
      return true;
    }
    case 0x86:
    if (opcode === 0x86) {
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      const regVal = this.readReg8ByIndex(modrmInfo.reg) & 0xff;
      if (modrmInfo.mod === 3) {
        const rmVal = this.readReg8ByIndex(modrmInfo.rm) & 0xff;
        this.writeReg8ByIndex(modrmInfo.reg, rmVal);
        this.writeReg8ByIndex(modrmInfo.rm, regVal);
      } else {
        const ea = this.calcEffectiveAddress(modrmInfo);
        if (ea === null) {
          return false;
        }
        const rmVal = this.readMem8(ea) & 0xff;
        this.writeMem8(ea, regVal);
        this.writeReg8ByIndex(modrmInfo.reg, rmVal);
      }
      this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size) >>> 0);
      return true;
    }
    case 0x19:
    case 0x1b:
    if (opcode === 0x19 || opcode === 0x1b) {
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      if (opcode === 0x19) {
        const src = this.readReg32ByIndex(modrmInfo.reg);
        if (modrmInfo.mod === 3) {
          const dst = this.readReg32ByIndex(modrmInfo.rm);
          const alu = aluBinaryWidth(3, dst, src, 32, this.readReg(REG.EFLAGS));
          this.writeReg32ByIndex(modrmInfo.rm, alu.result >>> 0);
          this.writeReg(REG.EFLAGS, alu.flags >>> 0);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          const dst = this.readMem32(ea);
          const alu = aluBinaryWidth(3, dst, src, 32, this.readReg(REG.EFLAGS));
          this.writeMem32(ea, alu.result >>> 0);
          this.writeReg(REG.EFLAGS, alu.flags >>> 0);
        }
      } else {
        let src = 0;
        if (modrmInfo.mod === 3) {
          src = this.readReg32ByIndex(modrmInfo.rm);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          src = this.readMem32(ea);
        }
        const dst = this.readReg32ByIndex(modrmInfo.reg);
        const alu = aluBinaryWidth(3, dst, src, 32, this.readReg(REG.EFLAGS));
        this.writeReg32ByIndex(modrmInfo.reg, alu.result >>> 0);
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
      }
      this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size) >>> 0);
      return true;
    }
    case 0xc0:
    case 0xd0:
    case 0xd2:
    if (opcode === 0xc0 || opcode === 0xd0 || opcode === 0xd2) {
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      const regField = modrmInfo.reg & 7;
      let shift = 0;
      if (opcode === 0xc0) {
        shift = bytes[1 + modrmInfo.size] & 0x1f;
      } else if (opcode === 0xd0) {
        shift = 1;
      } else {
        shift = this.readReg8ByIndex(1) & 0x1f;
      }
      let value = 0;
      if (modrmInfo.mod === 3) {
        value = this.readReg8ByIndex(modrmInfo.rm);
      } else {
        const ea = this.calcEffectiveAddress(modrmInfo);
        if (ea === null) {
          return false;
        }
        value = this.readMem8(ea);
      }
      const flags = this.readReg(REG.EFLAGS);
      const res = shiftRotate(value, shift, 8, regField, flags);
      if (!res.ok) {
        return false;
      }
      if (modrmInfo.mod === 3) {
        this.writeReg8ByIndex(modrmInfo.rm, res.result & 0xff);
      } else {
        const ea = this.calcEffectiveAddress(modrmInfo);
        if (ea === null) {
          return false;
        }
        this.writeMem8(ea, res.result & 0xff);
      }
      this.writeReg(REG.EFLAGS, res.flags >>> 0);
      const len = opcode === 0xc0 ? 1 + modrmInfo.size + 1 : 1 + modrmInfo.size;
      this.writeReg(REG.EIP, (addr + len) >>> 0);
      return true;
    }
    case 0xc1:
    case 0xd1:
    case 0xd3:
    if (opcode === 0xc1 || opcode === 0xd1 || opcode === 0xd3) {
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      const regField = modrmInfo.reg & 7;
      let shift = 0;
      if (opcode === 0xc1) {
        shift = bytes[1 + modrmInfo.size] & 0x1f;
      } else if (opcode === 0xd1) {
        shift = 1;
      } else {
        shift = this.readReg8ByIndex(1) & 0x1f;
      }
      let value = 0;
      if (modrmInfo.mod === 3) {
        value = this.readReg32ByIndex(modrmInfo.rm);
      } else {
        const ea = this.calcEffectiveAddress(modrmInfo);
        if (ea === null) {
          return false;
        }
        value = this.readMem32(ea);
      }
      const flags = this.readReg(REG.EFLAGS);
      const res = shiftRotate(value, shift, 32, regField, flags);
      if (!res.ok) {
        return false;
      }
      const result = res.result >>> 0;
      if (modrmInfo.mod === 3) {
        this.writeReg32ByIndex(modrmInfo.rm, result >>> 0);
      } else {
        const ea = this.calcEffectiveAddress(modrmInfo);
        if (ea === null) {
          return false;
        }
        this.writeMem32(ea, result >>> 0);
      }
      this.writeReg(REG.EFLAGS, res.flags >>> 0);
      const len = opcode === 0xc1 ? 1 + modrmInfo.size + 1 : 1 + modrmInfo.size;
      this.writeReg(REG.EIP, (addr + len) >>> 0);
      return true;
    }
    case 0xf7:
    if (opcode === 0xf7) {
      const bytes = this.readMemBlock(addr, 20);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      const regField = modrmInfo.reg & 7;
      const immOffset = 1 + modrmInfo.size;
      let op = 0;
      const readOp = () => {
        if (modrmInfo.mod === 3) {
          return this.readReg32ByIndex(modrmInfo.rm);
        }
        const ea = this.calcEffectiveAddress(modrmInfo);
        if (ea === null) {
          return null;
        }
        return this.readMem32(ea);
      };
      const writeOp = (value) => {
        if (modrmInfo.mod === 3) {
          this.writeReg32ByIndex(modrmInfo.rm, value >>> 0);
          return true;
        }
        const ea = this.calcEffectiveAddress(modrmInfo);
        if (ea === null) {
          return false;
        }
        this.writeMem32(ea, value >>> 0);
        return true;
      };

      if (regField === 0 || regField === 1) {
        // TEST r/m32, imm32
        const imm =
          bytes[immOffset] |
          (bytes[immOffset + 1] << 8) |
          (bytes[immOffset + 2] << 16) |
          (bytes[immOffset + 3] << 24);
        op = readOp();
        if (op === null) {
          return false;
        }
        const alu = aluBinaryWidth(8, op, imm, 32, this.readReg(REG.EFLAGS));
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
        this.writeReg(REG.EIP, (addr + immOffset + 4) >>> 0);
        return true;
      }
      if (regField === 2) {
        // NOT r/m32
        op = readOp();
        if (op === null) {
          return false;
        }
        if (!writeOp((~op) >>> 0)) {
          return false;
        }
        this.writeReg(REG.EIP, (addr + immOffset) >>> 0);
        return true;
      }
      if (regField === 3) {
        // NEG r/m32
        op = readOp();
        if (op === null) {
          return false;
        }
        const alu = aluBinaryWidth(5, 0, op, 32, this.readReg(REG.EFLAGS));
        this.writeReg(REG.EFLAGS, alu.flags >>> 0);
        if (!writeOp(alu.result >>> 0)) {
          return false;
        }
        this.writeReg(REG.EIP, (addr + immOffset) >>> 0);
        return true;
      }
      if (regField === 4 || regField === 5) {
        // MUL/IMUL r/m32
        op = readOp();
        if (op === null) {
          return false;
        }
        const eax = this.readReg(REG.EAX) >>> 0;
        const result = mulFullWidth(eax, op >>> 0, 32, regField === 5, this.readReg(REG.EFLAGS));
        this.writeReg(REG.EAX, result.lo >>> 0);
        this.writeReg(REG.EDX, result.hi >>> 0);
        this.writeReg(REG.EFLAGS, result.flags >>> 0);
        this.writeReg(REG.EIP, (addr + immOffset) >>> 0);
        return true;
      }
      if (regField === 6 || regField === 7) {
        // DIV/IDIV r/m32
        op = readOp();
        if (op === null || op === 0) {
          return false;
        }
        const edx = this.readReg(REG.EDX) >>> 0;
        const eax = this.readReg(REG.EAX) >>> 0;
        const div = divideFullWidth(edx, eax, op >>> 0, 32, regField === 7);
        if (!div.ok) {
          return false;
        }
        this.writeReg(REG.EAX, div.quotient >>> 0);
        this.writeReg(REG.EDX, div.remainder >>> 0);
        this.writeReg(REG.EIP, (addr + immOffset) >>> 0);
        return true;
      }
      return false;
    }
    case 0x50:
    case 0x51:
    case 0x52:
    case 0x53:
    case 0x54:
    case 0x55:
    case 0x56:
    case 0x57:
    if (opcode >= 0x50 && opcode <= 0x57) {
      const regIdx = opcode - 0x50;
      const value = this.readReg32ByIndex(regIdx);
      let esp = this.readReg(REG.ESP);
      esp = (esp - 4) >>> 0;
      this.writeMem32(esp, value);
      this.writeReg(REG.ESP, esp);
      this.writeReg(REG.EIP, (addr + 1) >>> 0);
      return true;
    }
    case 0x58:
    case 0x59:
    case 0x5a:
    case 0x5b:
    case 0x5c:
    case 0x5d:
    case 0x5e:
    case 0x5f:
    if (opcode >= 0x58 && opcode <= 0x5f) {
      const regIdx = opcode - 0x58;
      let esp = this.readReg(REG.ESP);
      const value = this.readMem32(esp);
      esp = (esp + 4) >>> 0;
      this.writeReg(REG.ESP, esp);
      this.writeReg32ByIndex(regIdx, value);
      this.writeReg(REG.EIP, (addr + 1) >>> 0);
      return true;
    }
    case 0x8c:
    case 0x8e:
    if (opcode === 0x8c || opcode === 0x8e) { // mov r/m16, sreg | mov sreg, r/m16
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      const seg = modrmInfo.reg & 7;
      const readSeg = () => {
        switch (seg) {
          case 0: return this.segES;
          case 1: return this.segCS;
          case 2: return this.segSS;
          case 3: return this.segDS;
          case 4: return this.segFS;
          case 5: return this.segGS;
          default: return 0;
        }
      };
      const writeSeg = (value) => {
        const v = value & 0xffff;
        switch (seg) {
          case 0: this.segES = v; break;
          case 1: this.segCS = v; break;
          case 2: this.segSS = v; break;
          case 3: this.segDS = v; break;
          case 4: this.segFS = v; break;
          case 5: this.segGS = v; break;
          default: break;
        }
      };
      if (opcode === 0x8c) {
        const value = readSeg() & 0xffff;
        if (modrmInfo.mod === 3) {
          this.writeReg16ByIndex(modrmInfo.rm, value);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          this.writeMem16(ea, value);
        }
      } else {
        let value = 0;
        if (modrmInfo.mod === 3) {
          value = this.readReg16ByIndex(modrmInfo.rm) & 0xffff;
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          value = this.readMem16(ea) & 0xffff;
        }
        writeSeg(value);
      }
      this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size) >>> 0);
      return true;
    }
    case 0x8f:
    if (opcode === 0x8f) { // POP r/m32
      const bytes = this.readMemBlock(addr, 16);
      if (!bytes) {
        return false;
      }
      const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
      if ((modrmInfo.reg & 7) !== 0) {
        return stopInterpreterFault(
          this,
          "invalid-opcode",
          `Invalid 8F /${modrmInfo.reg & 7} POP encoding at 0x${(addr >>> 0).toString(16)}`
        );
      }
      let esp = this.readReg(REG.ESP);
      const value = this.readMem32(esp);
      esp = (esp + 4) >>> 0;
      this.writeReg(REG.ESP, esp >>> 0);
      if (modrmInfo.mod === 3) {
        this.writeReg32ByIndex(modrmInfo.rm, value >>> 0);
      } else {
        const ea = this.calcEffectiveAddress(modrmInfo);
        if (ea === null) {
          return false;
        }
        this.writeMem32(ea, value >>> 0);
      }
      this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size) >>> 0);
      return true;
    }
    case 0x70:
    case 0x71:
    case 0x72:
    case 0x73:
    case 0x74:
    case 0x75:
    case 0x76:
    case 0x77:
    case 0x78:
    case 0x79:
    case 0x7a:
    case 0x7b:
    case 0x7c:
    case 0x7d:
    case 0x7e:
    case 0x7f:
    if (opcode >= 0x70 && opcode <= 0x7f) {
      const promoted = this.promoteDynamicSoftInstruction(addr);
      if (promoted !== null) {
        return !!promoted;
      }
      const rel8 = (this.readMem8((addr + 1) >>> 0) << 24) >> 24;
      const flags = this.readReg(REG.EFLAGS);
      const take = evalJccCondition(opcode & 0x0f, flags);
      const next = (addr + 2) >>> 0;
      this.writeReg(REG.EIP, take ? (next + rel8) >>> 0 : next);
      return true;
    }
    case 0x0f:
    if (opcode === 0x0f) {
      const op2 = this.readMem8((addr + 1) >>> 0);
      if (op2 >= 0x80 && op2 <= 0x8f) {
        const promoted = this.promoteDynamicSoftInstruction(addr);
        if (promoted !== null) {
          return !!promoted;
        }
      }
      if (op2 >= 0xc8 && op2 <= 0xcf) { // bswap r32
        const regIdx = op2 & 7;
        const value = this.readReg32ByIndex(regIdx) >>> 0;
        const swapped = bswap32(value >>> 0);
        this.writeReg32ByIndex(regIdx, swapped >>> 0);
        this.writeReg(REG.EIP, (addr + 2) >>> 0);
        return true;
      }
      if (op2 === 0xa0 || op2 === 0xa8) { // push fs/gs
        const seg = op2 === 0xa0 ? this.segFS : this.segGS;
        let esp = this.readReg(REG.ESP) >>> 0;
        esp = (esp - 2) >>> 0;
        this.writeMem16(esp, seg & 0xffff);
        this.writeReg(REG.ESP, esp >>> 0);
        this.writeReg(REG.EIP, (addr + 2) >>> 0);
        return true;
      }
      if (op2 === 0xa1 || op2 === 0xa9) { // pop fs/gs
        let esp = this.readReg(REG.ESP) >>> 0;
        const value = this.readMem16(esp);
        esp = (esp + 2) >>> 0;
        this.writeReg(REG.ESP, esp >>> 0);
        if (op2 === 0xa1) {
          this.segFS = value & 0xffff;
        } else {
          this.segGS = value & 0xffff;
        }
        this.writeReg(REG.EIP, (addr + 2) >>> 0);
        return true;
      }
      if (op2 >= 0x80 && op2 <= 0x8f) {
        const rel = this.readMem32((addr + 2) >>> 0) | 0;
        const flags = this.readReg(REG.EFLAGS);
        const take = evalJccCondition(op2 & 0x0f, flags);
        const next = (addr + 6) >>> 0;
        this.writeReg(REG.EIP, take ? (next + rel) >>> 0 : next);
        return true;
      }
      if (op2 >= 0x40 && op2 <= 0x4f) { // cmovcc r32, r/m32
        const bytes = this.readMemBlock(addr, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        const flags = this.readReg(REG.EFLAGS);
        if (evalJccCondition(op2 & 0x0f, flags)) {
          let value = 0;
          if (modrmInfo.mod === 3) {
            value = this.readReg32ByIndex(modrmInfo.rm) >>> 0;
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea === null) {
              return false;
            }
            value = this.readMem32(ea) >>> 0;
          }
          this.writeReg32ByIndex(modrmInfo.reg, value >>> 0);
        }
        this.writeReg(REG.EIP, (addr + 2 + modrmInfo.size) >>> 0);
        return true;
      }
      if (op2 === 0xb1) { // cmpxchg r/m32, r32
        const bytes = this.readMemBlock(addr, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        const eax = this.readReg(REG.EAX) >>> 0;
        let ea = 0;
        let src = 0;
        if (modrmInfo.mod === 3) {
          src = this.readReg32ByIndex(modrmInfo.rm) >>> 0;
        } else {
          const targetEa = this.calcEffectiveAddress(modrmInfo);
          if (targetEa === null) {
            return false;
          }
          ea = targetEa >>> 0;
          src = this.readMem32(ea) >>> 0;
        }
        const regVal = this.readReg32ByIndex(modrmInfo.reg) >>> 0;
        const result = cmpxchgWidth(eax, src, regVal, 32, this.readReg(REG.EFLAGS));
        if (result.exchanged) {
          if (modrmInfo.mod === 3) {
            this.writeReg32ByIndex(modrmInfo.rm, result.result >>> 0);
          } else {
            this.writeMem32(ea >>> 0, result.result >>> 0);
          }
        } else {
          this.writeReg(REG.EAX, result.accumulator >>> 0);
        }
        this.writeReg(REG.EFLAGS, result.flags >>> 0);
        this.writeReg(REG.EIP, (addr + 2 + modrmInfo.size) >>> 0);
        return true;
      }
      if (op2 === 0xc0 || op2 === 0xc1) { // xadd r/m8,r8 or r/m32,r32
        const bytes = this.readMemBlock(addr, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        const isByte = op2 === 0xc0;
        const widthBits = isByte ? 8 : 32;
        const src = isByte
          ? (this.readReg8ByIndex(modrmInfo.reg) & 0xff)
          : (this.readReg32ByIndex(modrmInfo.reg) >>> 0);
        let ea = 0;
        let dst = 0;
        if (modrmInfo.mod === 3) {
          dst = isByte
            ? (this.readReg8ByIndex(modrmInfo.rm) & 0xff)
            : (this.readReg32ByIndex(modrmInfo.rm) >>> 0);
        } else {
          const targetEa = this.calcEffectiveAddress(modrmInfo);
          if (targetEa === null) {
            return false;
          }
          ea = targetEa >>> 0;
          dst = isByte
            ? (this.readMem8(ea) & 0xff)
            : (this.readMem32(ea) >>> 0);
        }
        const result = xaddWidth(dst, src, widthBits, this.readReg(REG.EFLAGS));
        if (isByte) {
          this.writeReg8ByIndex(modrmInfo.reg, result.src & 0xff);
        } else {
          this.writeReg32ByIndex(modrmInfo.reg, result.src >>> 0);
        }
        if (modrmInfo.mod === 3) {
          if (isByte) {
            this.writeReg8ByIndex(modrmInfo.rm, result.dst & 0xff);
          } else {
            this.writeReg32ByIndex(modrmInfo.rm, result.dst >>> 0);
          }
        } else {
          if (isByte) {
            this.writeMem8(ea >>> 0, result.dst & 0xff);
          } else {
            this.writeMem32(ea >>> 0, result.dst >>> 0);
          }
        }
        this.writeReg(REG.EFLAGS, result.flags >>> 0);
        this.writeReg(REG.EIP, (addr + 2 + modrmInfo.size) >>> 0);
        return true;
      }
      if (op2 >= 0x90 && op2 <= 0x9f) {
        const bytes = this.readMemBlock(addr, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        const flags = this.readReg(REG.EFLAGS);
        const value = evalJccCondition(op2 & 0x0f, flags) ? 1 : 0;
        if (modrmInfo.mod === 3) {
          this.writeReg8ByIndex(modrmInfo.rm, value);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          this.writeMem8(ea, value);
        }
        this.writeReg(REG.EIP, (addr + 2 + modrmInfo.size) >>> 0);
        return true;
      }
      if (op2 === 0x10 || op2 === 0x11 || op2 === 0x54) { // movups/andps
        const bytes = this.readMemBlock(addr, 24);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        const regIdx = modrmInfo.reg & 7;
        const len = 2 + modrmInfo.size;
        const scratchA = this.scratchXmmWordsA;
        const scratchB = this.scratchXmmWordsB;
        if (op2 === 0x10) { // movups xmm, xmm/m128
          if (modrmInfo.mod === 3) {
            this.copyXmm(regIdx, modrmInfo.rm);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea === null) {
              return false;
            }
            if (!this.readMem128U32(ea, scratchA)) {
              return false;
            }
            this.writeXmm128U32(regIdx, scratchA);
          }
        } else if (op2 === 0x11) { // movups xmm/m128, xmm
          if (modrmInfo.mod === 3) {
            this.copyXmm(modrmInfo.rm, regIdx);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea === null) {
              return false;
            }
            this.readXmm128U32(regIdx, scratchA);
            if (!this.writeMem128U32(ea, scratchA)) {
              return false;
            }
          }
        } else { // andps xmm, xmm/m128
          const src = this.readModrmXmmSourceU32(modrmInfo, scratchA);
          if (!src) {
            return false;
          }
          const dst = this.readXmm128U32(regIdx, scratchB);
          const out = packedOp32x4(
            dst[0],
            dst[1],
            dst[2],
            dst[3],
            src[0],
            src[1],
            src[2],
            src[3],
            0
          );
          this.writeXmm128U32(regIdx, out);
        }
        this.writeReg(REG.EIP, (addr + len) >>> 0);
        return true;
      }
      if (op2 === 0x52 || op2 === 0x53) { // rsqrtps/rcpps
        const bytes = this.readMemBlock(addr, 24);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        const regIdx = modrmInfo.reg & 7;
        const len = 2 + modrmInfo.size;
        const src = this.readModrmXmmSourceU32(modrmInfo, this.scratchXmmWordsA);
        if (!src) {
          return false;
        }
        const out = sseUnaryFloat32x4(
          src[0],
          src[1],
          src[2],
          src[3],
          op2 === 0x52 ? 2 : 1
        );
        this.writeXmm128U32(regIdx, out);
        this.writeReg(REG.EIP, (addr + len) >>> 0);
        return true;
      }
      if (op2 === 0x70) { // pshufw mm, mm/m64, imm8
        const bytes = this.readMemBlock(addr, 24);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        const imm = bytes[2 + modrmInfo.size] & 0xff;
        const src = this.readModrmMmxSourceU32(modrmInfo, this.scratchQwordA);
        if (!src) {
          return false;
        }
        const out = pshufw64(src[0], src[1], imm);
        this.scratchQwordB[0] = out.lo >>> 0;
        this.scratchQwordB[1] = out.hi >>> 0;
        this.writeMmx64U32(modrmInfo.reg, this.scratchQwordB);
        const len = 3 + modrmInfo.size;
        this.writeReg(REG.EIP, (addr + len) >>> 0);
        return true;
      }
      if (op2 === 0x60 || op2 === 0x61 || op2 === 0x62 || op2 === 0x63 || op2 === 0x67 || op2 === 0x68 || op2 === 0x69 || op2 === 0x6b) {
        const bytes = this.readMemBlock(addr, 24);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        const dstIdx = modrmInfo.reg & 7;
        const src = this.readModrmMmxSourceU32(modrmInfo, this.scratchQwordA);
        if (!src) {
          return false;
        }
        const dst = this.readMmx64U32(dstIdx, this.scratchQwordB);
        let result = null;
        if (op2 === 0x60) {
          result = punpcklbw64(dst[0] >>> 0, src[0] >>> 0);
        } else if (op2 === 0x61) {
          result = punpcklwd64(dst[0] >>> 0, src[0] >>> 0);
        } else if (op2 === 0x62) {
          result = { lo: dst[0] >>> 0, hi: src[0] >>> 0 };
        } else if (op2 === 0x63) {
          result = packsswb64(dst[0] >>> 0, dst[1] >>> 0, src[0] >>> 0, src[1] >>> 0);
        } else if (op2 === 0x67) {
          result = packuswb64(dst[0] >>> 0, dst[1] >>> 0, src[0] >>> 0, src[1] >>> 0);
        } else if (op2 === 0x68) {
          result = punpckhbw64(dst[1] >>> 0, src[1] >>> 0);
        } else if (op2 === 0x69) {
          result = punpckhwd64(dst[1] >>> 0, src[1] >>> 0);
        } else if (op2 === 0x6b) {
          result = packssdw64(dst[0] >>> 0, dst[1] >>> 0, src[0] >>> 0, src[1] >>> 0);
        }
        if (!result) {
          return false;
        }
        this.scratchQwordB[0] = result.lo >>> 0;
        this.scratchQwordB[1] = result.hi >>> 0;
        this.writeMmx64U32(dstIdx, this.scratchQwordB);
        const len = 2 + modrmInfo.size;
        this.writeReg(REG.EIP, (addr + len) >>> 0);
        return true;
      }
      if (op2 === 0x76) { // pcmpeqd mm, mm/m64
        const bytes = this.readMemBlock(addr, 24);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        const dstIdx = modrmInfo.reg & 7;
        const src = this.readModrmMmxSourceU32(modrmInfo, this.scratchQwordA);
        if (!src) {
          return false;
        }
        const dst = this.readMmx64U32(dstIdx, this.scratchQwordB);
        const out = packedOp32x2(dst[0], dst[1], src[0], src[1], 4);
        this.scratchQwordB[0] = out.lo >>> 0;
        this.scratchQwordB[1] = out.hi >>> 0;
        this.writeMmx64U32(dstIdx, this.scratchQwordB);
        const len = 2 + modrmInfo.size;
        this.writeReg(REG.EIP, (addr + len) >>> 0);
        return true;
      }
      if (op2 === 0x77) { // emms
        this.writeReg(REG.EIP, (addr + 2) >>> 0);
        return true;
      }
      if (op2 === 0xd7) { // pmovmskb r32, mm/m64
        const bytes = this.readMemBlock(addr, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        const dstIdx = modrmInfo.reg & 7;
        const src = this.readModrmMmxSourceU32(modrmInfo, this.scratchQwordA);
        if (!src) {
          return false;
        }
        const mask = movmskBytes64(src[0], src[1]);
        this.writeReg32ByIndex(dstIdx, mask >>> 0);
        const len = 2 + modrmInfo.size;
        this.writeReg(REG.EIP, (addr + len) >>> 0);
        return true;
      }
      if (op2 === 0xdb || op2 === 0xdf || op2 === 0xeb || op2 === 0xef) { // pand / pandn / por / pxor
        const bytes = this.readMemBlock(addr, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        const dstIdx = modrmInfo.reg & 7;
        const src = this.readModrmMmxSourceU32(modrmInfo, this.scratchQwordA);
        if (!src) {
          return false;
        }
        const dst = this.readMmx64U32(dstIdx, this.scratchQwordB);
        const op = op2 === 0xdb ? 0 : (op2 === 0xdf ? 1 : (op2 === 0xeb ? 2 : 3));
        const out = packedOp32x2(dst[0], dst[1], src[0], src[1], op);
        this.scratchQwordB[0] = out.lo >>> 0;
        this.scratchQwordB[1] = out.hi >>> 0;
        this.writeMmx64U32(dstIdx, this.scratchQwordB);
        const len = 2 + modrmInfo.size;
        this.writeReg(REG.EIP, (addr + len) >>> 0);
        return true;
      }
      if (op2 === 0xd6) { // movq m64, xmm
        const bytes = this.readMemBlock(addr, 24);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        const regIdx = modrmInfo.reg & 7;
        const len = 2 + modrmInfo.size;
        const src = this.readXmm64U32(regIdx, 0, this.scratchQwordA);
        if (modrmInfo.mod === 3) {
          const dstIdx = modrmInfo.rm & 7;
          this.writeXmm64U32(dstIdx, 0, src);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          if (!this.writeMem64U32(ea, src)) {
            return false;
          }
        }
        this.writeReg(REG.EIP, (addr + len) >>> 0);
        return true;
      }
      if (op2 === 0xbc || op2 === 0xbd) { // BSF/BSR r32, r/m32
        const bytes = this.readMemBlock(addr, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        let src = 0;
        if (modrmInfo.mod === 3) {
          src = this.readReg32ByIndex(modrmInfo.rm) >>> 0;
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          src = this.readMem32(ea) >>> 0;
        }
        let flags = this.readReg(REG.EFLAGS);
        const scan = bitScan(src, op2 === 0xbd, 32);
        if (scan.zero) {
          flags |= FLAG_ZF;
        } else {
          flags &= ~FLAG_ZF;
          this.writeReg32ByIndex(modrmInfo.reg, scan.index >>> 0);
        }
        this.writeReg(REG.EFLAGS, flags >>> 0);
        this.writeReg(REG.EIP, (addr + 2 + modrmInfo.size) >>> 0);
        return true;
      }
      if (op2 === 0x1f) {
        const bytes = this.readMemBlock(addr, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        this.writeReg(REG.EIP, (addr + 2 + modrmInfo.size) >>> 0);
        return true;
      }
      if (op2 === 0xa3 || op2 === 0xab || op2 === 0xb3 || op2 === 0xbb) { // bt/bts/btr/btc r/m32, r32
        const bytes = this.readMemBlock(addr, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        const bitIndex = this.readReg32ByIndex(modrmInfo.reg) >>> 0;
        let value = 0;
        let ea = 0;
        if (modrmInfo.mod === 3) {
          value = this.readReg32ByIndex(modrmInfo.rm) >>> 0;
        } else {
          const base = this.calcEffectiveAddress(modrmInfo);
          if (base === null) {
            return false;
          }
          const wordOffset = bitIndex >>> 5;
          ea = (base + (wordOffset * 4)) >>> 0;
          value = this.readMem32(ea) >>> 0;
        }
        const op = op2 === 0xa3 ? 4 : (op2 === 0xab ? 5 : (op2 === 0xb3 ? 6 : 7));
        const result = bitTestModify(value, bitIndex, 32, op, this.readReg(REG.EFLAGS));
        if (op !== 4) {
          const nextVal = result.result >>> 0;
          if (modrmInfo.mod === 3) {
            this.writeReg32ByIndex(modrmInfo.rm, nextVal >>> 0);
          } else {
            this.writeMem32(ea >>> 0, nextVal >>> 0);
          }
        }
        this.writeReg(REG.EFLAGS, result.flags >>> 0);
        this.writeReg(REG.EIP, (addr + 2 + modrmInfo.size) >>> 0);
        return true;
      }
      if (op2 === 0xba) {
        const bytes = this.readMemBlock(addr, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        const imm = bytes[2 + modrmInfo.size] & 0xff;
        const bitIndex = imm & 0xff;
        let value = 0;
        let ea = 0;
        if (modrmInfo.mod === 3) {
          value = this.readReg32ByIndex(modrmInfo.rm);
        } else {
          const base = this.calcEffectiveAddress(modrmInfo);
          if (base === null) {
            return false;
          }
          const wordOffset = (bitIndex >>> 5) >>> 0;
          ea = (base + (wordOffset * 4)) >>> 0;
          value = this.readMem32(ea);
        }
        const op = modrmInfo.reg & 7;
        if (op !== 4 && op !== 5 && op !== 6 && op !== 7) {
          return stopInterpreterFault(
            this,
            "invalid-opcode",
            `Invalid 0F BA /${op} opcode at 0x${(addr >>> 0).toString(16)}`
          );
        }
        const result = bitTestModify(value, bitIndex, 32, op, this.readReg(REG.EFLAGS));
        if (op !== 4) {
          const nextVal = result.result >>> 0;
          if (modrmInfo.mod === 3) {
            this.writeReg32ByIndex(modrmInfo.rm, nextVal >>> 0);
          } else {
            this.writeMem32(ea, nextVal >>> 0);
          }
        }
        this.writeReg(REG.EFLAGS, result.flags >>> 0);
        this.writeReg(REG.EIP, (addr + 3 + modrmInfo.size) >>> 0);
        return true;
      }
      if (op2 === 0xa4 || op2 === 0xa5 || op2 === 0xac || op2 === 0xad) {
        const bytes = this.readMemBlock(addr, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        const count = (op2 === 0xa5 || op2 === 0xad)
          ? (this.readReg(REG.ECX) & 0xff)
          : (bytes[2 + modrmInfo.size] & 0xff);
        let dest = 0;
        if (modrmInfo.mod === 3) {
          dest = this.readReg32ByIndex(modrmInfo.rm);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          dest = this.readMem32(ea);
        }
        const src = this.readReg32ByIndex(modrmInfo.reg);
        const flags = this.readReg(REG.EFLAGS);
        const res = doubleShift(dest, src, count, 32, op2 === 0xa4 || op2 === 0xa5, flags);
        if (!res.ok) {
          return false;
        }
        if (modrmInfo.mod === 3) {
          this.writeReg32ByIndex(modrmInfo.rm, res.result >>> 0);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          this.writeMem32(ea, res.result >>> 0);
        }
        this.writeReg(REG.EFLAGS, res.flags >>> 0);
        const len = (op2 === 0xa5 || op2 === 0xad) ? (2 + modrmInfo.size) : (3 + modrmInfo.size);
        this.writeReg(REG.EIP, (addr + len) >>> 0);
        return true;
      }
      if (op2 === 0x12 || op2 === 0x16) {
        const bytes = this.readMemBlock(addr, 20);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        const len = 2 + modrmInfo.size;
        const regIdx = modrmInfo.reg & 7;
        if (op2 === 0x12) { // movlps xmm, m64 | movhlps xmm, xmm
          if (modrmInfo.mod === 3) {
            const src = this.readXmm64U32(modrmInfo.rm, 2, this.scratchQwordA);
            this.writeXmm64U32(regIdx, 0, src);
          } else {
            const src = this.readModrmXmmLow64SourceU32(modrmInfo, this.scratchQwordA);
            if (!src) {
              return false;
            }
            this.writeXmm64U32(regIdx, 0, src);
          }
          this.writeReg(REG.EIP, (addr + len) >>> 0);
          return true;
        }
        // op2 === 0x16: movhps xmm, m64 | movlhps xmm, xmm
        if (modrmInfo.mod === 3) {
          const src = this.readXmm64U32(modrmInfo.rm, 0, this.scratchQwordA);
          this.writeXmm64U32(regIdx, 2, src);
        } else {
          const src = this.readModrmXmmLow64SourceU32(modrmInfo, this.scratchQwordA);
          if (!src) {
            return false;
          }
          this.writeXmm64U32(regIdx, 2, src);
        }
        this.writeReg(REG.EIP, (addr + len) >>> 0);
        return true;
      }
      if (op2 === 0x59) { // mulps xmm, xmm/m128
        const bytes = this.readMemBlock(addr, 20);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        const len = 2 + modrmInfo.size;
        const regIdx = modrmInfo.reg & 7;
        const dst = this.readXmm128U32(regIdx, this.scratchXmmWordsA);
        const src = this.readModrmXmmSourceU32(modrmInfo, this.scratchXmmWordsB);
        if (!src) {
          return false;
        }
        const out = sseBinaryFloat32x4(
          dst[0], dst[1], dst[2], dst[3],
          src[0], src[1], src[2], src[3],
          2
        );
        this.writeXmm128U32(regIdx, out);
        this.writeReg(REG.EIP, (addr + len) >>> 0);
        return true;
      }
      if (op2 === 0x58 || op2 === 0x5c || op2 === 0x5e || op2 === 0x51) { // addps/subps/divps/sqrtps
        const bytes = this.readMemBlock(addr, 20);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        const len = 2 + modrmInfo.size;
        const regIdx = modrmInfo.reg & 7;
        if (op2 === 0x51) {
          const src = this.readModrmXmmSourceU32(modrmInfo, this.scratchXmmWordsA);
          if (!src) {
            return false;
          }
          const out = sseUnaryFloat32x4(src[0], src[1], src[2], src[3], 0);
          this.writeXmm128U32(regIdx, out);
        } else {
          const dst = this.readXmm128U32(regIdx, this.scratchXmmWordsA);
          const src = this.readModrmXmmSourceU32(modrmInfo, this.scratchXmmWordsB);
          if (!src) {
            return false;
          }
          const op = op2 === 0x58 ? 0 : (op2 === 0x5c ? 1 : 3);
          const out = sseBinaryFloat32x4(
            dst[0], dst[1], dst[2], dst[3],
            src[0], src[1], src[2], src[3],
            op
          );
          this.writeXmm128U32(regIdx, out);
        }
        this.writeReg(REG.EIP, (addr + len) >>> 0);
        return true;
      }
      if (op2 === 0x5d || op2 === 0x5f) { // minps/maxps
        const bytes = this.readMemBlock(addr, 20);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        const len = 2 + modrmInfo.size;
        const regIdx = modrmInfo.reg & 7;
        const dst = this.readXmm128U32(regIdx, this.scratchXmmWordsA);
        const src = this.readModrmXmmSourceU32(modrmInfo, this.scratchXmmWordsB);
        if (!src) {
          return false;
        }
        const out = sseBinaryFloat32x4(
          dst[0], dst[1], dst[2], dst[3],
          src[0], src[1], src[2], src[3],
          op2 === 0x5d ? 4 : 5
        );
        this.writeXmm128U32(regIdx, out);
        this.writeReg(REG.EIP, (addr + len) >>> 0);
        return true;
      }
      if (op2 === 0x5b) { // cvtdq2ps xmm, xmm/m128
        const bytes = this.readMemBlock(addr, 20);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        const len = 2 + modrmInfo.size;
        const regIdx = modrmInfo.reg & 7;
        const src = this.readModrmXmmSourceU32(modrmInfo, this.scratchXmmWordsA);
        if (!src) {
          return false;
        }
        const out = cvtdq2ps32x4(src[0], src[1], src[2], src[3]);
        this.writeXmm128U32(regIdx, out);
        this.writeReg(REG.EIP, (addr + len) >>> 0);
        return true;
      }
      if (op2 === 0xdc) { // paddusb xmm, xmm/m128
        const bytes = this.readMemBlock(addr, 20);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        const len = 2 + modrmInfo.size;
        const regIdx = modrmInfo.reg & 7;
        const dstWords = this.readXmm128U32(regIdx, this.scratchXmmWordsA);
        const srcWords = this.readModrmXmmSourceU32(modrmInfo, this.scratchXmmWordsB);
        if (!srcWords) {
          return false;
        }
        const dstBytes = this.scratchBytes16A;
        for (let i = 0; i < 4; i += 1) {
          const v = dstWords[i] >>> 0;
          dstBytes[i * 4] = v & 0xff;
          dstBytes[i * 4 + 1] = (v >>> 8) & 0xff;
          dstBytes[i * 4 + 2] = (v >>> 16) & 0xff;
          dstBytes[i * 4 + 3] = (v >>> 24) & 0xff;
        }
        const srcBytes = this.scratchBytes16B;
        for (let i = 0; i < 4; i += 1) {
          const v = srcWords[i] >>> 0;
          srcBytes[i * 4] = v & 0xff;
          srcBytes[i * 4 + 1] = (v >>> 8) & 0xff;
          srcBytes[i * 4 + 2] = (v >>> 16) & 0xff;
          srcBytes[i * 4 + 3] = (v >>> 24) & 0xff;
        }
        const out = this.scratchBytes16C;
        for (let i = 0; i < 16; i += 1) {
          const sum = dstBytes[i] + srcBytes[i];
          out[i] = sum > 255 ? 255 : sum;
        }
        for (let i = 0; i < 4; i += 1) {
          dstWords[i] =
            (out[i * 4] |
            (out[i * 4 + 1] << 8) |
            (out[i * 4 + 2] << 16) |
            (out[i * 4 + 3] << 24)) >>> 0;
        }
        this.writeXmm128U32(regIdx, dstWords);
        this.writeReg(REG.EIP, (addr + len) >>> 0);
        return true;
      }
      if (op2 === 0xc6) { // shufps xmm, xmm/m128, imm8
        const bytes = this.readMemBlock(addr, 24);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        const imm = bytes[2 + modrmInfo.size] & 0xff;
        const len = 3 + modrmInfo.size;
        const regIdx = modrmInfo.reg & 7;
        const dst = this.readXmm128U32(regIdx, this.scratchXmmWordsA);
        const src = this.readModrmXmmSourceU32(modrmInfo, this.scratchXmmWordsB);
        if (!src) {
          return false;
        }
        const out = shufps32x4(
          dst[0],
          dst[1],
          dst[2],
          dst[3],
          src[0],
          src[1],
          src[2],
          src[3],
          imm
        );
        this.writeXmm128U32(regIdx, out);
        this.writeReg(REG.EIP, (addr + len) >>> 0);
        return true;
      }
      if (op2 === 0xc2) { // cmpps xmm, xmm/m128, imm8
        const bytes = this.readMemBlock(addr, 24);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        const imm = bytes[2 + modrmInfo.size] & 0xff;
        const len = 3 + modrmInfo.size;
        const regIdx = modrmInfo.reg & 7;
        const dst = this.readXmm128U32(regIdx, this.scratchXmmWordsA);
        const src = this.readModrmXmmSourceU32(modrmInfo, this.scratchXmmWordsB);
        if (!src) {
          return false;
        }
        const out = sseCompare32x4(
          dst[0], dst[1], dst[2], dst[3],
          src[0], src[1], src[2], src[3],
          imm
        );
        this.writeXmm128U32(regIdx, out);
        this.writeReg(REG.EIP, (addr + len) >>> 0);
        return true;
      }
      if (op2 === 0x50) { // movmskps r32, xmm
        const bytes = this.readMemBlock(addr, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        if (modrmInfo.mod !== 3) {
          return false;
        }
        const srcIdx = modrmInfo.rm & 7;
        const src = this.readXmm128U32(srcIdx, this.scratchXmmWordsA);
        const mask = movmskFloat32x4(
          src[0],
          src[1],
          src[2],
          src[3]
        );
        this.writeReg32ByIndex(modrmInfo.reg, mask >>> 0);
        this.writeReg(REG.EIP, (addr + 2 + modrmInfo.size) >>> 0);
        return true;
      }
      if (op2 === 0x2a) { // cvtpi2ps xmm, mm/m64
        const bytes = this.readMemBlock(addr, 20);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        const len = 2 + modrmInfo.size;
        const regIdx = modrmInfo.reg & 7;
        const src = this.readModrmMmxSourceU32(modrmInfo, this.scratchQwordA);
        if (!src) {
          return false;
        }
        const v0 = src[0] | 0;
        const v1 = src[1] | 0;
        this.writeXmmF32(regIdx, 0, v0);
        this.writeXmmF32(regIdx, 1, v1);
        this.writeReg(REG.EIP, (addr + len) >>> 0);
        return true;
      }
      if (op2 === 0x71 || op2 === 0x72 || op2 === 0x73) { // packed shifts mm, imm8
        const bytes = this.readMemBlock(addr, 20);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        if (modrmInfo.mod !== 3) {
          return false;
        }
        const regField = modrmInfo.reg & 7;
        const imm = bytes[2 + modrmInfo.size] & 0xff;
        const idx = modrmInfo.rm & 7;
        const mm = this.readMmx64U32(idx, this.scratchQwordA);
        if (op2 === 0x71) {
          if (regField === 2) {
            this.scratchQwordB[0] = psrlw32(mm[0] >>> 0, imm) >>> 0;
            this.scratchQwordB[1] = psrlw32(mm[1] >>> 0, imm) >>> 0;
            this.writeMmx64U32(idx, this.scratchQwordB);
          } else if (regField === 4) {
            this.scratchQwordB[0] = psraw32(mm[0] >>> 0, imm) >>> 0;
            this.scratchQwordB[1] = psraw32(mm[1] >>> 0, imm) >>> 0;
            this.writeMmx64U32(idx, this.scratchQwordB);
          } else if (regField === 6) {
            this.scratchQwordB[0] = psllw32(mm[0] >>> 0, imm) >>> 0;
            this.scratchQwordB[1] = psllw32(mm[1] >>> 0, imm) >>> 0;
            this.writeMmx64U32(idx, this.scratchQwordB);
          } else {
            return false;
          }
          this.writeReg(REG.EIP, (addr + 3 + modrmInfo.size) >>> 0);
          return true;
        }
        if (op2 === 0x72) {
          if (regField === 2) {
            this.scratchQwordB[0] = psrld32(mm[0] >>> 0, imm) >>> 0;
            this.scratchQwordB[1] = psrld32(mm[1] >>> 0, imm) >>> 0;
            this.writeMmx64U32(idx, this.scratchQwordB);
          } else if (regField === 4) {
            this.scratchQwordB[0] = psrad32(mm[0] >>> 0, imm) >>> 0;
            this.scratchQwordB[1] = psrad32(mm[1] >>> 0, imm) >>> 0;
            this.writeMmx64U32(idx, this.scratchQwordB);
          } else if (regField === 6) {
            this.scratchQwordB[0] = pslld32(mm[0] >>> 0, imm) >>> 0;
            this.scratchQwordB[1] = pslld32(mm[1] >>> 0, imm) >>> 0;
            this.writeMmx64U32(idx, this.scratchQwordB);
          } else {
            return false;
          }
          this.writeReg(REG.EIP, (addr + 3 + modrmInfo.size) >>> 0);
          return true;
        }
        const count = imm & 0x3f;
        if (regField !== 2 && regField !== 6 && regField !== 7) {
          return false;
        }
        const shifted = shiftPacked64(mm[0] >>> 0, mm[1] >>> 0, count, regField !== 2);
        this.scratchQwordB[0] = shifted.lo >>> 0;
        this.scratchQwordB[1] = shifted.hi >>> 0;
        this.writeMmx64U32(idx, this.scratchQwordB);
        this.writeReg(REG.EIP, (addr + 3 + modrmInfo.size) >>> 0);
        return true;
      }
      if (op2 === 0x28 || op2 === 0x57 || op2 === 0x6e || op2 === 0x7e || op2 === 0x2e) {
        const bytes = this.readMemBlock(addr, 20);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        const len = 2 + modrmInfo.size;
        const regIdx = modrmInfo.reg & 7;
        if (op2 === 0x28) { // movaps xmm, xmm/m128
          if (modrmInfo.mod === 3) {
            this.copyXmm(regIdx, modrmInfo.rm);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea === null) {
              return false;
            }
            if (!this.readMem128U32(ea, this.scratchXmmWordsA)) {
              return false;
            }
            this.writeXmm128U32(regIdx, this.scratchXmmWordsA);
          }
          this.writeReg(REG.EIP, (addr + len) >>> 0);
          return true;
        }
        if (op2 === 0x57) { // xorps xmm, xmm/m128
          const src = this.readModrmXmmSourceU32(modrmInfo, this.scratchXmmWordsA);
          if (!src) {
            return false;
          }
          const dst = this.readXmm128U32(regIdx, this.scratchXmmWordsB);
          const out = packedOp32x4(
            dst[0],
            dst[1],
            dst[2],
            dst[3],
            src[0],
            src[1],
            src[2],
            src[3],
            3
          );
          this.writeXmm128U32(regIdx, out);
          this.writeReg(REG.EIP, (addr + len) >>> 0);
          return true;
        }
        if (op2 === 0x6e) { // movd xmm, r/m32
          let value = 0;
          if (modrmInfo.mod === 3) {
            value = this.readReg32ByIndex(modrmInfo.rm) >>> 0;
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea === null) {
              return false;
            }
            value = this.readMem32(ea) >>> 0;
          }
          this.scratchXmmWordsA[0] = value >>> 0;
          this.scratchXmmWordsA[1] = 0;
          this.scratchXmmWordsA[2] = 0;
          this.scratchXmmWordsA[3] = 0;
          this.writeXmm128U32(regIdx, this.scratchXmmWordsA);
          this.writeReg(REG.EIP, (addr + len) >>> 0);
          return true;
        }
        if (op2 === 0x7e) { // movd r/m32, xmm
          const value = this.readXmmScalar32Bits(regIdx) >>> 0;
          if (modrmInfo.mod === 3) {
            this.writeReg32ByIndex(modrmInfo.rm, value >>> 0);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea === null) {
              return false;
            }
            this.writeMem32(ea, value >>> 0);
          }
          this.writeReg(REG.EIP, (addr + len) >>> 0);
          return true;
        }
        if (op2 === 0x2e) { // ucomiss xmm, xmm/m32
          let b = 0;
          if (modrmInfo.mod === 3) {
            b = this.readXmmF32(modrmInfo.rm, 0);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea === null) {
              return false;
            }
            b = this.readMemFloat32(ea);
          }
          const code = sseCompareCode(this.readXmmF32(regIdx, 0), b);
          let flags = this.readReg(REG.EFLAGS);
          flags &= ~(FLAG_ZF | FLAG_PF | FLAG_CF);
          if (code === 3) {
            flags |= FLAG_ZF | FLAG_PF | FLAG_CF;
          } else if (code === 2) {
            flags |= FLAG_ZF;
          } else if (code === 1) {
            flags |= FLAG_CF;
          }
          this.writeReg(REG.EFLAGS, flags >>> 0);
          this.writeReg(REG.EIP, (addr + len) >>> 0);
          return true;
        }
      }
      if (op2 === 0x29 || op2 === 0x13) {
        const bytes = this.readMemBlock(addr, 20);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        const len = 2 + modrmInfo.size;
        const regIdx = modrmInfo.reg & 7;
        if (op2 === 0x29) { // movaps xmm/m128, xmm
          if (modrmInfo.mod === 3) {
            this.copyXmm(modrmInfo.rm, regIdx);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea === null) {
              return false;
            }
            this.readXmm128U32(regIdx, this.scratchXmmWordsA);
            if (!this.writeMem128U32(ea, this.scratchXmmWordsA)) {
              return false;
            }
          }
          this.writeReg(REG.EIP, (addr + len) >>> 0);
          return true;
        }
        // op2 === 0x13: movlps m64, xmm
        if (modrmInfo.mod !== 3) {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          this.readXmm64U32(regIdx, 0, this.scratchQwordA);
          if (!this.writeMem64U32(ea, this.scratchQwordA)) {
            return false;
          }
          this.writeReg(REG.EIP, (addr + len) >>> 0);
          return true;
        }
        return false;
      }
      if (op2 === 0x6f || op2 === 0x7f || op2 === 0xd5 || op2 === 0xd8 || op2 === 0xd9 || op2 === 0xe0 || op2 === 0xe9 || op2 === 0xfd) {
        const bytes = this.readMemBlock(addr, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        const len = 2 + modrmInfo.size;
        const regIdx = modrmInfo.reg & 7;
        if (op2 === 0x6f) { // movq mm, mm/m64
          const src = this.readModrmMmxSourceU32(modrmInfo, this.scratchQwordA);
          if (!src) {
            return false;
          }
          this.writeMmx64U32(regIdx, src);
          this.writeReg(REG.EIP, (addr + len) >>> 0);
          return true;
        }
        if (op2 === 0x7f) { // movq mm/m64, mm
          const src = this.readMmx64U32(regIdx, this.scratchQwordA);
          if (modrmInfo.mod === 3) {
            this.writeMmx64U32(modrmInfo.rm, src);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea === null) {
              return false;
            }
            if (!this.writeMem64U32(ea, src)) {
              return false;
            }
          }
          this.writeReg(REG.EIP, (addr + len) >>> 0);
          return true;
        }
        if (op2 === 0xd5 || op2 === 0xd8 || op2 === 0xd9 || op2 === 0xe0 || op2 === 0xe9 || op2 === 0xfd) { // pmullw / psubusb / psubusw / pavgb / psubsw / paddw
          const src = this.readModrmMmxSourceU32(modrmInfo, this.scratchQwordA);
          if (!src) {
            return false;
          }
          const dst = this.readMmx64U32(regIdx, this.scratchQwordB);
          let resLo = 0;
          let resHi = 0;
          if (op2 === 0xd5) {
            resLo = pmullw32(dst[0], src[0]);
            resHi = pmullw32(dst[1], src[1]);
          } else if (op2 === 0xd8) {
            resLo = psubusb32(dst[0], src[0]);
            resHi = psubusb32(dst[1], src[1]);
          } else if (op2 === 0xd9) {
            resLo = psubusw32(dst[0], src[0]);
            resHi = psubusw32(dst[1], src[1]);
          } else if (op2 === 0xe0) {
            resLo = pavgb32(dst[0], src[0]);
            resHi = pavgb32(dst[1], src[1]);
          } else if (op2 === 0xe9) {
            resLo = psubsw32(dst[0], src[0]);
            resHi = psubsw32(dst[1], src[1]);
          } else {
            resLo = paddw32(dst[0], src[0]);
            resHi = paddw32(dst[1], src[1]);
          }
          this.scratchQwordB[0] = resLo >>> 0;
          this.scratchQwordB[1] = resHi >>> 0;
          this.writeMmx64U32(regIdx, this.scratchQwordB);
          this.writeReg(REG.EIP, (addr + len) >>> 0);
          return true;
        }
      }
      if (op2 === 0x31) {
        if (!this.tscBase) {
          this.tscBase = Date.now();
        }
        const t = (Date.now() - this.tscBase) >>> 0;
        const ticks = (t * 1000) >>> 0;
        this.writeReg(REG.EAX, ticks >>> 0);
        this.writeReg(REG.EDX, 0);
        this.writeReg(REG.EIP, (addr + 2) >>> 0);
        return true;
      }
      if (op2 === 0xa2) {
        const eax = this.readReg(REG.EAX) >>> 0;
        const ecx = this.readReg(REG.ECX) >>> 0;
        const leaf = typeof this.getReportedCpuidLeaf === "function"
          ? this.getReportedCpuidLeaf(eax >>> 0, ecx >>> 0)
          : null;
        this.writeReg(REG.EAX, leaf ? (leaf.eax >>> 0) : 0);
        this.writeReg(REG.EBX, leaf ? (leaf.ebx >>> 0) : 0);
        this.writeReg(REG.ECX, leaf ? (leaf.ecx >>> 0) : 0);
        this.writeReg(REG.EDX, leaf ? (leaf.edx >>> 0) : 0);
        this.writeReg(REG.EIP, (addr + 2) >>> 0);
        return true;
      }
      if (op2 === 0xb6 || op2 === 0xb7 || op2 === 0xbe || op2 === 0xbf) {
        const bytes = this.readMemBlock(addr, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        let value = 0;
        if (op2 === 0xb6 || op2 === 0xbe) {
          if (modrmInfo.mod === 3) {
            value = this.readReg8ByIndex(modrmInfo.rm);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea === null) {
              return false;
            }
            value = this.readMem8(ea);
          }
          if (op2 === 0xbe) {
            value = (value << 24) >> 24;
          }
        } else {
          if (modrmInfo.mod === 3) {
            value = this.readReg32ByIndex(modrmInfo.rm) & 0xffff;
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea === null) {
              return false;
            }
            value = this.readMem16(ea);
          }
          if (op2 === 0xbf) {
            value = (value << 16) >> 16;
          }
        }
        this.writeReg32ByIndex(modrmInfo.reg, value >>> 0);
        this.writeReg(REG.EIP, (addr + 2 + modrmInfo.size) >>> 0);
        return true;
      }
      if (op2 === 0xaf) {
        const bytes = this.readMemBlock(addr, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 2);
        let src = 0;
        if (modrmInfo.mod === 3) {
          src = this.readReg32ByIndex(modrmInfo.rm);
        } else {
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return false;
          }
          src = this.readMem32(ea);
        }
        const dst = this.readReg32ByIndex(modrmInfo.reg);
        const result = imulSignedWidth(dst, src, 32, this.readReg(REG.EFLAGS));
        this.writeReg32ByIndex(modrmInfo.reg, result.result >>> 0);
        this.writeReg(REG.EFLAGS, result.flags >>> 0);
        this.writeReg(REG.EIP, (addr + 2 + modrmInfo.size) >>> 0);
        return true;
      }
    }
    case 0xcc:
    if (opcode === 0xcc) { // int3
      this.handleInterrupt(3);
      this.writeReg(REG.EIP, (addr + 1) >>> 0);
      return true;
    }
    case 0xcd:
    if (opcode === 0xcd) {
      const intno = this.readMem8((addr + 1) >>> 0);
      this.repeatCurrentInstruction = false;
      this.handleInterrupt(intno);
      if (this.repeatCurrentInstruction) {
        this.writeReg(REG.EIP, addr >>> 0);
      } else {
        this.writeReg(REG.EIP, (addr + 2) >>> 0);
      }
      this.repeatCurrentInstruction = false;
      return true;
    }
    case 0x9b:
    if (opcode === 0x9b) {
      this.writeReg(REG.EIP, (addr + 1) >>> 0);
      return true;
    }
    case 0xdc:
    if (opcode === 0xdc) {
      return this.handleFpuDc(addr);
    }
    case 0xd9:
    if (opcode === 0xd9) {
      return this.handleFpuD9(addr);
    }
    case 0xd8:
    if (opcode === 0xd8) {
      return this.handleFpuD8(addr);
    }
    case 0xdd:
    if (opcode === 0xdd) {
      return this.handleFpuDd(addr);
    }
    case 0xda:
    if (opcode === 0xda) {
      return this.handleFpuDa(addr);
    }
    case 0xde:
    if (opcode === 0xde) {
      return this.handleFpuDe(addr);
    }
    case 0xdf:
    if (opcode === 0xdf) {
      return this.handleFpuDf(addr);
    }
    case 0xdb:
    if (opcode === 0xdb) {
      return this.handleFpuDb(addr);
    }
    case 0xa0:
    case 0xa1:
    case 0xa2:
    case 0xa3:
    if (opcode === 0xa0 || opcode === 0xa1 || opcode === 0xa2 || opcode === 0xa3) {
      const addrSize = this.addrSizeOverride === 16 ? 2 : 4;
      const imm = addrSize === 2
        ? (this.readMem16((addr + 1) >>> 0) & 0xffff)
        : (this.readMem32((addr + 1) >>> 0) >>> 0);
      const len = 1 + addrSize;
      if (opcode === 0xa0) { // MOV AL, moffs
        const value = this.readMem8(imm);
        const eax = this.readReg(REG.EAX);
        this.writeReg(REG.EAX, ((eax & 0xffffff00) | (value & 0xff)) >>> 0);
      } else if (opcode === 0xa1) { // MOV EAX, moffs
        const value = this.readMem32(imm);
        this.writeReg(REG.EAX, value);
      } else if (opcode === 0xa2) { // MOV moffs, AL
        const eax = this.readReg(REG.EAX) >>> 0;
        this.writeMem8(imm, eax & 0xff);
      } else if (opcode === 0xa3) { // MOV moffs, EAX
        const eax = this.readReg(REG.EAX);
        this.writeMem32(imm, eax);
      }
      this.writeReg(REG.EIP, (addr + len) >>> 0);
      return true;
    }
    default:
      return false;
    }
      },

      executeSseInstruction(addr, prefix) {
        const bytes = this.readMemBlock(addr, 32);
        if (!bytes) {
          return false;
        }
        if (bytes[1] !== 0x0f) {
          return false;
        }
        const op = bytes[2];
        if (prefix !== 0xf3 && prefix !== 0xf2) {
          return false;
        }
        const modrmInfo = this.decodeModRm8(bytes, 3);
        const len = 3 + modrmInfo.size;
        const regIdx = modrmInfo.reg & 7;
    
        const readMemFloat = (ea) => this.readMemFloat32(ea >>> 0);
        const readSrcFloat = () => {
          if (modrmInfo.mod === 3) {
            return this.readXmmF32(modrmInfo.rm, 0);
          }
          const ea = this.calcEffectiveAddress(modrmInfo);
          if (ea === null) {
            return null;
          }
          return readMemFloat(ea);
        };
    
        if (prefix === 0xf3) {
          if (op === 0x10) { // movss xmm, xmm/m32
            const value = readSrcFloat();
            if (value === null) {
              return false;
            }
            this.writeXmmF32(regIdx, 0, value);
            this.writeReg(REG.EIP, (addr + len) >>> 0);
            return true;
          }
          if (op === 0x11) { // movss xmm/m32, xmm
            const value = this.readXmmF32(regIdx, 0);
            if (modrmInfo.mod === 3) {
              this.writeXmmF32(modrmInfo.rm, 0, value);
            } else {
              const ea = this.calcEffectiveAddress(modrmInfo);
              if (ea === null) {
                return false;
              }
              this.writeMemFloat32(ea, value);
            }
            this.writeReg(REG.EIP, (addr + len) >>> 0);
            return true;
          }
          if (op === 0x6f) { // movdqu xmm, xmm/m128
            if (modrmInfo.mod === 3) {
              this.copyXmm(regIdx, modrmInfo.rm);
            } else {
              if (!this.readModrmXmmSourceU32(modrmInfo, this.scratchXmmWordsA)) {
                return false;
              }
              this.writeXmm128U32(regIdx, this.scratchXmmWordsA);
            }
            this.writeReg(REG.EIP, (addr + len) >>> 0);
            return true;
          }
          if (op === 0x7f) { // movdqu xmm/m128, xmm
            if (modrmInfo.mod === 3) {
              this.copyXmm(modrmInfo.rm, regIdx);
            } else {
              const ea = this.calcEffectiveAddress(modrmInfo);
              if (ea === null) {
                return false;
              }
              this.readXmm128U32(regIdx, this.scratchXmmWordsA);
              if (!this.writeMem128U32(ea, this.scratchXmmWordsA)) {
                return false;
              }
            }
            this.writeReg(REG.EIP, (addr + len) >>> 0);
            return true;
          }
          if (op === 0x2a) { // cvtsi2ss xmm, r/m32
            let value = 0;
            if (modrmInfo.mod === 3) {
              value = this.readReg32ByIndex(modrmInfo.rm) | 0;
            } else {
              const ea = this.calcEffectiveAddress(modrmInfo);
              if (ea === null) {
                return false;
              }
              value = this.readMem32(ea) | 0;
            }
            this.writeXmmF32(regIdx, 0, value);
            this.writeReg(REG.EIP, (addr + len) >>> 0);
            return true;
          }
          if (op === 0x2d) { // cvtss2si r32, xmm/m32
            const value = readSrcFloat();
            if (value === null) {
              return false;
            }
            let out = 0;
            if (Number.isFinite(value)) {
              out = Math.round(value);
            }
            this.writeReg32ByIndex(regIdx, out | 0);
            this.writeReg(REG.EIP, (addr + len) >>> 0);
            return true;
          }
          if (op === 0x58 || op === 0x59 || op === 0x5c || op === 0x5e || op === 0x5d || op === 0x5f) {
            const srcBits = this.readModrmXmmScalar32Bits(modrmInfo);
            if (srcBits === null) {
              return false;
            }
            const dstBits = this.readXmmScalar32Bits(regIdx) >>> 0;
            let resultBits = dstBits >>> 0;
            if (op === 0x58) { // addss
              resultBits = sseBinaryFloat32Bits(dstBits, srcBits, 0);
            } else if (op === 0x59) { // mulss
              resultBits = sseBinaryFloat32Bits(dstBits, srcBits, 2);
            } else if (op === 0x5c) { // subss
              resultBits = sseBinaryFloat32Bits(dstBits, srcBits, 1);
            } else if (op === 0x5e) { // divss
              resultBits = sseBinaryFloat32Bits(dstBits, srcBits, 3);
            } else if (op === 0x5d) { // minss
              resultBits = sseBinaryFloat32Bits(dstBits, srcBits, 4);
            } else if (op === 0x5f) { // maxss
              resultBits = sseBinaryFloat32Bits(dstBits, srcBits, 5);
            }
            this.writeXmmScalar32Bits(regIdx, resultBits >>> 0);
            this.writeReg(REG.EIP, (addr + len) >>> 0);
            return true;
          }
        }
        if (prefix === 0xf2) {
          if (op === 0x7c) { // haddps xmm, xmm/m128 (SSE3)
            const src = this.readModrmXmmSourceU32(modrmInfo, this.scratchXmmWordsA);
            if (!src) {
              return false;
            }
            const dst = this.readXmm128U32(regIdx, this.scratchXmmWordsB);
            const out = haddps32x4(
              dst[0],
              dst[1],
              dst[2],
              dst[3],
              src[0], src[1], src[2], src[3]
            );
            this.writeXmm128U32(regIdx, out);
            this.writeReg(REG.EIP, (addr + len) >>> 0);
            return true;
          }
        }
        return false;
      },

      tryFastRepStringInstruction(opcode, operandSize, addrSize, df, count, esi, edi, eax, repPrefix, flags) {
        if (!this.cpu || df || addrSize !== 32 || count <= 1) {
          return null;
        }
        const mem = this.cpu.mem;
        const view = this.cpu.view;
        if (opcode === 0xa4 || opcode === 0xa5) {
          const unit = opcode === 0xa4 ? 1 : operandSize;
          const byteCount = count * unit;
          if (
            !this.canUseFlatBulkMemory(esi, byteCount, addrSize) ||
            !this.canUseFlatBulkMemory(edi, byteCount, addrSize)
          ) {
            return null;
          }
          const src = esi >>> 0;
          const dst = edi >>> 0;
          if (dst > src && dst < src + byteCount) {
            return null;
          }
          this.invalidateBasicBlocksForWrite(dst, byteCount);
          mem.set(mem.subarray(src, src + byteCount), dst);
          return {
            esi: (src + byteCount) >>> 0,
            edi: (dst + byteCount) >>> 0,
            ecx: 0,
            flags: flags >>> 0
          };
        }
        if (opcode === 0xaa) {
          const byteCount = count >>> 0;
          if (!this.canUseFlatBulkMemory(edi, byteCount, addrSize)) {
            return null;
          }
          const dst = edi >>> 0;
          this.invalidateBasicBlocksForWrite(dst, byteCount);
          mem.fill(eax & 0xff, dst, dst + byteCount);
          return {
            esi: esi >>> 0,
            edi: (dst + byteCount) >>> 0,
            ecx: 0,
            flags: flags >>> 0
          };
        }
        if (opcode === 0xab) {
          const unit = operandSize;
          const byteCount = count * unit;
          if (!this.canUseFlatBulkMemory(edi, byteCount, addrSize)) {
            return null;
          }
          const pattern = unit === 2
            ? new Uint8Array([
              eax & 0xff,
              (eax >>> 8) & 0xff
            ])
            : new Uint8Array([
              eax & 0xff,
              (eax >>> 8) & 0xff,
              (eax >>> 16) & 0xff,
              (eax >>> 24) & 0xff
            ]);
          if (!this.fillMemPattern(edi, byteCount, pattern)) {
            return null;
          }
          return {
            esi: esi >>> 0,
            edi: ((edi >>> 0) + byteCount) >>> 0,
            ecx: 0,
            flags: flags >>> 0
          };
        }
        if (opcode === 0xa6 || opcode === 0xa7) {
          const unit = opcode === 0xa6 ? 1 : operandSize;
          const byteCount = count * unit;
          if (
            !this.canUseFlatBulkMemory(esi, byteCount, addrSize) ||
            !this.canUseFlatBulkMemory(edi, byteCount, addrSize)
          ) {
            return null;
          }
          const srcBase = esi >>> 0;
          const dstBase = edi >>> 0;
          const stopOnEqual = repPrefix === 0xf2;
          let iterations = 0;
          let left = 0;
          let right = 0;
          while (iterations < count) {
            const offset = iterations * unit;
            if (unit === 1) {
              left = mem[srcBase + offset] >>> 0;
              right = mem[dstBase + offset] >>> 0;
            } else if (unit === 2) {
              left = view.getUint16(srcBase + offset, true) & 0xffff;
              right = view.getUint16(dstBase + offset, true) & 0xffff;
            } else {
              left = view.getUint32(srcBase + offset, true) >>> 0;
              right = view.getUint32(dstBase + offset, true) >>> 0;
            }
            iterations += 1;
            const equal = left === right;
            if ((stopOnEqual && equal) || (!stopOnEqual && !equal)) {
              break;
            }
          }
          if (iterations <= 0) {
            return null;
          }
          const nextFlags = aluBinaryWidth(7, left, right, unit === 1 ? 8 : (unit === 2 ? 16 : 32), flags).flags >>> 0;
          const advance = iterations * unit;
          return {
            esi: (srcBase + advance) >>> 0,
            edi: (dstBase + advance) >>> 0,
            ecx: (count - iterations) >>> 0,
            flags: nextFlags
          };
        }
        if (opcode === 0xae || opcode === 0xaf) {
          const unit = opcode === 0xae ? 1 : operandSize;
          const byteCount = count * unit;
          if (!this.canUseFlatBulkMemory(edi, byteCount, addrSize)) {
            return null;
          }
          const dstBase = edi >>> 0;
          const stopOnEqual = repPrefix === 0xf2;
          const needle = unit === 1 ? (eax & 0xff) : (unit === 2 ? (eax & 0xffff) : (eax >>> 0));
          let iterations = 0;
          let value = 0;
          while (iterations < count) {
            const offset = iterations * unit;
            if (unit === 1) {
              value = mem[dstBase + offset] >>> 0;
            } else if (unit === 2) {
              value = view.getUint16(dstBase + offset, true) & 0xffff;
            } else {
              value = view.getUint32(dstBase + offset, true) >>> 0;
            }
            iterations += 1;
            const equal = needle === value;
            if ((stopOnEqual && equal) || (!stopOnEqual && !equal)) {
              break;
            }
          }
          if (iterations <= 0) {
            return null;
          }
          const nextFlags = aluBinaryWidth(7, needle, value, unit === 1 ? 8 : (unit === 2 ? 16 : 32), flags).flags >>> 0;
          const advance = iterations * unit;
          return {
            esi: esi >>> 0,
            edi: (dstBase + advance) >>> 0,
            ecx: (count - iterations) >>> 0,
            flags: nextFlags
          };
        }
        return null;
      },

      tryFastRuntimeCopyLoop(addr) {
        if (!this.cpu) {
          return false;
        }
        const mem = this.cpu.mem;
        const start = addr >>> 0;
        if (matchBytes(mem, start, FAST_RUNTIME_COPY_LOOP_FWD)) {
          const esi = this.readReg(REG.ESI) >>> 0;
          const edi = this.readReg(REG.EDI) >>> 0;
          const end = this.readReg(REG.ECX) >>> 0;
          if (end < edi) {
            return false;
          }
          const byteCount = (end - edi) >>> 0;
          if (byteCount && (
            !this.canUseFlatBulkMemory(esi, byteCount, 32) ||
            !this.canUseFlatBulkMemory(edi, byteCount, 32)
          )) {
            return false;
          }
          if (byteCount) {
            this.invalidateBasicBlocksForWrite(edi, byteCount);
            mem.set(mem.subarray(esi, esi + byteCount), edi);
          }
          this.writeReg(REG.ESI, (esi + byteCount) >>> 0);
          this.writeReg(REG.EDI, end >>> 0);
          this.writeReg(REG.EIP, (start + FAST_RUNTIME_COPY_LOOP_FWD.length) >>> 0);
          return true;
        }
        if (matchBytes(mem, start, FAST_RUNTIME_COPY_LOOP_BWD)) {
          const dst = this.readReg(REG.EAX) >>> 0;
          const src = this.readReg(REG.EDX) >>> 0;
          const count = this.readReg(REG.ECX) >>> 0;
          if (count && (
            !this.canUseFlatBulkMemory(src, count, 32) ||
            !this.canUseFlatBulkMemory(dst, count, 32)
          )) {
            return false;
          }
          if (count) {
            this.invalidateBasicBlocksForWrite(dst, count);
            mem.set(mem.subarray(src, src + count), dst);
          }
          this.writeReg(REG.ECX, 0);
          this.writeReg(REG.EIP, (start + FAST_RUNTIME_COPY_LOOP_BWD.length) >>> 0);
          return true;
        }
        return false;
      },

      getFastLoopInfo(addr, site) {
        const cached = this.fastLoopCache.get(addr >>> 0);
        if (cached !== undefined) {
          this.fastLoopHits += 1;
          return cached;
        }
        this.fastLoopMisses += 1;
        if (!this.cpu) {
          this.fastLoopCache.set(addr >>> 0, null);
          return null;
        }
        const rel = site.rel !== undefined
          ? (site.rel | 0)
          : ((site.bytes[1] << 24) >> 24);
        const target = (addr + site.len + rel) >>> 0;
        if (target >= addr) {
          this.fastLoopCache.set(addr >>> 0, null);
          return null;
        }
        const bodyLen = (addr - target) >>> 0;
        const mem = this.cpu.mem;
        if (target + bodyLen > mem.length) {
          this.fastLoopCache.set(addr >>> 0, null);
          return null;
        }
        let info = null;
        if (bodyLen === FAST_LOOP_SHADE.length && matchBytes(mem, target, FAST_LOOP_SHADE)) {
          info = { kind: "shade", bodyLen };
        } else if (bodyLen === FAST_LOOP_BLUR.length && matchBytes(mem, target, FAST_LOOP_BLUR)) {
          info = { kind: "blur", bodyLen };
        } else if (bodyLen === FAST_LOOP_BLUR_RIGHT.length && matchBytes(mem, target, FAST_LOOP_BLUR_RIGHT)) {
          info = { kind: "blur-right", bodyLen };
        }
        this.fastLoopCache.set(addr >>> 0, info);
        return info;
      },

      runFastLoop(info, addr, site) {
        if (!this.cpu) {
          return false;
        }
        const ecx = this.readReg(REG.ECX) >>> 0;
        if (ecx === 0) {
          return false;
        }
        const iterations = (ecx - 1) >>> 0;
        if (iterations > FAST_LOOP_MAX) {
          return false;
        }
        if (iterations === 0) {
          this.writeReg(REG.ECX, 0);
          this.writeReg(REG.EIP, (addr + site.len) >>> 0);
          return true;
        }
    
        const edi0 = this.readReg(REG.EDI) >>> 0;
        const view = this.cpu.view;
        const memLen = this.cpu.mem.length;
    
        let offsets = null;
        if (info.kind === "shade") {
          offsets = [0];
        } else if (info.kind === "blur") {
          const stride = this.readReg(REG.EAX) | 0;
          offsets = [0, 1, -1, stride, -stride];
        } else if (info.kind === "blur-right") {
          const stride = this.readReg(REG.EAX) | 0;
          offsets = [0, 1, stride, stride + 1];
        } else {
          return false;
        }
    
        let minOff = offsets[0];
        let maxOff = offsets[0];
        for (let i = 1; i < offsets.length; i += 1) {
          const off = offsets[i];
          if (off < minOff) {
            minOff = off;
          }
          if (off > maxOff) {
            maxOff = off;
          }
        }
        const lastBase = edi0 + (iterations - 1) * 8;
        const minAddr = edi0 + minOff;
        const maxAddr = lastBase + maxOff + 7;
        if (minAddr < 0 || maxAddr >= memLen) {
          return false;
        }
        this.invalidateBasicBlocksForWrite(edi0 >>> 0, (iterations * 8) >>> 0);
    
        let addrCursor = edi0;
        if (info.kind === "shade") {
          const mm1 = this.readMmx64U32(1, this.scratchQwordA);
          let lastLo = 0;
          let lastHi = 0;
          for (let i = 0; i < iterations; i += 1) {
            const lo = view.getUint32(addrCursor, true);
            const hi = view.getUint32(addrCursor + 4, true);
            const outLo = psubusb32(lo, mm1[0]);
            const outHi = psubusb32(hi, mm1[1]);
            view.setUint32(addrCursor, outLo, true);
            view.setUint32(addrCursor + 4, outHi, true);
            lastLo = outLo;
            lastHi = outHi;
            addrCursor += 8;
          }
          this.scratchQwordB[0] = lastLo >>> 0;
          this.scratchQwordB[1] = lastHi >>> 0;
          this.writeMmx64U32(0, this.scratchQwordB);
        } else if (info.kind === "blur") {
          const stride = this.readReg(REG.EAX) | 0;
          let lastMm0Lo = 0;
          let lastMm0Hi = 0;
          let lastMm1Lo = 0;
          let lastMm1Hi = 0;
          let lastMm2Lo = 0;
          let lastMm2Hi = 0;
          let lastMm3Lo = 0;
          let lastMm3Hi = 0;
          let lastMm4Lo = 0;
          let lastMm4Hi = 0;
          let lastMm5Lo = 0;
          let lastMm5Hi = 0;
          for (let i = 0; i < iterations; i += 1) {
            const o0Lo = view.getUint32(addrCursor, true);
            const o0Hi = view.getUint32(addrCursor + 4, true);
            const m1Lo = view.getUint32(addrCursor + 1, true);
            const m1Hi = view.getUint32(addrCursor + 5, true);
            const m2Lo = view.getUint32(addrCursor - 1, true);
            const m2Hi = view.getUint32(addrCursor + 3, true);
            const m4Lo = view.getUint32(addrCursor - stride, true);
            const m4Hi = view.getUint32(addrCursor - stride + 4, true);
            const m5Lo = view.getUint32(addrCursor + stride, true);
            const m5Hi = view.getUint32(addrCursor + stride + 4, true);
    
            let mm0Lo = pavgb32(o0Lo, m1Lo);
            let mm0Hi = pavgb32(o0Hi, m1Hi);
            let mm3Lo = pavgb32(o0Lo, m2Lo);
            let mm3Hi = pavgb32(o0Hi, m2Hi);
            const mm4Lo = pavgb32(m4Lo, m5Lo);
            const mm4Hi = pavgb32(m4Hi, m5Hi);
            mm3Lo = pavgb32(mm3Lo, mm4Lo);
            mm3Hi = pavgb32(mm3Hi, mm4Hi);
            mm0Lo = pavgb32(mm0Lo, mm3Lo);
            mm0Hi = pavgb32(mm0Hi, mm3Hi);
    
            view.setUint32(addrCursor, mm0Lo, true);
            view.setUint32(addrCursor + 4, mm0Hi, true);
    
            lastMm0Lo = mm0Lo;
            lastMm0Hi = mm0Hi;
            lastMm1Lo = m1Lo;
            lastMm1Hi = m1Hi;
            lastMm2Lo = m2Lo;
            lastMm2Hi = m2Hi;
            lastMm3Lo = mm3Lo;
            lastMm3Hi = mm3Hi;
            lastMm4Lo = mm4Lo;
            lastMm4Hi = mm4Hi;
            lastMm5Lo = m5Lo;
            lastMm5Hi = m5Hi;
            addrCursor += 8;
          }
          this.scratchQwordA[0] = lastMm0Lo >>> 0;
          this.scratchQwordA[1] = lastMm0Hi >>> 0;
          this.writeMmx64U32(0, this.scratchQwordA);
          this.scratchQwordA[0] = lastMm1Lo >>> 0;
          this.scratchQwordA[1] = lastMm1Hi >>> 0;
          this.writeMmx64U32(1, this.scratchQwordA);
          this.scratchQwordA[0] = lastMm2Lo >>> 0;
          this.scratchQwordA[1] = lastMm2Hi >>> 0;
          this.writeMmx64U32(2, this.scratchQwordA);
          this.scratchQwordA[0] = lastMm3Lo >>> 0;
          this.scratchQwordA[1] = lastMm3Hi >>> 0;
          this.writeMmx64U32(3, this.scratchQwordA);
          this.scratchQwordA[0] = lastMm4Lo >>> 0;
          this.scratchQwordA[1] = lastMm4Hi >>> 0;
          this.writeMmx64U32(4, this.scratchQwordA);
          this.scratchQwordA[0] = lastMm5Lo >>> 0;
          this.scratchQwordA[1] = lastMm5Hi >>> 0;
          this.writeMmx64U32(5, this.scratchQwordA);
        } else if (info.kind === "blur-right") {
          const stride = this.readReg(REG.EAX) | 0;
          let lastMm0Lo = 0;
          let lastMm0Hi = 0;
          let lastMm1Lo = 0;
          let lastMm1Hi = 0;
          let lastMm2Lo = 0;
          let lastMm2Hi = 0;
          let lastMm3Lo = 0;
          let lastMm3Hi = 0;
          for (let i = 0; i < iterations; i += 1) {
            const o0Lo = view.getUint32(addrCursor, true);
            const o0Hi = view.getUint32(addrCursor + 4, true);
            const m1Lo = view.getUint32(addrCursor + 1, true);
            const m1Hi = view.getUint32(addrCursor + 5, true);
            const m2Lo = view.getUint32(addrCursor + stride, true);
            const m2Hi = view.getUint32(addrCursor + stride + 4, true);
            const m3Lo = view.getUint32(addrCursor + stride + 1, true);
            const m3Hi = view.getUint32(addrCursor + stride + 5, true);
    
            let mm0Lo = pavgb32(o0Lo, m1Lo);
            let mm0Hi = pavgb32(o0Hi, m1Hi);
            let mm3Lo = pavgb32(m3Lo, m2Lo);
            let mm3Hi = pavgb32(m3Hi, m2Hi);
            mm0Lo = pavgb32(mm0Lo, mm3Lo);
            mm0Hi = pavgb32(mm0Hi, mm3Hi);
    
            view.setUint32(addrCursor, mm0Lo, true);
            view.setUint32(addrCursor + 4, mm0Hi, true);
    
            lastMm0Lo = mm0Lo;
            lastMm0Hi = mm0Hi;
            lastMm1Lo = m1Lo;
            lastMm1Hi = m1Hi;
            lastMm2Lo = m2Lo;
            lastMm2Hi = m2Hi;
            lastMm3Lo = m3Lo;
            lastMm3Hi = m3Hi;
            addrCursor += 8;
          }
          this.scratchQwordA[0] = lastMm0Lo >>> 0;
          this.scratchQwordA[1] = lastMm0Hi >>> 0;
          this.writeMmx64U32(0, this.scratchQwordA);
          this.scratchQwordA[0] = lastMm1Lo >>> 0;
          this.scratchQwordA[1] = lastMm1Hi >>> 0;
          this.writeMmx64U32(1, this.scratchQwordA);
          this.scratchQwordA[0] = lastMm2Lo >>> 0;
          this.scratchQwordA[1] = lastMm2Hi >>> 0;
          this.writeMmx64U32(2, this.scratchQwordA);
          this.scratchQwordA[0] = lastMm3Lo >>> 0;
          this.scratchQwordA[1] = lastMm3Hi >>> 0;
          this.writeMmx64U32(3, this.scratchQwordA);
        }
    
        const lastBeforeAdd = (edi0 + (iterations - 1) * 8) >>> 0;
        const finalEdi = (edi0 + iterations * 8) >>> 0;
        const flags = this.readReg(REG.EFLAGS);
        const nextFlags = updateAddFlags(flags, lastBeforeAdd, 8, finalEdi, 32);
        this.writeReg(REG.EFLAGS, nextFlags >>> 0);
        this.writeReg(REG.EDI, finalEdi);
        this.writeReg(REG.ECX, 0);
        this.writeReg(REG.EIP, (addr + site.len) >>> 0);
        return true;
      },

      handleSoftInstruction(addr, siteOverride) {
        const current = addr >>> 0;
        let site = siteOverride || null;
        if (!site && this.softInstructionSites instanceof Map) {
          site = this.softInstructionSites.get(current);
        }
        if (!site && typeof this.getDynamicSoftInstructionSite === "function") {
          site = this.getDynamicSoftInstructionSite(current);
        }
        const cpu = this.cpu || null;
        const regs = cpu && cpu.regs ? cpu.regs : null;
        const fastKind = getSoftSiteFastKind(site);
        if (site && regs) {
          if (fastKind === SOFT_KIND_CALL_REL32) {
            const next = site.next !== undefined
              ? (site.next >>> 0)
              : ((site.next = ((current + site.len) >>> 0)) >>> 0);
            const target = site.target !== undefined
              ? (site.target >>> 0)
              : (
                site.target = (
                  site.rel !== undefined
                    ? ((next + (site.rel | 0)) >>> 0)
                    : (
                      site.bytes && site.bytes.length >= 5
                        ? (
                          next +
                          (
                            site.bytes[1] |
                            (site.bytes[2] << 8) |
                            (site.bytes[3] << 16) |
                            (site.bytes[4] << 24)
                          )
                        ) >>> 0
                        : 0
                    )
                ) >>> 0
              );
            const nextEsp = (regs[REG.ESP] - 4) >>> 0;
            this.writeMem32(nextEsp, next);
            regs[REG.ESP] = nextEsp >>> 0;
            regs[REG.EIP] = target >>> 0;
            return true;
          }
          if (fastKind === SOFT_KIND_RET) {
            const esp = regs[REG.ESP] >>> 0;
            regs[REG.EIP] = this.readMem32(esp) >>> 0;
            regs[REG.ESP] = (esp + 4) >>> 0;
            return true;
          }
          if (fastKind === SOFT_KIND_JCC) {
            const next = site.next !== undefined
              ? (site.next >>> 0)
              : ((site.next = ((current + site.len) >>> 0)) >>> 0);
            const target = site.target !== undefined
              ? (site.target >>> 0)
              : ((site.target = ((next + (site.rel | 0)) >>> 0)) >>> 0);
            const flags = regs[REG.EFLAGS] >>> 0;
            const cc = site.cc & 0x0f;
            const take =
              cc === 4 ? !!(flags & FLAG_ZF)
                : (cc === 5 ? !(flags & FLAG_ZF) : evalJccCondition(cc, flags));
            regs[REG.EIP] = take ? target : next;
            return true;
          }
          if (fastKind === SOFT_KIND_JMP) {
            regs[REG.EIP] = site.target !== undefined
              ? (site.target >>> 0)
              : ((site.target = ((current + site.len + (site.rel | 0)) >>> 0)) >>> 0);
            return true;
          }
        }
        let first = 0;
        if (site && site.bytes && site.bytes.length) {
          first = site.bytes[0] & 0xff;
        } else if (cpu && cpu.mem && current < (cpu.mem.length >>> 0)) {
          first = cpu.mem[current] & 0xff;
        }
        if (
          (first === (FAST_RUNTIME_COPY_LOOP_FWD[0] & 0xff) || first === (FAST_RUNTIME_COPY_LOOP_BWD[0] & 0xff)) &&
          this.tryFastRuntimeCopyLoop(addr)
        ) {
          return true;
        }
        if (site && site.bytes && site.bytes.length) {
          if (
            first === 0x66 ||
            first === 0x67 ||
            first === 0xf0 ||
            first === 0xf2 ||
            first === 0xf3 ||
            first === 0x2e ||
            first === 0x36 ||
            first === 0x3e ||
            first === 0x26 ||
            first === 0x64 ||
            first === 0x65
          ) {
            return false;
          }
        }
        if (site && fastKind === SOFT_KIND_BSWAP) {
          const regIdx = site.reg & 7;
          const value = this.readReg32ByIndex(regIdx);
          const swapped = bswap32(value >>> 0);
          switch (regIdx) {
            case 0: this.writeReg(REG.EAX, swapped >>> 0); break;
            case 1: this.writeReg(REG.ECX, swapped >>> 0); break;
            case 2: this.writeReg(REG.EDX, swapped >>> 0); break;
            case 3: this.writeReg(REG.EBX, swapped >>> 0); break;
            case 4: this.writeReg(REG.ESP, swapped >>> 0); break;
            case 5: this.writeReg(REG.EBP, swapped >>> 0); break;
            case 6: this.writeReg(REG.ESI, swapped >>> 0); break;
            case 7: this.writeReg(REG.EDI, swapped >>> 0); break;
            default: break;
          }
          this.writeReg(REG.EIP, (addr + site.len) >>> 0);
          return true;
        }
        if (site && fastKind === SOFT_KIND_LOOP) {
          const fast = this.getFastLoopInfo(addr, site);
          if (fast && this.runFastLoop(fast, addr, site)) {
            return true;
          }
          return this.executeLoopInstruction(addr, site.opcode === undefined ? 0xe2 : (site.opcode & 0xff), site.len);
        }
        if (site && site.type === "shlb-mem1") {
          const modrmInfo = this.getCachedModRmInfo(addr, site.bytes, 1);
          const flags = this.readReg(REG.EFLAGS);
          if (modrmInfo.mod === 3) {
            const value = this.readReg8ByIndex(modrmInfo.rm);
            const res = shiftRotate(value, 1, 8, 4, flags);
            if (!res.ok) {
              return false;
            }
            this.writeReg8ByIndex(modrmInfo.rm, res.result & 0xff);
            this.writeReg(REG.EFLAGS, res.flags >>> 0);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea !== null) {
              const value = this.readMem8(ea);
              const res = shiftRotate(value, 1, 8, 4, flags);
              if (!res.ok) {
                return false;
              }
              this.writeMem8(ea, res.result & 0xff);
              this.writeReg(REG.EFLAGS, res.flags >>> 0);
            }
          }
          this.writeReg(REG.EIP, (addr + site.len) >>> 0);
          return true;
        }
        if (site && site.type === "shrb-mem-imm") {
          const modrmInfo = this.getCachedModRmInfo(addr, site.bytes, 1);
          const imm = site.bytes[site.bytes.length - 1] & 0xff;
          const shift = imm & 0x1f;
          const flags = this.readReg(REG.EFLAGS);
          if (modrmInfo.mod === 3) {
            const value = this.readReg8ByIndex(modrmInfo.rm);
            const res = shiftRotate(value, shift, 8, 5, flags);
            if (!res.ok) {
              return false;
            }
            this.writeReg8ByIndex(modrmInfo.rm, res.result & 0xff);
            this.writeReg(REG.EFLAGS, res.flags >>> 0);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea !== null) {
              const value = this.readMem8(ea);
              const res = shiftRotate(value, shift, 8, 5, flags);
              if (!res.ok) {
                return false;
              }
              this.writeMem8(ea, res.result & 0xff);
              this.writeReg(REG.EFLAGS, res.flags >>> 0);
            }
          }
          this.writeReg(REG.EIP, (addr + site.len) >>> 0);
          return true;
        }
        if (site && (site.type === "shl32-imm" || site.type === "shr32-imm")) {
          const modrmInfo = this.getCachedModRmInfo(addr, site.bytes, 1);
          const imm = site.bytes[site.bytes.length - 1] & 0xff;
          const shift = imm & 0x1f;
          let value = 0;
          if (modrmInfo.mod === 3) {
            value = this.readReg32ByIndex(modrmInfo.rm);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea !== null) {
              value = this.readMem32(ea);
            }
          }
          const res = shiftRotate(value, shift, 32, site.type === "shl32-imm" ? 4 : 5, this.readReg(REG.EFLAGS));
          if (!res.ok) {
            return false;
          }
          const result = res.result >>> 0;
          if (modrmInfo.mod === 3) {
            const regIdx = modrmInfo.rm & 7;
            switch (regIdx) {
              case 0: this.writeReg(REG.EAX, result); break;
              case 1: this.writeReg(REG.ECX, result); break;
              case 2: this.writeReg(REG.EDX, result); break;
              case 3: this.writeReg(REG.EBX, result); break;
              case 4: this.writeReg(REG.ESP, result); break;
              case 5: this.writeReg(REG.EBP, result); break;
              case 6: this.writeReg(REG.ESI, result); break;
              case 7: this.writeReg(REG.EDI, result); break;
              default: break;
            }
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea !== null) {
              this.writeMem32(ea, result);
            }
          }
          this.writeReg(REG.EFLAGS, res.flags >>> 0);
          this.writeReg(REG.EIP, (addr + site.len) >>> 0);
          return true;
        }
        if (site && (site.type === "mov8-rm-r" || site.type === "mov8-r-rm")) {
          const modrmInfo = this.getCachedModRmInfo(addr, site.bytes, 1);
          if (site.type === "mov8-rm-r") {
            const value = this.readReg8ByIndex(modrmInfo.reg);
            if (modrmInfo.mod === 3) {
              this.writeReg8ByIndex(modrmInfo.rm, value);
            } else {
              const ea = this.calcEffectiveAddress(modrmInfo);
              if (ea !== null) {
                this.writeMem8(ea, value);
              }
            }
          } else {
            let value = 0;
            if (modrmInfo.mod === 3) {
              value = this.readReg8ByIndex(modrmInfo.rm);
            } else {
              const ea = this.calcEffectiveAddress(modrmInfo);
              if (ea !== null) {
                value = this.readMem8(ea);
              }
            }
            this.writeReg8ByIndex(modrmInfo.reg, value);
          }
          this.writeReg(REG.EIP, (addr + site.len) >>> 0);
          return true;
        }
        if (site && (site.type === "mov32-rm-r" || site.type === "mov32-r-rm")) {
          const modrmInfo = this.getCachedModRmInfo(addr, site.bytes, 1);
          if (site.type === "mov32-rm-r") {
            const value = this.readReg32ByIndex(modrmInfo.reg);
            if (modrmInfo.mod === 3) {
              const regIdx = modrmInfo.rm & 7;
              switch (regIdx) {
                case 0: this.writeReg(REG.EAX, value); break;
                case 1: this.writeReg(REG.ECX, value); break;
                case 2: this.writeReg(REG.EDX, value); break;
                case 3: this.writeReg(REG.EBX, value); break;
                case 4: this.writeReg(REG.ESP, value); break;
                case 5: this.writeReg(REG.EBP, value); break;
                case 6: this.writeReg(REG.ESI, value); break;
                case 7: this.writeReg(REG.EDI, value); break;
                default: break;
              }
            } else {
              const ea = this.calcEffectiveAddress(modrmInfo);
              if (ea !== null) {
                this.writeMem32(ea, value);
              }
            }
          } else {
            let value = 0;
            if (modrmInfo.mod === 3) {
              value = this.readReg32ByIndex(modrmInfo.rm);
            } else {
              const ea = this.calcEffectiveAddress(modrmInfo);
              if (ea !== null) {
                value = this.readMem32(ea);
              }
            }
            const regIdx = modrmInfo.reg & 7;
            switch (regIdx) {
              case 0: this.writeReg(REG.EAX, value); break;
              case 1: this.writeReg(REG.ECX, value); break;
              case 2: this.writeReg(REG.EDX, value); break;
              case 3: this.writeReg(REG.EBX, value); break;
              case 4: this.writeReg(REG.ESP, value); break;
              case 5: this.writeReg(REG.EBP, value); break;
              case 6: this.writeReg(REG.ESI, value); break;
              case 7: this.writeReg(REG.EDI, value); break;
              default: break;
            }
          }
          this.writeReg(REG.EIP, (addr + site.len) >>> 0);
          return true;
        }
        if (site && (site.type === "push-r32" || site.type === "pop-r32")) {
          const regIdx = site.reg & 7;
          if (site.type === "push-r32") {
            const value = this.readReg32ByIndex(regIdx);
            let esp = this.readReg(REG.ESP);
            esp = (esp - 4) >>> 0;
            this.writeMem32(esp, value);
            this.writeReg(REG.ESP, esp);
          } else {
            let esp = this.readReg(REG.ESP);
            const value = this.readMem32(esp);
            esp = (esp + 4) >>> 0;
            this.writeReg(REG.ESP, esp);
            switch (regIdx) {
              case 0: this.writeReg(REG.EAX, value); break;
              case 1: this.writeReg(REG.ECX, value); break;
              case 2: this.writeReg(REG.EDX, value); break;
              case 3: this.writeReg(REG.EBX, value); break;
              case 4: this.writeReg(REG.ESP, value); break;
              case 5: this.writeReg(REG.EBP, value); break;
              case 6: this.writeReg(REG.ESI, value); break;
              case 7: this.writeReg(REG.EDI, value); break;
              default: break;
            }
          }
          this.writeReg(REG.EIP, (addr + site.len) >>> 0);
          return true;
        }
        if (site && (site.type === "inc-r32" || site.type === "dec-r32")) {
          const regIdx = site.reg & 7;
          const value = this.readReg32ByIndex(regIdx);
          const delta = site.type === "inc-r32" ? 1 : -1;
          const result = (value + delta) | 0;
          const origFlags = this.readReg(REG.EFLAGS);
          const alu = aluBinaryWidth(site.type === "inc-r32" ? 0 : 5, value, 1, 32, origFlags);
          let flags = alu.flags >>> 0;
          flags = (flags & ~FLAG_CF) | (origFlags & FLAG_CF);
          switch (regIdx) {
            case 0: this.writeReg(REG.EAX, result >>> 0); break;
            case 1: this.writeReg(REG.ECX, result >>> 0); break;
            case 2: this.writeReg(REG.EDX, result >>> 0); break;
            case 3: this.writeReg(REG.EBX, result >>> 0); break;
            case 4: this.writeReg(REG.ESP, result >>> 0); break;
            case 5: this.writeReg(REG.EBP, result >>> 0); break;
            case 6: this.writeReg(REG.ESI, result >>> 0); break;
            case 7: this.writeReg(REG.EDI, result >>> 0); break;
            default: break;
          }
          this.writeReg(REG.EFLAGS, flags >>> 0);
          this.writeReg(REG.EIP, (addr + site.len) >>> 0);
          return true;
        }
        if (site && site.type === "and-al-imm8") {
          const imm = site.bytes[1] & 0xff;
          const eax = this.readReg(REG.EAX);
          const al = eax & 0xff;
          const alu = aluBinaryWidth(4, al, imm, 8, this.readReg(REG.EFLAGS));
          const nextEax = (eax & 0xffffff00) | (alu.result & 0xff);
          this.writeReg(REG.EAX, nextEax >>> 0);
          this.writeReg(REG.EFLAGS, alu.flags >>> 0);
          this.writeReg(REG.EIP, (addr + site.len) >>> 0);
          return true;
        }
        if (site && site.type === "call-rel32") {
          const bytes = site.bytes;
          const rel = site.rel !== undefined
            ? (site.rel | 0)
            : (
              bytes && bytes.length >= 5
                ? (
                  bytes[1] |
                  (bytes[2] << 8) |
                  (bytes[3] << 16) |
                  (bytes[4] << 24)
                ) | 0
                : null
            );
          if (rel === null) {
            return false;
          }
          const next = (addr + site.len) >>> 0;
          const target = (next + rel) >>> 0;
          let esp = this.readReg(REG.ESP);
          esp = (esp - 4) >>> 0;
          this.writeMem32(esp, next);
          this.writeReg(REG.ESP, esp);
          this.writeReg(REG.EIP, target);
          return true;
        }
        if (site && site.type === "ret") {
          let esp = this.readReg(REG.ESP);
          const target = this.readMem32(esp);
          esp = (esp + 4) >>> 0;
          this.writeReg(REG.ESP, esp);
          this.writeReg(REG.EIP, target >>> 0);
          return true;
        }
        if (site && site.type === "jecxz") {
          const next = (addr + site.len) >>> 0;
          const check = this.readCountReg(this.getActiveAddressSize());
          this.writeReg(REG.EIP, check === 0 ? (next + (site.rel | 0)) >>> 0 : next);
          return true;
        }
        if (site && site.type === "jcc") {
          const flags = this.readReg(REG.EFLAGS);
          const take = evalJccCondition(site.cc, flags);
          const next = (addr + site.len) >>> 0;
          const target = (next + (site.rel | 0)) >>> 0;
          this.writeReg(REG.EIP, take ? target : next);
          return true;
        }
        if (site && site.type === "jmp") {
          const next = (addr + site.len) >>> 0;
          const target = (next + (site.rel | 0)) >>> 0;
          this.writeReg(REG.EIP, target);
          return true;
        }
        if (site && (site.type === "xor32-rm-r" || site.type === "or32-rm-r")) {
          const modrmInfo = this.getCachedModRmInfo(addr, site.bytes, 1);
          const rhs = this.readReg32ByIndex(modrmInfo.reg);
          let lhs = 0;
          if (modrmInfo.mod === 3) {
            lhs = this.readReg32ByIndex(modrmInfo.rm);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea !== null) {
              lhs = this.readMem32(ea);
            }
          }
          const alu = aluBinaryWidth(site.type === "xor32-rm-r" ? 6 : 1, lhs, rhs, 32, this.readReg(REG.EFLAGS));
          const result = alu.result >>> 0;
          if (modrmInfo.mod === 3) {
            const regIdx = modrmInfo.rm & 7;
            switch (regIdx) {
              case 0: this.writeReg(REG.EAX, result); break;
              case 1: this.writeReg(REG.ECX, result); break;
              case 2: this.writeReg(REG.EDX, result); break;
              case 3: this.writeReg(REG.EBX, result); break;
              case 4: this.writeReg(REG.ESP, result); break;
              case 5: this.writeReg(REG.EBP, result); break;
              case 6: this.writeReg(REG.ESI, result); break;
              case 7: this.writeReg(REG.EDI, result); break;
              default: break;
            }
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea !== null) {
              this.writeMem32(ea, result);
            }
          }
          this.writeReg(REG.EFLAGS, alu.flags >>> 0);
          this.writeReg(REG.EIP, (addr + site.len) >>> 0);
          return true;
        }
        if (site && site.type === "alu-imm") {
          const bytes = site.bytes;
          const opcode = site.opcode;
          const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
          const widthBits = (opcode === 0x80 || opcode === 0x82) ? 8 : 32;
          let imm = 0;
          if (opcode === 0x81) {
            const idx = bytes.length - 4;
            imm =
              bytes[idx] |
              (bytes[idx + 1] << 8) |
              (bytes[idx + 2] << 16) |
              (bytes[idx + 3] << 24);
          } else if (opcode === 0x82) {
            imm = bytes[bytes.length - 1] & 0xff;
          } else {
            imm = (bytes[bytes.length - 1] << 24) >> 24;
          }
    
          let op1 = 0;
          if (widthBits === 8) {
            if (modrmInfo.mod === 3) {
              op1 = this.readReg8ByIndex(modrmInfo.rm);
            } else {
              const ea = this.calcEffectiveAddress(modrmInfo);
              if (ea !== null) {
                op1 = this.readMem8(ea);
              }
            }
          } else {
            if (modrmInfo.mod === 3) {
              op1 = this.readReg32ByIndex(modrmInfo.rm);
            } else {
              const ea = this.calcEffectiveAddress(modrmInfo);
              if (ea !== null) {
                op1 = this.readMem32(ea);
              }
            }
          }
    
          if (site.regField !== 0 && site.regField !== 1 && site.regField !== 4 && site.regField !== 5 && site.regField !== 7) {
            return false;
          }
          const alu = aluBinaryWidth(site.regField, op1, imm, widthBits, this.readReg(REG.EFLAGS));
          const result = alu.result >>> 0;
    
          if (site.regField !== 7) {
            if (widthBits === 8) {
              if (modrmInfo.mod === 3) {
                this.writeReg8ByIndex(modrmInfo.rm, result);
              } else {
                const ea = this.calcEffectiveAddress(modrmInfo);
                if (ea !== null) {
                  this.writeMem8(ea, result);
                }
              }
            } else {
              if (modrmInfo.mod === 3) {
                const regIdx = modrmInfo.rm & 7;
                switch (regIdx) {
                  case 0: this.writeReg(REG.EAX, result >>> 0); break;
                  case 1: this.writeReg(REG.ECX, result >>> 0); break;
                  case 2: this.writeReg(REG.EDX, result >>> 0); break;
                  case 3: this.writeReg(REG.EBX, result >>> 0); break;
                  case 4: this.writeReg(REG.ESP, result >>> 0); break;
                  case 5: this.writeReg(REG.EBP, result >>> 0); break;
                  case 6: this.writeReg(REG.ESI, result >>> 0); break;
                  case 7: this.writeReg(REG.EDI, result >>> 0); break;
                  default: break;
                }
              } else {
                const ea = this.calcEffectiveAddress(modrmInfo);
                if (ea !== null) {
                  this.writeMem32(ea, result >>> 0);
                }
              }
            }
          }
    
          this.writeReg(REG.EFLAGS, alu.flags >>> 0);
          this.writeReg(REG.EIP, (addr + site.len) >>> 0);
          return true;
        }
        if (site && site.type === "pusha") {
          let esp = this.readReg(REG.ESP);
          const eax = this.readReg(REG.EAX);
          const ecx = this.readReg(REG.ECX);
          const edx = this.readReg(REG.EDX);
          const ebx = this.readReg(REG.EBX);
          const ebp = this.readReg(REG.EBP);
          const esi = this.readReg(REG.ESI);
          const edi = this.readReg(REG.EDI);
          const origEsp = esp >>> 0;
          esp = (esp - 4) >>> 0; this.writeMem32(esp, eax);
          esp = (esp - 4) >>> 0; this.writeMem32(esp, ecx);
          esp = (esp - 4) >>> 0; this.writeMem32(esp, edx);
          esp = (esp - 4) >>> 0; this.writeMem32(esp, ebx);
          esp = (esp - 4) >>> 0; this.writeMem32(esp, origEsp);
          esp = (esp - 4) >>> 0; this.writeMem32(esp, ebp);
          esp = (esp - 4) >>> 0; this.writeMem32(esp, esi);
          esp = (esp - 4) >>> 0; this.writeMem32(esp, edi);
          this.writeReg(REG.ESP, esp >>> 0);
          this.writeReg(REG.EIP, (addr + site.len) >>> 0);
          return true;
        }
        if (site && site.type === "popa") {
          let esp = this.readReg(REG.ESP);
          const edi = this.readMem32(esp); esp = (esp + 4) >>> 0;
          const esi = this.readMem32(esp); esp = (esp + 4) >>> 0;
          const ebp = this.readMem32(esp); esp = (esp + 4) >>> 0;
          esp = (esp + 4) >>> 0; // skip ESP
          const ebx = this.readMem32(esp); esp = (esp + 4) >>> 0;
          const edx = this.readMem32(esp); esp = (esp + 4) >>> 0;
          const ecx = this.readMem32(esp); esp = (esp + 4) >>> 0;
          const eax = this.readMem32(esp); esp = (esp + 4) >>> 0;
          this.writeReg(REG.EDI, edi);
          this.writeReg(REG.ESI, esi);
          this.writeReg(REG.EBP, ebp);
          this.writeReg(REG.EBX, ebx);
          this.writeReg(REG.EDX, edx);
          this.writeReg(REG.ECX, ecx);
          this.writeReg(REG.EAX, eax);
          this.writeReg(REG.ESP, esp >>> 0);
          this.writeReg(REG.EIP, (addr + site.len) >>> 0);
          return true;
        }
        if (site && site.type === "testb-imm8") {
          const bytes = site.bytes;
          if (!bytes || bytes.length < 3 || bytes[0] !== 0xf6) {
            return false;
          }
          const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
          const imm = bytes[bytes.length - 1] & 0xff;
          let value = 0;
          if (modrmInfo.mod === 3) {
            value = this.readReg8ByIndex(modrmInfo.rm);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea !== null) {
              value = this.readMem8(ea);
            }
          }
    
          const result = (value & imm) & 0xff;
          let flags = this.readReg(REG.EFLAGS);
          flags &= ~(FLAG_CF | FLAG_PF | FLAG_ZF | FLAG_SF | FLAG_OF);
          if (result === 0) {
            flags |= FLAG_ZF;
          }
          if (result & 0x80) {
            flags |= FLAG_SF;
          }
          if (parityEven8(result)) {
            flags |= FLAG_PF;
          }
          this.writeReg(REG.EFLAGS, flags >>> 0);
          this.writeReg(REG.EIP, (addr + site.len) >>> 0);
          return true;
        }
        const bytes = this.readMemBlock(addr >>> 0, 3);
        if (!bytes || bytes.length < 3) {
          return false;
        }
        if (bytes[0] === 0x0f && bytes[1] === 0xc8) {
          const eax = this.readReg(REG.EAX);
          const swapped =
            ((eax & 0xff) << 24) |
            ((eax & 0xff00) << 8) |
            ((eax >>> 8) & 0xff00) |
            ((eax >>> 24) & 0xff);
          this.writeReg(REG.EAX, swapped >>> 0);
          this.writeReg(REG.EIP, (addr + 2) >>> 0);
          return true;
        }
        if (bytes[0] === 0xe2) {
          const pseudoSite = { len: 2, bytes };
          const fast = this.getFastLoopInfo(addr, pseudoSite);
          if (fast && this.runFastLoop(fast, addr, pseudoSite)) {
            return true;
          }
          let ecx = this.readReg(REG.ECX);
          ecx = (ecx - 1) >>> 0;
          this.writeReg(REG.ECX, ecx);
          const rel = (bytes[1] << 24) >> 24;
          const next = ecx !== 0 ? addr + 2 + rel : addr + 2;
          this.writeReg(REG.EIP, next >>> 0);
          return true;
        }
        if (bytes[0] === 0xd0 && bytes[1] === 0x27) {
          const edi = this.readReg(REG.EDI);
          const value = (this.readMem8(edi) << 1) & 0xff;
          this.writeMem8(edi, value);
          this.writeReg(REG.EIP, (addr + 2) >>> 0);
          return true;
        }
        if (bytes[0] === 0xc0 && bytes[1] === 0x2f && bytes[2] === 0x04) {
          const edi = this.readReg(REG.EDI);
          const value = (this.readMem8(edi) >>> 4) & 0xff;
          this.writeMem8(edi, value);
          this.writeReg(REG.EIP, (addr + 3) >>> 0);
          return true;
        }
        return false;
      },

    
    });

    // Fast opcode dispatch table
    const _ft = new Array(256);
    Emulator.prototype._opcodeFastTable = _ft;

    // NOP
    _ft[0x90] = function(addr) {
      this.writeReg(REG.EIP, (addr + 1) >>> 0);
      return true;
    };

    // PUSH reg32 (0x50-0x57)
    for (let i = 0x50; i <= 0x57; i++) {
      const ri = i - 0x50;
      _ft[i] = function(addr) {
        const value = this.readReg32ByIndex(ri);
        let esp = this.readReg(REG.ESP);
        esp = (esp - 4) >>> 0;
        this.writeMem32(esp, value);
        this.writeReg(REG.ESP, esp);
        this.writeReg(REG.EIP, (addr + 1) >>> 0);
        return true;
      };
    }

    // POP reg32 (0x58-0x5f)
    for (let i = 0x58; i <= 0x5f; i++) {
      const ri = i - 0x58;
      _ft[i] = function(addr) {
        let esp = this.readReg(REG.ESP);
        const value = this.readMem32(esp);
        esp = (esp + 4) >>> 0;
        this.writeReg(REG.ESP, esp);
        this.writeReg32ByIndex(ri, value);
        this.writeReg(REG.EIP, (addr + 1) >>> 0);
        return true;
      };
    }

    // RET near (0xc3)
    _ft[0xc3] = function(addr) {
      const promoted = this.promoteDynamicSoftInstruction(addr);
      if (promoted !== null) {
        return !!promoted;
      }
      let esp = this.readReg(REG.ESP);
      const target = this.readMem32(esp);
      esp = (esp + 4) >>> 0;
      this.writeReg(REG.ESP, esp);
      this.writeReg(REG.EIP, target >>> 0);
      return true;
    };

    // JMP short (0xeb)
    _ft[0xeb] = function(addr) {
      const promoted = this.promoteDynamicSoftInstruction(addr);
      if (promoted !== null) {
        return !!promoted;
      }
      const rel8 = (this.readMem8((addr + 1) >>> 0) << 24) >> 24;
      const next = (addr + 2) >>> 0;
      this.writeReg(REG.EIP, (next + rel8) >>> 0);
      return true;
    };

    // Jcc short (0x70-0x7f)
    for (let i = 0x70; i <= 0x7f; i++) {
      const op = i;
      _ft[i] = function(addr) {
        const promoted = this.promoteDynamicSoftInstruction(addr);
        if (promoted !== null) {
          return !!promoted;
        }
        const rel8 = (this.readMem8((addr + 1) >>> 0) << 24) >> 24;
        const flags = this.readReg(REG.EFLAGS);
        const take = evalJccCondition(op & 0x0f, flags);
        const next = (addr + 2) >>> 0;
        this.writeReg(REG.EIP, take ? (next + rel8) >>> 0 : next);
        return true;
      };
    }

    // MOV r/m32, r32 (0x89) / MOV r32, r/m32 (0x8b) / LEA r32, m (0x8d)
    for (let i = 0x89; i <= 0x8d; i += 2) {
      const opcode = i;
      _ft[i] = function(addr) {
        const bytes = this.readMemBlock(addr, 16);
        if (!bytes) {
          return false;
        }
        const modrmInfo = this.getCachedModRmInfo(addr, bytes, 1);
        if (opcode === 0x8d) {
          let value = 0;
          if (modrmInfo.mod === 3) {
            value = this.readReg32ByIndex(modrmInfo.rm);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea === null) {
              return false;
            }
            value = ea >>> 0;
          }
          this.writeReg32ByIndex(modrmInfo.reg, value >>> 0);
          this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size) >>> 0);
          return true;
        }
        if (opcode === 0x8b) {
          let value = 0;
          if (modrmInfo.mod === 3) {
            value = this.readReg32ByIndex(modrmInfo.rm);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea === null) {
              return false;
            }
            value = this.readMem32(ea);
          }
          this.writeReg32ByIndex(modrmInfo.reg, value >>> 0);
        } else {
          const value = this.readReg32ByIndex(modrmInfo.reg);
          if (modrmInfo.mod === 3) {
            this.writeReg32ByIndex(modrmInfo.rm, value);
          } else {
            const ea = this.calcEffectiveAddress(modrmInfo);
            if (ea === null) {
              return false;
            }
            this.writeMem32(ea, value);
          }
        }
        this.writeReg(REG.EIP, (addr + 1 + modrmInfo.size) >>> 0);
        return true;
      };
    }
  }

  KosEmu.emu.installCoreExecute = installCoreExecute;
})();

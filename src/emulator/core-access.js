(() => {
  const KosEmu = globalThis.KosEmu;

  function installCoreAccess(Emulator, shared) {
    if (!Emulator || !Emulator.prototype) {
      throw new Error("installCoreAccess requires an Emulator class.");
    }
    const REG = shared && shared.REG;
    const formatHex = shared && shared.formatHex;
    if (!REG || typeof formatHex !== "function") {
      throw new Error("installCoreAccess requires shared REG and formatHex helpers.");
    }

    Object.assign(Emulator.prototype, {
      readReg(reg) {
        if (!this.cpu) {
          return 0;
        }
        const regs = this.cpu.regs;
        const idx = reg | 0;
        if (idx < 0 || idx >= regs.length) {
          return 0;
        }
        return regs[idx] >>> 0;
      },

      writeReg(reg, value) {
        if (!this.cpu) {
          return;
        }
        const regs = this.cpu.regs;
        const v = value >>> 0;
        const idx = reg | 0;
        if (idx < 0 || idx >= regs.length) {
          return;
        }
        regs[idx] = v;
      },

      readReg32ByIndex(index) {
        return this.readReg(index & 7);
      },

      writeReg32ByIndex(index, value) {
        const v = value >>> 0;
        this.writeReg(index & 7, v);
      },

      readReg16ByIndex(index) {
        return this.readReg32ByIndex(index & 7) & 0xffff;
      },

      writeReg16ByIndex(index, value) {
        const idx = index & 7;
        const reg = this.readReg32ByIndex(idx);
        const next = (reg & 0xffff0000) | (value & 0xffff);
        this.writeReg32ByIndex(idx, next >>> 0);
      },

      readReg8ByIndex(index) {
        const idx = index & 7;
        if (idx <= 3) {
          return this.readReg32ByIndex(idx) & 0xff;
        }
        return (this.readReg32ByIndex(idx - 4) >>> 8) & 0xff;
      },

      writeReg8ByIndex(index, value) {
        const idx = index & 7;
        const v = value & 0xff;
        if (idx <= 3) {
          const reg = this.readReg32ByIndex(idx);
          const next = (reg & 0xffffff00) | v;
          this.writeReg(
            idx === 0 ? REG.EAX :
            idx === 1 ? REG.ECX :
            idx === 2 ? REG.EDX :
            REG.EBX,
            next >>> 0
          );
        } else {
          const baseIdx = idx - 4;
          const reg = this.readReg32ByIndex(baseIdx);
          const next = (reg & 0xffff00ff) | (v << 8);
          this.writeReg(
            baseIdx === 0 ? REG.EAX :
            baseIdx === 1 ? REG.ECX :
            baseIdx === 2 ? REG.EDX :
            REG.EBX,
            next >>> 0
          );
        }
      },

      getActiveAddressSize() {
        return this.addrSizeOverride === 16 ? 16 : 32;
      },

      readAddrSizedReg(index, addrSize) {
        if (addrSize === 16) {
          return this.readReg16ByIndex(index & 7) & 0xffff;
        }
        return this.readReg32ByIndex(index & 7) >>> 0;
      },

      writeAddrSizedReg(index, value, addrSize) {
        if (addrSize === 16) {
          this.writeReg16ByIndex(index & 7, value & 0xffff);
          return;
        }
        this.writeReg32ByIndex(index & 7, value >>> 0);
      },

      readCountReg(addrSize) {
        return this.readAddrSizedReg(REG.ECX, addrSize);
      },

      writeCountReg(addrSize, value) {
        this.writeAddrSizedReg(REG.ECX, value, addrSize);
      },

      advanceAddrSizedValue(value, delta, addrSize) {
        if (addrSize === 16) {
          return (value + delta) & 0xffff;
        }
        return (value + delta) >>> 0;
      },

      decodeModRm8(bytes, startIndex, addressSizeOverride) {
        let idx = startIndex;
        const modrm = bytes[idx++];
        const mod = modrm >> 6;
        const reg = (modrm >> 3) & 7;
        const rm = modrm & 7;
        const addrSize = addressSizeOverride === 16 ? 16 : (addressSizeOverride === 32 ? 32 : (this.addrSizeOverride === 16 ? 16 : 32));
        let hasSib = false;
        let baseReg = rm;
        let indexReg = -1;
        let scale = 1;
        let disp = 0;
        if (addrSize === 32) {
          if (mod !== 3 && rm === 4) {
            const sib = bytes[idx++];
            hasSib = true;
            scale = 1 << (sib >> 6);
            const idxReg = (sib >> 3) & 7;
            indexReg = idxReg === 4 ? -1 : idxReg;
            baseReg = sib & 7;
          }
          if (mod === 0) {
            if (rm === 5 || (hasSib && baseReg === 5)) {
              disp =
                bytes[idx] |
                (bytes[idx + 1] << 8) |
                (bytes[idx + 2] << 16) |
                (bytes[idx + 3] << 24);
              idx += 4;
              baseReg = -1;
            }
          } else if (mod === 1) {
            disp = (bytes[idx] << 24) >> 24;
            idx += 1;
          } else if (mod === 2) {
            disp =
              bytes[idx] |
              (bytes[idx + 1] << 8) |
              (bytes[idx + 2] << 16) |
              (bytes[idx + 3] << 24);
            idx += 4;
          }
        } else {
          scale = 1;
          indexReg = -1;
          switch (rm) {
            case 0:
              baseReg = 3;
              indexReg = 6;
              break;
            case 1:
              baseReg = 3;
              indexReg = 7;
              break;
            case 2:
              baseReg = 5;
              indexReg = 6;
              break;
            case 3:
              baseReg = 5;
              indexReg = 7;
              break;
            case 4:
              baseReg = 6;
              indexReg = -1;
              break;
            case 5:
              baseReg = 7;
              indexReg = -1;
              break;
            case 6:
              if (mod === 0) {
                baseReg = -1;
                indexReg = -1;
              } else {
                baseReg = 5;
                indexReg = -1;
              }
              break;
            case 7:
              baseReg = 3;
              indexReg = -1;
              break;
            default:
              baseReg = rm;
              indexReg = -1;
              break;
          }
          if (mod === 0) {
            if (rm === 6) {
              disp = bytes[idx] | (bytes[idx + 1] << 8);
              idx += 2;
            }
          } else if (mod === 1) {
            disp = (bytes[idx] << 24) >> 24;
            idx += 1;
          } else if (mod === 2) {
            disp = bytes[idx] | (bytes[idx + 1] << 8);
            disp = (disp << 16) >> 16;
            idx += 2;
          }
        }
        return {
          mod,
          reg,
          rm,
          baseReg,
          indexReg,
          scale,
          disp,
          size: idx - startIndex,
          addrSize
        };
      },

      getDecodeSignature(bytes) {
        let sig0 = 0;
        let sig1 = 0;
        const len = bytes.length;
        const limit0 = Math.min(len, 4);
        for (let i = 0; i < limit0; i += 1) {
          sig0 |= (bytes[i] & 0xff) << (i * 8);
        }
        const limit1 = Math.min(len, 8);
        for (let i = 4; i < limit1; i += 1) {
          sig1 |= (bytes[i] & 0xff) << ((i - 4) * 8);
        }
        return { sig0: sig0 >>> 0, sig1: sig1 >>> 0 };
      },

      getDynamicSoftInstructionSite(addr) {
        if (!this.cpu || !this.cpu.mem || !this.decodeCache) {
          return null;
        }
        const start = addr >>> 0;
        const mem = this.cpu.mem;
        const view = this.cpu.view;
        const memLen = mem.length >>> 0;
        if (start >= memLen) {
          return null;
        }
        const entry = this.decodeCache.get(start);
        let sig0 = 0 >>> 0;
        let sig1 = 0 >>> 0;
        if ((start + 7) < memLen && view && typeof view.getUint32 === "function") {
          sig0 = view.getUint32(start, true) >>> 0;
          sig1 = view.getUint32((start + 4) >>> 0, true) >>> 0;
        } else {
          const limit0 = Math.min(4, memLen - start);
          for (let i = 0; i < limit0; i += 1) {
            sig0 |= (mem[start + i] & 0xff) << (i * 8);
          }
          const limit1 = Math.min(8, memLen - start);
          for (let i = 4; i < limit1; i += 1) {
            sig1 |= (mem[start + i] & 0xff) << ((i - 4) * 8);
          }
          sig0 >>>= 0;
          sig1 >>>= 0;
        }
        if (
          entry &&
          entry.sig0 === sig0 &&
          entry.sig1 === sig1 &&
          entry.softSiteKnown === 1
        ) {
          return entry.softSite;
        }
        const opcode = mem[start] & 0xff;
        let site = null;
        if (opcode >= 0x70 && opcode <= 0x7f) {
          if ((start + 1) < memLen) {
            const rel = (mem[start + 1] << 24) >> 24;
            site = { type: "jcc", cc: opcode & 0x0f, rel, len: 2 };
          }
        } else if (opcode === 0xeb) {
          if ((start + 1) < memLen) {
            const rel = (mem[start + 1] << 24) >> 24;
            site = { type: "jmp", rel, len: 2 };
          }
        } else if (opcode === 0xe9) {
          if ((start + 4) < memLen) {
            const rel =
              (mem[start + 1] & 0xff) |
              ((mem[start + 2] & 0xff) << 8) |
              ((mem[start + 3] & 0xff) << 16) |
              ((mem[start + 4] & 0xff) << 24);
            site = { type: "jmp", rel, len: 5 };
          }
        } else if (opcode === 0xe8) {
          if ((start + 4) < memLen) {
            const rel =
              (mem[start + 1] & 0xff) |
              ((mem[start + 2] & 0xff) << 8) |
              ((mem[start + 3] & 0xff) << 16) |
              ((mem[start + 4] & 0xff) << 24);
            site = { type: "call-rel32", rel, len: 5 };
          }
        } else if (opcode === 0xc3) {
          site = { type: "ret", len: 1 };
        } else if (opcode === 0xe3) {
          if ((start + 1) < memLen) {
            const rel = (mem[start + 1] << 24) >> 24;
            site = { type: "jecxz", rel, len: 2 };
          }
        } else if (opcode === 0xe0 || opcode === 0xe1 || opcode === 0xe2) {
          if ((start + 1) < memLen) {
            const rel = (mem[start + 1] << 24) >> 24;
            site = {
              type: "loop",
              opcode,
              rel,
              len: 2
            };
          }
        } else if (opcode === 0x0f) {
          if ((start + 5) < memLen) {
            const op2 = mem[start + 1] & 0xff;
            if (op2 >= 0x80 && op2 <= 0x8f) {
              const rel =
                (mem[start + 2] & 0xff) |
                ((mem[start + 3] & 0xff) << 8) |
                ((mem[start + 4] & 0xff) << 16) |
                ((mem[start + 5] & 0xff) << 24);
              site = { type: "jcc", cc: op2 & 0x0f, rel, len: 6 };
            }
          }
        }
        const next = entry && entry.sig0 === sig0 && entry.sig1 === sig1 ? entry : { sig0, sig1 };
        next.sig0 = sig0;
        next.sig1 = sig1;
        next.softSiteKnown = 1;
        next.softSite = site;
        this.decodeCache.set(start, next);
        if (this.decodeCache.size > this.decodeCacheMax) {
          this.decodeCache.clear();
        }
        return site;
      },

      getCachedModRmInfo(addr, bytes, startIndex) {
        const { sig0, sig1 } = this.getDecodeSignature(bytes);
        const entry = this.decodeCache.get(addr);
        const addrSize = this.addrSizeOverride === 16 ? 16 : 32;
        const key = startIndex === 2
          ? (addrSize === 16 ? "modrm2_16" : "modrm2")
          : (addrSize === 16 ? "modrm1_16" : "modrm1");
        if (entry && entry.sig0 === sig0 && entry.sig1 === sig1 && entry[key]) {
          this.decodeCacheHits += 1;
          return entry[key];
        }
        const modrmInfo = this.decodeModRm8(bytes, startIndex, addrSize);
        const next = entry && entry.sig0 === sig0 && entry.sig1 === sig1 ? entry : { sig0, sig1 };
        next.sig0 = sig0;
        next.sig1 = sig1;
        next[key] = modrmInfo;
        this.decodeCache.set(addr, next);
        if (this.decodeCache.size > this.decodeCacheMax) {
          this.decodeCache.clear();
        }
        this.decodeCacheMisses += 1;
        return modrmInfo;
      },

      getSegmentBase() {
        switch (this.segOverride) {
          case 0x26: return this.segES >>> 0;
          case 0x2e: return this.segCS >>> 0;
          case 0x36: return this.segSS >>> 0;
          case 0x3e: return this.segDS >>> 0;
          case 0x64: return this.segFS >>> 0;
          case 0x65: return this.segGS >>> 0;
          default: return 0;
        }
      },

      calcEffectiveAddress(modrmInfo) {
        if (modrmInfo.mod === 3) {
          return null;
        }
        const addrSize = modrmInfo.addrSize === 16 ? 16 : 32;
        if (addrSize === 16) {
          let base = 0;
          if (modrmInfo.baseReg >= 0) {
            base = this.readReg16ByIndex(modrmInfo.baseReg) & 0xffff;
          }
          let index = 0;
          if (modrmInfo.indexReg >= 0) {
            index = (this.readReg16ByIndex(modrmInfo.indexReg) * (modrmInfo.scale || 1)) & 0xffff;
          }
          const disp = modrmInfo.disp | 0;
          const addr = (base + index + disp) & 0xffff;
          const segBase = this.getSegmentBase();
          return (addr + segBase) >>> 0;
        }
        let base = 0;
        if (modrmInfo.baseReg >= 0) {
          base = this.readReg32ByIndex(modrmInfo.baseReg);
        }
        let index = 0;
        if (modrmInfo.indexReg >= 0) {
          index = (this.readReg32ByIndex(modrmInfo.indexReg) * modrmInfo.scale) >>> 0;
        }
        const addr = (base + index + (modrmInfo.disp | 0)) >>> 0;
        const segBase = this.getSegmentBase();
        return (addr + segBase) >>> 0;
      },

      readMmx(index) {
        if (!this.cpu) {
          return { lo: 0, hi: 0 };
        }
        const mmx = this.cpu.mmx;
        const base = (index & 7) * 2;
        return { lo: mmx[base] >>> 0, hi: mmx[base + 1] >>> 0 };
      },

      writeMmx(index, lo, hi) {
        if (!this.cpu) {
          return;
        }
        const mmx = this.cpu.mmx;
        const base = (index & 7) * 2;
        mmx[base] = lo >>> 0;
        mmx[base + 1] = hi >>> 0;
      },

      readMmx64U32(index, out) {
        const target = out || new Uint32Array(2);
        if (!this.cpu) {
          target[0] = 0;
          target[1] = 0;
          return target;
        }
        const mmx = this.cpu.mmx;
        const base = (index & 7) * 2;
        target[0] = mmx[base] >>> 0;
        target[1] = mmx[base + 1] >>> 0;
        return target;
      },

      writeMmx64U32(index, words) {
        if (!this.cpu || !words) {
          return false;
        }
        const mmx = this.cpu.mmx;
        const base = (index & 7) * 2;
        mmx[base] = words[0] >>> 0;
        mmx[base + 1] = words[1] >>> 0;
        return true;
      },

      readXmmU32(reg, lane) {
        if (!this.cpu) {
          return 0;
        }
        const base = (reg & 7) * 4 + (lane & 3);
        return this.cpu.xmm[base] >>> 0;
      },

      writeXmmU32(reg, lane, value) {
        if (!this.cpu) {
          return;
        }
        const base = (reg & 7) * 4 + (lane & 3);
        this.cpu.xmm[base] = value >>> 0;
      },

      readXmmScalar32Bits(reg) {
        if (!this.cpu) {
          return 0;
        }
        return this.cpu.xmm[(reg & 7) * 4] >>> 0;
      },

      writeXmmScalar32Bits(reg, value) {
        if (!this.cpu) {
          return;
        }
        this.cpu.xmm[(reg & 7) * 4] = value >>> 0;
      },

      readXmm64U32(reg, laneBase, out) {
        const target = out || new Uint32Array(2);
        if (!this.cpu) {
          target[0] = 0;
          target[1] = 0;
          return target;
        }
        const base = (reg & 7) * 4 + ((laneBase | 0) & 2);
        const xmm = this.cpu.xmm;
        target[0] = xmm[base] >>> 0;
        target[1] = xmm[base + 1] >>> 0;
        return target;
      },

      writeXmm64U32(reg, laneBase, words) {
        if (!this.cpu || !words) {
          return false;
        }
        const base = (reg & 7) * 4 + ((laneBase | 0) & 2);
        const xmm = this.cpu.xmm;
        xmm[base] = words[0] >>> 0;
        xmm[base + 1] = words[1] >>> 0;
        return true;
      },

      readXmmF32(reg, lane) {
        if (!this.cpu) {
          return 0;
        }
        const base = (reg & 7) * 4 + (lane & 3);
        return this.cpu.xmmF[base];
      },

      writeXmmF32(reg, lane, value) {
        if (!this.cpu) {
          return;
        }
        const base = (reg & 7) * 4 + (lane & 3);
        this.cpu.xmmF[base] = Number(value) || 0;
      },

      copyXmm(dst, src) {
        if (!this.cpu) {
          return;
        }
        const d = (dst & 7) * 4;
        const s = (src & 7) * 4;
        const xmm = this.cpu.xmm;
        xmm[d] = xmm[s];
        xmm[d + 1] = xmm[s + 1];
        xmm[d + 2] = xmm[s + 2];
        xmm[d + 3] = xmm[s + 3];
      },

      readXmm128U32(reg, out) {
        const target = out || new Uint32Array(4);
        if (!this.cpu) {
          target[0] = 0;
          target[1] = 0;
          target[2] = 0;
          target[3] = 0;
          return target;
        }
        const base = (reg & 7) * 4;
        const xmm = this.cpu.xmm;
        target[0] = xmm[base] >>> 0;
        target[1] = xmm[base + 1] >>> 0;
        target[2] = xmm[base + 2] >>> 0;
        target[3] = xmm[base + 3] >>> 0;
        return target;
      },

      writeXmm128U32(reg, words) {
        if (!this.cpu || !words) {
          return false;
        }
        const base = (reg & 7) * 4;
        const xmm = this.cpu.xmm;
        xmm[base] = words[0] >>> 0;
        xmm[base + 1] = words[1] >>> 0;
        xmm[base + 2] = words[2] >>> 0;
        xmm[base + 3] = words[3] >>> 0;
        return true;
      },

      readMem8(addr) {
        const cpu = this.cpu;
        if (!cpu) {
          return 0;
        }
        const start = addr >>> 0;
        const mem = cpu.mem;
        if (!mem) {
          return 0;
        }
        if ((start + 1) > (mem.length >>> 0) && !this.checkInterpreterMem(start, 1)) {
          return 0;
        }
        return mem[start] >>> 0;
      },

      writeMem8(addr, value) {
        if (!this.cpu) {
          return;
        }
        const start = addr >>> 0;
        if (!this.checkInterpreterMem(start, 1)) {
          return;
        }
        this.invalidateBasicBlocksForWrite(start, 1);
        this.cpu.mem[start] = value & 0xff;
      },

      readMem32(addr) {
        const cpu = this.cpu;
        if (!cpu) {
          return 0;
        }
        const start = addr >>> 0;
        const mem = cpu.mem;
        if (!mem) {
          return 0;
        }
        if ((start + 4) > (mem.length >>> 0) && !this.checkInterpreterMem(start, 4)) {
          return 0;
        }
        return cpu.view.getUint32(start, true) >>> 0;
      },

      readMemFloat32(addr) {
        if (!this.cpu) {
          return 0;
        }
        const start = addr >>> 0;
        if (!this.checkInterpreterMem(start, 4)) {
          return 0;
        }
        return this.cpu.view.getFloat32(start, true);
      },

      readMemFloat64(addr) {
        if (!this.cpu) {
          return 0;
        }
        const start = addr >>> 0;
        if (!this.checkInterpreterMem(start, 8)) {
          return 0;
        }
        return this.cpu.view.getFloat64(start, true);
      },

      writeMemFloat32(addr, value) {
        if (!this.cpu) {
          return;
        }
        const start = addr >>> 0;
        if (!this.checkInterpreterMem(start, 4)) {
          return;
        }
        this.invalidateBasicBlocksForWrite(start, 4);
        this.cpu.view.setFloat32(start, value, true);
      },

      writeMemFloat64(addr, value) {
        if (!this.cpu) {
          return;
        }
        const start = addr >>> 0;
        if (!this.checkInterpreterMem(start, 8)) {
          return;
        }
        this.invalidateBasicBlocksForWrite(start, 8);
        this.cpu.view.setFloat64(start, value, true);
      },

      readMem16(addr) {
        const cpu = this.cpu;
        if (!cpu) {
          return 0;
        }
        const start = addr >>> 0;
        const mem = cpu.mem;
        if (!mem) {
          return 0;
        }
        if ((start + 2) > (mem.length >>> 0) && !this.checkInterpreterMem(start, 2)) {
          return 0;
        }
        return cpu.view.getUint16(start, true) & 0xffff;
      },

      writeMem16(addr, value) {
        if (!this.cpu) {
          return;
        }
        const start = addr >>> 0;
        if (!this.checkInterpreterMem(start, 2)) {
          return;
        }
        this.invalidateBasicBlocksForWrite(start, 2);
        this.cpu.view.setUint16(start, value & 0xffff, true);
      },

      readMem16Signed(addr) {
        const v = this.readMem16(addr);
        return (v & 0x8000) ? (v - 0x10000) : v;
      },

      readMem64(addr) {
        const lo = this.readMem32(addr >>> 0);
        const hi = this.readMem32((addr + 4) >>> 0);
        return (BigInt(hi) << 32n) | BigInt(lo);
      },

      writeMem64(addr, value) {
        const v = BigInt.asUintN(64, BigInt(value));
        const lo = Number(v & 0xffffffffn) >>> 0;
        const hi = Number((v >> 32n) & 0xffffffffn) >>> 0;
        this.writeMem32(addr >>> 0, lo);
        this.writeMem32((addr + 4) >>> 0, hi);
      },

      writeMem32(addr, value) {
        if (!this.cpu) {
          return;
        }
        const start = addr >>> 0;
        if (!this.checkInterpreterMem(start, 4)) {
          return;
        }
        this.invalidateBasicBlocksForWrite(start, 4);
        this.cpu.view.setUint32(start, value >>> 0, true);
      },

      readMemBlock(addr, size) {
        const cpu = this.cpu;
        if (!cpu) {
          return null;
        }
        const mem = cpu.mem;
        if (!mem) {
          return null;
        }
        const start = addr >>> 0;
        const blockSize = size >>> 0;
        if ((start + blockSize) > (mem.length >>> 0) && !this.checkInterpreterMem(start, blockSize)) {
          return null;
        }
        const cacheMem0 = this.memBlockCacheMem0;
        if (
          cacheMem0 === mem &&
          (this.memBlockCacheStart0 >>> 0) === start &&
          (this.memBlockCacheSize0 >>> 0) === blockSize
        ) {
          return this.memBlockCacheView0;
        }
        const cacheMem1 = this.memBlockCacheMem1;
        if (
          cacheMem1 === mem &&
          (this.memBlockCacheStart1 >>> 0) === start &&
          (this.memBlockCacheSize1 >>> 0) === blockSize
        ) {
          const view1 = this.memBlockCacheView1;
          this.memBlockCacheMem1 = cacheMem0;
          this.memBlockCacheStart1 = this.memBlockCacheStart0 >>> 0;
          this.memBlockCacheSize1 = this.memBlockCacheSize0 >>> 0;
          this.memBlockCacheView1 = this.memBlockCacheView0 || null;
          this.memBlockCacheMem0 = mem;
          this.memBlockCacheStart0 = start >>> 0;
          this.memBlockCacheSize0 = blockSize >>> 0;
          this.memBlockCacheView0 = view1;
          return view1;
        }
        const view = mem.subarray(start, start + blockSize);
        this.memBlockCacheMem1 = cacheMem0;
        this.memBlockCacheStart1 = this.memBlockCacheStart0 >>> 0;
        this.memBlockCacheSize1 = this.memBlockCacheSize0 >>> 0;
        this.memBlockCacheView1 = this.memBlockCacheView0 || null;
        this.memBlockCacheMem0 = mem;
        this.memBlockCacheStart0 = start >>> 0;
        this.memBlockCacheSize0 = blockSize >>> 0;
        this.memBlockCacheView0 = view;
        return view;
      },

      readMem64U32(addr, out) {
        const target = out || new Uint32Array(2);
        if (!this.cpu) {
          target[0] = 0;
          target[1] = 0;
          return null;
        }
        const start = addr >>> 0;
        if (!this.checkInterpreterMem(start, 8)) {
          return null;
        }
        const view = this.cpu.view;
        target[0] = view.getUint32(start, true) >>> 0;
        target[1] = view.getUint32((start + 4) >>> 0, true) >>> 0;
        return target;
      },

      writeMem64U32(addr, words) {
        if (!this.cpu || !words) {
          return false;
        }
        const start = addr >>> 0;
        if (!this.checkInterpreterMem(start, 8)) {
          return false;
        }
        this.invalidateBasicBlocksForWrite(start, 8);
        const view = this.cpu.view;
        view.setUint32(start, words[0] >>> 0, true);
        view.setUint32((start + 4) >>> 0, words[1] >>> 0, true);
        return true;
      },

      readMem128U32(addr, out) {
        const target = out || new Uint32Array(4);
        if (!this.cpu) {
          target[0] = 0;
          target[1] = 0;
          target[2] = 0;
          target[3] = 0;
          return null;
        }
        const start = addr >>> 0;
        if (!this.checkInterpreterMem(start, 16)) {
          return null;
        }
        const view = this.cpu.view;
        target[0] = view.getUint32(start, true) >>> 0;
        target[1] = view.getUint32((start + 4) >>> 0, true) >>> 0;
        target[2] = view.getUint32((start + 8) >>> 0, true) >>> 0;
        target[3] = view.getUint32((start + 12) >>> 0, true) >>> 0;
        return target;
      },

      writeMem128U32(addr, words) {
        if (!this.cpu || !words) {
          return false;
        }
        const start = addr >>> 0;
        if (!this.checkInterpreterMem(start, 16)) {
          return false;
        }
        this.invalidateBasicBlocksForWrite(start, 16);
        const view = this.cpu.view;
        view.setUint32(start, words[0] >>> 0, true);
        view.setUint32((start + 4) >>> 0, words[1] >>> 0, true);
        view.setUint32((start + 8) >>> 0, words[2] >>> 0, true);
        view.setUint32((start + 12) >>> 0, words[3] >>> 0, true);
        return true;
      },

      readModrmXmmSourceU32(modrmInfo, out) {
        if (!modrmInfo) {
          return null;
        }
        if ((modrmInfo.mod | 0) === 3) {
          return this.readXmm128U32(modrmInfo.rm & 7, out);
        }
        const ea = this.calcEffectiveAddress(modrmInfo);
        if (ea === null) {
          return null;
        }
        return this.readMem128U32(ea, out);
      },

      readModrmMmxSourceU32(modrmInfo, out) {
        if (!modrmInfo) {
          return null;
        }
        if ((modrmInfo.mod | 0) === 3) {
          return this.readMmx64U32(modrmInfo.rm & 7, out);
        }
        const ea = this.calcEffectiveAddress(modrmInfo);
        if (ea === null) {
          return null;
        }
        return this.readMem64U32(ea, out);
      },

      readModrmXmmLow64SourceU32(modrmInfo, out) {
        if (!modrmInfo) {
          return null;
        }
        if ((modrmInfo.mod | 0) === 3) {
          return this.readXmm64U32(modrmInfo.rm & 7, 0, out);
        }
        const ea = this.calcEffectiveAddress(modrmInfo);
        if (ea === null) {
          return null;
        }
        return this.readMem64U32(ea, out);
      },

      readModrmXmmScalar32Bits(modrmInfo) {
        if (!modrmInfo) {
          return null;
        }
        if ((modrmInfo.mod | 0) === 3) {
          return this.readXmmU32(modrmInfo.rm & 7, 0) >>> 0;
        }
        const ea = this.calcEffectiveAddress(modrmInfo);
        if (ea === null) {
          return null;
        }
        return this.readMem32(ea) >>> 0;
      },

      writeMemBlock(addr, bytes) {
        if (!this.cpu) {
          return;
        }
        const start = addr >>> 0;
        if (!this.checkInterpreterMem(start, bytes.length)) {
          return;
        }
        this.invalidateBasicBlocksForWrite(start, bytes.length);
        this.cpu.mem.set(bytes, start);
      },

      canUseFlatBulkMemory(addr, byteCount, addrSize) {
        if (!this.cpu || addrSize !== 32) {
          return false;
        }
        if (!Number.isFinite(byteCount) || byteCount <= 0 || byteCount > 0xffffffff) {
          return false;
        }
        const start = addr >>> 0;
        const size = byteCount >>> 0;
        const end = start + size;
        if (end < start) {
          return false;
        }
        return this.checkInterpreterMem(start, size);
      },

      fillMemPattern(addr, byteCount, pattern) {
        if (!this.cpu || !pattern || pattern.length === 0) {
          return false;
        }
        if (!this.canUseFlatBulkMemory(addr, byteCount, 32)) {
          return false;
        }
        const start = addr >>> 0;
        this.invalidateBasicBlocksForWrite(start, byteCount);
        const mem = this.cpu.mem;
        const patLen = pattern.length >>> 0;
        if (byteCount <= patLen) {
          mem.set(pattern.subarray(0, byteCount), start);
          return true;
        }
        mem.set(pattern, start);
        let filled = patLen;
        while (filled < byteCount) {
          const chunk = Math.min(filled, byteCount - filled);
          mem.copyWithin(start + filled, start, start + chunk);
          filled += chunk;
        }
        return true;
      },

      checkInterpreterMem(addr, size) {
        if (!this.cpu) {
          return false;
        }
        const start = addr >>> 0;
        const end = start + (size >>> 0);
        if (end > this.cpu.mem.length) {
          if (!this.cpu.memFaultLogged) {
            const eip = this.readReg(REG.EIP) >>> 0;
            const eax = this.readReg(REG.EAX) >>> 0;
            const ebx = this.readReg(REG.EBX) >>> 0;
            const ecx = this.readReg(REG.ECX) >>> 0;
            const edx = this.readReg(REG.EDX) >>> 0;
            const mode = this.strictMem ? "fault" : "ignored";
            this.log(`Interpreter memory ${mode} at 0x${start.toString(16)} (size ${size}) eip=0x${eip.toString(16)} eax=0x${eax.toString(16)} ebx=0x${ebx.toString(16)} ecx=0x${ecx.toString(16)} edx=0x${edx.toString(16)}`);
            if (this.traceFaultBytes) {
              const bytes = this.readMemBlock(eip >>> 0, 16);
              if (bytes) {
                this.log(`Fault bytes: ${formatHex(bytes, 16)}`);
              }
            }
            this.cpu.memFaultLogged = true;
          }
          if (this.strictMem) {
            this.running = false;
            return false;
          }
          return false;
        }
        return true;
      }
    });
  }

  KosEmu.emu.installCoreAccess = installCoreAccess;
})();

(() => {
  const KosEmu = globalThis.KosEmu;

  function installCoreRuntime(Emulator, shared) {
    if (!Emulator || !Emulator.prototype) {
      throw new Error("installCoreRuntime requires an Emulator class.");
    }
    const REG = shared && shared.REG;
    const formatHex = shared && shared.formatHex;
    if (!REG || typeof formatHex !== "function") {
      throw new Error("installCoreRuntime requires shared REG and formatHex helpers.");
    }

    Object.assign(Emulator.prototype, {
      getInterpreterBudget() {
        if (!this.windowDefined) {
          return Math.max(this.maxInstructions | 0, this.backgroundMaxInstructions | 0) | 0;
        }
        return Math.max(1, this.maxInstructions | 0) | 0;
      },

      getInterpreterSliceBudgetMs() {
        const foreground = Math.max(0, this.maxSliceMs | 0) | 0;
        if (this.windowDefined) {
          return foreground;
        }
        return Math.max(foreground, this.backgroundMaxSliceMs | 0) | 0;
      },

      beginInterpreterSlice(startMs) {
        const budgetMs = Math.max(
          0,
          typeof this.getInterpreterSliceBudgetMs === "function"
            ? (this.getInterpreterSliceBudgetMs() | 0)
            : 0
        );
        this.sliceDeadlineAt = budgetMs > 0 ? ((Number(startMs) || 0) + budgetMs) : 0;
        this.sliceTimeCheckCounter = Math.max(1, this.sliceTimeCheckInterval | 0);
      },

      shouldYieldForTimeslice() {
        const deadline = Number(this.sliceDeadlineAt) || 0;
        if (!(deadline > 0) || !this.running || this.yieldRequested) {
          return false;
        }
        const nextCounter = (this.sliceTimeCheckCounter | 0) - 1;
        if (nextCounter > 0) {
          this.sliceTimeCheckCounter = nextCounter;
          return false;
        }
        this.sliceTimeCheckCounter = Math.max(1, this.sliceTimeCheckInterval | 0);
        const now = typeof this.getWallClockMs === "function" ? this.getWallClockMs() : Date.now();
        if (now < deadline) {
          return false;
        }
        this.yieldRequested = true;
        this.yieldMode = "";
        return true;
      },

      stepInterpreter() {
        if (!this.running || !this.cpu) {
          return;
        }
        this.yieldRequested = false;
        this.yieldDelay = 0;
        this.yieldMode = "";
        this.presentYieldPending = false;
        this.presentYieldDelay = 0;
        let executed = 0;
        const busyStart = typeof this.getWallClockMs === "function" ? this.getWallClockMs() : Date.now();
        this.cpuBusyActiveStartMs = busyStart;
        this.beginInterpreterSlice(busyStart);
        const budget = Math.max(
          1,
          typeof this.getInterpreterBudget === "function"
            ? (this.getInterpreterBudget() | 0)
            : (this.maxInstructions | 0)
        );
        try {
          while (executed < budget && this.running && !this.yieldRequested) {
            const eip = this.readReg(REG.EIP);
            this.lastEip = eip;
            if (this.syscallSiteSet.has(eip)) {
              this.repeatCurrentInstruction = false;
              this.handleSyscall();
              if (!this.repeatCurrentInstruction) {
                this.writeReg(REG.EIP, (eip + 2) >>> 0);
              }
              this.repeatCurrentInstruction = false;
              executed += 1;
              this.shouldYieldForTimeslice();
              continue;
            }
            if (this.softInstructions && this.handleSoftInstruction(eip)) {
              executed += 1;
              this.shouldYieldForTimeslice();
              continue;
            }
            if (this.invokeHostCallStub && this.invokeHostCallStub(eip)) {
              executed += 1;
              this.shouldYieldForTimeslice();
              continue;
            }
            const b0 = this.readMem8(eip);
            const b1 = this.readMem8((eip + 1) >>> 0);
            if (b0 === 0xcd && b1 === 0x40) {
              this.repeatCurrentInstruction = false;
              this.handleSyscall();
              if (!this.repeatCurrentInstruction) {
                this.writeReg(REG.EIP, (eip + 2) >>> 0);
              }
              this.repeatCurrentInstruction = false;
              executed += 1;
              this.shouldYieldForTimeslice();
              continue;
            }
            const cached = this.executeCachedBasicBlock(eip, budget - executed);
            if (cached > 0) {
              executed += cached;
              this.shouldYieldForTimeslice();
              continue;
            }
            if (!this.running) {
              break;
            }
            const built = this.executeAndBuildBasicBlock(eip, budget - executed);
            if (built > 0) {
              executed += built;
              this.shouldYieldForTimeslice();
              continue;
            }
            if (!this.running) {
              break;
            }
            const ok = this.executeBasicInstruction(eip);
            if (!ok) {
              if (this.handleUnknownOpcodeAt(eip)) {
                executed += 1;
                continue;
              }
              break;
            }
            executed += 1;
            this.shouldYieldForTimeslice();
          }
        } catch (err) {
          this.cpuBusyActiveStartMs = 0;
          this.sliceDeadlineAt = 0;
          this.sliceTimeCheckCounter = 0;
          if (executed > 0 && typeof this.noteCpuBusyTime === "function") {
            const busyEnd = typeof this.getWallClockMs === "function" ? this.getWallClockMs() : Date.now();
            this.noteCpuBusyTime(Math.max(0, busyEnd - busyStart));
          }
          this.log(`Interpreter error: ${err}`);
          this.running = false;
          if (this.emitStopped) {
            this.emitStopped("runtime-error");
          }
          return;
        }
        this.cpuBusyActiveStartMs = 0;
        this.sliceDeadlineAt = 0;
        this.sliceTimeCheckCounter = 0;
        if (executed > 0 && typeof this.noteCpuBusyTime === "function") {
          const busyEnd = typeof this.getWallClockMs === "function" ? this.getWallClockMs() : Date.now();
          this.noteCpuBusyTime(Math.max(0, busyEnd - busyStart));
        }
        if (!this.running) {
          return;
        }
        if (!this.yieldRequested && this.presentYieldPending) {
          this.yieldRequested = true;
          this.yieldDelay = Math.max(0, this.presentYieldDelay | 0);
          this.yieldMode = "";
        }
        this.presentYieldPending = false;
        this.presentYieldDelay = 0;
        const delay = this.yieldRequested ? this.yieldDelay : 0;
        this.scheduleStep(delay);
      },

      handleUnknownOpcodeAt(eip) {
        if (this.invokeUnknownOpcodeHandler(eip)) {
          return true;
        }
        this.reportUnknownOpcode(eip);
        return false;
      },

      reportUnknownOpcode(eip) {
        const opcode = this.readMem8(eip);
        if (this.traceOpcodes) {
          const bytes = this.readMemBlock(eip, 12);
          const detail = bytes ? ` bytes=${formatHex(bytes, 12)}` : "";
          this.log(`Unknown opcode 0x${opcode.toString(16)} at 0x${eip.toString(16)}${detail}`);
        } else {
          this.log(`Interpreter: unhandled opcode 0x${opcode.toString(16)} at 0x${eip.toString(16)}`);
        }
        const count = this.opcodeCounts.get(opcode) || 0;
        this.opcodeCounts.set(opcode, count + 1);
        this.running = false;
        if (this.emitStopped) {
          this.emitStopped("unknown-opcode");
        }
      },

      isDirectSyscallInstruction(addr) {
        return this.readMem8(addr >>> 0) === 0xcd && this.readMem8((addr + 1) >>> 0) === 0x40;
      },

      isBasicBlockTerminatorAt(addr, depth) {
        if (!this.cpu || (depth | 0) > 8) {
          return true;
        }
        const start = addr >>> 0;
        const opcode = this.readMem8(start);
        if (
          opcode === 0x67 ||
          opcode === 0x66 ||
          opcode === 0xf0 ||
          opcode === 0x2e ||
          opcode === 0x36 ||
          opcode === 0x3e ||
          opcode === 0x26 ||
          opcode === 0x64 ||
          opcode === 0x65
        ) {
          return this.isBasicBlockTerminatorAt((start + 1) >>> 0, (depth | 0) + 1);
        }
        if (opcode === 0xf2 || opcode === 0xf3) {
          const next = (start + 1) >>> 0;
          const op2 = this.readMem8(next);
          if (op2 === 0x66) {
            const op3 = this.readMem8((start + 2) >>> 0);
            if (
              (op3 >= 0xa4 && op3 <= 0xaf) ||
              (op3 >= 0x6c && op3 <= 0x6f)
            ) {
              return true;
            }
          }
          if (
            (op2 >= 0xa4 && op2 <= 0xaf) ||
            (op2 >= 0x6c && op2 <= 0x6f)
          ) {
            return true;
          }
          return this.isBasicBlockTerminatorAt(next, (depth | 0) + 1);
        }
        if ((opcode >= 0x70 && opcode <= 0x7f) || (opcode >= 0xe0 && opcode <= 0xe3)) {
          return true;
        }
        if (
          opcode === 0x9a ||
          opcode === 0xc2 ||
          opcode === 0xc3 ||
          opcode === 0xca ||
          opcode === 0xcb ||
          opcode === 0xcc ||
          opcode === 0xcd ||
          opcode === 0xce ||
          opcode === 0xcf ||
          opcode === 0xe8 ||
          opcode === 0xe9 ||
          opcode === 0xea ||
          opcode === 0xeb ||
          opcode === 0xf1 ||
          opcode === 0xf4
        ) {
          return true;
        }
        if (opcode === 0xff) {
          const modrm = this.readMem8((start + 1) >>> 0);
          const reg = (modrm >>> 3) & 7;
          return reg >= 2 && reg <= 5;
        }
        if (opcode === 0x0f) {
          const op2 = this.readMem8((start + 1) >>> 0);
          if ((op2 >= 0x80 && op2 <= 0x8f) || op2 === 0x05 || op2 === 0x34 || op2 === 0x35) {
            return true;
          }
        }
        return false;
      },

      canStartBasicBlockAt(addr) {
        const start = addr >>> 0;
        if (!this.cpu || !this.running) {
          return false;
        }
        if (this.syscallSiteSet.has(start)) {
          return false;
        }
        if (this.softInstructions && this.softInstructionSites.has(start)) {
          return false;
        }
        if (this.hostCallStubs && this.hostCallStubs.has(start)) {
          return false;
        }
        if (this.isDirectSyscallInstruction(start)) {
          return false;
        }
        return !this.isBasicBlockTerminatorAt(start, 0);
      },

      noteBasicBlockHotness(start) {
        const key = start >>> 0;
        if (this.basicBlockCache.has(key)) {
          return this.basicBlockHotThreshold;
        }
        if (this.basicBlockHotCounts.size >= this.basicBlockHotCountMax) {
          this.basicBlockHotCounts.clear();
        }
        const prev = this.basicBlockHotCounts.get(key) || 0;
        const next = prev < 0xffff ? (prev + 1) : 0xffff;
        this.basicBlockHotCounts.set(key, next);
        if (next < this.basicBlockHotThreshold) {
          this.basicBlockWarmups += 1;
        }
        return next;
      },

      executeLinearBasicBlock(eip, budget, entryLimit, entries) {
        const start = eip >>> 0;
        if (budget <= 0 || entryLimit <= 0 || !this.canStartBasicBlockAt(start)) {
          return 0;
        }
        let executed = 0;
        let current = start;
        while (
          executed < budget &&
          executed < entryLimit &&
          this.running &&
          !this.yieldRequested &&
          this.canStartBasicBlockAt(current)
        ) {
          this.lastEip = current >>> 0;
          const ok = this.executeBasicInstruction(current);
          if (!ok) {
            this.handleUnknownOpcodeAt(current);
            return executed;
          }
          executed += 1;
          const next = this.readReg(REG.EIP) >>> 0;
          if (entries) {
            entries.push({
              addr: current >>> 0,
              next
            });
          }
          if (this.shouldYieldForTimeslice()) {
            break;
          }
          if (next === current || !this.canStartBasicBlockAt(next)) {
            break;
          }
          current = next >>> 0;
        }
        return executed;
      },

      executeCachedBasicBlock(eip, budget) {
        if (!this.basicBlockCache.size || budget <= 0) {
          return 0;
        }
        const start = eip >>> 0;
        const block = this.basicBlockCache.get(start);
        if (!block) {
          this.basicBlockMisses += 1;
          return 0;
        }
        this.basicBlockHits += 1;
        let executed = 0;
        const entries = block.entries;
        for (let i = 0; i < entries.length && executed < budget && this.running && !this.yieldRequested; i += 1) {
          const entry = entries[i];
          if ((this.readReg(REG.EIP) >>> 0) !== entry.addr) {
            break;
          }
          this.lastEip = entry.addr >>> 0;
          const ok = this.executeBasicInstruction(entry.addr);
          if (!ok) {
            this.invalidateBasicBlock(block.start);
            this.handleUnknownOpcodeAt(entry.addr);
            return executed;
          }
          executed += 1;
          if (this.shouldYieldForTimeslice()) {
            break;
          }
          if ((this.readReg(REG.EIP) >>> 0) !== entry.next) {
            break;
          }
        }
        return executed;
      },

      executeAndBuildBasicBlock(eip, budget) {
        const start = eip >>> 0;
        if (budget <= 1 || !this.canStartBasicBlockAt(start)) {
          return 0;
        }
        const entries = [];
        const executed = this.executeLinearBasicBlock(
          start,
          budget,
          this.basicBlockMaxEntries,
          entries
        );
        if (entries.length < 2) {
          return executed;
        }
        let shouldCache = entries.length >= this.basicBlockImmediateCacheEntries;
        if (!shouldCache) {
          const hotCount = this.noteBasicBlockHotness(start);
          shouldCache = hotCount >= this.basicBlockHotThreshold;
        }
        if (shouldCache && this.cacheBasicBlock(entries)) {
          this.basicBlockPromotions += 1;
        }
        return executed;
      },

      clearBasicBlockCache() {
        this.basicBlockCache.clear();
        this.basicBlockPageMap.clear();
      },

      cacheBasicBlock(entries) {
        if (!entries || entries.length < 2) {
          return false;
        }
        const start = entries[0].addr >>> 0;
        const end = entries[entries.length - 1].next >>> 0;
        if (end <= start) {
          return false;
        }
        if (this.basicBlockCache.size >= this.basicBlockCacheMax) {
          this.clearBasicBlockCache();
        }
        if (this.basicBlockCache.has(start)) {
          return false;
        }
        const block = {
          start,
          end,
          entries,
          pages: []
        };
        const startPage = start >>> 12;
        const endPage = (Math.max(start, end - 1) >>> 12);
        for (let page = startPage; page <= endPage; page += 1) {
          let set = this.basicBlockPageMap.get(page);
          if (!set) {
            set = new Set();
            this.basicBlockPageMap.set(page, set);
          }
          set.add(start);
          block.pages.push(page);
        }
        this.basicBlockCache.set(start, block);
        this.basicBlockBuilds += 1;
        return true;
      },

      invalidateBasicBlock(start) {
        const key = start >>> 0;
        const block = this.basicBlockCache.get(key);
        if (!block) {
          return;
        }
        this.basicBlockCache.delete(key);
        for (let i = 0; i < block.pages.length; i += 1) {
          const page = block.pages[i] >>> 0;
          const set = this.basicBlockPageMap.get(page);
          if (!set) {
            continue;
          }
          set.delete(key);
          if (set.size === 0) {
            this.basicBlockPageMap.delete(page);
          }
        }
      },

      collectBasicBlockStartsForRange(addr, size) {
        if (!this.basicBlockPageMap.size) {
          return null;
        }
        const start = addr >>> 0;
        const byteCount = size >>> 0;
        if (!byteCount) {
          return null;
        }
        const end = (start + byteCount - 1) >>> 0;
        if (end < start) {
          return null;
        }
        const starts = new Set();
        if (byteCount <= 0x1000) {
          const firstPage = start >>> 12;
          const lastPage = end >>> 12;
          for (let page = firstPage; page <= lastPage; page += 1) {
            const set = this.basicBlockPageMap.get(page);
            if (!set) {
              continue;
            }
            for (const blockStart of set) {
              starts.add(blockStart >>> 0);
            }
          }
          return starts;
        }
        for (const [page, set] of this.basicBlockPageMap.entries()) {
          const pageStart = (page << 12) >>> 0;
          const pageEnd = (pageStart + 0xfff) >>> 0;
          if (pageStart > end || pageEnd < start) {
            continue;
          }
          for (const blockStart of set) {
            starts.add(blockStart >>> 0);
          }
        }
        return starts;
      },

      invalidateBasicBlocksForWrite(addr, size) {
        if (!this.basicBlockCache.size) {
          return;
        }
        const start = addr >>> 0;
        const byteCount = size >>> 0;
        if (!byteCount) {
          return;
        }
        const endExclusive = (start + byteCount) >>> 0;
        if (endExclusive < start) {
          this.clearBasicBlockCache();
          return;
        }
        const starts = this.collectBasicBlockStartsForRange(start, byteCount);
        if (!starts || starts.size === 0) {
          return;
        }
        for (const blockStart of starts) {
          const block = this.basicBlockCache.get(blockStart >>> 0);
          if (!block) {
            continue;
          }
          if (start < (block.end >>> 0) && endExclusive > (block.start >>> 0)) {
            this.invalidateBasicBlock(block.start);
          }
        }
      }
    });
  }

  KosEmu.emu.installCoreRuntime = installCoreRuntime;
})();

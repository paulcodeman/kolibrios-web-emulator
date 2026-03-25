(() => {
  const KosEmu = globalThis.KosEmu;

  function installCoreRuntime(Emulator, shared) {
    if (!Emulator || !Emulator.prototype) {
      throw new Error("installCoreRuntime requires an Emulator class.");
    }
    const REG = shared && shared.REG;
    const formatHex = shared && shared.formatHex;
    const SIMPLE_BLOCK_OPS = shared && shared.SIMPLE_BLOCK_OPS;
    const SIMPLE_BLOCK_RECORD_WORDS = shared && shared.SIMPLE_BLOCK_RECORD_WORDS;
    if (
      !REG ||
      typeof formatHex !== "function" ||
      !SIMPLE_BLOCK_OPS ||
      !(SIMPLE_BLOCK_RECORD_WORDS > 0)
    ) {
      throw new Error("installCoreRuntime requires shared REG, formatHex, and simple block helpers.");
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
          if (!this.displayReady) {
            const preDisplay = Math.max(0, this.preDisplayMaxSliceMs | 0) | 0;
            if (preDisplay > 0) {
              return preDisplay;
            }
          }
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
        const deferredPresentPending = !!this.presentYieldPending;
        if (deferredPresentPending && this.surfaceDirty && !this.inRedraw) {
          this.presentIfNeeded(true);
        }
        this.presentYieldPending = false;
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

      getCachedBasicBlockStartState(addr) {
        if (!this.cpu || !this.basicBlockStartCache) {
          return null;
        }
        const start = addr >>> 0;
        const bytes = this.readMemBlock(start, 8);
        if (!bytes) {
          return null;
        }
        const sig = this.getDecodeSignature(bytes);
        const cached = this.basicBlockStartCache.get(start);
        if (cached && cached.sig0 === sig.sig0 && cached.sig1 === sig.sig1) {
          this.basicBlockStartHits = ((this.basicBlockStartHits | 0) + 1) | 0;
          return cached;
        }
        const state = {
          sig0: sig.sig0 >>> 0,
          sig1: sig.sig1 >>> 0,
          canStart: !this.isBasicBlockTerminatorAt(start, 0)
        };
        if (this.basicBlockStartCache.size >= (this.basicBlockStartCacheMax | 0)) {
          this.basicBlockStartCache.clear();
        }
        this.basicBlockStartCache.set(start, state);
        this.basicBlockStartMisses = ((this.basicBlockStartMisses | 0) + 1) | 0;
        return state;
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
          const site = this.softInstructionSites.get(start);
          if (!this.canExecuteSoftInstructionInBasicBlock(site)) {
            return false;
          }
        }
        if (this.hostCallStubs && this.hostCallStubs.has(start)) {
          return false;
        }
        if (this.isDirectSyscallInstruction(start)) {
          return false;
        }
        const state = this.getCachedBasicBlockStartState(start);
        return !!(state && state.canStart);
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

      canExecuteSoftInstructionInBasicBlock(site) {
        if (!site || !site.bytes || !site.bytes.length) {
          return false;
        }
        const first = site.bytes[0] & 0xff;
        return !(
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
        );
      },

      executeBasicBlockInstruction(addr) {
        const current = addr >>> 0;
        if (this.softInstructions && this.softInstructionSites && this.softInstructionSites.has(current)) {
          const site = this.softInstructionSites.get(current);
          if (this.canExecuteSoftInstructionInBasicBlock(site) && this.handleSoftInstruction(current)) {
            return true;
          }
        }
        if (this.invokeHostCallStub && this.hostCallStubs && this.hostCallStubs.has(current)) {
          return !!this.invokeHostCallStub(current);
        }
        return this.executeBasicInstruction(current);
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
          const ok = this.executeBasicBlockInstruction(current);
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
        if (
          this.cpuBackend === "wasm" &&
          block.simplePlan &&
          (block.entries.length >>> 0) <= (budget >>> 0)
        ) {
          const fastExecuted = this.executeSimpleCachedBasicBlock(block);
          if (fastExecuted > 0) {
            return fastExecuted;
          }
        }
        let executed = 0;
        const entries = block.entries;
        for (let i = 0; i < entries.length && executed < budget && this.running && !this.yieldRequested; i += 1) {
          const entry = entries[i];
          if ((this.readReg(REG.EIP) >>> 0) !== entry.addr) {
            break;
          }
          this.lastEip = entry.addr >>> 0;
          const ok = this.executeBasicBlockInstruction(entry.addr);
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
        return this.cacheBasicBlockWithPlan(entries, null);
      },

      cacheBasicBlockWithPlan(entries, precomputedSimplePlan) {
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
          pages: [],
          simplePlan: precomputedSimplePlan || this.buildSimpleBasicBlockPlan(entries)
        };
        if (
          this.cpuBackend === "wasm" &&
          block.simplePlan &&
          this.cpuHelperBackend &&
          typeof this.cpuHelperBackend.prepareSimpleBlockPlan === "function"
        ) {
          block.simplePlan.prepared = this.cpuHelperBackend.prepareSimpleBlockPlan(
            block.simplePlan.words,
            block.simplePlan.wordCount
          );
        }
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

      canSoftSiteFallThrough(site) {
        if (!site || !site.type) {
          return false;
        }
        return !(
          site.type === "loop" ||
          site.type === "call-rel32" ||
          site.type === "ret" ||
          site.type === "jcc" ||
          site.type === "jmp"
        );
      },

      prewarmSoftBasicBlocks(siteMap, limit) {
        if (!(siteMap instanceof Map) || !siteMap.size) {
          return 0;
        }
        const maxStarts = Math.max(0, limit | 0) | 0;
        if (!maxStarts) {
          return 0;
        }
        const fallthroughTargets = new Set();
        for (const [addr, site] of siteMap.entries()) {
          if (!this.canSoftSiteFallThrough(site) || !(site.len > 0)) {
            continue;
          }
          fallthroughTargets.add(((addr >>> 0) + (site.len >>> 0)) >>> 0);
        }
        let prepared = 0;
        for (const [addr] of siteMap.entries()) {
          if (prepared >= maxStarts) {
            break;
          }
          const start = addr >>> 0;
          if (fallthroughTargets.has(start) || this.basicBlockCache.has(start)) {
            continue;
          }
          const entries = [];
          const words = [];
          let current = start;
          while (
            entries.length < (this.basicBlockMaxEntries | 0) &&
            siteMap.has(current)
          ) {
            const site = siteMap.get(current);
            if (
              !this.canExecuteSoftInstructionInBasicBlock(site) ||
              !(site && site.len > 0) ||
              !this.canSoftSiteFallThrough(site)
            ) {
              break;
            }
            const next = (current + (site.len >>> 0)) >>> 0;
            if (!this.appendSimpleBlockRecordForSoftSite(site, words)) {
              break;
            }
            entries.push({
              addr: current >>> 0,
              next
            });
            current = next >>> 0;
          }
          if (entries.length < 2) {
            continue;
          }
          const plan = {
            words: Uint32Array.from(words),
            wordCount: words.length >>> 0
          };
          if (this.cacheBasicBlockWithPlan(entries, plan)) {
            prepared += 1;
          }
        }
        return prepared;
      },

      appendSimpleBlockRecord(target, kind, a, b, c, d) {
        target.push(kind >>> 0, a >>> 0, b >>> 0, c >>> 0, d >>> 0);
      },

      appendSimpleBlockRecordForSoftSite(site, target) {
        if (!site || !site.type || !target) {
          return false;
        }
        const bytes = site.bytes;
        if (!bytes || !bytes.length) {
          return false;
        }
        if (site.type === "inc-r32") {
          this.appendSimpleBlockRecord(target, SIMPLE_BLOCK_OPS.INC_R32, site.reg & 7, 0, 0, 0);
          return true;
        }
        if (site.type === "dec-r32") {
          this.appendSimpleBlockRecord(target, SIMPLE_BLOCK_OPS.DEC_R32, site.reg & 7, 0, 0, 0);
          return true;
        }
        if (site.type === "bswap") {
          this.appendSimpleBlockRecord(target, SIMPLE_BLOCK_OPS.BSWAP_R32, site.reg & 7, 0, 0, 0);
          return true;
        }
        if (site.type === "and-al-imm8") {
          if ((site.len | 0) !== 2 || bytes.length < 2) {
            return false;
          }
          this.appendSimpleBlockRecord(target, SIMPLE_BLOCK_OPS.ALU_AL_IMM8, 4, bytes[1] & 0xff, 1, 0);
          return true;
        }
        if (
          site.type === "mov8-rm-r" ||
          site.type === "mov8-r-rm"
        ) {
          if ((site.len | 0) !== 2 || bytes.length < 2) {
            return false;
          }
          const modrm = bytes[1] & 0xff;
          const mod = (modrm >>> 6) & 3;
          const reg = (modrm >>> 3) & 7;
          const rm = modrm & 7;
          if (mod !== 3) {
            return false;
          }
          this.appendSimpleBlockRecord(
            target,
            SIMPLE_BLOCK_OPS.MOV_R8_R8,
            site.type === "mov8-rm-r" ? rm : reg,
            site.type === "mov8-rm-r" ? reg : rm,
            0,
            0
          );
          return true;
        }
        if (site.type === "testb-imm8") {
          if ((site.len | 0) !== 3 || bytes.length < 3) {
            return false;
          }
          const modrm = bytes[1] & 0xff;
          const mod = (modrm >>> 6) & 3;
          const rm = modrm & 7;
          if (mod !== 3) {
            return false;
          }
          this.appendSimpleBlockRecord(target, SIMPLE_BLOCK_OPS.ALU_R8_IMM8, rm, bytes[2] & 0xff, 8, 0);
          return true;
        }
        if (site.type === "shlb-mem1") {
          if ((site.len | 0) !== 2 || bytes.length < 2) {
            return false;
          }
          const modrm = bytes[1] & 0xff;
          const mod = (modrm >>> 6) & 3;
          const rm = modrm & 7;
          if (mod !== 3) {
            return false;
          }
          this.appendSimpleBlockRecord(target, SIMPLE_BLOCK_OPS.SHIFT_R8_IMM, rm, 1, 0, 0);
          return true;
        }
        if (site.type === "shrb-mem-imm") {
          if ((site.len | 0) < 3 || bytes.length < 3) {
            return false;
          }
          const modrm = bytes[1] & 0xff;
          const mod = (modrm >>> 6) & 3;
          const rm = modrm & 7;
          if (mod !== 3) {
            return false;
          }
          this.appendSimpleBlockRecord(
            target,
            SIMPLE_BLOCK_OPS.SHIFT_R8_IMM,
            rm,
            bytes[bytes.length - 1] & 0x1f,
            1,
            0
          );
          return true;
        }
        if (site.type === "shl32-imm" || site.type === "shr32-imm") {
          if ((site.len | 0) < 3 || bytes.length < 3) {
            return false;
          }
          const modrm = bytes[1] & 0xff;
          const mod = (modrm >>> 6) & 3;
          const rm = modrm & 7;
          if (mod !== 3) {
            return false;
          }
          this.appendSimpleBlockRecord(
            target,
            SIMPLE_BLOCK_OPS.SHIFT_R32_IMM,
            rm,
            bytes[bytes.length - 1] & 0x1f,
            site.type === "shr32-imm" ? 1 : 0,
            0
          );
          return true;
        }
        if (
          site.type === "mov32-rm-r" ||
          site.type === "mov32-r-rm" ||
          site.type === "xor32-rm-r" ||
          site.type === "or32-rm-r"
        ) {
          if ((site.len | 0) !== 2 || bytes.length < 2) {
            return false;
          }
          const modrm = bytes[1] & 0xff;
          const mod = (modrm >>> 6) & 3;
          const reg = (modrm >>> 3) & 7;
          const rm = modrm & 7;
          if (mod !== 3) {
            return false;
          }
          if (site.type === "mov32-rm-r") {
            this.appendSimpleBlockRecord(target, SIMPLE_BLOCK_OPS.MOV_R32_R32, rm, reg, 0, 0);
            return true;
          }
          if (site.type === "mov32-r-rm") {
            this.appendSimpleBlockRecord(target, SIMPLE_BLOCK_OPS.MOV_R32_R32, reg, rm, 0, 0);
            return true;
          }
          this.appendSimpleBlockRecord(
            target,
            SIMPLE_BLOCK_OPS.ALU_R32_R32,
            rm,
            reg,
            site.type === "xor32-rm-r" ? 6 : 1,
            1
          );
          return true;
        }
        if (site.type === "alu-imm") {
          const opcode = site.opcode & 0xff;
          const regField = site.regField & 7;
          if (opcode === 0x80 || opcode === 0x82) {
            if (
              (regField !== 0 && regField !== 1 && regField !== 4 && regField !== 5 && regField !== 7) ||
              (site.len | 0) < 3 ||
              bytes.length < 3
            ) {
              return false;
            }
            const modrm = bytes[1] & 0xff;
            const mod = (modrm >>> 6) & 3;
            const rm = modrm & 7;
            if (mod !== 3) {
              return false;
            }
            this.appendSimpleBlockRecord(
              target,
              SIMPLE_BLOCK_OPS.ALU_R8_IMM8,
              rm,
              bytes[bytes.length - 1] & 0xff,
              regField,
              regField === 7 ? 0 : 1
            );
            return true;
          }
          if (
            (opcode !== 0x81 && opcode !== 0x83) ||
            (regField !== 0 && regField !== 1 && regField !== 4 && regField !== 5 && regField !== 7)
          ) {
            return false;
          }
          if (
            (opcode === 0x81 && ((site.len | 0) !== 6 || bytes.length < 6)) ||
            (opcode === 0x83 && ((site.len | 0) !== 3 || bytes.length < 3))
          ) {
            return false;
          }
          const modrm = bytes[1] & 0xff;
          const mod = (modrm >>> 6) & 3;
          const rm = modrm & 7;
          if (mod !== 3) {
            return false;
          }
          const imm = opcode === 0x81
            ? (
              (bytes[2] & 0xff) |
              ((bytes[3] & 0xff) << 8) |
              ((bytes[4] & 0xff) << 16) |
              ((bytes[5] & 0xff) << 24)
            ) >>> 0
            : ((bytes[2] << 24) >> 24) >>> 0;
          this.appendSimpleBlockRecord(
            target,
            SIMPLE_BLOCK_OPS.ALU_R32_IMM32,
            rm,
            imm,
            regField,
            regField === 7 ? 0 : 1
          );
          return true;
        }
        return false;
      },

      buildSimpleBasicBlockPlan(entries) {
        if (!entries || !entries.length) {
          return null;
        }
        const words = [];
        const push = (kind, a, b, c, d) => this.appendSimpleBlockRecord(words, kind, a, b, c, d);
        for (let i = 0; i < entries.length; i += 1) {
          const entry = entries[i];
          const addr = entry.addr >>> 0;
          const next = entry.next >>> 0;
          if (next < addr) {
            return null;
          }
          const len = (next - addr) >>> 0;
          if (!len || len > 8) {
            return null;
          }
          if (
            this.softInstructionSites &&
            this.softInstructionSites.has(addr)
          ) {
            const site = this.softInstructionSites.get(addr);
            if (
              site &&
              (site.len >>> 0) === len &&
              this.canExecuteSoftInstructionInBasicBlock(site) &&
              this.appendSimpleBlockRecordForSoftSite(site, words)
            ) {
              continue;
            }
          }
          const bytes = this.readMemBlock(addr, len);
          if (!bytes || bytes.length < len) {
            return null;
          }
          const opcode = bytes[0] & 0xff;
          if (opcode === 0x90 && len === 1) {
            push(SIMPLE_BLOCK_OPS.NOP, 0, 0, 0, 0);
            continue;
          }
          if (opcode >= 0x40 && opcode <= 0x47 && len === 1) {
            push(SIMPLE_BLOCK_OPS.INC_R32, opcode & 7, 0, 0, 0);
            continue;
          }
          if (opcode >= 0x48 && opcode <= 0x4f && len === 1) {
            push(SIMPLE_BLOCK_OPS.DEC_R32, opcode & 7, 0, 0, 0);
            continue;
          }
          if (opcode >= 0xb8 && opcode <= 0xbf && len === 5) {
            const imm =
              (bytes[1] & 0xff) |
              ((bytes[2] & 0xff) << 8) |
              ((bytes[3] & 0xff) << 16) |
              ((bytes[4] & 0xff) << 24);
            push(SIMPLE_BLOCK_OPS.MOV_R32_IMM32, opcode & 7, imm, 0, 0);
            continue;
          }
          if (opcode === 0xc7 && len === 6) {
            const modrm = bytes[1] & 0xff;
            const mod = (modrm >>> 6) & 3;
            const regField = (modrm >>> 3) & 7;
            const rm = modrm & 7;
            if (mod !== 3 || regField !== 0) {
              return null;
            }
            const imm =
              (bytes[2] & 0xff) |
              ((bytes[3] & 0xff) << 8) |
              ((bytes[4] & 0xff) << 16) |
              ((bytes[5] & 0xff) << 24);
            push(SIMPLE_BLOCK_OPS.MOV_R32_IMM32, rm, imm, 0, 0);
            continue;
          }
          if (opcode === 0x0f && len === 2) {
            const op2 = bytes[1] & 0xff;
            if (op2 >= 0xc8 && op2 <= 0xcf) {
              push(SIMPLE_BLOCK_OPS.BSWAP_R32, op2 & 7, 0, 0, 0);
              continue;
            }
            return null;
          }
          if (
            (opcode === 0x04 ||
              opcode === 0x0c ||
              opcode === 0x14 ||
              opcode === 0x24 ||
              opcode === 0x2c ||
              opcode === 0x34 ||
              opcode === 0x3c) &&
            len === 2
          ) {
            const op = opcode === 0x04 ? 0
              : (opcode === 0x0c ? 1
                : (opcode === 0x14 ? 2
                  : (opcode === 0x24 ? 4
                    : (opcode === 0x2c ? 5
                      : (opcode === 0x34 ? 6 : 7)))));
            push(SIMPLE_BLOCK_OPS.ALU_AL_IMM8, op, bytes[1] & 0xff, opcode === 0x3c ? 0 : 1, 0);
            continue;
          }
          if ((opcode === 0x80 || opcode === 0x82 || opcode === 0xf6) && len === 3) {
            const modrm = bytes[1] & 0xff;
            const mod = (modrm >>> 6) & 3;
            const regField = (modrm >>> 3) & 7;
            const rm = modrm & 7;
            if (mod !== 3) {
              return null;
            }
            if (opcode === 0xf6) {
              if (regField !== 0) {
                return null;
              }
              push(SIMPLE_BLOCK_OPS.ALU_R8_IMM8, rm, bytes[2] & 0xff, 8, 0);
              continue;
            }
            if (regField !== 0 && regField !== 1 && regField !== 4 && regField !== 5 && regField !== 7) {
              return null;
            }
            push(SIMPLE_BLOCK_OPS.ALU_R8_IMM8, rm, bytes[2] & 0xff, regField, regField === 7 ? 0 : 1);
            continue;
          }
          if (
            (opcode === 0x05 ||
              opcode === 0x0d ||
              opcode === 0x15 ||
              opcode === 0x25 ||
              opcode === 0x2d ||
              opcode === 0x35 ||
              opcode === 0x3d) &&
            len === 5
          ) {
            const imm =
              (bytes[1] & 0xff) |
              ((bytes[2] & 0xff) << 8) |
              ((bytes[3] & 0xff) << 16) |
              ((bytes[4] & 0xff) << 24);
            const op = opcode === 0x05 ? 0
              : (opcode === 0x0d ? 1
                : (opcode === 0x15 ? 2
                  : (opcode === 0x25 ? 4
                    : (opcode === 0x2d ? 5
                      : (opcode === 0x35 ? 6 : 7)))));
            push(SIMPLE_BLOCK_OPS.ALU_R32_IMM32, REG.EAX, imm, op, opcode === 0x3d ? 0 : 1);
            continue;
          }
          if ((opcode === 0x81 && len === 6) || (opcode === 0x83 && len === 3)) {
            const modrm = bytes[1] & 0xff;
            const mod = (modrm >>> 6) & 3;
            const regField = (modrm >>> 3) & 7;
            const rm = modrm & 7;
            if (mod !== 3) {
              return null;
            }
            if (regField !== 0 && regField !== 1 && regField !== 4 && regField !== 5 && regField !== 7) {
              return null;
            }
            const imm = opcode === 0x81
              ? (
                (bytes[2] & 0xff) |
                ((bytes[3] & 0xff) << 8) |
                ((bytes[4] & 0xff) << 16) |
                ((bytes[5] & 0xff) << 24)
              ) >>> 0
              : ((bytes[2] << 24) >> 24) >>> 0;
            push(SIMPLE_BLOCK_OPS.ALU_R32_IMM32, rm, imm, regField, regField === 7 ? 0 : 1);
            continue;
          }
          if (
            opcode === 0x88 ||
            opcode === 0x8a
          ) {
            if (len !== 2) {
              return null;
            }
            const modrm = bytes[1] & 0xff;
            const mod = (modrm >>> 6) & 3;
            const reg = (modrm >>> 3) & 7;
            const rm = modrm & 7;
            if (mod !== 3) {
              return null;
            }
            push(SIMPLE_BLOCK_OPS.MOV_R8_R8, opcode === 0x88 ? rm : reg, opcode === 0x88 ? reg : rm, 0, 0);
            continue;
          }
          if (opcode === 0xd0 && len === 2) {
            const modrm = bytes[1] & 0xff;
            const mod = (modrm >>> 6) & 3;
            const regField = (modrm >>> 3) & 7;
            const rm = modrm & 7;
            if (mod !== 3 || regField !== 4) {
              return null;
            }
            push(SIMPLE_BLOCK_OPS.SHIFT_R8_IMM, rm, 1, 0, 0);
            continue;
          }
          if (opcode === 0xc0 && len === 3) {
            const modrm = bytes[1] & 0xff;
            const mod = (modrm >>> 6) & 3;
            const regField = (modrm >>> 3) & 7;
            const rm = modrm & 7;
            if (mod !== 3 || regField !== 5) {
              return null;
            }
            push(SIMPLE_BLOCK_OPS.SHIFT_R8_IMM, rm, bytes[2] & 0x1f, 1, 0);
            continue;
          }
          if (opcode === 0xc1 && len === 3) {
            const modrm = bytes[1] & 0xff;
            const mod = (modrm >>> 6) & 3;
            const regField = (modrm >>> 3) & 7;
            const rm = modrm & 7;
            if (mod !== 3 || (regField !== 4 && regField !== 5)) {
              return null;
            }
            push(SIMPLE_BLOCK_OPS.SHIFT_R32_IMM, rm, bytes[2] & 0x1f, regField === 5 ? 1 : 0, 0);
            continue;
          }
          if (
            opcode === 0x89 ||
            opcode === 0x8b ||
            opcode === 0x01 ||
            opcode === 0x03 ||
            opcode === 0x09 ||
            opcode === 0x0b ||
            opcode === 0x21 ||
            opcode === 0x23 ||
            opcode === 0x29 ||
            opcode === 0x2b ||
            opcode === 0x31 ||
            opcode === 0x33 ||
            opcode === 0x39 ||
            opcode === 0x3b ||
            opcode === 0x85
          ) {
            if (len !== 2) {
              return null;
            }
            const modrm = bytes[1] & 0xff;
            const mod = (modrm >>> 6) & 3;
            const reg = (modrm >>> 3) & 7;
            const rm = modrm & 7;
            if (mod !== 3) {
              return null;
            }
            if (opcode === 0x89) {
              push(SIMPLE_BLOCK_OPS.MOV_R32_R32, rm, reg, 0, 0);
              continue;
            }
            if (opcode === 0x8b) {
              push(SIMPLE_BLOCK_OPS.MOV_R32_R32, reg, rm, 0, 0);
              continue;
            }
            if (opcode === 0x85) {
              push(SIMPLE_BLOCK_OPS.ALU_R32_R32, rm, reg, 8, 0);
              continue;
            }
            if (opcode === 0x39) {
              push(SIMPLE_BLOCK_OPS.ALU_R32_R32, rm, reg, 7, 0);
              continue;
            }
            if (opcode === 0x3b) {
              push(SIMPLE_BLOCK_OPS.ALU_R32_R32, reg, rm, 7, 0);
              continue;
            }
            const op = opcode === 0x01 || opcode === 0x03 ? 0
              : (opcode === 0x09 || opcode === 0x0b ? 1
                : (opcode === 0x21 || opcode === 0x23 ? 4
                  : (opcode === 0x29 || opcode === 0x2b ? 5 : 6)));
            if (
              opcode === 0x01 ||
              opcode === 0x09 ||
              opcode === 0x21 ||
              opcode === 0x29 ||
              opcode === 0x31
            ) {
              push(SIMPLE_BLOCK_OPS.ALU_R32_R32, rm, reg, op, 1);
            } else {
              push(SIMPLE_BLOCK_OPS.ALU_R32_R32, reg, rm, op, 1);
            }
            continue;
          }
          return null;
        }
        if (!words.length) {
          return null;
        }
        return {
          words: Uint32Array.from(words),
          wordCount: words.length >>> 0
        };
      },

      executeSimpleCachedBasicBlock(block) {
        if (!block || !block.simplePlan || !this.cpu || !this.cpu.regs) {
          return 0;
        }
        const backend = this.cpuHelperBackend;
        if (!backend || typeof backend.executeSimpleBlock !== "function") {
          return 0;
        }
        const scratch = this.simpleBlockRegsScratch || (this.simpleBlockRegsScratch = new Uint32Array(8));
        const regs = this.cpu.regs;
        for (let i = 0; i < 8; i += 1) {
          scratch[i] = regs[i] >>> 0;
        }
        if (
          !block.simplePlan.prepared &&
          typeof backend.prepareSimpleBlockPlan === "function"
        ) {
          block.simplePlan.prepared = backend.prepareSimpleBlockPlan(
            block.simplePlan.words,
            block.simplePlan.wordCount
          );
        }
        const result = block.simplePlan.prepared && typeof backend.executePreparedSimpleBlock === "function"
          ? backend.executePreparedSimpleBlock(
            block.simplePlan.prepared,
            scratch,
            regs[REG.EFLAGS] >>> 0
          )
          : backend.executeSimpleBlock(
            block.simplePlan.words,
            block.simplePlan.wordCount,
            scratch,
            regs[REG.EFLAGS] >>> 0
          );
        if (!result || !result.ok) {
          block.simplePlan.prepared = null;
          return 0;
        }
        for (let i = 0; i < 8; i += 1) {
          regs[i] = scratch[i] >>> 0;
        }
        regs[REG.EFLAGS] = (result.flags >>> 0) || 0;
        regs[REG.EIP] = block.end >>> 0;
        return block.entries.length >>> 0;
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
        if (this.basicBlockStartCache && this.basicBlockStartCache.size) {
          const start = addr >>> 0;
          const byteCount = size >>> 0;
          if (!byteCount) {
            return;
          }
          const extra = 16;
          if (byteCount > 512) {
            this.basicBlockStartCache.clear();
          } else {
            const invalidateStart = start > extra ? (start - extra) >>> 0 : 0;
            const invalidateEnd = (start + byteCount + extra) >>> 0;
            if (invalidateEnd < invalidateStart) {
              this.basicBlockStartCache.clear();
            } else {
              for (let cursor = invalidateStart; cursor <= invalidateEnd; cursor += 1) {
                this.basicBlockStartCache.delete(cursor >>> 0);
              }
            }
          }
        }
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

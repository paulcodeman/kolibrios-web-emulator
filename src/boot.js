(() => {
  const root = globalThis;
  if (!root.KosEmu) {
    root.KosEmu = { core: {}, gfx: {}, ui: {}, emu: {} };
    return;
  }
  const ns = root.KosEmu;
  ns.core = ns.core || {};
  ns.gfx = ns.gfx || {};
  ns.ui = ns.ui || {};
  ns.emu = ns.emu || {};
})();

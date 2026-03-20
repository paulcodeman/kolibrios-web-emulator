(() => {
  const KosEmu = globalThis.KosEmu;
  const emu = KosEmu.emu || (KosEmu.emu = {});

  function normalizeHostDllModuleKey(name) {
    const raw = String(name || "").trim().replace(/\\/g, "/");
    if (!raw) {
      return "";
    }
    const collapsed = raw.replace(/\/+/g, "/").toLowerCase();
    if (!collapsed.includes("/")) {
      return collapsed;
    }
    return collapsed.startsWith("/") ? collapsed : `/${collapsed}`;
  }

  function getHostDllModuleKeys(name) {
    const primary = normalizeHostDllModuleKey(name);
    if (!primary) {
      return [];
    }
    const keys = [primary];
    if (!primary.includes("/")) {
      keys.push(`/sys/lib/${primary}`);
    } else if (primary.startsWith("/sys/lib/")) {
      keys.push(primary.slice("/sys/lib/".length));
    }
    return keys.filter((item, index) => keys.indexOf(item) === index);
  }

  const hostDllModules = emu.hostDllModules instanceof Map ? emu.hostDllModules : new Map();
  const hostDllOverrideModules = emu.hostDllOverrideModules instanceof Map ? emu.hostDllOverrideModules : new Map();

  emu.hostDllModules = hostDllModules;
  emu.hostDllOverrideModules = hostDllOverrideModules;
  emu.normalizeHostDllModuleKey = normalizeHostDllModuleKey;
  emu.registerHostDllModule = function registerHostDllModule(name, factory) {
    if (typeof factory !== "function") {
      return false;
    }
    const keys = getHostDllModuleKeys(name);
    if (!keys.length) {
      return false;
    }
    for (let i = 0; i < keys.length; i += 1) {
      hostDllModules.set(keys[i], factory);
    }
    return true;
  };
  emu.registerHostDllOverride = function registerHostDllOverride(name, factory) {
    if (typeof factory !== "function") {
      return false;
    }
    const keys = getHostDllModuleKeys(name);
    if (!keys.length) {
      return false;
    }
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      const list = hostDllOverrideModules.get(key);
      if (Array.isArray(list)) {
        if (!list.includes(factory)) {
          list.push(factory);
        }
      } else {
        hostDllOverrideModules.set(key, [factory]);
      }
    }
    return true;
  };
  emu.resolveHostDllModuleFactory = function resolveHostDllModuleFactory(name) {
    const keys = getHostDllModuleKeys(name);
    for (let i = 0; i < keys.length; i += 1) {
      const factory = hostDllModules.get(keys[i]);
      if (typeof factory === "function") {
        return factory;
      }
    }
    return null;
  };
  emu.resolveHostDllOverrideFactories = function resolveHostDllOverrideFactories(name) {
    const keys = getHostDllModuleKeys(name);
    const out = [];
    for (let i = 0; i < keys.length; i += 1) {
      const list = hostDllOverrideModules.get(keys[i]);
      if (!Array.isArray(list)) {
        continue;
      }
      for (let j = 0; j < list.length; j += 1) {
        const factory = list[j];
        if (typeof factory === "function" && !out.includes(factory)) {
          out.push(factory);
        }
      }
    }
    return out;
  };
})();

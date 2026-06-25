(() => {
  const KosEmu = globalThis.KosEmu;

  function formatHex(bytes, max = 16) {
    const out = [];
    const limit = Math.min(bytes.length, max);
    for (let i = 0; i < limit; i += 1) {
      out.push(bytes[i].toString(16).padStart(2, "0"));
    }
    return out.join(" ");
  }

  function align4k(value) {
    return (value + 0xfff) & ~0xfff;
  }

  function toBcd(value) {
    return ((Math.floor(value / 10) << 4) | (value % 10)) & 0xff;
  }

  function formatBytes(value) {
    if (value < 1024) {
      return `${value} B`;
    }
    const kb = value / 1024;
    if (kb < 1024) {
      return `${kb.toFixed(2)} KB`;
    }
    const mb = kb / 1024;
    return `${mb.toFixed(2)} MB`;
  }

  KosEmu.core.utils = {
    formatHex,
    align4k,
    toBcd,
    formatBytes
  };
})();

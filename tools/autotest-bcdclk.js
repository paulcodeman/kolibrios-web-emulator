const fs = require("fs");
const path = require("path");
const vm = require("vm");

const defaultPath = path.resolve(
  __dirname,
  "../../upstream-kolibrios/programs/demos/bcdclk/trunk/bcdclk.kex"
);

const target = process.argv[2] ? path.resolve(process.argv[2]) : defaultPath;
if (!fs.existsSync(target)) {
  console.error("BCDCLK not found.");
  console.error("Usage: node tools/autotest-bcdclk.js <path-to-bcdclk.kex> [max_ms]");
  console.error(`Default path tried: ${defaultPath}`);
  process.exit(1);
}

const maxMs = Number(process.argv[3] || 2000);

const lzma = require("../src/vendor/lzma_worker-min.js");
if (lzma && lzma.LZMA) {
  global.LZMA = lzma.LZMA;
}
const fflate = require("../src/vendor/fflate-umd.js");
if (fflate) {
  global.fflate = fflate;
}

const scripts = [
  "../src/boot.js",
  "../src/core/utils.js",
  "../src/core/loader.js",
  "../src/gfx/text.js",
  "../src/gfx/kolibri-font-assets.js",
  "../src/gfx/kolibri-font.js",
  "../src/gfx/kolibri-skin-assets.js",
  "../src/gfx/kolibri-skin.js",
  "../src/gfx/surface.js",
  "../src/emulator/core-access.js",
  "../src/emulator/host-libs/registry.js",
  "../src/emulator/host-libs/http.obj.js",
  "../src/emulator/host-libs/proc_lib.obj.js",
  "../src/emulator/host-libs/cnv_png.obj.js",
  "../src/emulator/host-libs/libimg.obj.js",
  "../src/emulator/host-libs/libini.obj.js",
  "../src/emulator/host-libs/runtime.js",
  "../src/emulator/emulator-host.js",
  "../src/emulator/core-runtime.js",
  "../src/emulator/core-execute.js",
  "../src/emulator/emulator-syscalls.js",
  "../src/emulator/emulator.js",
  "../src/ui/app-ui.js",
  "../src/app.js"
];

for (const rel of scripts) {
  const filePath = path.resolve(__dirname, rel);
  const code = fs.readFileSync(filePath, "utf8");
  vm.runInThisContext(code, { filename: rel });
}

const { Emulator, parseKex, createHeadlessSurface } = global.KosEmu;
const data = fs.readFileSync(target);
const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
const image = parseKex(buffer, path.basename(target));

const surface = createHeadlessSurface(800, 600);
const emulator = new Emulator(surface, (msg) => console.log(msg));
emulator.traceOpcodes = true;
emulator.load(image);
emulator.run();

const stopAndReport = () => {
  emulator.stop();
  const unknownCount = emulator.opcodeCounts.size;
  if (unknownCount > 0) {
    const entries = [];
    for (const [opcode, count] of emulator.opcodeCounts.entries()) {
      entries.push(`0x${opcode.toString(16)}=${count}`);
    }
    console.error(`Unhandled opcodes: ${entries.join(", ")}`);
    process.exit(2);
  }
  console.log("Autotest OK: no unhandled opcodes.");
  process.exit(0);
};

if (Number.isFinite(maxMs) && maxMs > 0) {
  setTimeout(stopAndReport, maxMs);
} else {
  setTimeout(stopAndReport, 2000);
}

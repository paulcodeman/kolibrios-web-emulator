const fs = require("fs");
const path = require("path");
const vm = require("vm");

const rootDir = process.env.KOS_ROOT || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root";
const defaultPath = path.resolve(rootDir, "DEMOS", "WEB");
const target = process.argv[2] ? path.resolve(process.argv[2]) : defaultPath;
if (!fs.existsSync(target)) {
  console.error("WEB demo not found.");
  console.error("Usage: node tools/autotest-web.js <path-to-web-demo> [max_ms]");
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
  "../src/format/bytes.js",
  "../src/format/kex-loader.js",
  "../src/gfx/font-5x7.js",
  "../src/gfx/kolibri-font-assets.js",
  "../src/gfx/kolibri-font.js",
  "../src/gfx/kolibri-skin-assets.js",
  "../src/gfx/kolibri-skin.js",
  "../src/gfx/surface.js",
  "../src/core/access.js",
  "../src/libs/registry.js",
  "../src/libs/http.obj.js",
  "../src/libs/cnv_png.obj.js",
  "../src/libs/libimg.obj.js",
  "../src/libs/libini.obj.js",
  "../src/libs/runtime.js",
  "../src/host/environment.js",
  "../src/core/runtime.js",
  "../src/core/execute.js",
  "../src/syscall/dispatcher.js",
  "../src/emulator.js",
  "../src/ui/app.js",
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
  console.log("Autotest OK: WEB demo reached timeout without unhandled opcodes.");
  process.exit(0);
};

if (Number.isFinite(maxMs) && maxMs > 0) {
  setTimeout(stopAndReport, maxMs);
} else {
  setTimeout(stopAndReport, 2000);
}

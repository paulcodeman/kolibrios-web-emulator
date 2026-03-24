const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const SOURCE_FILE = path.join(REPO_ROOT, "src", "emulator", "wasm-cpu.zig");
const OUTPUT_FILE = path.join(REPO_ROOT, "src", "emulator", "wasm-cpu.generated.js");
const TEMP_WASM = path.join(REPO_ROOT, ".tools", "wasm-cpu.wasm");

function findZigBinary() {
  const candidates = [];
  if (process.env.ZIG_BIN) {
    candidates.push(process.env.ZIG_BIN);
  }
  candidates.push(path.join(REPO_ROOT, ".tools", "zig", "zig.exe"));
  candidates.push(path.join(REPO_ROOT, ".tools", "zig-x86_64-windows-0.15.2", "zig.exe"));
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error("Zig binary not found. Set ZIG_BIN or place zig.exe under .tools.");
}

function compileWasm(zigBin) {
  fs.mkdirSync(path.dirname(TEMP_WASM), { recursive: true });
  execFileSync(
    zigBin,
    [
      "build-exe",
      SOURCE_FILE,
      "-target",
      "wasm32-freestanding",
      "-O",
      "ReleaseSmall",
      "-fstrip",
      "-fno-entry",
      "-rdynamic",
      `-femit-bin=${TEMP_WASM}`
    ],
    {
      cwd: REPO_ROOT,
      stdio: "inherit"
    }
  );
}

function writeGeneratedAsset(bytes, zigVersion) {
  const base64 = bytes.toString("base64");
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const output = `(() => {
  const root = globalThis;
  const KosEmu = root.KosEmu || (root.KosEmu = { core: {}, gfx: {}, ui: {}, emu: {} });
  KosEmu.emu = KosEmu.emu || {};
  KosEmu.emu.wasmCpuAsset = {
    base64: "${base64}",
    byteLength: ${bytes.length},
    sha256: "${sha256}",
    zigVersion: "${zigVersion}",
    source: "src/emulator/wasm-cpu.zig"
  };
})();
`;
  fs.writeFileSync(OUTPUT_FILE, output, "utf8");
}

function main() {
  const zigBin = findZigBinary();
  const zigVersion = execFileSync(zigBin, ["version"], { encoding: "utf8" }).trim();
  compileWasm(zigBin);
  const wasmBytes = fs.readFileSync(TEMP_WASM);
  writeGeneratedAsset(wasmBytes, zigVersion);
  console.log(`Built ${path.relative(REPO_ROOT, OUTPUT_FILE)} (${wasmBytes.length} bytes wasm, zig ${zigVersion}).`);
}

main();

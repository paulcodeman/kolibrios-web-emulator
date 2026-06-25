const fs = require("fs");
const path = require("path");

const DEFAULT_SOURCE_ROOT = "C:\\kos";
const DEFAULT_OUTPUT = path.resolve(__dirname, "..", "assets_kolibrios", "builtin-root-data.js");

function walkFiles(rootDir) {
  const out = [];

  function visit(dirPath) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (entry.isFile()) {
        out.push(fullPath);
      }
    }
  }

  visit(rootDir);
  return out;
}

function toKosPath(rootDir, hostPath) {
  const rel = path.relative(rootDir, hostPath).split(path.sep).join("/");
  return `/${rel}`;
}

function buildManifest(sourceRoot) {
  const files = walkFiles(sourceRoot);
  const entries = [];
  let totalBytes = 0;
  for (let i = 0; i < files.length; i += 1) {
    const hostPath = files[i];
    const data = fs.readFileSync(hostPath);
    const stats = fs.statSync(hostPath);
    entries.push({
      path: toKosPath(sourceRoot, hostPath),
      size: data.length >>> 0,
      mtimeMs: Math.max(0, Math.floor(Number(stats.mtimeMs) || 0)),
      base64: data.toString("base64")
    });
    totalBytes += data.length >>> 0;
  }
  return {
    label: "builtin-kolibri-root",
    sourcePath: sourceRoot,
    launchPath: "/sys/LAUNCHER",
    generatedAt: new Date().toISOString(),
    fileCount: entries.length >>> 0,
    totalBytes: totalBytes >>> 0,
    files: entries
  };
}

function renderManifestScript(manifest) {
  const lines = [];
  lines.push("(() => {");
  lines.push("  const root = globalThis;");
  lines.push("  root.KosEmu = root.KosEmu || { core: {}, gfx: {}, ui: {}, emu: {} };");
  lines.push("  root.KosEmu.assets = root.KosEmu.assets || {};");
  lines.push("  root.KosEmu.assets.builtinKolibriRoot = {");
  lines.push(`    label: ${JSON.stringify(manifest.label)},`);
  lines.push(`    sourcePath: ${JSON.stringify(manifest.sourcePath)},`);
  lines.push(`    launchPath: ${JSON.stringify(manifest.launchPath)},`);
  lines.push(`    generatedAt: ${JSON.stringify(manifest.generatedAt)},`);
  lines.push(`    fileCount: ${manifest.fileCount >>> 0},`);
  lines.push(`    totalBytes: ${manifest.totalBytes >>> 0},`);
  lines.push("    files: [");
  for (let i = 0; i < manifest.files.length; i += 1) {
    const entry = manifest.files[i];
    lines.push(
      `      { path: ${JSON.stringify(entry.path)}, size: ${entry.size >>> 0}, mtimeMs: ${entry.mtimeMs >>> 0}, base64: ${JSON.stringify(entry.base64)} },`
    );
  }
  lines.push("    ]");
  lines.push("  };");
  lines.push("})();");
  lines.push("");
  return lines.join("\n");
}

function main() {
  const sourceRoot = path.resolve(process.argv[2] || DEFAULT_SOURCE_ROOT);
  const outputPath = path.resolve(process.argv[3] || DEFAULT_OUTPUT);
  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`Source root not found: ${sourceRoot}`);
  }
  const manifest = buildManifest(sourceRoot);
  const script = renderManifestScript(manifest);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, script, "utf8");
  console.log(`Wrote ${manifest.fileCount} files (${manifest.totalBytes} bytes) to ${outputPath}`);
}

main();

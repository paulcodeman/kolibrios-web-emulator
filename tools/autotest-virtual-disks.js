const path = require("path");
const { createNodeFileProviders } = require("./kos-fs");

const DEFAULT_ROOT = process.env.KOS_ROOT || "C:\\Users\\Paul\\Desktop\\Kem\\kolibri_root";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEq(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function namesOf(info) {
  return Array.isArray(info && info.entries) ? info.entries.map((entry) => String(entry && entry.name ? entry.name : "")) : [];
}

try {
  const rootDir = path.resolve(process.argv[2] || DEFAULT_ROOT);
  const target = path.join(rootDir, "EOLITE");
  const providers = createNodeFileProviders(target, rootDir);
  const text = new TextEncoder().encode("tmp-disk-ok");

  const rootInfo = providers.fileInfoProvider("/", "list");
  assert(rootInfo && rootInfo.isDirectory, "virtual root '/' should be a readable directory");
  const rootNames = namesOf(rootInfo).map((name) => name.toLowerCase());
  assert(rootNames.includes("rd"), "virtual root should expose the system ramdisk");
  assert(rootNames.includes("tmp0"), "virtual root should expose the default tmp disk");
  assert(!rootNames.includes("sys"), "virtual root should not flatten /sys contents into '/'");

  const rdInfo = providers.fileInfoProvider("/rd", "list");
  assert(rdInfo && rdInfo.isDirectory, "virtual /rd should be a readable directory");
  assertEq(namesOf(rdInfo).join(","), "1", "virtual /rd should expose the system volume 1");

  const systemInfo = providers.fileInfoProvider("/rd/1", "list");
  assert(systemInfo && systemInfo.isDirectory, "/rd/1 should resolve to the mounted system root");
  const systemNames = namesOf(systemInfo).map((name) => String(name).toLowerCase());
  assert(systemNames.includes("games"), "/rd/1 should still expose the mounted system root");
  assert(systemNames.includes("demos"), "/rd/1 should still expose the mounted system root");

  let result = providers.fileMutationProvider("create-folder", "/tmp0/1/cache", {});
  assertEq(result.errorCode >>> 0, 0, "creating a tmp folder should succeed");

  result = providers.fileMutationProvider("create-file", "/tmp0/1/cache/test.txt", { data: text });
  assertEq(result.errorCode >>> 0, 0, "creating a tmp file should succeed");
  assertEq(result.written >>> 0, text.length >>> 0, "tmp file create should report written bytes");

  const tmpInfo = providers.fileInfoProvider("/tmp0/1/cache", "list");
  assert(tmpInfo && tmpInfo.isDirectory, "/tmp0/1/cache should exist after creation");
  assertEq(namesOf(tmpInfo).join(","), "test.txt", "tmp folder listing should contain the created file");

  const readBack = providers.fileProvider("/tmp0/1/cache/test.txt");
  assert(readBack instanceof Uint8Array, "tmp file should be readable through fileProvider");
  assertEq(Buffer.from(readBack).toString("utf8"), "tmp-disk-ok", "tmp file contents should round-trip");

  console.log("Autotest OK: virtual root shows disks and /tmp0/1 works as an in-memory tmp disk.");
} catch (err) {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(2);
}

const fs = require("fs");
const path = require("path");

function normalizeKosInput(kpath) {
  if (!kpath || typeof kpath !== "string") {
    return "";
  }
  let text = kpath.replace(/\\/g, "/").trim();
  if (!text) {
    return "";
  }
  const first = text.charCodeAt(0);
  if (first >= 1 && first <= 3) {
    text = text.slice(1);
  } else if (text.startsWith("/") && text.length > 1) {
    const second = text.charCodeAt(1);
    if (second >= 1 && second <= 3) {
      text = "/" + text.slice(2);
    }
  }
  text = text.replace(/\/+/g, "/");
  return text;
}

function buildHostCandidates(rootDir, cwd, kpath) {
  const normalized = normalizeKosInput(kpath);
  if (!normalized) {
    return [];
  }
  const lower = normalized.toLowerCase();
  const candidates = [];
  if (/^\/rd\/\d+(?:\/|$)/i.test(normalized)) {
    const rel = normalized.replace(/^\/rd\/\d+\/?/i, "");
    candidates.push(rel ? path.join(rootDir, rel) : rootDir);
  } else if (/^\/hd\d+\/\d+(?:\/|$)/i.test(normalized)) {
    const rel = normalized.replace(/^\/hd\d+\/\d+\/?/i, "");
    candidates.push(rel ? path.join(rootDir, rel) : rootDir);
  } else if (lower === "/app" || lower === "/app/") {
    candidates.push(cwd);
  } else if (lower.startsWith("/app/")) {
    candidates.push(path.join(cwd, normalized.slice(5)));
  } else if (lower === "/sys" || lower === "/sys/") {
    candidates.push(rootDir);
  } else if (lower.startsWith("/sys/")) {
    candidates.push(path.join(rootDir, normalized.slice(5)));
  } else if (lower === "/kolibrios" || lower === "/kolibrios/") {
    candidates.push(rootDir);
  } else if (lower.startsWith("/kolibrios/")) {
    candidates.push(path.join(rootDir, normalized.slice(11)));
  } else if (normalized === "/") {
    candidates.push(rootDir);
  } else if (normalized.startsWith("/")) {
    candidates.push(path.join(rootDir, normalized.slice(1)));
  } else {
    candidates.push(path.join(cwd, normalized));
    candidates.push(path.join(rootDir, normalized));
  }
  return candidates.filter((item, index) => candidates.indexOf(item) === index);
}

function statPath(fsPath) {
  try {
    return fs.statSync(fsPath);
  } catch (err) {
    return null;
  }
}

function makeInfo(kosPath, hostPath, stats) {
  if (!stats) {
    return null;
  }
  return {
    path: kosPath,
    hostPath,
    exists: true,
    isDirectory: !!stats.isDirectory(),
    size: stats.isDirectory() ? 0 : (Number(stats.size) >>> 0),
    mtimeMs: Number.isFinite(Number(stats.mtimeMs)) ? Number(stats.mtimeMs) : 0
  };
}

const SYSTEM_DISK_NAME = "rd";
const SYSTEM_VOLUME_NAME = "1";
const DEFAULT_TMP_DISK_NAME = "tmp0";
const DEFAULT_TMP_VOLUME_NAME = "1";

function cloneBytes(data) {
  if (data instanceof Uint8Array) {
    return data.slice();
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data.slice(0));
  }
  return new Uint8Array(0);
}

function makeDirEntry(name) {
  return {
    name: String(name || ""),
    kind: "directory",
    children: new Map(),
    size: 0,
    mtimeMs: 0
  };
}

function makeFileEntry(name, data, mtimeMs) {
  const bytes = cloneBytes(data);
  return {
    name: String(name || ""),
    kind: "file",
    data: bytes,
    size: bytes.length >>> 0,
    mtimeMs: Number.isFinite(Number(mtimeMs)) ? Number(mtimeMs) : 0
  };
}

function listDirEntries(entry) {
  const entries = [];
  if (!entry || entry.kind !== "directory") {
    return entries;
  }
  for (const child of entry.children.values()) {
    entries.push({
      name: child.name,
      isDirectory: child.kind === "directory",
      size: child.kind === "file" ? (child.size >>> 0) : 0,
      mtimeMs: child.mtimeMs >>> 0
    });
  }
  entries.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return entries;
}

function createRootAccessors(rootEntry) {
  function mapSegments(kpath) {
    const normalized = normalizeKosInput(kpath);
    if (!normalized || normalized === "/" || /^\/sys\/?$/i.test(normalized) || /^\/kolibrios\/?$/i.test(normalized)) {
      return [];
    }
    let relative = normalized;
    if (/^\/rd\/\d+(?:\/|$)/i.test(relative)) {
      relative = relative.replace(/^\/rd\/\d+\/?/i, "");
    } else if (/^\/hd\d+\/\d+(?:\/|$)/i.test(relative)) {
      relative = relative.replace(/^\/hd\d+\/\d+\/?/i, "");
    } else if (/^\/sys\//i.test(relative)) {
      relative = relative.slice(5);
    } else if (/^\/kolibrios\//i.test(relative)) {
      relative = relative.slice(11);
    } else if (relative.startsWith("/")) {
      relative = relative.slice(1);
    }
    return relative ? relative.split("/").filter(Boolean) : [];
  }

  function resolveEntryRecord(kpath) {
    const requestedSegments = mapSegments(kpath);
    let entry = rootEntry;
    let parent = null;
    const actualSegments = [];
    for (let i = 0; i < requestedSegments.length; i += 1) {
      if (!entry || entry.kind !== "directory") {
        return null;
      }
      const next = entry.children.get(requestedSegments[i].toLowerCase()) || null;
      if (!next) {
        return null;
      }
      parent = entry;
      entry = next;
      actualSegments.push(next.name);
    }
    return {
      entry,
      parent,
      segments: actualSegments,
      parentSegments: actualSegments.slice(0, Math.max(0, actualSegments.length - 1))
    };
  }

  function resolveParentRecord(kpath) {
    const requestedSegments = mapSegments(kpath);
    if (!requestedSegments.length) {
      return null;
    }
    let parentEntry = rootEntry;
    const actualSegments = [];
    for (let i = 0; i < requestedSegments.length - 1; i += 1) {
      if (!parentEntry || parentEntry.kind !== "directory") {
        return null;
      }
      const next = parentEntry.children.get(requestedSegments[i].toLowerCase()) || null;
      if (!next || next.kind !== "directory") {
        return null;
      }
      parentEntry = next;
      actualSegments.push(next.name);
    }
    return {
      parentEntry,
      parentSegments: actualSegments,
      requestedName: requestedSegments[requestedSegments.length - 1]
    };
  }

  return {
    resolveEntryRecord,
    resolveParentRecord
  };
}

function createVirtualDiskStore() {
  const store = new Map();
  ensureVirtualDiskVolume(store, DEFAULT_TMP_DISK_NAME, DEFAULT_TMP_VOLUME_NAME);
  return store;
}

function getVirtualDiskState(store, diskName) {
  if (!(store instanceof Map)) {
    return null;
  }
  const key = String(diskName || "").trim().toLowerCase();
  return key ? (store.get(key) || null) : null;
}

function getVirtualDiskVolume(store, diskName, volumeName) {
  const disk = getVirtualDiskState(store, diskName);
  if (!disk || !(disk.volumes instanceof Map)) {
    return null;
  }
  const key = String(volumeName || "").trim().toLowerCase();
  return key ? (disk.volumes.get(key) || null) : null;
}

function ensureVirtualDiskVolume(store, diskName, volumeName) {
  if (!(store instanceof Map)) {
    return null;
  }
  const diskKey = String(diskName || "").trim().toLowerCase();
  const volumeKey = String(volumeName || "").trim().toLowerCase();
  if (!diskKey || !volumeKey) {
    return null;
  }
  let disk = store.get(diskKey) || null;
  if (!disk) {
    disk = {
      name: String(diskName || diskKey),
      volumes: new Map()
    };
    store.set(diskKey, disk);
  }
  let volume = disk.volumes.get(volumeKey) || null;
  if (!volume) {
    volume = makeDirEntry(String(volumeName || volumeKey));
    disk.volumes.set(volumeKey, volume);
  }
  return volume;
}

function listVirtualRootEntries(store) {
  const entries = [{
    name: SYSTEM_DISK_NAME,
    isDirectory: true,
    size: 0,
    mtimeMs: 0
  }];
  if (store instanceof Map) {
    const names = Array.from(store.values())
      .map((disk) => String(disk && disk.name ? disk.name : ""))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    for (let i = 0; i < names.length; i += 1) {
      entries.push({
        name: names[i],
        isDirectory: true,
        size: 0,
        mtimeMs: 0
      });
    }
  }
  return entries;
}

function listVirtualDiskEntries(store, diskName) {
  if (String(diskName || "").toLowerCase() === SYSTEM_DISK_NAME) {
    return [{
      name: SYSTEM_VOLUME_NAME,
      isDirectory: true,
      size: 0,
      mtimeMs: 0
    }];
  }
  const disk = getVirtualDiskState(store, diskName);
  if (!disk || !(disk.volumes instanceof Map)) {
    return [];
  }
  return Array.from(disk.volumes.values())
    .map((volume) => ({
      name: String(volume && volume.name ? volume.name : ""),
      isDirectory: true,
      size: 0,
      mtimeMs: 0
    }))
    .filter((entry) => !!entry.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function createVirtualDirectoryInfo(pathText, entries) {
  return {
    path: pathText,
    hostPath: pathText,
    exists: true,
    isDirectory: true,
    size: 0,
    mtimeMs: 0,
    entries: Array.isArray(entries) ? entries.slice() : []
  };
}

function parseTempDiskContainerPath(pathText) {
  const normalized = normalizeKosInput(pathText) || "/";
  const match = normalized.match(/^\/(tmp\d+)\/?$/i);
  if (!match) {
    return null;
  }
  return {
    normalized,
    diskName: match[1].toLowerCase()
  };
}

function parseTempDiskVolumePath(pathText) {
  const normalized = normalizeKosInput(pathText) || "/";
  const match = normalized.match(/^\/(tmp\d+)\/(\d+)(?:\/(.*))?$/i);
  if (!match) {
    return null;
  }
  return {
    normalized,
    diskName: match[1].toLowerCase(),
    volumeName: match[2],
    relativePath: match[3] ? `/${match[3]}` : "/"
  };
}

function resolveExistingPath(rootDir, cwd, kpath) {
  const kosPath = normalizeKosInput(kpath);
  const candidates = buildHostCandidates(rootDir, cwd, kosPath);
  for (let i = 0; i < candidates.length; i += 1) {
    const hostPath = candidates[i];
    const stats = statPath(hostPath);
    if (stats) {
      return {
        kosPath,
        hostPath,
        stats
      };
    }
  }
  return null;
}

function createNodeFileProviders(targetPath, rootDir) {
  const resolvedRoot = path.resolve(rootDir);
  const cwd = path.dirname(path.resolve(targetPath));
  const traceFs = process.env.KOS_TRACE_FS === "1";
  const virtualDisks = createVirtualDiskStore();

  function resolveHostPathForMutation(kpath) {
    const kosPath = normalizeKosInput(kpath);
    const candidates = buildHostCandidates(resolvedRoot, cwd, kosPath);
    return {
      kosPath,
      hostPath: candidates.length ? candidates[0] : ""
    };
  }

  function fileProvider(kpath) {
    const normalized = normalizeKosInput(kpath) || "/";
    const tempPath = parseTempDiskVolumePath(normalized);
    if (tempPath) {
      const volumeRoot = getVirtualDiskVolume(virtualDisks, tempPath.diskName, tempPath.volumeName);
      if (!volumeRoot) {
        return null;
      }
      const tempAccessors = createRootAccessors(volumeRoot);
      const record = tempAccessors.resolveEntryRecord(tempPath.relativePath);
      if (!record || !record.entry || record.entry.kind !== "file") {
        return null;
      }
      return cloneBytes(record.entry.data);
    }
    if (normalized === "/" || /^\/rd\/?$/i.test(normalized) || parseTempDiskContainerPath(normalized)) {
      return null;
    }
    const resolved = resolveExistingPath(resolvedRoot, cwd, kpath);
    if (!resolved || !resolved.stats || resolved.stats.isDirectory()) {
      return null;
    }
    try {
      return new Uint8Array(fs.readFileSync(resolved.hostPath));
    } catch (err) {
      return null;
    }
  }

  function fileInfoProvider(kpath, kind) {
    const normalized = normalizeKosInput(kpath) || "/";
    if (normalized === "/") {
      return createVirtualDirectoryInfo(normalized, (kind || "stat") === "list" ? listVirtualRootEntries(virtualDisks) : []);
    }
    if (/^\/rd\/?$/i.test(normalized)) {
      return createVirtualDirectoryInfo(normalized, (kind || "stat") === "list" ? listVirtualDiskEntries(virtualDisks, SYSTEM_DISK_NAME) : []);
    }
    const tempContainer = parseTempDiskContainerPath(normalized);
    if (tempContainer) {
      const disk = getVirtualDiskState(virtualDisks, tempContainer.diskName);
      if (!disk) {
        return null;
      }
      return createVirtualDirectoryInfo(normalized, (kind || "stat") === "list" ? listVirtualDiskEntries(virtualDisks, tempContainer.diskName) : []);
    }
    const tempPath = parseTempDiskVolumePath(normalized);
    if (tempPath) {
      const volumeRoot = getVirtualDiskVolume(virtualDisks, tempPath.diskName, tempPath.volumeName);
      if (!volumeRoot) {
        return null;
      }
      const tempAccessors = createRootAccessors(volumeRoot);
      const record = tempAccessors.resolveEntryRecord(tempPath.relativePath);
      if (!record || !record.entry) {
        return null;
      }
      const entry = record.entry;
      const info = {
        path: normalized,
        hostPath: normalized,
        exists: true,
        isDirectory: entry.kind === "directory",
        size: entry.kind === "file" ? (entry.size >>> 0) : 0,
        mtimeMs: entry.mtimeMs >>> 0
      };
      if ((kind || "stat") === "list") {
        info.entries = listDirEntries(entry);
      }
      return info;
    }
    const resolved = resolveExistingPath(resolvedRoot, cwd, kpath);
    if (!resolved) {
      return null;
    }
    const info = makeInfo(resolved.kosPath, resolved.hostPath, resolved.stats);
    if (!info) {
      return null;
    }
    if ((kind || "stat") !== "list") {
      return info;
    }
    if (!info.isDirectory) {
      info.entries = [];
      return info;
    }
    try {
      const names = fs.readdirSync(resolved.hostPath);
      info.entries = names.map((name) => {
        const entryHostPath = path.join(resolved.hostPath, name);
        const entryStats = statPath(entryHostPath);
        const entry = makeInfo("", entryHostPath, entryStats) || {
          hostPath: entryHostPath,
          exists: false,
          isDirectory: false,
          size: 0,
          mtimeMs: 0
        };
        return {
          name,
          isDirectory: !!entry.isDirectory,
          size: entry.size >>> 0,
          mtimeMs: Number.isFinite(Number(entry.mtimeMs)) ? Number(entry.mtimeMs) : 0
        };
      });
    } catch (err) {
      info.entries = [];
    }
    return info;
  }

  function fileMutationProvider(op, kpath, options) {
    const normalized = normalizeKosInput(kpath) || "/";
    const tempPath = parseTempDiskVolumePath(normalized);
    if (tempPath) {
      const volumeRoot = ensureVirtualDiskVolume(virtualDisks, tempPath.diskName, tempPath.volumeName);
      const tempAccessors = createRootAccessors(volumeRoot);
      if (op === "create-file") {
        const parent = tempAccessors.resolveParentRecord(tempPath.relativePath);
        if (!parent || !parent.parentEntry || parent.parentEntry.kind !== "directory") {
          return { errorCode: 5, written: 0 };
        }
        const name = parent.requestedName;
        if (!name) {
          return { errorCode: 33, written: 0 };
        }
        const existing = parent.parentEntry.children.get(name.toLowerCase()) || null;
        if (existing && existing.kind !== "file") {
          return { errorCode: 10, written: 0 };
        }
        const data = cloneBytes(options && options.data);
        const entry = existing || makeFileEntry(name, data, Date.now());
        entry.name = name;
        entry.kind = "file";
        entry.data = data;
        entry.size = data.length >>> 0;
        entry.mtimeMs = Date.now();
        parent.parentEntry.children.set(name.toLowerCase(), entry);
        return { errorCode: 0, written: entry.size >>> 0 };
      }
      if (op === "write-file") {
        const record = tempAccessors.resolveEntryRecord(tempPath.relativePath);
        if (!record || !record.entry) {
          return { errorCode: 5, written: 0 };
        }
        if (record.entry.kind !== "file") {
          return { errorCode: 10, written: 0 };
        }
        const offset = options && options.offset !== undefined ? (options.offset >>> 0) : 0;
        const patch = cloneBytes(options && options.data);
        const nextSize = Math.max(record.entry.size >>> 0, (offset + patch.length) >>> 0) >>> 0;
        const next = new Uint8Array(nextSize);
        next.set(record.entry.data.subarray(0, Math.min(record.entry.data.length, next.length)), 0);
        if (patch.length) {
          next.set(patch, offset);
        }
        record.entry.data = next;
        record.entry.size = next.length >>> 0;
        record.entry.mtimeMs = Date.now();
        return { errorCode: 0, written: patch.length >>> 0 };
      }
      if (op === "set-end") {
        const record = tempAccessors.resolveEntryRecord(tempPath.relativePath);
        if (!record || !record.entry) {
          return { errorCode: 5, written: 0 };
        }
        if (record.entry.kind !== "file") {
          return { errorCode: 10, written: 0 };
        }
        const size = options && options.size !== undefined ? (options.size >>> 0) : 0;
        const next = new Uint8Array(size);
        next.set(record.entry.data.subarray(0, Math.min(record.entry.data.length, size)), 0);
        record.entry.data = next;
        record.entry.size = next.length >>> 0;
        record.entry.mtimeMs = Date.now();
        return { errorCode: 0, written: 0 };
      }
      if (op === "delete") {
        const record = tempAccessors.resolveEntryRecord(tempPath.relativePath);
        if (!record || !record.entry || !record.parent) {
          return { errorCode: 5, written: 0 };
        }
        if (record.entry.kind === "directory" && record.entry.children.size) {
          return { errorCode: 10, written: 0 };
        }
        record.parent.children.delete(record.entry.name.toLowerCase());
        return { errorCode: 0, written: 0 };
      }
      if (op === "create-folder") {
        const parent = tempAccessors.resolveParentRecord(tempPath.relativePath);
        if (!parent || !parent.parentEntry || parent.parentEntry.kind !== "directory") {
          return { errorCode: 5, written: 0 };
        }
        const name = parent.requestedName;
        if (!name) {
          return { errorCode: 33, written: 0 };
        }
        const existing = parent.parentEntry.children.get(name.toLowerCase()) || null;
        if (existing) {
          return existing.kind === "directory" ? { errorCode: 0, written: 0 } : { errorCode: 10, written: 0 };
        }
        const entry = makeDirEntry(name);
        entry.mtimeMs = Date.now();
        parent.parentEntry.children.set(name.toLowerCase(), entry);
        return { errorCode: 0, written: 0 };
      }
      if (op === "move") {
        const nextTempPath = parseTempDiskVolumePath(options && options.nextPath ? options.nextPath : "");
        if (
          !nextTempPath ||
          nextTempPath.diskName !== tempPath.diskName ||
          String(nextTempPath.volumeName) !== String(tempPath.volumeName)
        ) {
          return { errorCode: 10, written: 0 };
        }
        const source = tempAccessors.resolveEntryRecord(tempPath.relativePath);
        const target = tempAccessors.resolveParentRecord(nextTempPath.relativePath);
        if (!source || !source.entry || !source.parent) {
          return { errorCode: 5, written: 0 };
        }
        if (!target || !target.parentEntry || target.parentEntry.kind !== "directory") {
          return { errorCode: 5, written: 0 };
        }
        const nextName = target.requestedName;
        if (!nextName) {
          return { errorCode: 33, written: 0 };
        }
        if (target.parentEntry.children.has(nextName.toLowerCase())) {
          return { errorCode: 10, written: 0 };
        }
        if (source.entry.kind === "directory") {
          const sourcePath = source.segments.join("/").toLowerCase();
          const targetPath = target.parentSegments.concat([nextName]).join("/").toLowerCase();
          if (targetPath === sourcePath || targetPath.startsWith(`${sourcePath}/`)) {
            return { errorCode: 10, written: 0 };
          }
        }
        source.parent.children.delete(source.entry.name.toLowerCase());
        source.entry.name = nextName;
        source.entry.mtimeMs = Date.now();
        target.parentEntry.children.set(nextName.toLowerCase(), source.entry);
        return { errorCode: 0, written: 0 };
      }
      return { errorCode: 2, written: 0 };
    }
    const resolved = resolveHostPathForMutation(kpath);
    const hostPath = resolved.hostPath;
    const opts = options || {};
    if (!hostPath) {
      return { errorCode: 33, written: 0 };
    }
    if (traceFs) {
      const extra = [];
      if (opts.offset !== undefined) {
        extra.push(`offset=${opts.offset >>> 0}`);
      }
      if (opts.size !== undefined) {
        extra.push(`size=${opts.size >>> 0}`);
      }
      if (opts.nextPath !== undefined) {
        extra.push(`next='${opts.nextPath}'`);
      }
      if (opts.data) {
        extra.push(`bytes=${opts.data.byteLength !== undefined ? (opts.data.byteLength >>> 0) : (opts.data.length >>> 0)}`);
      }
      console.log(`[fs] ${op} '${resolved.kosPath}' -> '${hostPath}'${extra.length ? ` ${extra.join(" ")}` : ""}`);
    }

    try {
      if (op === "create-file") {
        const parent = path.dirname(hostPath);
        if (!statPath(parent) || !statPath(parent).isDirectory()) {
          return { errorCode: 5, written: 0 };
        }
        const data = opts.data ? Buffer.from(opts.data) : Buffer.alloc(0);
        fs.writeFileSync(hostPath, data);
        return { errorCode: 0, written: data.length >>> 0 };
      }

      if (op === "write-file") {
        const stats = statPath(hostPath);
        if (!stats) {
          return { errorCode: 5, written: 0 };
        }
        if (stats.isDirectory()) {
          return { errorCode: 10, written: 0 };
        }
        const offset = opts.offset >>> 0;
        const data = opts.data ? Buffer.from(opts.data) : Buffer.alloc(0);
        const nextSize = Math.max(stats.size >>> 0, (offset + data.length) >>> 0) >>> 0;
        const out = Buffer.alloc(nextSize);
        if (stats.size > 0) {
          fs.readFileSync(hostPath).copy(out, 0, 0, Math.min(stats.size >>> 0, out.length));
        }
        data.copy(out, offset);
        fs.writeFileSync(hostPath, out);
        return { errorCode: 0, written: data.length >>> 0 };
      }

      if (op === "set-end") {
        const stats = statPath(hostPath);
        if (!stats) {
          return { errorCode: 5, written: 0 };
        }
        if (stats.isDirectory()) {
          return { errorCode: 10, written: 0 };
        }
        fs.truncateSync(hostPath, opts.size >>> 0);
        return { errorCode: 0, written: 0 };
      }

      if (op === "delete") {
        const stats = statPath(hostPath);
        if (!stats) {
          return { errorCode: 5, written: 0 };
        }
        if (stats.isDirectory()) {
          const names = fs.readdirSync(hostPath);
          if (names.length) {
            return { errorCode: 10, written: 0 };
          }
          fs.rmdirSync(hostPath);
          return { errorCode: 0, written: 0 };
        }
        fs.unlinkSync(hostPath);
        return { errorCode: 0, written: 0 };
      }

      if (op === "create-folder") {
        const existing = statPath(hostPath);
        if (existing) {
          return existing.isDirectory() ? { errorCode: 0, written: 0 } : { errorCode: 10, written: 0 };
        }
        const parent = path.dirname(hostPath);
        if (!statPath(parent) || !statPath(parent).isDirectory()) {
          return { errorCode: 5, written: 0 };
        }
        fs.mkdirSync(hostPath);
        return { errorCode: 0, written: 0 };
      }

      if (op === "move") {
        const nextResolved = resolveHostPathForMutation(opts.nextPath);
        const nextHostPath = nextResolved.hostPath;
        const stats = statPath(hostPath);
        if (!stats) {
          return { errorCode: 5, written: 0 };
        }
        if (!nextHostPath) {
          return { errorCode: 33, written: 0 };
        }
        const nextParent = path.dirname(nextHostPath);
        if (!statPath(nextParent) || !statPath(nextParent).isDirectory()) {
          return { errorCode: 5, written: 0 };
        }
        if (statPath(nextHostPath)) {
          return { errorCode: 10, written: 0 };
        }
        fs.renameSync(hostPath, nextHostPath);
        return { errorCode: 0, written: 0 };
      }
    } catch (err) {
      return { errorCode: 10, written: 0 };
    }

    return { errorCode: 2, written: 0 };
  }

  return {
    fileProvider,
    fileInfoProvider,
    fileMutationProvider
  };
}

module.exports = {
  createNodeFileProviders,
  normalizeKosInput,
  buildHostCandidates
};

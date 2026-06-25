(() => {
  const KosEmu = globalThis.KosEmu;

  function decodeBase64(base64) {
    const raw = atob(String(base64 || ""));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) {
      out[i] = raw.charCodeAt(i) & 0xff;
    }
    return out;
  }

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
    return text.replace(/\/+/g, "/");
  }

  function mapKosPathSegments(kpath) {
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

  function makeDirEntry(name) {
    return {
      name: String(name || ""),
      kind: "directory",
      children: new Map(),
      size: 0,
      mtimeMs: 0
    };
  }

  function makeFileEntry(name, record) {
    return {
      name: String(name || ""),
      kind: "file",
      size: Math.max(0, Number(record && record.size) || 0) >>> 0,
      mtimeMs: Math.max(0, Number(record && record.mtimeMs) || 0),
      base64: String(record && record.base64 ? record.base64 : ""),
      bytes: null
    };
  }

  const SYSTEM_DISK_NAME = "rd";
  const SYSTEM_VOLUME_NAME = "1";
  const DEFAULT_TMP_DISK_NAME = "tmp0";
  const DEFAULT_TMP_VOLUME_NAME = "1";

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

  function encodeBase64(bytes) {
    const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(0);
    let raw = "";
    for (let i = 0; i < source.length; i += 1) {
      raw += String.fromCharCode(source[i] & 0xff);
    }
    return btoa(raw);
  }

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

  function buildEntryTreeFromManifest(manifest) {
    const source = manifest && Array.isArray(manifest.files) ? manifest.files : [];
    const rootEntry = makeDirEntry("");

    for (let i = 0; i < source.length; i += 1) {
      const record = source[i] || {};
      const normalized = normalizeKosInput(record.path);
      const segments = mapKosPathSegments(normalized);
      if (!segments.length) {
        continue;
      }
      let parent = rootEntry;
      for (let j = 0; j < segments.length - 1; j += 1) {
        const dirName = segments[j];
        const dirKey = dirName.toLowerCase();
        let next = parent.children.get(dirKey) || null;
        if (!next || next.kind !== "directory") {
          next = makeDirEntry(dirName);
          parent.children.set(dirKey, next);
        }
        parent = next;
      }
      const fileName = segments[segments.length - 1];
      const fileEntry = makeFileEntry(fileName, record);
      parent.children.set(fileName.toLowerCase(), fileEntry);
    }
    return rootEntry;
  }

  function snapshotEntryTree(entry) {
    if (!entry) {
      return null;
    }
    if (entry.kind === "file") {
      const bytes = entry.bytes instanceof Uint8Array ? entry.bytes : decodeBase64(entry.base64);
      return {
        name: entry.name,
        kind: "file",
        size: bytes.length >>> 0,
        mtimeMs: entry.mtimeMs >>> 0,
        base64: encodeBase64(bytes)
      };
    }
    const children = [];
    for (const child of entry.children.values()) {
      children.push(snapshotEntryTree(child));
    }
    children.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return {
      name: entry.name,
      kind: "directory",
      mtimeMs: entry.mtimeMs >>> 0,
      children
    };
  }

  function restoreEntryTree(snapshot) {
    if (!snapshot || snapshot.kind === "file") {
      return makeFileEntry(snapshot && snapshot.name ? snapshot.name : "", snapshot || {});
    }
    const entry = makeDirEntry(snapshot.name || "");
    entry.mtimeMs = Math.max(0, Number(snapshot.mtimeMs) || 0);
    const children = Array.isArray(snapshot.children) ? snapshot.children : [];
    for (let i = 0; i < children.length; i += 1) {
      const child = restoreEntryTree(children[i] || null);
      if (!child || !child.name) {
        continue;
      }
      entry.children.set(child.name.toLowerCase(), child);
    }
    return entry;
  }

  function measureEntryTree(entry) {
    let fileCount = 0;
    let totalBytes = 0;
    const stack = [entry];
    while (stack.length) {
      const current = stack.pop();
      if (!current) {
        continue;
      }
      if (current.kind === "file") {
        fileCount += 1;
        totalBytes += current.size >>> 0;
        continue;
      }
      for (const child of current.children.values()) {
        stack.push(child);
      }
    }
    return {
      fileCount: fileCount >>> 0,
      totalBytes: totalBytes >>> 0
    };
  }

  function createRootAccessors(rootEntry) {
    function resolveEntryRecord(kpath) {
      const normalized = normalizeKosInput(kpath) || "/";
      const requestedSegments = mapKosPathSegments(normalized);
      let entry = rootEntry;
      let parent = null;
      for (let i = 0; i < requestedSegments.length; i += 1) {
        if (!entry || entry.kind !== "directory") {
          return null;
        }
        parent = entry;
        entry = entry.children.get(requestedSegments[i].toLowerCase()) || null;
        if (!entry) {
          return null;
        }
      }
      return {
        normalized,
        segments: requestedSegments,
        parent,
        parentSegments: requestedSegments.slice(0, Math.max(0, requestedSegments.length - 1)),
        entry
      };
    }

    function resolveParentRecord(kpath) {
      const normalized = normalizeKosInput(kpath);
      const segments = mapKosPathSegments(normalized);
      if (!segments.length) {
        return null;
      }
      let parentEntry = rootEntry;
      const parentSegments = segments.slice(0, -1);
      for (let i = 0; i < parentSegments.length; i += 1) {
        if (!parentEntry || parentEntry.kind !== "directory") {
          return null;
        }
        parentEntry = parentEntry.children.get(parentSegments[i].toLowerCase()) || null;
      }
      return {
        normalized,
        parentSegments,
        parentEntry,
        requestedName: segments[segments.length - 1] || ""
      };
    }

    function getBytes(entry) {
      if (!entry || entry.kind !== "file") {
        return null;
      }
      if (!(entry.bytes instanceof Uint8Array)) {
        entry.bytes = decodeBase64(entry.base64);
      }
      return entry.bytes;
    }

    return {
      resolveEntryRecord,
      resolveParentRecord,
      getBytes
    };
  }

  function createReadOnlyRoot(manifest) {
    const rootEntry = buildEntryTreeFromManifest(manifest);
    const stats = measureEntryTree(rootEntry);
    const accessors = createRootAccessors(rootEntry);
    const virtualDisks = createVirtualDiskStore();

    const rootLabel = manifest && manifest.label ? String(manifest.label) : "builtin-kolibri-root";

    return {
      label: rootLabel,
      permission: "granted",
      summaryText() {
        return `${rootLabel} | ${stats.fileCount} files | bundled`;
      },
      flushPending() {
        return Promise.resolve();
      },
      fileProvider(kpath) {
        const normalized = normalizeKosInput(kpath) || "/";
        const tempPath = parseTempDiskVolumePath(normalized);
        if (tempPath) {
          const volumeRoot = getVirtualDiskVolume(virtualDisks, tempPath.diskName, tempPath.volumeName);
          if (!volumeRoot) {
            return null;
          }
          const tempAccessors = createRootAccessors(volumeRoot);
          const record = tempAccessors.resolveEntryRecord(tempPath.relativePath);
          const bytes = tempAccessors.getBytes(record ? record.entry : null);
          return bytes ? bytes.slice() : null;
        }
        if (normalized === "/" || /^\/rd\/?$/i.test(normalized) || parseTempDiskContainerPath(normalized)) {
          return null;
        }
        const record = accessors.resolveEntryRecord(kpath);
        const bytes = accessors.getBytes(record ? record.entry : null);
        return bytes ? bytes.slice() : null;
      },
      fileInfoProvider(kpath, kind) {
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
          const entry = record ? record.entry : null;
          if (!entry) {
            return null;
          }
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
        const record = accessors.resolveEntryRecord(normalized);
        const entry = record ? record.entry : null;
        if (!entry) {
          return null;
        }
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
      },
      mutationProvider() {
        return { errorCode: 2, written: 0 };
      },
      fileCount: stats.fileCount >>> 0,
      totalBytes: stats.totalBytes >>> 0
    };
  }

  function supportsLocalStorage() {
    try {
      return typeof localStorage !== "undefined";
    } catch (err) {
      return false;
    }
  }

  function getPersistStorageKey(manifest) {
    const sourcePath = manifest && manifest.sourcePath ? String(manifest.sourcePath) : "builtin";
    const launchPath = manifest && manifest.launchPath ? String(manifest.launchPath) : "/sys/LAUNCHER";
    return `kos-emu:builtin-root:${sourcePath}:${launchPath}`;
  }

  function clearPersistedSnapshot(manifest) {
    if (!supportsLocalStorage()) {
      return false;
    }
    const storageKey = getPersistStorageKey(manifest);
    try {
      localStorage.removeItem(storageKey);
      return true;
    } catch (err) {
      return false;
    }
  }

  function loadPersistedSnapshot(manifest) {
    if (!supportsLocalStorage()) {
      return null;
    }
    const storageKey = getPersistStorageKey(manifest);
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.kind !== "directory") {
        return null;
      }
      return restoreEntryTree(parsed);
    } catch (err) {
      return null;
    }
  }

  function createBundledRoot(manifest) {
    const rootLabel = manifest && manifest.label ? String(manifest.label) : "builtin-kolibri-root";
    const storageKey = getPersistStorageKey(manifest);
    const rootEntry = loadPersistedSnapshot(manifest) || buildEntryTreeFromManifest(manifest);
    const accessors = createRootAccessors(rootEntry);
    const virtualDisks = createVirtualDiskStore();
    let stats = measureEntryTree(rootEntry);
    let pendingFlush = Promise.resolve();

    function updateStats() {
      stats = measureEntryTree(rootEntry);
    }

    function queuePersist() {
      if (!supportsLocalStorage()) {
        return pendingFlush;
      }
      pendingFlush = pendingFlush
        .catch(() => {})
        .then(() => {
          localStorage.setItem(storageKey, JSON.stringify(snapshotEntryTree(rootEntry)));
      });
      return pendingFlush;
    }

    function createOrRewriteFileAt(targetAccessors, kpath, options, persistChanges) {
      const parent = targetAccessors.resolveParentRecord(kpath);
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
      const bytes = cloneBytes(options && options.data);
      const entry = existing || makeFileEntry(name, { size: bytes.length, base64: "", mtimeMs: Date.now() });
      entry.name = name;
      entry.kind = "file";
      entry.size = bytes.length >>> 0;
      entry.mtimeMs = Date.now();
      entry.bytes = bytes;
      entry.base64 = encodeBase64(bytes);
      parent.parentEntry.children.set(name.toLowerCase(), entry);
      if (persistChanges) {
        updateStats();
        queuePersist();
      }
      return { errorCode: 0, written: entry.size >>> 0 };
    }

    function writeExistingFileAt(targetAccessors, kpath, options, persistChanges) {
      const record = targetAccessors.resolveEntryRecord(kpath);
      if (!record || !record.entry) {
        return { errorCode: 5, written: 0 };
      }
      if (record.entry.kind !== "file") {
        return { errorCode: 10, written: 0 };
      }
      const offset = options && options.offset !== undefined ? (options.offset >>> 0) : 0;
      const patch = cloneBytes(options && options.data);
      const base = accessors.getBytes(record.entry) || new Uint8Array(0);
      const nextSize = Math.max(base.length >>> 0, (offset + patch.length) >>> 0) >>> 0;
      const next = new Uint8Array(nextSize);
      next.set(base.subarray(0, Math.min(base.length, next.length)), 0);
      if (patch.length) {
        next.set(patch, offset);
      }
      record.entry.bytes = next;
      record.entry.base64 = encodeBase64(next);
      record.entry.size = next.length >>> 0;
      record.entry.mtimeMs = Date.now();
      if (persistChanges) {
        updateStats();
        queuePersist();
      }
      return { errorCode: 0, written: patch.length >>> 0 };
    }

    function setEndOfFileAt(targetAccessors, kpath, options, persistChanges) {
      const record = targetAccessors.resolveEntryRecord(kpath);
      if (!record || !record.entry) {
        return { errorCode: 5, written: 0 };
      }
      if (record.entry.kind !== "file") {
        return { errorCode: 10, written: 0 };
      }
      const size = options && options.size !== undefined ? (options.size >>> 0) : 0;
      const base = accessors.getBytes(record.entry) || new Uint8Array(0);
      const next = new Uint8Array(size);
      next.set(base.subarray(0, Math.min(base.length, size)), 0);
      record.entry.bytes = next;
      record.entry.base64 = encodeBase64(next);
      record.entry.size = next.length >>> 0;
      record.entry.mtimeMs = Date.now();
      if (persistChanges) {
        updateStats();
        queuePersist();
      }
      return { errorCode: 0, written: 0 };
    }

    function deletePathAt(targetAccessors, kpath, persistChanges) {
      const record = targetAccessors.resolveEntryRecord(kpath);
      if (!record || !record.entry || !record.parent) {
        return { errorCode: 5, written: 0 };
      }
      if (record.entry.kind === "directory" && record.entry.children.size) {
        return { errorCode: 10, written: 0 };
      }
      record.parent.children.delete(record.entry.name.toLowerCase());
      if (persistChanges) {
        updateStats();
        queuePersist();
      }
      return { errorCode: 0, written: 0 };
    }

    function createFolderAt(targetAccessors, kpath, persistChanges) {
      const parent = targetAccessors.resolveParentRecord(kpath);
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
      if (persistChanges) {
        queuePersist();
      }
      return { errorCode: 0, written: 0 };
    }

    function renameOrMovePathAt(targetAccessors, kpath, options, persistChanges) {
      const source = targetAccessors.resolveEntryRecord(kpath);
      const nextPath = options && options.nextPath ? String(options.nextPath) : "";
      const target = targetAccessors.resolveParentRecord(nextPath);
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
      if (persistChanges) {
        updateStats();
        queuePersist();
      }
      return { errorCode: 0, written: 0 };
    }

    return {
      label: rootLabel,
      permission: "granted",
      summaryText() {
        return `${rootLabel} | ${stats.fileCount} files | bundled | ${supportsLocalStorage() ? "persisted" : "volatile"}`;
      },
      flushPending() {
        return pendingFlush;
      },
      fileProvider(kpath) {
        const normalized = normalizeKosInput(kpath) || "/";
        const tempPath = parseTempDiskVolumePath(normalized);
        if (tempPath) {
          const volumeRoot = getVirtualDiskVolume(virtualDisks, tempPath.diskName, tempPath.volumeName);
          if (!volumeRoot) {
            return null;
          }
          const tempAccessors = createRootAccessors(volumeRoot);
          const record = tempAccessors.resolveEntryRecord(tempPath.relativePath);
          const bytes = tempAccessors.getBytes(record ? record.entry : null);
          return bytes ? bytes.slice() : null;
        }
        if (normalized === "/" || /^\/rd\/?$/i.test(normalized) || parseTempDiskContainerPath(normalized)) {
          return null;
        }
        const record = accessors.resolveEntryRecord(kpath);
        const bytes = accessors.getBytes(record ? record.entry : null);
        return bytes ? bytes.slice() : null;
      },
      fileInfoProvider(kpath, kind) {
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
          const entry = record ? record.entry : null;
          if (!entry) {
            return null;
          }
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
        const record = accessors.resolveEntryRecord(normalized);
        const entry = record ? record.entry : null;
        if (!entry) {
          return null;
        }
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
      },
      mutationProvider(op, kpath, options) {
        const normalized = normalizeKosInput(kpath) || "/";
        const tempPath = parseTempDiskVolumePath(normalized);
        if (tempPath) {
          const volumeRoot = ensureVirtualDiskVolume(virtualDisks, tempPath.diskName, tempPath.volumeName);
          const tempAccessors = createRootAccessors(volumeRoot);
          switch (op) {
            case "create-file":
              return createOrRewriteFileAt(tempAccessors, tempPath.relativePath, options, false);
            case "write-file":
              return writeExistingFileAt(tempAccessors, tempPath.relativePath, options, false);
            case "set-end":
              return setEndOfFileAt(tempAccessors, tempPath.relativePath, options, false);
            case "delete":
              return deletePathAt(tempAccessors, tempPath.relativePath, false);
            case "create-folder":
              return createFolderAt(tempAccessors, tempPath.relativePath, false);
            case "move": {
              const nextTempPath = parseTempDiskVolumePath(options && options.nextPath ? options.nextPath : "");
              if (
                !nextTempPath ||
                nextTempPath.diskName !== tempPath.diskName ||
                String(nextTempPath.volumeName) !== String(tempPath.volumeName)
              ) {
                return { errorCode: 10, written: 0 };
              }
              return renameOrMovePathAt(tempAccessors, tempPath.relativePath, { ...(options || {}), nextPath: nextTempPath.relativePath }, false);
            }
            default:
              return { errorCode: 2, written: 0 };
          }
        }
        switch (op) {
          case "create-file":
            return createOrRewriteFileAt(accessors, normalized, options, true);
          case "write-file":
            return writeExistingFileAt(accessors, normalized, options, true);
          case "set-end":
            return setEndOfFileAt(accessors, normalized, options, true);
          case "delete":
            return deletePathAt(accessors, normalized, true);
          case "create-folder":
            return createFolderAt(accessors, normalized, true);
          case "move":
            return renameOrMovePathAt(accessors, normalized, options, true);
          default:
            return { errorCode: 2, written: 0 };
        }
      },
      clearPersistence() {
        return clearPersistedSnapshot(manifest);
      },
      get fileCount() {
        return stats.fileCount >>> 0;
      },
      get totalBytes() {
        return stats.totalBytes >>> 0;
      }
    };
  }

  async function bootBundledDesktopPage(app, options) {
    if (!app) {
      throw new Error("Application instance is required.");
    }
    const config = options || {};
    const assets = KosEmu.assets || {};
    const assetKey = config.assetKey ? String(config.assetKey) : "builtinKolibriRoot";
    const manifest = config.manifest || assets[assetKey] || null;
    if (!manifest) {
      throw new Error(`Bundled root asset not found: ${assetKey}`);
    }
    const root = createBundledRoot(manifest);
    app.browserFsRoot = root;
    app.savedFsRootLabel = "";
    app.savedFsRootPendingPermission = false;
    if (typeof app.updateFsRootStatus === "function") {
      app.updateFsRootStatus();
    }
    if (app.sessionManager && typeof app.sessionManager.refreshSkinThemes === "function") {
      app.sessionManager.refreshSkinThemes();
    }
    if (typeof app.updateSessionState === "function") {
      app.updateSessionState();
    }
    if (typeof app.log === "function") {
      app.log(`Mounted built-in FS root: ${root.summaryText()}`);
    }
    const launchPath = String(config.launchPath || manifest.launchPath || "/sys/LAUNCHER");
    const bytes = root.fileProvider(launchPath);
    if (!bytes || !bytes.byteLength) {
      throw new Error(`Bundled image not found: ${launchPath}`);
    }
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const fileName = launchPath.split("/").filter(Boolean).pop() || "LAUNCHER";
    app.loadImageFromBuffer(fileName, buffer, "Loaded");
    app.launchCurrentImage();
    return {
      root,
      launchPath
    };
  }

  KosEmu.ui.bundledRoot = {
    normalizeKosInput,
    createReadOnlyRoot,
    createBundledRoot,
    clearPersistedSnapshot,
    bootBundledDesktopPage
  };
})();

(() => {
  const KosEmu = globalThis.KosEmu;
  const HANDLE_DB_NAME = "kos-emu-browser-fs";
  const HANDLE_STORE_NAME = "handles";
  const ROOT_HANDLE_KEY = "fs-root";

  function noop() {}

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
    if (!relative) {
      return [];
    }
    return relative.split("/").filter(Boolean);
  }

  function cloneBytes(data) {
    if (!data) {
      return new Uint8Array(0);
    }
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
      name: name || "",
      kind: "directory",
      children: new Map(),
      size: 0,
      mtimeMs: 0
    };
  }

  function makeFileEntry(name, data, mtimeMs) {
    const bytes = cloneBytes(data);
    return {
      name: name || "",
      kind: "file",
      data: bytes,
      size: bytes.length >>> 0,
      mtimeMs: Number.isFinite(Number(mtimeMs)) ? Number(mtimeMs) : 0
    };
  }

  const SYSTEM_DISK_NAME = "rd";
  const SYSTEM_VOLUME_NAME = "1";
  const DEFAULT_TMP_DISK_NAME = "tmp0";
  const DEFAULT_TMP_VOLUME_NAME = "1";

  function createRootAccessors(rootEntry) {
    function resolveEntryRecord(kpath) {
      const requestedSegments = mapKosPathSegments(kpath);
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
      const requestedSegments = mapKosPathSegments(kpath);
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

  function snapshotEntryTree(entry) {
    if (!entry) {
      return null;
    }
    if (entry.kind === "file") {
      return {
        name: entry.name,
        kind: "file",
        data: cloneBytes(entry.data),
        size: entry.size >>> 0,
        mtimeMs: entry.mtimeMs >>> 0
      };
    }
    const children = [];
    for (const child of entry.children.values()) {
      children.push(snapshotEntryTree(child));
    }
    return {
      name: entry.name,
      kind: "directory",
      children,
      size: 0,
      mtimeMs: entry.mtimeMs >>> 0
    };
  }

  function supportsHandlePersistence() {
    return typeof indexedDB !== "undefined";
  }

  function openHandleDb() {
    return new Promise((resolve, reject) => {
      if (!supportsHandlePersistence()) {
        reject(new Error("IndexedDB unavailable."));
        return;
      }
      let request;
      try {
        request = indexedDB.open(HANDLE_DB_NAME, 1);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(HANDLE_STORE_NAME)) {
          db.createObjectStore(HANDLE_STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB."));
      request.onblocked = () => reject(new Error("IndexedDB open blocked."));
    });
  }

  function waitTransaction(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed."));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted."));
    });
  }

  class BrowserFsRoot {
    constructor(handle, opts) {
      this.rootHandle = handle;
      this.log = opts && typeof opts.log === "function" ? opts.log : noop;
      this.onProgress = opts && typeof opts.onProgress === "function" ? opts.onProgress : noop;
      this.label = handle && handle.name ? String(handle.name) : "selected-folder";
      this.permission = "prompt";
      this.rootEntry = makeDirEntry("");
      this.virtualDisks = createVirtualDiskStore();
      this.fileCount = 0;
      this.dirCount = 1;
      this.totalBytes = 0;
      this.flushChain = Promise.resolve();
    }

    static supportsDirectoryPicker() {
      return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
    }

    static supportsHandlePersistence() {
      return supportsHandlePersistence();
    }

    static async loadPersistedDirectoryHandle() {
      if (!supportsHandlePersistence()) {
        return null;
      }
      const db = await openHandleDb();
      try {
        const tx = db.transaction(HANDLE_STORE_NAME, "readonly");
        const store = tx.objectStore(HANDLE_STORE_NAME);
        const request = store.get(ROOT_HANDLE_KEY);
        const handle = await new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error || new Error("Failed to read persisted FS root."));
        });
        await waitTransaction(tx);
        if (!handle || handle.kind === "directory") {
          return handle || null;
        }
      } finally {
        db.close();
      }
      await BrowserFsRoot.clearPersistedDirectoryHandle();
      return null;
    }

    static async savePersistedDirectoryHandle(handle) {
      if (!handle || handle.kind !== "directory" || !supportsHandlePersistence()) {
        return;
      }
      const db = await openHandleDb();
      try {
        const tx = db.transaction(HANDLE_STORE_NAME, "readwrite");
        tx.objectStore(HANDLE_STORE_NAME).put(handle, ROOT_HANDLE_KEY);
        await waitTransaction(tx);
      } finally {
        db.close();
      }
    }

    static async clearPersistedDirectoryHandle() {
      if (!supportsHandlePersistence()) {
        return;
      }
      const db = await openHandleDb();
      try {
        const tx = db.transaction(HANDLE_STORE_NAME, "readwrite");
        tx.objectStore(HANDLE_STORE_NAME).delete(ROOT_HANDLE_KEY);
        await waitTransaction(tx);
      } finally {
        db.close();
      }
    }

    static async fromDirectoryHandle(handle, opts) {
      const root = new BrowserFsRoot(handle, opts);
      await root.requestAccess({
        interactive: !opts || opts.interactive !== false
      });
      if (root.permission === "granted") {
        await root.reload();
      }
      return root;
    }

    async requestAccess(options) {
      if (!this.rootHandle) {
        return "denied";
      }
      const interactive = !options || options.interactive !== false;
      try {
        if (typeof this.rootHandle.queryPermission === "function") {
          this.permission = await this.rootHandle.queryPermission({ mode: "readwrite" });
        }
      } catch (err) {
        this.permission = "prompt";
      }
      if (this.permission !== "granted" && interactive && typeof this.rootHandle.requestPermission === "function") {
        try {
          this.permission = await this.rootHandle.requestPermission({ mode: "readwrite" });
        } catch (err) {
          this.permission = "denied";
        }
      }
      return this.permission;
    }

    async reload() {
      this.fileCount = 0;
      this.dirCount = 1;
      this.totalBytes = 0;
      this.rootEntry = await this.scanDirectory(this.rootHandle, "");
      this.rootEntry.mtimeMs = Date.now();
    }

    async scanDirectory(handle, name) {
      const entry = makeDirEntry(name);
      const children = [];
      for await (const childHandle of handle.values()) {
        children.push(childHandle);
      }
      children.sort((a, b) => String(a.name).localeCompare(String(b.name)));
      for (let i = 0; i < children.length; i += 1) {
        const childHandle = children[i];
        if (childHandle.kind === "directory") {
          const childEntry = await this.scanDirectory(childHandle, childHandle.name);
          entry.children.set(childEntry.name.toLowerCase(), childEntry);
          this.dirCount += 1;
          continue;
        }
        const file = await childHandle.getFile();
        const bytes = new Uint8Array(await file.arrayBuffer());
        const childEntry = makeFileEntry(childHandle.name, bytes, file.lastModified);
        entry.children.set(childEntry.name.toLowerCase(), childEntry);
        this.fileCount += 1;
        this.totalBytes += childEntry.size >>> 0;
        if ((this.fileCount & 0x7f) === 0) {
          this.onProgress({
            label: this.label,
            files: this.fileCount >>> 0,
            dirs: this.dirCount >>> 0,
            bytes: this.totalBytes >>> 0
          });
        }
      }
      return entry;
    }

    summaryText() {
      return `${this.label} | ${this.fileCount} files | ${this.dirCount} dirs`;
    }

    flushPending() {
      return this.flushChain;
    }

    queueFlush(label, action) {
      const task = typeof action === "function" ? action : noop;
      this.flushChain = this.flushChain.then(task).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.log(`Browser FS flush failed (${label}): ${message}`);
      });
      return this.flushChain;
    }

    resolveEntryRecord(kpath) {
      const requestedSegments = mapKosPathSegments(kpath);
      let entry = this.rootEntry;
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

    resolveParentRecord(kpath) {
      const requestedSegments = mapKosPathSegments(kpath);
      if (!requestedSegments.length) {
        return null;
      }
      let parentEntry = this.rootEntry;
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

    fileProvider(kpath) {
      const normalized = normalizeKosInput(kpath) || "/";
      const tempPath = parseTempDiskVolumePath(normalized);
      if (tempPath) {
        const volumeRoot = getVirtualDiskVolume(this.virtualDisks, tempPath.diskName, tempPath.volumeName);
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
      const record = this.resolveEntryRecord(normalized);
      if (!record || !record.entry || record.entry.kind !== "file") {
        return null;
      }
      return cloneBytes(record.entry.data);
    }

    fileInfoProvider(kpath, kind) {
      const normalized = normalizeKosInput(kpath);
      if (!normalized || normalized === "/") {
        return createVirtualDirectoryInfo("/", (kind || "stat") === "list" ? listVirtualRootEntries(this.virtualDisks) : []);
      }
      if (/^\/rd\/?$/i.test(normalized)) {
        return createVirtualDirectoryInfo(normalized, (kind || "stat") === "list" ? listVirtualDiskEntries(this.virtualDisks, SYSTEM_DISK_NAME) : []);
      }
      const tempContainer = parseTempDiskContainerPath(normalized);
      if (tempContainer) {
        const disk = getVirtualDiskState(this.virtualDisks, tempContainer.diskName);
        if (!disk) {
          return null;
        }
        return createVirtualDirectoryInfo(normalized, (kind || "stat") === "list" ? listVirtualDiskEntries(this.virtualDisks, tempContainer.diskName) : []);
      }
      const tempPath = parseTempDiskVolumePath(normalized);
      if (tempPath) {
        const volumeRoot = getVirtualDiskVolume(this.virtualDisks, tempPath.diskName, tempPath.volumeName);
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
          exists: true,
          isDirectory: entry.kind === "directory",
          size: entry.kind === "file" ? (entry.size >>> 0) : 0,
          mtimeMs: entry.mtimeMs >>> 0
        };
        if ((kind || "stat") === "list") {
          info.entries = entry.kind === "directory" ? Array.from(entry.children.values()).map((child) => ({
            name: child.name,
            isDirectory: child.kind === "directory",
            size: child.kind === "file" ? (child.size >>> 0) : 0,
            mtimeMs: child.mtimeMs >>> 0
          })) : [];
        }
        return info;
      }
      const record = this.resolveEntryRecord(normalized);
      if (!record || !record.entry) {
        return null;
      }
      const entry = record.entry;
      const info = {
        path: normalized,
        exists: true,
        isDirectory: entry.kind === "directory",
        size: entry.kind === "file" ? (entry.size >>> 0) : 0,
        mtimeMs: entry.mtimeMs >>> 0
      };
      if ((kind || "stat") === "list") {
        const entries = [];
        if (entry.kind === "directory") {
          for (const child of entry.children.values()) {
            entries.push({
              name: child.name,
              isDirectory: child.kind === "directory",
              size: child.kind === "file" ? (child.size >>> 0) : 0,
              mtimeMs: child.mtimeMs >>> 0
            });
          }
        }
        info.entries = entries;
      }
      return info;
    }

    mutationProvider(op, kpath, options) {
      switch (op) {
        case "create-file":
          return this.createOrRewriteFile(kpath, options);
        case "write-file":
          return this.writeExistingFile(kpath, options);
        case "set-end":
          return this.setEndOfFile(kpath, options);
        case "delete":
          return this.deletePath(kpath);
        case "create-folder":
          return this.createFolder(kpath);
        case "move":
          return this.renameOrMovePath(kpath, options);
        default:
          return { errorCode: 2, written: 0 };
      }
    }

    createOrRewriteFile(kpath, options) {
      const tempPath = parseTempDiskVolumePath(kpath);
      if (tempPath) {
        const volumeRoot = ensureVirtualDiskVolume(this.virtualDisks, tempPath.diskName, tempPath.volumeName);
        const tempAccessors = createRootAccessors(volumeRoot);
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
      const parent = this.resolveParentRecord(kpath);
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
      const fileSegments = parent.parentSegments.concat([entry.name]);
      const bytes = cloneBytes(entry.data);
      this.queueFlush(`write ${fileSegments.join("/")}`, async () => {
        await this.flushWriteFile(fileSegments, bytes);
      });
      return { errorCode: 0, written: entry.size >>> 0 };
    }

    writeExistingFile(kpath, options) {
      const tempPath = parseTempDiskVolumePath(kpath);
      if (tempPath) {
        const volumeRoot = ensureVirtualDiskVolume(this.virtualDisks, tempPath.diskName, tempPath.volumeName);
        const tempAccessors = createRootAccessors(volumeRoot);
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
      const record = this.resolveEntryRecord(kpath);
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
      const fileSegments = record.segments.slice();
      const bytes = cloneBytes(next);
      this.queueFlush(`write ${fileSegments.join("/")}`, async () => {
        await this.flushWriteFile(fileSegments, bytes);
      });
      return { errorCode: 0, written: patch.length >>> 0 };
    }

    setEndOfFile(kpath, options) {
      const tempPath = parseTempDiskVolumePath(kpath);
      if (tempPath) {
        const volumeRoot = ensureVirtualDiskVolume(this.virtualDisks, tempPath.diskName, tempPath.volumeName);
        const tempAccessors = createRootAccessors(volumeRoot);
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
      const record = this.resolveEntryRecord(kpath);
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
      const fileSegments = record.segments.slice();
      const bytes = cloneBytes(next);
      this.queueFlush(`truncate ${fileSegments.join("/")}`, async () => {
        await this.flushWriteFile(fileSegments, bytes);
      });
      return { errorCode: 0, written: 0 };
    }

    deletePath(kpath) {
      const tempPath = parseTempDiskVolumePath(kpath);
      if (tempPath) {
        const volumeRoot = ensureVirtualDiskVolume(this.virtualDisks, tempPath.diskName, tempPath.volumeName);
        const tempAccessors = createRootAccessors(volumeRoot);
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
      const record = this.resolveEntryRecord(kpath);
      if (!record || !record.entry || !record.parent) {
        return { errorCode: 5, written: 0 };
      }
      if (record.entry.kind === "directory" && record.entry.children.size) {
        return { errorCode: 10, written: 0 };
      }
      const parentSegments = record.parentSegments.slice();
      const name = record.entry.name;
      record.parent.children.delete(name.toLowerCase());
      this.queueFlush(`delete ${record.segments.join("/")}`, async () => {
        await this.flushDeleteEntry(parentSegments, name);
      });
      return { errorCode: 0, written: 0 };
    }

    createFolder(kpath) {
      const tempPath = parseTempDiskVolumePath(kpath);
      if (tempPath) {
        const volumeRoot = ensureVirtualDiskVolume(this.virtualDisks, tempPath.diskName, tempPath.volumeName);
        const tempAccessors = createRootAccessors(volumeRoot);
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
      const parent = this.resolveParentRecord(kpath);
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
      const dirSegments = parent.parentSegments.concat([entry.name]);
      this.queueFlush(`mkdir ${dirSegments.join("/")}`, async () => {
        await this.ensureDirectoryHandle(dirSegments, true);
      });
      return { errorCode: 0, written: 0 };
    }

    renameOrMovePath(kpath, options) {
      const tempPath = parseTempDiskVolumePath(kpath);
      if (tempPath) {
        const nextTempPath = parseTempDiskVolumePath(options && options.nextPath ? options.nextPath : "");
        if (
          !nextTempPath ||
          nextTempPath.diskName !== tempPath.diskName ||
          String(nextTempPath.volumeName) !== String(tempPath.volumeName)
        ) {
          return { errorCode: 10, written: 0 };
        }
        const volumeRoot = ensureVirtualDiskVolume(this.virtualDisks, tempPath.diskName, tempPath.volumeName);
        const tempAccessors = createRootAccessors(volumeRoot);
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
      const source = this.resolveEntryRecord(kpath);
      const nextPath = options && options.nextPath ? String(options.nextPath) : "";
      const target = this.resolveParentRecord(nextPath);
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

      const sourceParentSegments = source.parentSegments.slice();
      const sourceName = source.segments.length ? source.segments[source.segments.length - 1] : source.entry.name;
      const targetParentSegments = target.parentSegments.slice();
      const snapshot = snapshotEntryTree(source.entry);
      this.queueFlush(`move ${sourceName}`, async () => {
        await this.flushWriteEntryTree(targetParentSegments, snapshot);
        await this.flushDeleteEntry(sourceParentSegments, sourceName, source.entry.kind === "directory");
      });
      return { errorCode: 0, written: 0 };
    }

    async ensureDirectoryHandle(segments, create) {
      let handle = this.rootHandle;
      for (let i = 0; i < segments.length; i += 1) {
        handle = await handle.getDirectoryHandle(segments[i], { create: !!create });
      }
      return handle;
    }

    async flushWriteFile(segments, data) {
      const parts = Array.isArray(segments) ? segments.slice() : [];
      const fileName = parts.pop();
      if (!fileName) {
        throw new Error("Invalid file path.");
      }
      const parentHandle = await this.ensureDirectoryHandle(parts, true);
      const fileHandle = await parentHandle.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      try {
        await writable.write(cloneBytes(data));
      } finally {
        await writable.close();
      }
    }

    async flushDeleteEntry(parentSegments, name, recursive) {
      const parentHandle = await this.ensureDirectoryHandle(parentSegments || [], false);
      await parentHandle.removeEntry(name, { recursive: !!recursive });
    }

    async flushWriteEntryTree(parentSegments, snapshot) {
      if (!snapshot) {
        return;
      }
      const parentHandle = await this.ensureDirectoryHandle(parentSegments || [], true);
      if (snapshot.kind === "file") {
        const fileHandle = await parentHandle.getFileHandle(snapshot.name, { create: true });
        const writable = await fileHandle.createWritable();
        try {
          await writable.write(cloneBytes(snapshot.data));
        } finally {
          await writable.close();
        }
        return;
      }
      const dirHandle = await parentHandle.getDirectoryHandle(snapshot.name, { create: true });
      const children = Array.isArray(snapshot.children) ? snapshot.children : [];
      for (let i = 0; i < children.length; i += 1) {
        const child = children[i];
        await this.flushWriteEntryTree((parentSegments || []).concat([snapshot.name]), child);
      }
      return dirHandle;
    }
  }

  KosEmu.ui.browserFs = {
    BrowserFsRoot,
    normalizeKosInput,
    mapKosPathSegments
  };
})();

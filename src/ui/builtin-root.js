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

  function createReadOnlyRoot(manifest) {
    const source = manifest && Array.isArray(manifest.files) ? manifest.files : [];
    const rootEntry = makeDirEntry("");
    let fileCount = 0;
    let totalBytes = 0;

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
      fileCount += 1;
      totalBytes += fileEntry.size >>> 0;
    }

    function resolveEntryRecord(kpath) {
      const requestedSegments = mapKosPathSegments(kpath);
      let entry = rootEntry;
      for (let i = 0; i < requestedSegments.length; i += 1) {
        if (!entry || entry.kind !== "directory") {
          return null;
        }
        entry = entry.children.get(requestedSegments[i].toLowerCase()) || null;
        if (!entry) {
          return null;
        }
      }
      return entry;
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

    const rootLabel = manifest && manifest.label ? String(manifest.label) : "builtin-kolibri-root";

    return {
      label: rootLabel,
      permission: "granted",
      summaryText() {
        return `${rootLabel} | ${fileCount} files | bundled`;
      },
      flushPending() {
        return Promise.resolve();
      },
      fileProvider(kpath) {
        const entry = resolveEntryRecord(kpath);
        const bytes = getBytes(entry);
        return bytes ? bytes.slice() : null;
      },
      fileInfoProvider(kpath, kind) {
        const normalized = normalizeKosInput(kpath) || "/";
        const entry = resolveEntryRecord(normalized);
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
      fileCount: fileCount >>> 0,
      totalBytes: totalBytes >>> 0
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
    const root = createReadOnlyRoot(manifest);
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
    bootBundledDesktopPage
  };
})();

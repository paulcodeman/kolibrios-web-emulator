const path = require("path");
const { test, expect } = require("playwright/test");

const LAUNCHER_URL = `file:///${path.resolve(__dirname, "..", "launcher.html").replace(/\\/g, "/")}`;

test("bundled launcher page boots desktop", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
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

    function makeDirNode(name) {
      return {
        kind: "directory",
        name,
        children: new Map()
      };
    }

    function makeFileNode(name, text) {
      return {
        kind: "file",
        name,
        bytes: new TextEncoder().encode(String(text || "")),
        lastModified: Date.now()
      };
    }

    function getNodeKey(name) {
      return String(name || "").toLowerCase();
    }

    class FakeFileHandle {
      constructor(node) {
        this.kind = "file";
        this.name = node.name;
        this.node = node;
      }

      async getFile() {
        const bytes = cloneBytes(this.node.bytes);
        return {
          lastModified: this.node.lastModified >>> 0,
          async arrayBuffer() {
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          }
        };
      }

      async createWritable() {
        return {
          write: async (data) => {
            this.node.bytes = cloneBytes(data);
            this.node.lastModified = Date.now();
          },
          close: async () => {}
        };
      }
    }

    class FakeDirectoryHandle {
      constructor(node) {
        this.kind = "directory";
        this.name = node.name;
        this.node = node;
      }

      async queryPermission() {
        return "granted";
      }

      async requestPermission() {
        return "granted";
      }

      async *values() {
        const children = Array.from(this.node.children.values()).sort((a, b) => String(a.name).localeCompare(String(b.name)));
        for (let i = 0; i < children.length; i += 1) {
          const child = children[i];
          yield child.kind === "directory" ? new FakeDirectoryHandle(child) : new FakeFileHandle(child);
        }
      }

      async getDirectoryHandle(name, options) {
        const key = getNodeKey(name);
        let child = this.node.children.get(key) || null;
        if (!child) {
          if (!options || !options.create) {
            throw new Error(`Missing directory: ${name}`);
          }
          child = makeDirNode(String(name || ""));
          this.node.children.set(key, child);
        }
        if (!child || child.kind !== "directory") {
          throw new Error(`Not a directory: ${name}`);
        }
        return new FakeDirectoryHandle(child);
      }

      async getFileHandle(name, options) {
        const key = getNodeKey(name);
        let child = this.node.children.get(key) || null;
        if (!child) {
          if (!options || !options.create) {
            throw new Error(`Missing file: ${name}`);
          }
          child = makeFileNode(String(name || ""), "");
          this.node.children.set(key, child);
        }
        if (!child || child.kind !== "file") {
          throw new Error(`Not a file: ${name}`);
        }
        return new FakeFileHandle(child);
      }

      async removeEntry(name, options) {
        const key = getNodeKey(name);
        const child = this.node.children.get(key) || null;
        if (!child) {
          throw new Error(`Missing entry: ${name}`);
        }
        if (child.kind === "directory" && child.children.size && !(options && options.recursive)) {
          throw new Error(`Directory is not empty: ${name}`);
        }
        this.node.children.delete(key);
      }
    }

    const mountRoot = makeDirNode("playwright-mounted-hd");
    const docs = makeDirNode("docs");
    docs.children.set(getNodeKey("readme.txt"), makeFileNode("readme.txt", "mounted-doc\n"));
    mountRoot.children.set(getNodeKey("docs"), docs);
    mountRoot.children.set(getNodeKey("note.txt"), makeFileNode("note.txt", "mounted-root\n"));

    window.__fakeMountedRootNode = mountRoot;
    window.__showDirectoryPickerCalls = 0;
    window.showDirectoryPicker = async () => {
      window.__showDirectoryPickerCalls = ((window.__showDirectoryPickerCalls | 0) + 1) | 0;
      return new FakeDirectoryHandle(mountRoot);
    };
  });

  await page.goto(LAUNCHER_URL);
  await page.waitForFunction(() => !!window.__app && !!window.__app.sessionManager);
  await page.waitForFunction(() => {
    const app = window.__app;
    const session = app && app.sessionManager ? app.sessionManager : null;
    return !!(
      app &&
      app.browserFsRoot &&
      session &&
      Array.isArray(session.processes) &&
      session.processes.some((process) => {
        const pathText = String(process && (process.displayPath || process.processPath || ""));
        return pathText.toUpperCase() === "/SYS/@TASKBAR";
      })
    );
  }, null, { timeout: 20000 });

  const state = await page.evaluate(() => {
    const app = window.__app;
    const session = app && app.sessionManager ? app.sessionManager : null;
    const workspace = document.getElementById("workspace");
    const rootInfo = app && app.browserFsRoot && typeof app.browserFsRoot.fileInfoProvider === "function"
      ? app.browserFsRoot.fileInfoProvider("/", "list")
      : null;
    const rootEntries = rootInfo && Array.isArray(rootInfo.entries)
      ? rootInfo.entries.map((entry) => String(entry && entry.name ? entry.name : "").toLowerCase())
      : [];
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      rootSummary: app && app.browserFsRoot ? String(app.browserFsRoot.summaryText()) : "",
      rootEntries,
      mountButtonText: String(document.getElementById("mountFolderBtn") ? document.getElementById("mountFolderBtn").textContent || "" : ""),
      processCount: session && Array.isArray(session.processes) ? session.processes.length : 0,
      hasTaskbar: !!(
        session &&
        Array.isArray(session.processes) &&
        session.processes.some((process) => {
          const pathText = String(process && (process.displayPath || process.processPath || ""));
          return pathText.toUpperCase() === "/SYS/@TASKBAR";
        })
      ),
      workspaceWidth: workspace ? workspace.clientWidth : 0,
      workspaceHeight: workspace ? workspace.clientHeight : 0
    };
  });

  expect(state.backgroundColor).toBe("rgb(0, 0, 0)");
  expect(state.rootSummary).toContain("bundled");
  expect(state.rootEntries).toContain("rd");
  expect(state.rootEntries).toContain("tmp0");
  expect(state.rootEntries).not.toContain("sys");
  expect(state.mountButtonText).toBe("Mount Folder");
  expect(state.hasTaskbar).toBe(true);
  expect(state.processCount).toBeGreaterThan(0);
  expect(state.workspaceWidth).toBeGreaterThanOrEqual(state.innerWidth - 2);
  expect(state.workspaceHeight).toBeGreaterThanOrEqual(state.innerHeight - 2);

  const tmpDiskState = await page.evaluate(() => {
    const app = window.__app;
    if (!app || !app.browserFsRoot) {
      return null;
    }
    const root = app.browserFsRoot;
    const bytes = new Uint8Array([0x6f, 0x6b, 0x0a]);
    const folder = root.mutationProvider("create-folder", "/tmp0/1/playwright-cache", {});
    const file = root.mutationProvider("create-file", "/tmp0/1/playwright-cache/test.txt", { data: bytes });
    const info = root.fileInfoProvider("/tmp0/1/playwright-cache", "list");
    const readBack = root.fileProvider("/tmp0/1/playwright-cache/test.txt");
    return {
      folderCode: folder ? (folder.errorCode >>> 0) : 0xffffffff,
      fileCode: file ? (file.errorCode >>> 0) : 0xffffffff,
      fileWritten: file ? (file.written >>> 0) : 0,
      entries: info && Array.isArray(info.entries) ? info.entries.map((entry) => String(entry && entry.name ? entry.name : "")) : [],
      text: readBack instanceof Uint8Array ? Array.from(readBack).map((value) => String.fromCharCode(value & 0xff)).join("") : ""
    };
  });

  expect(tmpDiskState).not.toBeNull();
  expect(tmpDiskState.folderCode).toBe(0);
  expect(tmpDiskState.fileCode).toBe(0);
  expect(tmpDiskState.fileWritten).toBe(3);
  expect(tmpDiskState.entries).toContain("test.txt");
  expect(tmpDiskState.text).toBe("ok\n");

  await page.evaluate(() => {
    const button = document.getElementById("mountFolderBtn");
    if (!button) {
      throw new Error("Missing mount button.");
    }
    button.click();
  });
  await page.waitForFunction(() => {
    const app = window.__app;
    const rootInfo = app && app.browserFsRoot && typeof app.browserFsRoot.fileInfoProvider === "function"
      ? app.browserFsRoot.fileInfoProvider("/", "list")
      : null;
    const entries = rootInfo && Array.isArray(rootInfo.entries) ? rootInfo.entries : [];
    return entries.some((entry) => String(entry && entry.name ? entry.name : "").toLowerCase() === "hd0");
  });

  const mountedHdState = await page.evaluate(() => {
    const app = window.__app;
    const root = app && app.browserFsRoot ? app.browserFsRoot : null;
    if (!root) {
      return null;
    }
    const decoder = new TextDecoder();
    const decodeBytes = (bytes) => bytes instanceof Uint8Array ? decoder.decode(bytes) : "";
    const snapshotNode = (node) => {
      if (!node || typeof node !== "object") {
        return null;
      }
      if (node.kind === "file") {
        return {
          kind: "file",
          name: String(node.name || ""),
          text: decodeBytes(node.bytes)
        };
      }
      const children = node.children instanceof Map ? Array.from(node.children.values()) : [];
      children.sort((a, b) => String(a && a.name ? a.name : "").localeCompare(String(b && b.name ? b.name : "")));
      return {
        kind: "directory",
        name: String(node.name || ""),
        children: children.map((child) => snapshotNode(child))
      };
    };
    const findChild = (node, name) => {
      if (!node || !Array.isArray(node.children)) {
        return null;
      }
      const key = String(name || "").toLowerCase();
      return node.children.find((child) => String(child && child.name ? child.name : "").toLowerCase() === key) || null;
    };
    const rootInfo = root.fileInfoProvider("/", "list");
    const hdInfo = root.fileInfoProvider("/hd0", "list");
    const volumeInfo = root.fileInfoProvider("/hd0/1", "list");
    const readBack = root.fileProvider("/hd0/1/note.txt");
    const folder = root.mutationProvider("create-folder", "/hd0/1/cache", {});
    const file = root.mutationProvider("create-file", "/hd0/1/cache/test.txt", { data: new Uint8Array([0x68, 0x64, 0x0a]) });
    const write = root.mutationProvider("write-file", "/hd0/1/cache/test.txt", { offset: 3, data: new Uint8Array([0x6f, 0x6b, 0x0a]) });
    const truncate = root.mutationProvider("set-end", "/hd0/1/cache/test.txt", { size: 2 });
    const move = root.mutationProvider("move", "/hd0/1/cache/test.txt", { nextPath: "/hd0/1/cache/final.txt" });
    const createEmpty = root.mutationProvider("create-folder", "/hd0/1/cache/empty", {});
    const deleteEmpty = root.mutationProvider("delete", "/hd0/1/cache/empty");
    const deleteNote = root.mutationProvider("delete", "/hd0/1/note.txt");
    return Promise.resolve(typeof root.flushPending === "function" ? root.flushPending() : null).then(() => {
      const cacheInfo = root.fileInfoProvider("/hd0/1/cache", "list");
      const written = root.fileProvider("/hd0/1/cache/final.txt");
      const deletedNote = root.fileProvider("/hd0/1/note.txt");
      const mountedTree = snapshotNode(window.__fakeMountedRootNode);
      const cacheNode = findChild(mountedTree, "cache");
      const finalNode = findChild(cacheNode, "final.txt");
      return {
        pickerCalls: window.__showDirectoryPickerCalls | 0,
        summary: String(root.summaryText()),
        rootEntries: rootInfo && Array.isArray(rootInfo.entries) ? rootInfo.entries.map((entry) => String(entry && entry.name ? entry.name : "").toLowerCase()) : [],
        hdEntries: hdInfo && Array.isArray(hdInfo.entries) ? hdInfo.entries.map((entry) => String(entry && entry.name ? entry.name : "")) : [],
        volumeEntries: volumeInfo && Array.isArray(volumeInfo.entries) ? volumeInfo.entries.map((entry) => String(entry && entry.name ? entry.name : "").toLowerCase()) : [],
        noteText: decodeBytes(readBack),
        folderCode: folder ? (folder.errorCode >>> 0) : 0xffffffff,
        fileCode: file ? (file.errorCode >>> 0) : 0xffffffff,
        writeCode: write ? (write.errorCode >>> 0) : 0xffffffff,
        truncateCode: truncate ? (truncate.errorCode >>> 0) : 0xffffffff,
        moveCode: move ? (move.errorCode >>> 0) : 0xffffffff,
        createEmptyCode: createEmpty ? (createEmpty.errorCode >>> 0) : 0xffffffff,
        deleteEmptyCode: deleteEmpty ? (deleteEmpty.errorCode >>> 0) : 0xffffffff,
        deleteNoteCode: deleteNote ? (deleteNote.errorCode >>> 0) : 0xffffffff,
        cacheEntries: cacheInfo && Array.isArray(cacheInfo.entries) ? cacheInfo.entries.map((entry) => String(entry && entry.name ? entry.name : "").toLowerCase()) : [],
        writtenText: decodeBytes(written),
        deletedNoteText: decodeBytes(deletedNote),
        mountedTree,
        finalNodeText: finalNode ? String(finalNode.text || "") : ""
      };
    });
  });

  expect(mountedHdState).not.toBeNull();
  expect(mountedHdState.pickerCalls).toBe(1);
  expect(mountedHdState.summary).toContain("+1 hd mount");
  expect(mountedHdState.rootEntries).toContain("hd0");
  expect(mountedHdState.hdEntries).toEqual(["1"]);
  expect(mountedHdState.volumeEntries).toContain("docs");
  expect(mountedHdState.volumeEntries).toContain("note.txt");
  expect(mountedHdState.noteText).toBe("mounted-root\n");
  expect(mountedHdState.folderCode).toBe(0);
  expect(mountedHdState.fileCode).toBe(0);
  expect(mountedHdState.writeCode).toBe(0);
  expect(mountedHdState.truncateCode).toBe(0);
  expect(mountedHdState.moveCode).toBe(0);
  expect(mountedHdState.createEmptyCode).toBe(0);
  expect(mountedHdState.deleteEmptyCode).toBe(0);
  expect(mountedHdState.deleteNoteCode).toBe(0);
  expect(mountedHdState.cacheEntries).toContain("final.txt");
  expect(mountedHdState.cacheEntries).not.toContain("test.txt");
  expect(mountedHdState.cacheEntries).not.toContain("empty");
  expect(mountedHdState.writtenText).toBe("hd");
  expect(mountedHdState.deletedNoteText).toBe("");
  expect(mountedHdState.finalNodeText).toBe("hd");

  const refreshedHdState = await page.evaluate(async () => {
    const app = window.__app;
    const root = app && app.browserFsRoot ? app.browserFsRoot : null;
    if (!root || typeof root.fileInfoProviderAsync !== "function" || typeof root.refreshMountedDisks !== "function") {
      return null;
    }
    const encoder = new TextEncoder();
    window.__fakeMountedRootNode.children.set("external.txt", {
      kind: "file",
      name: "external.txt",
      bytes: encoder.encode("host-side\n"),
      lastModified: Date.now()
    });
    const beforeInfo = root.fileInfoProvider("/hd0/1", "list");
    await root.refreshMountedDisks({ force: true });
    const afterInfo = await root.fileInfoProviderAsync("/hd0/1", "list");
    return {
      beforeEntries: beforeInfo && Array.isArray(beforeInfo.entries)
        ? beforeInfo.entries.map((entry) => String(entry && entry.name ? entry.name : "").toLowerCase())
        : [],
      afterEntries: afterInfo && Array.isArray(afterInfo.entries)
        ? afterInfo.entries.map((entry) => String(entry && entry.name ? entry.name : "").toLowerCase())
        : []
    };
  });

  expect(refreshedHdState).not.toBeNull();
  expect(refreshedHdState.beforeEntries).not.toContain("external.txt");
  expect(refreshedHdState.afterEntries).toContain("external.txt");

  await page.evaluate(() => {
    const app = window.__app;
    app.launcherOverlayHoldMs = 120;
    app.launcherOverlayVisibleMs = 650;
    app.launcherOverlayEdgeRevealPx = 24;
  });
  await page.waitForTimeout(120);
  await page.waitForFunction(() => {
    const toolbar = document.querySelector(".launcher-toolbar");
    return !!toolbar && Number(getComputedStyle(toolbar).opacity) < 0.1;
  });

  await page.mouse.move(160, 2);
  await page.waitForFunction(() => {
    const toolbar = document.querySelector(".launcher-toolbar");
    return !!toolbar && Number(getComputedStyle(toolbar).opacity) > 0.9;
  });
  await page.waitForFunction(() => {
    const toolbar = document.querySelector(".launcher-toolbar");
    return !!toolbar && Number(getComputedStyle(toolbar).opacity) < 0.1;
  }, null, { timeout: 2500 });

  await page.evaluate(() => {
    const app = window.__app;
    const workspace = document.getElementById("workspace");
    if (!app || !workspace) {
      throw new Error("Missing launcher workspace.");
    }
    app.handleLauncherOverlayPointerDown({
      isPrimary: true,
      pointerType: "touch",
      button: 0,
      pointerId: 77,
      clientX: 240,
      clientY: 180,
      target: workspace
    });
  });
  await page.waitForTimeout(220);
  const touchOverlayState = await page.evaluate(() => {
    const toolbar = document.querySelector(".launcher-toolbar");
    const visible = !!toolbar && Number(getComputedStyle(toolbar).opacity) > 0.9;
    const app = window.__app;
    return {
      visible,
      pointerActive: !!(app && app.launcherOverlayPointerActive)
    };
  });
  expect(touchOverlayState.visible).toBe(false);
  expect(touchOverlayState.pointerActive).toBe(false);

  await page.evaluate(() => {
    const app = window.__app;
    app.launcherOverlayHoldMs = 120;
    app.launcherOverlayVisibleMs = 3000;
  });
  await page.evaluate(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    if (!session) {
      throw new Error("Missing session manager.");
    }
    const original = session.handleViewportResize.bind(session);
    session.__fullscreenResizeCount = 0;
    session.handleViewportResize = function patchedHandleViewportResize(...args) {
      session.__fullscreenResizeCount = ((session.__fullscreenResizeCount | 0) + 1) | 0;
      return original(...args);
    };
  });

  await page.mouse.move(360, 260);
  await page.mouse.down();
  await page.waitForTimeout(180);
  await page.mouse.up();
  await page.waitForFunction(() => {
    const toolbar = document.querySelector(".launcher-toolbar");
    return !!toolbar && Number(getComputedStyle(toolbar).opacity) > 0.9;
  });

  await page.evaluate(() => {
    const button = document.getElementById("fullscreenBtn");
    if (!button) {
      throw new Error("Missing fullscreen button.");
    }
    button.click();
  });
  await page.waitForFunction(() => {
    const workspace = document.getElementById("workspace");
    return !!workspace && document.fullscreenElement === workspace;
  });
  await page.waitForFunction(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    return !!session && (session.__fullscreenResizeCount | 0) >= 1;
  });

  await page.evaluate(async () => {
    if (document.fullscreenElement && typeof document.exitFullscreen === "function") {
      await document.exitFullscreen();
    }
  });
  await page.waitForFunction(() => document.fullscreenElement === null);
  await page.waitForFunction(() => {
    const session = window.__app && window.__app.sessionManager ? window.__app.sessionManager : null;
    return !!session && (session.__fullscreenResizeCount | 0) >= 2;
  });

  await page.screenshot({
    path: testInfo.outputPath("launcher-page.png"),
    fullPage: true
  });
});

test("launcher rejects read-only hd mount", async ({ page }) => {
  await page.addInitScript(() => {
    function makeDirNode(name) {
      return {
        kind: "directory",
        name,
        children: new Map()
      };
    }

    function makeFileNode(name) {
      return {
        kind: "file",
        name,
        bytes: new Uint8Array(0),
        lastModified: Date.now()
      };
    }

    function getNodeKey(name) {
      return String(name || "").toLowerCase();
    }

    class FakeReadOnlyFileHandle {
      constructor(node) {
        this.kind = "file";
        this.name = node.name;
        this.node = node;
      }

      async getFile() {
        const bytes = this.node.bytes.slice();
        return {
          lastModified: this.node.lastModified >>> 0,
          async arrayBuffer() {
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          }
        };
      }

      async createWritable() {
        throw new DOMException("Access denied.", "NotAllowedError");
      }
    }

    class FakeReadOnlyDirectoryHandle {
      constructor(node) {
        this.kind = "directory";
        this.name = node.name;
        this.node = node;
      }

      async queryPermission() {
        return "granted";
      }

      async requestPermission() {
        return "granted";
      }

      async *values() {
        const children = Array.from(this.node.children.values()).sort((a, b) => String(a.name).localeCompare(String(b.name)));
        for (let i = 0; i < children.length; i += 1) {
          const child = children[i];
          if (child.kind === "directory") {
            yield new FakeReadOnlyDirectoryHandle(child);
          } else {
            yield new FakeReadOnlyFileHandle(child);
          }
        }
      }

      async getDirectoryHandle(name, options) {
        const key = getNodeKey(name);
        let child = this.node.children.get(key) || null;
        if (!child) {
          if (!options || !options.create) {
            throw new Error(`Missing directory: ${name}`);
          }
          child = makeDirNode(String(name || ""));
          this.node.children.set(key, child);
        }
        if (!child || child.kind !== "directory") {
          throw new Error(`Not a directory: ${name}`);
        }
        return new FakeReadOnlyDirectoryHandle(child);
      }

      async getFileHandle(name, options) {
        const key = getNodeKey(name);
        let child = this.node.children.get(key) || null;
        if (!child) {
          if (!options || !options.create) {
            throw new Error(`Missing file: ${name}`);
          }
          child = makeFileNode(String(name || ""));
          this.node.children.set(key, child);
        }
        if (!child || child.kind !== "file") {
          throw new Error(`Not a file: ${name}`);
        }
        return new FakeReadOnlyFileHandle(child);
      }

      async removeEntry(name) {
        this.node.children.delete(getNodeKey(name));
      }
    }

    const mountRoot = makeDirNode("readonly-mounted-hd");
    window.showDirectoryPicker = async () => new FakeReadOnlyDirectoryHandle(mountRoot);
  });

  await page.goto(LAUNCHER_URL);
  await page.waitForFunction(() => !!window.__app && !!window.__app.sessionManager);
  await page.waitForFunction(() => {
    const app = window.__app;
    const session = app && app.sessionManager ? app.sessionManager : null;
    return !!(
      app &&
      app.browserFsRoot &&
      session &&
      Array.isArray(session.processes) &&
      session.processes.some((process) => {
        const pathText = String(process && (process.displayPath || process.processPath || ""));
        return pathText.toUpperCase() === "/SYS/@TASKBAR";
      })
    );
  }, null, { timeout: 20000 });

  await page.evaluate(() => {
    const button = document.getElementById("mountFolderBtn");
    if (!button) {
      throw new Error("Missing mount button.");
    }
    button.click();
  });

  await page.waitForFunction(() => {
    const log = document.getElementById("log");
    return !!log && String(log.textContent || "").includes("Folder mount failed: Mounted folder is readable, but write access failed:");
  });

  const state = await page.evaluate(() => {
    const app = window.__app;
    const rootInfo = app && app.browserFsRoot && typeof app.browserFsRoot.fileInfoProvider === "function"
      ? app.browserFsRoot.fileInfoProvider("/", "list")
      : null;
    const entries = rootInfo && Array.isArray(rootInfo.entries)
      ? rootInfo.entries.map((entry) => String(entry && entry.name ? entry.name : "").toLowerCase())
      : [];
    const log = document.getElementById("log");
    return {
      rootEntries: entries,
      logText: log ? String(log.textContent || "") : ""
    };
  });

  expect(state.rootEntries).not.toContain("hd0");
  expect(state.logText).toContain("Folder mount failed: Mounted folder is readable, but write access failed:");
  expect(state.logText).toContain("Access denied.");
});

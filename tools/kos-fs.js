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

  function resolveHostPathForMutation(kpath) {
    const kosPath = normalizeKosInput(kpath);
    const candidates = buildHostCandidates(resolvedRoot, cwd, kosPath);
    return {
      kosPath,
      hostPath: candidates.length ? candidates[0] : ""
    };
  }

  function fileProvider(kpath) {
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

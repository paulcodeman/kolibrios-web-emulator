(() => {
  const KosEmu = globalThis.KosEmu;
  const emu = KosEmu && KosEmu.emu ? KosEmu.emu : null;
  const DEFAULT_HOST_HTTP_BUFFER_SIZE = 512 * 1024;
  if (!emu || typeof emu.registerHostDllModule !== "function") {
    return;
  }

  function pushAliasExports(items, names, argBytes, handler) {
    for (let i = 0; i < names.length; i += 1) {
      items.push({
        name: names[i],
        argBytes,
        handler
      });
    }
  }

  function readRequestArgs(host, argPtr) {
    const urlPtr = host.readMem32(argPtr) >>> 0;
    const flags = host.readMem32((argPtr + 8) >>> 0) >>> 0;
    const headerPtr = host.readMem32((argPtr + 12) >>> 0) >>> 0;
    return {
      url: urlPtr ? host.readCString(urlPtr, 4096) : "",
      flags: flags >>> 0,
      addHeader: headerPtr ? host.readCString(headerPtr, 4096) : ""
    };
  }

  function readPostArgs(host, argPtr) {
    const request = readRequestArgs(host, argPtr);
    const contentTypePtr = host.readMem32((argPtr + 16) >>> 0) >>> 0;
    const contentLength = host.readMem32((argPtr + 20) >>> 0) >>> 0;
    request.contentType = contentTypePtr ? host.readCString(contentTypePtr, 512) : "";
    request.contentLength = contentLength >>> 0;
    return request;
  }

  function createTransferHandler(method) {
    return function transferHandler(context) {
      const request = readRequestArgs(this, context.argPtr >>> 0);
      const transferPtr = this.createHostHttpTransfer(method, request.url, request.flags, request.addHeader, {});
      return { eax: transferPtr >>> 0 };
    };
  }

  function createPostHandler() {
    return function postHandler(context) {
      const request = readPostArgs(this, context.argPtr >>> 0);
      const transferPtr = this.createHostHttpTransfer("POST", request.url, request.flags, request.addHeader, {
        contentType: request.contentType,
        contentLength: request.contentLength
      });
      return { eax: transferPtr >>> 0 };
    };
  }

  function createTransferPtrHandler(methodName) {
    return function transferPtrHandler(context) {
      const transferPtr = this.readMem32(context.argPtr) >>> 0;
      return { eax: this[methodName](transferPtr >>> 0) >>> 0 };
    };
  }

  function createSendHandler() {
    return function sendHandler(context) {
      const transferPtr = this.readMem32(context.argPtr) >>> 0;
      const dataPtr = this.readMem32((context.argPtr + 4) >>> 0) >>> 0;
      const dataLength = this.readMem32((context.argPtr + 8) >>> 0) >>> 0;
      return {
        eax: this.sendHostHttpTransfer(transferPtr >>> 0, dataPtr >>> 0, dataLength >>> 0) >>> 0
      };
    };
  }

  function createFindHeaderFieldHandler() {
    return function findHeaderFieldHandler(context) {
      const transferPtr = this.readMem32(context.argPtr) >>> 0;
      const fieldPtr = this.readMem32((context.argPtr + 4) >>> 0) >>> 0;
      const fieldName = fieldPtr ? this.readCString(fieldPtr, 256) : "";
      return { eax: this.findHostHttpHeaderField(transferPtr >>> 0, fieldName) >>> 0 };
    };
  }

  function createUriTransformHandler(mode) {
    return function uriTransformHandler(context) {
      const valuePtr = this.readMem32(context.argPtr) >>> 0;
      const valueLength = this.readMem32((context.argPtr + 4) >>> 0) >>> 0;
      const maxLen = Math.max(1, Math.min(65535, valueLength || 65535));
      const value = valuePtr ? this.readCString(valuePtr, maxLen) : "";
      return {
        eax: this.allocateHeapCStringUtf8(this.transformHostHttpUri(value, mode)) >>> 0
      };
    };
  }

  function getHostHttpBufferSize(host) {
    const size = host && Number.isFinite(host.hostHttpBufferSize)
      ? host.hostHttpBufferSize
      : DEFAULT_HOST_HTTP_BUFFER_SIZE;
    return Math.max(4096, size | 0) >>> 0;
  }

  function createBufferSizeGetHandler() {
    return function bufferSizeGetHandler() {
      return { eax: getHostHttpBufferSize(this) >>> 0 };
    };
  }

  function createBufferSizeSetHandler() {
    return function bufferSizeSetHandler(context) {
      this.hostHttpBufferSize = this.readMem32(context.argPtr >>> 0) >>> 0;
      if (!this.hostHttpBufferSize) {
        this.hostHttpBufferSize = DEFAULT_HOST_HTTP_BUFFER_SIZE >>> 0;
      }
      return { eax: getHostHttpBufferSize(this) >>> 0 };
    };
  }

  function buildHttpHandlerDefinitions() {
    const handlers = [];
    pushAliasExports(handlers, ["get", "http_get"], 16, createTransferHandler("GET"));
    pushAliasExports(handlers, ["head", "http_head"], 16, createTransferHandler("HEAD"));
    pushAliasExports(handlers, ["post", "http_post"], 24, createPostHandler());
    pushAliasExports(handlers, ["send", "http_send"], 12, createSendHandler());
    pushAliasExports(handlers, ["receive", "http_receive", "process", "http_process"], 4, createTransferPtrHandler("receiveHostHttpTransfer"));
    pushAliasExports(handlers, ["disconnect", "http_disconnect", "stop", "http_stop"], 4, createTransferPtrHandler("disconnectHostHttpTransfer"));
    pushAliasExports(handlers, ["free", "http_free"], 4, createTransferPtrHandler("freeHostHttpTransfer"));
    pushAliasExports(handlers, ["find_header_field", "http_find_header_field"], 8, createFindHeaderFieldHandler());
    pushAliasExports(handlers, ["escape", "http_escape", "uri_escape"], 8, createUriTransformHandler("escape"));
    pushAliasExports(handlers, ["unescape", "http_unescape", "uri_unescape"], 8, createUriTransformHandler("unescape"));
    return handlers;
  }

  function buildFallbackHttpExports() {
    const exports = [
      {
        name: "lib_init",
        argBytes: 0,
        handler() {
          return { eax: 0 };
        }
      },
      {
        name: "http_lib_init",
        argBytes: 0,
        handler() {
          return { eax: 0 };
        }
      },
      {
        name: "version",
        value: 0x00010001
      },
      {
        name: "http_version",
        value: 0x00010001
      }
    ];
    pushAliasExports(exports, ["buffersize_get", "http_buffersize_get"], 0, createBufferSizeGetHandler());
    pushAliasExports(exports, ["buffersize_set", "http_buffersize_set"], 0, createBufferSizeSetHandler());
    const handlers = buildHttpHandlerDefinitions();
    for (let i = 0; i < handlers.length; i += 1) {
      exports.push(handlers[i]);
    }
    return exports;
  }

  emu.registerHostDllModule("http.obj", function createHttpHostDll(info) {
    const resolvedPath = info && info.resolvedPath ? info.resolvedPath : "/sys/lib/http.obj";
    const loaded = typeof this.loadCoffLibrary === "function" ? this.loadCoffLibrary(resolvedPath) : null;
    const forceHostOverride =
      !!this.forceHostHttpDll ||
      !!this.preferHostHttpDll ||
      !!(this.hostSession && this.hostSession.forceHostHttpDll);
    if (loaded && loaded.exportPtr) {
      if (forceHostOverride && typeof this.applyHostDllOverrideSet === "function") {
        this.applyHostDllOverrideSet(loaded, "http-host-lib", buildHttpHandlerDefinitions());
      }
      return { exportPtr: loaded.exportPtr >>> 0 };
    }
    return {
      cacheKey: resolvedPath,
      exports: buildFallbackHttpExports()
    };
  });
})();

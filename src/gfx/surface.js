(() => {
  const KosEmu = globalThis.KosEmu;
  const MAX_SURFACE_DIMENSION = 0x7fffffff;
  const MAX_WEBGL_SURFACES = 8;
  let activeWebGLSurfaceCount = 0;

  function packColor(color) {
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    return (255 << 24) | (b << 16) | (g << 8) | r;
  }

  function resolveSurfaceSize(width, height) {
    const w = Number(width);
    const h = Number(height);
    if (!Number.isFinite(w) || !Number.isFinite(h)) {
      throw new RangeError(`Invalid surface size ${width}x${height}.`);
    }

    const nextWidth = Math.floor(w);
    const nextHeight = Math.floor(h);
    if (nextWidth < 1 || nextHeight < 1) {
      throw new RangeError(`Surface size must be at least 1x1, got ${nextWidth}x${nextHeight}.`);
    }
    if (nextWidth > MAX_SURFACE_DIMENSION || nextHeight > MAX_SURFACE_DIMENSION) {
      throw new RangeError(`Surface size ${nextWidth}x${nextHeight} exceeds limits.`);
    }

    const pixels = nextWidth * nextHeight;
    if (!Number.isSafeInteger(pixels) || pixels < 1) {
      throw new RangeError(`Surface area overflow for ${nextWidth}x${nextHeight}.`);
    }

    return {
      width: nextWidth,
      height: nextHeight,
      pixels
    };
  }

  function allocatePixelBuffer(size) {
    try {
      const buffer32 = new Uint32Array(size.pixels);
      return {
        buffer32,
        buffer8: new Uint8Array(buffer32.buffer)
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new RangeError(`Surface allocation failed for ${size.width}x${size.height}: ${reason}`);
    }
  }

class WebGLSurface {
  static tryCreate(canvas, width, height) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      premultipliedAlpha: false,
      // Emulator windows are often static until the next Kolibri redraw event.
      // The browser may discard a WebGL back buffer between composites when
      // preserveDrawingBuffer is disabled, which shows up as black taskbars or
      // popup panels in launcher-driven UI.
      preserveDrawingBuffer: true
    });
    if (!gl) {
      return null;
    }
    return new WebGLSurface(canvas, gl, width, height);
  }

  constructor(canvas, gl, width, height) {
    this.canvas = canvas;
    this.gl = gl;
    this.contextLost = false;
    this.webglSlotOwned = false;
    this.boundContextLost = (event) => this.handleContextLost(event);
    this.program = this.createProgram();
    this.vao = this.createGeometry();
    this.texture = this.gl.createTexture();
    this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
    this.width = 1;
    this.height = 1;
    this.buffer32 = new Uint32Array(1);
    this.buffer8 = new Uint8Array(this.buffer32.buffer);
    this.resize(width, height);
    this.claimWebGLSlot();
    this.canvas.addEventListener("webglcontextlost", this.boundContextLost, false);
  }

  resize(width, height) {
    const size = resolveSurfaceSize(width, height);
    if (size.width === this.width && size.height === this.height) {
      return;
    }

    const nextBuffer = allocatePixelBuffer(size);
    const prevCanvasWidth = this.canvas.width;
    const prevCanvasHeight = this.canvas.height;
    this.canvas.width = size.width;
    this.canvas.height = size.height;

    const gl = this.gl;
    try {
      gl.viewport(0, 0, size.width, size.height);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        size.width,
        size.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    } catch (err) {
      this.canvas.width = prevCanvasWidth;
      this.canvas.height = prevCanvasHeight;
      throw err;
    }

    this.width = size.width;
    this.height = size.height;
    this.buffer32 = nextBuffer.buffer32;
    this.buffer8 = nextBuffer.buffer8;
  }

  claimWebGLSlot() {
    if (this.webglSlotOwned) {
      return;
    }
    this.webglSlotOwned = true;
    activeWebGLSurfaceCount += 1;
  }

  releaseWebGLSlot() {
    if (!this.webglSlotOwned) {
      return;
    }
    this.webglSlotOwned = false;
    if (activeWebGLSurfaceCount > 0) {
      activeWebGLSurfaceCount -= 1;
    }
  }

  handleContextLost(event) {
    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
    }
    this.contextLost = true;
    this.releaseWebGLSlot();
  }

  clear(color) {
    this.buffer32.fill(packColor(color));
  }

  setPixel(x, y, color) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return;
    }
    this.buffer32[y * this.width + x] = packColor(color);
  }

  present() {
    if (!this.gl || this.contextLost) {
      return;
    }
    const gl = this.gl;
    if (typeof gl.isContextLost === "function" && gl.isContextLost()) {
      this.contextLost = true;
      this.releaseWebGLSlot();
      return;
    }
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      this.width,
      this.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.buffer8
    );
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  verifyPresent() {
    const gl = this.gl;
    if (!gl || (this.width | 0) < 1 || (this.height | 0) < 1) {
      return false;
    }
    this.buffer32.fill(packColor(0x000000));
    this.present();
    const pixel = new Uint8Array(4);
    try {
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    } catch (err) {
      return false;
    }
    return pixel[0] === 0 && pixel[1] === 0 && pixel[2] === 0 && pixel[3] === 255;
  }

  destroy() {
    if (this.canvas && this.boundContextLost) {
      this.canvas.removeEventListener("webglcontextlost", this.boundContextLost, false);
    }
    const gl = this.gl;
    if (gl && !this.contextLost) {
      try {
        if (this.texture) {
          gl.deleteTexture(this.texture);
        }
        if (this.vao) {
          gl.deleteVertexArray(this.vao);
        }
        if (this.program) {
          gl.deleteProgram(this.program);
        }
        const loseContext = typeof gl.getExtension === "function"
          ? gl.getExtension("WEBGL_lose_context")
          : null;
        if (loseContext && typeof loseContext.loseContext === "function") {
          loseContext.loseContext();
        }
      } catch (err) {
        // Ignore WebGL teardown failures during process shutdown.
      }
    }
    this.contextLost = true;
    this.releaseWebGLSlot();
    this.gl = null;
    this.texture = null;
    this.vao = null;
    this.program = null;
  }

  createProgram() {
    const gl = this.gl;
    const vsSource = `#version 300 es
      in vec2 a_pos;
      in vec2 a_uv;
      out vec2 v_uv;
      void main() {
        v_uv = a_uv;
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }
    `;
    const fsSource = `#version 300 es
      precision highp float;
      uniform sampler2D u_tex;
      in vec2 v_uv;
      out vec4 outColor;
      void main() {
        outColor = texture(u_tex, v_uv);
      }
    `;

    const vs = this.compileShader(gl.VERTEX_SHADER, vsSource);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fsSource);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program) || "Program link failed";
      throw new Error(info);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    gl.useProgram(program);
    const texLoc = gl.getUniformLocation(program, "u_tex");
    if (texLoc) {
      gl.uniform1i(texLoc, 0);
    }

    return program;
  }

  compileShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader) || "Shader compile failed";
      gl.deleteShader(shader);
      throw new Error(info);
    }
    return shader;
  }

  createGeometry() {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);

    const data = new Float32Array([
      -1, -1, 0, 1,
      1, -1, 1, 1,
      -1, 1, 0, 0,
      1, 1, 1, 0
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

    const stride = 4 * 4;
    const posLoc = gl.getAttribLocation(this.program, "a_pos");
    const uvLoc = gl.getAttribLocation(this.program, "a_uv");

    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, stride, 0);

    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, stride, 2 * 4);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    return vao;
  }
}

class Canvas2DSurface {
  constructor(canvas, width, height) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      throw new Error("2D canvas context unavailable");
    }
    this.ctx = ctx;
    this.width = 1;
    this.height = 1;
    this.imageData = new ImageData(1, 1);
    this.buffer32 = new Uint32Array(this.imageData.data.buffer);
    this.resize(width, height);
  }

  resize(width, height) {
    const size = resolveSurfaceSize(width, height);
    if (size.width === this.width && size.height === this.height) {
      return;
    }

    let nextImageData;
    try {
      nextImageData = new ImageData(size.width, size.height);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new RangeError(`Canvas surface allocation failed for ${size.width}x${size.height}: ${reason}`);
    }

    this.canvas.width = size.width;
    this.canvas.height = size.height;
    this.width = size.width;
    this.height = size.height;
    this.imageData = nextImageData;
    this.buffer32 = new Uint32Array(this.imageData.data.buffer);
  }

  clear(color) {
    this.buffer32.fill(packColor(color));
  }

  setPixel(x, y, color) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return;
    }
    this.buffer32[y * this.width + x] = packColor(color);
  }

  present() {
    this.ctx.putImageData(this.imageData, 0, 0);
  }

  verifyPresent() {
    this.buffer32.fill(packColor(0x000000));
    this.present();
    const pixel = this.ctx.getImageData(0, 0, 1, 1).data;
    return pixel[0] === 0 && pixel[1] === 0 && pixel[2] === 0 && pixel[3] === 255;
  }

  destroy() {
    // no-op
  }
}

class HeadlessSurface {
  constructor(width, height) {
    this.width = 1;
    this.height = 1;
    this.buffer32 = new Uint32Array(1);
    this.buffer8 = new Uint8Array(this.buffer32.buffer);
    this.resize(width, height);
  }

  resize(width, height) {
    const size = resolveSurfaceSize(width, height);
    if (size.width === this.width && size.height === this.height) {
      return;
    }

    const nextBuffer = allocatePixelBuffer(size);
    this.width = size.width;
    this.height = size.height;
    this.buffer32 = nextBuffer.buffer32;
    this.buffer8 = nextBuffer.buffer8;
  }

  clear(color) {
    this.buffer32.fill(packColor(color));
  }

  setPixel(x, y, color) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return;
    }
    this.buffer32[y * this.width + x] = packColor(color);
  }

  present() {
    // no-op
  }

  destroy() {
    // no-op
  }
}

  function createSurface(canvas, width, height, log, options) {
    const opts = options || null;
    const preferCanvas2D = !!(opts && opts.preferCanvas2D);
    if (!preferCanvas2D) {
      if (activeWebGLSurfaceCount < MAX_WEBGL_SURFACES) {
        const webgl = WebGLSurface.tryCreate(canvas, width, height);
        if (webgl) {
          if (typeof webgl.verifyPresent === "function" && webgl.verifyPresent()) {
            log("WebGL2 surface enabled.");
            return webgl;
          }
          if (typeof webgl.destroy === "function") {
            webgl.destroy();
          }
          log("WebGL2 surface verification failed, using 2D canvas.");
        } else {
          log("WebGL2 unavailable, using 2D canvas.");
        }
      } else {
        log(`WebGL2 surface budget exhausted (${activeWebGLSurfaceCount}/${MAX_WEBGL_SURFACES}), using 2D canvas.`);
      }
    } else {
      log("WebGL2 disabled for this surface, using 2D canvas.");
    }
    const surface2d = new Canvas2DSurface(canvas, width, height);
    if (typeof surface2d.verifyPresent === "function" && !surface2d.verifyPresent()) {
      log("2D canvas surface verification failed.");
    }
    return surface2d;
  }

  function createHeadlessSurface(width, height) {
    const size = resolveSurfaceSize(width, height);
    return new HeadlessSurface(size.width, size.height);
  }

  KosEmu.gfx.surface = {
    createSurface,
    createHeadlessSurface
  };
})();

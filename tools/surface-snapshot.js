const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_PNG_DIMENSION = 0x7fffffff;

let crcTable = null;

function getCrcTable() {
  if (crcTable) {
    return crcTable;
  }
  crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i >>> 0;
    for (let bit = 0; bit < 8; bit += 1) {
      c = (c & 1) ? ((0xedb88320 ^ (c >>> 1)) >>> 0) : (c >>> 1);
    }
    crcTable[i] = c >>> 0;
  }
  return crcTable;
}

function crc32(buffers) {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < buffers.length; i += 1) {
    const buffer = buffers[i];
    for (let j = 0; j < buffer.length; j += 1) {
      crc = table[(crc ^ buffer[j]) & 0xff] ^ (crc >>> 8);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length >>> 0, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32([typeBuffer, payload]), 0);
  return Buffer.concat([length, typeBuffer, payload, crcBuffer]);
}

function toPositiveInteger(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return Math.floor(numeric);
}

function clampDimension(value, fallback) {
  const dimension = toPositiveInteger(value);
  if (dimension > 0) {
    return dimension;
  }
  return Math.max(1, toPositiveInteger(fallback));
}

function resolveCaptureSize(surface, width, height) {
  if (!surface || !surface.buffer32) {
    throw new Error("surfaceToPngBuffer requires a valid surface.");
  }

  const surfaceWidth = toPositiveInteger(surface.width);
  const surfaceHeight = toPositiveInteger(surface.height);
  if (surfaceWidth < 1 || surfaceHeight < 1) {
    throw new Error(`Surface has invalid size ${surface.width}x${surface.height}.`);
  }

  const requiredPixels = surfaceWidth * surfaceHeight;
  if (!Number.isSafeInteger(requiredPixels) || requiredPixels < 1) {
    throw new Error(`Surface size overflow for ${surfaceWidth}x${surfaceHeight}.`);
  }
  if ((surface.buffer32.length >>> 0) < requiredPixels) {
    throw new Error(
      `Surface buffer is too small for ${surfaceWidth}x${surfaceHeight}: ${surface.buffer32.length >>> 0} < ${requiredPixels}.`
    );
  }

  const w = Math.min(surfaceWidth, clampDimension(width, surfaceWidth));
  const h = Math.min(surfaceHeight, clampDimension(height, surfaceHeight));
  if (w < 1 || h < 1) {
    throw new Error(`Screenshot size resolved to invalid ${w}x${h}.`);
  }
  if (w > MAX_PNG_DIMENSION || h > MAX_PNG_DIMENSION) {
    throw new Error(`Screenshot size ${w}x${h} exceeds PNG limits.`);
  }

  return {
    surfaceWidth,
    surfaceHeight,
    width: w,
    height: h
  };
}

function encodeSurfaceToPngBuffer(surface, capture) {
  const w = capture.width;
  const h = capture.height;
  const raw = Buffer.alloc((h * ((w * 4) + 1)) >>> 0);
  const src = surface.buffer32;
  let out = 0;

  for (let y = 0; y < h; y += 1) {
    raw[out++] = 0;
    let row = y * capture.surfaceWidth;
    for (let x = 0; x < w; x += 1) {
      const packed = src[row + x] >>> 0;
      raw[out++] = packed & 0xff;
      raw[out++] = (packed >>> 8) & 0xff;
      raw[out++] = (packed >>> 16) & 0xff;
      raw[out++] = (packed >>> 24) & 0xff;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w >>> 0, 0);
  ihdr.writeUInt32BE(h >>> 0, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    PNG_SIGNATURE,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", idat),
    makeChunk("IEND", Buffer.alloc(0))
  ]);
}

function parsePngBuffer(png, options) {
  const data = Buffer.isBuffer(png) ? png : Buffer.from(png || []);
  const opts = options || {};

  if (data.length < PNG_SIGNATURE.length + 12) {
    throw new Error(`PNG too small: ${data.length} bytes.`);
  }
  if (!data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("PNG signature mismatch.");
  }

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let compression = 0;
  let filter = 0;
  let interlace = 0;
  let seenHeader = false;
  let seenEnd = false;
  let idatCount = 0;
  const idatChunks = [];

  while (offset < data.length) {
    if (offset + 12 > data.length) {
      throw new Error(`PNG truncated at byte ${offset}.`);
    }

    const length = data.readUInt32BE(offset);
    offset += 4;
    const typeStart = offset;
    const typeBuffer = data.subarray(typeStart, typeStart + 4);
    const type = typeBuffer.toString("ascii");
    offset += 4;

    const dataEnd = offset + length;
    if (dataEnd + 4 > data.length) {
      throw new Error(`PNG chunk '${type}' exceeds file size.`);
    }

    const chunkData = data.subarray(offset, dataEnd);
    offset = dataEnd;
    const expectedCrc = data.readUInt32BE(offset);
    offset += 4;
    const actualCrc = crc32([typeBuffer, chunkData]);
    if (actualCrc !== expectedCrc) {
      throw new Error(`PNG chunk '${type}' CRC mismatch.`);
    }

    if (type === "IHDR") {
      if (seenHeader) {
        throw new Error("PNG has multiple IHDR chunks.");
      }
      if (typeStart !== PNG_SIGNATURE.length + 4) {
        throw new Error("IHDR must be the first PNG chunk.");
      }
      if (length !== 13) {
        throw new Error(`IHDR has invalid length ${length}.`);
      }

      width = chunkData.readUInt32BE(0);
      height = chunkData.readUInt32BE(4);
      bitDepth = chunkData[8] >>> 0;
      colorType = chunkData[9] >>> 0;
      compression = chunkData[10] >>> 0;
      filter = chunkData[11] >>> 0;
      interlace = chunkData[12] >>> 0;

      if (width < 1 || height < 1) {
        throw new Error(`PNG has invalid size ${width}x${height}.`);
      }
      if (width > MAX_PNG_DIMENSION || height > MAX_PNG_DIMENSION) {
        throw new Error(`PNG size ${width}x${height} exceeds limits.`);
      }

      seenHeader = true;
      continue;
    }

    if (!seenHeader) {
      throw new Error(`PNG chunk '${type}' appeared before IHDR.`);
    }

    if (type === "IDAT") {
      idatCount += 1;
      idatChunks.push(chunkData);
      continue;
    }

    if (type === "IEND") {
      if (length !== 0) {
        throw new Error("IEND chunk must be empty.");
      }
      seenEnd = true;
      if (offset !== data.length) {
        throw new Error("PNG has trailing bytes after IEND.");
      }
      break;
    }
  }

  if (!seenHeader) {
    throw new Error("PNG is missing IHDR.");
  }
  if (!seenEnd) {
    throw new Error("PNG is missing IEND.");
  }
  if (!idatCount) {
    throw new Error("PNG is missing IDAT.");
  }

  if (opts.expectWidth !== undefined && width !== (opts.expectWidth >>> 0)) {
    throw new Error(`PNG width mismatch: expected ${opts.expectWidth}, got ${width}.`);
  }
  if (opts.expectHeight !== undefined && height !== (opts.expectHeight >>> 0)) {
    throw new Error(`PNG height mismatch: expected ${opts.expectHeight}, got ${height}.`);
  }

  if (colorType === 6 && bitDepth === 8 && compression === 0 && filter === 0 && interlace === 0) {
    const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
    const expectedRawSize = height * ((width * 4) + 1);
    if (inflated.length !== expectedRawSize) {
      throw new Error(`PNG raw payload size mismatch: expected ${expectedRawSize}, got ${inflated.length}.`);
    }
  }

  return {
    width,
    height,
    bitDepth,
    colorType,
    compression,
    filter,
    interlace,
    idatCount,
    bytes: data.length >>> 0
  };
}

function validatePngFile(filePath, options) {
  const resolved = path.resolve(filePath);
  return parsePngBuffer(fs.readFileSync(resolved), options);
}

function surfaceToPngBuffer(surface, width, height) {
  return encodeSurfaceToPngBuffer(surface, resolveCaptureSize(surface, width, height));
}

function writeSurfacePng(surface, filePath, options) {
  const opts = options || {};
  const outPath = path.resolve(filePath);
  const capture = resolveCaptureSize(surface, opts.width, opts.height);
  const png = encodeSurfaceToPngBuffer(surface, capture);
  const meta = parsePngBuffer(png, { expectWidth: capture.width, expectHeight: capture.height });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, png);
  return {
    path: outPath,
    width: meta.width,
    height: meta.height,
    bytes: meta.bytes,
    validated: true
  };
}

module.exports = {
  parsePngBuffer,
  surfaceToPngBuffer,
  validatePngFile,
  writeSurfacePng
};

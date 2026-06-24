const fs = require('fs');
const path = require('path');

// Load KFM2 as KEX
const { loadKosRuntime, readTargetImage } = require('./ui-harness');
const { Emulator, disassembleBlock } = loadKosRuntime();

const image = readTargetImage(path.join(__dirname, '..', 'temp_kfm2.kex'));
console.log('Entry:', '0x' + image.header.entry.toString(16));
console.log('Image size:', image.header.imageSize);
console.log('Memory size:', image.header.memorySize);
console.log('Unpacked size:', image.unpackedSize);
console.log('');

// Create emulator just for disassembly
const surface = { width: 800, height: 600 };
const emu = new Emulator(surface, () => {}, { cpuBackend: 'js' });
emu.load(image);

// Dump first 256 bytes at entry
const entry = image.header.entry >>> 0;
const bytes = emu.readMemBlock(entry, 128);
if (bytes) {
  console.log('Entry bytes:');
  for (let i = 0; i < bytes.length; i += 16) {
    const hex = Array.from(bytes.slice(i, i + 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    console.log(`  ${(entry + i).toString(16).padStart(8, '0')}: ${hex}`);
  }
}

// Try to disassemble
console.log('\nDisassembly at entry (simple linear):');
for (let offset = 0; offset < 128; ) {
  try {
    const info = emu.disassembleOne(entry + offset);
    if (!info || !info.text) break;
    const addr = (entry + offset).toString(16).padStart(8, '0');
    const hex = Array.from(bytes.slice(offset, offset + (info.length || 0))).map(b => b.toString(16).padStart(2, '0')).join(' ');
    console.log(`  ${addr}: ${hex.padEnd(15)} ${info.text}`);
    if (info.text.includes('ret') || info.text.includes('int')) break;
    offset += info.length || 1;
  } catch (e) {
    console.log(`  error at offset ${offset}: ${e.message}`);
    break;
  }
}

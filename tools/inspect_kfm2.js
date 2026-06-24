const fs = require('fs');
const path = require('path');
const { loadKosRuntime, readTargetImage } = require('./ui-harness');
const { Emulator } = loadKosRuntime();

const image = readTargetImage(path.join(__dirname, '..', 'temp_kfm2.kex'));
const entry = image.header.entry >>> 0;

const surface = { width: 800, height: 600 };
const emu = new Emulator(surface, () => {}, { cpuBackend: 'js' });
emu.load(image);

// Dump memory at key addresses
function dumpHex(addr, len, label) {
  const b = emu.readMemBlock(addr, len);
  if (!b) { console.log(`  ${label}: null`); return; }
  const hex = Array.from(b).map(v => v.toString(16).padStart(2,'0')).join(' ');
  const ascii = Array.from(b).map(v => v >= 0x20 && v < 0x7f ? String.fromCharCode(v) : '.').join('');
  console.log(`  ${label} @0x${addr.toString(16)}: ${hex}`);
  console.log(`    ascii: ${ascii}`);
}

console.log('=== Image at 0x9b-0xbf (data at push imm) ===');
dumpHex(0x9b, 40, '0x9b');
console.log('\n=== Code at 0x56-0xbf ===');
dumpHex(0x56, 0x6a, '0x56');
console.log('\n=== Code at entry 0x203-0x210 ===');
dumpHex(0x203, 16, '0x203');

// Also dump a range near 0x1D7 (the string copy loop)
console.log('\n=== String copy loop at 0x1D7 ===');
dumpHex(0x1D7, 20, '0x1D7');

// Dump the full image
console.log('\n=== Full image dump (256 bytes from entry) ===');
dumpHex(entry, 256, 'entry');

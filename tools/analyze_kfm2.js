const fs = require('fs');
const path = require('path');

const b = fs.readFileSync(path.join(__dirname, '..', 'temp_kfm2.kex'));

console.log('File size:', b.length);
console.log('Bytes:', Array.from(b.slice(0, 32)).map(v => '0x' + v.toString(16).padStart(2, '0')).join(' '));
console.log('Magic:', b.slice(0, 4).toString('ascii'));
console.log('Byte 4-7:', Array.from(b.slice(4, 8)).map(v => '0x' + v.toString(16)).join(' '));
console.log('Unpacked size (LE u32):', b.readUInt32LE(4));
console.log('Byte 8-11:', Array.from(b.slice(8, 12)).map(v => '0x' + v.toString(16)).join(' '));
console.log('Byte 12:', Array.from(b.slice(12, 13)).map(v => '0x' + v.toString(16)).join(' '));
console.log('Byte 13:', Array.from(b.slice(13, 14)).map(v => '0x' + v.toString(16)).join(' '));

// EOLITE for comparison
const builtin = fs.readFileSync(path.join(__dirname, '..', 'assets_kolibrios', 'builtin-root.js'), 'utf8');
const eoMatch = builtin.match(/path: "\/File Managers\/EOLITE", size: \d+, mtimeMs: \d+, base64: "([A-Za-z0-9+/=]+)"/);
if (eoMatch) {
  const eo = Buffer.from(eoMatch[1], 'base64');
  console.log('\nEOLITE:');
  console.log('  Packed size:', eo.length);
  console.log('  Magic:', eo.slice(0, 4).toString('ascii'));
  console.log('  Unpacked size:', eo.readUInt32LE(4));
  console.log('  Bytes 8-11:', Array.from(eo.slice(8, 12)).map(v => '0x' + v.toString(16)).join(' '));
  console.log('  Byte 12:', '0x' + eo[12].toString(16));
}

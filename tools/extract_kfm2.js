const fs = require('fs');
const path = require('path');
const content = fs.readFileSync(path.join(__dirname, '..', 'assets_kolibrios', 'builtin-root.js'), 'utf8');
const match = content.match(/path: "\/File Managers\/KFM2", size: \d+, mtimeMs: \d+, base64: "([A-Za-z0-9+/=]+)"/);
if (!match) { console.log('not found'); process.exit(1); }
const base64 = match[1];
const binary = Buffer.from(base64, 'base64');
const outPath = path.join(__dirname, '..', 'temp_kfm2.kex');
fs.writeFileSync(outPath, binary);
console.log('Wrote', binary.length, 'bytes to', outPath);

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../miniprogram');
const devtools = process.argv[2];
if (!devtools) throw Error('Usage: node scripts/check-native.cjs "WeChat DevTools installation directory"');
const bin = path.join(devtools, 'resources/app.asar.unpacked/node_modules/wcc-exec');
const files = [], styles = [];
function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) scan(full);
    else if (full.endsWith('.wxml')) files.push('./' + path.relative(root, full).replaceAll('\\', '/'));
    else if (full.endsWith('.wxss')) styles.push('./' + path.relative(root, full).replaceAll('\\', '/'));
  }
}
scan(root);
for (const [exe, args] of [['wcc.exe', files], ...styles.map(style => ['wcsc.exe', [style]])]) {
  const result = spawnSync(path.join(bin, exe), args, { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, windowsHide: true });
  if (result.error || result.status !== 0 || /error|unexpected|not found/i.test(result.stderr)) {
    console.error(result.error || result.stderr || result.stdout); process.exitCode = 1;
  } else console.log(`PASS ${exe}: ${args.length} inputs${exe === 'wcsc.exe' ? ' (' + args[0] + ')' : ''}, ${Buffer.byteLength(result.stdout)} compiled bytes${result.stderr ? '; ' + result.stderr.trim() : ''}`);
}
console.log('This checks real WeChat compiler syntax, not simulator rendering or device APIs.');

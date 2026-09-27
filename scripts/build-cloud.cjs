const fs = require('node:fs');
const path = require('node:path');
const { apiFunction, featuresFunction, publicShareFunction } = require('../miniprogram/config/cloud-resources');
const root = path.resolve(__dirname, '..');
const files = [
  ['server/handler.js', 'lib/handler.js'],
  ['server/identity.js', 'lib/identity.js'],
  ['server/protocol.js', 'lib/protocol.js'],
  ['server/cloudbase-repository.js', 'lib/cloudbase-repository.js'],
  ['server/features-repository.js', 'lib/features-repository.js'],
  ['server/sidecar-cleanup.js', 'lib/sidecar-cleanup.js'],
  ['server/limits.js', 'lib/limits.js'],
  ['miniprogram/core/habits.js', 'shared/habits.js'],
  ['miniprogram/core/date.js', 'shared/date.js']
];
const featureFiles = [
  ['server/limits.js', 'lib/limits.js'],
  ['server/features.js', 'lib/features.js'],
  ['server/features-repository.js', 'lib/features-repository.js'],
  ['server/identity.js', 'lib/identity.js'],
  ['server/protocol.js', 'lib/protocol.js'],
  ['server/cloudbase-repository.js', 'lib/cloudbase-repository.js'],
  ['miniprogram/core/habits.js', 'shared/habits.js'],
  ['miniprogram/core/date.js', 'shared/date.js']
];
const check = process.argv.includes('--check');
let count = 0;
function emit(destination, bytes) {
  if (check) {
    if (!fs.existsSync(destination) || !bytes.equals(fs.readFileSync(destination))) throw Error(`Stale cloud artifact: ${destination}. Run npm run build:cloud.`);
  } else {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes);
  }
  count++;
}
for (const [name, entries] of [[apiFunction, files],
  [featuresFunction, [['server/entries/features.js', 'index.js'], ...featureFiles]],
  [publicShareFunction, [['server/entries/public-share.js', 'index.js'], ...featureFiles]]]) {
  const output = path.join(root, 'cloudfunctions', name);
  for (const [source, target] of entries) emit(path.join(output, target), fs.readFileSync(path.join(root, source)));
  if (name !== apiFunction) for (const file of ['package.json', 'package-lock.json']) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'cloudfunctions', apiFunction, file), 'utf8'));
    manifest.name = name.replaceAll('_', '-');
    if (manifest.packages && manifest.packages['']) manifest.packages[''].name = manifest.name;
    emit(path.join(output, file), Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
  }
}
console.log(`PASS ${count} cloud files ${check ? 'match source' : 'assembled locally'}. No install, deployment or network requests.`);

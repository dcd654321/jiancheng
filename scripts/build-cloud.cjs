const fs = require('node:fs');
const path = require('node:path');
const { apiFunction } = require('../miniprogram/config/cloud-resources');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'cloudfunctions', apiFunction);
const files = [
  ['server/handler.js', 'lib/handler.js'],
  ['server/protocol.js', 'lib/protocol.js'],
  ['server/cloudbase-repository.js', 'lib/cloudbase-repository.js'],
  ['miniprogram/core/habits.js', 'shared/habits.js'],
  ['miniprogram/core/date.js', 'shared/date.js']
];
const check = process.argv.includes('--check');
for (const [source, target] of files) {
  const destination = path.join(output, target);
  const bytes = fs.readFileSync(path.join(root, source));
  if (check) {
    if (!fs.existsSync(destination) || !bytes.equals(fs.readFileSync(destination))) throw Error(`Stale cloud artifact: ${target}. Run npm run build:cloud.`);
  } else {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes);
  }
}
console.log(`PASS ${files.length} cloud modules ${check ? 'match source' : 'assembled locally'}. No install, deployment or network requests.`);

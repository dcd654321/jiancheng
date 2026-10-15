const fs = require('node:fs');
const path = require('node:path');
const { apiFunction, featuresFunction, publicShareFunction, reminderTickFunction, planFunction, mediaCallbackFunction, mediaTickFunction } = require('../miniprogram/config/cloud-resources');
const root = path.resolve(__dirname, '..');
const files = [
  ['server/handler.js', 'lib/handler.js'],
  ['server/operations-monitor.js', 'lib/operations-monitor.js'],
  ['server/identity.js', 'lib/identity.js'],
  ['server/protocol.js', 'lib/protocol.js'],
  ['server/preferences.js', 'lib/preferences.js'],
  ['server/cloudbase-repository.js', 'lib/cloudbase-repository.js'],
  ['server/features-repository.js', 'lib/features-repository.js'],
  ['server/sidecar-cleanup.js', 'lib/sidecar-cleanup.js'],
  ['server/limits.js', 'lib/limits.js'],
  ['miniprogram/core/habits.js', 'shared/habits.js'],
  ['miniprogram/core/date.js', 'shared/date.js']
];
const featureFiles = [
  ['server/preferences.js', 'lib/preferences.js'],
  ['server/limits.js', 'lib/limits.js'],
  ['server/features.js', 'lib/features.js'],
  ['server/features-repository.js', 'lib/features-repository.js'],
  ['server/identity.js', 'lib/identity.js'],
  ['server/protocol.js', 'lib/protocol.js'],
  ['server/cloudbase-repository.js', 'lib/cloudbase-repository.js'],
  ['miniprogram/core/habits.js', 'shared/habits.js'],
  ['miniprogram/core/date.js', 'shared/date.js']
];
const supervisionFiles = [
  ['server/supervision.js', 'lib/supervision.js'],
  ['server/supervision-repository.js', 'lib/supervision-repository.js'],
  ['server/supervision-gates.js', 'lib/supervision-gates.js'],
  ['server/supervision-config.js', 'lib/supervision-config.js'],
  ['server/media.js', 'lib/media.js'],
  ['server/media-provider.js', 'lib/media-provider.js'],
  ['server/media-worker.js', 'lib/media-worker.js'],
  ['server/next-reminders.js', 'lib/next-reminders.js']
];
const check = process.argv.includes('--check');
let count = 0;
// 只移除本脚本曾生成的旧 plan 模块，保留未知文件与开发者安装的依赖缓存。
const retiredPlanFiles = [
  'lib/ai-plan.js', 'lib/ai-provider.js', 'lib/limits.js', 'lib/features.js',
  'lib/features-repository.js', 'lib/identity.js', 'lib/protocol.js', 'lib/cloudbase-repository.js',
  'shared/ai-catalog.js', 'shared/ai-contract.js', 'shared/plan-assistant.js',
  'shared/habits.js', 'shared/date.js'
];
const planOutput = path.resolve(root, 'cloudfunctions', planFunction);
for (const file of retiredPlanFiles) {
  const destination = path.resolve(planOutput, file);
  if (!destination.startsWith(planOutput + path.sep)) throw Error('Invalid retired plan artifact path');
  if (!fs.existsSync(destination)) continue;
  if (check) throw Error(`Retired cloud artifact: ${destination}. Run npm run build:cloud.`);
  fs.unlinkSync(destination);
}
if (!check) for (const directory of ['lib', 'shared']) {
  const destination = path.join(planOutput, directory);
  if (fs.existsSync(destination) && fs.readdirSync(destination).length === 0) fs.rmdirSync(destination);
}
function emit(destination, bytes) {
  if (check) {
    if (!fs.existsSync(destination) || !bytes.equals(fs.readFileSync(destination))) throw Error(`Stale cloud artifact: ${destination}. Run npm run build:cloud.`);
  } else {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes);
  }
  count++;
}
for (const [name, entries] of [[apiFunction, [['server/entries/api.js', 'index.js'], ...files, ...supervisionFiles]],
  [featuresFunction, [['server/entries/features.js', 'index.js'], ...featureFiles, ...supervisionFiles]],
  [publicShareFunction, [['server/entries/public-share.js', 'index.js'], ...featureFiles]],
  [reminderTickFunction, [['server/entries/reminder-tick.js', 'index.js'], ['server/reminder-worker.js','lib/reminder-worker.js'], ...featureFiles, ...supervisionFiles]],
  [mediaCallbackFunction, [['server/entries/media-callback.js', 'index.js'], ...featureFiles, ...supervisionFiles]],
  [mediaTickFunction, [['server/entries/media-tick.js', 'index.js'], ['server/reminder-worker.js','lib/reminder-worker.js'], ...featureFiles, ...supervisionFiles]],
  [planFunction, [['server/entries/plan.js','index.js']]]]) {
  const output = path.join(root, 'cloudfunctions', name);
  for (const [source, target] of entries) emit(path.join(output, target), fs.readFileSync(path.join(root, source)));
  if ([apiFunction,featuresFunction,reminderTickFunction,mediaCallbackFunction,mediaTickFunction].includes(name)) emit(path.join(output,'lib/reminders.js'),fs.readFileSync(path.join(root,'server/reminders.js')));
  if (name === planFunction) {
    const { version } = JSON.parse(fs.readFileSync(path.join(root, 'cloudfunctions', apiFunction, 'package.json'), 'utf8'));
    const manifest = { name: name.replaceAll('_', '-'), version, private: true, main: 'index.js' };
    const lock = { name: manifest.name, version, lockfileVersion: 1, requires: true };
    for (const [file, data] of [['package.json', manifest], ['package-lock.json', lock]]) {
      emit(path.join(output, file), Buffer.from(JSON.stringify(data, null, 2) + '\n'));
    }
    continue;
  }
  if (name !== apiFunction) for (const file of ['package.json', 'package-lock.json']) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'cloudfunctions', apiFunction, file), 'utf8'));
    manifest.name = name.replaceAll('_', '-');
    if (manifest.packages && manifest.packages['']) manifest.packages[''].name = manifest.name;
    emit(path.join(output, file), Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
  }
}
console.log(`PASS ${count} cloud files ${check ? 'match source' : 'assembled locally'}. No install, deployment or network requests.`);

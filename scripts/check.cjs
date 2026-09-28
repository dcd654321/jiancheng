const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
let checks = 0;
function visit(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'qa'].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { visit(file); continue; }
    if (entry.name.endsWith('.json')) { JSON.parse(fs.readFileSync(file, 'utf8')); checks += 1; }
    if (/\.(js|cjs)$/.test(entry.name)) { new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file }); checks += 1; }
  }
}
visit(root);
const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
const mini = path.join(root, config.miniprogramRoot);
// The active package must remain cloud-only. Historical migration fixtures live
// under tests/legacy and are deliberately outside this check and the package.
function assertNoDevicePersistence(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { assertNoDevicePersistence(file); continue; }
    if (!/\.(js|wxml)$/.test(entry.name)) continue;
    const source = fs.readFileSync(file, 'utf8');
    if (/\b(?:getStorage(?:Sync)?|setStorage(?:Sync)?|removeStorage(?:Sync)?|getFileSystemManager)\s*\(|USER_DATA_PATH/.test(source)) {
      throw Error('Active mini-program must not access device persistence: ' + file);
    }
    checks += 1;
  }
}
assertNoDevicePersistence(mini);
const app = JSON.parse(fs.readFileSync(path.join(mini, 'app.json'), 'utf8'));
if (app.lazyCodeLoading === 'requiredComponents' && config.setting.ignoreDevUnusedFiles !== false) {
  throw Error('Required component lazy loading needs ignoreDevUnusedFiles=false in project.config.json; otherwise page service modules may be omitted in DevTools.');
}
const privateConfigPath = path.join(root, 'project.private.config.json');
if (app.lazyCodeLoading === 'requiredComponents' && fs.existsSync(privateConfigPath)) {
  const privateConfig = JSON.parse(fs.readFileSync(privateConfigPath, 'utf8'));
  if (privateConfig.setting?.ignoreDevUnusedFiles === true) {
    throw Error('Set setting.ignoreDevUnusedFiles=false in project.private.config.json; the private value overrides the shared project setting and can blank the simulator.');
  }
}
const packagedIgnores = new Set((config.packOptions?.ignore || [])
  .filter(rule => rule.type === 'file').map(rule => rule.value));
for (const buildOnlyFile of ['core/ai-catalog.js', 'config/cloud.product.js']) {
  if (!packagedIgnores.has(buildOnlyFile)) {
    throw Error(`Build-only file must be excluded from the miniprogram package: ${buildOnlyFile}`);
  }
  checks += 1;
}
for (const page of app.pages) {
  for (const ext of ['js', 'json', 'wxml']) {
    if (!fs.existsSync(path.join(mini, page + '.' + ext))) throw Error('Missing page file: ' + page + '.' + ext);
    checks += 1;
  }
}
for (const tab of app.tabBar.list) if (!app.pages.includes(tab.pagePath)) throw Error('Unknown tab: ' + tab.pagePath);
console.log(`PASS ${checks} syntax/config/page checks. WXML compilation and native rendering require WeChat DevTools.`);

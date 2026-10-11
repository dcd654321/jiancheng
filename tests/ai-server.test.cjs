const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const retired = {
  ok: false,
  code: 'NOT_ENABLED',
  message: '该功能已停用，请更新小程序后添加习惯'
};

function isolatedEntry(file, env) {
  const exports = {};
  let loads = 0;
  new Function('require', 'exports', 'process', fs.readFileSync(file, 'utf8'))(
    () => { loads++; throw Error('SDK_MODEL_OR_DATABASE_LOAD_FORBIDDEN'); }, exports, { env });
  assert.equal(loads, 0);
  return exports.main;
}

test('旧 plan 入口忽略全部请求和旧启用配置，无依赖加载、读取或供应商副作用', async () => {
  const legacyEnv = {
    HABIT_AI_ENABLED: 'true', HABIT_AI_STORAGE_READY: 'true', HABIT_AI_BUDGET_VERIFIED: 'true',
    HABIT_AI_CATALOG_VERIFIED: 'true', HABIT_IDENTITY_VERIFIED: 'true', HABIT_MINIPROGRAM_ONLY: 'true',
    HABIT_LIMITS_VERIFIED: 'true', HABIT_SIDECAR_CLEANUP_ENABLED: 'true', HABIT_APP_ID: 'wx-retired',
    HABIT_AI_PROVIDER: 'deepseek', HABIT_AI_MODEL: 'fixture', HABIT_AI_API_KEY: 'PRIVATE_FIXTURE_KEY',
    HABIT_AI_USER_DAILY: '2', HABIT_AI_RESERVATION_MICRO_CNY: '100',
    HABIT_AI_DAY_MICRO_CNY: '1000', HABIT_AI_MONTH_MICRO_CNY: '10000'
  };
  const unreadable = new Proxy({}, { get() { throw Error('REQUEST_OR_CONFIG_READ_FORBIDDEN'); } });
  for (const env of [{}, legacyEnv, { HABIT_AI_ENABLED: 'false' }, unreadable]) {
    for (const entry of ['server/entries/plan.js', 'cloudfunctions/jiancheng_daka_plan/index.js']) {
      const main = isolatedEntry(path.join(root, entry), env);
      for (const request of [undefined, null, [], {}, { action: 'suggest', input: 'PRIVATE_FIXTURE_INPUT' }, unreadable]) {
        assert.deepEqual(await main(request), retired);
      }
    }
  }
});

test('隔离构建清理确切旧模块、保留未知文件与 SDK 缓存，停用包无运行依赖', t => {
  const tempBase = fs.realpathSync(os.tmpdir());
  const workspace = fs.mkdtempSync(path.join(tempBase, 'jiancheng-retired-plan-'));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(workspace)), tempBase);
    fs.rmSync(workspace, { recursive: true, force: true });
  });
  for (const directory of ['server', 'miniprogram/core', 'miniprogram/config']) {
    fs.cpSync(path.join(root, directory), path.join(workspace, directory), { recursive: true });
  }
  for (const file of ['scripts/build-cloud.cjs', 'cloudfunctions/jiancheng_daka_api/package.json', 'cloudfunctions/jiancheng_daka_api/package-lock.json']) {
    const destination = path.join(workspace, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, file), destination);
  }
  const build = (...args) => spawnSync(process.execPath, [path.join(workspace, 'scripts/build-cloud.cjs'), ...args], { encoding: 'utf8' });
  assert.equal(build().status, 0);
  const output = path.join(workspace, 'cloudfunctions/jiancheng_daka_plan');
  assert.deepEqual(fs.readdirSync(output).sort(), ['index.js', 'package-lock.json', 'package.json']);
  for (const file of ['package.json', 'package-lock.json']) {
    const manifest = JSON.parse(fs.readFileSync(path.join(output, file), 'utf8'));
    assert.equal(manifest.name, 'jiancheng-daka-plan');
    assert.equal(manifest.dependencies, undefined);
    assert.equal(manifest.devDependencies, undefined);
  }
  for (const file of ['lib/ai-provider.js', 'shared/ai-contract.js', 'lib/local-notes.txt', 'node_modules/fixture-cache.txt']) {
    const destination = path.join(output, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, 'preserve unknown files, retire only generated modules');
  }
  const rejected = build('--check');
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /Retired cloud artifact/);
  assert.equal(fs.existsSync(path.join(output, 'lib/ai-provider.js')), true, 'check is read-only');
  assert.equal(build().status, 0);
  assert.equal(fs.existsSync(path.join(output, 'lib/ai-provider.js')), false);
  assert.equal(fs.existsSync(path.join(output, 'shared')), false, 'empty generated directory is removed');
  assert.equal(fs.readFileSync(path.join(output, 'lib/local-notes.txt'), 'utf8'), 'preserve unknown files, retire only generated modules');
  assert.equal(fs.existsSync(path.join(output, 'node_modules/fixture-cache.txt')), true);
  assert.equal(build('--check').status, 0);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const manifest = require('../deploy/product-resources.json');
const resources = require('../miniprogram/config/cloud-resources');
const product = require('../miniprogram/config/cloud').TARGETS.product;

test('正式资源清单精确覆盖七函数和十三集合，没有其他应用或重复名称', () => {
  assert.equal(manifest.environment, product.envId);
  assert.equal(manifest.resourceAppid, product.resourceAppid);
  assert.equal(manifest.consumerAppid, require('../project.config.json').appid);
  for (const [kind, suffix] of [['functions', 'Function'], ['collections', 'Collection']]) {
    const expected = Object.entries(resources).filter(([key]) => key.endsWith(suffix) && key !== 'monitorFunction').map(([, value]) => value).sort();
    const actual = manifest[kind].map(item => item.name).sort();
    assert.deepEqual(actual, expected);
    assert.equal(new Set(actual).size, actual.length);
    assert.ok(actual.every(name => name.startsWith('jiancheng_daka_')));
  }
  assert.equal(manifest.functions.length, 7);
  assert.equal(manifest.collections.length, 13);
  assert.equal(manifest.externalDependencies.operationsMonitor.functionName, resources.monitorFunction);
  assert.equal(manifest.externalDependencies.operationsMonitor.managedBy, 'miniProgramMonitor');
  assert.equal(manifest.externalDependencies.operationsMonitor.deployBeforeClient, true);
  assert.deepEqual(manifest.externalDependencies.operationsMonitor.requiredCollections,
    ['monitor_users', 'monitor_usage_daily', 'monitor_usage_sessions', 'monitor_events', 'monitor_meta']);
  for (const fn of manifest.functions) {
    assert.equal(fn.path, 'cloudfunctions/' + fn.name);
    assert.ok(fs.existsSync(path.join(__dirname, '..', fn.path, 'index.js')));
    if (fn.name === resources.planFunction) {
      assert.equal(fn.retired, true);
      assert.equal(fn.enableFlag, undefined);
    } else if (fn.enableFlags) assert.ok(fn.enableFlags.every(flag => /^HABIT_[A-Z_]+_ENABLED$/.test(flag)));
    else if (fn.codeConfiguration) assert.equal(fn.codeConfiguration, 'server/supervision-config.js');
    else assert.match(fn.enableFlag, /^HABIT_[A-Z_]+_(?:ENABLED|VERIFIED)$/);
  }
});

test('索引上传参数与清单一致，业务索引均非唯一且绝不包含删除', () => {
  let count = 0;
  for (const suffix of ['shares', 'reminders', 'media', 'media_bindings', 'media_traces']) {
    const payload = require('../deploy/indexes/' + suffix + '.json');
    const collection = manifest.collections.find(item => item.name === 'jiancheng_daka_' + suffix);
    assert.deepEqual(Object.keys(payload), ['CreateIndexes']);
    assert.deepEqual(payload.CreateIndexes, collection.indexes.map(index => ({
      IndexName: index.name,
      MgoKeySchema: { MgoIsUnique: index.unique, MgoIndexKeys: index.keys.map(key => ({ Name: key.name, Direction: key.direction })) }
    })));
    assert.ok(payload.CreateIndexes.every(index => index.MgoKeySchema.MgoIsUnique === false));
    count += payload.CreateIndexes.length;
  }
  assert.equal(count, 13);
});

test('所有集合拒绝客户端直读写，只有提醒有TTL要求，不创建假数据或提前启用服务', () => {
  for (const collection of manifest.collections) assert.deepEqual(collection.clientRules, { read: false, write: false });
  const withTtl = manifest.collections.filter(collection => collection.ttlRequirement);
  assert.equal(withTtl.length, 1);
  assert.equal(withTtl[0].name, resources.remindersCollection);
  assert.equal(withTtl[0].ttlRequirement.field, 'expiresAt');
  assert.equal(withTtl[0].ttlRequirement.fieldType, 'Date');
  assert.equal(withTtl[0].ttlRequirement.expireAfterSeconds, 0);
  // 活动客户端已按验收流程切到共享目标（2026-09-29），其余边界仍然成立
  assert.equal(manifest.boundaries.switchActiveClientBeforeAcceptance, true);
  for (const key of ['seedBusinessData', 'createTimerBeforeAcceptance', 'enableFeaturesBeforeAcceptance', 'manageOtherApps', 'sharedAuthManagedHere']) {
    assert.equal(manifest.boundaries[key], false);
  }
});

test('照片存储清单拒绝客户端直读和冻结区写入，短时授权与孤儿清理范围明确',()=>{
  assert.equal(manifest.storage.clientRead,false);
  assert.equal(manifest.storage.applyRulesAutomatically,false);
  assert.equal(manifest.storage.supervisorLinkMaxAgeSeconds,300);
  assert.equal(manifest.storage.orphanMaxAgeHours,24);
  const rules=require('../deploy/media-storage-rules.json');
  assert.equal(rules.read,false);
  assert.ok(rules.write.includes('auth != null')&&rules.write.includes('resource.openid == auth.openid'));
  const regex=/^jiancheng_daka_media\/uploads\//;
  assert.equal(regex.test('jiancheng_daka_media/records/private.jpg'),false);
  assert.equal(regex.test('another_app/uploads/private.jpg'),false);
  assert.equal(regex.test('jiancheng_daka_media/uploads/a.jpg'),true);
});

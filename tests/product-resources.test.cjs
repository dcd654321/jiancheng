const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const manifest = require('../deploy/product-resources.json');
const resources = require('../miniprogram/config/cloud-resources');
const product = require('../miniprogram/config/cloud.product');

test('正式资源清单精确覆盖五函数和七集合，没有其他应用或重复名称', () => {
  assert.equal(manifest.environment, product.envId);
  assert.equal(manifest.resourceAppid, product.resourceAppid);
  assert.equal(manifest.consumerAppid, require('../project.config.json').appid);
  for (const [kind, suffix] of [['functions', 'Function'], ['collections', 'Collection']]) {
    const expected = Object.entries(resources).filter(([key]) => key.endsWith(suffix)).map(([, value]) => value).sort();
    const actual = manifest[kind].map(item => item.name).sort();
    assert.deepEqual(actual, expected);
    assert.equal(new Set(actual).size, actual.length);
    assert.ok(actual.every(name => name.startsWith('jiancheng_daka_')));
  }
  assert.equal(manifest.functions.length, 5);
  assert.equal(manifest.collections.length, 7);
  for (const fn of manifest.functions) {
    assert.equal(fn.path, 'cloudfunctions/' + fn.name);
    assert.ok(fs.existsSync(path.join(__dirname, '..', fn.path, 'index.js')));
    assert.match(fn.enableFlag, /^HABIT_[A-Z_]+_ENABLED$/);
  }
});

test('索引上传参数与清单一致，仅包含四个非唯一业务索引且绝不包含删除', () => {
  let count = 0;
  for (const suffix of ['shares', 'reminders']) {
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
  assert.equal(count, 4);
});

test('所有集合拒绝客户端直读写，只有提醒有TTL要求，不创建假数据或提前启用服务', () => {
  for (const collection of manifest.collections) assert.deepEqual(collection.clientRules, { read: false, write: false });
  const withTtl = manifest.collections.filter(collection => collection.ttlRequirement);
  assert.equal(withTtl.length, 1);
  assert.equal(withTtl[0].name, resources.remindersCollection);
  assert.equal(withTtl[0].ttlRequirement.field, 'expiresAt');
  assert.equal(withTtl[0].ttlRequirement.fieldType, 'Date');
  assert.equal(withTtl[0].ttlRequirement.expireAfterSeconds, 0);
  for (const key of ['seedBusinessData', 'createTimerBeforeAcceptance', 'enableFeaturesBeforeAcceptance', 'switchActiveClientBeforeAcceptance', 'manageOtherApps', 'sharedAuthManagedHere']) {
    assert.equal(manifest.boundaries[key], false);
  }
});

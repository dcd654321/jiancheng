const test = require('node:test');
const assert = require('node:assert/strict');
const { storageFixture } = require('./helpers/cloud-fixture.cjs');
const { createCloudBinding } = require('../miniprogram/services/cloud-binding');

test('account binding persists without network and is isolated by environment', () => {
  const wx = storageFixture();
  const first = createCloudBinding(wx, 'env-a');
  assert.equal(first.accountId(), '');
  first.bind('a'.repeat(64));

  const resumed = createCloudBinding(wx, 'env-a');
  assert.equal(resumed.accountId(), 'a'.repeat(64));
  assert.equal(createCloudBinding(wx, 'env-b').accountId(), '');
});

test('malformed binding fails closed and write failure does not change binding', () => {
  const wx = storageFixture();
  const binding = createCloudBinding(wx, 'env-a');
  wx.setStorageSync(binding.keys.binding, 'not-an-account');
  assert.throws(() => binding.accountId(), /绑定损坏/);
  wx.failWrite = true;
  assert.throws(() => binding.bind('a'.repeat(64)), /保存失败/);
  assert.throws(() => binding.accountId(), /绑定损坏/);
});

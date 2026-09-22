const test = require('node:test');
const assert = require('node:assert/strict');
const { storageFixture } = require('./helpers/cloud-fixture.cjs');
const { createCloudBinding } = require('../miniprogram/services/cloud-binding');

test('consent and account binding persist without network and are isolated by environment', () => {
  const wx = storageFixture();
  const first = createCloudBinding(wx, 'env-a');
  assert.equal(first.consented(), false);
  assert.equal(first.accountId(), '');
  first.accept();
  first.bind('a'.repeat(64));

  const resumed = createCloudBinding(wx, 'env-a');
  assert.equal(resumed.consented(), true);
  assert.equal(resumed.accountId(), 'a'.repeat(64));
  assert.equal(createCloudBinding(wx, 'env-b').consented(), false);
});

test('malformed binding fails closed and write failure never reports consent', () => {
  const wx = storageFixture();
  const binding = createCloudBinding(wx, 'env-a');
  wx.setStorageSync(binding.keys.binding, 'not-an-account');
  assert.throws(() => binding.accountId(), /绑定损坏/);
  wx.failWrite = true;
  assert.throws(() => binding.accept(), /保存失败/);
  assert.equal(binding.consented(), false);
});

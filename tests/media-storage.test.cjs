const test = require('node:test');
const assert = require('node:assert/strict');
const { createCloudTransport, createCloudStorage } = require('../miniprogram/services/cloud-transport');
const config = { enabled: true, mode: 'shared', resourceAppid: 'wx1111111111111111', envId: 'media-contract-env' };
const cloudPath = 'jiancheng_daka_media/uploads/' + 'a'.repeat(64) + '/epoch/' + 'b'.repeat(64) + '.jpg';

test('照片上传与业务调用复用受信共享实例且不回退默认云', async () => {
  let initialized = 0, constructed = 0;
  const calls = [];
  const wx = { cloud: { init() { throw Error('DEFAULT_CLOUD_FORBIDDEN'); }, Cloud: class {
    constructor(options) { constructed++; assert.deepEqual(options, { resourceAppid: config.resourceAppid, resourceEnv: config.envId }); }
    async init() { initialized++; }
    async callFunction() { return { result: { ok: true } }; }
    async uploadFile(options) { calls.push(options); return { fileID: 'cloud://media-contract/' + options.cloudPath }; }
  } } };
  const upload = createCloudStorage(wx, config), invoke = createCloudTransport(wx, config);
  const [result] = await Promise.all([upload.upload({ cloudPath, filePath: 'wxfile://selected-temp.jpg' }), invoke({ action: 'pull' })]);
  assert.equal(constructed, 1); assert.equal(initialized, 1);
  assert.deepEqual(calls, [{ cloudPath, filePath: 'wxfile://selected-temp.jpg' }]);
  assert.equal(result.fileID, 'cloud://media-contract/' + cloudPath);
});

test('不属于项目的图片路径、关闭配置和上传未知结果不伪造成功', async () => {
  let uploads = 0;
  const wx = { cloud: { Cloud: class {
    async init() {} async callFunction() {} async uploadFile() { uploads++; return { errCode: 403, fileID: 'cloud://private' }; }
  } } };
  assert.throws(() => createCloudStorage(wx, { ...config, enabled: false }));
  const storage = createCloudStorage(wx, config);
  for (const path of ['public/photo.jpg', '../jiancheng_daka_media/a.jpg', 'jiancheng_daka_media/../a.jpg', 'jiancheng_daka_media/a.svg', cloudPath.replace('/uploads/', '/records/')]) {
    await assert.rejects(storage.upload({ cloudPath: path, filePath: 'wxfile://temp.jpg' }));
  }
  assert.equal(uploads, 0);
  await assert.rejects(storage.upload({ cloudPath, filePath: 'wxfile://temp.jpg' }), /未确认/);
  assert.equal(uploads, 1);
});

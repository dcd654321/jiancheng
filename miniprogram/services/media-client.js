const { createCloudTransport, createCloudStorage } = require('./cloud-transport');
const resources = require('../config/cloud-resources');
const clone = value => JSON.parse(JSON.stringify(value));
function createMediaClient(wxApi, cloudConfig, config, session, options = {}) {
  let transport, storage, serial = 0;
  const attempts = new Map(), clock = options.clock || Date.now;
  const configured = () => config.enabled === true && cloudConfig.enabled === true && cloudConfig.functionName === resources.apiFunction;
  function context() {
    const s = session && session.status();
    if (!s || !s.ready || !s.accountId || !s.epoch || s.pending || s.deletionPending) throw Error('请先恢复云端记录，再保存照片');
    return { key: s.accountId + ':' + s.epoch, epoch: s.epoch };
  }
  async function request(payload, operationKey) {
    if (!configured()) throw Error('打卡照片尚未开放');
    const origin = context(), token = origin.key + ':' + (operationKey || JSON.stringify(payload));
    if (operationKey && !attempts.has(token)) attempts.set(token, 'photo-' + clock().toString(36) + '-' + (++serial));
    if (!transport) transport = (options.transportFactory || createCloudTransport)(wxApi, { ...cloudConfig, functionName: resources.featuresFunction });
    let timer, result;
    try { result = await Promise.race([transport({ ...payload, epoch: origin.epoch, ...(operationKey ? { operationId: attempts.get(token) } : {}) }), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('照片结果尚未确认，请保留页面重试')), options.timeoutMs || 15000); })]); }
    finally { clearTimeout(timer); }
    if (context().key !== origin.key) throw Error('账户已变化，未使用旧照片结果');
    if (!result || result.ok !== true) { const err = Error(result && result.message || '照片结果尚未确认，请重试'); err.code = result && result.code; throw err; }
    return clone(result);
  }
  function apiCall(name, input) { return new Promise((resolve, reject) => {
    if (typeof wxApi[name] !== 'function') { reject(Error('当前微信版本无法处理照片，请升级后重试')); return; }
    wxApi[name]({ ...input, success: resolve, fail: reject });
  }); }
  async function compress(file) {
    let path = file.tempFilePath;
    for (const quality of [70, 50, 30, 15]) {
      const value = await apiCall('compressImage', { src: path, quality, compressedWidth: 1600, compressedHeight: 1600 });
      path = value.tempFilePath;
      const info = await apiCall('getFileInfo', { filePath: path });
      if (Number.isFinite(info.size) && info.size > 0 && info.size <= (config.maxBytes || 2097152)) return path;
    }
    throw Error('压缩后仍超过2MiB，请换一张照片');
  }
  return {
    status: () => ({ enabled: configured() }),
    contextKey: () => context().key,
    async upload(photo, habitId, date) {
      const origin = context().key;
      if (!photo.compressedPath) photo.compressedPath = await compress(photo);
      if (context().key !== origin) throw Error('账户已变化，请重新选择照片');
      if (!photo.mediaId) {
        let mimeType = /\.png(?:$|\?)/i.test(photo.compressedPath) ? 'image/png' : 'image/jpeg';
        if (typeof wxApi.getImageInfo === 'function') { const info = await apiCall('getImageInfo', { src: photo.compressedPath }); if (info.type === 'png') mimeType = 'image/png'; }
        if (context().key !== origin) throw Error('账户已变化，请重新选择照片');
        const response = await request({ action: 'prepareMedia', habitId, date, mimeType }, 'prepare:' + habitId + ':' + date + ':' + photo.localId);
        if (!response.media || typeof response.media.mediaId !== 'string' || typeof response.media.cloudPath !== 'string') throw Error('照片上传申请无效');
        photo.mediaId = response.media.mediaId; photo.cloudPath = response.media.cloudPath;
      }
      if (context().key !== origin) throw Error('账户已变化，请重新选择照片');
      if (!photo.fileId) {
        if (!storage) storage = (options.storageFactory || createCloudStorage)(wxApi, cloudConfig);
        const value = await storage.upload({ cloudPath: photo.cloudPath, filePath: photo.compressedPath });
        if (context().key !== origin) throw Error('账户已变化，未提交旧照片');
        photo.fileId = typeof value === 'string' ? value : value && (value.fileID || value.fileId);
        if (!photo.fileId) throw Error('照片上传未确认，请重试');
      }
      const response = await request({ action: 'confirmMedia', mediaId: photo.mediaId, fileId: photo.fileId }, 'confirm:' + photo.localId);
      if (!response.media || response.media.mediaId !== photo.mediaId || response.media.uploaded !== true) throw Error('照片上传未确认，请重试');
      return { mediaId: photo.mediaId, status: response.media.status, uploaded: true };
    },
    async record(input) { const result = await request({ action: 'getRecordMedia', ...input }); if (!result.recordMedia || !Array.isArray(result.recordMedia.items)) throw Error('照片记录响应无效'); return result.recordMedia; },
    async update(input) {
      const result = await request({ action: 'updateRecordMedia', ...input }, 'update:' + JSON.stringify(input));
      if (!result.recordMedia) throw Error('照片保存结果无效，请核对');
      if (session && typeof session.refresh === 'function') await session.refresh();
      return result.recordMedia;
    }
  };
}
function media() { const app = getApp(); return app.mediaClient || (app.mediaClient = createMediaClient(wx, require('../config/cloud'), require('../config/media'), app.cloudSession)); }
module.exports = { createMediaClient, media };

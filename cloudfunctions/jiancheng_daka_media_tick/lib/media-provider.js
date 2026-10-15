'use strict';
const crypto = require('node:crypto');
const https = require('node:https');
const MAX_BYTES = 2 * 1024 * 1024;
const CLOUD_PATH = /^jiancheng_daka_media\/(uploads|records)\/[a-f0-9]{64}\/[A-Za-z0-9_-]{1,100}\/[a-f0-9]{64}\.(jpg|png)$/;
function imageMetadata(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 8 || bytes.length > MAX_BYTES) throw Error('IMAGE_SIZE_INVALID');
  const mimeType = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png' : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg' : null;
  if (!mimeType) throw Error('IMAGE_TYPE_INVALID');
  return {bytes:bytes.length,mimeType,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
}
function readImage(url, maximum = MAX_BYTES) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !/\.(?:tcb\.qcloud\.la|myqcloud\.com|cloudbase\.net)$/.test(parsed.hostname)) throw Error('STORAGE_URL_INVALID');
  return new Promise((resolve,reject) => {
    const req = https.get(parsed,res => {
      if (res.statusCode !== 200 || Number(res.headers['content-length']) > maximum) { res.destroy(); reject(Error('IMAGE_DOWNLOAD_INVALID')); return; }
      const chunks = []; let length = 0;
      res.on('data',chunk => { length += chunk.length; if (length > maximum) { res.destroy(); reject(Error('IMAGE_SIZE_INVALID')); } else chunks.push(chunk); });
      res.on('end',() => resolve(Buffer.concat(chunks))); res.on('error',reject);
    });
    req.setTimeout(5000,() => req.destroy(Error('IMAGE_DOWNLOAD_TIMEOUT'))); req.on('error',reject);
  });
}
const codeOf = response => response && (response.errCode === undefined ? response.errcode : response.errCode);
function callbackField(xml,key) {
  const match = new RegExp('<'+key+'>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))<\\/'+key+'>').exec(xml);
  return match ? match[1] === undefined ? match[2] : match[1] : undefined;
}
function createMediaProvider(cloud,{fileIdPrefix,appId,callbackToken,encodingAESKey,download=readImage}={}) {
  const assertApp = () => { if (!/^wx[a-f0-9]{16}$/.test(appId || '')) throw Error('MEDIA_APP_ID_REQUIRED'); };
  const assertFile = fileId => {
    if (typeof fileIdPrefix !== 'string' || !/^cloud:\/\/[A-Za-z0-9_.-]+\/$/.test(fileIdPrefix) || typeof fileId !== 'string' ||
      !fileId.startsWith(fileIdPrefix) || !CLOUD_PATH.test(fileId.slice(fileIdPrefix.length))) throw Error('MEDIA_FILE_SCOPE_INVALID');
  };
  const openapi = () => { assertApp(); if (typeof cloud.openapi !== 'function') throw Error('CONSUMER_OPENAPI_UNAVAILABLE'); return cloud.openapi({appid:appId}); };
  const temporaryUrl = async (fileId,seconds=300) => {
    assertFile(fileId); if (!Number.isInteger(seconds) || seconds < 1 || seconds > 1800) throw Error('MEDIA_URL_DURATION_INVALID');
    const response = await cloud.getTempFileURL({fileList:[{fileID:fileId,maxAge:seconds}]});
    const row = response && Array.isArray(response.fileList) && response.fileList[0];
    if (!row || row.fileID !== fileId || row.status !== 0 || typeof row.tempFileURL !== 'string') throw Error('MEDIA_URL_FAILED');
    const parsed = new URL(row.tempFileURL);
    if (parsed.protocol !== 'https:' || !parsed.search || parsed.username || parsed.password) throw Error('MEDIA_PRIVATE_URL_REQUIRED');
    return row.tempFileURL;
  };
  return {
    fileIdFor(cloudPath) { if (!CLOUD_PATH.test(cloudPath)) throw Error('MEDIA_PATH_INVALID'); const id = fileIdPrefix+cloudPath; assertFile(id); return id; },
    owns(fileId,cloudPath) { try { assertFile(fileId); return fileId === fileIdPrefix+cloudPath; } catch (_) { return false; } },
    temporaryUrl,
    async inspect(fileId) { const fileContent = await download(await temporaryUrl(fileId,300),MAX_BYTES); return {...imageMetadata(fileContent),fileContent}; },
    async freeze(media,fileId) {
      let inspected;
      try {
        if (!media || !CLOUD_PATH.test(media.sealedPath) || !media.sealedPath.startsWith('jiancheng_daka_media/records/')) throw Error('MEDIA_SEAL_PATH_INVALID');
        inspected = await this.inspect(fileId);
        if (inspected.mimeType !== media.mimeType) throw Error('IMAGE_TYPE_INVALID');
      } catch (error) { error.freezeStage = 'before-write'; throw error; }
      const response = await cloud.uploadFile({cloudPath:media.sealedPath,fileContent:inspected.fileContent});
      if (!response || !this.owns(response.fileID,media.sealedPath)) throw Error('MEDIA_FREEZE_FAILED');
      const {fileContent,...metadata} = inspected; return {...metadata,fileId:response.fileID};
    },
    async check(media,openid) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(openid || '')) throw Error('MEDIA_OPENID_REQUIRED');
      const response = await openapi().security.mediaCheckAsync({mediaUrl:await temporaryUrl(media.fileId,1800),mediaType:2,version:2,scene:4,openid});
      const traceId = response && (response.traceId || response.trace_id);
      if (codeOf(response) !== 0 || typeof traceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(traceId)) throw Error('MEDIA_CHECK_FAILED');
      return {traceId};
    },
    async checkText(text,openid) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(openid || '') || typeof text !== 'string' || Array.from(text).length > 20) throw Error('TEXT_CHECK_INPUT_INVALID');
      const response = await openapi().security.msgSecCheck({content:text,version:2,scene:1,openid});
      return codeOf(response) === 0 && response.result && response.result.suggest === 'pass';
    },
    async delete(fileIds) {
      if (!Array.isArray(fileIds) || !fileIds.length || fileIds.length > 20) throw Error('MEDIA_DELETE_INPUT_INVALID'); fileIds.forEach(assertFile);
      const response = await cloud.deleteFile({fileList:fileIds});
      if (!response || !Array.isArray(response.fileList) || response.fileList.length !== fileIds.length || response.fileList.some(row => !fileIds.includes(row.fileID) || ![0,-503004].includes(row.status))) throw Error('MEDIA_DELETE_FAILED');
    },
    verifyCallback(event,now=new Date()) {
      assertApp();
      if (typeof callbackToken !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(callbackToken) || typeof encodingAESKey !== 'string' || !/^[A-Za-z0-9+/]{43}$/.test(encodingAESKey)) throw Error('MEDIA_CALLBACK_CONFIG_REQUIRED');
      const query = event && event.queryStringParameters,method = event && event.httpMethod;
      if (!query || !['GET','POST'].includes(method) || !/^[a-f0-9]{40}$/.test(query.msg_signature || '') || !/^\d{10}$/.test(query.timestamp || '') ||
        Math.abs(now.getTime()-Number(query.timestamp)*1000) > 300000 || !/^[A-Za-z0-9_-]{1,100}$/.test(query.nonce || '')) throw Error('MEDIA_CALLBACK_UNAUTHORIZED');
      let encrypted;
      if (method === 'GET') encrypted = query.echostr;
      else {
        if (typeof event.body !== 'string' || event.body.length > 64*1024) throw Error('MEDIA_CALLBACK_INVALID');
        const raw = event.isBase64Encoded ? Buffer.from(event.body,'base64').toString('utf8') : event.body;
        if (/<!DOCTYPE|<!ENTITY/i.test(raw)) throw Error('MEDIA_CALLBACK_INVALID');
        encrypted = raw.trim().startsWith('{') ? JSON.parse(raw).Encrypt : callbackField(raw,'Encrypt');
      }
      if (typeof encrypted !== 'string' || !/^[A-Za-z0-9+/=]{24,65536}$/.test(encrypted)) throw Error('MEDIA_CALLBACK_INVALID');
      const signature = crypto.createHash('sha1').update([callbackToken,query.timestamp,query.nonce,encrypted].sort().join('')).digest('hex');
      if (!crypto.timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(query.msg_signature,'hex'))) throw Error('MEDIA_CALLBACK_UNAUTHORIZED');
      const key = Buffer.from(encodingAESKey+'=','base64'),decipher = crypto.createDecipheriv('aes-256-cbc',key,key.subarray(0,16)); decipher.setAutoPadding(false);
      const plaintext = Buffer.concat([decipher.update(Buffer.from(encrypted,'base64')),decipher.final()]),padding = plaintext[plaintext.length-1];
      if (!padding || padding > 32 || !plaintext.subarray(plaintext.length-padding).every(byte => byte === padding)) throw Error('MEDIA_CALLBACK_INVALID');
      const body = plaintext.subarray(0,plaintext.length-padding); if (body.length < 20) throw Error('MEDIA_CALLBACK_INVALID');
      const length = body.readUInt32BE(16); if (length > body.length-20 || body.subarray(20+length).toString() !== appId) throw Error('MEDIA_CALLBACK_APP_MISMATCH');
      const messageText = body.subarray(20,20+length).toString(); if (method === 'GET') return {handshake:true,echo:messageText};
      const message = messageText.trim().startsWith('{') ? JSON.parse(messageText) : {Event:callbackField(messageText,'Event'),appid:callbackField(messageText,'appid'),trace_id:callbackField(messageText,'trace_id'),errcode:Number(callbackField(messageText,'errcode')),result:{suggest:callbackField(messageText,'suggest')}};
      if (message.Event !== 'wxa_media_check' || message.appid !== appId || !/^[A-Za-z0-9_-]{1,128}$/.test(message.trace_id || '') ||
        !Number.isInteger(message.errcode) || message.errcode === 0 && (!message.result || !['pass','review','risky'].includes(message.result.suggest))) throw Error('MEDIA_CALLBACK_INVALID');
      return {traceId:message.trace_id,status:message.errcode === 0 ? message.result.suggest : 'failed'};
    }
  };
}
module.exports = { MAX_BYTES,CLOUD_PATH,imageMetadata,readImage,createMediaProvider };

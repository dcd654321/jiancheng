const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createMediaProvider,imageMetadata,MAX_BYTES}=require('../server/media-provider');
const {image}=require('./helpers/supervision-fixture.cjs');
const appId='wx58e61dffcbfa4249',callbackToken='local_callback_token_only',key=Buffer.alloc(32,42),encodingAESKey=key.toString('base64').slice(0,-1),now=new Date('2026-10-13T04:00:00Z');
function encryptedEvent(message,{application=appId,method='POST',time=now}={}) {
  const body=Buffer.from(typeof message==='string'?message:JSON.stringify(message)),size=Buffer.alloc(4);size.writeUInt32BE(body.length);
  const raw=Buffer.concat([Buffer.alloc(16,7),size,body,Buffer.from(application)]),padding=32-raw.length%32;
  const cipher=crypto.createCipheriv('aes-256-cbc',key,key.subarray(0,16));cipher.setAutoPadding(false);
  const encrypted=Buffer.concat([cipher.update(Buffer.concat([raw,Buffer.alloc(padding,padding)])),cipher.final()]).toString('base64');
  const query={timestamp:String(Math.floor(time.getTime()/1000)),nonce:'local_nonce'};
  query.msg_signature=crypto.createHash('sha1').update([callbackToken,query.timestamp,query.nonce,encrypted].sort().join('')).digest('hex');
  return {httpMethod:method,queryStringParameters:{...query,...(method==='GET'?{echostr:encrypted}:{})},body:JSON.stringify({Encrypt:encrypted})};
}
test('real WeChat AES envelope verifies signatures, app binding, clock and terminal result',()=>{
  const provider=createMediaProvider({}, {appId,callbackToken,encodingAESKey});
  const payload={Event:'wxa_media_check',appid:appId,trace_id:'trace_1',errcode:0,result:{suggest:'pass'}},event=encryptedEvent(payload);
  assert.deepEqual(provider.verifyCallback(event,now),{traceId:'trace_1',status:'pass'});
  assert.deepEqual(provider.verifyCallback(encryptedEvent('handshake',{method:'GET'}),now),{handshake:true,echo:'handshake'});
  assert.throws(()=>provider.verifyCallback({...event,queryStringParameters:{...event.queryStringParameters,msg_signature:'a'.repeat(40)}},now),/UNAUTHORIZED/);
  assert.throws(()=>provider.verifyCallback(encryptedEvent(payload,{application:'wx1111111111111111'}),now),/APP_MISMATCH/);
  assert.throws(()=>provider.verifyCallback(encryptedEvent(payload,{time:new Date(now.getTime()-301000)}),now),/UNAUTHORIZED/);
  assert.throws(()=>provider.verifyCallback(encryptedEvent({...payload,result:{suggest:'invented'}}),now),/INVALID/);
  assert.throws(()=>provider.verifyCallback({httpMethod:'POST',queryStringParameters:event.queryStringParameters,body:JSON.stringify(payload)},now),/INVALID/);
  assert.deepEqual(provider.verifyCallback(encryptedEvent({...payload,errcode:500}),now),{traceId:'trace_1',status:'failed'});
});
test('provider freezes inspected bytes, limits metadata and never starts an upload for known pre-write errors',async()=>{
  const prefix='cloud://local.test/',owner='a'.repeat(64),draft='jiancheng_daka_media/uploads/'+owner+'/epoch/'+'b'.repeat(64)+'.png',sealed=draft.replace('/uploads/','/records/');
  let bytes=image,uploads=0,lastBytes;
  const cloud={getTempFileURL:async input=>({fileList:[{fileID:input.fileList[0].fileID,status:0,tempFileURL:'https://local.tcb.qcloud.la/object?sign=local'}]}),
    uploadFile:async input=>{uploads++;lastBytes=Buffer.from(input.fileContent);return{fileID:prefix+input.cloudPath};}};
  const provider=createMediaProvider(cloud,{fileIdPrefix:prefix,download:async()=>bytes});
  const frozen=await provider.freeze({mimeType:'image/png',sealedPath:sealed},prefix+draft);
  assert.equal(frozen.mimeType,'image/png');assert.equal(frozen.fileContent,undefined);assert.deepEqual(lastBytes,image);assert.equal(uploads,1);
  bytes=Buffer.alloc(MAX_BYTES+1);await assert.rejects(provider.freeze({mimeType:'image/png',sealedPath:sealed},prefix+draft),error=>error.freezeStage==='before-write'&&error.message==='IMAGE_SIZE_INVALID');
  bytes=Buffer.from('fake image bytes');await assert.rejects(provider.freeze({mimeType:'image/png',sealedPath:sealed},prefix+draft),error=>error.freezeStage==='before-write'&&error.message==='IMAGE_TYPE_INVALID');
  assert.equal(uploads,1);assert.throws(()=>imageMetadata(Buffer.alloc(0)),/SIZE/);
  cloud.uploadFile=async()=>{throw Error('UPLOAD_UNKNOWN');};bytes=image;await assert.rejects(provider.freeze({mimeType:'image/png',sealedPath:sealed},prefix+draft),error=>error.freezeStage===undefined);
});
test('text-only supervision validates consumer app and text without requiring media configuration',async()=>{
  let routed,received;
  const provider=createMediaProvider({openapi:options=>{routed=options;return{security:{msgSecCheck:async input=>{received=input;return{errCode:0,result:{suggest:'pass'}};}}};}},{appId});
  assert.equal(await provider.checkText('小甲','trusted_openid'),true);assert.deepEqual(routed,{appid:appId});assert.equal(received.openid,'trusted_openid');
  await assert.rejects(provider.temporaryUrl('cloud://public/anything'),/SCOPE/);
});

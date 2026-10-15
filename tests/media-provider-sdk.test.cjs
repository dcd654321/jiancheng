const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createMediaProvider}=require('../server/media-provider');
const {image}=require('./helpers/supervision-fixture.cjs');
const sdkPath=path.resolve(__dirname,'../cloudfunctions/jiancheng_daka_api/node_modules/wx-server-sdk');
function fields(bytes){let offset=0;const varint=()=>{let value=0,shift=0,byte;do{byte=bytes[offset++];value+=(byte&127)*2**shift;shift+=7;}while(byte&128);return value;};const out=[];while(offset<bytes.length){const tag=varint(),wire=tag&7,id=tag>>3;if(wire===0)out.push({id,value:varint()});else{assert.equal(wire,2);const length=varint();out.push({id,value:bytes.subarray(offset,offset+length)});offset+=length;}}return out;}
test('locked SDK forwards sealed buffers and private maxAge, routes actual safety APIs to consumer AppID',
{skip:!fs.existsSync(sdkPath)&&'请安装锁定云函数依赖'},async t=>{
  const http=require('node:http'),https=require('node:https'),original={http:http.request,https:https.request,fetch:global.fetch};
  http.request=https.request=global.fetch=()=>{throw Error('MEDIA_SDK_NETWORK_FORBIDDEN');};t.after(()=>{http.request=original.http;https.request=original.https;global.fetch=original.fetch;});
  const cloud=require(sdkPath).createNewInstance({env:'media-sdk-local-only'});let internal;
  cloud.registerService({createService:context=>{internal=context;return{name:'media-provider-contract',getAPIs:()=>({})};}});
  const prefix='cloud://local.test/',owner='a'.repeat(64),draft='jiancheng_daka_media/uploads/'+owner+'/epoch/'+'b'.repeat(64)+'.png',sealed=draft.replace('/uploads/','/records/'),storageCalls=[],openCalls=[];
  const previousInstance=internal.getInstanceForEnv,previousApi=internal.provider.api.callWXOpenAPI;
  internal.getInstanceForEnv=()=>({getTempFileURL:async input=>{storageCalls.push({method:'url',input});return{fileList:input.fileList.map(row=>({fileID:row.fileID,maxAge:row.maxAge,tempFileURL:'https://local.tcb.qcloud.la/object?signature=local'}))};},
    uploadFile:async(input,options)=>{storageCalls.push({method:'upload',input});options.onResponseReceived({statusCode:200});return{fileID:prefix+input.cloudPath};},
    deleteFile:async input=>{storageCalls.push({method:'delete',input});return{fileList:input.fileList.map(fileID=>({fileID}))};}});
  internal.provider.api.callWXOpenAPI=async input=>{const decoded=fields(input.data),pairs=Object.fromEntries(fields(decoded.find(field=>field.id===2).value).map(field=>{const pair=fields(field.value);return[pair.find(item=>item.id===1).value.toString(),JSON.parse(pair.find(item=>item.id===2).value.toString())];}));
    openCalls.push({api:input.api,appId:decoded.find(field=>field.id===6).value.toString(),pairs});return{contentType:'application/json',respData:Buffer.from(JSON.stringify(input.api==='security.mediaCheckAsync'?{errcode:0,trace_id:'sdk_trace'}:{errcode:0,result:{suggest:'pass'}}))};};
  t.after(()=>{internal.getInstanceForEnv=previousInstance;internal.provider.api.callWXOpenAPI=previousApi;});
  const appId='wx58e61dffcbfa4249',provider=createMediaProvider(cloud,{fileIdPrefix:prefix,appId,download:async()=>Buffer.from(image)});
  const frozen=await provider.freeze({mimeType:'image/png',sealedPath:sealed},prefix+draft);assert.equal(frozen.fileId,prefix+sealed);
  assert.deepEqual(storageCalls.find(call=>call.method==='upload').input,{cloudPath:sealed,fileContent:image});
  assert.deepEqual(await provider.check({fileId:frozen.fileId},'trusted_consumer_openid'),{traceId:'sdk_trace'});
  assert.equal(await provider.checkText('小甲','trusted_consumer_openid'),true);await provider.delete([prefix+draft,frozen.fileId]);
  assert.deepEqual(storageCalls.filter(call=>call.method==='url').map(call=>call.input.fileList[0].maxAge),[300,1800]);
  assert.deepEqual(openCalls.map(call=>call.api),['security.mediaCheckAsync','security.msgSecCheck']);
  for(const call of openCalls){assert.equal(call.appId,appId);assert.equal(call.pairs.openid,'trusted_consumer_openid');assert.equal(call.pairs.version,2);}
  assert.equal(openCalls[0].pairs.media_type,2);assert.equal(openCalls[0].pairs.scene,4);assert.equal(openCalls[1].pairs.content,'小甲');
});

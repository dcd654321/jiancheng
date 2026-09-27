const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const { createFeaturesRepository, PREFERENCES, SHARES }=require('../server/features-repository');
const { createSidecarCleanup }=require('../server/sidecar-cleanup');
const { COLLECTION }=require('../server/cloudbase-repository');
const { LIMITS,createLimiter,createLimitRepository }=require('../server/limits');
const { createFeaturesApi,createPublicShareApi }=require('../server/features');
const { fixture,domain,dates }=require('./helpers/cloud-fixture.cjs');
const sdkPath=path.resolve(__dirname,'../cloudfunctions/jiancheng_daka_api/node_modules/wx-server-sdk');

test('feature repositories use installed SDK document transactions, owner-isolated cleanup and fail closed on database faults',
 {skip:!fs.existsSync(sdkPath)&&'请安装锁定的云函数依赖'},async t=>{
  const http=require('node:http'),https=require('node:https');
  const originalHttp=http.request,originalHttps=https.request,originalFetch=global.fetch;
  http.request=https.request=global.fetch=()=>{throw Error('SDK_NETWORK_FORBIDDEN');};
  t.after(()=>{http.request=originalHttp;https.request=originalHttps;global.fetch=originalFetch;});
  const cloud=require(sdkPath);cloud.init({env:'features-contract-local-only'});const db=cloud.database();
  const Db=db._db.constructor,original=Db.reqClass;
  let saved=new Map(),transactions=new Map(),serial=0,fault='',conflict=false;
  const calls=[];
  const copy=v=>JSON.parse(JSON.stringify(v));
  Db.reqClass=class {
    async send(action,params={}) {
      calls.push(action);
      if(action===fault)return {code:'PERMISSION_DENIED',message:'private sdk failure'};
      if(action==='database.startTransaction'){const id='tx-'+(++serial);transactions.set(id,new Map(saved));return {transactionId:id};}
      if(action==='database.commitTransaction') {
        if(conflict){conflict=false;return {code:'DATABASE_TRANSACTION_CONFLICT',message:'database transaction conflict'};}
        saved=transactions.get(params.transactionId);transactions.delete(params.transactionId);return {ok:1};
      }
      if(action==='database.abortTransaction'){transactions.delete(params.transactionId);return {ok:1};}
      assert.ok([COLLECTION,PREFERENCES,SHARES,LIMITS].includes(params.collectionName));
      const target=params.transactionId?transactions.get(params.transactionId):saved;assert.ok(target);
      const query=JSON.parse(params.query),prefix=params.collectionName+':';
      if(action==='database.getDocument') {
        const rows=[...target].filter(([key,value])=>key.startsWith(prefix)&&Object.entries(query).every(([field,value2])=>JSON.parse(value)[field]===value2));
        return {data:{list:rows.slice(0,params.limit||100).map(([,value])=>value)}};
      }
      if(action==='database.modifyDocument') {
        assert.ok(params.transactionId,'all feature writes use transactions');
        const data=JSON.parse(params.data);assert.equal(data._id,undefined,'SDK writes must omit immutable _id');
        target.set(prefix+query._id,JSON.stringify({...data,_id:query._id}));return {data:{updated:1,upsert_id:query._id}};
      }
      if(action==='database.removeDocument') {const existed=target.delete(prefix+query._id);return {data:{deleted:existed?1:0}};}
      throw Error('Unexpected SDK action '+action);
    }
  };
  t.after(()=>{Db.reqClass=original;});
  const f=fixture(),a=await f.seed(),owner=a.accountId;
  saved.set(COLLECTION+':'+owner,JSON.stringify({_id:owner,payload:copy(f.db.get(owner))}));
  const repository=createFeaturesRepository(db),features=createFeaturesApi({repository,domain,dates,allowedAppId:f.identity.APPID,allowedSources:['wx_client'],clock:()=>new Date(f.date+'T04:00:00Z')});
  const publicShare=createPublicShareApi({repository,domain,dates,clock:()=>new Date(f.date+'T04:00:00Z')});
  const req={action:'createShare',epoch:a.epoch,sourceRevision:a.revision,requestDate:f.date,requestId:'a'.repeat(64),kind:'invite'};
  const first=await features(req,f.identity);assert.equal(first.ok,true,JSON.stringify(first));
  const get={action:'getPublicShare',shareId:first.share.shareId};assert.equal((await publicShare(get)).ok,true);
  conflict=true;const replay=await features(req,f.identity);assert.equal(replay.replayed,true);
  assert.equal([...saved.keys()].filter(k=>k.startsWith(SHARES+':')).length,1);
  const set=await features({action:'setPreferences',epoch:a.epoch,operationId:'pin',expectedRevision:0,patch:{pinnedHabitId:'read'}},f.identity);
  assert.equal(set.ok,true,JSON.stringify(set));
  fault='database.getDocument';assert.equal((await features({action:'getPreferences',epoch:a.epoch},f.identity)).code,'SERVICE_UNAVAILABLE');
  assert.equal((await publicShare(get)).code,'SHARE_UNAVAILABLE');fault='';
  // New-epoch preference and unrelated owner must survive a delayed old-epoch cleanup.
  const pref=JSON.parse(saved.get(PREFERENCES+':'+owner));pref.ownerEpoch='new-epoch';saved.set(PREFERENCES+':'+owner,JSON.stringify(pref));
  saved.set(SHARES+':other',JSON.stringify({_id:'other',owner:'other-owner',ownerEpoch:a.epoch}));
  saved.set(SHARES+':new',JSON.stringify({_id:'new',owner,ownerEpoch:'new-epoch'}));
  await createSidecarCleanup(db)(owner,a.epoch);
  assert.equal(saved.has(SHARES+':'+first.share.shareId),false);assert.ok(saved.has(SHARES+':other'));assert.ok(saved.has(SHARES+':new'));
  assert.equal(JSON.parse(saved.get(PREFERENCES+':'+owner)).ownerEpoch,'new-epoch');
  assert.ok(calls.includes('database.abortTransaction'));assert.ok(calls.includes('database.removeDocument'));
  const limiter=createLimiter({repository:createLimitRepository(db),scope:'features',limits:{minute:4,day:10,userMinute:1,userDay:4},clock:()=>Date.parse(f.date+'T04:00:00Z')});
  conflict=true;await limiter(owner,a.epoch);await assert.rejects(limiter(owner,a.epoch),e=>e.code==='RATE_LIMITED');
  assert.equal((await createLimitRepository(db).transact(async tx=>({ok:true,row:await tx.read('global-features')}))).row.minuteUsed,1);
  await createSidecarCleanup(db,{limitsEnabled:true})(owner,'obsolete');assert.ok(saved.has(LIMITS+':features-'+owner));
  await createSidecarCleanup(db,{limitsEnabled:true})(owner,a.epoch);assert.equal(saved.has(LIMITS+':features-'+owner),false);
  assert.equal((await createLimitRepository(db).transact(async tx=>({ok:true,row:await tx.read('global-features')}))).row.minuteUsed,1);
});

const test=require('node:test');
const assert=require('node:assert/strict');
const { featuresFixture }=require('./helpers/features-fixture.cjs');
const { domain,dates,storageFixture,copy,plan }=require('./helpers/cloud-fixture.cjs');
const { createApi }=require('../server/handler');
const { createSyncEngine }=require('../miniprogram/services/sync-engine');
const { syncPresentation }=require('../miniprogram/services/sync-presentation');

async function setup() {
  const f=featuresFixture(),snapshot=await f.seed();
  const share=await f.features(await f.requestShare(),f.identity);
  let fail=true,calls=0,epoch=0,tail=Promise.resolve();
  const repository={transact(owner,operation){const next=tail.then(async()=>{const result=await operation(copy(f.db.get(owner)));f.db.set(owner,copy(result.account));return result.result;});tail=next.catch(()=>{});return next;}};
  const handle=createApi({repository,domain,dates,allowedAppId:f.identity.APPID,allowedSources:['wx_client'],clock:()=>new Date(f.date+'T04:00:00Z'),newEpoch:()=> 'deleted-'+(++epoch),
    cleanup:async(owner,ownerEpoch)=>{calls++;assert.equal(owner,snapshot.accountId);assert.equal(ownerEpoch,snapshot.epoch);if(fail)throw Error('DB secret');
      for(const [id,s] of f.shares)if(s.owner===owner&&s.ownerEpoch===ownerEpoch)f.shares.delete(id);
      if(f.prefs.get(owner)?.ownerEpoch===ownerEpoch)f.prefs.delete(owner);
    }});
  const call=event=>handle(event,f.identity),request={action:'purge',operationId:'cleanup-op',epoch:snapshot.epoch,expectedRevision:snapshot.revision,operationDate:f.date,confirmation:'DELETE_MY_DATA'};
  return {f,snapshot,share,call,request,get calls(){return calls;},finish:()=>{fail=false;}};
}
test('purge failure immediately disables public links, blocks writes and returns no empty snapshot',async()=>{
  const h=await setup(),first=await h.call(h.request);
  assert.equal(first.code,'DELETE_PENDING');assert.equal(first.state,undefined);assert.equal(first.cleanupEpoch,undefined);
  assert.equal((await h.f.publicShare({action:'getPublicShare',shareId:h.share.share.shareId})).code,'SHARE_UNAVAILABLE');
  assert.equal((await h.call({action:'pull'})).code,'DELETE_PENDING');
  assert.equal((await h.call(h.f.request(h.snapshot,{type:'complete',id:'read',date:h.f.date}))).code,'DELETE_PENDING');
  assert.equal((await h.f.features({action:'getPreferences',epoch:h.snapshot.epoch},h.f.identity)).code,'DELETE_PENDING');
  assert.equal(h.f.shares.size,1);
});
test('same purge receipt retries cleanup across midnight; success is only acknowledged after physical cleanup',async()=>{
  const h=await setup();await h.call(h.request);const newEpoch=h.f.db.get(h.snapshot.accountId).epoch;
  h.f.date=dates.shift(h.f.date,1);h.finish();
  const done=await h.call(h.request);assert.equal(done.ok,true);assert.equal(done.epoch,newEpoch);assert.equal(done.state.habits.length,0);
  assert.equal(h.f.shares.size,0);assert.equal(h.f.prefs.size,0);assert.equal(h.calls,2);
  const again=await h.call(h.request);assert.equal(again.ok,true);assert.equal(h.calls,2);
});
test('client saves delete operation before request and resumes it after restart without replacing original data',async()=>{
  const h=await setup(),storage=storageFixture(),sent=[];
  const config={storage,accountId:h.snapshot.accountId,consent:true,clock:()=>h.f.date,newId:()=> 'durable-delete',call:e=>{sent.push(copy(e));return h.call(e);}};
  const client=createSyncEngine(config);client.attach(h.snapshot);
  await assert.rejects(client.purge('DELETE_MY_DATA'),/删除处理中/);
  assert.equal(client.read().deletionPending,true);assert.equal(client.read().state.habits.length,1);
  assert.throws(()=>client.enqueue({type:'complete',id:'read',date:h.f.date}),/删除/);
  await assert.rejects(client.refresh(),/删除/);
  const restarted=createSyncEngine({...config,newId:()=> 'must-not-replace-id'});
  assert.equal(restarted.read().deletionPending,true);
  h.f.date=dates.shift(h.f.date,1);h.finish();
  const done=await restarted.purge('DELETE_MY_DATA');assert.equal(done.deletionPending,false);assert.equal(done.state.habits.length,0);
  assert.deepEqual(sent[0],sent[1]);
  assert.match(syncPresentation({ready:true,deletionPending:true}).syncText,/删除/);
});
test('lost successful deletion acknowledgement cannot be replaced by a background pull, same receipt recovers it',async()=>{
  const h=await setup();h.finish();const storage=storageFixture();let lose=true;
  const client=createSyncEngine({storage,accountId:h.snapshot.accountId,consent:true,clock:()=>h.f.date,newId:()=> 'lost-delete',call:async e=>{const r=await h.call(e);if(lose){lose=false;throw Error('lost');}return r;}});
  client.attach(h.snapshot);await assert.rejects(client.purge('DELETE_MY_DATA'),/lost/);
  const remote=await h.call({action:'pull'});assert.equal(remote.state.habits.length,0);
  assert.throws(()=>client.observeRemote(remote),/删除尚未确认/);assert.equal(client.read().state.habits.length,1);
  await client.purge('DELETE_MY_DATA');assert.equal(client.read().state.habits.length,0);assert.equal(h.calls,1);
});
test('failure to persist delete intent makes no network request, explicit stale-date rejection unlocks confirmation',async()=>{
  const h=await setup(),storage=storageFixture();let calls=0;
  const client=createSyncEngine({storage,accountId:h.snapshot.accountId,consent:true,clock:()=>h.f.date,newId:()=> 'never-sent',call:async()=>{calls++;return {ok:false,code:'RECONFIRM_REQUIRED',message:'重新确认'};}});
  client.attach(h.snapshot);storage.failWrite=true;await assert.rejects(client.purge('DELETE_MY_DATA'),/保存失败/);assert.equal(calls,0);
  storage.failWrite=false;await assert.rejects(client.purge('DELETE_MY_DATA'),/重新确认/);assert.equal(client.read().deletionPending,false);
});
test('new data after a lost purge acknowledgement requires explicit conflict handling instead of re-deletion',async()=>{
  const h=await setup();h.finish();const storage=storageFixture();let lose=true;
  const client=createSyncEngine({storage,accountId:h.snapshot.accountId,consent:true,clock:()=>h.f.date,newId:()=> 'lost-and-advanced',call:async e=>{const r=await h.call(e);if(lose){lose=false;throw Error('lost');}return r;}});
  client.attach(h.snapshot);await assert.rejects(client.purge('DELETE_MY_DATA'));
  const newBase=await h.call({action:'pull'});
  await h.call(h.f.request(newBase,{type:'create',id:'new-plan',startDate:h.f.date,plan:plan()}));
  await assert.rejects(client.purge('DELETE_MY_DATA'),/另一设备/);
  assert.equal(client.read().deletionPending,false);assert.equal(client.read().conflict.code,'DELETE_REMOTE_ADVANCED');
  assert.equal(client.read().state.habits[0].id,'read');
  client.useRemote('DISCARD_PENDING');assert.equal(client.read().state.habits[0].id,'new-plan');
  assert.equal(JSON.parse(client.exportRecovery()).base.state.habits[0].id,'read');
});

const test=require('node:test');
const assert=require('node:assert/strict');
const {featuresFixture}=require('./helpers/features-fixture.cjs');
const {createFeaturesClient}=require('../miniprogram/services/features-client');
const names=require('../miniprogram/config/cloud-resources');
async function setup() {
  const f=featuresFixture(),a=await f.seed(),calls=[];
  const status={ready:true,accountId:a.accountId,epoch:a.epoch,pending:0,conflict:null,phase:'ready'};
  const session={status:()=>({...status})};
  const cloud={enabled:true,envId:'fixture',functionName:names.apiFunction},config={enabled:true,publicShares:true,timeline:true};
  const h={f,status,session,cloud,config,calls,lose:false,fail:false};
  h.factory=(_,options)=>async event=>{
    calls.push({name:options.functionName,event:structuredClone(event)});
    if(h.fail)throw Error('offline');
    const result=options.functionName===names.publicShareFunction?await f.publicShare(event):await f.features(event,f.identity);
    if(h.lose&&event.action==='createShare'){h.lose=false;throw Error('lost');}return result;
  };
  h.client=createFeaturesClient({},cloud,config,session,{transportFactory:h.factory});return h;
}
test('disabled or legacy deployments cannot accidentally call new feature functions',async()=>{
  const h=await setup();
  for(const cloud of [h.cloud,{...h.cloud,functionName:'habitApi'}]) {
    const client=createFeaturesClient({},cloud,{enabled:false,publicShares:true},h.session,{transportFactory:h.factory});
    assert.equal(client.status().enabled,false);await assert.rejects(client.preview({kind:'invite'}),/尚未开放/);
    await assert.rejects(client.publicShare('a'.repeat(64)),/暂未开放/);
  }
  const legacy=createFeaturesClient({},{...h.cloud,functionName:'habitApi'},h.config,h.session,{transportFactory:h.factory});
  assert.equal(legacy.status().enabled,false);assert.equal(h.calls.length,0);
});
test('preferences coalesce reads, cache by account and do not optimistically pin on failure',async()=>{
  const h=await setup();await Promise.all([h.client.preferences(),h.client.preferences()]);
  await h.client.preferences();assert.equal(h.calls.length,1);
  await h.client.setPinned('read');assert.equal(h.client.cachedPreferences().pinnedHabitId,'read');
  h.fail=true;await assert.rejects(h.client.setPinned(null));assert.equal(h.client.cachedPreferences().pinnedHabitId,'read');
  h.status.epoch='another';assert.equal(h.client.cachedPreferences(),null);
});
test('preview is read-only, loss of create response reuses secure server request and never duplicates',async()=>{
  const h=await setup();const preview=await h.client.preview({kind:'plan',sourceHabitId:'read',categoryKey:'read',includeWeekdays:false});
  assert.equal(h.f.shares.size,0);assert.match(preview.request.requestId,/^[a-f0-9]{64}$/);
  h.lose=true;await assert.rejects(h.client.create(preview),/lost/);assert.equal(h.f.shares.size,1);
  const created=await h.client.create(preview);assert.equal(h.f.shares.size,1);
  assert.equal((await h.client.ownShare(created.shareId)).shareId,created.shareId);
  const creations=h.calls.filter(c=>c.event.action==='createShare');assert.deepEqual(creations[0].event,creations[1].event);
  const before=h.calls.length;h.status.epoch='changed';await assert.rejects(h.client.create(preview),/账户/);assert.equal(h.calls.length,before);
});
test('public reader does not require consent or call private account APIs; copied draft is one-time and bound to recipient',async()=>{
  const h=await setup();const p=await h.client.preview({kind:'plan',sourceHabitId:'read',categoryKey:'study',includeWeekdays:true}),s=await h.client.create(p);
  const visitor=createFeaturesClient({},h.cloud,h.config,{status(){throw Error('must not query personal context');}},{transportFactory:h.factory});
  const read=await visitor.publicShare(s.shareId);assert.equal(read.publicSnapshot.kind,'plan');
  assert.equal(h.calls.at(-1).name,names.publicShareFunction);assert.deepEqual(Object.keys(h.calls.at(-1).event),['action','shareId']);
  const token=h.client.handoff(read.publicSnapshot);assert.equal(h.client.consume(token).title,'复习一小段');assert.throws(()=>h.client.consume(token),/过期/);
  const token2=h.client.handoff(read.publicSnapshot);h.status.epoch='new';assert.throws(()=>h.client.consume(token2),/过期/);
});
test('a late response after account switch is rejected and cannot populate another account cache',async()=>{
  const h=await setup();let resolve;
  const client=createFeaturesClient({},h.cloud,h.config,h.session,{transportFactory:()=>()=>new Promise(r=>{resolve=r;})});
  const work=client.preferences();h.status.epoch='changed';resolve({ok:true,preferences:{revision:1,pinnedHabitId:'read',reminderSlot:null}});
  await assert.rejects(work,/账户/);assert.equal(client.cachedPreferences(),null);
});
test('offline, pending deletion and unsynced records prevent online feature mutations',async()=>{
  const h=await setup();
  for(const patch of [{networkOffline:true},{deletionPending:true},{pending:1},{conflict:{code:'CONFLICT'}}]) {
    Object.assign(h.status,patch);await assert.rejects(h.client.preview({kind:'invite'}));
    for(const key of Object.keys(patch))delete h.status[key];
  }
  assert.equal(h.calls.length,0);
});
test('private and public transports reject malformed responses without silently creating new records',async()=>{
  const h=await setup();
  const client=createFeaturesClient({},h.cloud,h.config,h.session,{transportFactory:()=>async()=>({ok:true,items:[{shareId:'bad'}],nextCursor:null,publicSnapshot:{kind:'unknown'}})});
  await assert.rejects(client.list(),/格式/);await assert.rejects(client.publicShare('a'.repeat(64)),/格式/);
});

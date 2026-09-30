const test=require('node:test');
const assert=require('node:assert/strict');
const { featuresFixture }=require('./helpers/features-fixture.cjs');

test('appearance defaults to mist for a new account without creating a preference document',async()=>{
  const f=featuresFixture(),a=await f.seed();
  assert.equal(f.prefs.size,0);
  assert.deepEqual(await f.features({action:'getAppearance',epoch:a.epoch},f.identity),{ok:true,appearance:{revision:0,theme:'mist'}});
  assert.equal(f.prefs.size,0);
});

test('setAppearance saves paper, keeps legacy preference fields and never touches habit state',async()=>{
  const f=featuresFixture(),a=await f.seed();
  await f.features({action:'setPreferences',epoch:a.epoch,operationId:'pin1',expectedRevision:0,patch:{pinnedHabitId:'read'}},f.identity);
  assert.equal(Object.prototype.hasOwnProperty.call(f.prefs.get(a.accountId),'theme'),false);
  assert.deepEqual((await f.features({action:'getAppearance',epoch:a.epoch},f.identity)).appearance,{revision:1,theme:'mist'});
  const account=JSON.stringify(f.db.get(a.accountId));
  assert.deepEqual(await f.features({action:'setAppearance',epoch:a.epoch,operationId:'theme1',expectedRevision:1,theme:'paper'},f.identity),
    {ok:true,appearance:{revision:2,theme:'paper'},replayed:false});
  assert.equal(JSON.stringify(f.db.get(a.accountId)),account);
  assert.deepEqual((await f.features({action:'getAppearance',epoch:a.epoch},f.identity)).appearance,{revision:2,theme:'paper'});
  assert.deepEqual((await f.features({action:'getPreferences',epoch:a.epoch},f.identity)).preferences,{revision:2,pinnedHabitId:'read',reminderSlot:null});
  const doc=f.prefs.get(a.accountId);
  assert.equal(doc.schemaVersion,1);assert.equal(doc.ownerEpoch,a.epoch);
  assert.equal(doc.theme,'paper');assert.equal(doc.pinnedHabitId,'read');assert.equal(doc.reminderSlot,null);
  assert.deepEqual(doc.shareIndex,[]);assert.deepEqual(doc.dailyCreates,{date:'',requests:[]});
  assert.deepEqual(doc.preferenceReceipts.map(r=>r.id),['pin1','theme1']);
  await f.features({action:'setPreferences',epoch:a.epoch,operationId:'pin2',expectedRevision:2,patch:{reminderSlot:'08:00'}},f.identity);
  assert.equal((await f.features({action:'getAppearance',epoch:a.epoch},f.identity)).appearance.theme,'paper');
  assert.deepEqual((await f.features({action:'getPreferences',epoch:a.epoch},f.identity)).preferences,{revision:3,pinnedHabitId:'read',reminderSlot:'08:00'});
});

test('same-identifier appearance replay neither writes nor advances revision and changed payload is rejected',async()=>{
  const f=featuresFixture(),a=await f.seed();
  const set={action:'setAppearance',epoch:a.epoch,operationId:'theme1',expectedRevision:0,theme:'paper'};
  assert.deepEqual(await f.features(set,f.identity),{ok:true,appearance:{revision:1,theme:'paper'},replayed:false});
  const snapshot=JSON.stringify([...f.prefs]);
  assert.deepEqual(await f.features(set,f.identity),{ok:true,appearance:{revision:1,theme:'paper'},replayed:true});
  assert.equal(JSON.stringify([...f.prefs]),snapshot);
  assert.equal((await f.features({...set,theme:'mist'},f.identity)).code,'IDEMPOTENCY_MISMATCH');
  assert.equal(JSON.stringify([...f.prefs]),snapshot);
});

test('stale appearance revision conflicts without writing while replaying the old success returns the current theme',async()=>{
  const f=featuresFixture(),a=await f.seed();
  const reqA={action:'setAppearance',epoch:a.epoch,operationId:'opA',expectedRevision:0,theme:'paper'};
  await f.features(reqA,f.identity);
  await f.features({action:'setAppearance',epoch:a.epoch,operationId:'opB',expectedRevision:1,theme:'mist'},f.identity);
  const snapshot=JSON.stringify([...f.prefs]);
  assert.equal((await f.features({...reqA,operationId:'opC'},f.identity)).code,'CONFLICT');
  assert.equal(JSON.stringify([...f.prefs]),snapshot);
  assert.deepEqual(await f.features(reqA,f.identity),{ok:true,appearance:{revision:2,theme:'mist'},replayed:true});
  assert.equal(JSON.stringify([...f.prefs]),snapshot);
});

test('appearance requests reject malformed fields and identity injections without writing',async()=>{
  const f=featuresFixture(),a=await f.seed();
  const base={action:'setAppearance',epoch:a.epoch,operationId:'op1',expectedRevision:0,theme:'paper'};
  const invalid=[{...base,theme:'dark'},{...base,theme:''},{...base,theme:{}},{...base,theme:['paper']},{...base,theme:null},{...base,theme:undefined},
    {...base,themeOn:true},{...base,expectedRevision:-1},{...base,expectedRevision:1.5},{...base,expectedRevision:'1'},{...base,expectedRevision:null},
    {...base,operationId:''},{...base,operationId:'bad id'},{...base,operationId:['x']},{...base,operationId:null},{...base,operationId:'__proto__'},
    {...base,epoch:'bad epoch!'},{...base,owner:'x'},{...base,accountId:'x'},{...base,openid:'x'},{...base,OPENID:'x'},{...base,appearance:{theme:'paper'}},
    {action:'setAppearance',epoch:a.epoch,operationId:'op1',expectedRevision:0},
    {action:'getAppearance',epoch:a.epoch,accountId:'x'},{action:'getAppearance',epoch:''},{action:'getAppearance',epoch:a.epoch,theme:'paper'}];
  for(const event of invalid) assert.equal((await f.features(event,f.identity)).code,'INVALID_REQUEST',JSON.stringify(event));
  assert.equal(f.prefs.size,0);
});

test('corrupt stored theme reports PREFERENCES_CORRUPT to appearance actions without repair or write',async()=>{
  const f=featuresFixture(),a=await f.seed();
  await f.features({action:'setAppearance',epoch:a.epoch,operationId:'op1',expectedRevision:0,theme:'paper'},f.identity);
  f.prefs.get(a.accountId).theme='dark';
  const snapshot=JSON.stringify([...f.prefs]);
  assert.equal((await f.features({action:'getAppearance',epoch:a.epoch},f.identity)).code,'PREFERENCES_CORRUPT');
  assert.equal((await f.features({action:'setAppearance',epoch:a.epoch,operationId:'op2',expectedRevision:1,theme:'mist'},f.identity)).code,'PREFERENCES_CORRUPT');
  assert.equal(JSON.stringify([...f.prefs]),snapshot);
  assert.equal((await f.features({action:'getPreferences',epoch:a.epoch},f.identity)).code,'SERVICE_UNAVAILABLE');
  assert.equal(JSON.stringify([...f.prefs]),snapshot);
  f.prefs.get(a.accountId).theme='paper';f.prefs.get(a.accountId).revision=-1;
  assert.equal((await f.features({action:'getAppearance',epoch:a.epoch},f.identity)).code,'SERVICE_UNAVAILABLE');
  assert.equal((await f.features({action:'getPreferences',epoch:a.epoch},f.identity)).code,'SERVICE_UNAVAILABLE');
});

test('appearance is isolated per trusted account and appearance reads never create documents',async()=>{
  const f=featuresFixture(),a=await f.seed();
  await f.features({action:'setAppearance',epoch:a.epoch,operationId:'opA',expectedRevision:0,theme:'paper'},f.identity);
  const other={...f.identity,OPENID:'user_b'},b=await f.api({action:'pull'},other);
  assert.deepEqual((await f.features({action:'getAppearance',epoch:b.epoch},other)).appearance,{revision:0,theme:'mist'});
  assert.equal(f.prefs.size,1);
  assert.equal((await f.features({action:'getAppearance',epoch:a.epoch},other)).code,'EPOCH_CHANGED');
  assert.deepEqual((await f.features({action:'getAppearance',epoch:a.epoch},f.identity)).appearance,{revision:1,theme:'paper'});
  assert.deepEqual((await f.features({action:'getPreferences',epoch:b.epoch},other)).preferences,{revision:0,pinnedHabitId:null,reminderSlot:null});
});

test('public share projections never expose the stored appearance theme',async()=>{
  const f=featuresFixture(),a=await f.seed();
  await f.features({action:'setAppearance',epoch:a.epoch,operationId:'opA',expectedRevision:0,theme:'paper'},f.identity);
  const created=await f.features(await f.requestShare(),f.identity);assert.equal(created.ok,true);
  const publicResult=await f.publicShare({action:'getPublicShare',shareId:created.share.shareId});
  assert.equal(publicResult.ok,true);
  assert.doesNotMatch(JSON.stringify(publicResult),/theme|mist|paper|preference/i);
  const mine=await f.features({action:'getMyShare',epoch:a.epoch,shareId:created.share.shareId},f.identity);
  assert.doesNotMatch(JSON.stringify(mine),/theme|mist|paper|preference/i);
  assert.doesNotMatch(JSON.stringify(f.shares.get(created.share.shareId)),/theme|mist|paper/i);
  assert.equal((await f.features({action:'getAppearance',epoch:a.epoch},f.identity)).appearance.theme,'paper');
});

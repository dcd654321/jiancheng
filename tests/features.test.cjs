const test=require('node:test');
const assert=require('node:assert/strict');
const { featuresFixture }=require('./helpers/features-fixture.cjs');
const { dates }=require('./helpers/cloud-fixture.cjs');
const { PUBLIC_UNAVAILABLE }=require('../server/features');

test('share identifiers never accept coercible arrays and late requests cannot roll daily counters backwards',async()=>{
  const f=featuresFixture(),a=await f.seed(),req=await f.requestShare(),id='a'.repeat(64);
  for(const [action,patch] of [['getMyShare',{shareId:[id]}],['listMyShares',{cursor:[id]}],['createShare',{...req,requestId:[id]}]]) {
    assert.equal((await f.features({epoch:a.epoch,action,...patch},f.identity)).code,'INVALID_REQUEST');
  }
  assert.deepEqual(await f.publicShare({action:'getPublicShare',shareId:[id]}),PUBLIC_UNAVAILABLE);
  assert.equal((await f.features(req,f.identity)).ok,true);
  f.prefs.get(a.accountId).dailyCreates.date=dates.shift(f.date,1);
  const before=JSON.stringify([...f.prefs]);
  assert.equal((await f.features(await f.requestShare(),f.identity)).code,'RECONFIRM_REQUIRED');
  assert.equal(JSON.stringify([...f.prefs]),before);
});

test('features require trusted identity, matching epoch and an existing account without creating one',async()=>{
  const f=featuresFixture();
  const get={action:'getPreferences',epoch:'epoch-1'};
  assert.equal((await f.features(get,f.identity)).code,'ACCOUNT_REQUIRED'); assert.equal(f.db.size,0);
  await f.seed();
  for(const identity of [{},{...f.identity,APPID:'other'},{...f.identity,SOURCE:'http'}]) assert.equal((await f.features(get,identity)).code,'UNAUTHORIZED');
  assert.equal((await f.features({...get,owner:'injected'},f.identity)).code,'INVALID_REQUEST');
  assert.equal((await f.features({...get,epoch:'obsolete'},f.identity)).code,'EPOCH_CHANGED');
  assert.equal(f.prefs.size,0);
});
test('preferences CAS is isolated and same operation replay does not overwrite newer values',async()=>{
  const f=featuresFixture(), a=await f.seed();
  const get={action:'getPreferences',epoch:a.epoch};
  assert.deepEqual((await f.features(get,f.identity)).preferences,{revision:0,pinnedHabitId:null,reminderSlot:null});
  const set={action:'setPreferences',epoch:a.epoch,operationId:'pin1',expectedRevision:0,patch:{pinnedHabitId:'read'}};
  const [one,two]=await Promise.all([f.features(set,f.identity),f.features({...set,operationId:'pin2',patch:{reminderSlot:'08:00'}},f.identity)]);
  assert.equal(one.ok,true);assert.equal(two.code,'CONFLICT');
  assert.equal((await f.features({...set,operationId:'clear',expectedRevision:1,patch:{pinnedHabitId:null}},f.identity)).preferences.revision,2);
  assert.equal((await f.features(set,f.identity)).preferences.pinnedHabitId,null);
  assert.equal((await f.features({...set,patch:{pinnedHabitId:null}},f.identity)).code,'IDEMPOTENCY_MISMATCH');
  const other={...f.identity,OPENID:'user_b'}, b=await f.api({action:'pull'},other);
  assert.equal((await f.features({...get,epoch:b.epoch},other)).preferences.revision,0);
  assert.equal((await f.features({...set,epoch:b.epoch},other)).code,'INVALID_REQUEST');
});
test('server preview and created plan never contain custom title, time, notes or identity',async()=>{
  const f=featuresFixture(),a=await f.seed();
  await f.mutate({type:'note',id:'read',date:f.date,note:'private note'});
  const req=await f.requestShare('plan',{sourceHabitId:'read',categoryKey:'read',includeWeekdays:false});
  const preview=await f.features({action:'previewShare',epoch:a.epoch,kind:'plan',sourceHabitId:'read',categoryKey:'read',includeWeekdays:false},f.identity);
  assert.deepEqual(preview.publicSnapshot,{kind:'plan',categoryKey:'read',target:5,minimum:2,unit:'分钟'});
  assert.match(preview.requestId,/^[a-f0-9]{64}$/);
  const result=await f.features(req,f.identity); assert.equal(result.ok,true);
  assert.deepEqual(result.share.publicSnapshot,preview.publicSnapshot);
  const publicResult=await f.publicShare({action:'getPublicShare',shareId:result.share.shareId});
  assert.equal(publicResult.ok,true);
  assert.doesNotMatch(JSON.stringify(publicResult),/private|读一会儿|12:30|owner|epoch|revision|requestId|openid/i);
  assert.equal((await f.features({...req,title:'leak'},f.identity)).code,'INVALID_REQUEST');
});
test('stale preview rejected, duplicate create is atomic, changed request rejected and deleted share cannot be republished by retry',async()=>{
  const f=featuresFixture();await f.seed();let req=await f.requestShare();
  await f.mutate({type:'complete',id:'read',date:f.date});
  assert.equal((await f.features(req,f.identity)).code,'PREVIEW_CHANGED');
  req=await f.requestShare();
  const results=await Promise.all(Array.from({length:6},()=>f.features(req,f.identity)));
  assert.ok(results.every(r=>r.ok));assert.equal(f.shares.size,1);
  assert.equal((await f.features({...req,sourceRevision:999},f.identity)).code,'IDEMPOTENCY_MISMATCH');
  const shareId=results[0].share.shareId;
  assert.equal((await f.features({action:'deleteShare',epoch:req.epoch,shareId},f.identity)).ok,true);
  assert.equal((await f.features(req,f.identity)).code,'SHARE_UNAVAILABLE');assert.equal(f.shares.size,0);
  f.date=dates.shift(f.date,1);assert.equal((await f.features(req,f.identity)).code,'RECONFIRM_REQUIRED');
});
test('daily create budget survives deletion and concurrent requests; rejected writes roll back',async()=>{
  const f=featuresFixture();await f.seed();const requests=[];
  for(let i=0;i<12;i++)requests.push(await f.requestShare());
  const results=await Promise.all(requests.map(r=>f.features(r,f.identity)));
  assert.equal(results.filter(r=>r.ok).length,10);assert.equal(f.shares.size,10);
  await f.features({action:'deleteShare',epoch:requests[0].epoch,shareId:results[0].share.shareId},f.identity);
  assert.equal((await f.features(await f.requestShare(),f.identity)).code,'RATE_LIMITED');
  f.date=dates.shift(f.date,1);f.failFeaturesWrite=true;
  const before=JSON.stringify([...f.prefs]);
  const result=await f.features(await f.requestShare(),f.identity);
  assert.equal(result.code,'SERVICE_UNAVAILABLE');assert.doesNotMatch(JSON.stringify(result),/secret|sdk/);
  assert.equal(f.shares.size,9);assert.equal(JSON.stringify([...f.prefs]),before);
});
test('my shares paginate newest first and another owner cannot list or mutate them',async()=>{
  const f=featuresFixture();const a=await f.seed(),ids=[];
  for(let d=0;d<3;d++) {for(let i=0;i<8;i++) ids.unshift((await f.features(await f.requestShare(),f.identity)).share.shareId);f.date=dates.shift(f.date,1);}
  const req={action:'listMyShares',epoch:a.epoch};
  const first=await f.features(req,f.identity);assert.deepEqual(first.items.map(r=>r.shareId),ids.slice(0,20));
  const second=await f.features({...req,cursor:first.nextCursor},f.identity);assert.deepEqual(second.items.map(r=>r.shareId),ids.slice(20));assert.equal(second.nextCursor,null);
  const other={...f.identity,OPENID:'other'},b=await f.api({action:'pull'},other);
  assert.deepEqual((await f.features({...req,epoch:b.epoch},other)).items,[]);
  for(const action of ['getMyShare','revokeShare','deleteShare']) assert.equal((await f.features({action,epoch:b.epoch,shareId:ids[0]},other)).code,'SHARE_UNAVAILABLE');
  assert.equal(f.shares.size,24);
  assert.equal((await f.features({...req,cursor:'f'.repeat(64)},f.identity)).code,'CURSOR_EXPIRED');
});
test('public responses uniformly fail for revoke, expiry, epoch changes, cleanup and read outages',async()=>{
  const f=featuresFixture(),a=await f.seed();const created=await f.features(await f.requestShare(),f.identity);
  const shareId=created.share.shareId,get={action:'getPublicShare',shareId};
  assert.equal((await f.publicShare(get)).ok,true);
  const original=structuredClone(f.shares.get(shareId));
  for(const patch of [{status:'revoked'},{expiresAt:'2000-01-01T00:00:00Z'},{expiresAt:'invalid'},{ownerEpoch:'old'},{owner:'not-an-id'}, {publicSnapshot:{kind:'invite',coverKey:'default',templateKeys:['read','walk','study'],note:'private'}}]) {
    f.shares.set(shareId,{...original,...patch}); assert.deepEqual(await f.publicShare(get),PUBLIC_UNAVAILABLE);
  }
  f.shares.set(shareId,original);f.db.get(a.accountId).cleanupPending=true;
  assert.deepEqual(await f.publicShare(get),PUBLIC_UNAVAILABLE);delete f.db.get(a.accountId).cleanupPending;
  f.failRead=true;assert.deepEqual(await f.publicShare(get),PUBLIC_UNAVAILABLE);f.failRead=false;
  assert.deepEqual(await f.publicShare({...get,owner:a.accountId}),PUBLIC_UNAVAILABLE);
  assert.deepEqual(await f.publicShare({action:'listMyShares'}),PUBLIC_UNAVAILABLE);
  await f.features({action:'revokeShare',epoch:a.epoch,shareId},f.identity);
  assert.deepEqual(await f.publicShare(get),PUBLIC_UNAVAILABLE);
  assert.equal((await f.features({action:'listMyShares',epoch:a.epoch},f.identity)).items[0].status,'revoked');
  const own=await f.features({action:'getMyShare',epoch:a.epoch,shareId},f.identity);
  assert.equal(own.share.status,'revoked');assert.equal(own.share.publicSnapshot.kind,'invite');
});
test('weekly share uses seven completed calendar days and refuses empty progress',async()=>{
  const f=featuresFixture();await f.seed();
  assert.equal((await f.features(await f.requestShare('weekly',{captionKey:'small-steps'}),f.identity)).code,'NO_PROGRESS');
  await f.mutate({type:'completeMinimum',id:'read',date:f.date});
  assert.equal((await f.features(await f.requestShare('weekly',{captionKey:'small-steps'}),f.identity)).code,'NO_PROGRESS');
  f.date=dates.shift(f.date,1);
  const result=await f.features(await f.requestShare('weekly',{captionKey:'small-steps'}),f.identity);
  assert.equal(result.ok,true);assert.equal(result.share.publicSnapshot.minimum,1);assert.equal(result.share.publicSnapshot.standard,0);
  assert.equal(result.share.publicSnapshot.endDate,dates.shift(f.date,-1));
});
test('active fifty-share ceiling and total history ceiling remain effective across daily resets',async()=>{
  const f=featuresFixture(),a=await f.seed();let first;
  for(let d=0;d<5;d++) {for(let i=0;i<10;i++) {const r=await f.features(await f.requestShare(),f.identity);assert.equal(r.ok,true);first=first||r.share.shareId;}f.date=dates.shift(f.date,1);}
  assert.equal((await f.features(await f.requestShare(),f.identity)).code,'RATE_LIMITED');
  await f.features({action:'revokeShare',epoch:a.epoch,shareId:first},f.identity);
  assert.equal((await f.features(await f.requestShare(),f.identity)).ok,true);
  const pref=f.prefs.get(a.accountId);
  pref.shareIndex=Array.from({length:200},(_,i)=>({id:i.toString(16).padStart(64,'0'),createdAt:'2020-01-01T00:00:00Z',expiresAt:'2020-04-01T00:00:00Z',status:'revoked'}));
  assert.equal((await f.features(await f.requestShare(),f.identity)).code,'RATE_LIMITED');
});

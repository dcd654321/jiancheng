const test=require('node:test'),assert=require('node:assert/strict');
const {supervisionFixture}=require('./helpers/supervision-fixture.cjs');
const {listReminderRelations}=require('../server/supervision');
test('invitation requires applicant plus subject confirmation and cannot expose records before it',async()=>{
  const f=await supervisionFixture(),created=await f.request('createSupervisionInvite',{habitId:'read',displayName:'小甲'}),id=created.invite.inviteId;
  assert.equal(created.invite.rules.durationDays,7);assert.equal(created.invite.rules.deadline,'21:00');
  const view=await f.request('getSupervisionInvite',{inviteId:id},f.c);assert.equal(view.canApply,true);assert.equal(view.invite.applicant,undefined);
  assert.equal((await f.request('applySupervision',{inviteId:id},f.b)).ok,true);
  assert.equal((await f.request('applySupervision',{inviteId:id},f.c)).code,'INVITE_APPLIED');
  assert.equal((await f.request('confirmSupervision',{inviteId:id},f.b)).code,'INVITE_UNAVAILABLE');
  const confirmed=await f.request('confirmSupervision',{inviteId:id}),relationId=confirmed.supervision.supervisionId;
  assert.equal((await f.request('getSupervision',{supervisionId:relationId},f.c)).code,'SUPERVISION_UNAVAILABLE');
  assert.equal((await f.request('createSupervisionInvite',{habitId:'read'})).code,'SUPERVISION_EXISTS');
  const repeat=await f.request('confirmSupervision',{inviteId:id});assert.equal(repeat.supervision.supervisionId,relationId);assert.equal(f.tables.relations.size,1);
});
test('invitation expires after 48 hours and mismatched idempotency rejects',async()=>{
  const f=await supervisionFixture(),first=await f.request('createSupervisionInvite',{habitId:'read',operationId:'same'});
  assert.equal((await f.request('createSupervisionInvite',{habitId:'read',operationId:'same'})).replayed,true);
  assert.equal((await f.request('createSupervisionInvite',{habitId:'read',operationId:'same',durationDays:14})).code,'IDEMPOTENCY_MISMATCH');
  f.now=new Date(f.now.getTime()+48*3600000);
  assert.equal((await f.request('applySupervision',{inviteId:first.invite.inviteId},f.b)).code,'INVITE_EXPIRED');
});

test('idempotent supervision receipts revalidate expiry, ended relationships and deleted counterpart epochs',async()=>{
  const f=await supervisionFixture(),invite=await f.request('createSupervisionInvite',{habitId:'read',operationId:'invite-once'}),inviteId=invite.invite.inviteId;
  const fields={inviteId,operationId:'apply-once'};await f.request('applySupervision',fields,f.b);
  const confirm={inviteId,operationId:'confirm-once'},created=await f.request('confirmSupervision',confirm),id=created.supervision.supervisionId;
  await f.request('endSupervision',{supervisionId:id,expectedRevision:1},f.b);
  assert.equal((await f.request('applySupervision',fields,f.b)).code,'INVITE_UNAVAILABLE');
  const replay=await f.request('confirmSupervision',confirm);assert.equal(replay.replayed,true);assert.equal(replay.supervision.status,'ended');assert.equal(replay.supervision.habitId,undefined);
  f.tables.accounts.get(f.owner(f.a)).epoch='purged-epoch';
  assert.equal((await f.request('applySupervision',fields,f.b)).code,'INVITE_UNAVAILABLE');
  const expired=await supervisionFixture();await expired.request('createSupervisionInvite',{habitId:'read',operationId:'old-invite'});expired.now=new Date(expired.now.getTime()+49*3600000);
  assert.equal((await expired.request('createSupervisionInvite',{habitId:'read',operationId:'old-invite'})).code,'INVITE_UNAVAILABLE');
});
test('future rule changes preserve today and minimum completion is completed',async()=>{
  const f=await supervisionFixture(),a=await f.agreement(),id=a.supervision.supervisionId;
  await f.mutate({type:'note',id:'read',date:'2026-10-13',note:'private note must never leak'});
  await f.mutate({type:'completeMinimum',id:'read',date:'2026-10-13'});
  const next=await f.request('updateSupervision',{supervisionId:id,expectedRevision:1,photoRequired:true,deadline:'22:00'});
  assert.equal(next.supervision.rules.photoRequired,false);assert.equal(next.supervision.pendingRules.photoRequired,true);
  const detail=await f.request('getSupervision',{supervisionId:id},f.b);
  assert.equal(detail.today.status,'minimum');assert.equal(JSON.stringify(detail).includes('private note'),false);
  assert.equal(JSON.stringify(detail).includes(f.owner(f.a)),false);assert.equal(detail.supervision.habitId,undefined);
  f.now=new Date('2026-10-14T04:00:00Z');
  assert.equal((await f.request('getSupervision',{supervisionId:id},f.b)).today.photoRequired,true);
});
test('fixed encouragement is once per completed day and never changes completion',async()=>{
  const f=await supervisionFixture(),agreement=await f.agreement(),id=agreement.supervision.supervisionId;
  assert.equal((await f.request('encourageSupervision',{supervisionId:id,date:'2026-10-13',kind:'encourage'},f.b)).code,'NOT_COMPLETED');
  await f.mutate({type:'complete',id:'read',date:'2026-10-13'});
  const first=await f.request('encourageSupervision',{supervisionId:id,date:'2026-10-13',kind:'encourage'},f.b);
  const repeated=await f.request('encourageSupervision',{supervisionId:id,date:'2026-10-13',kind:'encourage'},f.b);
  assert.deepEqual(first.encouragement,repeated.encouragement);assert.equal(f.tables.relations.get(id).encouragements.length,1);
  assert.equal((await f.request('getSupervision',{supervisionId:id})).today.encouraged,true);
  assert.equal((await f.request('getSupervision',{supervisionId:id},f.b)).today.encouragedAt,first.encouragement.createdAt);
  assert.equal((await f.pull()).state.records['read@2026-10-13'].status,'standard');
});
test('either party can end immediately; renewed account cannot reuse old relationship',async()=>{
  const f=await supervisionFixture(),agreement=await f.agreement(),id=agreement.supervision.supervisionId;
  const ended=await f.request('endSupervision',{supervisionId:id,expectedRevision:1},f.b);assert.equal(ended.supervision.status,'ended');
  assert.equal((await f.request('getSupervision',{supervisionId:id})).code,'SUPERVISION_UNAVAILABLE');
  const g=await supervisionFixture(),other=(await g.agreement()).supervision.supervisionId;
  g.tables.accounts.get(g.owner(g.b)).epoch='new-supervisor';
  assert.equal((await g.request('getSupervision',{supervisionId:other})).code,'SUPERVISION_UNAVAILABLE');
});
test('supervisor reminder scopes filter rests, ended relations and both epochs',async()=>{
  const f=await supervisionFixture(),agreement=await f.agreement(),id=agreement.supervision.supervisionId;
  const run=()=>f.repository.transact(f.owner(f.b),tx=>listReminderRelations(tx,{supervisor:f.owner(f.b),supervisorEpoch:f.tables.accounts.get(f.owner(f.b)).epoch,relationIds:[id],businessDate:'2026-10-13',now:f.clock(),domain:f.domain,dates:f.dates}));
  assert.equal((await run())[0].status,'pending');
  f.tables.accounts.get(f.owner(f.a)).epoch='renewed';assert.deepEqual(await run(),[]);
});

test('already completed confirmation starts tomorrow, hides old photos and reserves the habit',async()=>{
  const f=await supervisionFixture(),photo=await f.photo();
  await f.mutate({type:'complete',id:'read',date:'2026-10-13',mediaIds:[photo.media.mediaId]});
  const first=await f.request('createSupervisionInvite',{habitId:'read'});
  await f.request('applySupervision',{inviteId:first.invite.inviteId},f.b);
  // A previously issued duplicate invitation must not reserve a second future relationship.
  const duplicateId='e'.repeat(64),duplicate={...f.tables.invites.get(first.invite.inviteId),_id:duplicateId,applicant:{owner:f.owner(f.c),epoch:f.tables.accounts.get(f.owner(f.c)).epoch,displayName:'第三人'}};f.tables.invites.set(duplicateId,duplicate);
  const confirmed=await f.request('confirmSupervision',{inviteId:first.invite.inviteId}),id=confirmed.supervision.supervisionId;
  assert.equal(confirmed.supervision.status,'scheduled');assert.equal(confirmed.supervision.startDate,'2026-10-14');assert.equal(confirmed.supervision.endDate,'2026-10-20');
  assert.equal(confirmed.supervision.today,null);assert.deepEqual(confirmed.supervision.habitPlan,{target:5,minimum:2,unit:'分钟',time:'12:30',weekdays:[1,2,3,4,5,6,7]});
  assert.deepEqual((await f.request('getSupervision',{supervisionId:id},f.b)).days,[]);
  assert.equal((await f.mediaRequest('getRecordMedia',{supervisionId:id,date:'2026-10-13'},f.b)).code,'MEDIA_UNAVAILABLE');
  assert.equal((await f.request('confirmSupervision',{inviteId:duplicateId})).code,'SUPERVISION_EXISTS');
  assert.equal((await f.request('createSupervisionInvite',{habitId:'read'})).code,'SUPERVISION_EXISTS');
  assert.equal((await f.request('updateSupervision',{supervisionId:id,expectedRevision:1,deadline:'22:00'})).ok,true);
  const scope=await f.repository.transact(f.owner(f.b),tx=>listReminderRelations(tx,{supervisor:f.owner(f.b),supervisorEpoch:f.tables.accounts.get(f.owner(f.b)).epoch,relationIds:[id],businessDate:'2026-10-13',now:f.clock(),domain:f.domain,dates:f.dates}));
  assert.deepEqual(scope,[]);
  f.now=new Date('2026-10-14T04:00:00Z');
  const next=await f.request('getSupervision',{supervisionId:id},f.b);assert.equal(next.supervision.status,'active');assert.equal(next.days.length,1);assert.equal(next.today.deadline,'22:00');
  assert.equal((await f.mediaRequest('getRecordMedia',{supervisionId:id,date:'2026-10-13'},f.b)).code,'MEDIA_UNAVAILABLE');
});

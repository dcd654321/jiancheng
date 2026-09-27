const test=require('node:test');
const assert=require('node:assert/strict');
const {reminderFixture}=require('./helpers/reminder-fixture.cjs');
const {createRecipientCodec,recipientAAD}=require('../server/reminders');
const {authorizeTimer,createSender}=require('../server/reminder-worker');
const {dates}=require('./helpers/cloud-fixture.cjs');

test('reminder preview selects Beijing future scheduled date without writing and rejects identity, extra fields and rejected authorization',async()=>{
  const f=reminderFixture(),a=await f.seed(),preview=await f.preview();
  assert.equal(preview.businessDate,f.date);assert.equal(preview.dueAt,f.date+'T04:30:00.000Z');assert.equal(f.reminders.size,0);
  const morning=await f.preview('08:00');assert.equal(morning.businessDate,dates.shift(f.date,1));
  const request={action:'scheduleReminder',epoch:a.epoch,...preview,subscriptionResult:'accept'};delete request.templateId;
  assert.equal((await f.reminderApi({...request,subscriptionResult:'reject'})).code,'INVALID_REQUEST');
  assert.equal((await f.reminderApi({...request,recipient:'injected'})).code,'INVALID_REQUEST');
  assert.equal((await f.reminderApi(request,{...f.identity,APPID:'other'})).code,'UNAUTHORIZED');
  assert.equal(f.reminders.size,0);
  await f.mutate({type:'complete',id:'read',date:f.date});assert.equal((await f.schedule(preview)).code,'PREVIEW_CHANGED');
});
test('same-day concurrent scheduling creates one encrypted recipient record and replay/cancel/resubscribe never revives an old request',async()=>{
  const f=reminderFixture(),a=await f.seed(),preview=await f.preview();
  const results=await Promise.all(Array.from({length:6},()=>f.schedule(preview)));assert.ok(results.every(r=>r.ok));assert.equal(f.reminders.size,1);
  const [record]=f.reminders.values();assert.doesNotMatch(JSON.stringify([...f.reminders]),new RegExp(f.identity.OPENID));
  assert.equal(f.codec.open(record.recipient,recipientAAD(record)),f.identity.OPENID);
  assert.doesNotMatch(JSON.stringify(results),/recipient|owner|epoch|operationId/);
  const cancel={action:'cancelReminder',epoch:a.epoch,businessDate:f.date,generation:1};assert.equal((await f.reminderApi(cancel)).reminder.status,'cancelled');
  assert.equal((await f.schedule(preview)).reminder.status,'cancelled');
  const next=await f.preview();assert.equal((await f.schedule(next)).reminder.generation,2);
  assert.equal((await f.reminderApi(cancel)).code,'CONFLICT');
  assert.equal((await f.reminderApi({action:'getReminders',epoch:'old'})).code,'EPOCH_CHANGED');
  assert.equal((await f.schedule({...next,slot:'20:30'})).code,'IDEMPOTENCY_MISMATCH');
});
test('reminder schedule fails closed for no tasks, stale preview, write failure and account cleanup',async()=>{
  const f=reminderFixture(),a=await f.seed(),p=await f.preview();f.time=Date.parse(p.dueAt);
  assert.equal((await f.schedule(p)).code,'PREVIEW_CHANGED');assert.equal(f.reminders.size,0);
  f.time-=1800000;f.writeFails=true;assert.equal((await f.schedule(p)).code,'SERVICE_UNAVAILABLE');assert.equal(f.reminders.size,0);f.writeFails=false;
  f.db.get(a.accountId).cleanupPending=true;const {templateId,...fields}=p;
  assert.equal((await f.reminderApi({action:'scheduleReminder',epoch:a.epoch,...fields,subscriptionResult:'accept'})).code,'DELETE_PENDING');
  delete f.db.get(a.accountId).cleanupPending;f.db.get(a.accountId).state.habits=[];
  assert.equal((await f.reminderApi({action:'previewReminder',epoch:a.epoch,slot:'12:30'})).code,'NO_SCHEDULE');
});
test('concurrent workers send at most once and only aggregate current pending count; subsequent ticks never resend',async()=>{
  const f=reminderFixture(),a=await f.seed(),p=await f.preview();await f.schedule(p);f.time=Date.parse(p.dueAt);
  await Promise.all([f.worker()(),f.worker()()]);assert.equal(f.sends.length,1);assert.equal(f.sends[0].count,1);
  assert.equal([...f.reminders.values()][0].status,'sent');assert.equal([...f.reminders.values()][0].recipient,undefined);
  await f.worker()();assert.equal(f.sends.length,1);
  assert.equal((await f.reminderApi({action:'cancelReminder',epoch:a.epoch,businessDate:f.date,generation:1})).code,'ALREADY_PROCESSING');
});
test('completed, cancelled, stale-day and deleted accounts never send; claim to final-send recheck catches deletion',async()=>{
  for(const scenario of ['done','cancel','late','epoch','cleanup','after-claim']) {
    const f=reminderFixture(),a=await f.seed(),p=await f.preview();await f.schedule(p);f.time=Date.parse(p.dueAt);
    if(scenario==='done')await f.mutate({type:'complete',id:'read',date:f.date});
    if(scenario==='cancel')await f.reminderApi({action:'cancelReminder',epoch:a.epoch,businessDate:f.date,generation:1});
    if(scenario==='late')f.time+=86400000;
    if(scenario==='epoch')f.db.get(a.accountId).epoch='new';
    if(scenario==='cleanup')f.db.get(a.accountId).cleanupPending=true;
    await f.worker(scenario==='after-claim'?{limiter:async()=>{f.db.get(a.accountId).cleanupPending=true;}}:{})();
    assert.equal(f.sends.length,0,scenario);assert.equal([...f.reminders.values()][0].status,'cancelled',scenario);
  }
});
test('unknown sends and crash-after-send never retry; stale claims become unknown and late resolution cannot change outcome',async()=>{
  const f=reminderFixture();await f.seed();const p=await f.preview();await f.schedule(p);f.time=Date.parse(p.dueAt);let sends=0,resolve;
  await f.worker({timeoutMs:5,send:()=>{sends++;return new Promise(r=>{resolve=r;});}})();
  assert.equal([...f.reminders.values()][0].status,'unknown');resolve({errCode:0});await new Promise(setImmediate);await f.worker()();assert.equal(sends,1);assert.equal(f.sends.length,0);
  const g=reminderFixture();await g.seed();const q=await g.preview();await g.schedule(q);g.time=Date.parse(q.dueAt);
  await assert.rejects(g.worker({send:async()=>{g.sends.push(1);g.writeFails=true;return {errCode:0};}})());
  assert.equal([...g.reminders.values()][0].status,'claimed');g.writeFails=false;g.time+=300001;
  await g.worker()();assert.equal([...g.reminders.values()][0].status,'unknown');assert.equal(g.sends.length,1);
});
test('timer authentication rejects forged event-only requests; encryption binds record and sender only uses configured safe fields',async()=>{
  const secret='c'.repeat(64),name='jiancheng_daka_digest',event={Type:'Timer',TriggerName:name,Message:secret};
  assert.equal(authorizeTimer(event,{},secret,name),true);
  for(const [e,identity] of [[{...event,Message:'x'},{}],[{...event,TriggerName:'other'},{}],[event,{OPENID:'client'}],[event,{SOURCE:'http'}]]) assert.equal(authorizeTimer(e,identity,secret,name),false);
  const codec=createRecipientCodec('d'.repeat(64)),sealed=codec.seal('private_openid','aad');assert.throws(()=>codec.open(sealed,'other'));
  let sent;const send=createSender({openapi:{subscribeMessage:{send:async p=>{sent=p;return {errCode:0};}}}},{templateId:'fixture-template',fields:{text:'thing1',count:'number2',time:'time3'},state:'developer'});
  await send({recipient:'trusted',count:3,businessDate:'2026-09-27',slot:'20:30'});
  assert.equal(sent.page,'pages/today/index');assert.deepEqual(sent.data.number2,{value:'3'});assert.equal(sent.miniprogramState,'developer');
});

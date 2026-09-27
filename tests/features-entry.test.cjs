const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const { createRequire }=require('node:module');
function entryFixture(name) {
  const file=path.resolve(__dirname,'../cloudfunctions/'+name+'/index.js'),realRequire=createRequire(file);
  const f={env:{},calls:0,identity:{APPID:'wx-entry',OPENID:'trusted',SOURCE:'wx_client'}};
  const exports={};
  const sdk={init(){},getWXContext:()=>f.identity,database(){f.calls++;throw Error('SDK_PRIVATE_DETAILS');}};
  new Function('require','exports','process',fs.readFileSync(file,'utf8'))(n=>n==='wx-server-sdk'?sdk:realRequire(n),exports,{env:f.env});
  f.main=exports.main;return f;
}
test('feature and public entries are disabled by default without any database access',async()=>{
  for(const name of ['jiancheng_daka_features','jiancheng_daka_public_share']) {
    const f=entryFixture(name);assert.equal((await f.main({action:'pull'})).ok,false);assert.equal(f.calls,0);
  }
  const f=entryFixture('jiancheng_daka_features');
  Object.assign(f.env,{HABIT_FEATURES_ENABLED:'true',HABIT_IDENTITY_VERIFIED:'true',HABIT_APP_ID:'wx-entry',HABIT_MINIPROGRAM_ONLY:'true'});
  assert.equal((await f.main({action:'getPreferences',epoch:'e'})).code,'NOT_ENABLED');assert.equal(f.calls,0,'cleanup is a mandatory rollout gate');
  f.env.HABIT_SIDECAR_CLEANUP_ENABLED='true';
  assert.equal((await f.main({action:'getPreferences',epoch:'e'})).code,'NOT_ENABLED');
  f.env.HABIT_LIMITS_VERIFIED='true';
  const result=await f.main({action:'getPreferences',epoch:'e'});assert.equal(result.code,'SERVICE_UNAVAILABLE');assert.doesNotMatch(JSON.stringify(result),/SDK_PRIVATE/);
});
test('public entry normalizes SDK faults to the same unavailable result',async()=>{
  const f=entryFixture('jiancheng_daka_public_share');
  const disabled=await f.main({action:'getPublicShare',shareId:'a'.repeat(64)});
  Object.assign(f.env,{HABIT_PUBLIC_SHARES_ENABLED:'true',HABIT_SIDECAR_CLEANUP_ENABLED:'true',HABIT_LIMITS_VERIFIED:'true'});
  assert.deepEqual(await f.main({action:'getPublicShare',shareId:'a'.repeat(64)}),disabled);
});

test('reminder timer entry is closed by default and forged client timers make no database request',async()=>{
  const f=entryFixture('jiancheng_daka_reminder_tick');assert.equal((await f.main({Type:'Timer'})).code,'NOT_ENABLED');assert.equal(f.calls,0);
  for(const key of ['HABIT_REMINDERS_ENABLED','HABIT_REMINDER_STORAGE_READY','HABIT_TIMER_VERIFIED','HABIT_TEMPLATE_VERIFIED','HABIT_REMINDER_TTL_VERIFIED','HABIT_LIMITS_VERIFIED','HABIT_IDENTITY_VERIFIED','HABIT_SIDECAR_CLEANUP_ENABLED'])f.env[key]='true';
  f.env.HABIT_TIMER_SECRET='e'.repeat(64);f.env.HABIT_TIMER_NAME='jiancheng_daka_digest';
  const response=await f.main({Type:'Timer',TriggerName:f.env.HABIT_TIMER_NAME,Message:f.env.HABIT_TIMER_SECRET});assert.equal(response.code,'UNAUTHORIZED');assert.equal(f.calls,0);
});

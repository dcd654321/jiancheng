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
  for(const name of ['jiancheng_daka_features','jiancheng_daka_public_share','jiancheng_daka_plan']) {
    const f=entryFixture(name);assert.equal((await f.main({action:'pull'})).ok,false);assert.equal(f.calls,0);
  }
  const f=entryFixture('jiancheng_daka_features');
  // 分享/偏好总开关仍必须显式开启：主题默认可用不会连带开放其他动作
  assert.equal((await f.main({action:'getPreferences',epoch:'e'})).code,'NOT_ENABLED');assert.equal(f.calls,0,'share/preference master switch stays strict');
  f.env.HABIT_FEATURES_ENABLED='true';
  const result=await f.main({action:'getPreferences',epoch:'e'});assert.equal(result.code,'SERVICE_UNAVAILABLE');assert.doesNotMatch(JSON.stringify(result),/SDK_PRIVATE/);
  // 显式 false 仍可恢复“未确认即停服”的严格行为
  const strict=entryFixture('jiancheng_daka_features');
  strict.env.HABIT_APPEARANCE_ENABLED='false';
  assert.equal((await strict.main({action:'getAppearance',epoch:'e'})).code,'NOT_ENABLED');
  assert.equal(strict.calls,0);
});
test('public entry normalizes SDK faults to the same unavailable result',async()=>{
  const f=entryFixture('jiancheng_daka_public_share');
  const disabled=await f.main({action:'getPublicShare',shareId:'a'.repeat(64)});
  Object.assign(f.env,{HABIT_PUBLIC_SHARES_ENABLED:'true',HABIT_SIDECAR_CLEANUP_ENABLED:'true',HABIT_LIMITS_VERIFIED:'true'});
  assert.deepEqual(await f.main({action:'getPublicShare',shareId:'a'.repeat(64)}),disabled);
});

test('appearance is on by default; explicit false restores the strict gate; sharing and reminders stay closed',async()=>{
  const common={HABIT_IDENTITY_VERIFIED:'true',HABIT_SIDECAR_CLEANUP_ENABLED:'true',HABIT_LIMITS_VERIFIED:'true',HABIT_MINIPROGRAM_ONLY:'true',HABIT_APP_ID:'wx-entry'};
  const getAppearance={action:'getAppearance',epoch:'e'},setAppearance={action:'setAppearance',epoch:'e',operationId:'op',expectedRevision:0,theme:'paper'};
  // 零配置部署：主题动作进入服务层（限流与回执随之执行），分享/提醒保持关闭
  const bare=entryFixture('jiancheng_daka_features');
  const entered=await bare.main(getAppearance);
  assert.equal(entered.code,'SERVICE_UNAVAILABLE');assert.doesNotMatch(JSON.stringify(entered),/SDK_PRIVATE/);
  assert.equal((await bare.main({action:'getPreferences',epoch:'e'})).code,'NOT_ENABLED');
  assert.equal((await bare.main({action:'noSuchAction',epoch:'e'})).code,'NOT_ENABLED');
  assert.equal((await bare.main({action:'previewReminder',epoch:'e',slot:'12:30'})).code,'NOT_ENABLED');
  assert.equal(bare.calls,1,'only the appearance read reached the transport');
  // 显式 false：主题回到“未确认即停服”
  const off=entryFixture('jiancheng_daka_features');
  Object.assign(off.env,common,{HABIT_APPEARANCE_ENABLED:'false'});
  const offResult=await off.main(getAppearance);
  assert.equal(offResult.code,'NOT_ENABLED');assert.equal(offResult.message,'外观主题服务尚未开放');
  assert.equal((await off.main(setAppearance)).code,'NOT_ENABLED');
  assert.equal(off.calls,0);
  // 仅开分享总开关、显式关闭主题：分享可用、主题被拒
  const featuresOnly=entryFixture('jiancheng_daka_features');
  Object.assign(featuresOnly.env,common,{HABIT_FEATURES_ENABLED:'true',HABIT_APPEARANCE_ENABLED:'false'});
  assert.equal((await featuresOnly.main({action:'getPreferences',epoch:'e'})).code,'SERVICE_UNAVAILABLE');
  assert.equal((await featuresOnly.main(getAppearance)).code,'NOT_ENABLED');
  assert.equal(featuresOnly.calls,1);
  // 缺省绑定：未配置 HABIT_APP_ID 时使用内置本应用 AppID，仍进入服务层（身份在服务层按平台上下文校验）
  const withoutAppId=entryFixture('jiancheng_daka_features');
  Object.assign(withoutAppId.env,common,{HABIT_APPEARANCE_ENABLED:'true'});delete withoutAppId.env.HABIT_APP_ID;
  assert.equal((await withoutAppId.main(getAppearance)).code,'SERVICE_UNAVAILABLE');
  assert.equal(withoutAppId.calls,1);
  // 任一共同前提显式 false：直接拒绝且不触库
  for(const key of ['HABIT_IDENTITY_VERIFIED','HABIT_SIDECAR_CLEANUP_ENABLED','HABIT_LIMITS_VERIFIED','HABIT_MINIPROGRAM_ONLY']) {
    const f=entryFixture('jiancheng_daka_features');
    Object.assign(f.env,common,{[key]:'false'});
    assert.equal((await f.main(getAppearance)).code,'NOT_ENABLED',key);
    assert.equal((await f.main(setAppearance)).code,'NOT_ENABLED',key);
    assert.equal(f.calls,0,key);
  }
});

test('reminder timer entry is closed by default and forged client timers make no database request',async()=>{
  const f=entryFixture('jiancheng_daka_reminder_tick');assert.equal((await f.main({Type:'Timer'})).code,'NOT_ENABLED');assert.equal(f.calls,0);
  for(const key of ['HABIT_REMINDERS_ENABLED','HABIT_REMINDER_STORAGE_READY','HABIT_TIMER_VERIFIED','HABIT_TEMPLATE_VERIFIED','HABIT_REMINDER_TTL_VERIFIED','HABIT_LIMITS_VERIFIED','HABIT_IDENTITY_VERIFIED','HABIT_SIDECAR_CLEANUP_ENABLED'])f.env[key]='true';
  f.env.HABIT_TIMER_SECRET='e'.repeat(64);f.env.HABIT_TIMER_NAME='jiancheng_daka_digest';
  const response=await f.main({Type:'Timer',TriggerName:f.env.HABIT_TIMER_NAME,Message:f.env.HABIT_TIMER_SECRET});assert.equal(response.code,'UNAUTHORIZED');assert.equal(f.calls,0);
});

test('AI entry cannot open with missing budget or provider configuration and reveals no configuration details',async()=>{
  const f=entryFixture('jiancheng_daka_plan');
  for(const key of ['HABIT_AI_ENABLED','HABIT_AI_STORAGE_READY','HABIT_AI_BUDGET_VERIFIED','HABIT_AI_CATALOG_VERIFIED','HABIT_IDENTITY_VERIFIED','HABIT_MINIPROGRAM_ONLY','HABIT_LIMITS_VERIFIED','HABIT_SIDECAR_CLEANUP_ENABLED'])f.env[key]='true';
  f.env.HABIT_APP_ID='wx-entry';f.env.HABIT_AI_PROVIDER='deepseek';
  const result=await f.main({action:'suggest'});assert.equal(result.code,'AI_UNAVAILABLE');assert.equal(f.calls,0);assert.doesNotMatch(JSON.stringify(result),/KEY|budget|provider/i);
});
test('AI defaults open but safety gates and explicit false still reject before database',async()=>{
  const ready={HABIT_APP_ID:'wx-entry',HABIT_AI_PROVIDER:'deepseek',HABIT_AI_MODEL:'fixture',HABIT_AI_API_KEY:'fixture-key-not-a-real-key',
    HABIT_AI_USER_DAILY:'2',HABIT_AI_RESERVATION_MICRO_CNY:'100',HABIT_AI_DAY_MICRO_CNY:'1000',HABIT_AI_MONTH_MICRO_CNY:'10000'};
  const gates=['HABIT_AI_STORAGE_READY','HABIT_AI_BUDGET_VERIFIED','HABIT_AI_CATALOG_VERIFIED','HABIT_IDENTITY_VERIFIED','HABIT_MINIPROGRAM_ONLY','HABIT_LIMITS_VERIFIED','HABIT_SIDECAR_CLEANUP_ENABLED'];
  gates.forEach(k=>{ready[k]='true';});const open=entryFixture('jiancheng_daka_plan');Object.assign(open.env,ready);
  assert.equal((await open.main({action:'suggest'})).code,'AI_UNAVAILABLE');assert.equal(open.calls,1);
  for(const key of [...gates,'HABIT_APP_ID']){
    const f=entryFixture('jiancheng_daka_plan');Object.assign(f.env,ready);delete f.env[key];
    assert.equal((await f.main({action:'suggest'})).code,'NOT_ENABLED',key);assert.equal(f.calls,0);
  }
  const off=entryFixture('jiancheng_daka_plan');Object.assign(off.env,ready,{HABIT_AI_ENABLED:'false'});
  assert.equal((await off.main({action:'suggest'})).code,'NOT_ENABLED');assert.equal(off.calls,0);
});

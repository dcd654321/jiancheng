const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const { createRequire }=require('node:module');
function entryFixture(name) {
  const file=path.resolve(__dirname,'../cloudfunctions/'+name+'/index.js'),realRequire=createRequire(file);
  const f={env:{},calls:0,identity:{APPID:'wx-entry',OPENID:'trusted',SOURCE:'wx_client'},
    release:{storageReady:false,supervisionEnabled:false,mediaEnabled:false,supervisorRemindersEnabled:false}};
  const gatesFile=path.resolve(__dirname,'../server/supervision-gates.js'),gatesRequire=createRequire(gatesFile),gatesModule={exports:{}};
  new Function('require','module',fs.readFileSync(gatesFile,'utf8'))(n=>n==='./supervision-config'?f.release:gatesRequire(n),gatesModule);
  f.gates=gatesModule.exports;
  const exports={};
  const sdk={init(){},getWXContext:()=>f.identity,database(){f.calls++;throw Error('SDK_PRIVATE_DETAILS');}};
  new Function('require','exports','process',fs.readFileSync(file,'utf8'))(n=>n==='wx-server-sdk'?sdk:n==='./lib/supervision-gates'?f.gates:realRequire(n),exports,{env:f.env});
  f.main=exports.main;return f;
}
test('feature and public entries are disabled by default without any database access',async()=>{
  for(const name of ['jiancheng_daka_features','jiancheng_daka_public_share','jiancheng_daka_plan']) {
    const f=entryFixture(name);assert.equal((await f.main({action:'pull'})).ok,false);assert.equal(f.calls,0);
  }
  const f=entryFixture('jiancheng_daka_features');
  // 清理与限流确认后，分享/偏好总开关仍必须显式开启。
  Object.assign(f.env,{HABIT_SIDECAR_CLEANUP_ENABLED:'true',HABIT_LIMITS_VERIFIED:'true'});
  assert.equal((await f.main({action:'getPreferences',epoch:'e'})).code,'NOT_ENABLED');assert.equal(f.calls,0,'share/preference master switch stays strict');
  f.env.HABIT_FEATURES_ENABLED='true';
  const result=await f.main({action:'getPreferences',epoch:'e'});assert.equal(result.code,'SERVICE_UNAVAILABLE');assert.doesNotMatch(JSON.stringify(result),/SDK_PRIVATE/);
  // 满足清理前提后，独立主题开关仍可关闭服务。
  const strict=entryFixture('jiancheng_daka_features');
  Object.assign(strict.env,{HABIT_SIDECAR_CLEANUP_ENABLED:'true',HABIT_LIMITS_VERIFIED:'true',HABIT_APPEARANCE_ENABLED:'false'});
  assert.equal((await strict.main({action:'getAppearance',epoch:'e'})).code,'NOT_ENABLED');
  assert.equal(strict.calls,0);
});
test('public entry normalizes SDK faults to the same unavailable result',async()=>{
  const f=entryFixture('jiancheng_daka_public_share');
  const disabled=await f.main({action:'getPublicShare',shareId:'a'.repeat(64)});
  Object.assign(f.env,{HABIT_PUBLIC_SHARES_ENABLED:'true',HABIT_SIDECAR_CLEANUP_ENABLED:'true',HABIT_LIMITS_VERIFIED:'true'});
  assert.deepEqual(await f.main({action:'getPublicShare',shareId:'a'.repeat(64)}),disabled);
});

test('appearance defaults on after cleanup confirmation; explicit false closes it and other capabilities stay closed',async()=>{
  const common={HABIT_IDENTITY_VERIFIED:'true',HABIT_SIDECAR_CLEANUP_ENABLED:'true',HABIT_LIMITS_VERIFIED:'true',HABIT_MINIPROGRAM_ONLY:'true',HABIT_APP_ID:'wx-entry'};
  const getAppearance={action:'getAppearance',epoch:'e'},setAppearance={action:'setAppearance',epoch:'e',operationId:'op',expectedRevision:0,theme:'paper'};
  // 缺省清理确认时不触库；两项明确开启后，主题动作进入服务层。
  const bare=entryFixture('jiancheng_daka_features');
  assert.equal((await bare.main(getAppearance)).code,'NOT_ENABLED');
  assert.equal((await bare.main(setAppearance)).code,'NOT_ENABLED');assert.equal(bare.calls,0);
  Object.assign(bare.env,{HABIT_SIDECAR_CLEANUP_ENABLED:'true',HABIT_LIMITS_VERIFIED:'true'});
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

test('every feature route requires explicit sidecar and quota cleanup confirmation before database access',async()=>{
  const required=['HABIT_SIDECAR_CLEANUP_ENABLED','HABIT_LIMITS_VERIFIED'];
  const requests=[{action:'getAppearance',epoch:'e'},
    {action:'setAppearance',epoch:'e',operationId:'op',expectedRevision:0,theme:'paper'},
    {action:'getPreferences',epoch:'e'},
    {action:'createShare',epoch:'e',kind:'invite'},
    {action:'previewReminder',epoch:'e',slot:'12:30'}];
  for(const key of required) for(const value of [undefined,'','false','TRUE',' true ','invalid',true]) {
    const f=entryFixture('jiancheng_daka_features');
    Object.assign(f.env,{HABIT_SIDECAR_CLEANUP_ENABLED:'true',HABIT_LIMITS_VERIFIED:'true',HABIT_FEATURES_ENABLED:'true',HABIT_REMINDERS_ENABLED:'true'});
    if(value===undefined)delete f.env[key];else f.env[key]=value;
    for(const request of requests) assert.equal((await f.main(request)).code,'NOT_ENABLED',key+'='+String(value)+' / '+request.action);
    assert.equal(f.calls,0,key+'='+String(value));
  }
});

test('reminder timer entry is closed by default and forged client timers make no database request',async()=>{
  const f=entryFixture('jiancheng_daka_reminder_tick');assert.equal((await f.main({Type:'Timer'})).code,'NOT_ENABLED');assert.equal(f.calls,0);
  for(const key of ['HABIT_REMINDERS_ENABLED','HABIT_REMINDER_STORAGE_READY','HABIT_TIMER_VERIFIED','HABIT_TEMPLATE_VERIFIED','HABIT_REMINDER_TTL_VERIFIED','HABIT_LIMITS_VERIFIED','HABIT_IDENTITY_VERIFIED','HABIT_SIDECAR_CLEANUP_ENABLED'])f.env[key]='true';
  f.env.HABIT_TIMER_SECRET='e'.repeat(64);f.env.HABIT_TIMER_NAME='jiancheng_daka_digest';
  const response=await f.main({Type:'Timer',TriggerName:f.env.HABIT_TIMER_NAME,Message:f.env.HABIT_TIMER_SECRET});assert.equal(response.code,'UNAUTHORIZED');assert.equal(f.calls,0);
});

test('retired plan entry stays disabled with legacy enabling flags and no database access',async()=>{
  const f=entryFixture('jiancheng_daka_plan');
  for(const key of ['HABIT_AI_ENABLED','HABIT_AI_STORAGE_READY','HABIT_AI_BUDGET_VERIFIED','HABIT_AI_CATALOG_VERIFIED','HABIT_IDENTITY_VERIFIED','HABIT_MINIPROGRAM_ONLY','HABIT_LIMITS_VERIFIED','HABIT_SIDECAR_CLEANUP_ENABLED'])f.env[key]='true';
  f.env.HABIT_APP_ID='wx-entry';f.env.HABIT_AI_PROVIDER='deepseek';
  const result=await f.main({action:'suggest'});assert.equal(result.code,'NOT_ENABLED');assert.equal(f.calls,0);assert.doesNotMatch(JSON.stringify(result),/KEY|budget|provider/i);
  const ready={HABIT_APP_ID:'wx-entry',HABIT_AI_PROVIDER:'deepseek',HABIT_AI_MODEL:'fixture',HABIT_AI_API_KEY:'fixture-key-not-a-real-key',
    HABIT_AI_USER_DAILY:'2',HABIT_AI_RESERVATION_MICRO_CNY:'100',HABIT_AI_DAY_MICRO_CNY:'1000',HABIT_AI_MONTH_MICRO_CNY:'10000'};
  const gates=['HABIT_AI_STORAGE_READY','HABIT_AI_BUDGET_VERIFIED','HABIT_AI_CATALOG_VERIFIED','HABIT_IDENTITY_VERIFIED','HABIT_MINIPROGRAM_ONLY','HABIT_LIMITS_VERIFIED','HABIT_SIDECAR_CLEANUP_ENABLED'];
  gates.forEach(k=>{ready[k]='true';});const open=entryFixture('jiancheng_daka_plan');Object.assign(open.env,ready);
  assert.equal((await open.main({action:'suggest'})).code,'NOT_ENABLED');assert.equal(open.calls,0);
  for(const key of [...gates,'HABIT_APP_ID']){
    const f=entryFixture('jiancheng_daka_plan');Object.assign(f.env,ready);delete f.env[key];
    assert.equal((await f.main({action:'suggest'})).code,'NOT_ENABLED',key);assert.equal(f.calls,0);
  }
  const off=entryFixture('jiancheng_daka_plan');Object.assign(off.env,ready,{HABIT_AI_ENABLED:'false'});
  assert.equal((await off.main({action:'suggest'})).code,'NOT_ENABLED');assert.equal(off.calls,0);
});

const configureMedia = f => Object.assign(f.env,{HABIT_MEDIA_FILE_ID_PREFIX:'cloud://fixture.bucket/',HABIT_MEDIA_CALLBACK_TOKEN:'callback_fixture_token',HABIT_MEDIA_ENCODING_AES_KEY:Buffer.alloc(32,1).toString('base64').slice(0,-1)});
test('supervision and media routes use default-closed code gates and do not enable sharing',async()=>{
  const gates=require('../server/supervision-gates');
  for(const [action,flag] of [['listSupervisions','supervisionEnabled'],['prepareMedia','mediaEnabled']]) {
    const f=entryFixture('jiancheng_daka_features');
    assert.equal((await f.main({action,epoch:'e'})).code,'NOT_ENABLED');assert.equal(f.calls,0);
    gates.COMMON.forEach(k=>f.env[k]='true');configureMedia(f);
    // Removed environment switches cannot bypass the reviewed release code.
    Object.assign(f.env,{HABIT_SUPERVISION_ENABLED:'true',HABIT_MEDIA_ENABLED:'true',HABIT_SUPERVISION_STORAGE_READY:'true',HABIT_MEDIA_STORAGE_READY:'true'});
    assert.equal((await f.main({action,epoch:'e'})).code,'NOT_ENABLED');assert.equal(f.calls,0);
    for(const key of gates.COMMON) {
      const closed=entryFixture('jiancheng_daka_features');configureMedia(closed);Object.assign(closed.release,{storageReady:true,[flag]:true});gates.COMMON.forEach(k=>closed.env[k]='true');delete closed.env[key];
      assert.equal((await closed.main({action,epoch:'e'})).code,'NOT_ENABLED',key);assert.equal(closed.calls,0,key);
    }
    f.release[flag]=true;
    assert.equal((await f.main({action,epoch:'e'})).code,'NOT_ENABLED');assert.equal(f.calls,0,'storage must be prepared');
    f.release.storageReady=true;
    assert.equal((await f.main({action,epoch:'e'})).code,'SERVICE_UNAVAILABLE');assert.equal(f.calls,1,'independent route reaches its service');
    assert.equal((await f.main({action:'createShare',epoch:'e'})).code,'NOT_ENABLED');assert.equal(f.calls,1,'sharing stays closed');
  }
  const f=entryFixture('jiancheng_daka_features');gates.COMMON.forEach(k=>f.env[k]='true');Object.assign(f.release,{storageReady:true,supervisionEnabled:true});
  assert.equal((await f.main({action:'createSupervisionInvite',photoRequired:true})).code,'NOT_ENABLED');assert.equal(f.calls,0,'required-photo agreements need the media capability');
});

test('typed reminder list is independent of the old sharing master switch',async()=>{
  const f=entryFixture('jiancheng_daka_features');
  for(const key of ['HABIT_SIDECAR_CLEANUP_ENABLED','HABIT_LIMITS_VERIFIED','HABIT_IDENTITY_VERIFIED','HABIT_MINIPROGRAM_ONLY','HABIT_REMINDERS_ENABLED','HABIT_REMINDER_STORAGE_READY','HABIT_TEMPLATE_VERIFIED','HABIT_TIMER_VERIFIED','HABIT_REMINDER_TTL_VERIFIED'])f.env[key]='true';
  f.env.HABIT_REMINDER_KEY='a'.repeat(64);
  assert.equal((await f.main({action:'getReminders',includeTypes:true,epoch:'e'})).code,'SERVICE_UNAVAILABLE');assert.equal(f.calls,1);
  assert.equal((await f.main({action:'previewReminder',type:'supervisor',epoch:'e'})).code,'NOT_ENABLED');assert.equal(f.calls,1);
});

test('media maintenance endpoints stay closed by default and reject client timer or unsigned HTTP before database access',async()=>{
  const callback=entryFixture('jiancheng_daka_media_callback'),timer=entryFixture('jiancheng_daka_media_tick');
  assert.equal((await callback.main({httpMethod:'POST',body:'{}'})).statusCode,503);assert.equal(callback.calls,0);
  callback.release.storageReady=true;callback.env.HABIT_IDENTITY_VERIFIED='true';configureMedia(callback);
  assert.equal((await callback.main({httpMethod:'POST',body:'{}',queryStringParameters:{}})).statusCode,401);assert.equal(callback.calls,0);
  assert.equal((await timer.main({Type:'Timer'})).code,'NOT_ENABLED');assert.equal(timer.calls,0);
  timer.release.storageReady=true;timer.env.HABIT_IDENTITY_VERIFIED='true';timer.env.HABIT_SIDECAR_CLEANUP_ENABLED='true';configureMedia(timer);
  assert.equal((await timer.main({Type:'Timer',TriggerName:timer.gates.MEDIA_TIMER_NAME,Message:timer.gates.mediaTimerSecret(timer.env)})).code,'UNAUTHORIZED');assert.equal(timer.calls,0);
});

test('missing platform settings close media and supervisor reminders while ordinary routes remain independent',async()=>{
  const f=entryFixture('jiancheng_daka_features');Object.assign(f.release,{storageReady:true,supervisionEnabled:true,mediaEnabled:true,supervisorRemindersEnabled:true});
  f.gates.COMMON.forEach(k=>f.env[k]='true');configureMedia(f);
  for(const key of ['HABIT_MEDIA_FILE_ID_PREFIX','HABIT_MEDIA_CALLBACK_TOKEN','HABIT_MEDIA_ENCODING_AES_KEY']) {
    const saved=f.env[key];delete f.env[key];assert.equal((await f.main({action:'prepareMedia',epoch:'e'})).code,'NOT_ENABLED',key);assert.equal(f.calls,0);f.env[key]=saved;
  }
  Object.assign(f.env,{HABIT_REMINDERS_ENABLED:'true',HABIT_REMINDER_STORAGE_READY:'true',HABIT_TEMPLATE_VERIFIED:'true',HABIT_TIMER_VERIFIED:'true',HABIT_REMINDER_TTL_VERIFIED:'true',HABIT_REMINDER_KEY:'a'.repeat(64),HABIT_REMINDER_TEMPLATE:'self_fixture'});
  for(const fields of [undefined,'{','null','{}','{"text":"text1","count":"number2","time":"time3"}']) {
    f.env.HABIT_SUPERVISOR_TEMPLATE='supervisor_fixture';f.env.HABIT_SUPERVISOR_FIELDS=fields;
    assert.equal((await f.main({action:'previewReminder',type:'supervisor',epoch:'e'})).code,'NOT_ENABLED');assert.equal(f.calls,0);
  }
  f.env.HABIT_SUPERVISOR_FIELDS='{"text":"thing1","count":"number2","time":"time3"}';f.env.HABIT_SUPERVISOR_TEMPLATE=f.env.HABIT_REMINDER_TEMPLATE;
  assert.equal((await f.main({action:'previewReminder',type:'supervisor',epoch:'e'})).code,'NOT_ENABLED');assert.equal(f.calls,0);
  f.env.HABIT_SUPERVISOR_TEMPLATE='supervisor_fixture';
  assert.equal((await f.main({action:'previewReminder',type:'supervisor',epoch:'e'})).code,'SERVICE_UNAVAILABLE');assert.equal(f.calls,1);
});

test('fixed media timer authenticates before database access and maintenance survives entry closure',async()=>{
  const f=entryFixture('jiancheng_daka_media_tick');f.release.storageReady=true;configureMedia(f);Object.assign(f.env,{HABIT_IDENTITY_VERIFIED:'true',HABIT_SIDECAR_CLEANUP_ENABLED:'true'});
  f.identity={};
  const message=f.gates.mediaTimerSecret(f.env),trigger={Type:'Timer',TriggerName:'jiancheng_daka_media_tick',Message:message};
  for(const forged of [{...trigger,TriggerName:'jiancheng_daka_digest'},{...trigger,Message:'d'.repeat(64)},{...trigger,Message:f.env.HABIT_MEDIA_ENCODING_AES_KEY},{...trigger,Type:'HTTP'}]) {
    assert.equal((await f.main(forged)).code,'UNAUTHORIZED');assert.equal(f.calls,0);
  }
  assert.equal(f.gates.recordGuardReady(),true);assert.equal(f.gates.mediaReady(f.env),false);assert.equal(f.gates.supervisionReady(f.env),false);
  assert.equal((await f.main(trigger)).code,'SERVICE_UNAVAILABLE');assert.equal(f.calls,1,'authenticated timer reaches database even when upload entry is closed');
  f.env.HABIT_MEDIA_ENCODING_AES_KEY=Buffer.alloc(32,2).toString('base64').slice(0,-1);
  assert.notEqual(f.gates.mediaTimerSecret(f.env),message);assert.equal((await f.main(trigger)).code,'UNAUTHORIZED');assert.equal(f.calls,1,'old timer message is rejected after key rotation');
});

test('media callback rejects invalid credentials while default settings and timer utility retain safe boundaries',async()=>{
  const release=require('../server/supervision-config'),gates=require('../server/supervision-gates');
  assert.deepEqual(release,{storageReady:false,supervisionEnabled:false,mediaEnabled:false,supervisorRemindersEnabled:false});assert.equal(Object.isFrozen(release),true);
  const f=entryFixture('jiancheng_daka_media_callback');f.release.storageReady=true;f.env.HABIT_IDENTITY_VERIFIED='true';configureMedia(f);
  for(const key of ['HABIT_MEDIA_CALLBACK_TOKEN','HABIT_MEDIA_ENCODING_AES_KEY']) {
    const saved=f.env[key];for(const value of [undefined,'invalid',true]) {f.env[key]=value;assert.equal((await f.main({httpMethod:'POST',body:'{}'})).statusCode,503);assert.equal(f.calls,0);}f.env[key]=saved;
  }
  const script=path.resolve(__dirname,'../scripts/media-timer-message.cjs');
  const valid=spawnSync(process.execPath,[script],{input:f.env.HABIT_MEDIA_ENCODING_AES_KEY+'\n',encoding:'utf8'});
  assert.equal(valid.status,0);assert.equal(valid.stdout.trim(),gates.mediaTimerSecret(f.env));assert.equal(valid.stderr,'');
  for(const input of ['', 'invalid', 'a'.repeat(101)]) {
    const invalid=spawnSync(process.execPath,[script],{input,encoding:'utf8'});assert.equal(invalid.status,1);assert.equal(invalid.stdout,'');assert.doesNotMatch(invalid.stderr,/invalid|aaaa/);
  }
});

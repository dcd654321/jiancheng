const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createPlanAssistant } = require('../miniprogram/services/plan-assistant');
const domain = require('../miniprogram/core/habits');
const dates = require('../miniprogram/core/date');
const { ruleSuggestion } = require('../miniprogram/core/plan-assistant');
const e = (dataset = {}, value) => ({ currentTarget: { dataset }, detail: { value } });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
function setup(t, options = {}) {
  const s = { ready:true, accountId:'fixture-a', epoch:'epoch-a', pending:0, phase:'ready' };
  let state = domain.emptyState(); const nav=[], calls=[], writes=[];
  const session={status:()=>({...s}),subscribe:()=>()=>{}};
  const store={contextKey:()=>s.accountId+':'+s.epoch,read:()=>structuredClone(state),info:()=>({source:'cloud',...s}),
    dispatch:c=>{writes.push(c);state=domain.reduce(state,c,dates.today());return structuredClone(state);}};
  const wx={navigateTo:o=>nav.push(o),setNavigationBarTitle(){},hideKeyboard(){},pageScrollTo(){},showModal(){},showToast(){}};
  const service=createPlanAssistant(wx,{enabled:true,envId:'fixture',functionName:'jiancheng_daka_api'},
    {enabled:true,functionName:'jiancheng_daka_plan',timeoutMs:options.timeoutMs||1000},
    {session,transportFactory:()=>r=>{calls.push(r);return options.reply?options.reply(r):Promise.resolve({ok:true,
      source:'ai',moderated:true,safetyMode:'allowlist-v1',operationId:r.operationId,draft:ruleSuggestion(r.input).draft});}});
  const app={store,cloudSession:session,planAssistant:service};global.wx=wx;global.getApp=()=>app;
  let def;global.Page=v=>{def=v;};const file=path.resolve(__dirname,'../miniprogram/pages/assistant/index.js');delete require.cache[file];require(file);
  const p={...def,data:structuredClone(def.data),setData(x,cb){Object.assign(this.data,x);if(cb)cb();}};
  p.onLoad();p.onShow();t.after(()=>p.onUnload());
  return {p,app,service,s,nav,calls,writes,seed(count){for(let i=0;i<count;i++)state=domain.reduce(state,{type:'create',id:'f-'+i,startDate:dates.today(),
    plan:{title:'夹具'+i,target:5,minimum:2,unit:'分钟',weekdays:[1,2,3,4,5,6,7],time:''}},dates.today());p.refresh();}};
}
test('opening is free of model calls and writes; consent belongs to every current input',async t=>{
  const h=setup(t),p=h.p;assert.equal(p.data.canGenerate,true);assert.equal(h.calls.length,0);
  await p.onGenerate();assert.equal(h.calls.length,0);assert.match(p.data.requestError,/勾选/);
  for(const change of [()=>p.onDirection(e({id:'study'})),()=>p.onPreset(e({minutes:10})),()=>p.onDay(e({day:7})),()=>p.onTime(e({},'20:00'))]){
    p.onConsent(e({},['agree']));p.onRules();assert.ok(p.data.preview);change();assert.equal(p.data.consent,false);assert.equal(p.data.preview,null);
  }assert.equal(h.calls.length,0);assert.equal(h.writes.length,0);
});
test('minute boundaries and empty weekdays show local errors without generating',async t=>{
  const h=setup(t),p=h.p;
  for(const n of ['0','61','1.5','']){p.onMinutes(e({},n));await p.onGenerate();assert.ok(p.data.fieldErrors.minutes);}
  for(const n of ['1','60']){p.onMinutes(e({},n));p.onRules();assert.ok(p.data.preview);assert.ok(p.data.preview.draft.target<=Number(n));}
  p.change({weekdays:[]});p.onRules();assert.match(p.data.fieldErrors.weekdays,/至少/);assert.equal(p.data.moreOpen,true);assert.equal(h.calls.length,0);
});
test('tapping the current direction or duration keeps the preview and existing consent',t=>{
  const h=setup(t),p=h.p;p.onRules();p.onConsent(e({},['agree']));const preview=p.data.preview;
  p.onDirection(e({id:'read'}));p.onPreset(e({minutes:5}));assert.equal(p.data.preview,preview);assert.equal(p.data.consent,true);assert.equal(h.calls.length,0);
});
test('AI preview adopts through one-use editable draft without automatic writes',async t=>{
  const h=setup(t),p=h.p;p.onConsent(e({},['agree']));await p.onGenerate();assert.equal(p.data.preview.source,'ai');assert.match(p.data.preview.draft.action,/书/);
  p.onAdopt();p.onAdopt();assert.equal(h.nav.length,1);assert.equal(h.writes.length,0);
  const token=new URL(h.nav[0].url,'https://fixture.invalid').searchParams.get('draft');
  const result=h.service.consume(token,h.app.store.contextKey());assert.equal(result.source,'ai');assert.deepEqual(result.draft.weekdays,p.data.weekdays);
  assert.throws(()=>h.service.consume(token,h.app.store.contextKey()),/过期/);
});
test('basis is usable during AI wait and late AI cannot replace it',async t=>{
  const d=deferred(),h=setup(t,{reply:()=>d.promise}),p=h.p;p.onConsent(e({},['agree']));const work=p.onGenerate();assert.equal(p.data.busy,true);
  await p.onGenerate();assert.equal(h.calls.length,1);p.onRules();assert.equal(p.data.preview.source,'rule');assert.equal(p.data.busy,false);assert.equal(p.data.serviceBusy,true);
  d.resolve({ok:true,source:'ai',moderated:true,safetyMode:'allowlist-v1',operationId:h.calls[0].operationId,draft:ruleSuggestion(h.calls[0].input).draft});
  await work;assert.equal(p.data.preview.source,'rule');assert.equal(h.calls.length,1);
});
for(const fail of [false,true])test(`reenter ignores late ${fail?'failure':'success'}`,async t=>{
  const d=deferred(),h=setup(t,{reply:()=>d.promise}),p=h.p;p.onConsent(e({},['agree']));const work=p.onGenerate();p.onHide();p.onShow();p.onRules();
  if(fail)d.reject(Error('old private SDK error'));else d.resolve({ok:true,source:'ai',moderated:true,safetyMode:'allowlist-v1',operationId:h.calls[0].operationId,draft:ruleSuggestion(h.calls[0].input).draft});
  await work;assert.equal(p.data.preview.source,'rule');assert.equal(p.data.requestError,'');assert.equal(p.data.busy,false);assert.equal(h.nav.length,0);
});
test('account change clears inputs and rejects stale errors',async t=>{
  const d=deferred(),h=setup(t,{reply:()=>d.promise}),p=h.p;p.change({direction:'tidy',minutes:'30',time:'19:00'});p.onConsent(e({},['agree']));const work=p.onGenerate();
  h.s.accountId='fixture-b';p.refresh();assert.equal(p.data.direction,'read');assert.equal(p.data.minutes,'5');assert.equal(p.data.time,'');assert.equal(p.data.consent,false);
  d.reject(Error('old failure'));await work;assert.equal(p.data.preview,null);assert.match(p.data.requestError,/账户/);assert.equal(p.data.busy,false);
});
test('cross-day response is ignored and refresh requires new preview',async t=>{
  const d=deferred(),h=setup(t,{reply:()=>d.promise}),p=h.p,old=dates.today;let day=old();dates.today=()=>day;t.after(()=>{dates.today=old;});
  p.onConsent(e({},['agree']));const work=p.onGenerate();day=dates.shift(day,1);p.refresh();d.reject(Error('old failure'));await work;
  assert.equal(p.data.preview,null);assert.equal(p.data.busy,false);assert.equal(p.data.consent,false);assert.match(p.data.requestError,/日期/);
});
test('capacity and offline block adoption but keep basis',t=>{
  const h=setup(t),p=h.p;p.onRules();h.seed(5);assert.equal(p.data.capacityFull,true);p.onAdopt();assert.equal(h.nav.length,0);assert.match(p.data.requestError,/5/);
  h.s.ready=false;h.s.networkOffline=true;p.refresh();p.onRules();assert.ok(p.data.preview);assert.equal(p.data.canGenerate,false);assert.equal(p.data.canAdopt,false);assert.equal(h.writes.length,0);
});
test('capacity stops model requests before spending, and known service failures retain input',async t=>{
  const full=setup(t);full.seed(5);full.p.onConsent(e({},['agree']));await full.p.onGenerate();assert.equal(full.calls.length,0);
  for(const code of ['RATE_LIMITED','NOT_ENABLED','AI_UNAVAILABLE']){
    const h=setup(t,{reply:()=>Promise.resolve({ok:false,code})});h.p.onPreset(e({minutes:15}));h.p.onConsent(e({},['agree']));await h.p.onGenerate();
    assert.equal(h.p.data.minutes,'15');assert.equal(h.p.data.preview,null);assert.equal(h.p.data.busy,false);assert.ok(h.p.data.requestError);h.p.onRules();assert.equal(h.p.data.preview.source,'rule');
  }
});
test('an account change between refresh ticks is detected before adopting or sending',async t=>{
  const h=setup(t),p=h.p;p.change({direction:'tidy',minutes:'30'});p.onRules();p.onConsent(e({},['agree']));h.s.accountId='fixture-b';
  p.onAdopt();assert.equal(h.nav.length,0);assert.equal(p.data.preview,null);assert.equal(p.data.direction,'read');
  await p.onGenerate();assert.equal(h.calls.length,0);assert.equal(p.data.consent,false);
});
test('navigation failure recovers; old failure after reentry is quiet',t=>{
  const h=setup(t),p=h.p;p.onRules();p.onAdopt();h.nav[0].fail();assert.equal(p.data.adopting,false);assert.match(p.data.requestError,/未打开/);
  p.onAdopt();p.onHide();p.onShow();p.onRules();h.nav[1].fail();assert.equal(p.data.requestError,'');
});
test('timeout preserves input, error and request ID through refresh',async t=>{
  const d=deferred(),h=setup(t,{timeoutMs:8,reply:()=>d.promise}),p=h.p;p.onConsent(e({},['agree']));await p.onGenerate();
  assert.equal(p.data.busy,false);assert.equal(p.data.serviceBusy,true);assert.match(p.data.requestError,/超时/);p.refresh();assert.match(p.data.requestError,/超时/);assert.equal(p.data.minutes,'5');
  d.resolve({ok:false,code:'AI_PENDING'});await new Promise(setImmediate);p.updateAvailability();assert.equal(p.data.serviceBusy,false);
  await p.onGenerate();assert.equal(h.calls.length,2);assert.equal(h.calls[0].operationId,h.calls[1].operationId);assert.match(p.data.requestError,/核对/);
});

test('server account invalidation requires a confirmed cloud reread before generating or adopting',async t=>{
  for(const code of ['EPOCH_CHANGED','ACCOUNT_REQUIRED','DELETE_PENDING']){
    const h=setup(t,{reply:()=>Promise.resolve({ok:false,code})}),p=h.p;
    p.onConsent(e({},['agree']));await p.onGenerate();
    assert.equal(p.data.needsCloudRefresh,true,code);
    assert.equal(p.data.canGenerate,false);assert.equal(p.data.consent,false);
    p.onConsent(e({},['agree']));await p.onGenerate();assert.equal(h.calls.length,1);
    p.onRules();assert.equal(p.data.preview.source,'rule');assert.equal(p.data.canAdopt,false);
    p.onAdopt();assert.equal(h.nav.length,0);
    h.app.cloudSession.start=async()=>{throw Error('cloud reread failed');};
    await p.onDataRetry();assert.equal(p.data.needsCloudRefresh,true);
    h.app.cloudSession.start=async()=>h.app.cloudSession.status();
    await p.onDataRetry();assert.equal(p.data.needsCloudRefresh,false);assert.equal(p.data.canGenerate,true);
    assert.equal(p.data.consent,false);assert.equal(h.calls.length,1);assert.equal(h.writes.length,0);
  }
});

test('cloud recovery after an AI account error does not update a reentered page from an old request',async t=>{
  const h=setup(t,{reply:()=>Promise.resolve({ok:false,code:'EPOCH_CHANGED'})}),p=h.p;
  p.onConsent(e({},['agree']));await p.onGenerate();
  const d=deferred();h.app.cloudSession.start=()=>d.promise;
  const work=p.onDataRetry();p.onHide();p.onShow();d.resolve(h.app.cloudSession.status());await work;
  assert.equal(p.data.needsCloudRefresh,true);assert.equal(p.data.canGenerate,false);
});

test('changing input or date cannot bypass a server account error; a confirmed new epoch clears old inputs',async t=>{
  const h=setup(t,{reply:()=>Promise.resolve({ok:false,code:'EPOCH_CHANGED'})}),p=h.p;
  p.onConsent(e({},['agree']));await p.onGenerate();p.change({direction:'tidy',minutes:'30'});
  const old=dates.today;let day=old();dates.today=()=>day;t.after(()=>{dates.today=old;});
  day=dates.shift(day,1);p.refresh();assert.equal(p.data.needsCloudRefresh,true);assert.equal(p.data.canGenerate,false);
  h.app.cloudSession.start=async()=>{h.s.epoch='confirmed-new-epoch';return h.app.cloudSession.status();};
  await p.onDataRetry();assert.equal(p.data.needsCloudRefresh,false);assert.equal(p.data.direction,'read');
  assert.equal(p.data.minutes,'5');assert.equal(p.data.preview,null);assert.equal(p.data.consent,false);
  assert.equal(h.calls.length,1);assert.equal(h.writes.length,0);
});

const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {fixture,dates,copy}=require('./helpers/cloud-fixture.cjs');
const {createAiApi,budgetConfiguration}=require('../server/ai-plan');
const {createProvider,postJSON}=require('../server/ai-provider');
const inputCore=require('../miniprogram/core/plan-assistant'),catalog=require('../miniprogram/core/ai-catalog');
const input={direction:'read',minutes:5,weekdays:[1,3,5],time:'12:30'};
const selection={actionKey:'read-resume',reasonKey:'start-small',target:4,minimum:1};
function setup(options={}){
  const f=fixture(),ledgers=new Map();let total=null,tail=Promise.resolve();f.time=Date.parse(f.date+'T04:00:00Z');f.paid=0;f.failWrites=false;
  const repository={transact(owner,work){const next=tail.then(async()=>{
    let ledger=copy(ledgers.get(owner)),budget=copy(total);
    const result=await work({account:async()=>copy(f.db.get(owner)),requests:async()=>copy(ledger),budget:async()=>copy(budget),
      putRequests:async value=>{if(f.failWrites)throw Error('private failure');ledger=copy(value);},putBudget:async value=>{budget=copy(value);}});
    if(ledger)ledgers.set(owner,ledger);total=budget;return copy(result);
  });tail=next.catch(()=>{});return next;}};
  const provider=async data=>{f.paid++;assert.deepEqual(Object.keys(data).sort(),['direction','minutes']);return options.provider?options.provider(data):selection;};
  const api=createAiApi({repository,inputCore,catalog,dates,provider,allowedAppId:f.identity.APPID,allowedSources:['wx_client'],
    budget:options.budget||{perCall:1000,daily:3000,monthly:5000,perUser:2},clock:()=>new Date(f.time),timeoutMs:options.timeoutMs||50});
  return Object.assign(f,{ledgers,repository,ai:(event,identity=f.identity)=>api(event,identity),budget:()=>copy(total),
    async aiRequest(id='request1'){const a=await f.pull();return {action:'suggest',epoch:a.epoch,operationId:id,operationDate:dates.today(f.time),consent:true,input:copy(input)};}});
}
test('AI catalogue only renders fixed reviewed text for valid per-direction actions and bounded integer targets',()=>{
  assert.equal(catalog.selectionToDraft(selection,input).target,4);
  for(const change of [{actionKey:'walk-near'},{reasonKey:'__proto__'},{target:6},{minimum:4},{target:'3'},{url:'https://example.com'},{action:'arbitrary'}])assert.throws(()=>catalog.selectionToDraft({...selection,...change},input));
  for(const direction of Object.keys(catalog.ACTIONS))for(const a of catalog.ACTIONS[direction])assert.ok(catalog.selectionToDraft({...selection,actionKey:a.key},{...input,direction}).action.length);
});
test('AI authentication, consent and input validation happen before reserving money or contacting provider',async()=>{
  const f=setup();await f.seed();const req=await f.aiRequest();
  for(const change of [{consent:false},{owner:'forged'},{epoch:'old'},{input:{...input,notes:'private'}},{input:{...input,minutes:'5'}},{operationId:[]}])assert.equal((await f.ai({...req,...change})).ok,false);
  assert.equal((await f.ai(req,{...f.identity,APPID:'other'})).code,'UNAUTHORIZED');assert.equal(f.paid,0);assert.equal(f.budget(),null);
});
test('concurrent AI requests reserve once and duplicate successful request reuses validated result',async()=>{
  const f=setup();await f.seed();const req=await f.aiRequest();
  const results=await Promise.all(Array.from({length:8},()=>f.ai(req)));assert.ok(results.some(r=>r.ok));assert.equal(f.paid,1);assert.equal(f.budget().dayReserved,1000);
  const again=await f.ai(req);assert.equal(again.ok,true);assert.equal(again.replayed,true);assert.equal(again.safetyMode,'allowlist-v1');assert.equal(again.draft.target,4);
  assert.deepEqual(again.draft.weekdays,input.weekdays);assert.equal(f.paid,1);
  assert.equal((await f.ai({...req,input:{...input,minutes:6}})).code,'IDEMPOTENCY_MISMATCH');
  assert.doesNotMatch(JSON.stringify([...f.ledgers]),/"input"|"title"|"action"|OPENID|test_user_a/);
});
test('user, global day and month caps fail before provider; unknown charges are conservatively retained across days',async()=>{
  const f=setup(),a=await f.seed();await f.ai(await f.aiRequest('a1'));await f.ai(await f.aiRequest('a2'));assert.equal((await f.ai(await f.aiRequest('a3'))).code,'RATE_LIMITED');
  const other={...f.identity,OPENID:'other'},b=await f.api({action:'pull'},other);
  const req={...await f.aiRequest('b1'),epoch:b.epoch};assert.equal((await f.ai(req,other)).ok,true);assert.equal((await f.ai({...req,operationId:'b2'},other)).code,'RATE_LIMITED');assert.equal(f.paid,3);
  f.time+=86400000;assert.equal((await f.ai(await f.aiRequest('a4'))).ok,true);assert.equal((await f.ai(await f.aiRequest('a5'))).ok,true);
  f.time+=86400000;assert.equal((await f.ai(await f.aiRequest('a6'))).code,'RATE_LIMITED');assert.equal(f.budget().monthReserved,5000);
  const original=f.ledgers.get(a.accountId);assert.equal(original.count,2,'rejected transaction cannot reset saved daily count');
});
test('AI timeout or malformed output never retries original request and does not refund reserved budget',async()=>{
  for(const provider of [()=>new Promise(()=>{}),async()=>({...selection,freeText:'not allowed'}),async()=>{throw Error('api_key secret');}]){
    const f=setup({provider,timeoutMs:5});await f.seed();const req=await f.aiRequest();
    const result=await f.ai(req);assert.equal(result.code,'AI_UNAVAILABLE');assert.doesNotMatch(JSON.stringify(result),/secret|api_key/);
    assert.equal((await f.ai(req)).code,'AI_UNAVAILABLE');assert.equal(f.paid,1);assert.equal(f.budget().dayReserved,1000);
  }
});
test('AI deletion during request discards late results and never recreates deleted ledger; reservation rollback blocks billing',async()=>{
  let finish;const f=setup({provider:()=>new Promise(r=>{finish=r;})}),a=await f.seed(),req=await f.aiRequest();
  const work=f.ai(req);while(!finish)await new Promise(setImmediate);
  f.db.get(a.accountId).epoch='new';f.ledgers.delete(a.accountId);finish(selection);
  assert.equal((await work).code,'EPOCH_CHANGED');assert.equal(f.ledgers.size,0);assert.equal(f.budget().dayReserved,1000);
  const g=setup();await g.seed();g.failWrites=true;assert.equal((await g.ai(await g.aiRequest())).ok,false);assert.equal(g.paid,0);assert.equal(g.budget(),null);
});
test('stale abandoned AI claim is never retried and does not block a later deliberate request forever',async()=>{
  const f=setup(),a=await f.seed();const req=await f.aiRequest();await f.ai(req);
  f.ledgers.get(a.accountId).receipts[0].status='claimed';f.time+=91000;
  assert.equal((await f.ai(req)).code,'AI_PENDING');assert.equal(f.paid,1);
  assert.equal((await f.ai(await f.aiRequest('another'))).ok,true);assert.equal(f.ledgers.get(a.accountId).receipts[0].status,'unknown');
});
test('AI budget configuration is required and provider only sends fixed endpoint JSON with bounded output and no schedule',async()=>{
  assert.throws(()=>budgetConfiguration({}));
  const config={HABIT_AI_RESERVATION_MICRO_CNY:'100',HABIT_AI_DAY_MICRO_CNY:'1000',HABIT_AI_MONTH_MICRO_CNY:'10000',HABIT_AI_USER_DAILY:'3'};
  assert.equal(budgetConfiguration(config).perUser,3);assert.throws(()=>budgetConfiguration({...config,HABIT_AI_USER_DAILY:'11'}));
  let payload;const provider=createProvider({key:'test-key-not-a-real-key',model:'server-chosen-model',post:async body=>{payload=body;return {choices:[{finish_reason:'stop',message:{content:JSON.stringify(selection)}}]};}},catalog);
  assert.deepEqual(await provider({direction:'read',minutes:5}),selection);assert.equal(payload.max_tokens,512);assert.deepEqual(payload.thinking,{type:'disabled'});
  assert.doesNotMatch(JSON.stringify(payload),/weekdays|openid|operationId|epoch/);assert.deepEqual(payload.response_format,{type:'json_object'});
  const truncated=createProvider({key:'test-key-not-a-real-key',model:'test',post:async()=>({choices:[{finish_reason:'length',message:{content:'{}'}}]})},catalog);await assert.rejects(truncated(input));
});
test('provider transport never follows redirect, caps body, redacts errors, times out and only targets fixed HTTPS host',async()=>{
  for(const mode of ['ok','redirect','large','invalid','timeout']){
    let options,ended,destroyed=false;
    const httpsApi={request(o,callback){options=o;const req=new EventEmitter();req.destroy=()=>{destroyed=true;};req.end=bytes=>{
      ended=JSON.parse(bytes);if(mode==='timeout')return;
      const res=new EventEmitter();res.statusCode=mode==='redirect'?302:200;res.resume=()=>{};callback(res);
      res.emit('data',Buffer.from(mode==='large'?'a'.repeat(33000):mode==='invalid'?'bad':'{"ok":true}'));res.emit('end');
    };return req;}};
    const call=postJSON({messages:[]},'fixture-secret',{httpsApi,timeoutMs:5});
    if(mode==='ok')assert.deepEqual(await call,{ok:true});else await assert.rejects(call,e=>e.message==='AI_PROVIDER_UNAVAILABLE');
    assert.equal(options.hostname,'api.deepseek.com');assert.equal(options.port,443);assert.equal(options.path,'/chat/completions');assert.deepEqual(ended,{messages:[]});
    if(['large','timeout'].includes(mode))assert.equal(destroyed,true);
  }
});

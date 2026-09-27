const test=require('node:test');
const assert=require('node:assert/strict');
const { configuration,createLimiter }=require('../server/limits');
const { createFeaturesApi,createPublicShareApi,PUBLIC_UNAVAILABLE }=require('../server/features');
const { featuresFixture }=require('./helpers/features-fixture.cjs');
const { domain,dates }=require('./helpers/cloud-fixture.cjs');
function fixture() {
  const saved=new Map();let tail=Promise.resolve();
  const f={saved,time:Date.parse('2026-09-27T04:00:00Z'),calls:0,fail:false,accounts:new Map([['a',{epoch:'e'}],['b',{epoch:'e'}]])};
  f.repository={transact(work){const next=tail.then(async()=>{
    f.calls++;if(f.fail)throw Error('private backend details');
    const draft=new Map([...saved].map(([k,v])=>[k,structuredClone(v)]));
    const result=await work({read:async id=>draft.get(id),put:async(id,value)=>draft.set(id,value),account:async id=>f.accounts.get(id)});
    saved.clear();draft.forEach((v,k)=>saved.set(k,v));return result;
  });tail=next.catch(()=>{});return next;}};
  f.limit=(scope='features',limits={minute:5,day:8,userMinute:2,userDay:3})=>createLimiter({scope,limits,repository:f.repository,clock:()=>f.time});
  return f;
}
test('limit configuration rejects zero, missing, decimals, coercion and unbounded ceilings',()=>{
  const env={X_MINUTE:'10',X_DAY:'100',X_USER_MINUTE:'2',X_USER_DAY:'8'};
  assert.deepEqual(configuration(env,'X'),{minute:10,day:100,userMinute:2,userDay:8});
  for(const raw of [undefined,'0','1.5','1e6','1000001','-1',[],3])assert.throws(()=>configuration({...env,X_DAY:raw},'X'));
  assert.deepEqual(configuration({X_MINUTE:'10',X_DAY:'100'},'X',false),{minute:10,day:100});
});
test('multi-instance limits atomically enforce user/global windows; denied calls do not consume global quota',async()=>{
  const f=fixture(),one=f.limit(),two=f.limit();
  const results=await Promise.allSettled(Array.from({length:12},(_,i)=>(i%2?one:two)('a','e')));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,2);
  assert.equal(f.saved.get('global-features').minuteUsed,2);
  await one('b','e');assert.equal(f.saved.get('global-features').minuteUsed,3);
  const before=f.calls;await assert.rejects(one('a','e'),e=>e.code==='RATE_LIMITED');assert.equal(f.calls,before);
  f.time+=60000;await one('a','e');await assert.rejects(one('a','e'),e=>e.code==='RATE_LIMITED');
  f.time+=86400000;await one('a','e');assert.equal(f.saved.get('features-a').dayUsed,1);
});
test('public limit has no identity and global exhaustion rejects cached without extra reads until next window',async()=>{
  const f=fixture(),limit=f.limit('public',{minute:2,day:3});
  await limit();await limit();await assert.rejects(limit(),e=>e.code==='RATE_LIMITED');
  const before=f.calls;await assert.rejects(limit());assert.equal(f.calls,before);
  f.time+=60000;await limit();await assert.rejects(limit());
  assert.deepEqual([...f.saved.keys()],['global-public']);assert.equal(f.saved.get('global-public').owner,undefined);
  await assert.rejects(limit('a','e'),/OWNER/);
});
test('quota failures, stale epochs and backwards clocks cannot overwrite counters or recreate deleted user documents',async()=>{
  const f=fixture(),limit=f.limit();await limit('a','e');const before=structuredClone([...f.saved]);
  f.time-=60000;await assert.rejects(f.limit()('a','e'),e=>e.code==='RATE_LIMITED');assert.deepEqual([...f.saved],before);
  f.time+=60000;f.fail=true;await assert.rejects(limit('a','e'));f.fail=false;
  f.accounts.get('a').cleanupPending=true;await assert.rejects(limit('a','e'),e=>e.code==='DELETE_PENDING');
  f.accounts.set('a',{epoch:'new'});await assert.rejects(limit('a','e'),e=>e.code==='EPOCH_CHANGED');
  assert.deepEqual([...f.saved],before);f.saved.delete('features-a');await limit('a','new');
  assert.equal(f.saved.get('features-a').ownerEpoch,'new');assert.equal(f.saved.get('global-features').dayUsed,2);
});
test('feature and public quota denial stops business repository operations and public output remains uniform',async()=>{
  const f=featuresFixture(),a=await f.seed();let reads=0,limits=0;
  const repository={transact(){reads++;throw Error('must not run');},share(){reads++;throw Error('must not run');}};
  const limiter=async()=>{limits++;throw Error('private quota details');};
  const handler=createFeaturesApi({repository,domain,dates,limiter,allowedAppId:f.identity.APPID,allowedSources:['wx_client']});
  assert.equal((await handler({action:'getPreferences',epoch:a.epoch},{})).code,'UNAUTHORIZED');assert.equal(limits,0);
  const result=await handler({action:'getPreferences',epoch:a.epoch},f.identity);assert.equal(result.code,'SERVICE_UNAVAILABLE');assert.doesNotMatch(JSON.stringify(result),/private/);
  assert.deepEqual(await createPublicShareApi({repository,domain,dates,limiter})({action:'getPublicShare',shareId:'a'.repeat(64)}),PUBLIC_UNAVAILABLE);
  assert.equal(reads,0);assert.equal(limits,2);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { creationAvailability, pendingRows, retainCompletion, effectiveRetained, MAX_RETAINED } = require('../miniprogram/services/today-flow');
const { domain, dates, plan } = require('./helpers/cloud-fixture.cjs');
const day = '2026-09-27';
test('creation capacity matches domain for current and next-day status transitions', () => {
  for (const count of [0,1,3,5]) for (const status of ['active','paused','archived']) {
    let state=domain.emptyState();
    for(let i=0;i<count;i++) state=domain.reduce(state,{type:'create',id:'h'+i,startDate:day,plan:plan()},day);
    if(count) state=domain.reduce(state,{type:'status',id:'h0',baseRevision:1,status},day);
    const allowed=creationAvailability(state,day);
    for(const [key,offset] of [['today',0],['tomorrow',1]]) {
      let succeeds=true;
      try { domain.reduce(state,{type:'create',id:'new',startDate:dates.shift(day,offset),plan:plan()},day); } catch(_) { succeeds=false; }
      assert.equal(allowed[key],succeeds,JSON.stringify({count,status,key}));
    }
  }
});
test('retained completions keep several rows in their original positions, dedupe and cap at five', () => {
  const pending=[{id:'a'},{id:'d'}], completed=[{id:'b',done:true},{id:'c',done:true}];
  const retained=[{id:'b',order:['a','b','c','d'],date:day,context:'one'},
    {id:'c',order:['a','c','d'],date:day,context:'one'}];
  assert.deepEqual(pendingRows(pending,completed,retained,day,'one').map(r=>r.id),['a','b','c','d']);
  // 跨天、跨账户、已不在完成集合或缺少完成行时不原位展示
  assert.equal(pendingRows(pending,completed,retained,dates.shift(day,1),'one').length,2, '跨天不展示');
  assert.equal(pendingRows(pending,completed,retained,day,'two').length,2, '跨账户不展示');
  assert.deepEqual(pendingRows(pending,[{id:'b',done:true}],retained,day,'one').map(r=>r.id),['a','b','d'], '已撤销的完成行不展示');
  assert.equal(pendingRows(pending,[],retained,day,'one').length,2, '没有完成行不展示');
  let list=[];
  for (const id of ['h1','h2','h3','h4','h5','h6']) list=retainCompletion(list,{id,date:day,context:'one',order:['h1','h2','h3','h4','h5','h6']});
  assert.equal(list.length,MAX_RETAINED);
  assert.deepEqual(list.map(item=>item.id),['h2','h3','h4','h5','h6']);
  // 同一习惯同一天再次完成只保留一条（去重）
  list=retainCompletion(list,{id:'h6',date:day,context:'one',order:['h6']});
  assert.equal(list.filter(item=>item.id==='h6').length,1);
});
test('effective retained rows only count habits still completed in the authoritative state', () => {
  const completed=[{id:'b',done:true}];
  const retained=[{id:'b',date:day,context:'one'},{id:'x',date:day,context:'one'}];
  assert.deepEqual(effectiveRetained(retained,completed,day,'one').map(item=>item.id),['b']);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { creationAvailability, pendingRows } = require('../miniprogram/services/today-flow');
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
test('inline slot requires matching completed record, date, context and unexpired lifetime', () => {
  const pending=[{id:'a'},{id:'c'}], completed=[{id:'b',done:true}];
  const recent={id:'b',order:['a','b','c'],date:day,context:'one',until:100};
  assert.deepEqual(pendingRows(pending,completed,recent,day,'one',99).map(r=>r.id),['a','b','c']);
  for (const [date,context,now,done] of [[day,'one',100,completed],[day,'two',1,completed],[dates.shift(day,1),'one',1,completed],[day,'one',1,[]]]) {
    assert.equal(pendingRows(pending,done,recent,date,context,now).length,2);
  }
});

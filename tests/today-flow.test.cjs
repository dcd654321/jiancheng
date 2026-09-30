const test = require('node:test');
const assert = require('node:assert/strict');
const { creationAvailability } = require('../miniprogram/services/today-flow');
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

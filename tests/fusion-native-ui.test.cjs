const test = require('node:test');
const assert = require('node:assert/strict');
const { timeline } = require('../miniprogram/services/today-timeline');
const ui = require('../miniprogram/services/ui');
const checkin = require('../miniprogram/services/checkin-ui');
const domain = require('../miniprogram/core/habits');
const dates = require('../miniprogram/core/date');

test('timeline separates pin, sorts time and stable id, keeps done in place and never changes source', () => {
  const source = [{ id:'z', time:'', done:false }, { id:'b',time:'12:00',done:true,status:'minimum' },
    { id:'a',time:'12:00',done:false },{ id:'p',time:'22:00',pinned:true,done:false }];
  const before=structuredClone(source), expanded=timeline(source);
  assert.deepEqual(expanded.timelineTasks.map(t=>t.id),['a','b','z']);
  assert.deepEqual(expanded.timelineTasks.filter(t=>t.unscheduledStart).map(t=>t.id),['z']);
  assert.deepEqual(expanded.pinnedTasks.map(t=>t.id),['p']);
  const folded=timeline(source,false);
  assert.deepEqual(folded.timelineTasks.map(t=>t.id),['a','z']);
  assert.deepEqual(folded.progressSegments,expanded.progressSegments);
  assert.equal(expanded.progressSegments.find(t=>t.id==='b').status,'minimum');
  assert.deepEqual(source,before);
});

function harness(t, options={}) {
  const original={getApp:global.getApp,wx:global.wx,Page:global.Page};
  let context='fixture:1', pending=0, state=domain.emptyState(), command;
  const day=dates.today();
  state=domain.reduce(state,{type:'create',id:'read',startDate:day,plan:{title:'读一会儿',target:20,minimum:2,unit:'分钟',weekdays:[1,2,3,4,5,6,7],time:'12:30'}},day);
  const listeners=new Set();
  const app={store:{contextKey:()=>context,info:()=>({ready:true,source:'cloud',pending}),read:()=>structuredClone(state),
    dispatch:async c=>{command=c;if(options.dispatch)return options.dispatch(c);state=domain.reduce(state,c,day);return state;}},
    cloudSession:{status:()=>({ready:true,accountId:'fixture',epoch:1,pending}),subscribe:()=>()=>{},subscribeConfirmed:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},retry:async()=>{}},
    mediaClient:{status:()=>({enabled:true}),upload:async()=>({mediaId:'fixture-photo'})}};
  global.wx={showToast(){},getSystemInfoSync:()=>({fontSizeSetting:16})};global.getApp=()=>app;
  let definition;global.Page=d=>definition=d;
  const source=require.resolve('../miniprogram/pages/detail/index');delete require.cache[source];require(source);
  const page={...definition,data:structuredClone(definition.data),setData(p){Object.assign(this.data,p);}};
  page._id='read';page._visible=true;page._showVersion=1;page._context=context;page.refresh();
  t.after(()=>{page.onUnload();Object.assign(global,original);});
  return {page,app,day,listeners,setPending:n=>pending=n,setContext:v=>context=v,command:()=>command,state:()=>state,
    confirm:c=>{state=domain.reduce(state,c,day);pending=0;page.refresh();}};
}

test('detail complete, undo, minimum, simplify and restore use confirmed real commands',async t=>{
  const h=harness(t), p=h.page, event=()=>({currentTarget:{dataset:{id:'read',date:h.day,done:p.data.task.done}}});
  assert.equal(await p.onComplete(event()),true);assert.equal(p.data.task.status,'standard');
  await p.onComplete(event());assert.equal(p.data.task.done,false);
  await p.onCompleteMinimum(event());assert.equal(p.data.task.status,'minimum');
  await p.onComplete(event());p.onToggleTodayGoal();p.onTodayTarget({detail:{value:'3'}});
  assert.equal(await p.onApplyTodayGoal(),true);assert.equal(p.data.task.target,3);assert.equal(p.data.task.done,false);
  await p.onRestore(event());assert.equal(p.data.task.target,20);
});

test('detail required photo and server fallback open shared panel without optimistic completion',async t=>{
  const h=harness(t), p=h.page;p.data.photoEnabled=true;p.data.pending[0].photoRequired=true;
  assert.equal(p.recordCompletion('read',h.day,'complete'),false);assert.equal(p.data.photoOpen,true);assert.equal(h.command(),undefined);
  p.onPhotoClose();p.onMutationFailure({code:'PHOTO_REQUIRED'},{type:'completeMinimum',id:'read',date:h.day});
  assert.equal(p.data.photoOpen,true);assert.equal(p.data.task.done,false);
});

test('unknown photo result retains panel through retry until confirmed and ignores other account',async t=>{
  const h=harness(t,{dispatch:async()=>{h.setPending(1);throw Error('unconfirmed');}}),p=h.page;
  p.startPhotoCheckin();p.openPhotoCheckin(p.data.task,'complete');
  global.wx.chooseMedia=o=>o.success({tempFiles:[{tempFilePath:'fixture.jpg'}]});p.onPhotoChoose();
  await new Promise(setImmediate);assert.equal(p.data.photoCanSubmit,true);
  assert.equal(await p.onPhotoSubmit(),false);assert.equal(p.data.photoPending,true);
  assert.equal(await p.onPhotoSubmit(),false);assert.equal(p.data.photoItems.length,1);
  for(const fn of h.listeners)fn({accountId:'other',epoch:1,command:h.command()});assert.equal(p.data.photoItems.length,1);
  for(const fn of h.listeners)fn({accountId:'fixture',epoch:1,command:h.command()});assert.equal(p.data.photoOpen,false);
});

test('detail rejects stale target draft after account or visit changes and preserves failed input',async t=>{
  const h=harness(t,{dispatch:async()=>{throw Error('offline');}}),p=h.page;
  p.onToggleTodayGoal();p.onTodayTarget({detail:{value:'4'}});assert.equal(await p.onApplyTodayGoal(),false);
  assert.equal(p.data.todayTarget,'4');assert.equal(p.data.todayGoalOpen,true);
  h.setContext('other:2');assert.equal(await p.onApplyTodayGoal(),false);
  assert.equal(p.data.task.target,20);
});

test('a late confirmed today-target closes the uncertain form only after the confirmed read',async t=>{
  const h=harness(t,{dispatch:async()=>{h.setPending(1);throw Error('unknown');}}),p=h.page;
  p.onToggleTodayGoal();p.onTodayTarget({detail:{value:'4'}});
  assert.equal(await p.onApplyTodayGoal(),false);assert.equal(p.data.todayGoalOpen,true);assert.equal(p.data.task.target,20);
  h.confirm(h.command());assert.equal(p.data.task.target,4);assert.equal(p.data.todayGoalOpen,false);
});

test('server PHOTO_REQUIRED on detail routes the failed standard intent into the shared panel',async t=>{
  const h=harness(t,{dispatch:async()=>{const e=Error('photo required');e.code='PHOTO_REQUIRED';throw e;}}),p=h.page;
  assert.equal(await p.recordCompletion('read',h.day,'complete'),false);
  assert.equal(p.data.photoOpen,true);assert.equal(p.data.photoRequired,true);assert.equal(p.data.task.done,false);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createStore, STORAGE_KEY } = require('../miniprogram/services/store');
const { createPlanAssistant } = require('../miniprogram/services/plan-assistant');
const { fields } = require('../miniprogram/services/plan-form');
const domain = require('../miniprogram/core/habits');
const dates = require('../miniprogram/core/date');
const e = (dataset, value) => ({ currentTarget: { dataset }, detail: { value } });
function harness(t) {
  const storage = {}, modals = [], nav = [], writes = [], sends = [];
  const wx = { getStorageSync: k => storage[k], setStorageSync: (k,v) => { storage[k]=v; }, removeStorageSync: k => { delete storage[k]; },
    showModal: o => modals.push(o), showToast() {}, setNavigationBarTitle() {},
    navigateTo: o => nav.push(o.url), navigateBack() {}, switchTab: o => nav.push(o.url),
    env: { USER_DATA_PATH: '/files' }, shareFileMessage: o => sends.push(o),
    getFileSystemManager: () => ({ writeFile: o => { writes.push(o); o.success(); }, unlinkSync() {}, renameSync() {} }) };
  const store = createStore(wx), app = { store, planAssistant: createPlanAssistant(wx, {}, {}) };
  global.wx = wx; global.getApp = () => app;
  const pages = []; t.after(() => pages.forEach(p => p.onUnload()));
  function page(name, options={}) {
    let def; global.Page = x => { def=x; };
    const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js'); delete require.cache[file]; require(file);
    const p = { ...def, data: JSON.parse(JSON.stringify(def.data)), setData(x, cb) { Object.assign(this.data,x); if(cb) cb(); } };
    pages.push(p); if(p.onLoad) p.onLoad(options); p.onShow(); return p;
  }
  function seed(start=dates.today()) {
    const plan = { title:'读书', target:5, minimum:2, unit:'分钟', time:'', weekdays:[1,2,3,4,5,6,7] };
    storage[STORAGE_KEY] = JSON.stringify(domain.reduce(domain.emptyState(), { type:'create', id:'read', startDate:start, plan }, start));
  }
  return { wx, store, app, modals, nav, writes, sends, storage, page, seed };
}
test('compact create keeps optional values while the busy-day target stays in the main form', t => {
  const h=harness(t), p=h.page('edit'); assert.equal(p.data.moreOpen,false);
  p.onMore(); p.onTime(e({},'21:30')); p.onInput(e({field:'minimum'},'2')); p.onStart(e({offset:1})); p.onMore(); p.refresh();
  assert.equal(p.data.moreOpen,false); assert.equal(p.data.time,'21:30'); assert.equal(p.data.minimum,'2');
  assert.match(p.data.moreSummary,/21:30.*明天/); assert.doesNotMatch(p.data.moreSummary,/忙时|2分钟/);
  const markup=fs.readFileSync(path.resolve(__dirname,'../miniprogram/pages/edit/index.wxml'),'utf8');
  assert.ok(markup.indexOf('id="field-minimum"') < markup.indexOf('id="field-weekdays"'));
  assert.equal(h.store.read().habits.length,0);
});
test('Unicode title cap agrees with domain and validation errors are next to fields', t => {
  const h=harness(t), p=h.page('edit');
  p.onInput(e({field:'title'}, '😀'.repeat(21))); assert.equal(p.data.titleCount,20); assert.equal(Array.from(p.data.title).length,20);
  p.onInput(e({field:'target'},'121')); p.onSave(); assert.match(p.data.fieldErrors.target,/120/); assert.equal(h.store.read().habits.length,0);
  p.onInput(e({field:'target'},'5')); p.onInput(e({field:'minimum'},'5')); p.setData({moreOpen:false}); p.onSave();
  assert.equal(p.data.moreOpen,false); assert.ok(p.data.fieldErrors.minimum); assert.equal(h.store.read().habits.length,0);
});
test('form field validation remains consistent with domain for ranges and optional targets', () => {
  for(const unit of ['分钟','页','次']) for(const target of [0,1,5,120,121,999,1000,1.5]) for(const minimum of ['',0,1,4,999]) {
    const p={title:'读书',unit,target,minimum,time:'',weekdays:[1]}; let valid=true; try{domain.validatePlan(p);}catch(_){valid=false;}
    assert.equal(Object.keys(fields(p)).length===0,valid,JSON.stringify(p));
  }
});
test('saving locks all visible plan controls and a failed save retains form values', async t => {
  const h=harness(t), p=h.page('edit',{template:'read'}); let reject;
  h.store.dispatch=()=>new Promise((_,r)=>{reject=r;}); const work=p.onSave();
  p.onMore(); p.onInput(e({field:'title'},'changed')); p.onUnit(e({},1)); p.onTime(e({},'10:30')); p.onDay(e({day:1})); p.onStart(e({offset:1}));
  assert.equal(p.data.title,'读一会儿'); assert.equal(p.data.moreOpen,false); assert.equal(p.data.unit,'分钟'); assert.equal(p.data.weekdays.length,7); assert.equal(p.data.startOffset,0);
  reject(Error('offline')); await work; assert.equal(p.data.saving,false); assert.equal(h.nav.length,0); assert.match(p.data.error,/offline/);
});
test('history starts with real scheduled dates and expansion does not change records', t => {
  const h=harness(t); h.seed(dates.shift(dates.today(),-20)); const p=h.page('detail',{id:'read'}), before=h.store.rawBackup();
  assert.equal(p.data.history.length,21); assert.equal(p.data.visibleHistory.length,7); p.onToggleHistory(); assert.equal(p.data.visibleHistory.length,21);
  p.onToggleHistory(); assert.equal(p.data.visibleHistory.length,7); assert.equal(h.store.rawBackup(),before);
});
test('new habit detail has no padded pre-start history and note collapse keeps the draft', t => {
  const h=harness(t); h.seed(); const p=h.page('detail',{id:'read'}); assert.equal(p.data.history.length,1); assert.equal(p.data.noteOpen,false);
  p.onToggleNote(); p.onNote(e({},'draft')); p.onToggleNote(); p.refresh(); assert.equal(p.data.noteDirty,true); assert.equal(p.data.note,'draft');
  p.onMore(); assert.equal(p.data.moreOpen,true); assert.equal(h.store.read().habits[0].revision,1);
});
test('completed group collapse is display-only and completion counts keep their exact meaning', t => {
  const h=harness(t); h.seed(); const p=h.page('today'); p.onComplete(e({id:'read',date:dates.today(),done:false}));
  assert.equal(p.data.showCompleted,false); const before=h.store.rawBackup(); p.onToggleCompleted(); p.refresh(); assert.equal(p.data.showCompleted,true); assert.equal(h.store.rawBackup(),before);
  const progress=h.page('progress'); assert.equal(progress.data.stats.done,1); assert.equal(progress.data.stats.planned,1);
  assert.equal(progress.data.stats.cells.at(-1).mark,'1/1'); assert.equal(progress.data.stats.cells[0].mark,'休');
  progress.onToggleHabits(); assert.equal(progress.data.showHabits,true); assert.equal(h.store.rawBackup(),before);
});
test('today task keeps choosing a smaller goal separate from completing it', t => {
  const h=harness(t); h.seed(); const p=h.page('today');
  assert.equal(p.data.pending[0].originalTarget,5); assert.equal(p.data.pending[0].minimum,2);
  assert.equal(p.data.pending[0].target,5); assert.equal(p.data.pending[0].done,false);
  p.onSimplify(e({id:'read',date:dates.today()})); assert.equal(h.modals.at(-1).content,'2');
  h.modals.pop().success({confirm:true,content:'2'});
  assert.equal(p.data.pending[0].target,2); assert.equal(p.data.pending[0].done,false);
  p.onComplete(e({id:'read',date:dates.today(),done:false}));
  assert.equal(p.data.completed[0].status,'minimum');
  const progress=h.page('progress');
  assert.equal(progress.data.selected.tasks[0].statusText,'小目标完成');
  assert.match(progress.data.selected.description,/小目标1项/);
  assert.equal(h.page('detail',{id:'read'}).data.history[0].status,'小目标完成');
  p.onComplete(e({id:'read',date:dates.today(),done:true}));
  p.onRestore(e({id:'read',date:dates.today()}));
  p.onComplete(e({id:'read',date:dates.today(),done:false}));
  assert.equal(p.data.completed[0].status,'standard');
});
test('unconfigured small goal stays unset and target one offers no lower-goal action', t => {
  const h=harness(t), day=dates.today();
  const plan={title:'喝水',target:1,minimum:null,unit:'次',time:'',weekdays:[1,2,3,4,5,6,7]};
  h.storage[STORAGE_KEY]=JSON.stringify(domain.reduce(domain.emptyState(),{type:'create',id:'water',startDate:day,plan},day));
  const p=h.page('today'); assert.equal(p.data.pending[0].minimum,null); assert.equal(p.data.pending[0].originalTarget,1);
  const markup=fs.readFileSync(path.resolve(__dirname,'../miniprogram/templates/task.wxml'),'utf8');
  assert.match(markup,/task\.originalTarget > 1/); assert.match(markup,/task\.minimum && !task\.simplified/);
  assert.match(markup,/!task\.minimum \|\| detail \|\| task\.simplified/);
  assert.match(markup,/按忙时目标打卡/); assert.match(markup,/今天少做一点 · 自己填/);
  assert.match(markup,/小目标完成/); assert.match(markup,/原目标完成/);
  assert.match(markup,/平时 \{\{task\.originalTarget\}\}/); assert.match(markup,/忙时 \{\{task\.minimum\}\}/);
});
test('one-tap busy-goal check-in moves only that habit to completed', t => {
  const h=harness(t); h.seed();
  const day=dates.today();
  h.store.dispatch({type:'create',id:'walk',startDate:day,plan:{title:'走路',target:10,minimum:3,unit:'分钟',time:'10:00',weekdays:[1,2,3,4,5,6,7]}});
  const p=h.page('today');
  assert.equal(p.data.pending.length,2); assert.equal(p.data.completed.length,0);
  p.onCompleteMinimum(e({id:'read',date:day}));
  assert.equal(p.data.pending.length,1); assert.equal(p.data.pending[0].id,'walk');
  assert.equal(p.data.completed.length,1); assert.equal(p.data.completed[0].status,'minimum');
  assert.equal(p.data.completed[0].target,2);
  assert.equal(h.store.read().records['walk@'+day],undefined);
  const todayMarkup=fs.readFileSync(path.resolve(__dirname,'../miniprogram/pages/today/index.wxml'),'utf8');
  assert.match(todayMarkup,/待做 \{\{pending\.length\}\} · 已做 \{\{completed\.length\}\}/);
  const mineMarkup=fs.readFileSync(path.resolve(__dirname,'../miniprogram/pages/mine/index.wxml'),'utf8');
  assert.match(mineMarkup,/open-type="feedback"[^>]*>.*意见与问题反馈/);
});
test('five scheduled habits keep independent cards and an accurate remaining count', t => {
  const h=harness(t); h.seed(); const day=dates.today();
  for (let i=1; i<5; i++) h.store.dispatch({type:'create',id:'habit'+i,startDate:day,
    plan:{title:'任务'+i,target:5,minimum:2,unit:'次',time:'1'+i+':00',weekdays:[1,2,3,4,5,6,7]}});
  const p=h.page('today'); assert.equal(p.data.total,5); assert.equal(p.data.pending.length,5);
  p.onCompleteMinimum(e({id:'habit2',date:day}));
  assert.equal(p.data.pending.length,4); assert.equal(p.data.completed.length,1);
  assert.equal(p.data.completed[0].id,'habit2');
  assert.equal(Object.keys(h.store.read().records).length,1);
});
test('first created habit is the next visible task, without auto-completion', t => {
  const h=harness(t), edit=h.page('edit',{template:'read'}); edit.onSave();
  const firstId=h.store.read().habits[0].id, day=dates.today();
  const other={title:'较早的任务',target:1,minimum:null,unit:'次',time:'08:00',weekdays:[1,2,3,4,5,6,7]};
  h.store.dispatch({type:'create',id:'a_other',startDate:day,plan:other});
  const today=h.page('today');
  assert.equal(today.data.pending[0].id,firstId); assert.equal(today.data.done,0);
  assert.match(today.data.firstHabitGuide,/第一次/); assert.equal(h.app.firstHabitGuide,null);
  today.refresh(); assert.equal(today.data.pending[0].id,firstId);
  today.onComplete(e({id:firstId,date:day,done:false})); assert.equal(today.data.firstHabitGuide,'');
});
test('first habit scheduled tomorrow gives a true next date and no today task', t => {
  const h=harness(t), edit=h.page('edit',{template:'read'}); edit.onStart(e({offset:1})); edit.onSave();
  const today=h.page('today'), tomorrow=dates.shift(dates.today(),1);
  assert.equal(today.data.total,0); assert.equal(today.data.pending.length,0);
  assert.match(today.data.firstHabitGuide,new RegExp(dates.label(tomorrow)));
  assert.match(today.data.firstHabitGuide,/今天不用打卡/);
  today.onDismissGuide(); assert.equal(today.data.firstHabitGuide,'');
});
test('my page routes to real data hub; export and double-confirm deletion still work there', async t => {
  const h=harness(t); h.seed(); const mine=h.page('mine'); mine.onData(); assert.equal(h.nav.at(-1),'/pages/data/index');
  const p=h.page('data'); p.onExport(); h.modals.pop().success({confirm:false,cancel:true}); assert.equal(h.writes.length,1); assert.equal(h.sends.length,1);
  p.onDelete(); p.onDelete(); assert.equal(h.modals.length,1); h.modals.pop().success({confirm:true}); assert.equal(h.modals.length,1);
  h.modals.pop().success({confirm:false}); assert.equal(p.data.deleting,false); assert.equal(h.store.read().habits.length,1);
  p.onDelete(); h.modals.pop().success({confirm:true}); await h.modals.pop().success({confirm:true}); assert.equal(h.store.read().habits.length,0); assert.equal(p.data.deleting,false);
});
test('assistant advanced schedule stays in preview and adoption never creates automatically', t => {
  const h=harness(t), p=h.page('assistant'); assert.equal(p.data.moreOpen,false);
  p.onMore(); p.onTime(e({},'20:15')); p.onMore(); p.onRules(); assert.equal(p.data.preview.draft.time,'20:15');
  assert.match(p.data.inputSchedule,/20:15/); p.onAdopt(); const token=h.nav.at(-1).split('draft=')[1];
  const edit=h.page('edit',{draft:token}); assert.equal(edit.data.time,'20:15'); assert.match(edit.data.moreSummary,/20:15/); assert.equal(h.store.read().habits.length,0);
});
test('acknowledged deletion releases the control even when file cleanup fails, without hiding the warning', async t => {
  const h=harness(t); h.seed(); const p=h.page('data');
  h.wx.getFileSystemManager=()=>{throw Error('file access denied');};
  p.onDelete(); h.modals.pop().success({confirm:true}); await h.modals.pop().success({confirm:true});
  assert.equal(p.data.deleting,false); assert.match(p.data.error,/云端数据已清除.*未能删除/); assert.equal(h.store.read().habits.length,0);
});
test('delete response after unload cleans scoped files without updating an abandoned page', async t => {
  const h=harness(t); h.seed(); const p=h.page('data'); let resolve;
  const clear=h.store.clear; h.store.clear=()=>new Promise(r=>{resolve=()=>{clear();r();};});
  p.onDelete(); h.modals.pop().success({confirm:true}); const work=h.modals.pop().success({confirm:true});
  p.onUnload(); p.setData=()=>{throw Error('must not update old page');}; resolve(); await work; assert.equal(p._deleting,false);
});
test('management and backup routes show unavailable state instead of a false empty account', t => {
  const h=harness(t); h.app.store={read(){const err=Error('offline');err.code='DATA_UNAVAILABLE';throw err;},info:()=>({}),hasLegacyData:()=>false};
  for(const name of ['manage','restore','data']) { const p=h.page(name); assert.equal(p.data.dataReady,false); assert.equal(p.data.dataUnavailable,true); }
});
test('registered pages, touchable weekday selectors, truthful copy and data-menu placement are wired', () => {
  const read=f=>fs.readFileSync(path.resolve(__dirname,'../miniprogram',f),'utf8');
  assert.ok(JSON.parse(read('app.json')).pages.includes('pages/data/index'));
  assert.match(read('app.wxss'),/\.week-options\s*\{[^}]*repeat\(4, minmax\(0, 1fr\)\)/);
  for(const name of ['edit','assistant']) assert.match(read('pages/'+name+'/index.wxml'),/class="week-options"/);
  const mine=read('pages/mine/index.wxml'); assert.doesNotMatch(mine,/bindtap="onDelete"|bindtap="onExport"/); assert.match(mine,/open-type="feedback"/);
  assert.match(read('pages/data/index.wxml'),/bindtap="onDelete"/); assert.match(read('pages/restore/index.wxml'),/暂不支持从文件导入恢复/);
  assert.doesNotMatch(read('pages/assistant/index.wxml'),/AI服务尚未接入|不消耗模型费用/);
  assert.match(read('templates/task.wxml'),/>撤销打卡</);
});

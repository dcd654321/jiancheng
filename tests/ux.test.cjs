const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createStore, STORAGE_KEY } = require('./legacy/store.cjs');
const { createPlanAssistant } = require('../miniprogram/services/plan-assistant');
const { fields } = require('../miniprogram/services/plan-form');
const domain = require('../miniprogram/core/habits');
const dates = require('../miniprogram/core/date');
const e = (dataset, value) => ({ currentTarget: { dataset }, detail: { value } });
function harness(t) {
  const storage = {}, modals = [], nav = [], writes = [], sends = [], toasts = [];
  const wx = { getStorageSync: k => storage[k], setStorageSync: (k,v) => { storage[k]=v; }, removeStorageSync: k => { delete storage[k]; },
    showModal: o => modals.push(o), showToast: o => toasts.push(o), setNavigationBarTitle() {},
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
  return { wx, store, app, modals, nav, writes, sends, toasts, storage, page, seed };
}
test('compact create keeps optional values while the busy-day target stays in the main form', t => {
  const h=harness(t), p=h.page('edit'); assert.equal(p.data.moreOpen,false); assert.equal(p.data.compact,false);
  p.onMore(); p.onTime(e({},'21:30')); p.onAddMinimum(); p.onInput(e({field:'minimum'},'2')); p.onStart(e({offset:1})); p.onMore(); p.refresh();
  assert.equal(p.data.moreOpen,false); assert.equal(p.data.time,'21:30'); assert.equal(p.data.minimum,'2');
  assert.equal(p.data.moreSummary,'21:30'); assert.doesNotMatch(p.data.moreSummary,/忙时|2分钟|明天/);
  const markup=fs.readFileSync(path.resolve(__dirname,'../miniprogram/pages/edit/index.wxml'),'utf8');
  assert.ok(markup.indexOf('id="field-minimum"') < markup.indexOf('id="field-weekdays"'));
  assert.equal(h.store.read().habits.length,0);
});
test('template entry uses the compact confirmation with the read defaults and one-time draft consumption', t => {
  const h=harness(t), p=h.page('edit',{template:'read'});
  assert.equal(p.data.compact,true); assert.equal(p.data.title,'读一会儿'); assert.equal(p.data.target,'30'); assert.equal(p.data.minimum,'10');
  assert.equal(p.data.unit,'分钟'); assert.equal(p.data.startOffset,0); assert.equal(p.data.frequencyLabel,'每天');
  assert.equal(p.data.frequencyOpen,false); assert.equal(p.data.startOpen,false);
  assert.equal(h.store.read().habits.length,0, 'template stays uncommitted until the user saves');
  p.onSave(); assert.equal(h.store.read().habits.length,1);
  assert.equal(h.store.read().habits[0].versions[0].target,30);
  assert.equal(h.store.read().habits[0].versions[0].minimum,10);
});
test('custom and edit entries keep the full form while drafts cannot be re-consumed after reload', t => {
  const h=harness(t), custom=h.page('edit'); assert.equal(custom.data.compact,false);
  h.seed(); const edit=h.page('edit',{id:'read'}); assert.equal(edit.data.compact,false); assert.equal(edit.data.editing,true);
  const { ruleSuggestion } = require('../miniprogram/core/plan-assistant');
  const token=h.app.planAssistant.handoff(ruleSuggestion({ direction:'read', minutes:5, weekdays:[1,2,3], time:'' }), 'cloud');
  const compact=h.page('edit',{draft:token}); assert.equal(compact.data.compact,true); assert.equal(compact.data.weekdays.length,3);
  compact.onInput(e({field:'title'},'改过的名字')); compact.refresh();
  assert.equal(compact.data.title,'改过的名字', 'refresh keeps user input instead of re-reading a consumed draft');
});
test('Unicode title cap agrees with domain and validation errors are next to fields', t => {
  const h=harness(t), p=h.page('edit');
  p.onInput(e({field:'title'}, '😀'.repeat(21))); assert.equal(p.data.titleCount,20); assert.equal(Array.from(p.data.title).length,20);
  p.onInput(e({field:'target'},'121')); p.onSave(); assert.match(p.data.fieldErrors.target,/120/); assert.equal(h.store.read().habits.length,0);
  p.onInput(e({field:'target'},'5')); p.onAddMinimum(); p.onInput(e({field:'minimum'},'5')); p.setData({moreOpen:false}); p.onSave();
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
test('invalid detail id shows a reason and exit instead of an endless loading card', t => {
  const h=harness(t); h.seed(); const p=h.page('detail',{id:'missing'});
  assert.equal(p.data.invalid,true); assert.equal(p.data.dataReady,true); assert.equal(p.data.task,null);
  assert.equal(p.data.history.length,0); p.onToday(); assert.equal(h.nav.at(-1),'/pages/today/index');
});
test('completed group collapse is display-only and completion counts keep their exact meaning', t => {
  const h=harness(t); h.seed(); const p=h.page('today'); p.onComplete(e({id:'read',date:dates.today(),done:false}));
  assert.equal(p.data.showCompleted,true, '完成后自动展开今日已完成'); const before=h.store.rawBackup();
  p.onToggleCompleted(); assert.equal(p.data.showCompleted,false); p.onToggleCompleted(); p.refresh(); assert.equal(p.data.showCompleted,true); assert.equal(h.store.rawBackup(),before);
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
  assert.equal(p.data.pending[0].simplified,true);
  p.onComplete(e({id:'read',date:dates.today(),done:false}));
  assert.equal(p.data.completed[0].status,'minimum');
  const progress=h.page('progress');
  assert.equal(progress.data.selected.tasks[0].statusText,'忙时完成');
  assert.match(progress.data.selected.description,/忙时1项/);
  assert.equal(h.page('detail',{id:'read'}).data.history[0].status,'忙时完成');
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
  assert.match(markup,/task\.originalTarget > 1/); assert.match(markup,/quickMinimumEnabled && task\.minimum/);
  assert.match(markup,/task\.simplified/); assert.match(markup,/恢复今天原目标/);
  assert.match(markup,/忙时按 ' \+ task\.minimum \+ task\.unit \+ ' 记下/); assert.match(markup,/今天少做一点 · 自己填/);
  assert.match(markup,/忙时完成/); assert.match(markup,/原目标完成/);
  assert.match(markup,/今天' \+ task\.target/); assert.match(markup,/忙时 \{\{task\.minimum\}\}/);
  assert.match(markup,/原计划 \{\{task\.originalTarget\}\}/);
});
test('one-tap busy-goal availability follows the config flag and keeps the manual path', t => {
  const h=harness(t); h.seed(); const today=h.page('today');
  const detail=h.page('detail',{id:'read'});
  assert.equal(today.data.quickMinimumEnabled,true);
  assert.equal(detail.data.quickMinimumEnabled,true);
  assert.equal(today.data.pending[0].minimum,2);
  const markup=fs.readFileSync(path.resolve(__dirname,'../miniprogram/templates/task.wxml'),'utf8');
  assert.match(markup,/quickMinimumEnabled && task\.minimum/);
  assert.match(markup,/今天少做一点 · /);
  const ui=require('../miniprogram/services/ui');
  const original=ui.quickMinimumEnabled;
  ui.quickMinimumEnabled=false;
  try {
    const legacy=h.page('today');
    assert.equal(legacy.data.quickMinimumEnabled,false);
    assert.equal(legacy.data.pending[0].minimum,2);
  } finally { ui.quickMinimumEnabled=original; }
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
  assert.match(todayMarkup,/<text>待做<\/text><text class="section-count">\{\{pending\.length\}\} 项<\/text>/);
  assert.match(todayMarkup,/<text class="progress-value">\{\{done\}\} \/ \{\{total\}\}<\/text>/);
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
test('a confirmed completion moves straight into the expanded 今日已完成 group', t => {
  const h=harness(t); h.seed(); const day=dates.today();
  for (const id of ['a','z']) h.store.dispatch({type:'create',id,startDate:day,plan:{title:id,target:5,minimum:2,unit:'分钟',time:'',weekdays:[1,2,3,4,5,6,7]}});
  const p=h.page('today'); assert.deepEqual(p.data.pending.map(t=>t.id),['a','read','z']);
  p.onComplete(e({id:'read',date:day,done:false}));
  assert.deepEqual(p.data.pending.map(t=>t.id),['a','z'], '完成项立刻离开待做，不留原位');
  assert.equal(p.data.completed.some(t=>t.id==='read'), true, '直接进入今日已完成');
  assert.equal(p.data.showCompleted, true, '自动展开今日已完成');
  assert.equal(h.toasts.at(-1).title, '已完成 · 第一次', '首次完成带短后缀');
  assert.equal(h.toasts.at(-1).icon, 'success', '完成用小弹窗（成功图标）');
  assert.equal(h.store.read().records['a@'+day],undefined);
  // 在分组里撤销回到待做，同时提示已撤销
  p.onComplete(e({id:'read',date:day,done:true}));
  assert.equal(p.data.done,0); assert.equal(p.data.pending.some(t=>t.id==='read'), true);
  assert.equal(h.toasts.at(-1).title, '已撤销这次记录');
});
test('several completions move into the group immediately and keep accurate counts', t => {
  const h=harness(t); h.seed(); const day=dates.today();
  for (let i=0;i<4;i++) h.store.dispatch({type:'create',id:'h'+i,startDate:day,plan:{title:'任务'+i,target:5,minimum:2,unit:'次',time:'0'+(i+1)+':00',weekdays:[1,2,3,4,5,6,7]}});
  const p=h.page('today'); assert.equal(p.data.total,5, '最多5个活跃习惯');
  const order=p.data.pending.map(t=>t.id);
  p.onComplete(e({id:order[0],date:day,done:false}));
  p.onCompleteMinimum(e({id:order[1],date:day}));
  assert.equal(p.data.done,2); assert.equal(p.data.minimum,1);
  assert.deepEqual(p.data.pending.map(t=>t.id),order.slice(2), '未完成项保持顺序');
  assert.deepEqual(p.data.completed.map(t=>t.id).sort(),[order[0],order[1]].sort(), '两次完成都立刻归入已完成');
  assert.equal(p.data.showCompleted, true);
  for (const id of order.slice(2)) p.onComplete(e({id,date:day,done:false}));
  assert.equal(p.data.done,5); assert.equal(p.data.pending.length,0);
});
test('a completion confirmed while hidden does not auto-expand and leaves no retained state', async t => {
  const h=harness(t); h.seed(); const p=h.page('today'), day=dates.today();
  let resolve; h.store.dispatch=()=>new Promise(r=>{resolve=r;});
  const work=p.onComplete(e({id:'read',date:day})); p.onHide(); resolve(); await work;
  assert.equal(p._retained, undefined, '不再有任何原位展示状态');
  assert.equal(p.data.showCompleted, false, '隐藏页面的回执不触发自动展开');
});
test('repeated taps on a record button keep a single intent until the write resolves', async t => {
  const h=harness(t); h.seed(); const p=h.page('today'), day=dates.today();
  let resolve, dispatches=0;
  h.store.dispatch=()=>{dispatches++; return new Promise(r=>{resolve=r;});};
  const first=p.onComplete(e({id:'read',date:day,done:false}));
  const second=p.onComplete(e({id:'read',date:day,done:false}));
  const third=p.onComplete(e({id:'read',date:day,done:false}));
  assert.equal(second,false); assert.equal(third,false);
  assert.equal(dispatches,1, '串行锁下只发出一次写入意图');
  resolve(); await first;
  assert.equal(p.data.done,0, '未确认前不显示完成');
});
test('undo keeps the note and the adjusted today target while the long-term plan stays', t => {
  const h=harness(t); h.seed(); const p=h.page('today'), day=dates.today();
  h.store.dispatch({type:'note',id:'read',date:day,note:'今天很忙'});
  p.onCompleteMinimum(e({id:'read',date:day}));
  assert.equal(p.data.completed[0].status,'minimum');
  p.onComplete(e({id:'read',date:day,done:true}));
  const record=h.store.read().records['read@'+day];
  assert.equal(record.status,'pending'); assert.equal(record.todayTarget,2);
  assert.equal(record.note,'今天很忙');
  assert.equal(h.store.read().habits[0].versions[0].target,5);
  assert.equal(h.toasts.at(-1).title,'已撤销这次记录');
  p.onRestore(e({id:'read',date:day}));
  assert.equal(h.store.read().records['read@'+day].todayTarget,5);
});
test('a pending record shows the in-progress label on that row only and locks its buttons', async t => {
  const h=harness(t); h.seed(); const p=h.page('today'), day=dates.today();
  let resolve;
  h.store.dispatch=()=>new Promise(r=>{resolve=r;});
  const work=p.onComplete(e({id:'read',date:day,done:false}));
  assert.equal(p.data.recordingId,'read','进行中显示在对应的任务行');
  const markup=fs.readFileSync(path.resolve(__dirname,'../miniprogram/templates/task.wxml'),'utf8');
  assert.match(markup,/recordingId === task\.id \? '正在记录…'/);
  assert.match(markup,/disabled="\{\{readOnly \|\| recordingId === task\.id\}\}"/);
  resolve(); await work;
  assert.equal(p.data.recordingId,'','确认后清除进行中状态');
});
test('small-screen, keyboard and safe-area adaptations stay in the shipped styles', () => {
  const wxss=fs.readFileSync(path.resolve(__dirname,'../miniprogram/app.wxss'),'utf8');
  assert.match(wxss,/env\(safe-area-inset-bottom\)/);
  assert.match(wxss,/@media \(max-width: 359px\)/);
  assert.match(wxss,/\.input\.focused[^{]*\{[^}]*inset 0 0 0 2px/);
  const edit=fs.readFileSync(path.resolve(__dirname,'../miniprogram/pages/edit/index.wxml'),'utf8');
  assert.match(edit,/bindkeyboardheightchange="onKeyboard"/);
  assert.match(edit,/class="submit-bar \{\{keyboardOpen \? 'inline' : ''\}\}"/);
});
test('failed completion never reports success or expands the group', async t => {
  const h=harness(t); h.seed(); const p=h.page('today'), day=dates.today();
  h.store.dispatch=()=>{throw Error('disk full');};
  assert.equal(p.onComplete(e({id:'read',date:day})),false);
  assert.equal(p.data.done,0); assert.equal(p.data.showCompleted,false);
  assert.equal(h.toasts.length,0, '失败不弹完成提示');
});
test('full capacity leads to management and a free tomorrow opens the correct start date', t => {
  const h=harness(t); h.seed(); const day=dates.today();
  for(let i=1;i<5;i++) h.store.dispatch({type:'create',id:'h'+i,startDate:day,plan:{title:'任务'+i,target:5,minimum:2,unit:'次',time:'',weekdays:[1,2,3,4,5,6,7]}});
  const p=h.page('today'); p.onCreate(e({})); assert.equal(h.nav.length,0);
  assert.match(h.modals.at(-1).content,/最多同时进行 5/); h.modals.pop().success({confirm:true});
  assert.equal(h.nav.at(-1),'/pages/manage/index');
  h.store.dispatch({type:'status',id:'read',baseRevision:1,status:'paused'});
  p.refresh(); assert.equal(p.data.canCreateToday,false); assert.equal(p.data.canCreateTomorrow,true);
  p.onCreate(e({template:'walk'})); assert.equal(h.nav.at(-1),'/pages/edit/index?template=walk&start=tomorrow');
  const edit=h.page('edit',{template:'walk',start:'tomorrow'}); assert.equal(edit.data.startOffset,1);
  assert.match(edit.data.capacityNote,/从明天开始/);
  assert.equal(edit.data.canCreateToday,false);
  edit.onSave(); assert.equal(h.store.read().habits.length,6);
});
test('tomorrow summary uses future versions, limits visible titles and never modifies records', t => {
  const h=harness(t); h.seed(); const day=dates.today();
  for(let i=1;i<5;i++) h.store.dispatch({type:'create',id:'h'+i,startDate:day,plan:{title:'任务'+i,target:5,minimum:2,unit:'次',time:'',weekdays:[1,2,3,4,5,6,7]}});
  const p=h.page('today'), before=h.store.rawBackup();
  assert.equal(p.data.tomorrow.count,5); assert.equal(p.data.tomorrow.tasks.length,3); assert.equal(p.data.tomorrow.remaining,2);
  assert.equal(h.store.rawBackup(),before);
  h.store.dispatch({type:'status',id:'read',baseRevision:1,status:'paused'}); p.refresh();
  assert.equal(p.data.tomorrow.count,4); assert.equal(p.data.total,5);
});
test('help describes the enabled one-tap flow and keeps the two-step fallback wording', t => {
  const h=harness(t); h.seed(); const p=h.page('mine'); p.onHelp();
  assert.match(h.modals.at(-1).content,/忙时按…记下/);
  assert.match(h.modals.at(-1).content,/调整本身不会记下/);
  const ui=require('../miniprogram/services/ui'); const original=ui.quickMinimumEnabled;
  ui.quickMinimumEnabled=false;
  try {
    p.onHelp();
    assert.doesNotMatch(h.modals.at(-1).content,/忙时按…记下/);
    assert.match(h.modals.at(-1).content,/调整本身不会记下/);
  } finally { ui.quickMinimumEnabled=original; }
});
test('help and today copy never claim a timer or automatic counting', t => {
  const h=harness(t); h.seed(); const p=h.page('mine'); p.onHelp();
  assert.match(h.modals.at(-1).content,/不会自动计时/);
  const today=fs.readFileSync(path.resolve(__dirname,'../miniprogram/pages/today/index.wxml'),'utf8');
  assert.equal((today.match(/做完再记下，不会自动计时。/g)||[]).length,1, '解释只出现一次');
});
test('first created habit is the next visible task, without auto-completion', t => {
  const h=harness(t), edit=h.page('edit',{template:'read'}); edit.onSave();
  const firstId=h.store.read().habits[0].id, day=dates.today();
  const other={title:'较早的任务',target:1,minimum:null,unit:'次',time:'08:00',weekdays:[1,2,3,4,5,6,7]};
  h.store.dispatch({type:'create',id:'a_other',startDate:day,plan:other});
  const today=h.page('today');
  assert.equal(today.data.pending[0].id,firstId); assert.equal(today.data.done,0);
  assert.match(today.data.firstHabitGuide,/做完后，在这里记下/); assert.equal(h.app.firstHabitGuide,null);
  today.refresh(); assert.equal(today.data.pending[0].id,firstId);
  today.onComplete(e({id:firstId,date:day,done:false})); assert.equal(today.data.firstHabitGuide,'');
});
test('first habit scheduled tomorrow gives a true next date and no today task', t => {
  const h=harness(t), edit=h.page('edit',{template:'read'}); edit.onStart(e({offset:1})); edit.onSave();
  const today=h.page('today');
  assert.equal(today.data.total,0); assert.equal(today.data.pending.length,0);
  assert.match(today.data.firstHabitGuide,/明天会出现在这里/);
  today.onDismissGuide(); assert.equal(today.data.firstHabitGuide,'');
});
test('my page routes to cloud data hub; double-confirm deletion still works there', async t => {
  const h=harness(t); h.seed(); const mine=h.page('mine'); mine.onData(); assert.equal(h.nav.at(-1),'/pages/data/index');
  const p=h.page('data'); assert.equal(p.onExport,undefined); assert.equal(h.writes.length,0); assert.equal(h.sends.length,0);
  p.onDelete(); p.onDelete(); assert.equal(h.modals.length,1); h.modals.pop().success({confirm:true}); assert.equal(h.modals.length,1);
  h.modals.pop().success({confirm:false}); assert.equal(p.data.deleting,false); assert.equal(h.store.read().habits.length,1);
  p.onDelete(); h.modals.pop().success({confirm:true}); await h.modals.pop().success({confirm:true}); assert.equal(h.store.read().habits.length,0); assert.equal(p.data.deleting,false);
});
test('acknowledged deletion does not access device files and releases the control', async t => {
  const h=harness(t); h.seed(); const p=h.page('data');
  h.wx.getFileSystemManager=()=>{throw Error('file access denied');};
  p.onDelete(); h.modals.pop().success({confirm:true}); await h.modals.pop().success({confirm:true});
  assert.equal(p.data.deleting,false); assert.equal(p.data.error,''); assert.equal(h.store.read().habits.length,0);
});
test('delete response after unload cleans scoped files without updating an abandoned page', async t => {
  const h=harness(t); h.seed(); const p=h.page('data'); let resolve;
  const clear=h.store.clear; h.store.clear=()=>new Promise(r=>{resolve=()=>{clear();r();};});
  p.onDelete(); h.modals.pop().success({confirm:true}); const work=h.modals.pop().success({confirm:true});
  p.onUnload(); p.setData=()=>{throw Error('must not update old page');}; resolve(); await work; assert.equal(p._deleting,false);
});
test('management and data routes show unavailable state instead of a false empty account', t => {
  const h=harness(t); h.app.store={read(){const err=Error('offline');err.code='DATA_UNAVAILABLE';throw err;},info:()=>({}),hasLegacyData:()=>false};
  for(const name of ['manage','data']) { const p=h.page(name); assert.equal(p.data.dataReady,false); assert.equal(p.data.dataUnavailable,true);
    assert.equal(typeof p.onDataRetry,'function', name + ' 有共享恢复入口'); }
});
test('registered pages, touchable weekday selectors, truthful copy and data-menu placement are wired', () => {
  const read=f=>fs.readFileSync(path.resolve(__dirname,'../miniprogram',f),'utf8');
  const pages=JSON.parse(read('app.json')).pages;
  assert.ok(pages.includes('pages/data/index'));
  assert.ok(pages.includes('pages/appearance/index'), '外观主题页面已注册');
  assert.match(read('app.wxss'),/\.week-options\s*\{[^}]*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(read('pages/edit/index.wxml'),/class="week-options"/);
  const mine=read('pages/mine/index.wxml'); assert.doesNotMatch(mine,/bindtap="onDelete"|bindtap="onExport"/); assert.match(mine,/open-type="feedback"/);
  assert.match(read('pages/data/index.wxml'),/bindtap="onDelete"/); assert.doesNotMatch(read('pages/data/index.wxml'),/onExport|onBackupHub/);
  assert.match(read('templates/task.wxml'),/>撤销打卡</);
});

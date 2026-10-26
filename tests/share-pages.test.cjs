const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {featuresFixture}=require('./helpers/features-fixture.cjs');
const {createFeaturesClient}=require('../miniprogram/services/features-client');
const names=require('../miniprogram/config/cloud-resources');
const dates=require('../miniprogram/core/date');
const e=(dataset={},value)=>({currentTarget:{dataset},detail:{value}});
async function setup(t) {
  const f=featuresFixture();f.date=dates.today();const a=await f.seed(),nav=[],modals=[],pages=[],menus=[];
  const status={ready:true,accountId:a.accountId,epoch:a.epoch,pending:0,phase:'ready'},listeners=new Set();
  const session={status:()=>({...status}),subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
  const wx={navigateTo:o=>nav.push(o.url),switchTab:o=>nav.push(o.url),showToast(){},setNavigationBarTitle(){},
    showModal:o=>modals.push(o),showShareMenu:o=>menus.push(o.menus),hideShareMenu:()=>menus.push([])};
  const client=createFeaturesClient(wx,{enabled:true,functionName:names.apiFunction,envId:'fixture'},
    {enabled:true,publicShares:true,timeline:true},session,{transportFactory:(_,options)=>event=>options.functionName===names.publicShareFunction?f.publicShare(event):f.features(event,f.identity)});
  const store={contextKey:()=>status.accountId+':'+status.epoch,read:()=>structuredClone(f.db.get(status.accountId).state),info:()=>({ready:true,source:'cloud'}),
    async dispatch(command){const r=await f.api(f.request(await f.pull(),command));if(!r.ok)throw Error(r.message);return r.state;}};
  const app={cloudSession:session,store,featuresClient:client};global.wx=wx;global.getApp=()=>app;
  t.after(()=>pages.forEach(p=>p.onUnload&&p.onUnload()));
  async function page(name,options={}){
    let def;global.Page=value=>{def=value;};const file=path.resolve(__dirname,'../miniprogram/pages/'+name+'/index.js');delete require.cache[file];require(file);
    const p={...def,data:structuredClone(def.data),setData(value,callback){Object.assign(this.data,value);if(callback)callback();}};
    pages.push(p);if(p.onLoad)p.onLoad(options);await p.onShow();await new Promise(setImmediate);return p;
  }
  return {f,a,app,status,client,store,wx,nav,modals,menus,page,listeners};
}
test('real share-create page previews without writing, creates once and routes only after acknowledgement',async t=>{
  const h=await setup(t),p=await h.page('share-create');
  assert.equal(p.data.enabled,true);await p.onPreview();assert.equal(h.f.shares.size,0);assert.equal(p.data.preview.kind,'invite');
  const work=p.onCreate();p.onCreate();await work;assert.equal(h.f.shares.size,1);
  assert.match(h.nav.at(-1),/^\/pages\/share-view\/index\?id=[a-f0-9]{64}&mine=1$/);
  assert.equal(p.data.opening,true);p.onKind(e({kind:'plan'}));assert.equal(p.data.kind,'invite');
  p.onHide();await p.onShow();
  p.onKind(e({kind:'plan'}));assert.equal(p.data.preview,null);assert.equal(p._preview,null);
  await p.onPreview();assert.equal(p.data.preview.title,'读一会儿');assert.doesNotMatch(JSON.stringify(p.data.preview),/private note/);
});
test('share page hooks expose public id only and recipient adoption requires an explicit edit/save',async t=>{
  const h=await setup(t),preview=await h.client.preview({kind:'plan',sourceHabitId:'read',categoryKey:'study',includeWeekdays:true});
  const share=await h.client.create(preview),p=await h.page('share-view',{id:share.shareId});
  assert.equal(p.data.view.title,'复习一小段');assert.equal(p.data.shareEnabled,true);
  assert.equal(p.onShareAppMessage().path,'/pages/share-view/index?id='+share.shareId);
  assert.equal(p.onShareTimeline().query,'id='+share.shareId);assert.doesNotMatch(JSON.stringify(p.onShareAppMessage()),/mine|epoch|owner/);
  await p.onCopy();const token=h.nav.at(-1).split('sharedDraft=')[1];assert.ok(token);assert.equal(h.store.read().habits.length,1);
  const edit=await h.page('edit',{sharedDraft:token});assert.equal(edit.data.title,'复习一小段');assert.equal(edit.data.target,'5');
  assert.equal(h.store.read().habits.length,1);await edit.onSave();assert.equal(h.store.read().habits.length,2);
  const original=h.store.read().habits.find(item=>item.id==='read');assert.equal(original.versions[0].title,'读一会儿');
});
test('my list and owner view support revoke, private readback and delete while old public link is unavailable',async t=>{
  const h=await setup(t),share=await h.client.create(await h.client.preview({kind:'invite'}));
  const list=await h.page('share-list');assert.equal(list.data.items.length,1);
  const view=await h.page('share-view',{id:share.shareId,mine:'1'});
  view.onManage(e({action:'revoke'}));await h.modals.pop().success({confirm:true});
  assert.equal(view.data.active,false);assert.equal(view.data.shareEnabled,false);assert.match(view.data.statusLabel,/仅本人/);
  await assert.rejects(h.client.publicShare(share.shareId),/失效/);
  view.onManage(e({action:'remove'}));await h.modals.pop().success({confirm:true});assert.equal(view.data.view,null);
  await list.load(false);assert.equal(list.data.items.length,0);
});
test('late private preview and account change cannot leave old content or navigation on a new page',async t=>{
  const h=await setup(t),p=await h.page('share-create');let resolve;
  h.app.featuresClient={...h.client,preview:()=>new Promise(r=>{resolve=r;})};
  const request=p.onPreview();p.onHide();resolve({publicSnapshot:{kind:'invite',coverKey:'default'}});await request;
  assert.equal(p.data.preview,null);assert.equal(h.nav.length,0);
  h.app.featuresClient=h.client;const share=await h.client.create(await h.client.preview({kind:'invite'}));
  const view=await h.page('share-view',{id:share.shareId,mine:'1'});assert.ok(view.data.view);
  h.status.epoch='changed';h.listeners.forEach(fn=>fn());assert.equal(view.data.view,null);assert.equal(view.data.shareEnabled,false);
});

test('late owner action failure cannot overwrite a share after leaving and reopening',async t=>{
  const h=await setup(t),share=await h.client.create(await h.client.preview({kind:'invite'}));
  const p=await h.page('share-view',{id:share.shareId,mine:'1'});let reject;
  h.app.featuresClient={...h.client,revoke:()=>new Promise((_,fail)=>{reject=fail;})};
  p.onManage(e({action:'revoke'}));const work=h.modals.pop().success({confirm:true});
  p.onHide();await p.onShow();reject(Error('旧撤回失败'));await work;
  assert.equal(p.data.error,'');assert.equal(p.data.active,true);assert.equal(p.data.busy,false);
});
test('pinning changes only ordering, ignores rest days and falls back when preference read fails',async t=>{
  const h=await setup(t);
  await h.f.mutate({type:'create',id:'walk',startDate:h.f.date,plan:{title:'走路',target:10,minimum:3,unit:'分钟',time:'08:00',weekdays:[1,2,3,4,5,6,7]}});
  const detail=await h.page('detail',{id:'read'});await detail.onPin();assert.equal(detail.data.pinned,true);
  const today=await h.page('today');assert.equal(today.data.pending[0].id,'read');assert.equal(today.data.pending[0].pinned,true);
  assert.equal(Object.keys(h.store.read().records).length,0);
  await detail.onPin();today.onHide();await today.onShow();await new Promise(setImmediate);assert.equal(today.data.pending[0].id,'walk');
  h.app.featuresClient={...h.client,cachedPreferences:()=>null,preferences:async()=>{throw Error('offline');}};
  today.onHide();await today.onShow();assert.equal(today.data.pending[0].id,'walk');
  const state=h.store.read();state.habits.find(item=>item.id==='read').versions[0].weekdays=[1,2,3,4,5,6,7].filter(day=>day!==dates.weekday(h.f.date));
  h.store.read=()=>structuredClone(state);
  h.app.featuresClient={...h.client,cachedPreferences:()=>({pinnedHabitId:'read'}),preferences:async()=>({pinnedHabitId:'read'})};
  today.onHide();await today.onShow();await new Promise(setImmediate);
  assert.deepEqual(today.data.pending.map(task=>task.id),['walk']);
});
test('static app invitation does not create a public snapshot and all new page event bindings exist',async t=>{
  const h=await setup(t),mine=await h.page('mine');assert.equal(mine.onShareAppMessage().path,'/pages/discover/index');assert.equal(h.f.shares.size,0);
  for(const name of ['share-create','share-list','share-view']) {
    const p=await h.page(name);const markup=fs.readFileSync(path.resolve(__dirname,'../miniprogram/pages/'+name+'/index.wxml'),'utf8');
    for(const match of markup.matchAll(/bind(?:tap|change)="(\w+)"/g))assert.equal(typeof p[match[1]],'function',name+':'+match[1]);
  }
});

test('recipient waits for account, suppresses duplicate adoption and never creates before confirmation',async t=>{
  const h=await setup(t),share=await h.client.create(await h.client.preview({kind:'plan',sourceHabitId:'read',categoryKey:'read',includeWeekdays:false}));
  const p=await h.page('share-view',{id:share.shareId});let resolve;
  h.app.dataReady=new Promise(r=>{resolve=r;});
  const request=p.onCopy();await p.onCopy();assert.equal(p.data.adopting,true);assert.equal(h.nav.length,0);
  resolve();await request;assert.equal(p.data.adopting,true);assert.equal(h.nav.length,1);assert.equal(h.store.read().habits.length,1);
  await p.onCopy();assert.equal(h.nav.length,1,'navigation wait keeps adoption locked');
});

test('recipient recovery retains public value and a stale ready result cannot navigate after reentry',async t=>{
  const h=await setup(t),share=await h.client.create(await h.client.preview({kind:'plan',sourceHabitId:'read',categoryKey:'read',includeWeekdays:false}));
  const p=await h.page('share-view',{id:share.shareId});let resolve;
  h.app.dataReady=new Promise(r=>{resolve=r;});const request=p.onCopy();p.onHide();await p.onShow();resolve();await request;
  assert.equal(h.nav.length,0);assert.equal(p.data.adopting,false);assert.ok(p.data.view);
  h.status.ready=false;h.app.cloudSession.start=async()=>{throw Error('离线，请重试');};
  await p.onCopy();assert.match(p.data.adoptError,/离线/);assert.ok(p.data.view);assert.equal(h.nav.length,0);
  h.status.ready=true;await p.onCopy();assert.match(h.nav[0],/sharedDraft/);assert.equal(p.data.adoptError,'');
});

test('detail plan entry selects its source and invitation/week progress offer a first-value entry',async t=>{
  const h=await setup(t);
  await h.f.mutate({type:'create',id:'walk',startDate:h.f.date,plan:{title:'走路',target:10,minimum:3,unit:'分钟',time:'',weekdays:[1,2,3,4,5,6,7]}});
  const p=await h.page('share-create',{kind:'plan',habitId:'walk'});assert.equal(p.data.plans[p.data.planIndex].id,'walk');
  const markup=fs.readFileSync(path.resolve(__dirname,'../miniprogram/pages/share-view/index.wxml'),'utf8');
  assert.match(markup,/!view.canCopy[\s\S]*?bindtap="onStart">选一个小目标试试/);
});

test('recipient adoption never replays a pending private mutation through account start',async t=>{
  const h=await setup(t),share=await h.client.create(await h.client.preview({kind:'plan',sourceHabitId:'read',categoryKey:'read',includeWeekdays:false}));
  const p=await h.page('share-view',{id:share.shareId});let starts=0;
  h.status.ready=false;h.status.pending=1;h.app.cloudSession.start=async()=>{starts++;};
  await p.onCopy();assert.equal(starts,0);assert.equal(p.data.adoptNeedsSync,true);assert.match(p.data.adoptError,/核对已有操作/);
  assert.equal(h.nav.length,0);assert.ok(p.data.view);
});

test('recipient navigation stays locked until failure, and an old failure cannot affect reentry',async t=>{
  const h=await setup(t),share=await h.client.create(await h.client.preview({kind:'plan',sourceHabitId:'read',categoryKey:'read',includeWeekdays:false}));
  const p=await h.page('share-view',{id:share.shareId}),navigations=[];
  h.wx.navigateTo=options=>navigations.push(options);
  await p.onCopy();await p.onCopy();assert.equal(navigations.length,1);assert.equal(p.data.adopting,true);
  navigations[0].fail();assert.equal(p.data.adopting,false);assert.match(p.data.adoptError,/确认页未打开/);
  await p.onCopy();assert.equal(navigations.length,2);assert.equal(p.data.adopting,true);
  p.onHide();await p.onShow();await p.onCopy();assert.equal(navigations.length,3);
  navigations[1].fail();assert.equal(p.data.adopting,true);assert.equal(p.data.adoptError,'');
  assert.equal(h.store.read().habits.length,1);
});

test('created share navigation suppresses repeated creation and keeps the same receipt for retry',async t=>{
  const h=await setup(t),p=await h.page('share-create'),navigations=[];
  h.wx.navigateTo=options=>navigations.push(options);
  await p.onPreview();await p.onCreate();await p.onCreate();
  assert.equal(h.f.shares.size,1);assert.equal(navigations.length,1);assert.equal(p.data.opening,true);
  navigations[0].fail();assert.equal(p.data.opening,false);assert.match(p.data.error,/已创建/);
  await p.onCreate();assert.equal(h.f.shares.size,1);assert.equal(navigations.length,2);
  p.onHide();await p.onShow();navigations[1].fail();assert.equal(p.data.opening,false);assert.equal(p.data.error,'');
});

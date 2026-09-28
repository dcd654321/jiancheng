const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {reminderFixture}=require('./helpers/reminder-fixture.cjs');
const {createFeaturesClient}=require('../miniprogram/services/features-client');
const names=require('../miniprogram/config/cloud-resources');
async function setup(t){
  const f=reminderFixture(),a=await f.seed(),status={ready:true,accountId:a.accountId,epoch:a.epoch,pending:0};
  const listeners=new Set(),session={status:()=>({...status}),subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
  const requests=[],wx={requestSubscribeMessage:options=>requests.push(options),navigateTo(){},showToast(){}},app={cloudSession:session};
  const h={f,a,status,requests,wx,app,listeners,lose:false};
  const client=createFeaturesClient(wx,{enabled:true,functionName:names.apiFunction,envId:'fixture'},{enabled:true},session,
    {remindersConfig:{enabled:true},transportFactory:()=>async event=>{const r=await f.reminderApi(event);if(event.action==='scheduleReminder'&&h.lose){h.lose=false;throw Error('lost');}return r;}});
  app.featuresClient=client;app.store={read:()=>f.db.get(a.accountId).state,contextKey:()=>status.accountId+':'+status.epoch,info:()=>({ready:true})};
  global.wx=wx;global.getApp=()=>app;let definition;global.Page=p=>{definition=p;};
  const file=path.resolve(__dirname,'../miniprogram/pages/reminder/index.js');delete require.cache[file];require(file);
  const p={...definition,data:structuredClone(definition.data),setData(v){Object.assign(this.data,v);}};
  t.after(()=>p.onUnload());p.onShow();await new Promise(setImmediate);h.p=p;h.client=client;return h;
}
test('reminder page requires separate preview and direct user authorization; rejection never schedules, success is once then cancel',async t=>{
  const h=await setup(t),p=h.p;assert.equal(p.data.enabled,true);assert.equal(h.requests.length,0);assert.equal(h.f.reminders.size,0);
  await p.onPreview();assert.ok(p.data.preview);assert.equal(h.requests.length,0);
  p.onSubscribe();assert.equal(h.requests.length,1,'subscription API starts synchronously on tap');p.onSubscribe();assert.equal(h.requests.length,1);
  await h.requests[0].success({'real-template-fixture':'reject'});assert.equal(h.f.reminders.size,0);assert.match(p.data.error,/未申请/);
  p.onSubscribe();await h.requests[1].success({'real-template-fixture':'accept'});assert.equal(h.f.reminders.size,1);assert.equal(p.data.items[0].status,'pending');
  await p.onCancel({currentTarget:{dataset:{date:p.data.items[0].businessDate}}});assert.equal(p.data.items[0].status,'cancelled');
});
test('lost reminder registration acknowledgement retries the same request without a second authorization or duplicate job',async t=>{
  const h=await setup(t),p=h.p;await p.onPreview();const id=p._preview.operationId;h.lose=true;
  p.onSubscribe();await h.requests[0].success({'real-template-fixture':'accept'});assert.equal(p.data.retrySchedule,true);assert.equal(h.f.reminders.size,1);
  await p.onPreview();assert.equal(p._preview.operationId,id);
  await p.onRetrySchedule();assert.equal(h.requests.length,1);assert.equal(h.f.reminders.size,1);assert.equal(p.data.retrySchedule,false);assert.equal(p.data.items[0].status,'pending');
});
test('account switch and hidden-page authorization cannot register old account reminders; pending views clear on change',async t=>{
  const h=await setup(t),p=h.p;await p.onPreview();p.onSubscribe();h.status.epoch='new';h.listeners.forEach(fn=>fn());
  await h.requests[0].success({'real-template-fixture':'accept'});assert.equal(h.f.reminders.size,0);assert.equal(p.data.preview,null);
  h.status.epoch=h.a.epoch;p.refresh();await p.onPreview();p.onSubscribe();p.onHide();await h.requests[1].success({'real-template-fixture':'accept'});assert.equal(h.f.reminders.size,0);
});
test('reminder interface fallback and markup hooks are complete without silently claiming a subscription',async t=>{
  const h=await setup(t),p=h.p;await p.onPreview();delete h.wx.requestSubscribeMessage;p.onSubscribe();assert.match(p.data.error,/不支持/);assert.equal(h.f.reminders.size,0);
  const wxml=fs.readFileSync(path.resolve(__dirname,'../miniprogram/pages/reminder/index.wxml'),'utf8');
  for(const match of wxml.matchAll(/bind(?:tap|change)="([^"]+)"/g))assert.equal(typeof p[match[1]],'function',match[1]);
  assert.doesNotMatch(wxml,/每日提醒已开启|已送达成功/);
});

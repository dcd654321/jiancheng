// 审查采集：W=开发版真实只读；F=内存夹具。禁止真实云写入、AI请求、订阅和发送分享。
const fs=require('node:fs'),path=require('node:path');
const automator=require(path.join(process.env.TEMP,'mp-automator/node_modules/miniprogram-automator'));
const root=path.resolve(__dirname,'../../..');
const domain=require(path.join(root,'miniprogram/core/habits'));
const dates=require(path.join(root,'miniprogram/core/date'));
const {THEMES}=require(path.join(root,'miniprogram/config/theme-tokens'));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const day=dates.today();
function single(back=0){return domain.reduce(domain.emptyState(),{type:'create',id:'audit-read',startDate:dates.shift(day,-back),plan:{title:'读一会儿',target:5,minimum:2,unit:'分钟',weekdays:[1,2,3,4,5,6,7],time:''}},dates.shift(day,-back));}
const inject=payload=>{
 const app=getApp(),clone=x=>JSON.parse(JSON.stringify(x));
 if(!globalThis.__contestOriginal)globalThis.__contestOriginal={store:app.store,cloudSession:app.cloudSession,featuresClient:app.featuresClient,appearanceController:app.appearanceController,planAssistant:app.planAssistant,dataReady:app.dataReady,firstHabitGuide:app.firstHabitGuide,formDrafts:app.formDrafts,noteDrafts:app.noteDrafts};
 const original=globalThis.__contestOriginal;
 app.formDrafts=require('services/form-drafts.js').createFormDrafts(); app.noteDrafts=require('services/note-drafts.js').createNoteDrafts();
 let state=clone(payload.state),mode='ready',dispatchMode='success',aiMode='success',shareKind='plan',dispatchCount=0,genCount=0,busy=false;
 const listeners=new Set(); const ss=()=>({ready:mode==='ready',accountId:'audit-fixture',epoch:'audit',pending:0,count:state.habits.length,phase:mode==='ready'?'ready':mode==='loading'?'loading':'offline'});
 app.cloudSession={status:ss,subscribe:f=>{listeners.add(f);return()=>listeners.delete(f)},start:async()=>{mode='ready';listeners.forEach(f=>f());}};
 app.dataReady=Promise.resolve();
 app.store={contextKey:()=> 'audit-fixture:audit',read:()=>{if(mode!=='ready'){const e=Error(mode==='loading'?'读取中':'网络不可用，请联网后重试');e.code=mode==='loading'?'DATA_LOADING':'DATA_UNAVAILABLE';throw e;}return clone(state)},stale:()=>null,info:()=>({...ss(),source:'cloud',syncAttention:mode!=='ready',syncText:mode==='ready'?'云端记录已确认':'连接网络后重试'}),dispatch:async command=>{
  dispatchCount++; await new Promise(r=>setTimeout(r,payload.latency || 650));if(dispatchMode==='failure')throw Error('暂时没有确认这次操作，请重新核对');
  state=require('core/habits.js').reduce(state,command,require('core/date.js').today());return clone(state);
 }};
 app.appearanceController={view:()=>({theme:payload.theme,enabled:true,revision:0,loadState:'ready',pendingTheme:'',themeName:payload.theme==='paper'?'暖纸白':'薄雾绿'}),current:()=>payload.theme,subscribe:()=>()=>{},ensureRead:async()=>{}};
 app.planAssistant={rules:original.planAssistant.rules,handoff:original.planAssistant.handoff,consume:original.planAssistant.consume,status:()=>({configured:true,busy,canGenerate:mode==='ready'&&!busy,blockedReason:mode==='ready'?'':'连接网络后可申请AI建议'}),generate:async(input,consent)=>{if(!consent)throw Error('请先同意');genCount++;busy=true;await new Promise(r=>setTimeout(r,700));busy=false;if(aiMode==='failure'){const e=Error('本期AI额度已用完，可以先用基础方案');e.code='RATE_LIMITED';throw e;}return {...original.planAssistant.rules(input),source:'ai'};}};
 const snapshot=()=>shareKind==='plan'?{kind:'plan',categoryKey:'read',target:5,minimum:2,unit:'分钟'}:shareKind==='invite'?{kind:'invite',coverKey:'default'}:{kind:'weekly',captionKey:'busy-still-counts',startDate:'2026-10-01',endDate:'2026-10-07',planned:7,standard:3,minimum:2};
 const share=()=>({shareId:'a'.repeat(64),status:'active',publicSnapshot:snapshot(),createdAt:'2026-10-07T00:00:00Z',expiresAt:'2027-01-05T00:00:00Z'});
 let shareEnabled=false;
 app.featuresClient={status:()=>({enabled:shareEnabled,publicShares:shareEnabled,timeline:false,reminders:false}),contextKey:()=> 'audit-fixture:audit',cachedPreferences:()=>null,preferences:async()=>null,
  preview:async()=>({publicSnapshot:snapshot(),request:{action:'createShare'},context:'audit-fixture:audit'}),create:async()=>share(),publicShare:async()=>{if(!shareEnabled)throw Error('公开分享暂未开放');return share()},ownShare:async()=>share(),list:async()=>({items:[share()],nextCursor:null}),handoff:s=>{if(mode!=='ready')throw Error('云端记录尚未读取，请稍后重试');globalThis.__contestSharedDraft={title:'读一会儿',target:s.target,minimum:s.minimum,unit:s.unit,weekdays:s.weekdays||[1,2,3,4,5,6,7],time:''};return'audit-draft';},consume:()=>globalThis.__contestSharedDraft};
 globalThis.__contestControl={state:x=>{state=clone(x)},mode:x=>{mode=x},dispatchMode:x=>{dispatchMode=x},aiMode:x=>{aiMode=x},share:x=>{shareEnabled=true;shareKind=x},stats:()=>({dispatchCount,genCount,mode,shareEnabled})};
 wx.setNavigationBarColor({frontColor:'#000000',backgroundColor:payload.tokens.page});wx.setBackgroundColor({backgroundColor:payload.tokens.page});wx.setTabBarStyle({color:payload.tokens.secondary,selectedColor:payload.tokens.primary,backgroundColor:payload.tokens.surface});
};
const restore=()=>{const app=getApp(),o=globalThis.__contestOriginal;if(o){for(const k of Object.keys(o))app[k]=o[k];delete globalThis.__contestOriginal;delete globalThis.__contestControl;delete globalThis.__contestSharedDraft;}};
if(require.main===module)(async()=>{
 const mp=await automator.connect({wsEndpoint:'ws://127.0.0.1:9433'}),log=[];let seq=1;
 const shot=async(label,level,steps,health='已渲染')=>{const name=String(seq++).padStart(2,'0')+'-'+label+'-'+level+'.png';await mp.screenshot({path:path.join(__dirname,name)});const p=await mp.currentPage();log.push({file:name,page:p.path,level,steps,health});console.log(name);};
 const go=async(route)=>{const [name,query]=route.split('?');const p=await mp.reLaunch('/pages/'+name+'/index'+(query?'?'+query:''));await wait(1100);return p};
 const tap=async(p,selector,delay=450)=>{const e=await p.$(selector);if(!e)throw Error('missing '+selector);await e.tap();await wait(delay);return mp.currentPage()};
 const control=async(action,value)=>mp.evaluate(p=>globalThis.__contestControl[p.action](p.value),{action,value});
 try{
  const info=await mp.systemInfo();log.push({environment:{SDKVersion:info.SDKVersion,windowWidth:info.windowWidth,windowHeight:info.windowHeight,screenWidth:info.screenWidth,screenHeight:info.screenHeight,platform:info.platform,date:day}});
  let p=await go('today');await shot('today','W','重入今日；真实开发版账户，只读');
  p=await tap(p,'.add-button');await shot('chooser','W','今日→添加习惯');
  p=await tap(p,'.tpl-card[data-template="read"]',800);await shot('template-confirm','W','模板阅读→确认表单；未创建');
  await mp.navigateBack();await wait(500);await shot('template-cancel','W','原生返回；未提交');
  p=await go('progress');await shot('progress','W','切换进度近7天');
  p=await tap(p,'.segment[data-days="28"]');await shot('progress28','W','近28天；未修改记录');
  p=await go('mine');await shot('mine','W','我的；核对当前已开放入口');
  p=await mp.navigateTo('/pages/assistant/index');await wait(700);await shot('assistant','W','我的→AI助手；未申请AI');
  p=await tap(p,'.rules-button',700);await shot('rules-preview','W','点击查看基础方案；本机规则');
  p=await tap(p,'#plan-preview button.primary',800);await shot('rules-confirm','W','基础方案→确认表单；未保存');
  for(const r of ['manage','sync','data','appearance','share-create','share-list','share-view','reminder']){p=await go(r);await shot(r,'W','直接进入路由，仅观察；未清除、保存或订阅');}
  const created=single();await mp.evaluate(inject,{state:domain.emptyState(),created,theme:'mist',tokens:THEMES.mist});
  p=await go('today');await shot('first-empty','F','注入空账户→今日首次入口');
  p=await tap(p,'.tpl-card[data-template="read"]',600);await shot('first-template','F','点击阅读模板→预填双档确认');
  const target=await p.$('#target');await target.trigger('input',{value:'0'});await wait(250);await shot('invalid-target','F','目标输入事件设为0；自动化不证明键盘行为');
  await target.trigger('input',{value:'5'});const min=await p.$('#minimum');await min.trigger('input',{value:'2'});await wait(250);
  await tap(p,'.submit-bar button.primary',80);await shot('creating','F','创建；内存延迟650ms呈现等待');await wait(800);p=await mp.currentPage();await shot('first-created','F','夹具创建成功返回今日；未写云');
  p=await tap(p,'.soft-button',80);await shot('recording','F','忙时完成按钮→内存写入等待');await wait(850);await shot('completed','F','夹具忙时完成；成功toast+撤销反馈');
  await wait(5200);await shot('completion-settled','F','完成反馈5秒后；观察剩余安排');
  p=await tap(p,'.disclosure',350);await shot('completed-expanded','F','展开今日已完成；永久撤销入口');
  p=await tap(p,'.undo',900);await shot('undo','F','点击撤销→恢复待做');
  await control('state',single(4));p=await go('today');await shot('return','F','注入漏做多日→轻松回来提示');
  let progress=single(6);for(let i=1;i<=5;i++)progress=domain.reduce(progress,{type:i%2?'completeMinimum':'complete',id:'audit-read',date:dates.shift(day,-i)},dates.shift(day,-i));
  await control('state',progress);p=await go('progress');await shot('progress-facts','F','真实模板呈现夹具7天记录');
  const cells=await p.$$('.cell');log.push({measurement:{selector:'.cell',size:await cells[0].size(),level:'F',viewport:390}});p=await tap(p,'.cell',350);await shot('progress-date','F','点击日期→对应日记录');
  p=await mp.navigateTo('/pages/detail/index?id=audit-read');await wait(700);await shot('detail','F','点击习惯详情；双档与明日计划');
  p=await tap(p,'.disclosure',350);await shot('note-input','F','展开今天备注；未输入/保存');
  p=await mp.navigateTo('/pages/edit/index?id=audit-read');await wait(700);await shot('edit-tomorrow','F','修改明日计划；未保存');await mp.navigateBack();await wait(350);
  p=await go('assistant');await shot('assistant-first','F','默认方向与5分钟；AI默认未同意');
  await (await p.$('checkbox-group')).trigger('change',{value:['agree']});await tap(p,'.generate-button',80);await shot('ai-loading','F','模拟AI延迟；未联系供应商');await wait(850);await shot('ai-preview','F','模拟AI成功→方案预览');
  await control('aiMode','failure');p=await go('assistant');await(await p.$('checkbox-group')).trigger('change',{value:['agree']});await tap(p,'.generate-button',900);await shot('ai-failure','F','模拟额度失败；基础方案可用');
  await tap(p,'.rules-button',600);await shot('ai-recovery','F','失败→基础方案预览；未保存');
  await control('mode','loading');p=await go('today');await shot('loading','F','模拟首次读取中');
  await control('mode','offline');p=await go('today');await shot('read-failure','F','模拟无可读记录网络失败');
  await tap(p,'.primary',600);await shot('read-recovery','F','重新读取→恢复同一夹具');
  await control('dispatchMode','failure');p=await go('today');await tap(p,'.check-pill',900);await shot('write-failure','F','模拟写入未确认；无成功状态');await control('dispatchMode','success');
  await control('share','plan');p=await go('share-create?kind=plan');await shot('share-create','F','临时内存开启公开功能；源码开关未改');
  await tap(p,'button[bindtap="onPreview"]',500);await shot('share-preview','F','预览脱敏轻计划；仅内存');
  p=await tap(p,'button[bindtap="onCreate"]',700);await shot('share-owner','F','模拟创建→本人分享页；无真实公开记录');
  log.push({shareCallback:await p.callMethod('onShareAppMessage'),level:'F',deliveryVerified:false});
  p=await go('share-view?id='+ 'a'.repeat(64));await shot('share-receiver-plan','F','接收者链接首开；夹具计划');
  p=await tap(p,'button[bindtap="onCopy"]',700);await shot('share-adopt-confirm','F','按计划试试→可编辑确认；未保存');
  await control('share','invite');p=await go('share-view?id='+ 'a'.repeat(64));await shot('share-receiver-invite','F','接收者邀请快照；检查开始入口');
  await control('share','weekly');p=await go('share-view?id='+ 'a'.repeat(64));await shot('share-receiver-weekly','F','接收者周进展；检查开始入口');
  await control('share','plan');await control('mode','loading');p=await go('share-view?id='+ 'a'.repeat(64));await tap(p,'button[bindtap="onCopy"]',400);await shot('share-account-loading','F','公开已读、账户未就绪→点击采用报错');
  await control('mode','ready');p=await go('detail?id=missing');await shot('invalid-detail','F','无效习惯ID→恢复入口');
  log.push({fixtureStats:await mp.evaluate(()=>globalThis.__contestControl.stats()),level:'F',realCloudWrites:0,realAIRequests:0,realSharesSent:0});
 }finally{
  fs.writeFileSync(path.join(__dirname,'steps.json'),JSON.stringify(log,null,2));
  await mp.evaluate(restore);await mp.reLaunch('/pages/today/index');await wait(1000);console.log(JSON.stringify(await mp.evaluate(()=>({fixtureRestored:!globalThis.__contestOriginal,source:getApp().store.info().source}))));await mp.disconnect();
 }
})().catch(e=>{console.error(e.stack);process.exit(1)});
module.exports={inject,restore,single};

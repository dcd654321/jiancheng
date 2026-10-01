const root=require('node:path').resolve(__dirname,'../../..');
const {createAppearanceClient}=require(root+'/miniprogram/services/appearance-client');
const {createAppearanceController}=require(root+'/miniprogram/services/appearance');
const ui=require(root+'/miniprogram/services/ui');
const fs=require('node:fs');const out=root+'/docs/audits/2026-10-01-ui-interaction-review';
const results=[];const tick=()=>new Promise(r=>setImmediate(r));
function harness(initial='mist'){
 const s={ready:true,accountId:'AUDIT_A',epoch:'E1',phase:'ready',pending:0,conflict:null,deletionPending:false,networkOffline:false};
 const calls=[];let failSave=false;
 const client=createAppearanceClient({}, {enabled:true,functionName:'jiancheng_daka_api'}, {enabled:true},{status:()=>({...s})},{transportFactory:()=>async e=>{calls.push({...e});if(e.action==='setAppearance'&&failSave)throw Error('synthetic lost receipt');return {ok:true,appearance:{revision:0,theme:s.accountId==='AUDIT_A'?initial:'mist'}};},clock:()=>1000});
 const c=createAppearanceController({client,wxApi:{},session:{status:()=>s}});
 return {s,c,client,calls,fail:()=>{failSave=true;}};
}
(async()=>{
 // 纯本地执行实际客户端/控制器；无网络/无数据库。
 const h=harness();await h.c.ensureRead();h.fail();try{await h.c.save('paper');}catch(_){}
 const before=h.c.view();h.s.accountId='AUDIT_B';h.s.epoch='E2';await h.c.ensureRead();const after=h.c.view();
 let result;try{await h.c.save('paper');result='saved';}catch(e){result={code:e.code,message:e.message};}
 results.push({id:'THEME_CONTEXT_PENDING',before:{theme:before.theme,pending:before.pendingTheme},after:{theme:after.theme,pending:after.pendingTheme},newAccountFirstSave:result,calls:h.calls.map(x=>({action:x.action,epoch:x.epoch}))});
 const h2=harness('paper');await h2.c.ensureRead();h2.s.accountId='AUDIT_B';h2.s.epoch='E2';
 results.push({id:'THEME_CONTEXT_IMMEDIATE',viewWithoutEnsureRead:h2.c.view(),note:'核心会话变化本身是否立即重置主题；此处不调用再次读取'});
 // 页面持有预览时刷新控制器：两条实际订阅的覆盖顺序。
 const h3=harness();await h3.c.ensureRead();let definition;global.Page=d=>{definition=d;};
 global.wx={showToast(){},setNavigationBarTitle(){}};const listeners=new Set();
 const app={appearanceController:h3.c,cloudSession:{status:()=>({...h3.s}),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}},store:{contextKey:()=>h3.s.accountId+':'+h3.s.epoch},dataReady:Promise.resolve()};global.getApp=()=>app;
 const src=root+'/miniprogram/pages/appearance/index.js';delete require.cache[require.resolve(src)];require(src);
 const page={...definition,data:structuredClone(definition.data),setData(p){Object.assign(this.data,p);}};page.onLoad();page.onShow();await tick();
 page.onPick({currentTarget:{dataset:{theme:'paper'}}});const picked={theme:page.data.theme,preview:page.data.preview};await h3.c.ensureRead(true);const refreshed={theme:page.data.theme,preview:page.data.preview,savedTheme:page.data.savedTheme};
 results.push({id:'THEME_PREVIEW_REFRESH',picked,refreshed});page.onUnload();
 // 冻结重放时连网状态：离线按钮是否仍允许核对。
 const pendingView={...h3.c.view(),pendingTheme:'paper'};
 const fake={view:()=>pendingView,ensureRead:async()=>pendingView,subscribe:()=>()=>{}};app.appearanceController=fake;h3.s.networkOffline=true;h3.s.phase='offline';
 delete require.cache[require.resolve(src)];require(src);const p2={...definition,data:structuredClone(definition.data),setData(p){Object.assign(this.data,p);}};p2.onLoad();p2.onShow();await tick();
 results.push({id:'OFFLINE_RECHECK_BUTTON',offline:p2.data.offline,label:p2.data.primaryLabel,disabled:p2.data.primaryDisabled,statusNote:p2.data.statusNote});p2.onUnload();
 console.log(JSON.stringify(results,null,2));fs.writeFileSync(out+'/code-behavior-probes.json',JSON.stringify({classification:'L:本地实际模块与页面生命周期；没有网络或真实账户',results},null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1});

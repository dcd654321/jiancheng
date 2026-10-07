// 当前微信工具界面验证。W真实读取/无生成，F替换内存服务；不保存、不调用供应商、不写云端。
const fs=require('node:fs'),path=require('node:path');
const automator=require(path.join(process.env.TEMP,'mp-automator/node_modules/miniprogram-automator'));
const domain=require('../../miniprogram/core/habits'),{THEMES}=require('../../miniprogram/config/theme-tokens');
const out=path.resolve(__dirname,'../../docs/audits/2026-10-02-ai-ui');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const inject=payload=>{
  const app=getApp();
  if(!globalThis.__aiAuditOriginal)globalThis.__aiAuditOriginal={store:app.store,session:app.cloudSession,assistant:app.planAssistant,appearance:app.appearanceController,dataReady:app.dataReady};
  const original=globalThis.__aiAuditOriginal.assistant;
  let busy=false,mode='success',calls=0,finish;
  const s={ready:true,accountId:'fixture-ui',epoch:'fixture-epoch',pending:0,phase:'ready'};
  app.cloudSession={status:()=>({...s}),subscribe:()=>()=>{},start:()=>Promise.resolve()};
  app.dataReady=Promise.resolve();
  app.store={contextKey:()=>s.accountId+':'+s.epoch,read:()=>JSON.parse(JSON.stringify(payload.state)),
    info:()=>({source:'cloud',...s,syncText:'云端数据已确认',syncAttention:false}),dispatch(){throw Error('审查期间禁止云写入');}};
  app.planAssistant={rules:original.rules,handoff:original.handoff,consume:original.consume,
    status:()=>({configured:true,busy,canGenerate:!busy&&s.ready,blockedReason:s.ready?'':'连接网络后可申请AI建议'}),
    generate(input,consent){if(!consent)throw Error('需同意');calls++;busy=true;const at=mode;
      return new Promise((resolve,reject)=>{const complete=()=>{busy=false;if(at==='failure'){
        const err=Error('本期AI额度已用完，可以先用基础方案');err.code='RATE_LIMITED';reject(err);
      }else{const result=original.rules(input);result.source='ai';resolve(result);}};if(at==='waiting')finish=complete;else setTimeout(complete,at==='failure'?350:500);});}};
  app.appearanceController={view:()=>({theme:payload.theme,enabled:true,revision:0,loadState:'ready',pendingTheme:'',themeName:payload.theme==='paper'?'暖纸白':'薄雾绿'}),
    subscribe:()=>()=>{},current:()=>payload.theme,ensureRead:()=>Promise.resolve()};
  globalThis.__aiAuditControl={setMode:value=>{mode=value;},setBusy:value=>{busy=value;},complete:()=>{if(finish){finish();finish=null;}},offline:()=>{s.ready=false;},stats:()=>({calls,busy})};
  wx.setNavigationBarColor({frontColor:'#000000',backgroundColor:payload.tokens.page});
  wx.setBackgroundColor({backgroundColor:payload.tokens.page});
};
const restore=()=>{const app=getApp(),o=globalThis.__aiAuditOriginal;if(o){app.store=o.store;app.cloudSession=o.session;app.planAssistant=o.assistant;app.appearanceController=o.appearance;app.dataReady=o.dataReady;delete globalThis.__aiAuditOriginal;delete globalThis.__aiAuditControl;}};
if(require.main===module)(async()=>{
 fs.mkdirSync(out,{recursive:true});const mp=await automator.connect({wsEndpoint:'ws://127.0.0.1:'+(process.env.MP_AUTO_PORT||9432)}),observations=[];
 const shot=async name=>{await mp.screenshot({path:path.join(out,name+'.png')});console.log(name);};
 const page=async route=>{const p=await mp.reLaunch('/pages/'+route+'/index');await wait(1300);for(let i=0;i<30;i++){const d=await p.data();if(!d.loading){await wait(350);return p;}await wait(400);}throw Error('loading timeout '+route);};
 const tap=async(p,selector)=>{const el=await p.$(selector);if(!el)throw Error('Missing '+selector);await el.tap();await wait(350);};
 const consent=async p=>{const group=await p.$('checkbox-group');if(!group)throw Error('missing consent group');await group.trigger('change',{value:['agree']});await wait(200);};
 const route=async expected=>{for(let i=0;i<24;i++){const p=await mp.currentPage();if(p.path===expected){await wait(600);return p;}await wait(300);}throw Error('Route timeout '+expected);};
 try{
   await mp.evaluate(restore);
   const info=await mp.systemInfo();observations.push({system:{windowWidth:info.windowWidth,windowHeight:info.windowHeight,SDKVersion:info.SDKVersion,platform:info.platform}});
   let p=await page('mine');await shot('04-after-mine-W');
   const rows=await p.$$('button.setting-row');let entry;
   for(const r of rows)if((await r.text()).includes('AI 小目标助手')){entry=r;break;}
   if(!entry)throw Error('AI entry not visible after compile');await entry.tap();p=await route('pages/assistant/index');await shot('05-assistant-initial-W');
   await tap(p,'.rules-button');await wait(400);await shot('06-basis-preview-W');
   const next=await p.$('#plan-preview button.primary');await next.tap();await wait(1000);p=await mp.currentPage();
   p=await route('pages/edit/index');await shot('07-basis-confirm-W');
   observations.push({level:'W',entryTap:true,basisTap:true,confirmTap:true,modelRequested:false,habitSaved:false});
   for(const theme of ['mist','paper']){
     await mp.evaluate(inject,{theme,tokens:THEMES[theme],state:domain.emptyState()});
     p=await page('today');await shot('10-'+theme+'-today-entry-F');await tap(p,'.assistant-entry');p=await route('pages/assistant/index');
     await shot('11-'+theme+'-assistant-F');
     await consent(p);await tap(p,'.generate-button');await wait(800);await shot('12-'+theme+'-ai-preview-F');
     const data=await p.data();observations.push({theme,level:'F',source:data.preview&&data.preview.source,minutes:data.minutes,consent:data.consent,canAdopt:data.canAdopt});
     for(const selector of ['.direction-option','.minute-option','.generate-button','.rules-button']){
       const el=await p.$(selector);observations.push({theme,selector,size:await el.size()});
     }
     await tap(p,'#plan-preview button.primary');p=await route('pages/edit/index');await shot('13-'+theme+'-ai-confirm-F');
     await mp.evaluate(()=>globalThis.__aiAuditControl.setMode('waiting'));p=await page('assistant');await consent(p);
     const gen=await p.$('.generate-button');await gen.tap();await wait(200);await shot('14-'+theme+'-waiting-F');
     await tap(p,'.rules-button');await shot('15-'+theme+'-basis-during-wait-F');await mp.evaluate(()=>globalThis.__aiAuditControl.complete());await wait(500);
     observations.push({theme,lateSource:(await p.data()).preview.source,stats:await mp.evaluate(()=>globalThis.__aiAuditControl.stats())});
     await mp.evaluate(()=>globalThis.__aiAuditControl.setMode('failure'));p=await page('assistant');await consent(p);await tap(p,'.generate-button');await wait(650);await shot('16-'+theme+'-quota-error-F');
     await tap(p,'.rules-button');await shot('17-'+theme+'-quota-basis-F');
     p=await page('assistant');await p.callMethod('onCustom');await wait(500);await p.callMethod('onMinutes',{detail:{value:'0'}});await tap(p,'.rules-button');await shot('18-'+theme+'-invalid-minutes-F');
     await mp.evaluate(()=>globalThis.__aiAuditControl.offline());p=await page('assistant');await tap(p,'.rules-button');await shot('19-'+theme+'-offline-basis-F');
   }
   fs.writeFileSync(path.join(out,'observations.json'),JSON.stringify(observations,null,2));
 }finally{await mp.evaluate(restore);await mp.reLaunch('/pages/today/index');await wait(1200);await mp.disconnect();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={inject,restore};

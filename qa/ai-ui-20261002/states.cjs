// 分主题短轮次 F 截图；等待由显式页面/内存状态构造，行为回归由 Node 合同验证。
const fs=require('node:fs'),path=require('node:path');
const automator=require(path.join(process.env.TEMP,'mp-automator/node_modules/miniprogram-automator'));
const {inject,restore}=require('./capture.cjs');
const domain=require('../../miniprogram/core/habits'),{THEMES}=require('../../miniprogram/config/theme-tokens');
const out=path.resolve(__dirname,'../../docs/audits/2026-10-02-ai-ui'),theme=process.argv[2]||'paper';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const mp=await automator.connect({wsEndpoint:'ws://127.0.0.1:'+(process.env.MP_AUTO_PORT||9433)});
 const records=[];
 const shot=async n=>{await mp.screenshot({path:path.join(out,n+'-'+theme+'-F.png')});console.log(n,theme);};
 const open=async()=>{const p=await mp.reLaunch('/pages/assistant/index');await wait(1800);return p;};
 try{
  await mp.evaluate(restore);await mp.evaluate(inject,{theme,tokens:THEMES[theme],state:domain.emptyState()});
  let p=await open();await shot('21-input');
  for(const selector of ['.direction-option','.minute-option','.generate-button','.rules-button']){const el=await p.$(selector);records.push({theme,selector,size:await el.size()});}
  await p.callMethod('onConsent',{detail:{value:['agree']}});await p.callMethod('onGenerate');await wait(800);await shot('22-ai-preview');
  records.push({theme,previewSource:(await p.data()).preview.source,level:'F'});
  const next=await p.$('#plan-preview button.primary');await next.tap();await wait(2200);const edit=await mp.currentPage();
  if(edit.path!=='pages/edit/index')throw Error('confirm navigation failed');await shot('23-confirm');
  p=await open();await mp.evaluate(()=>globalThis.__aiAuditControl.setBusy(true));await p.setData({busy:true,serviceBusy:true,consent:true,canGenerate:false});
  await mp.evaluate(()=>wx.pageScrollTo({selector:'#ai-generation',duration:0}));await wait(500);await shot('24-waiting-render');
  await p.callMethod('onRules');await wait(500);await shot('25-basis-during-wait');
  await mp.evaluate(()=>{globalThis.__aiAuditControl.setBusy(false);globalThis.__aiAuditControl.setMode('failure');return true;});
  p=await open();await p.callMethod('onConsent',{detail:{value:['agree']}});await p.callMethod('onGenerate');await wait(500);await shot('26-quota-error');
  await p.callMethod('onRules');await wait(500);await shot('27-quota-basis');
  await p.callMethod('onCustom');await p.callMethod('onMinutes',{detail:{value:'0'}});await p.callMethod('onRules');await wait(500);await shot('28-invalid-minutes');
  p=await open();await mp.evaluate(()=>globalThis.__aiAuditControl.offline());await p.callMethod('refresh');await p.callMethod('onRules');await wait(500);await shot('29-offline-basis');
  fs.writeFileSync(path.join(out,'observations-'+theme+'.json'),JSON.stringify(records,null,2));
 }finally{await mp.evaluate(restore);await mp.reLaunch('/pages/today/index');await wait(1500);await mp.disconnect();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});

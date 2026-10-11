const fs=require('node:fs'),path=require('node:path');
const automator=require(path.join(process.env.TEMP,'mp-automator/node_modules/miniprogram-automator'));
const {inject,restore,single}=require('./capture.cjs'),{THEMES}=require('../../../miniprogram/config/theme-tokens');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const mp=await automator.connect({wsEndpoint:'ws://127.0.0.1:9433'}),out=path.join(__dirname,'post-change'),log=[];let seq=20;
 const route=async(expected)=>{for(let i=0;i<30;i++){const p=await mp.currentPage();if(p.path===expected){await sleep(1000);return p;}await sleep(200);}throw Error('route '+expected);};
 const go=async(name,query='')=>{await mp.reLaunch('/pages/'+name+'/index'+(query?'?'+query:''));return route('pages/'+name+'/index');};
 const shot=async(label,steps)=>{await sleep(350);const p=await mp.currentPage(),file=String(seq++).padStart(2,'0')+'-'+label+'-F.png';await mp.screenshot({path:path.join(out,file)});log.push({file,page:p.path,level:'F',steps,health:'待目检'});console.log(file);};
 const ctl=async(action,value)=>mp.evaluate(p=>globalThis.__contestControl[p.action](p.value),{action,value});
 const invoke=async(name,args)=>mp.evaluate(x=>{const p=getCurrentPages()[getCurrentPages().length-1];p[x.name](...x.args);return true;},{name,args:args||[]});
 try{
  await mp.evaluate(inject,{state:single(6),theme:'mist',tokens:THEMES.mist});
  let p=await go('assistant');await invoke('onAIOptions');await invoke('onConsent',[{detail:{value:['agree']}}]);await invoke('onGenerate');await sleep(1400);await shot('ai-fixture-preview','调用AI事件，模拟成功；无供应商请求');
  await ctl('aiMode','failure');p=await go('assistant');await invoke('onAIOptions');await invoke('onConsent',[{detail:{value:['agree']}}]);await invoke('onGenerate');await sleep(1400);await shot('ai-failure','模拟额度失败；保留选择');await invoke('onRules');await sleep(600);await shot('ai-recovery','错误后本机基础方案仍可预览');
  await ctl('mode','loading');p=await go('today');await shot('loading','DATA_LOADING，价值与示例仍可读');await ctl('mode','offline');p=await go('today');await shot('read-failure','模拟无记录可读，禁止更新');await invoke('onDataRetry');await sleep(700);await shot('read-recovery','模拟读取重试恢复');
  await ctl('dispatchMode','failure');p=await go('today');const task=(await p.data('pending'))[0];await invoke('onComplete',[{currentTarget:{dataset:{id:task.id,date:task.date,done:false}}}]);await sleep(900);await shot('write-failure','写入未确认，无成功标记，可核对');await ctl('dispatchMode','success');
  await ctl('share','plan');p=await go('detail','id=audit-read');await invoke('onSharePlan');p=await route('pages/share-create/index');await shot('share-source','详情→预选来源；源码开关仍关闭');await invoke('onPreview');await sleep(600);await shot('share-preview','模拟脱敏预览，不公开真实数据');await invoke('onCreate');p=await route('pages/share-view/index');await shot('share-owner','分享者发送主按钮；不发送');log.push({callback:await p.callMethod('onShareAppMessage'),level:'F',delivered:false});
  p=await go('share-view','id='+'a'.repeat(64));await shot('share-receiver','接收者主按钮用计划开始');await invoke('onCopy');p=await route('pages/edit/index');await shot('share-confirm','准备账户后到确认页，尚未创建');
  await ctl('share','invite');p=await go('share-view','id='+'a'.repeat(64));await shot('invite','邀请接收者有选择小目标入口');await ctl('share','weekly');p=await go('share-view','id='+'a'.repeat(64));await shot('weekly','周记接收者有选择小目标入口');
  await ctl('share','plan');p=await go('share-view','id='+'a'.repeat(64));await mp.evaluate(()=>{const a=getApp();globalThis.__contestReadyResolve=null;a.dataReady=new Promise(r=>{globalThis.__contestReadyResolve=r;});});await invoke('onCopy');await shot('account-wait','公开内容保留，私有账户准备中且按钮防重复');await ctl('mode','offline');await mp.evaluate(()=>{getApp().cloudSession.start=async()=>{throw Error('模拟读取失败，请重试');};globalThis.__contestReadyResolve();});await sleep(500);await shot('account-failure','账户失败保留公开内容与采用重试');await ctl('mode','ready');await invoke('onCopy');p=await route('pages/edit/index');await shot('account-recovery','恢复后仍需显式创建，未自动写入');
  log.push({fixtureStats:await mp.evaluate(()=>globalThis.__contestControl.stats()),realCloudWrites:0,realAIRequests:0,realMessagesSent:0});
 }finally{fs.writeFileSync(path.join(out,'steps-remaining.json'),JSON.stringify(log,null,2));await mp.evaluate(()=>{delete globalThis.__contestReadyResolve;});await mp.evaluate(restore);await mp.reLaunch('/pages/today/index');await sleep(1500);console.log(JSON.stringify(await mp.evaluate(()=>({fixtureRestored:!globalThis.__contestOriginal,source:getApp().store.info().source}))));await mp.disconnect();}
 process.exit(0);
})().catch(e=>{console.error(e.stack);process.exit(1)});

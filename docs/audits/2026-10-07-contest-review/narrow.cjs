const fs=require('node:fs'),path=require('node:path');
const automator=require(path.join(process.env.TEMP,'mp-automator/node_modules/miniprogram-automator'));
const {inject,restore,single}=require('./capture.cjs'),domain=require('../../../miniprogram/core/habits'),dates=require('../../../miniprogram/core/date'),{THEMES}=require('../../../miniprogram/config/theme-tokens');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const mp=await automator.connect({wsEndpoint:'ws://127.0.0.1:9433'}),out=path.join(__dirname,'post-change'),log=[];let seq=37;
 const go=async(name,q='')=>{await mp.reLaunch('/pages/'+name+'/index'+(q?'?'+q:''));for(let i=0;i<30;i++){const p=await mp.currentPage();if(p.path==='pages/'+name+'/index'){await sleep(1400);return p;}await sleep(200);}throw Error('route');};
 const shot=async(label,steps)=>{const p=await mp.currentPage(),file=String(seq++).padStart(2,'0')+'-'+label+'-F.png';await mp.screenshot({path:path.join(out,file)});log.push({file,page:p.path,level:'F',steps,health:'待目检'});console.log(file);};
 try{
  const info=await mp.systemInfo();log.push({environment:{date:dates.today(),platform:info.platform,width:info.windowWidth,height:info.windowHeight,SDKVersion:info.SDKVersion}});if(info.windowWidth!==320)throw Error('需先在原生工具选择320宽度');
  let state=single(6);await mp.evaluate(inject,{state,theme:'mist',tokens:THEMES.mist});let p=await go('today');await shot('today-320','iPhone5逻辑320宽度；双档按钮纵排');
  log.push({actions:{normal:await(await p.$('.check-pill')).size(),busy:await(await p.$('.soft-button')).size()}});
  p=await go('edit','id=audit-read');await p.callMethod('onToggleFrequency');await shot('edit-320','320表单输入与周选择；未保存');
  for(let i=1;i<=5;i++)state=domain.reduce(state,{type:i%2?'completeMinimum':'complete',id:'audit-read',date:dates.shift(dates.today(),-i)},dates.shift(dates.today(),-i));await mp.evaluate(x=>globalThis.__contestControl.state(x),state);
  p=await go('progress');await mp.callWxMethod('pageScrollTo',{selector:'.calendar-scroll',duration:0});await sleep(800);await shot('calendar-320','320日期顺序，44px最小列宽，scroll-view横滑');log.push({calendar:{cell:await(await p.$('.cell')).size(),container:await(await p.$('.calendar-scroll')).size()}});
  await mp.evaluate(x=>globalThis.__contestControl.state(x),domain.emptyState());p=await go('today');await shot('first-320','320首屏整理入口；列表可纵向滚动');
  // 页面事件发出后立即返回，不等派生异步写入；只给内存fixture较长等待取状态。
  await mp.evaluate(inject,{state:domain.emptyState(),theme:'mist',tokens:THEMES.mist,latency:10000});p=await go('edit','template=tidy');await mp.evaluate(()=>{const pages=getCurrentPages();pages[pages.length-1].onSave();return true;});await sleep(500);await shot('creating-pending','10秒内存等待，创建按钮加载且防重复；不是云端延迟测量');await sleep(10500);
  log.push({realCloudWrites:0,realAIRequests:0,realMessagesSent:0});
 }finally{fs.writeFileSync(path.join(out,'steps-narrow.json'),JSON.stringify(log,null,2));await mp.evaluate(restore);await mp.reLaunch('/pages/today/index');await sleep(1400);await mp.disconnect();}
 process.exit(0);
})().catch(e=>{console.error(e.stack);process.exit(1)});

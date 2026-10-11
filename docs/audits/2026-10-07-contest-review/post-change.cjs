// 改版验证：W仅云端读取，F会话fixture；不真实写入、调用模型、公开分享或发送消息。
const fs=require('node:fs'),path=require('node:path');
const automator=require(path.join(process.env.TEMP,'mp-automator/node_modules/miniprogram-automator'));
const {inject,restore,single}=require('./capture.cjs');
const domain=require('../../../miniprogram/core/habits'),dates=require('../../../miniprogram/core/date');
const {THEMES}=require('../../../miniprogram/config/theme-tokens');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const mp=await automator.connect({wsEndpoint:'ws://127.0.0.1:9433'}),out=path.join(__dirname,'post-change'),log=[];fs.mkdirSync(out,{recursive:true});let seq=1;
 const route=async(expected)=>{for(let i=0;i<30;i++){const p=await mp.currentPage();if(p.path===expected){await sleep(1100);return p;}await sleep(200);}throw Error('route '+expected);};
 const go=async(name,query='')=>{await mp.reLaunch('/pages/'+name+'/index'+(query?'?'+query:''));return route('pages/'+name+'/index');};
 const shot=async(label,steps,level='F')=>{await sleep(300);const p=await mp.currentPage(),file=String(seq++).padStart(2,'0')+'-'+label+'-'+level+'.png';await mp.screenshot({path:path.join(out,file)});log.push({file,page:p.path,level,steps,health:'待目检'});console.log(file);};
 const tap=async(p,selector,delay=850)=>{const e=await p.$(selector);if(!e)throw Error('missing '+selector);await e.tap();await sleep(delay);return mp.currentPage();};
 const ctl=async(action,value)=>mp.evaluate(p=>globalThis.__contestControl[p.action](p.value),{action,value});
 try{
  const info=await mp.systemInfo();log.push({environment:{SDKVersion:info.SDKVersion,platform:info.platform,windowWidth:info.windowWidth,windowHeight:info.windowHeight,date:dates.today()}});
  log.push({liveRead:await mp.evaluate(()=>{if(globalThis.__contestOriginal)throw Error('fixture未恢复');const x=getApp().cloudSession.status();return {ready:x.ready,phase:x.phase,pending:x.pending,count:x.count,lastSyncedAt:x.lastSyncedAt,lastError:x.lastError||'',readOnly:true};})});
  let p=await go('sync');await shot('cloud-read','检查当前已确认的云端读取时间；不执行真实写操作','W');
  p=await go('today');await shot('today','改版真实开发账户今日；仅观察原有目标','W');
  p=await go('assistant');await shot('assistant-basic','基础优先，未展开AI，无供应商请求','W');await tap(p,'.rules-button');await shot('basic-preview','基础规则预览，未创建','W');
  await mp.evaluate(inject,{state:domain.emptyState(),created:single(),theme:'mist',tokens:THEMES.mist,latency:2200});
  p=await go('today');await shot('first-empty','模拟空账户；整理3分钟主入口');
  p=await tap(p,'.starter-action');p=await route('pages/edit/index');await shot('template-confirm','实际点击整理主入口→3/1确认页；未保存');
  await(await p.$('#title')).input('整理我的桌面');await(await p.$('#target')).input('4');await shot('dirty-input','修改名称/目标；会话草稿，无云写入');await mp.navigateBack();p=await route('pages/today/index');
  await tap(p,'.starter-action');p=await route('pages/edit/index');await shot('draft-reentry','返回后点击相同入口；输入接续成功');log.push({draftCheck:{title:await p.data('title'),target:await p.data('target'),restored:await p.data('draftRestored')}});
  await(await p.$('#target')).input('0');await p.callMethod('onSave');await shot('invalid-target','目标0提交；字段错误与输入保留');await(await p.$('#target')).input('4');
  await mp.evaluate(()=>{const pages=getCurrentPages();pages[pages.length-1].onSave();return true;});await shot('creating','调用保存事件，内存延迟2200ms等待；未显示成功');await sleep(2300);p=await route('pages/today/index');await shot('created','fixture创建确认后回今日');
  await mp.evaluate(()=>{const pages=getCurrentPages(),p=pages[pages.length-1],task=p.data.pending[0];p.onCompleteMinimum({currentTarget:{dataset:{id:task.id,date:task.date}}});return true;});await shot('recording','调用忙时事件，内存等待2200ms；防连点');await sleep(2400);await shot('feedback','确认后已记下＋撤销');await sleep(5100);
  if(!(await p.data('showCompleted')))await tap(p,'.disclosure');await shot('completed','中性本次记录，平时目标保留');await tap(p,'.undo',2500);await shot('undo','撤销后显示当前今天目标，不推断调整来源');
  let state=single(6);for(let i=1;i<=5;i++)state=domain.reduce(state,{type:i%2?'completeMinimum':'complete',id:'audit-read',date:dates.shift(dates.today(),-i)},dates.shift(dates.today(),-i));await ctl('state',state);
  p=await go('progress');await shot('progress','事实、分母、明日调整');const cell=await p.$('.cell');log.push({calendar:{size:await cell.size(),runtimeWidth:info.windowWidth}});await tap(p,'.fact-adjust');p=await route('pages/edit/index');await shot('progress-adjust','进度直接到对应习惯明日编辑；不改历史');
  p=await go('assistant');await tap(p,'.rules-button');await shot('assistant-preview','基础先行，未发送AI');await p.callMethod('onAIOptions');await shot('ai-opt-in','主动展开AI，同意未勾选');await(await p.$('checkbox-group')).trigger('change',{value:['agree']});await tap(p,'.generate-button',1100);await shot('ai-fixture-preview','fixture AI成功，不代表模型可用');
  await ctl('aiMode','failure');p=await go('assistant');await p.callMethod('onAIOptions');await(await p.$('checkbox-group')).trigger('change',{value:['agree']});await tap(p,'.generate-button',1100);await shot('ai-failure','模拟额度失败，输入仍在');await tap(p,'.rules-button');await shot('ai-recover','AI错误后基础方案仍可用');
  await ctl('mode','loading');p=await go('today');await shot('loading','读取中仍解释两档价值，示例明确标注');await ctl('mode','offline');p=await go('today');await shot('read-failure','模拟不可读取，重试入口');await tap(p,'.primary');await shot('read-recovery','重试恢复同一fixture');
  await ctl('share','plan');p=await go('detail','id=audit-read');await p.callMethod('onSharePlan');p=await route('pages/share-create/index');await shot('share-source','详情分享→来源习惯已选择；仅内存开关');await p.callMethod('onPreview');await sleep(600);await shot('share-preview','脱敏预览，未公开');await p.callMethod('onCreate');p=await route('pages/share-view/index');await shot('share-owner','分享者发送主按钮；未发送');
  p=await go('share-view','id='+'a'.repeat(64));await shot('share-receiver','接收者主操作使用计划');await p.callMethod('onCopy');p=await route('pages/edit/index');await shot('share-confirm','采用→可编辑确认；未自动创建');
  await ctl('share','invite');p=await go('share-view','id='+'a'.repeat(64));await shot('invite','邀请有选择小目标入口');await ctl('share','weekly');p=await go('share-view','id='+'a'.repeat(64));await shot('weekly','周记有选择小目标入口');
  log.push({fixtureStats:await mp.evaluate(()=>globalThis.__contestControl.stats()),realCloudWrites:0,realAIRequests:0,realMessagesSent:0});
 } finally {fs.writeFileSync(path.join(out,'steps.json'),JSON.stringify(log,null,2));await mp.evaluate(restore);await mp.reLaunch('/pages/today/index');await sleep(1700);console.log(JSON.stringify(await mp.evaluate(()=>({fixtureRestored:!globalThis.__contestOriginal,source:getApp().store.info().source}))));await mp.disconnect();}
 process.exit(0);
})().catch(e=>{console.error(e.stack);process.exit(1)});

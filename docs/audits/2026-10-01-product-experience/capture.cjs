const fs=require('node:fs'),path=require('node:path');
const a=require(path.join(process.env.TEMP,'mp-automator/node_modules/miniprogram-automator'));
const d=require('../../../miniprogram/core/habits'),dt=require('../../../miniprogram/core/date');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const m=await a.connect({wsEndpoint:'ws://127.0.0.1:9431'});const out=__dirname,logs=[];fs.mkdirSync(out,{recursive:true});
const shot=async(name)=>{await wait(2400);const p=await m.currentPage();const data=await p.data();logs.push({name,path:p.path,loading:data.loading,dataReady:data.dataReady,total:data.total,done:data.done,compact:data.compact,writeBusy:data.writeBusy,feedback:data.completionFeedback});await m.screenshot({path:path.join(out,name+'.png')});};
try{
await m.reLaunch('/pages/today/index');await shot('01-entry-W');
await m.navigateTo('/pages/edit/index?template=read');await shot('02-template-W');
const day=dt.today();let state=d.emptyState();for(const [id,title] of [['read','读一会儿'],['walk','锻炼一会儿'],['tidy','整理桌面']])state=d.reduce(state,{type:'create',id,startDate:dt.shift(day,-6),plan:{title,target:id==='tidy'?10:30,minimum:id==='tidy'?3:10,unit:'分钟',time:'',weekdays:[1,2,3,4,5,6,7]}},dt.shift(day,-6));
const done=d.reduce(state,{type:'completeMinimum',id:'read',date:day},day);
await m.evaluate(payload=>{const app=getApp();globalThis.__productAuditStore=app.store;let i=0;app.store={read:()=>JSON.parse(JSON.stringify(payload.states[Math.min(i,2)])),info:()=>({source:'cloud',ready:true,phase:'ready',pending:0,deletionPending:false,conflict:null,lastError:'',syncText:'云端数据已确认',syncAttention:false}),contextKey:()=> 'product-audit-memory',stale:()=>null,dispatch:()=>new Promise(r=>setTimeout(()=>{i=Math.min(i+1,2);r(JSON.parse(JSON.stringify(payload.states[i])));},900))};},{states:[state,done,d.reduce(done,{type:'undo',id:'read',date:day},day)]});
await m.reLaunch('/pages/today/index');await shot('03-tasks-F');let p=await m.currentPage();await (await p.$('.soft-button')).tap();await shot('04-completion-F');
await (await p.$('.feedback-undo')).tap();await shot('05-undo-control-F');
await m.evaluate(payload=>{getApp().store.read=()=>payload;},done);
await m.reLaunch('/pages/progress/index');await shot('06-progress-F');
await m.reLaunch('/pages/detail/index?id=read');await shot('07-detail-F');
await m.evaluate(payload=>{getApp().store.read=()=>payload;},d.emptyState());await m.reLaunch('/pages/today/index');await shot('08-first-empty-F');
}finally{await m.evaluate(()=>{if(globalThis.__productAuditStore){getApp().store=globalThis.__productAuditStore;delete globalThis.__productAuditStore;}});await m.reLaunch('/pages/today/index');fs.writeFileSync(path.join(out,'observations.json'),JSON.stringify(logs,null,2));await m.disconnect();}
})().catch(e=>{console.error(e);process.exitCode=1;});

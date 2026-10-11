const fs=require('node:fs'),path=require('node:path');
const automator=require(path.join(process.env.TEMP,'mp-automator/node_modules/miniprogram-automator'));
const {inject,restore,single}=require('./capture.cjs'),domain=require('../../../miniprogram/core/habits'),dates=require('../../../miniprogram/core/date'),{THEMES}=require('../../../miniprogram/config/theme-tokens');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const mp=await automator.connect({wsEndpoint:'ws://127.0.0.1:9433'}),out=path.join(__dirname,'post-change'),log=[];
try{
 const info=await mp.systemInfo();if(info.windowWidth!==320)throw Error('日历复核要求实际逻辑窗口320宽度');log.push({environment:{date:dates.today(),platform:info.platform,width:info.windowWidth,height:info.windowHeight,SDKVersion:info.SDKVersion}});
 let state=single(6);for(let i=1;i<=5;i++)state=domain.reduce(state,{type:i%2?'completeMinimum':'complete',id:'audit-read',date:dates.shift(dates.today(),-i)},dates.shift(dates.today(),-i));await mp.evaluate(inject,{state,theme:'mist',tokens:THEMES.mist});await mp.reLaunch('/pages/progress/index');await sleep(1800);let p=await mp.currentPage();
 for(const days of [7,28]){await p.callMethod('onPeriod',{currentTarget:{dataset:{days}}});await sleep(1200);await mp.callWxMethod('pageScrollTo',{selector:'.calendar-scroll',duration:0});await sleep(800);const file=(days===7?'42-calendar-320-fixed':'43-calendar28-320-fixed')+'-F.png';await mp.screenshot({path:path.join(out,file)});log.push({file,page:p.path,level:'F',steps:'320宽度，近'+days+'天，按真实网格测量横滑高度；选中日期滚入视口；未写云',selectedDate:await p.data('selectedDate'),size:{cell:await(await p.$('.cell')).size(),container:await(await p.$('.calendar-scroll')).size()},height:await p.data('calendarHeight'),health:'待目检'});console.log(file);}
}finally{fs.writeFileSync(path.join(out,'steps-calendar.json'),JSON.stringify(log,null,2));await mp.evaluate(restore);await mp.reLaunch('/pages/today/index');await sleep(1400);await mp.disconnect();}process.exit(0);
})().catch(e=>{console.error(e.stack);process.exit(1)});

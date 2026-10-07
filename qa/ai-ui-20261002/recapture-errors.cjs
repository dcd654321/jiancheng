// 局部样式修复后的两主题错误态复采；F处理器输入，无键盘或云写入。
const path=require('node:path'),a=require(path.join(process.env.TEMP,'mp-automator/node_modules/miniprogram-automator'));
const {inject,restore}=require('./capture.cjs'),domain=require('../../miniprogram/core/habits'),{THEMES}=require('../../miniprogram/config/theme-tokens');
const out=path.resolve(__dirname,'../../docs/audits/2026-10-02-ai-ui'),wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const m=await a.connect({wsEndpoint:'ws://127.0.0.1:9433'});try{
 for(const theme of ['mist','paper']){await m.evaluate(inject,{theme,tokens:THEMES[theme],state:domain.emptyState()});
 const p=await m.reLaunch('/pages/assistant/index');await wait(1500);await p.callMethod('onCustom');await p.callMethod('onMinutes',{detail:{value:'0'}});await p.callMethod('onRules');await wait(600);
 await m.screenshot({path:path.join(out,'28-invalid-minutes-'+theme+'-F.png')});console.log(theme);}
}finally{await m.evaluate(restore);await m.reLaunch('/pages/today/index');await wait(1400);await m.disconnect();}})().catch(e=>{console.error(e.message);process.exitCode=1;});

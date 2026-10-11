const path=require('node:path');
const a=require(path.join(process.env.TEMP,'mp-automator/node_modules/miniprogram-automator'));
(async()=>{const m=await a.connect({wsEndpoint:'ws://127.0.0.1:9433'});try{let p=await m.currentPage(),e=await p.$('.tpl-card');console.log(await e.wxml());await e.tap();await p.waitFor(2300);let q=await m.currentPage();console.log(q.path);await m.screenshot({path:path.join(__dirname,'22-template-recheck-W.png')});}finally{await m.disconnect();process.exit(0)}})().catch(e=>{console.error(e.message);process.exit(1)});

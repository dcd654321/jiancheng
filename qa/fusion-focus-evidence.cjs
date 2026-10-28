'use strict';
// 先通过真实鼠标点击隔离输入框，再运行本文件读回原生事件状态。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {connect,out} = require('./fusion-native.cjs');
(async()=>{
  const mp = await connect();
  try {
    const evidence = await mp.evaluate(()=>{
      const page=getCurrentPages().slice(-1)[0],system=wx.getSystemInfoSync();
      return {route:page.route,focusField:page.data.focusField,keyboardOpen:page.data.keyboardOpen,windowWidth:system.windowWidth,windowHeight:system.windowHeight,guard:globalThis.__fusionGuard};
    });
    assert.equal(evidence.route,'pages/edit/index');
    assert.equal(evidence.focusField,'title','Real native focus event must reach the page');
    for(const key of ['cloudCalls','networkCalls','storageWrites','businessWrites']) assert.equal(evidence.guard[key],0);
    evidence.inputOrigin='Windows Computer Use: observed input then one real mouse click; no simulated focus handler';
    evidence.boundary='Desktop native focus verified; keyboardOpen=false does not verify a real phone soft keyboard.';
    await mp.screenshot({path:path.join(out,'focus-390-real-input.png')});
    fs.writeFileSync(path.join(out,'focus-390-real-input.json'),JSON.stringify(evidence,null,2));
    console.log(JSON.stringify({route:evidence.route,focusField:evidence.focusField,keyboardOpen:evidence.keyboardOpen,width:evidence.windowWidth}));
  } finally { await mp.disconnect(); }
})().catch(error=>{console.error(error.stack);process.exitCode=1;});

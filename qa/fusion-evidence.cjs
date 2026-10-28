'use strict';

// 汇总现有证据；不启动工具、不触发云或业务操作。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const base = path.join(root, 'docs/implementation/2026-10-27-fusion-native');
const out = path.join(base, 'native');
const read = name => JSON.parse(fs.readFileSync(path.join(out, name + '.json'), 'utf8'));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const matrix = [];
for (const width of [320, 375, 390, 430]) for (const theme of ['mist', 'paper']) {
  const label = `final-${width}-${theme}`, evidence = read(label);
  assert.equal(evidence.viewport.windowWidth, width, label);
  assert.equal(evidence.screenshots.length, 5, label);
  assert.ok(!evidence.error, evidence.error);
  assert.deepEqual(evidence.exceptions, []);
  for (const page of evidence.measurements) assert.ok(page.document.width<=width+.5,label+': document overflow '+page.page);
  for (const key of ['cloudCalls','networkCalls','storageWrites','businessWrites']) assert.equal(evidence.guard[key], 0, label + ': ' + key);
  const files = evidence.screenshots.map(item => {
    assert.ok(fs.existsSync(path.join(out, item.file)), item.file);
    return { file:item.file, sha256:hash(path.join(out,item.file)) };
  });
  matrix.push({label,width,theme,files,variant:evidence.variant,guard:{cloudCalls:0,networkCalls:0,storageWrites:0,businessWrites:0}});
}
const geometry = ['mist', 'paper'].map(theme => {
  const evidence = read(`final-390-${theme}-comparison`);
  return { theme, pages:evidence.pages.map(page => {
    const rects = page.pairs.flatMap(pair => pair.rects.filter(rect => !rect.unmatched).map(rect => ({selector:pair.native,index:rect.index,maxDelta:rect.maxDelta,delta:rect.delta})));
    return {page:page.page,matched:rects.length,maxDelta:Math.max(...rects.map(rect=>rect.maxDelta)),over2px:rects.filter(rect=>rect.maxDelta>2),missing:page.pairs.filter(pair=>pair.nativeCount!==pair.referenceCount).map(pair=>({native:pair.native,reference:pair.reference,nativeCount:pair.nativeCount,referenceCount:pair.referenceCount}))};
  }) };
});
for (const theme of geometry) for (const page of theme.pages) {
  assert.deepEqual(page.over2px,[],theme.theme+': '+page.page+' geometry exceeds2px');
  const expected=page.page==='edit' ? [{native:'.input',reference:'input',nativeCount:3,referenceCount:4}] : page.page==='detail' ? [{native:'.detail-section',reference:'.section',nativeCount:5,referenceCount:4}] : [];
  assert.deepEqual(page.missing,expected,theme.theme+': undocumented semantic pairing change '+page.page);
}
const manifest = JSON.parse(fs.readFileSync(path.join(base,'baseline-manifest.json'),'utf8'));
const baseline = manifest.files.map(file => ({file:file.frozen,sourceUnchanged:hash(path.join(root,file.source))===file.sha256,frozenUnchanged:hash(path.join(base,'baseline',file.frozen))===file.sha256}));
assert.ok(baseline.every(file=>file.sourceUnchanged&&file.frozenUnchanged));
const extremes = ['final-320-long-mist','final-320-large-mist','final-320-large-paper','final-320-scroll-mist','state-390-edit-existing-mist','state-390-edit-existing-paper','state-390-month-mist','state-390-calendar-mist'].map(label=>{
  const evidence=read(label);
  assert.ok(!evidence.error,evidence.error);
  assert.deepEqual(evidence.exceptions,[]);
  for(const key of ['cloudCalls','networkCalls','storageWrites','businessWrites']) assert.equal(evidence.guard[key],0,label+': '+key);
  return {label,width:evidence.viewport.windowWidth,simulatedFontSizeSetting:evidence.simulatedFontSizeSetting,variant:evidence.variant,screenshots:evidence.screenshots.map(item=>({file:item.file,sha256:hash(path.join(out,item.file)),scrollTop:item.scrollTop})),measuredDocumentWidths:evidence.measurements.map(item=>({page:item.page,width:item.document.width}))};
});
const focus=read('focus-390-real-input');
assert.equal(focus.focusField,'title');
const summary = {date:'2026-10-28',level:'isolated-native-synthetic-data',matrix,geometry,extremes,focus:{evidence:'native/focus-390-real-input.json',focusField:focus.focusField,keyboardOpen:focus.keyboardOpen},baseline,pending:['真实云端','真机软键盘与系统大字号','双账户','用户UI及业务验收'],normalWidthCoverage:'5 pages x 2 themes x 4 actual native logical widths',note:'390正文矩形比较；安全区、原生导航/Tab及系统字体按平台显示。暖纸白颜色对照语义主题参数。极端状态另见验收报告。'};
fs.writeFileSync(path.join(base,'acceptance-summary.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify({matrix:matrix.length,screenshots:matrix.reduce((sum,item)=>sum+item.files.length,0),geometry,baselineUnchanged:baseline.length}));

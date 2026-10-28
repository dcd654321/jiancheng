'use strict';
// 重拍样式修复影响到的页面，并保留未变页面的原始测量与重拍来源。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {capture,out} = require('./fusion-native.cjs');
const [width,theme,names] = process.argv.slice(2);
assert.match(width,/^(320|375|390|430)$/);
assert.match(theme,/^(mist|paper)$/);
assert.ok(names.split(',').every(name=>['today','progress','edit','detail','mine'].includes(name)));
const label=`final-${width}-${theme}`, patch=label+'-refresh';
const file=path.join(out,label+'.json');
const original=JSON.parse(fs.readFileSync(file,'utf8'));
(async()=>{
  await capture([patch,names,theme,'16','snapshot']);
  const refreshed=JSON.parse(fs.readFileSync(path.join(out,patch+'.json'),'utf8'));
  for (const shot of refreshed.screenshots) {
    const canonical=shot.file.replace(patch,label);
    fs.copyFileSync(path.join(out,shot.file),path.join(out,canonical));
    fs.unlinkSync(path.join(out,shot.file));
    shot.file=canonical;
    const index=original.screenshots.findIndex(item=>item.route===shot.route);
    assert.ok(index>=0,shot.route);
    original.screenshots[index]=shot;
  }
  for (const measurement of refreshed.measurements) {
    const index=original.measurements.findIndex(item=>item.page===measurement.page);
    assert.ok(index>=0,measurement.page);
    original.measurements[index]=measurement;
  }
  original.refreshes=[...(original.refreshes||[]),{evidence:patch+'.json',pages:names.split(','),note:'仅重拍样式修复影响页面；其余页面原测量保留。'}];
  original.sourceFiles=[...new Map([...(original.sourceFiles||[]),...refreshed.sourceFiles].map(item=>[item.file,item])).values()];
  original.guard=refreshed.guard;
  delete original.error;
  fs.writeFileSync(path.join(out,patch+'.json'),JSON.stringify(refreshed,null,2));
  fs.writeFileSync(file,JSON.stringify(original,null,2));
  console.log('Updated '+label+': '+names);
})().catch(error=>{console.error(error.stack);process.exitCode=1;});

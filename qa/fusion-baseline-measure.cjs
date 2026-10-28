'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.FUSION_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname,'..');
const out = path.join(root,'docs/implementation/2026-10-27-fusion-native/native');
(async()=>{
  const browser = await chromium.launch({headless:true,channel:'chrome'});
  const page = await browser.newPage({viewport:{width:390,height:780},deviceScaleFactor:1});
  try {
    const screen = process.argv[2] || 'today';
    await page.goto('file:///' + path.join(root,'docs/implementation/2026-10-27-fusion-native/baseline/fusion.html').replace(/\\/g,'/') + '?screen=' + screen);
    const result = await page.evaluate(()=>{
      const origin = document.querySelector('main').getBoundingClientRect();
      const selectors=['.page','.heading','h1','.subline','.today-summary','.summary-top','.summary-bottom','.timeline-head','.timeline','.schedule-row','.time','.rail','.slot','.task-title','.task-meta','.checkin','.busy-btn','.timeline-note','.segmented','.segment','.period','.progress-copy','.progress-copy h2','.chart-title','.daily-chart','.chart-column','.bar-stack','.chart-legend','.rate-row','.current-line','.form-intro','.form-field','.field-label','input','.field-heading','.weekdays','.weekday-btn','.primary','.save-block','.more-settings','.back-heading','.detail-name','.detail-name h2','.status-line','.section','.section-head','.target-lines','.target-line','.detail-actions','.secondary','.note-copy','.plan-list','.plan-item','.more-operations','.mine-intro','.menu-list','.menu-row','.setting-row','.menu-icon','.demo-footer'];
      return {level:'frozen-html-reference-measurement',viewport:{width:innerWidth,height:innerHeight},bodyOrigin:{left:origin.left,top:origin.top,width:origin.width,height:origin.height},elements:selectors.map(selector=>({selector,rects:[...document.querySelectorAll(selector)].map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {left:r.left-origin.left,top:r.top-origin.top,width:r.width,height:r.height,fontSize:s.fontSize,lineHeight:s.lineHeight,text:el.innerText.slice(0,140)};})}))};
    });
    fs.writeFileSync(path.join(out,'frozen-'+screen+'-390-geometry.json'),JSON.stringify(result,null,2));
    await page.screenshot({path:path.join(out,'frozen-html-'+screen+'-reference.png')});
    console.log(JSON.stringify({screen,bodyOrigin:result.bodyOrigin,elements:result.elements.filter(e=>e.rects.length).map(e=>({selector:e.selector,count:e.rects.length}))}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});

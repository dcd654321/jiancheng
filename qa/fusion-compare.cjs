'use strict';
const fs = require('node:fs');
const path = require('node:path');
const out = path.resolve(__dirname,'../docs/implementation/2026-10-27-fusion-native/native');
const label = process.argv[2] || 'core-390-mist';
const n = JSON.parse(fs.readFileSync(path.join(out,label+'.json')));
const maps = {
  today: [['.page-header','.heading'],['.heading','h1'],['.subline','.subline'],['.today-summary','.today-summary'],['.summary-top','.summary-top'],['.summary-bottom','.summary-bottom'],['.timeline-head','.timeline-head'],['.timeline','.timeline'],['.schedule-row','.schedule-row'],['.slot','.slot'],['.timeline-title','.task-title'],['.timeline-checkin','.checkin'],['.timeline-busy','.busy-btn'],['.timeline-note','.timeline-note']],
  progress: [['.heading','h1'],['.subline','.subline'],['.segments','.segmented'],['.segment','.segment'],['.range','.period'],['.progress-copy','.progress-copy'],['.progress-statement','.progress-copy h2'],['.chart-title','.chart-title'],['.week-trend','.daily-chart'],['.trend-day','.chart-column'],['.bar-stack','.bar-stack'],['.trend-legend','.chart-legend'],['.rate-row','.rate-row'],['.current-line','.current-line']],
  edit: [['.back-heading','.back-heading'],['.heading','h1'],['.form-intro','.form-intro'],['#field-title','.form-field',0],['#field-target','.form-field',1],['#field-minimum','.form-field',2],['.input','input'],['.minimum-heading','.field-heading'],['.week-options','.weekdays'],['.day-option','.weekday-btn'],['.primary','.primary'],['.disclosure','.more-settings']],
  detail: [['.back-heading','.back-heading'],['.heading','h1'],['.detail-name','.detail-name'],['.habit-name','.detail-name h2'],['.status-line','.status-line'],['.detail-section','.section'],['.detail-section-head','.section-head'],['.target-lines','.target-lines'],['.target-line','.target-line'],['.detail-checkin-actions','.detail-actions'],['.primary','.primary'],['.secondary','.secondary'],['.note-preview','.note-copy'],['.plan-list','.plan-list'],['.plan-item','.plan-item'],['.more-group','.more-operations']],
  mine: [['.heading','h1'],['.mine-intro','.mine-intro'],['.group','.section'],['.group-label','.section-head'],['.menu-list','.menu-list'],['.setting-row','.menu-row'],['.quote-setting','.setting-row'],['.menu-icon','.menu-icon']]
};
const result = { label, viewport:n.viewport, rule:'Body logical rectangles, native navigation/tab bar excluded; page root height includes native safe area and is recorded separately.', pages:[] };
for (const page of n.measurements) {
  const b = JSON.parse(fs.readFileSync(path.join(out,'frozen-'+page.page+'-390-geometry.json')));
  const pairs=[];
  for (const [native,reference,referenceIndex] of maps[page.page]) {
    let nr=page.elements.find(e=>e.selector===native)?.rects||[];
    // Native selector engine ignores :not(). Compare the quote switch separately,
    // then the six ordinary menu rows in their actual document order.
    if (page.page === 'mine' && reference === '.menu-row') nr=nr.filter((_,index)=>index!==1);
    let br=b.elements.find(e=>e.selector===reference)?.rects||[];
    if (referenceIndex !== undefined) br=br.slice(referenceIndex,referenceIndex+1);
    const rects=nr.map((r,i)=>{if(!br[i]) return {index:i,unmatched:true}; const delta=Object.fromEntries(['left','top','width','height'].map(k=>[k,r[k]-br[i][k]]));return {index:i,native:{left:r.left,top:r.top,width:r.width,height:r.height},reference:{left:br[i].left,top:br[i].top,width:br[i].width,height:br[i].height},delta,maxDelta:Math.max(...Object.values(delta).map(Math.abs))};});
    pairs.push({native,reference,nativeCount:nr.length,referenceCount:br.length,rects});
  }
  const nativePage=page.elements.find(e=>e.selector==='.page')?.rects[0];
  const referencePage=b.elements.find(e=>e.selector==='.page')?.rects[0];
  result.pages.push({page:page.page,pageRoot:{native:nativePage,reference:referencePage},pairs});
}
fs.writeFileSync(path.join(out,label+'-comparison.json'),JSON.stringify(result,null,2));
for(const p of result.pages) console.log(JSON.stringify({page:p.page,violations:p.pairs.filter(x=>x.rects.some(r=>r.maxDelta>2)).map(x=>({native:x.native,reference:x.reference,deltas:x.rects.filter(r=>r.maxDelta>2).map(r=>({index:r.index,delta:r.delta}))})),missing:p.pairs.filter(x=>!x.nativeCount).map(x=>x.native)}));

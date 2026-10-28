'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { rasterize, encodePng, segmentsOf, cubicPolyline } = require('./generate-tab-icons.cjs');
const { THEMES } = require('../miniprogram/config/theme-tokens');
const line = points => segmentsOf(points);
// The same 24px line geometry as the approved reference, rasterized locally for WeChat.
const geometry = {
  list: { arcs:[], segments: [[9,6,20,6],[9,12,20,12],[9,18,20,18],[4,6,4.01,6],[4,12,4.01,12],[4,18,4.01,18]] },
  sliders: { arcs:[[11.5,7,2.5],[16.5,17,2.5]], segments:[[4,7,9,7],[14,7,20,7],[4,17,14,17],[19,17,20,17]] },
  clock: { arcs:[[12,12,8]], segments:line([[12,7],[12,12],[15,14]]) },
  people: { arcs:[[9,8,3],[18,8,2.5]], segments:[...line([[3,20],[3,18]]), ...line(cubicPolyline([3,18],[3,10],[15,10],[15,18])),[15,18,15,20],...line(cubicPolyline([17,14],[20,14],[21,17],[21,20]))] },
  message: { arcs:[], segments:line([[20,16],[20,4],[4,4],[4,22],[9,19],[17,19],[20,16]]).concat([[8,8,16,8],[8,12,13,12]]) },
  book: { arcs:[], segments:[...line([[12,6],[8,4],[3,5],[3,19],[8,18],[12,20],[12,6],[16,4],[21,5],[21,19],[16,18],[12,20]])] }
};
const out = path.resolve(__dirname, '../miniprogram/assets/menu');
fs.mkdirSync(out,{recursive:true});
for(const [theme,tokens] of Object.entries(THEMES)) for(const [name,shape] of Object.entries(geometry)) {
  const scaled={ arcs:shape.arcs.map(a=>a.map(n=>n*81/24)),segments:shape.segments.map(a=>a.map(n=>n*81/24)) };
  fs.writeFileSync(path.join(out, name+'-'+theme+'.png'),encodePng(rasterize(scaled,tokens.primary)));
}
console.log('PASS 12 menu icons generated from theme tokens.');

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const sharp = require(process.env.FUSION_SHARP || 'sharp');
const root = path.resolve(__dirname,'..');
const base = path.join(root,'docs/implementation/2026-10-27-fusion-native');
const out = path.join(base,'native');
const label = process.argv[2] || 'final-390-mist';
const pages = [['today','今日'],['progress','进度'],['edit','添加习惯'],['detail','习惯详情'],['mine','我的']];
const svg = (w,h,lines) => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'"><rect width="100%" height="100%" fill="#edf1ec"/>'+lines.map(l=>'<text x="'+l.x+'" y="'+l.y+'" font-family="Microsoft YaHei,Arial,sans-serif" font-size="'+(l.size||16)+'" fill="#18382c">'+l.text+'</text>').join('')+'</svg>');
(async()=>{
  const provenance={label,note:'Full screens normalized to390 logical width. Native raw PNG preview scale is not used for the2px geometry gate; use the original automator logical rectangles.',pairs:[]};
  const overview=[];
  overview.push({input:svg(2094,1814,[{x:20,y:28,size:20,text:'渐成融合版 · 冻结原型 / 微信隔离原生 · 390逻辑宽'},{x:20,y:53,size:14,text:'上：冻结原型；下：原生全屏。导航栏与原生底栏差异保留；2px判定使用逻辑矩形。'}]),top:0,left:0});
  for(let i=0;i<pages.length;i++){
    const [name,title]=pages[i],raw=path.join(out,label+'-'+name+'.png'),reference=path.join(base,'baseline/fusion-'+name+'-390.png');
    const meta=await sharp(raw).metadata();
    const native=await sharp(raw).resize(390,844,{fit:'fill'}).png().toBuffer();
    const frozen=await sharp(reference).resize(390,780,{fit:'fill'}).png().toBuffer();
    const file=label+'-'+name+'-pair.png';
    await sharp(svg(814,956,[{x:12,y:27,size:18,text:title+' · 冻结原型（左） / 隔离微信原生（右）'},{x:12,y:928,size:13,text:'原生预览PNG '+meta.width+'×'+meta.height+' → 390×844；正文几何另见 comparison.json。'}]))
      .composite([{input:frozen,left:12,top:48},{input:native,left:412,top:48}]).png().toFile(path.join(out,file));
    const x=18+i*414;
    overview.push({input:svg(390,28,[{x:0,y:20,size:17,text:title+' · 冻结原型'}]),left:x,top:72});
    overview.push({input:frozen,left:x,top:104});
    overview.push({input:svg(390,28,[{x:0,y:20,size:17,text:title+' · 微信原生'}]),left:x,top:898});
    overview.push({input:native,left:x,top:930});
    provenance.pairs.push({page:name,raw:path.basename(raw),rawWidth:meta.width,rawHeight:meta.height,displayWidth:390,displayHeight:844,pair:file});
  }
  await sharp({create:{width:2094,height:1814,channels:4,background:'#edf1ec'}}).composite(overview).png().toFile(path.join(out,label+'-overview.png'));
  fs.writeFileSync(path.join(out,label+'-board-provenance.json'),JSON.stringify(provenance,null,2));
  console.log(JSON.stringify({overview:label+'-overview.png',pairs:provenance.pairs.map(p=>p.pair)}));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});

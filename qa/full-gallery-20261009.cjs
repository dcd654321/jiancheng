// 从实际取证清单生成本地截图索引，不改变应用或证据。
const fs = require('node:fs'), path = require('node:path');
const out = path.resolve(__dirname, '../docs/audits/2026-10-09-full-review');
const evidence = JSON.parse(fs.readFileSync(path.join(out, 'observations.json'), 'utf8'));
const labels = [
  '今日：薄雾绿', '进度：薄雾绿', '我的：薄雾绿', '模板确认：薄雾绿', '习惯详情：薄雾绿',
  '习惯管理', '云状态：首次夹具计数不准确，计数结论使用35', '数据页面', '分享创建：未开放', '分享列表：未开放',
  '分享接收：未开放及恢复出口', '提醒：未开放', '外观：薄雾绿', '小目标助手：薄雾绿', '今日：暖纸白',
  '进度：暖纸白', '我的：暖纸白', '模板确认：暖纸白', '习惯详情：暖纸白', '外观：暖纸白',
  '小目标助手：暖纸白', '首次空页面：模板目标整组换行，最终样式', '实际点击模板进入确认', '实际从我的进入规则助手', '规则方案预览',
  '采用规则方案进入确认，尚未保存', '忙时记录：受控10秒等待', '记录确认后', '撤销确认后', '离线只读',
  '无可读数据：恢复入口', '加载：示例卡片内边距，最终样式', '近28天进度', '无效详情链接：恢复出口', '云状态：修正夹具计数为4',
  '近7天：逐日记录', '近28天：七列滚动日历', '离线：短句开关禁用', '今天/明天容量已满', '今天满、明天可用：系统选择与干净草稿'
];
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const cards = evidence.screenshots.map(s => `<figure id="step-${s.step}"><a href="${escape(s.file)}" target="_blank"><img loading="lazy" src="${escape(s.file)}" alt="${escape(labels[s.step-1])}"></a><figcaption><b>${String(s.step).padStart(2,'0')} · ${escape(labels[s.step-1])}</b><small>${escape(s.route)} · F 内存夹具</small></figcaption></figure>`).join('\n');
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>渐成 · 2026-10-09 审查证据</title><style>*{box-sizing:border-box}body{margin:0;background:#f5f7f2;color:#263b32;font:15px/1.7 system-ui,sans-serif}header,main{max-width:1320px;margin:auto;padding:24px}header{padding-bottom:8px}h1{font-size:27px;margin:0 0 12px}p{max-width:920px;margin:8px 0}a{color:#355e4c}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:24px}figure{margin:0;background:#fff;border:1px solid #dbe2d9;border-radius:16px;overflow:hidden}img{display:block;width:100%;height:auto}figcaption{padding:14px}small{display:block;color:#5f6c63;font-size:12px;overflow-wrap:anywhere}</style><header><h1>渐成 · 全量审查证据</h1><p><a href="README.md">修复、健康检查、验证结果与边界</a> · 2026-10-09 · 40 张保存截图</p><p>全部 F 为受控内存夹具。逻辑窗口 390×671、字号16、SDK 3.17.3；覆盖14页面和两个主题的主要页面。分享/提醒展示当前关闭态。320px、真机、两账户和实际云端写入本轮未验证。</p><p>预览/采用写入数为0，打卡/撤销仅使用受控回执；结束已恢复原服务。07计数夹具不准确，已由35补证；22和32已按最终样式重新拍摄。</p></header><main>${cards}</main></html>`, 'utf8');
console.log(`Generated ${evidence.screenshots.length} screenshot captions.`);

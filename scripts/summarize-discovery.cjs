'use strict';

const fs = require('node:fs');
const { summarizeDiscovery } = require('./lib/discovery-summary.cjs');

try {
  const file = process.argv[2];
  if (!file || process.argv.length !== 3) throw Error('用法：node scripts/summarize-discovery.cjs <本地事件导出.json或.jsonl>');
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();
  let rows;
  if (raw.startsWith('[')) rows = JSON.parse(raw);
  else rows = raw ? raw.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line)) : [];
  process.stdout.write(JSON.stringify(summarizeDiscovery(rows), null, 2) + '\n');
} catch (error) {
  // Do not echo exported user data or JSON parser excerpts.
  process.stderr.write(error && error.code === 'ENOENT' ? '找不到输入文件\n' : '无法汇总。请提供本地 JSON 事件数组或 JSONL，每条包含服务端事件时间与来源字段。\n');
  process.exitCode = 1;
}

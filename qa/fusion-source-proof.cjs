'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname,'..');
const isolated = process.env.FUSION_TEMP_ROOT || path.join(os.tmpdir(),'jiancheng-fusion-native-20261027');
const source = path.join(root,'miniprogram');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files = [];
function visit(directory, relative = '') {
  for (const entry of fs.readdirSync(directory,{withFileTypes:true})) {
    const name = path.posix.join(relative,entry.name);
    if (entry.isDirectory()) visit(path.join(directory,entry.name),name);
    else if (!['app.js','core/date.js'].includes(name)) {
      const sha256 = digest(path.join(source,name));
      assert.equal(digest(path.join(isolated,'miniprogram',name)),sha256,'Isolated source stale: '+name);
      files.push({file:name,sha256});
    }
  }
}
visit(source);
const result = {date:'2026-10-28',matched:files.length,exceptions:{'app.js':'隔离夹具启动器；云、网络、本机存储与业务写入禁止','core/date.js':'固定2026-10-27，仅用于同数据比较'},files};
fs.writeFileSync(path.join(root,'docs/implementation/2026-10-27-fusion-native/native/source-proof.json'),JSON.stringify(result,null,2));
console.log('PASS '+files.length+' isolated production files match workspace source. Two documented fixture overrides.');

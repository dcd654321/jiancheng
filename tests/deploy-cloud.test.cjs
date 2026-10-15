const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {parseArgs,deploymentArgs,cliFailed} = require('../scripts/deploy-cloud.cjs');
const {TARGETS} = require('../miniprogram/config/cloud');
test('shared deployment uses the resource appid with explicit generated paths and no consuming project override',()=>{
  for (const target of Object.values(TARGETS)) {
    const root=path.resolve(__dirname,'..'),names=['jiancheng_daka_media_callback','jiancheng_daka_media_tick'];
    const args=deploymentArgs(root,target.envId,names);
    assert.equal(args[args.indexOf('--appid')+1],target.resourceAppid);
    assert.equal(args[args.indexOf('--env')+1],target.envId);
    assert.equal(args.includes('--project'),false);assert.equal(args.includes('--names'),false);
    assert.deepEqual(args.slice(args.indexOf('--paths')+1,-1),names.map(name=>path.join(root,'cloudfunctions',name)));
    assert.equal(args.at(-1),'--remote-npm-install');
  }
});
test('deployment still requires an explicit environment and refuses other application functions',()=>{
  assert.throws(()=>parseArgs([]));assert.throws(()=>parseArgs(['--env','test','--names','cloudbase_auth']));
  assert.throws(()=>parseArgs(['--env','test','--names','monitorApi']));
  assert.equal(parseArgs(['--env','test','--names','jiancheng_daka_media_tick']).envId,TARGETS.test.envId);
});
test('DevTools error output fails deployment even when its process exits zero',()=>{
  assert.equal(cliFailed({status:0,stdout:'',stderr:'× fetching cloud env list\n[error] { code:10 }'}),true);
  assert.equal(cliFailed({status:0,stdout:'\u001b[31m[error]\u001b[0m { code:10 }',stderr:''}),true);
  assert.equal(cliFailed({status:1,stdout:'',stderr:''}),true);
  assert.equal(cliFailed({status:null,stdout:'',stderr:''}),true);
  assert.equal(cliFailed({status:0,stdout:'√ deploy cloudfunctions\n',stderr:'(node) DeprecationWarning'}),false);
});

const test=require('node:test');
const assert=require('node:assert/strict');
const {createPlanAssistant}=require('../miniprogram/services/plan-assistant');
const {ruleSuggestion}=require('../miniprogram/core/plan-assistant');
const input={direction:'read',minutes:5,weekdays:[1],time:''};
const cloud={enabled:true,functionName:'jiancheng_daka_api',envId:'fixture-shared',mode:'shared',resourceAppid:'wx1234567890abcdef'};
const config={enabled:true,functionName:'jiancheng_daka_plan',timeoutMs:30};
test('AI uses only shared instance, retries same request after network loss and rejects account-switch response',async()=>{
  const status={consented:true,ready:true,accountId:'a',epoch:'e',pending:0},calls=[],constructed=[];let lose=true,change=false;
  const wx={cloud:{init(){throw Error('default init forbidden');},callFunction(){throw Error('default call forbidden');},
    Cloud:class {constructor(options){constructed.push(options);}async init(){}async callFunction(o){calls.push(o);if(lose){lose=false;throw Error('lost');}
      if(change)status.epoch='new';return {result:{ok:true,source:'ai',moderated:true,safetyMode:'allowlist-v1',operationId:o.data.operationId,draft:ruleSuggestion(o.data.input).draft}};}}}};
  const service=createPlanAssistant(wx,cloud,config,{session:{status:()=>({...status})}});
  await assert.rejects(service.generate(input,true),/lost/);await service.generate(input,true);
  assert.equal(calls[0].data.operationId,calls[1].data.operationId);assert.equal(calls[0].data.epoch,'e');assert.equal(calls[0].data.consent,true);
  assert.equal(constructed.length,1);assert.deepEqual(constructed[0],{resourceAppid:cloud.resourceAppid,resourceEnv:cloud.envId});
  change=true;await assert.rejects(service.generate({...input,minutes:6},true),/账户数据/);
});
test('AI legacy environment, missing consent/account and pending records cannot contact paid service',async()=>{
  for(const patch of [{consented:false},{ready:false},{pending:1},{deletionPending:true},{networkOffline:true}]){
    let calls=0;const service=createPlanAssistant({cloud:{}},cloud,config,{session:{status:()=>({accountId:'a',epoch:'e',consented:true,ready:true,...patch})},transportFactory:()=>()=>{calls++;}});
    await assert.rejects(service.generate(input,true));assert.equal(calls,0);
  }
  const service=createPlanAssistant({}, {...cloud,functionName:'habitApi'}, config);assert.equal(service.status().configured,false);await assert.rejects(service.generate(input,true),/尚未配置/);
});

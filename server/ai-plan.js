'use strict';
const crypto=require('node:crypto');
const {ApiError,fail,token,canonical}=require('./protocol');
const {authenticate}=require('./identity');
const {read,readAccount}=require('./features-repository');
const {COLLECTION}=require('./cloudbase-repository');
const REQUESTS='jiancheng_daka_ai_requests',BUDGET='jiancheng_daka_ai_budget';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const integer=(n,max=1000000000000)=>Number.isSafeInteger(n)&&n>0&&n<=max;
function budgetConfiguration(env){
  const result={};
  for(const [field,key,max] of [['perCall','HABIT_AI_RESERVATION_MICRO_CNY',100000000],['daily','HABIT_AI_DAY_MICRO_CNY',1000000000000],['monthly','HABIT_AI_MONTH_MICRO_CNY',1000000000000],['perUser','HABIT_AI_USER_DAILY',10]]){
    const raw=env[key];if(typeof raw!=='string'||!/^[1-9]\d*$/.test(raw)||!integer(Number(raw),max))throw Error('AI_BUDGET_CONFIG_REQUIRED');result[field]=Number(raw);
  }
  if(result.perCall>result.daily||result.daily>result.monthly)throw Error('AI_BUDGET_CONFIG_INVALID');return result;
}
function createAiRepository(db){return {transact(owner,work){return db.runTransaction(tx=>work({
  account:()=>readAccount(tx.collection(COLLECTION).doc(owner)),
  requests:()=>read(tx.collection(REQUESTS).doc(owner)),budget:()=>read(tx.collection(BUDGET).doc('global')),
  putRequests:doc=>{const {_id,...data}=doc;return tx.collection(REQUESTS).doc(owner).set({data});},
  putBudget:doc=>{const {_id,...data}=doc;return tx.collection(BUDGET).doc('global').set({data});}
})).then(outcome=>outcome&&typeof outcome.ok==='boolean'?outcome:outcome.result);}};}
function guardAccount(account,epoch){
  if(!account)fail('ACCOUNT_REQUIRED','请先到今日页开始使用');
  if(account.cleanupPending)fail('DELETE_PENDING','个人数据正在删除');
  if(account.epoch!==epoch)fail('EPOCH_CHANGED','账户数据已变化，请重新打开');
}
function createAiApi({repository,inputCore,catalog,dates,allowedAppId,allowedSources,budget,provider,limiter,clock=()=>new Date(),timeoutMs=8500}){
  if(!budget||!integer(budget.perCall)||!integer(budget.daily)||!integer(budget.monthly)||!integer(budget.perUser,10)||
    budget.perCall>budget.daily||budget.daily>budget.monthly||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw Error('AI_BUDGET_CONFIG_REQUIRED');
  return async(event,identity)=>{
    let owner,reserved=false,fingerprint;
    try{
      owner=authenticate(identity,allowedAppId,allowedSources);
      if(!event||Array.isArray(event)||![Object.prototype,null].includes(Object.getPrototypeOf(event))||event.action!=='suggest'||event.consent!==true||
        Object.keys(event).some(k=>!['action','epoch','operationId','operationDate','input','consent'].includes(k))||!token(event.epoch)||!token(event.operationId)||
        Buffer.byteLength(JSON.stringify(event),'utf8')>2048)fail('INVALID_REQUEST','计划请求无效');
      try{dates.assertDate(event.operationDate);}catch(_){fail('INVALID_REQUEST','请求日期无效');}
      if(!event.input||typeof event.input!=='object'||Array.isArray(event.input)||
        Object.keys(event.input).some(k=>!['direction','minutes','weekdays','time'].includes(k))||!Number.isInteger(event.input.minutes))fail('INVALID_REQUEST','计划安排字段无效');
      let input;try{input=inputCore.validateInput(event.input);}catch(_){fail('INVALID_REQUEST','请检查本次计划安排');}
      fingerprint=hash(canonical(event));if(limiter)await limiter(owner,event.epoch);
      const claimed=await repository.transact(owner,async tx=>{
        const now=clock(),day=dates.today(now.getTime()),month=day.slice(0,7);guardAccount(await tx.account(),event.epoch);
        const ledger=await tx.requests()||{schemaVersion:1,owner,ownerEpoch:event.epoch,day,count:0,receipts:[]};
        if(ledger.schemaVersion!==1||ledger.owner!==owner||ledger.ownerEpoch!==event.epoch||typeof ledger.day!=='string'||
          !Number.isInteger(ledger.count)||ledger.count<0||!Array.isArray(ledger.receipts)||ledger.receipts.length>32)throw Error('AI_LEDGER_CORRUPT');
        const prior=ledger.receipts.find(r=>r.id===event.operationId);
        if(prior){
          if(prior.fingerprint!==fingerprint)fail('IDEMPOTENCY_MISMATCH','请勿复用生成请求标识');
          if(prior.status==='succeeded')return {ok:true,selection:prior.selection,replayed:true};
          fail(prior.status==='claimed'?'AI_PENDING':'AI_UNAVAILABLE','上次请求未产生可用建议，不会重复计费；可使用本机规则建议');
        }
        if(event.operationDate!==day||ledger.day>day)fail('RECONFIRM_REQUIRED','日期已变化，请重新选择安排');
        for(const r of ledger.receipts)if(r.status==='claimed'&&Date.parse(r.startedAt)<now.getTime()-90000)r.status='unknown';
        if(ledger.receipts.some(r=>r.status==='claimed'))fail('AI_PENDING','已有生成正在处理，请稍后使用本机规则建议');
        if(ledger.day!==day){ledger.day=day;ledger.count=0;}
        if(ledger.count>=budget.perUser)fail('RATE_LIMITED','今天的AI次数已用完，可使用本机规则建议');
        const total=await tx.budget()||{schemaVersion:1,day,month,dayReserved:0,monthReserved:0};
        if(total.schemaVersion!==1||typeof total.day!=='string'||typeof total.month!=='string'||!Number.isSafeInteger(total.dayReserved)||total.dayReserved<0||
          !Number.isSafeInteger(total.monthReserved)||total.monthReserved<0||total.day>day||total.month>month)throw Error('AI_BUDGET_CORRUPT');
        if(total.day!==day){total.day=day;total.dayReserved=0;}
        if(total.month!==month){total.month=month;total.monthReserved=0;}
        if(total.dayReserved+budget.perCall>budget.daily||total.monthReserved+budget.perCall>budget.monthly)fail('RATE_LIMITED','AI服务本期额度已用完，可使用本机规则建议');
        while(ledger.receipts.length>=32){const index=ledger.receipts.findIndex(r=>r.day<day&&r.status!=='claimed');if(index<0)fail('RATE_LIMITED','AI请求记录已达上限');ledger.receipts.splice(index,1);}
        ledger.count++;ledger.receipts.push({id:event.operationId,fingerprint,day,status:'claimed',startedAt:now.toISOString()});
        total.dayReserved+=budget.perCall;total.monthReserved+=budget.perCall;
        await tx.putRequests(ledger);await tx.putBudget(total);return {ok:true,replayed:false};
      });
      if(claimed.replayed)return {ok:true,source:'ai',moderated:true,safetyMode:'allowlist-v1',operationId:event.operationId,draft:catalog.selectionToDraft(claimed.selection,input),replayed:true};
      reserved=true;
      // No credentials, identity, notes or habits are passed to the provider.
      await repository.transact(owner,async tx=>{guardAccount(await tx.account(),event.epoch);return {ok:true};});
      let timer,selection;
      try{selection=await Promise.race([Promise.resolve().then(()=>provider({direction:input.direction,minutes:input.minutes})),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('AI_UNKNOWN')),timeoutMs);})]);}finally{clearTimeout(timer);}
      const draft=catalog.selectionToDraft(selection,input);
      await repository.transact(owner,async tx=>{
        guardAccount(await tx.account(),event.epoch);const ledger=await tx.requests();
        if(!ledger||ledger.ownerEpoch!==event.epoch)fail('EPOCH_CHANGED','账户数据已变化，请重新打开');
        const receipt=ledger.receipts.find(r=>r.id===event.operationId&&r.fingerprint===fingerprint);
        if(!receipt||receipt.status!=='claimed')fail('AI_UNAVAILABLE','生成结果已失效，请使用本机规则建议');
        receipt.status='succeeded';receipt.selection=selection;await tx.putRequests(ledger);return {ok:true};
      });
      return {ok:true,source:'ai',moderated:true,safetyMode:'allowlist-v1',operationId:event.operationId,draft,replayed:false};
    }catch(err){
      if(reserved)try{await repository.transact(owner,async tx=>{
        const a=await tx.account();if(!a||a.cleanupPending||a.epoch!==event.epoch)return {ok:true};
        const ledger=await tx.requests();if(!ledger||ledger.ownerEpoch!==event.epoch)return {ok:true};
        const receipt=ledger.receipts.find(r=>r.id===event.operationId&&r.fingerprint===fingerprint);
        if(receipt&&receipt.status==='claimed'){receipt.status='unknown';await tx.putRequests(ledger);}return {ok:true};
      });}catch(_){/* Keep claimed. Never retry a potentially billable call. */}
      return err instanceof ApiError?{ok:false,code:err.code,message:err.message}:{ok:false,code:'AI_UNAVAILABLE',message:'AI未生成可用建议，未自动重试；可使用本机规则建议'};
    }
  };
}
module.exports={REQUESTS,BUDGET,budgetConfiguration,createAiRepository,createAiApi};

'use strict';
const crypto = require('node:crypto');
const { reminderId,recipientAAD } = require('./reminders');
const { eligibleNextReminder, templateFor } = require('./next-reminders');
function authorizeTimer(event,identity,secret,triggerName) {
  if (!event || event.Type!=='Timer' || event.TriggerName!==triggerName || typeof triggerName!=='string' ||
    !/^jiancheng_daka_[a-zA-Z0-9_-]{1,45}$/.test(triggerName) || typeof secret!=='string' || !/^[a-f0-9]{64}$/.test(secret) ||
    typeof event.Message!=='string' || !/^[a-f0-9]{64}$/.test(event.Message) ||
    (identity && (identity.OPENID || identity.FROM_OPENID || /wx_client|wx_devtools|http/.test(identity.SOURCE || '')))) return false;
  return crypto.timingSafeEqual(Buffer.from(event.Message,'hex'),Buffer.from(secret,'hex'));
}
function createSender(cloud,options) {
  const {fields,fieldsByType,state,appId}=options;
  if (appId !== undefined && !/^wx[a-f0-9]{16}$/.test(appId)) throw Error('REMINDER_APP_ID_REQUIRED');
  const openapi = appId === undefined ? cloud.openapi : (() => {
    if (typeof cloud.openapi !== 'function') throw Error('CONSUMER_OPENAPI_UNAVAILABLE');
    return cloud.openapi({appid:appId});
  })();
  const configurations = {};
  for (const type of ['self','supervisor']) {
    const templateId = templateFor(options,type),mapping=fieldsByType&&fieldsByType[type]||(type==='self'?fields:null);
    if (!templateId) continue;
    if (!mapping || !/^thing[1-9]\d?$/.test(mapping.text || '') || !/^number[1-9]\d?$/.test(mapping.count || '') ||
      !/^time[1-9]\d?$/.test(mapping.time || '') || !['formal','trial','developer'].includes(state)) throw Error('REMINDER_TEMPLATE_CONFIG_REQUIRED');
    configurations[type]={templateId,fields:mapping};
  }
  if (!Object.keys(configurations).length) throw Error('REMINDER_TEMPLATE_CONFIG_REQUIRED');
  return async ({recipient,count,businessDate,slot,dueAt,type='self'})=>{
    const config=configurations[type];if(!config)throw Error('REMINDER_TEMPLATE_CONFIG_REQUIRED');
    const mapping=config.fields;
    const displayDate=dueAt&&Number.isFinite(Date.parse(dueAt))?new Date(Date.parse(dueAt)+8*3600000).toISOString().slice(0,10):businessDate;
    return openapi.subscribeMessage.send({
      touser:recipient,templateId:config.templateId,page:type==='supervisor'?'pages/supervision/index?tab=supervisor':'pages/today/index',miniprogramState:state,lang:'zh_CN',
      data:{[mapping.text]:{value:type==='supervisor'?'约定事项还有未完成':'还有小目标等待记录'},[mapping.count]:{value:String(count)},[mapping.time]:{value:displayDate+' '+slot}}
    });
  };
}
function createReminderWorker(options) {
  const {repository,domain,dates,codec,send,limiter,templateId,clock=()=>new Date(),timeoutMs=5000,batchSize=20,runBudgetMs=25000}=options;
  if (!Number.isInteger(batchSize)||batchSize<1||batchSize>20||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000||
    !Number.isInteger(runBudgetMs)||runBudgetMs<1||runBudgetMs>50000) throw Error('WORKER_LIMIT_INVALID');
  async function owned(tx,candidate) {
    if (!candidate || typeof candidate.owner!=='string' || !/^[a-f0-9]{64}$/.test(candidate.owner) ||
      reminderId(candidate.owner,candidate.ownerEpoch,candidate.businessDate,candidate.type||'self')!==candidate._id) throw Error('REMINDER_SCOPE_INVALID');
    const doc=await tx.reminder(candidate._id);
    if (doc && (doc.owner!==candidate.owner || doc.ownerEpoch!==candidate.ownerEpoch || doc._id!==candidate._id ||
      reminderId(doc.owner,doc.ownerEpoch,doc.businessDate,doc.type||'self')!==doc._id)) throw Error('REMINDER_OWNER_MISMATCH');return doc;
  }
  const saveState=async(tx,doc,status,now)=>{doc.status=status;doc.updatedAt=now.toISOString();if(status!=='claimed')delete doc.recipient;await tx.put(doc);};
  const eligible=async(tx,doc,now)=>{
    if(doc.schemaVersion===2)return (await eligibleNextReminder(tx,doc,{domain,dates,options,now})).length;
    const account=await tx.account();
    if (!account||account.cleanupPending||account.epoch!==doc.ownerEpoch||doc.businessDate!==dates.today(now.getTime())||
      !Number.isFinite(Date.parse(doc.dueAt))||Date.parse(doc.dueAt)>now.getTime()||now.getTime()-Date.parse(doc.dueAt)>900000||doc.templateId!==templateFor(options,'self')) return 0;
    domain.validateState(account.state);return domain.tasksOn(account.state,doc.businessDate).filter(t=>t.status==='pending').length;
  };
  return async()=>{
    const started=Date.now(),counts={processed:0,sent:0,unknown:0,cancelled:0,failed:0};
    const stale=await repository.stale(clock(),batchSize);
    if (!Array.isArray(stale)||stale.length>batchSize) throw Error('REMINDER_QUERY_INVALID');
    for(const candidate of stale) {
      if(Date.now()-started>=runBudgetMs) break;
      await repository.transact(candidate.owner,async tx=>{
        const doc=await owned(tx,candidate),now=clock();
        if(doc&&doc.status==='claimed'&&Date.parse(doc.claimedAt)<=now.getTime()-300000) {await saveState(tx,doc,'unknown',now);return {ok:true};}return {ok:true};
      });
    }
    const due=await repository.due(clock(),batchSize);
    if (!Array.isArray(due)||due.length>batchSize) throw Error('REMINDER_QUERY_INVALID');
    for(const candidate of due) {
      if(Date.now()-started>=runBudgetMs) break;
      const claim=await repository.transact(candidate.owner,async tx=>{
        const doc=await owned(tx,candidate),now=clock();
        if(!doc||doc.status!=='pending')return {ok:true,claimed:false};
       if(!await eligible(tx,doc,now)){await saveState(tx,doc,'cancelled',now);return {ok:true,claimed:false};}
        doc.claimId=crypto.randomBytes(16).toString('hex');doc.claimedAt=now.toISOString();await saveState(tx,doc,'claimed',now);
        return {ok:true,claimed:true,claimId:doc.claimId};
      });
      if(!claim.claimed)continue;
      let outcome='unknown',timer;
      try {
        if(limiter)await limiter();
        // Re-read after claiming, immediately before the external side effect.
        const check=await repository.transact(candidate.owner,async tx=>{
          const doc=await owned(tx,candidate),now=clock();
          if(!doc||doc.status!=='claimed'||doc.claimId!==claim.claimId)return {ok:true,count:0};
          return {ok:true,count:await eligible(tx,doc,now),doc};
        });
        if(!check.count) outcome='cancelled';
        else {
          const recipient=codec.open(check.doc.recipient,recipientAAD(check.doc));
           const response=await Promise.race([Promise.resolve().then(()=>send({recipient,count:check.count,businessDate:check.doc.businessDate,slot:check.doc.slot,...(check.doc.type?{type:check.doc.type,dueAt:check.doc.dueAt}:{})})),
            new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('SEND_UNKNOWN')),timeoutMs);})]);
          outcome=response && response.errCode===0?'sent':response && Number.isInteger(response.errCode)?'failed':'unknown';
        }
      } catch(_) {outcome='unknown';} finally {clearTimeout(timer);}
      await repository.transact(candidate.owner,async tx=>{
        const doc=await owned(tx,candidate);
        // Never recreate a record deleted by account cleanup.
        if(doc&&doc.status==='claimed'&&doc.claimId===claim.claimId){await saveState(tx,doc,outcome,clock());}return {ok:true};
      });
      counts.processed++;counts[outcome]++;
    }
    return {ok:true,...counts};
  };
}
module.exports={authorizeTimer,createSender,createReminderWorker};

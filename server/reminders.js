'use strict';
const crypto = require('node:crypto');
const { ApiError, fail, token, canonical } = require('./protocol');
const { authenticate, callerIdentity } = require('./identity');
const { read, readAccount } = require('./features-repository');
const { COLLECTION } = require('./cloudbase-repository');
const REMINDERS = 'jiancheng_daka_reminders';
const SLOTS = ['08:00','12:30','20:30'];
const STATES = ['pending','claimed','sent','cancelled','failed','unknown'];
const FIELDS = { previewReminder:['slot'], scheduleReminder:['slot','businessDate','dueAt','sourceRevision','generation','operationId','subscriptionResult'],
  getReminders:[], cancelReminder:['businessDate','generation'] };
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const reminderId = (owner, epoch, date) => hash(owner + ':' + epoch + ':' + date);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
function view(doc) {
  if (!doc || doc.schemaVersion !== 1 || !STATES.includes(doc.status) || !SLOTS.includes(doc.slot) || !Number.isInteger(doc.generation)) throw Error('REMINDER_CORRUPT');
  return { businessDate: doc.businessDate, slot: doc.slot, dueAt: doc.dueAt, generation: doc.generation,
    status: doc.status, updatedAt: doc.updatedAt };
}
function validate(event, dates) {
  if (!event || typeof event.action!=='string' || !own(FIELDS,event.action) || Array.isArray(event) || ![Object.prototype,null].includes(Object.getPrototypeOf(event)) ||
    Buffer.byteLength(JSON.stringify(event),'utf8') > 2048 || Object.keys(event).some(k=>!['action','epoch',...FIELDS[event.action]].includes(k)) || !token(event.epoch)) fail('INVALID_REQUEST','提醒请求无效');
  if (['previewReminder','scheduleReminder'].includes(event.action) && !SLOTS.includes(event.slot)) fail('INVALID_REQUEST','请选择提醒时段');
  if (['scheduleReminder','cancelReminder'].includes(event.action)) {
    try { dates.assertDate(event.businessDate); } catch (_) { fail('INVALID_REQUEST','提醒日期无效'); }
    if (!Number.isInteger(event.generation) || event.generation < 0 || event.generation > 8) fail('INVALID_REQUEST','提醒版本无效');
  }
  if (event.action === 'scheduleReminder' && (event.subscriptionResult !== 'accept' || !token(event.operationId) ||
    !Number.isSafeInteger(event.sourceRevision) || event.sourceRevision < 0 || typeof event.dueAt !== 'string' ||
    !Number.isFinite(Date.parse(event.dueAt)))) fail('INVALID_REQUEST','请先预览并主动授权本次提醒');
}
function nextSchedule(state, slot, now, domain, dates) {
  const today = dates.today(now.getTime());
  for (let i=0;i<7;i++) {
    const day = dates.shift(today,i), due = new Date(day+'T'+slot+':00+08:00');
    if (due.getTime() > now.getTime() + 60000 && domain.tasksOn(state,day).some(t=>t.status === 'pending')) return { businessDate:day, dueAt:due.toISOString() };
  }
  fail('NO_SCHEDULE','未来七天这个时段没有待做安排');
}
function createRecipientCodec(hexKey) {
  if (typeof hexKey !== 'string' || !/^[a-f0-9]{64}$/.test(hexKey)) throw Error('REMINDER_KEY_REQUIRED');
  const key=Buffer.from(hexKey,'hex');
  return {
    seal(openid,aad) { const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(aad));
      return {iv:iv.toString('hex'),data:Buffer.concat([cipher.update(openid,'utf8'),cipher.final()]).toString('hex'),tag:cipher.getAuthTag().toString('hex')}; },
    open(value,aad) {
      if (!value || !/^[a-f0-9]{24}$/.test(value.iv || '') || !/^[a-f0-9]{32}$/.test(value.tag || '') || typeof value.data !== 'string' || !/^[a-f0-9]{2,256}$/.test(value.data)) throw Error('RECIPIENT_INVALID');
      const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(value.iv,'hex'));decipher.setAAD(Buffer.from(aad));decipher.setAuthTag(Buffer.from(value.tag,'hex'));
      const result=Buffer.concat([decipher.update(Buffer.from(value.data,'hex')),decipher.final()]).toString('utf8');
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(result)) throw Error('RECIPIENT_INVALID');return result;
    }
  };
}
const recipientAAD = doc => doc._id + ':' + doc.owner + ':' + doc.ownerEpoch;
function createReminderRepository(db) {
  return {
    transact(owner, work) {
      return db.runTransaction(tx=>work({
        account:()=>readAccount(tx.collection(COLLECTION).doc(owner)),
        reminder:id=>read(tx.collection(REMINDERS).doc(id)),
        put:doc=>{const {_id,expiresAt,...data}=doc;return tx.collection(REMINDERS).doc(_id).set({data:{...data,expiresAt:new Date(expiresAt)}});}
      })).then(outcome=>outcome && typeof outcome.ok==='boolean'?outcome:outcome.result);
    },
    async due(now,limit=20) {const r=await db.collection(REMINDERS).where({status:'pending',dueAt:db.command.lte(now.toISOString())}).orderBy('dueAt','asc').limit(limit).get();return r.data;},
    async stale(now,limit=20) {const r=await db.collection(REMINDERS).where({status:'claimed',claimedAt:db.command.lte(new Date(now.getTime()-300000).toISOString())}).orderBy('claimedAt','asc').limit(limit).get();return r.data;}
  };
}
function createReminderApi({repository,domain,dates,allowedAppId,allowedSources,templateId,codec,limiter,clock=()=>new Date()}) {
  return async (event,identity)=>{
    try {
      const owner=authenticate(identity,allowedAppId,allowedSources);validate(event,dates);
      if (!codec || typeof templateId!=='string' || !/^[a-zA-Z0-9_-]{10,128}$/.test(templateId)) fail('NOT_ENABLED','提醒服务尚未开放');
      if (limiter) await limiter(owner,event.epoch);
      return await repository.transact(owner,async tx=>{
        const now=clock(),account=await tx.account(),day=dates.today(now.getTime());
        if (!account) fail('ACCOUNT_REQUIRED','请先进入今日页开始使用');
        if (account.cleanupPending) fail('DELETE_PENDING','个人数据正在删除');
        if (account.epoch!==event.epoch) fail('EPOCH_CHANGED','账户数据已变化，请重新打开');
        domain.validateState(account.state);
        const readOwn=async date=>{
          const doc=await tx.reminder(reminderId(owner,account.epoch,date));
          if (doc && (doc.owner!==owner || doc.ownerEpoch!==account.epoch || doc.businessDate!==date)) throw Error('REMINDER_OWNER_MISMATCH');return doc;
        };
        if (event.action==='getReminders') {
          const items=[];for(let i=-1;i<7;i++){const doc=await readOwn(dates.shift(day,i));if(doc)items.push(view(doc));}
          return {ok:true,items};
        }
        if (event.action==='previewReminder') {
          const next=nextSchedule(account.state,event.slot,now,domain,dates),doc=await readOwn(next.businessDate);
          if (doc && doc.status!=='cancelled') fail('REMINDER_EXISTS','这一天已有提醒记录，请先查看状态');
          if (doc && doc.generation>=8) fail('RATE_LIMITED','当天重新申请次数已达上限');
          return {ok:true,preview:{...next,slot:event.slot,generation:doc?doc.generation:0,sourceRevision:account.revision,
            operationId:crypto.randomBytes(24).toString('hex'),templateId}};
        }
        if (event.businessDate < dates.shift(day,-1) || event.businessDate > dates.shift(day,6)) fail('RECONFIRM_REQUIRED','提醒日期已变化，请重新预览');
        const id=reminderId(owner,account.epoch,event.businessDate),doc=await readOwn(event.businessDate);
        if (event.action==='cancelReminder') {
          if (!doc) fail('REMINDER_UNAVAILABLE','没有可取消的提醒');
          if (doc.generation!==event.generation) fail('CONFLICT','提醒已变化，请刷新');
          if (doc.status==='cancelled') return {ok:true,reminder:view(doc)};
          if (doc.status!=='pending') fail('ALREADY_PROCESSING','提醒已处理或正在发送，不能撤回在途消息');
          doc.status='cancelled';doc.updatedAt=now.toISOString();delete doc.recipient;
          await tx.put(doc);return {ok:true,reminder:view(doc)};
        }
        const fingerprint=hash(canonical(event));
        if (doc && (!Array.isArray(doc.receipts)||doc.receipts.length>8)) throw Error('REMINDER_RECEIPTS_CORRUPT');
        const previous=doc && doc.receipts.find(r=>r.operationId===event.operationId);
        if (previous) {
          if (previous.fingerprint!==fingerprint) fail('IDEMPOTENCY_MISMATCH','请勿复用提醒请求标识');
          return {ok:true,reminder:view(doc),replayed:true};
        }
        if (doc && doc.status!=='cancelled') fail('REMINDER_EXISTS','这一天已有提醒记录，请先查看状态');
        if ((doc?doc.generation:0)!==event.generation || event.generation>=8) fail('CONFLICT','提醒状态已变化，请重新预览');
        const next=nextSchedule(account.state,event.slot,now,domain,dates);
        if (next.businessDate!==event.businessDate || next.dueAt!==event.dueAt || account.revision!==event.sourceRevision) fail('PREVIEW_CHANGED','计划或时间已变化，请重新预览并授权');
        const created={_id:id,schemaVersion:1,owner,ownerEpoch:account.epoch,...next,slot:event.slot,generation:event.generation+1,
          templateId,status:'pending',acceptedReportedAt:now.toISOString(),claimedAt:null,updatedAt:now.toISOString(),
          expiresAt:new Date(Date.parse(next.dueAt)+14*86400000).toISOString(),receipts:[...(doc?doc.receipts:[]),{operationId:event.operationId,fingerprint}]};
        created.recipient=codec.seal(callerIdentity(identity).OPENID,recipientAAD(created));
        await tx.put(created);return {ok:true,reminder:view(created),replayed:false};
      });
    } catch(err) {return err instanceof ApiError?{ok:false,code:err.code,message:err.message}:{ok:false,code:'SERVICE_UNAVAILABLE',message:'提醒服务暂不可用，请稍后重试'};}
  };
}
module.exports={REMINDERS,SLOTS,STATES,FIELDS,view,reminderId,recipientAAD,createRecipientCodec,createReminderRepository,createReminderApi};

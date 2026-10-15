'use strict';
const crypto = require('node:crypto');
const { ApiError, fail, token, canonical } = require('./protocol');
const { authenticate, callerIdentity } = require('./identity');
const { hash } = require('./supervision-repository');
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const clone = value => JSON.parse(JSON.stringify(value));
const time = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const FIELDS = {
  createSupervisionInvite: ['operationId','habitId','durationDays','deadline','photoRequired','displayName'],
  getSupervisionInvite: ['inviteId'], applySupervision: ['operationId','inviteId','displayName'],
  confirmSupervision: ['operationId','inviteId'], listSupervisions: [], getSupervision: ['supervisionId'],
  endSupervision: ['operationId','supervisionId','expectedRevision'],
  updateSupervision: ['operationId','supervisionId','expectedRevision','deadline','photoRequired'],
  encourageSupervision: ['operationId','supervisionId','date','kind']
};
function validate(event, dates) {
  if (!event || Array.isArray(event) || ![Object.prototype,null].includes(Object.getPrototypeOf(event)) || !own(FIELDS,event.action) ||
    Object.keys(event).some(key => !['action','epoch',...FIELDS[event.action]].includes(key)) || !token(event.epoch) || Buffer.byteLength(JSON.stringify(event)) > 4096) fail('INVALID_REQUEST','监督请求无效');
  if (event.action !== 'listSupervisions' && !event.action.startsWith('get') && !token(event.operationId)) fail('INVALID_REQUEST','请求标识无效');
  if (own(event,'inviteId') && !hex(event.inviteId) || own(event,'supervisionId') && !hex(event.supervisionId)) fail('INVALID_REQUEST','监督标识无效');
  if (event.action === 'createSupervisionInvite' && (!token(event.habitId) || event.durationDays !== undefined && ![7,14,30].includes(event.durationDays))) fail('INVALID_REQUEST','请选择习惯与监督期限');
  if (own(event,'deadline') && !time(event.deadline) || own(event,'photoRequired') && typeof event.photoRequired !== 'boolean') fail('INVALID_REQUEST','约定规则无效');
  if (own(event,'displayName') && (typeof event.displayName !== 'string' || Array.from(event.displayName.trim()).length > 12 || /[\u0000-\u001f]/.test(event.displayName))) fail('INVALID_REQUEST','称呼最多12个字');
  if (['updateSupervision','endSupervision'].includes(event.action) && (!Number.isSafeInteger(event.expectedRevision) || event.expectedRevision < 1)) fail('INVALID_REQUEST','监督版本无效');
  if (event.action === 'updateSupervision' && event.deadline === undefined && event.photoRequired === undefined) fail('INVALID_REQUEST','请选择要修改的约定');
  if (event.action === 'encourageSupervision') { try { dates.assertDate(event.date); } catch (_) { fail('INVALID_REQUEST','鼓励日期无效'); } if (event.kind !== 'encourage') fail('INVALID_REQUEST','请选择固定鼓励'); }
}
function accountReady(account, epoch) {
  if (!account) fail('ACCOUNT_REQUIRED','请先进入今日页开始使用');
  if (account.cleanupPending) fail('DELETE_PENDING','个人数据正在删除');
  if (account.epoch !== epoch) fail('EPOCH_CHANGED','账户已变化，请重新打开');
}
function indexFor(doc, owner, epoch) {
  if (!doc || doc.ownerEpoch !== epoch) return { _id:owner,owner,ownerEpoch:epoch,relationIds:[],inviteIds:[],receipts:[] };
  if (doc.owner !== owner || !Array.isArray(doc.relationIds) || !Array.isArray(doc.inviteIds) || !Array.isArray(doc.receipts) ||
    doc.relationIds.length > 200 || doc.inviteIds.length > 200 || doc.receipts.length > 128 || [...doc.relationIds,...doc.inviteIds].some(id => !hex(id))) throw Error('SUPERVISION_INDEX_CORRUPT');
  return doc;
}
function rulesAt(relation, date) {
  if (!relation || !Array.isArray(relation.rules) || !relation.rules.length || relation.rules.some(rule => !rule || !time(rule.deadline) || typeof rule.photoRequired !== 'boolean' || !/^\d{4}-\d{2}-\d{2}$/.test(rule.effectiveDate))) throw Error('SUPERVISION_RULES_CORRUPT');
  const rule = relation.rules.filter(item => item.effectiveDate <= date).slice(-1)[0];
  return rule ? { deadline:rule.deadline,photoRequired:rule.photoRequired } : { deadline:'21:00',photoRequired:false };
}
function member(relation, owner, epoch) {
  if (!relation || relation.schemaVersion !== 1 || !hex(relation._id) || !hex(relation.subjectOwner) || !hex(relation.supervisorOwner) ||
    relation.subjectOwner === relation.supervisorOwner || !token(relation.subjectEpoch) || !token(relation.supervisorEpoch) || !token(relation.habitId) ||
    !['active','ended'].includes(relation.status) || !Number.isSafeInteger(relation.revision) || relation.revision < 1) fail('SUPERVISION_UNAVAILABLE','这份约定已不可用');
  if (relation.subjectOwner === owner && relation.subjectEpoch === epoch) return 'subject';
  if (relation.supervisorOwner === owner && relation.supervisorEpoch === epoch) return 'supervisor';
  fail('SUPERVISION_UNAVAILABLE','这份约定已不可用');
}
async function liveRelation(tx, relation, date, domain, dates) {
  if (!relation || relation.status !== 'active') return null;
  dates.assertDate(relation.startDate); dates.assertDate(relation.endDate);
  if (date < relation.startDate || date > relation.endDate) return null;
  const subject = await tx.account(relation.subjectOwner), supervisor = await tx.account(relation.supervisorOwner);
  if (!subject || !supervisor || subject.cleanupPending || supervisor.cleanupPending || subject.epoch !== relation.subjectEpoch || supervisor.epoch !== relation.supervisorEpoch) return null;
  domain.validateState(subject.state); domain.validateState(supervisor.state);
  const habit = subject.state.habits.find(item => item.id === relation.habitId);
  if (!habit) return null;
  return { subject,supervisor,habit,task:domain.taskAt(subject.state,habit,date),rules:rulesAt(relation,date) };
}
async function activeForHabit(tx, account, habitId, date, domain, dates) {
  const index = indexFor(await tx.supervisionIndex(),tx.owner,account.epoch);
  for (const id of index.relationIds) {
    const relation = await tx.supervision(id);
    if (relation && relation.subjectOwner === tx.owner && relation.subjectEpoch === account.epoch && relation.habitId === habitId) {
      const live = await liveRelation(tx,relation,date,domain,dates); if (live) return { relation,...live };
    }
  }
  return null;
}
async function reservedForHabit(tx,account,habitId,date,domain,dates) {
  const index = indexFor(await tx.supervisionIndex(),tx.owner,account.epoch);
  for (const id of index.relationIds) {
    const relation = await tx.supervision(id);
    if (relation && relation.status === 'active' && relation.subjectOwner === tx.owner && relation.subjectEpoch === account.epoch && relation.habitId === habitId && relation.endDate >= date &&
      await liveRelation(tx,relation,date < relation.startDate ? relation.startDate : date,domain,dates)) return relation;
  }
  return null;
}
async function dayView(tx, relation, date, live) {
  const binding = await tx.binding(relation.subjectOwner,relation.subjectEpoch,relation.habitId,date);
  const ids = binding && !binding.revokedAt ? binding.mediaIds : [], photos = [];
  if (!Array.isArray(ids) || ids.length > 3) throw Error('MEDIA_BINDING_CORRUPT');
  for (const id of ids) {
    const media = await tx.media(id);
    if (media && media.owner === relation.subjectOwner && media.ownerEpoch === relation.subjectEpoch && media.habitId === relation.habitId && media.date === date && media.bound && !media.deleteRequested) photos.push(media);
  }
  const encouragement = (relation.encouragements || []).find(item => item.date === date);
  return { date,status:live.task ? live.task.status : 'not-planned',planned:Boolean(live.task),deadline:live.rules.deadline,
    photoRequired:live.rules.photoRequired,photoCount:photos.filter(item => item.status === 'pass').length,
    photosPending:photos.some(item => item.status === 'pending'),photosUnavailable:photos.some(item => ['review','risky','failed'].includes(item.status)),
    encouraged:Boolean(encouragement),encouragedAt:encouragement ? encouragement.createdAt : null };
}
async function relationView(tx, relation, owner, epoch, now, domain, dates) {
  const role = member(relation,owner,epoch), day = dates.today(now.getTime()), live = await liveRelation(tx,relation,day,domain,dates);
  const scheduled = day < relation.startDate && await liveRelation(tx,relation,relation.startDate,domain,dates);
  const status = relation.status === 'ended' ? 'ended' : day > relation.endDate ? 'expired' : live ? 'active' : scheduled ? 'scheduled' : 'unavailable';
  const result = { supervisionId:relation._id,role,status,revision:relation.revision,startDate:relation.startDate,endDate:relation.endDate,
    subjectName:relation.subjectName || '打卡人',supervisorName:relation.supervisorName || '监督者',rules:rulesAt(relation,scheduled ? relation.startDate : day),today:null };
  if (live || scheduled) {
    const plan = domain.versionAt((live || scheduled).habit,scheduled ? relation.startDate : day);
    result.habitId = role === 'subject' ? relation.habitId : undefined; result.title = plan ? plan.title : '习惯';
    if (plan) result.habitPlan = {target:plan.target,minimum:plan.minimum,unit:plan.unit,time:plan.time,weekdays:[...plan.weekdays]};
    if (live) result.today = await dayView(tx,relation,day,live);
    const future = relation.rules.find(item => item.effectiveDate > day);
    if (future) result.pendingRules = clone(future);
  } else result.title = '监督约定';
  return result;
}
function inviteView(invite, now) {
  if (!invite || invite.schemaVersion !== 1 || !hex(invite._id) || !Number.isFinite(Date.parse(invite.expiresAt)) || !['open','applied','confirmed','closed'].includes(invite.status)) fail('INVITE_UNAVAILABLE','邀请已失效');
  return { inviteId:invite._id,status:Date.parse(invite.expiresAt) <= now.getTime() && invite.status !== 'confirmed' ? 'expired' : invite.status,
    expiresAt:invite.expiresAt,habit:clone(invite.habit),rules:clone(invite.rules),subjectName:invite.subjectName,
    ...(invite.applicant ? { applicant:{displayName:invite.applicant.displayName} } : {}) };
}
async function listReminderRelations(tx,{supervisor,supervisorEpoch,relationIds,businessDate,now,domain,dates}) {
  const recipient = await tx.account(supervisor);
  if (!recipient || recipient.cleanupPending || recipient.epoch !== supervisorEpoch) return [];
  const index = indexFor(await tx.supervisionIndex(supervisor),supervisor,supervisorEpoch);
  const selected = relationIds || index.relationIds;
  if (!Array.isArray(selected) || selected.length > 100 || selected.some(id => !hex(id)) || new Set(selected).size !== selected.length) fail('INVALID_REQUEST','监督范围无效');
  const result = [];
  for (const id of selected) {
    if (!index.relationIds.includes(id)) continue;
    const relation = await tx.supervision(id);
    if (!relation || relation.supervisorOwner !== supervisor || relation.supervisorEpoch !== supervisorEpoch) continue;
    const live = await liveRelation(tx,relation,businessDate,domain,dates);
    if (!live || !live.task) continue;
    result.push({ relationId:id,revision:relation.revision,subjectOwner:relation.subjectOwner,subjectEpoch:relation.subjectEpoch,
      habitId:relation.habitId,deadline:live.rules.deadline,graceMinutes:15,title:live.task.title,status:live.task.status,planRevision:live.task.versionRevision });
  }
  return result;
}
function createSupervisionApi({repository,domain,dates,allowedAppId,allowedSources,limiter,checkText,clock=()=>new Date()}) {
  return async (event,identity) => {
    try {
      const owner = authenticate(identity,allowedAppId,allowedSources); validate(event,dates);
      if (limiter) await limiter(owner,event.epoch);
      let displayName = event.action === 'createSupervisionInvite' ? '打卡人' : '监督者';
      if (event.displayName && event.displayName.trim() && typeof checkText === 'function') {
        if (await checkText(event.displayName.trim(),callerIdentity(identity).OPENID) !== true) fail('CONTENT_REJECTED','请换一个称呼');
        displayName = event.displayName.trim();
      }
      return await repository.transact(owner,async tx => {
        const now = clock(),day = dates.today(now.getTime()),account = await tx.account(); accountReady(account,event.epoch); domain.validateState(account.state);
        const index = indexFor(await tx.supervisionIndex(),owner,account.epoch),fingerprint = hash(canonical(event));
        const prior = event.operationId && index.receipts.find(item => item.id === event.operationId);
        if (prior) {
          if (prior.fingerprint !== fingerprint) fail('IDEMPOTENCY_MISMATCH','请勿复用请求标识');
          const result = clone(prior.result);
          if (result.invite) {
            const invite = await tx.invite(result.invite.inviteId),subject = invite && await tx.account(invite.subjectOwner);
            if (!invite || !subject || subject.cleanupPending || subject.epoch !== invite.subjectEpoch || !subject.state.habits.some(item => item.id === invite.habitId) ||
              invite.status === 'closed' || invite.status !== 'confirmed' && Date.parse(invite.expiresAt) <= now.getTime()) fail('INVITE_UNAVAILABLE','邀请已失效');
            if (invite.status === 'confirmed') {
              const relation = await tx.supervision(invite.supervisionId);
              if (!relation || !(await liveRelation(tx,relation,day < relation.startDate ? relation.startDate : day,domain,dates))) fail('INVITE_UNAVAILABLE','邀请对应的约定已不可用');
            }
            result.invite = inviteView(invite,now);
          }
          if (result.supervision) {
            const relation = await tx.supervision(result.supervision.supervisionId);
            result.supervision = await relationView(tx,relation,owner,account.epoch,now,domain,dates);
          }
          if (result.encouragement) {
            const relation = await tx.supervision(event.supervisionId);
            member(relation,owner,account.epoch);
            if (!await liveRelation(tx,relation,day,domain,dates)) fail('SUPERVISION_UNAVAILABLE','这份约定已不可用');
          }
          return { ...result,replayed:true };
        }
        const persist = async result => {
          index.receipts.push({id:event.operationId,fingerprint,result:clone(result),...(event.supervisionId ? {scopeRelationId:event.supervisionId}: {})}); index.receipts = index.receipts.slice(-128);
          await tx.putSupervisionIndex(index); return { ...result,replayed:false };
        };
        if (event.action === 'createSupervisionInvite') {
          const habit = account.state.habits.find(item => item.id === event.habitId),plan = habit && domain.versionAt(habit,day);
          if (!plan || plan.status !== 'active') fail('HABIT_UNAVAILABLE','请选择进行中的习惯');
          if (await reservedForHabit(tx,account,event.habitId,day,domain,dates)) fail('SUPERVISION_EXISTS','这个习惯已有监督者');
          let activeInvites = 0;
          for (const id of index.inviteIds) { const other = await tx.invite(id); if (other && other.subjectOwner === owner && other.subjectEpoch === account.epoch && other.habitId === event.habitId && ['open','applied'].includes(other.status) && Date.parse(other.expiresAt) > now.getTime()) activeInvites++; }
          if (activeInvites || index.inviteIds.length >= 200) fail('INVITE_EXISTS','请先处理已有邀请');
          const invite = { _id:crypto.randomBytes(32).toString('hex'),schemaVersion:1,subjectOwner:owner,subjectEpoch:account.epoch,habitId:event.habitId,status:'open',
            createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+48*3600000).toISOString(),subjectName:displayName,
            habit:{title:plan.title,target:plan.target,minimum:plan.minimum,unit:plan.unit,weekdays:[...plan.weekdays]},
            rules:{durationDays:event.durationDays || 7,deadline:event.deadline || '21:00',photoRequired:event.photoRequired === true} };
          await tx.putInvite(invite); index.inviteIds.unshift(invite._id); return persist({ok:true,invite:inviteView(invite,now)});
        }
        if (['getSupervisionInvite','applySupervision','confirmSupervision'].includes(event.action)) {
          const invite = await tx.invite(event.inviteId);
          if (!invite || !hex(invite.subjectOwner) || !token(invite.subjectEpoch)) fail('INVITE_UNAVAILABLE','邀请已失效');
          const subject = await tx.account(invite.subjectOwner);
          if (!subject || subject.cleanupPending || subject.epoch !== invite.subjectEpoch || !subject.state.habits.some(item => item.id === invite.habitId)) fail('INVITE_UNAVAILABLE','邀请已失效');
          const view = inviteView(invite,now),isSubject = invite.subjectOwner === owner && invite.subjectEpoch === account.epoch;
          if (event.action === 'getSupervisionInvite') return {ok:true,invite:{...view,...(!isSubject ? {applicant:undefined} : {})},canApply:!isSubject && view.status === 'open',canConfirm:isSubject && view.status === 'applied'};
          if (view.status === 'expired' || invite.status === 'closed') fail('INVITE_EXPIRED','邀请已到期');
          if (event.action === 'applySupervision') {
            if (isSubject) fail('INVALID_REQUEST','不能监督自己');
            if (invite.applicant && (invite.applicant.owner !== owner || invite.applicant.epoch !== account.epoch)) fail('INVITE_APPLIED','已有申请，请等待本人确认');
            if (invite.status === 'confirmed') fail('INVITE_CLOSED','这份邀请已确认');
            invite.applicant = {owner,epoch:account.epoch,displayName,appliedAt:now.toISOString()}; invite.status = 'applied';
            await tx.putInvite(invite); if (!index.inviteIds.includes(invite._id)) index.inviteIds.unshift(invite._id);
            return persist({ok:true,invite:inviteView(invite,now),status:'applied'});
          }
          if (!isSubject) fail('INVITE_UNAVAILABLE','只有本人可以确认监督者');
          if (invite.status === 'confirmed') {
            const existing = await tx.supervision(invite.supervisionId); member(existing,owner,account.epoch);
            return persist({ok:true,supervision:await relationView(tx,existing,owner,account.epoch,now,domain,dates)});
          }
          if (!invite.applicant || invite.status !== 'applied') fail('NO_APPLICANT','还没有监督申请');
          const supervisor = await tx.account(invite.applicant.owner); accountReady(supervisor,invite.applicant.epoch);
          const plan = domain.versionAt(subject.state.habits.find(item => item.id === invite.habitId),day);
          if (!plan || plan.status !== 'active') fail('HABIT_UNAVAILABLE','习惯已暂停或归档');
          if (await reservedForHabit(tx,account,invite.habitId,day,domain,dates)) fail('SUPERVISION_EXISTS','这个习惯已有监督者');
          if (index.relationIds.length >= 200) fail('CAPACITY_LIMIT','监督记录已达上限');
          const existingRecord = subject.state.records[invite.habitId+'@'+day],startDate = existingRecord && existingRecord.status !== 'pending' ? dates.shift(day,1) : day;
          const relation = { _id:hash(owner+':'+account.epoch+':'+invite._id),schemaVersion:1,status:'active',subjectOwner:owner,subjectEpoch:account.epoch,
            supervisorOwner:invite.applicant.owner,supervisorEpoch:invite.applicant.epoch,habitId:invite.habitId,subjectName:invite.subjectName,supervisorName:invite.applicant.displayName,
            revision:1,startDate,endDate:dates.shift(startDate,invite.rules.durationDays-1),createdAt:now.toISOString(),
            rules:[{effectiveDate:startDate,deadline:invite.rules.deadline,photoRequired:invite.rules.photoRequired}],encouragements:[] };
          const otherIndex = indexFor(await tx.supervisionIndex(relation.supervisorOwner),relation.supervisorOwner,relation.supervisorEpoch);
          if (otherIndex.relationIds.length >= 200) fail('CAPACITY_LIMIT','监督记录已达上限');
          index.relationIds.unshift(relation._id); otherIndex.relationIds.unshift(relation._id);
          invite.status = 'confirmed'; invite.supervisionId = relation._id;
          await tx.putSupervision(relation); await tx.putInvite(invite); await tx.putSupervisionIndex(otherIndex);
          return persist({ok:true,supervision:await relationView(tx,relation,owner,account.epoch,now,domain,dates)});
        }
        if (event.action === 'listSupervisions') {
          const items = [],invitations = [];
          for (const id of index.relationIds) { const relation = await tx.supervision(id); if (relation) items.push(await relationView(tx,relation,owner,account.epoch,now,domain,dates)); }
          for (const id of index.inviteIds) { const invite = await tx.invite(id); if (!invite || !['open','applied'].includes(invite.status) || Date.parse(invite.expiresAt) <= now.getTime()) continue;
            const subject = await tx.account(invite.subjectOwner); if (!subject || subject.cleanupPending || subject.epoch !== invite.subjectEpoch) continue;
            invitations.push({...inviteView(invite,now),role:invite.subjectOwner === owner ? 'subject':'supervisor'}); }
          items.sort((a,b) => { const rank = item => item.today && item.today.status === 'pending' ? (now.getTime() > Date.parse(day+'T'+item.today.deadline+':00+08:00') ? 0:1) : item.today && item.today.planned ? 2:3; return rank(a)-rank(b); });
          return {ok:true,items,invitations};
        }
        const relation = await tx.supervision(event.supervisionId),role = member(relation,owner,account.epoch);
        const live = await liveRelation(tx,relation,day,domain,dates);
        if (event.action === 'getSupervision') {
          if (!live) {
            const view = await relationView(tx,relation,owner,account.epoch,now,domain,dates);
            if (view.status === 'scheduled') return {ok:true,supervision:view,days:[],today:null};
            fail('SUPERVISION_UNAVAILABLE','这份约定已结束或不可用');
          }
          const days = []; for (const date of dates.range(day,Math.min(30,Math.floor((Date.parse(day)-Date.parse(relation.startDate))/86400000)+1))) {
            const historical = await liveRelation(tx,relation,date,domain,dates); if (historical) days.push(await dayView(tx,relation,date,historical));
          }
          const supervision = await relationView(tx,relation,owner,account.epoch,now,domain,dates); return {ok:true,supervision,days,today:supervision.today};
        }
        if (event.action === 'endSupervision') {
          if (relation.status !== 'ended' && relation.revision !== event.expectedRevision) fail('CONFLICT','约定已更新，请刷新');
          if (relation.status !== 'ended') { relation.status = 'ended'; relation.revision++; relation.endedAt = now.toISOString(); await tx.putSupervision(relation); }
          return persist({ok:true,supervision:await relationView(tx,relation,owner,account.epoch,now,domain,dates)});
        }
        if (event.action === 'updateSupervision') {
          if (!live && !(day < relation.startDate && await liveRelation(tx,relation,relation.startDate,domain,dates))) fail('SUPERVISION_UNAVAILABLE','这份约定已结束或不可用');
          if (role !== 'subject') fail('FORBIDDEN','只有本人可以修改约定');
          if (relation.revision !== event.expectedRevision) fail('CONFLICT','约定已更新，请刷新');
          const effectiveDate = dates.shift(day,1); if (effectiveDate > relation.endDate) fail('AGREEMENT_ENDING','约定即将结束');
          const rules = {...rulesAt(relation,effectiveDate),...(event.deadline === undefined ? {}:{deadline:event.deadline}),...(event.photoRequired === undefined ? {}:{photoRequired:event.photoRequired})};
          relation.rules = relation.rules.filter(item => item.effectiveDate !== effectiveDate); relation.rules.push({effectiveDate,...rules}); relation.revision++;
          await tx.putSupervision(relation); return persist({ok:true,supervision:await relationView(tx,relation,owner,account.epoch,now,domain,dates)});
        }
        if (!live) fail('SUPERVISION_UNAVAILABLE','这份约定已结束或不可用');
        if (role !== 'supervisor') fail('FORBIDDEN','由监督者送出鼓励');
        const target = await liveRelation(tx,relation,event.date,domain,dates);
        if (event.date > day || !target || !target.task || target.task.status === 'pending') fail('NOT_COMPLETED','完成后才可以送出鼓励');
        if (!Array.isArray(relation.encouragements) || relation.encouragements.length > 30) throw Error('ENCOURAGEMENTS_CORRUPT');
        let encouragement = relation.encouragements.find(item => item.date === event.date);
        if (!encouragement) { encouragement = {date:event.date,kind:'encourage',createdAt:now.toISOString()}; relation.encouragements.push(encouragement); await tx.putSupervision(relation); }
        return persist({ok:true,encouragement});
      });
    } catch (err) { return err instanceof ApiError ? {ok:false,code:err.code,message:err.message} : {ok:false,code:'SERVICE_UNAVAILABLE',message:'监督服务暂不可用，请保留页面后重试'}; }
  };
}
module.exports = { FIELDS,hex,time,accountReady,indexFor,rulesAt,member,liveRelation,activeForHabit,reservedForHabit,dayView,listReminderRelations,createSupervisionApi };

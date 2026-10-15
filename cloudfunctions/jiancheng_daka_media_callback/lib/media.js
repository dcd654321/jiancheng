'use strict';
const crypto = require('node:crypto');
const { ApiError,fail,token,canonical } = require('./protocol');
const { authenticate,callerIdentity } = require('./identity');
const { hash,bindingId } = require('./supervision-repository');
const { hex,accountReady,indexFor,member,liveRelation,activeForHabit } = require('./supervision');
const { MAX_BYTES } = require('./media-provider');
const own = (object,key) => Object.prototype.hasOwnProperty.call(object,key);
const copy = value => JSON.parse(JSON.stringify(value));
const FIELDS = { prepareMedia:['operationId','habitId','date','mimeType'],confirmMedia:['operationId','mediaId','fileId'],
  getRecordMedia:['habitId','supervisionId','date'],updateRecordMedia:['operationId','habitId','date','expectedRevision','mediaIds','confirmation'] };
function idsValid(ids) { return Array.isArray(ids) && ids.length <= 3 && ids.every(hex) && new Set(ids).size === ids.length; }
function validate(event,dates) {
  if (!event || Array.isArray(event) || ![Object.prototype,null].includes(Object.getPrototypeOf(event)) || !own(FIELDS,event.action) || !token(event.epoch) ||
    Object.keys(event).some(key => !['action','epoch',...FIELDS[event.action]].includes(key)) || Buffer.byteLength(JSON.stringify(event)) > 4096) fail('INVALID_REQUEST','照片请求无效');
  if (event.action !== 'getRecordMedia' && !token(event.operationId)) fail('INVALID_REQUEST','照片请求标识无效');
  if (own(event,'date')) { try { dates.assertDate(event.date); } catch (_) { fail('INVALID_REQUEST','照片日期无效'); } }
  if (event.action !== 'confirmMedia' && event.date === undefined || own(event,'habitId') && !token(event.habitId) || own(event,'supervisionId') && !hex(event.supervisionId)) fail('INVALID_REQUEST','照片范围无效');
  if (event.action === 'prepareMedia' && (!token(event.habitId) || !['image/jpeg','image/png'].includes(event.mimeType))) fail('INVALID_REQUEST','请选择JPG或PNG照片');
  if (event.action === 'confirmMedia' && (!hex(event.mediaId) || typeof event.fileId !== 'string' || event.fileId.length > 512)) fail('INVALID_REQUEST','照片文件标识无效');
  if (event.action === 'getRecordMedia' && Boolean(event.habitId) === Boolean(event.supervisionId)) fail('INVALID_REQUEST','请选择一个照片范围');
  if (event.action === 'updateRecordMedia' && (!token(event.habitId) || !idsValid(event.mediaIds) || !Number.isSafeInteger(event.expectedRevision) || event.expectedRevision < 0 ||
    event.confirmation !== undefined && event.confirmation !== 'REMOVE_LAST_PHOTO_AND_UNDO')) fail('INVALID_REQUEST','照片修改请求无效');
}
function validateAsset(media,owner,epoch,habitId,date) {
  if (!media || media.schemaVersion !== 1 || !hex(media._id) || media.owner !== owner || media.ownerEpoch !== epoch || media.habitId !== habitId || media.date !== date ||
    media.uploaded !== true || media.metadataVerified !== true || !['pending','pass','review','risky','failed'].includes(media.status) || media.deleteRequested ||
    !Number.isInteger(media.bytes) || media.bytes < 8 || media.bytes > MAX_BYTES || !['image/jpeg','image/png'].includes(media.mimeType)) fail('MEDIA_UNAVAILABLE','照片尚未确认或不属于这次打卡');
  return media;
}
async function replaceBinding(tx,account,habitId,date,mediaIds,now) {
  const old = await tx.binding(tx.owner,account.epoch,habitId,date);
  if (old && (old.owner !== tx.owner || old.ownerEpoch !== account.epoch || old.habitId !== habitId || old.date !== date || !idsValid(old.mediaIds))) throw Error('MEDIA_BINDING_CORRUPT');
  const selected = [];
  for (const id of mediaIds) {
    const media = validateAsset(await tx.media(id),tx.owner,account.epoch,habitId,date),record = account.state.records[habitId+'@'+date];
    if (['review','risky','failed'].includes(media.status) && !(old && old.mediaIds.includes(id) && media.bound && record && record.status !== 'pending')) fail('MEDIA_CHECK_REJECTED','请更换未通过检查的照片');
    selected.push(media);
  }
  for (const id of old ? old.mediaIds : []) {
    if (mediaIds.includes(id)) continue;
    const media = await tx.media(id);
    if (media && media.owner === tx.owner && media.ownerEpoch === account.epoch && media.habitId === habitId && media.date === date) {
      media.bound = false; media.orphanedAt = now.toISOString(); media.updatedAt = now.toISOString(); await tx.putMedia(media);
    }
  }
  for (const media of selected) { media.bound = true; media.boundAt = now.toISOString(); media.validatedAt = now.toISOString(); media.orphanedAt = null; media.updatedAt = now.toISOString(); await tx.putMedia(media); }
  const binding = { _id:bindingId(tx.owner,account.epoch,habitId,date),schemaVersion:1,owner:tx.owner,ownerEpoch:account.epoch,habitId,date,
    mediaIds:[...mediaIds],revision:old ? old.revision+1 : 1,updatedAt:now.toISOString(),revokedAt:mediaIds.length ? null : now.toISOString() };
  await tx.putBinding(binding); return binding;
}
function createRecordMutationGuard({domain,dates}) {
  return async function guardRecordMutation(tx,account,command,day,now) {
    if (!command || !['complete','completeMinimum','undo','deleteHabit','purge'].includes(command.type)) return;
    if (!tx || typeof tx.supervisionIndex !== 'function' || !hex(tx.owner)) throw Error('RECORD_GUARD_TRANSACTION_REQUIRED');
    if (command.type === 'purge' || command.type === 'deleteHabit') {
      const index = indexFor(await tx.supervisionIndex(),tx.owner,account.epoch);
      for (const id of index.relationIds) {
        const relation = await tx.supervision(id);
        if (!relation || relation.status !== 'active') continue;
        const belongs = relation.subjectOwner === tx.owner && relation.subjectEpoch === account.epoch;
        const supervises = relation.supervisorOwner === tx.owner && relation.supervisorEpoch === account.epoch;
        if (command.type === 'purge' && (belongs || supervises) || command.type === 'deleteHabit' && belongs && relation.habitId === command.id) {
          relation.status = 'ended'; relation.endedAt = now.toISOString(); relation.revision++; await tx.putSupervision(relation);
        }
      }
      return;
    }
    if (command.type === 'undo') { await replaceBinding(tx,account,command.id,day,[],now); return; }
    const binding = await tx.binding(tx.owner,account.epoch,command.id,day);
    const mediaIds = command.mediaIds === undefined ? binding && !binding.revokedAt ? binding.mediaIds : [] : command.mediaIds;
    if (!idsValid(mediaIds)) fail('INVALID_REQUEST','每次最多选择3张照片');
    const agreement = await activeForHabit(tx,account,command.id,day,domain,dates);
    if (agreement && agreement.rules.photoRequired && !mediaIds.length) fail('PHOTO_REQUIRED','这次约定需要至少一张已上传照片');
    if (mediaIds.length || binding) await replaceBinding(tx,account,command.id,day,mediaIds,now);
  };
}
async function mediaSelection(tx,event,account,now,domain,dates) {
  let owner = tx.owner,epoch = account.epoch,habitId = event.habitId,supervisor = false,photoRequired = false,relation;
  if (event.supervisionId) {
    relation = await tx.supervision(event.supervisionId); const role = member(relation,tx.owner,account.epoch);
    const todayLive = await liveRelation(tx,relation,dates.today(now.getTime()),domain,dates),live = await liveRelation(tx,relation,event.date,domain,dates);
    if (!todayLive || !live || event.date > dates.today(now.getTime())) fail('MEDIA_UNAVAILABLE','这一天的照片不可访问');
    owner = relation.subjectOwner; epoch = relation.subjectEpoch; habitId = relation.habitId; supervisor = role === 'supervisor'; photoRequired = live.rules.photoRequired;
  } else {
    if (!account.state.habits.some(item => item.id === habitId) || event.date > dates.today(now.getTime())) fail('MEDIA_UNAVAILABLE','照片范围不可访问');
    const active = await activeForHabit(tx,account,habitId,event.date,domain,dates); photoRequired = Boolean(active && active.rules.photoRequired);
  }
  const subject = owner === tx.owner ? account : await tx.account(owner),record = subject.state.records[habitId+'@'+event.date];
  const binding = await tx.binding(owner,epoch,habitId,event.date),mediaIds = record && record.status !== 'pending' && binding && !binding.revokedAt ? binding.mediaIds : [];
  if (!idsValid(mediaIds)) throw Error('MEDIA_BINDING_CORRUPT');
  const media = [];
  for (const id of mediaIds) {
    const item = validateAsset(await tx.media(id),owner,epoch,habitId,event.date);
    if (item.bound) media.push(item);
  }
  return {owner,epoch,habitId,supervisor,relationId:relation && relation._id,accountRevision:subject.revision,bindingRevision:binding ? binding.revision : 0,
    photoRequired,media,recordStatus:record ? record.status : 'pending'};
}
function createMediaApi({repository,provider,domain,dates,allowedAppId,allowedSources,limiter,clock=()=>new Date()}) {
  const guard = createRecordMutationGuard({domain,dates});
  const signSelection = async (selection,event,owner,epoch) => {
    const now = clock(),items = [];
    for (const media of selection.media) {
      if (selection.supervisor && media.status !== 'pass') continue;
      const url = ['pass','pending'].includes(media.status) ? await provider.temporaryUrl(media.fileId,300) : null;
      items.push({mediaId:media._id,status:media.status,url,expiresAt:url ? new Date(now.getTime()+300000).toISOString() : null});
    }
    await repository.transact(owner,async tx => {
      const account = await tx.account(); accountReady(account,epoch);
      const current = await mediaSelection(tx,event,account,clock(),domain,dates);
      if (current.bindingRevision !== selection.bindingRevision || current.epoch !== selection.epoch || current.media.length !== selection.media.length ||
        current.media.some((media,index) => media._id !== selection.media[index]._id || media.status !== selection.media[index].status)) fail('MEDIA_CHANGED','照片已变化，请重新打开');
      return {ok:true};
    });
    return {date:event.date,revision:selection.accountRevision,bindingRevision:selection.bindingRevision,photoRequired:selection.photoRequired,recordStatus:selection.recordStatus,
      processingCount:selection.media.filter(media => media.status === 'pending').length,unavailableCount:selection.media.filter(media => ['review','risky','failed'].includes(media.status)).length,items};
  };
  return async (event,identity) => {
    try {
      const owner = authenticate(identity,allowedAppId,allowedSources); validate(event,dates); if (limiter) await limiter(owner,event.epoch);
      if (!provider) fail('NOT_ENABLED','照片服务尚未开放');
      const now = clock(),day = dates.today(now.getTime());
      if (event.action === 'confirmMedia') {
        const prepared = await repository.transact(owner,async tx => {
          const account = await tx.account(); accountReady(account,event.epoch);
          const media = await tx.media(event.mediaId);
          if (!media || media.owner !== owner || media.ownerEpoch !== account.epoch || media.date !== day || !account.state.habits.some(habit => habit.id === media.habitId) ||
            media.deleteRequested || !provider.owns(event.fileId,media.cloudPath)) fail('MEDIA_UNAVAILABLE','这张照片不属于当前打卡');
          const fingerprint = hash(canonical(event));
          if (media.confirmFingerprint && media.confirmFingerprint !== fingerprint) fail('IDEMPOTENCY_MISMATCH','请勿重复确认不同文件');
          if (media.uploaded) return {ok:true,media,replayed:true};
          if (media.confirmState) return {ok:true,media,recover:true};
          if (Date.parse(media.expiresAt) <= now.getTime()) fail('MEDIA_EXPIRED','上传准备已过期，请重新选择照片');
          media.confirmState = 'claimed'; media.confirmFingerprint = fingerprint; media.confirmOperationId = event.operationId;
          media.draftFileId = event.fileId; media.sealedPath = media.cloudPath.replace('/uploads/','/records/').replace(/[a-f0-9]{64}\.(jpg|png)$/,crypto.randomBytes(32).toString('hex')+'.$1');
          media.fileId = provider.fileIdFor(media.sealedPath); media.updatedAt = now.toISOString(); await tx.putMedia(media);
          return {ok:true,media,claim:true};
        });
        if (prepared.replayed) return {ok:true,media:{mediaId:prepared.media._id,status:prepared.media.status,uploaded:true},replayed:true};
        let inspected;
        try { inspected = prepared.recover ? await provider.inspect(prepared.media.fileId) : await provider.freeze(prepared.media,event.fileId); }
        catch (error) {
          if (!prepared.recover && error.freezeStage === 'before-write') {
            await repository.transact(owner,async tx => {
              const account = await tx.account(); accountReady(account,event.epoch);
              const media = await tx.media(event.mediaId);
              if (media && !media.uploaded && media.confirmFingerprint === prepared.media.confirmFingerprint && media.fileId === prepared.media.fileId) {
                delete media.confirmState; delete media.fileId; delete media.sealedPath; media.updatedAt = clock().toISOString(); await tx.putMedia(media);
              }
            });
            if (error.message === 'IMAGE_SIZE_INVALID') fail('MEDIA_SIZE_INVALID','照片不能超过2MB，请重新选择');
            if (error.message === 'IMAGE_TYPE_INVALID') fail('MEDIA_TYPE_INVALID','请选择有效的JPG或PNG照片');
            fail('MEDIA_UPLOAD_RETRY','照片下载未完成，请重试本次上传');
          }
          fail('MEDIA_CONFIRM_PENDING','照片确认结果待核对，可重试或重新选择照片');
        }
        if (inspected.mimeType !== prepared.media.mimeType) fail('MEDIA_TYPE_INVALID','照片格式与上传准备不符');
        await repository.transact(owner,async tx => {
          const account = await tx.account(); accountReady(account,event.epoch);
          const media = await tx.media(event.mediaId);
          if (!media || media.confirmFingerprint !== prepared.media.confirmFingerprint || media.fileId !== prepared.media.fileId || media.deleteRequested || media.date !== dates.today(clock().getTime()) || !account.state.habits.some(habit => habit.id === media.habitId)) fail('MEDIA_UNAVAILABLE','这张照片已不可用');
          if (!media.uploaded) {
            Object.assign(media,{bytes:inspected.bytes,mimeType:inspected.mimeType,sha256:inspected.sha256,metadataVerified:true,uploaded:true,status:'pending',checkState:'queued',
              confirmState:'confirmed',checkOpenid:callerIdentity(identity).OPENID,updatedAt:clock().toISOString()}); await tx.putMedia(media);
          }
          return {ok:true};
        });
        const { startMediaCheck } = require('./media-worker');
        await startMediaCheck(repository,provider,owner,event.mediaId,clock);
        return {ok:true,media:{mediaId:event.mediaId,status:'pending',uploaded:true},replayed:false};
      }
      const result = await repository.transact(owner,async tx => {
        const account = await tx.account(); accountReady(account,event.epoch); domain.validateState(account.state);
        if (event.action === 'prepareMedia') {
          if (event.date !== day) fail('RECONFIRM_REQUIRED','只能为今天准备照片');
          const habit = account.state.habits.find(item => item.id === event.habitId),task = habit && domain.taskAt(account.state,habit,day);
          if (!task) fail('HABIT_UNAVAILABLE','今天没有安排这个习惯');
          const mediaId = hash(owner+':'+account.epoch+':'+event.operationId),fingerprint = hash(canonical(event)),old = await tx.media(mediaId);
          if (old) {
            if (old.prepareFingerprint !== fingerprint || old.owner !== owner || old.ownerEpoch !== account.epoch) fail('IDEMPOTENCY_MISMATCH','请勿复用上传请求标识');
            if (old.deleteRequested || old.status === 'deleted') fail('MEDIA_EXPIRED','照片已清理，请重新选择');
            return {ok:true,media:{mediaId,cloudPath:old.cloudPath,expiresAt:old.expiresAt,maxBytes:MAX_BYTES},replayed:true};
          }
          const media = {_id:mediaId,schemaVersion:1,owner,ownerEpoch:account.epoch,habitId:event.habitId,date:day,mimeType:event.mimeType,
            cloudPath:'jiancheng_daka_media/uploads/'+owner+'/'+account.epoch+'/'+mediaId+(event.mimeType === 'image/png' ? '.png':'.jpg'),
            createdAt:now.toISOString(),updatedAt:now.toISOString(),expiresAt:new Date(now.getTime()+86400000).toISOString(),orphanedAt:now.toISOString(),bound:false,
            uploaded:false,metadataVerified:false,status:'prepared',prepareFingerprint:fingerprint};
          // Resolve the expected draft id at preparation, so abandoned uploads can be deleted too.
          media.draftFileId = provider.fileIdFor(media.cloudPath); await tx.putMedia(media);
          return {ok:true,media:{mediaId,cloudPath:media.cloudPath,expiresAt:media.expiresAt,maxBytes:MAX_BYTES},replayed:false};
        }
        if (event.action === 'getRecordMedia') return {ok:true,selection:await mediaSelection(tx,event,account,now,domain,dates)};
        const fingerprint = hash(canonical(event)),receipt = account.receipts.find(item => item.id === event.operationId);
        if (receipt) {
          if (receipt.fingerprint !== fingerprint) fail('IDEMPOTENCY_MISMATCH','请勿复用请求标识');
          return {ok:true,selection:await mediaSelection(tx,event,account,now,domain,dates),snapshot:{accountId:owner,epoch:account.epoch,revision:account.revision,state:copy(account.state),serverDate:day},replayed:true};
        }
        if (event.date !== day) fail('RECONFIRM_REQUIRED','只能修改今天的照片');
        if (event.expectedRevision !== account.revision) fail('CONFLICT','记录已更新，请刷新后重试');
        const record = account.state.records[event.habitId+'@'+event.date]; if (!record || record.status === 'pending') fail('NOT_COMPLETED','请先完成本次打卡');
        const active = await activeForHabit(tx,account,event.habitId,event.date,domain,dates);
        if (active && active.rules.photoRequired && !event.mediaIds.length) {
          if (event.confirmation !== 'REMOVE_LAST_PHOTO_AND_UNDO') fail('CONFIRMATION_REQUIRED','删除最后一张需确认同时撤销本次打卡');
          account.state = domain.reduce(account.state,{type:'undo',id:event.habitId,date:event.date},event.date);
          await guard(tx,account,{type:'undo',id:event.habitId,date:event.date},event.date,now);
        } else await replaceBinding(tx,account,event.habitId,event.date,event.mediaIds,now);
        account.revision++; account.updatedAt = now.toISOString(); account.receipts.push({id:event.operationId,fingerprint,revision:account.revision}); account.receipts = account.receipts.slice(-256);
        await tx.putAccount(account);
        return {ok:true,selection:await mediaSelection(tx,event,account,now,domain,dates),snapshot:{accountId:owner,epoch:account.epoch,revision:account.revision,state:copy(account.state),serverDate:day},replayed:false};
      });
      if (result.selection) {
        const recordMedia = await signSelection(result.selection,event,owner,event.epoch);
        return {ok:true,recordMedia,...(result.snapshot ? {snapshot:result.snapshot,replayed:result.replayed}: {})};
      }
      return result;
    } catch (err) { return err instanceof ApiError ? {ok:false,code:err.code,message:err.message} : {ok:false,code:'SERVICE_UNAVAILABLE',message:'照片服务暂不可用，请保留照片后重试'}; }
  };
}
module.exports = {FIELDS,idsValid,validateAsset,replaceBinding,mediaSelection,createRecordMutationGuard,createMediaApi};

'use strict';
const { createSupervisionRepository,hash } = require('./supervision-repository');
const { hex,indexFor } = require('./supervision');
async function startMediaCheck(repository,provider,owner,id,clock=()=>new Date()) {
  const claimed = await repository.transact(owner,async tx => {
    const media = await tx.media(id),account = await tx.account();
    if (!media || media.owner !== owner || !account || account.cleanupPending || account.epoch !== media.ownerEpoch || media.deleteRequested || media.status !== 'pending' || media.checkState !== 'queued') return {ok:true,claimed:false};
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(media.checkOpenid || '') || Date.parse(media.createdAt) < clock().getTime()-2*3600000) {
      media.status = 'failed'; media.checkState = 'failed'; delete media.checkOpenid; await tx.putMedia(media); return {ok:true,claimed:false};
    }
    media.checkState = 'claimed'; media.checkClaim = hash(id+':'+clock().toISOString()); media.checkStartedAt = clock().toISOString(); await tx.putMedia(media);
    return {ok:true,claimed:true,media};
  });
  if (!claimed.claimed) return {ok:true,started:false};
  let result;
  try { result = await provider.check(claimed.media,claimed.media.checkOpenid); }
  catch (_) {
    await repository.transact(owner,async tx => {
      const media = await tx.media(id); if (media && media.checkClaim === claimed.media.checkClaim && media.checkState === 'claimed') {
        media.checkState = 'unknown'; media.updatedAt = clock().toISOString(); delete media.checkOpenid; await tx.putMedia(media);
      } return {ok:true};
    });
    return {ok:true,started:false,unknown:true};
  }
  await repository.transact(owner,async tx => {
    const media = await tx.media(id),account = await tx.account();
    if (!media || media.checkClaim !== claimed.media.checkClaim || media.checkState !== 'claimed') return {ok:true};
    if (!account || account.cleanupPending || account.epoch !== media.ownerEpoch || media.deleteRequested) {
      media.deleteRequested = true; delete media.checkOpenid; await tx.putMedia(media); return {ok:true};
    }
    const existing = await tx.trace(result.traceId); if (existing && existing.mediaId !== id) throw Error('MEDIA_TRACE_COLLISION');
    media.traceId = result.traceId; media.checkState = 'waiting'; media.updatedAt = clock().toISOString(); delete media.checkOpenid;
    await tx.putTrace({traceId:result.traceId,mediaId:id,owner,ownerEpoch:media.ownerEpoch,createdAt:clock().toISOString()}); await tx.putMedia(media); return {ok:true};
  });
  return {ok:true,started:true};
}
async function deleteCandidate(repository,provider,candidate,clock,force=false) {
  if (!candidate || !hex(candidate.owner) || !hex(candidate._id)) throw Error('MEDIA_CLEANUP_SCOPE_INVALID');
  const marked = await repository.transact(candidate.owner,async tx => {
    const media = await tx.media(candidate._id); if (!media || media.owner !== candidate.owner || media.ownerEpoch !== candidate.ownerEpoch) return {ok:true,media:null};
    if (force) {
      const account = await tx.account();
      if (account && account.epoch === media.ownerEpoch && !account.cleanupPending) throw Error('LIVE_ACCOUNT_CLEANUP_FORBIDDEN');
    } else if (!media.deleteRequested && (media.bound || !Number.isFinite(Date.parse(media.orphanedAt)) || Date.parse(media.orphanedAt) > clock().getTime()-86400000)) return {ok:true,media:null};
    media.deleteRequested = true; media.bound = false; media.updatedAt = clock().toISOString(); delete media.checkOpenid; await tx.putMedia(media); return {ok:true,media};
  });
  if (!marked.media) return false;
  const fileIds = [...new Set([marked.media.draftFileId,marked.media.fileId].filter(Boolean))];
  if (fileIds.length) await provider.delete(fileIds);
  await repository.transact(candidate.owner,async tx => {
    const current = await tx.media(candidate._id);
    if (current && current.owner === candidate.owner && current.ownerEpoch === candidate.ownerEpoch && current.deleteRequested) {
      if (current.traceId) {
        const trace = await tx.trace(current.traceId);
        if (trace && trace.owner === current.owner && trace.ownerEpoch === current.ownerEpoch && trace.mediaId === current._id) await tx.removeTrace(current.traceId);
      }
      await tx.removeMedia(current._id);
    }
    return {ok:true};
  });
  return true;
}
function createMediaWorker({repository,provider,clock=()=>new Date(),batchSize=20}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 20) throw Error('MEDIA_WORKER_BATCH_INVALID');
  return async () => {
    const counts = {ok:true,checks:0,deleted:0,failed:0};
    const pending = await repository.pendingMedia(batchSize);
    for (const media of pending) { const result = await startMediaCheck(repository,provider,media.owner,media._id,clock); if (result.started) counts.checks++; }
    const stalled = await repository.stalledChecks(clock(),batchSize);
    for (const candidate of stalled) await repository.transact(candidate.owner,async tx => {
      const media = await tx.media(candidate._id);
      if (media && media.owner === candidate.owner && media.ownerEpoch === candidate.ownerEpoch && media.status === 'pending' && ['waiting','claimed','unknown'].includes(media.checkState) && Date.parse(media.checkStartedAt) <= clock().getTime()-30*60000) {
        media.status = 'failed'; media.checkState = 'failed'; media.updatedAt = clock().toISOString(); delete media.checkOpenid; await tx.putMedia(media); counts.failed++;
      } return {ok:true};
    });
    const bound = await repository.mediaCandidates(clock(),batchSize),invalid = [];
    for (const candidate of bound) {
      const outcome = await repository.transact(candidate.owner,async tx => {
        const media = await tx.media(candidate._id); if (!media || media.owner !== candidate.owner || media.ownerEpoch !== candidate.ownerEpoch) return {ok:true};
        const account = await tx.account(),binding = account && await tx.binding(media.owner,media.ownerEpoch,media.habitId,media.date);
        const record = account && account.state && account.state.records[media.habitId+'@'+media.date];
        const valid = account && !account.cleanupPending && account.epoch === media.ownerEpoch && account.state.habits.some(habit => habit.id === media.habitId) && record && record.status !== 'pending' && binding && !binding.revokedAt && binding.mediaIds.includes(media._id);
        media.validatedAt = clock().toISOString();
        if (!valid) { media.bound = false; media.deleteRequested = true; }
        if (media.status === 'pending' && ['waiting','claimed','unknown'].includes(media.checkState) && Date.parse(media.checkStartedAt) < clock().getTime()-30*60000) { media.status = 'failed'; media.checkState = 'failed'; delete media.checkOpenid; counts.failed++; }
        await tx.putMedia(media); return {ok:true,invalid:!valid,media};
      });
      if (outcome.invalid) invalid.push(outcome.media);
    }
    const candidates = [...invalid,...await repository.invalidationMedia(batchSize),...await repository.orphanMedia(clock(),batchSize),...await repository.preparedMedia(clock(),batchSize)];
    const processed = new Set();
    for (const candidate of candidates.slice(0,batchSize)) {
      if (processed.has(candidate._id)) continue; processed.add(candidate._id);
      // Eligibility and deletion intent share one transaction with completion's binding guard.
      if (await deleteCandidate(repository,provider,candidate,clock)) counts.deleted++;
    }
    return counts;
  };
}
function createMediaCallback({repository,provider,clock=()=>new Date()}) {
  return async event => {
    try {
      const callback = provider.verifyCallback(event,clock());
      if (callback.handshake) return {statusCode:200,headers:{'Content-Type':'text/plain'},body:callback.echo};
      const outcome = await repository.transact(null,async tx => {
        const trace = await tx.trace(callback.traceId);
        if (!trace || !hex(trace.owner) || !hex(trace.mediaId)) return {ok:true,ignored:true};
        const media = await tx.media(trace.mediaId),account = await tx.account(trace.owner);
        if (!media || media.owner !== trace.owner || media.ownerEpoch !== trace.ownerEpoch || media.traceId !== callback.traceId || media.deleteRequested ||
          !account || account.cleanupPending || account.epoch !== trace.ownerEpoch || !account.state.habits.some(habit => habit.id === media.habitId)) return {ok:true,ignored:true};
        if (media.checkState === 'finished') {
          if (media.status !== callback.status) throw Error('MEDIA_CALLBACK_CONFLICT'); return {ok:true,replayed:true};
        }
        if (media.checkState !== 'waiting') return {ok:true,ignored:true};
        media.status = callback.status; media.checkState = 'finished'; media.updatedAt = clock().toISOString(); await tx.putMedia(media); return {ok:true};
      });
      return {statusCode:200,headers:{'Content-Type':'text/plain'},body:'success',result:outcome};
    } catch (_) { return {statusCode:401,headers:{'Content-Type':'text/plain'},body:'invalid callback'}; }
  };
}
function createSupervisionCleanup(db,provider,{clock=()=>new Date()}={}) {
  const repository = createSupervisionRepository(db);
  return async (owner,ownerEpoch) => {
    if (!hex(owner) || !/^[A-Za-z0-9_-]{1,100}$/.test(ownerEpoch || '')) throw Error('SUPERVISION_CLEANUP_SCOPE_INVALID');
    await repository.transact(owner,async tx => {
      const account = await tx.account();
      if (account && account.epoch === ownerEpoch && !account.cleanupPending) throw Error('LIVE_ACCOUNT_CLEANUP_FORBIDDEN');
      const stored = await tx.supervisionIndex(),index = indexFor(stored,owner,ownerEpoch);
      const pruneOther = async (otherOwner,otherEpoch,relationId,inviteId) => {
        const doc = await tx.supervisionIndex(otherOwner);
        if (!doc || doc.ownerEpoch !== otherEpoch) return;
        const other = indexFor(doc,otherOwner,otherEpoch);
        other.relationIds = other.relationIds.filter(id => id !== relationId);
        other.inviteIds = other.inviteIds.filter(id => id !== inviteId);
        other.receipts = other.receipts.filter(receipt => !(relationId && receipt.scopeRelationId === relationId || receipt.result && (receipt.result.supervision && receipt.result.supervision.supervisionId === relationId || receipt.result.invite && receipt.result.invite.inviteId === inviteId)));
        await tx.putSupervisionIndex(other);
      };
      for (const id of index.relationIds) {
        const relation = await tx.supervision(id);
        if (relation && (relation.subjectOwner === owner && relation.subjectEpoch === ownerEpoch || relation.supervisorOwner === owner && relation.supervisorEpoch === ownerEpoch)) {
          const isSubject = relation.subjectOwner === owner;
          await pruneOther(isSubject ? relation.supervisorOwner : relation.subjectOwner,isSubject ? relation.supervisorEpoch : relation.subjectEpoch,id,null);
          await tx.removeSupervision(id);
        }
      }
      for (const id of index.inviteIds) {
        const invite = await tx.invite(id);
        if (invite && (invite.subjectOwner === owner && invite.subjectEpoch === ownerEpoch || invite.applicant && invite.applicant.owner === owner && invite.applicant.epoch === ownerEpoch)) {
          if (invite.subjectOwner !== owner) await pruneOther(invite.subjectOwner,invite.subjectEpoch,null,id);
          else if (invite.applicant) await pruneOther(invite.applicant.owner,invite.applicant.epoch,null,id);
          await tx.removeInvite(id);
        }
      }
      if (stored && stored.owner === owner && stored.ownerEpoch === ownerEpoch) await tx.removeSupervisionIndex(owner);
      return {ok:true};
    });
    let empty = false;
    for (let batch=0;batch<100;batch++) { const rows = await repository.ownerMedia(owner,ownerEpoch,20); if (!rows.length) {empty=true;break;} for (const media of rows) {
      if (media.owner !== owner || media.ownerEpoch !== ownerEpoch) throw Error('MEDIA_CLEANUP_SCOPE_INVALID'); await deleteCandidate(repository,provider,media,clock,true);
    } }
    if (!empty) throw Error('MEDIA_CLEANUP_BATCH_LIMIT');
    let bindingsEmpty = false;
    for (let batch=0;batch<100;batch++) { const rows = await repository.ownerBindings(owner,ownerEpoch,20); if (!rows.length) {bindingsEmpty = true;break;} for (const binding of rows) {
      if (binding.owner !== owner || binding.ownerEpoch !== ownerEpoch) throw Error('BINDING_CLEANUP_SCOPE_INVALID');
      await repository.transact(owner,async tx => { const current = await tx.binding(owner,ownerEpoch,binding.habitId,binding.date); if (current && current.owner === owner && current.ownerEpoch === ownerEpoch) await tx.removeBinding(current._id); return {ok:true}; });
    } }
    if (!bindingsEmpty) throw Error('BINDING_CLEANUP_BATCH_LIMIT');
    for (let batch=0;batch<100;batch++) {
      const rows = await repository.ownerTraces(owner,ownerEpoch,20); if (!rows.length) return;
      for (const trace of rows) {
        if (trace.owner !== owner || trace.ownerEpoch !== ownerEpoch || typeof trace.traceId !== 'string') throw Error('TRACE_CLEANUP_SCOPE_INVALID');
        await repository.transact(owner,async tx => {const current = await tx.trace(trace.traceId);if (current && current.owner === owner && current.ownerEpoch === ownerEpoch) await tx.removeTrace(trace.traceId);return {ok:true};});
      }
    }
    throw Error('TRACE_CLEANUP_BATCH_LIMIT');
  };
}
module.exports = {startMediaCheck,createMediaWorker,createMediaCallback,createSupervisionCleanup};

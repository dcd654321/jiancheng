'use strict';
const crypto = require('node:crypto');
const { read, readAccount } = require('./features-repository');
const { COLLECTION } = require('./cloudbase-repository');
const INVITES = 'jiancheng_daka_supervision_invites';
const RELATIONS = 'jiancheng_daka_supervisions';
const INDEXES = 'jiancheng_daka_supervision_indexes';
const MEDIA = 'jiancheng_daka_media';
const BINDINGS = 'jiancheng_daka_media_bindings';
const TRACES = 'jiancheng_daka_media_traces';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const bindingId = (owner, epoch, habitId, date) => hash([owner, epoch, habitId, date].join(':'));
const write = (tx, collection, doc) => { const { _id, ...data } = doc; return tx.collection(collection).doc(_id).set({ data }); };

/** The same adapter is used by the core account transaction; never start a nested transaction. */
function createSupervisionTx(tx, owner) {
  return {
    owner,
    account: (otherOwner = owner) => readAccount(tx.collection(COLLECTION).doc(otherOwner)),
    async putAccount(account, otherOwner = owner) {
      const ref = tx.collection(COLLECTION).doc(otherOwner), prior = await read(ref);
      await ref.set({ data: { payload: account, ...(prior && prior._monitorFence !== undefined ? { _monitorFence: prior._monitorFence } : {}) } });
    },
    invite: id => read(tx.collection(INVITES).doc(id)),
    putInvite: doc => write(tx, INVITES, doc),
    removeInvite: id => tx.collection(INVITES).doc(id).remove(),
    supervision: id => read(tx.collection(RELATIONS).doc(id)),
    putSupervision: doc => write(tx, RELATIONS, doc),
    removeSupervision: id => tx.collection(RELATIONS).doc(id).remove(),
    supervisionIndex: (otherOwner = owner) => read(tx.collection(INDEXES).doc(otherOwner)),
    putSupervisionIndex: doc => write(tx, INDEXES, doc),
    removeSupervisionIndex: id => tx.collection(INDEXES).doc(id).remove(),
    media: id => read(tx.collection(MEDIA).doc(id)),
    putMedia: doc => write(tx, MEDIA, doc),
    removeMedia: id => tx.collection(MEDIA).doc(id).remove(),
    binding: (otherOwner, epoch, habitId, date) => read(tx.collection(BINDINGS).doc(bindingId(otherOwner, epoch, habitId, date))),
    putBinding: doc => write(tx, BINDINGS, doc),
    removeBinding: id => tx.collection(BINDINGS).doc(id).remove(),
    trace: id => read(tx.collection(TRACES).doc(hash(id))),
    putTrace: doc => write(tx, TRACES, { ...doc, _id: hash(doc.traceId) }),
    removeTrace: id => tx.collection(TRACES).doc(hash(id)).remove()
  };
}
function createSupervisionRepository(db) {
  const query = async (collection, conditions, limit = 20) => {
    const response = await db.collection(collection).where(conditions).limit(limit).get();
    if (!response || !Array.isArray(response.data) || response.data.length > limit) throw Error('SIDECAR_QUERY_INVALID');
    return response.data;
  };
  return {
    async transact(owner, work) {
      const result = await db.runTransaction(tx => work(createSupervisionTx(tx, owner)));
      return result && Object.prototype.hasOwnProperty.call(result, 'result') && typeof result.ok !== 'boolean' ? result.result : result;
    },
    async mediaCandidates(now, limit = 20) {
      const response = await db.collection(MEDIA).where({bound:true}).orderBy('validatedAt','asc').limit(limit).get();
      if (!response || !Array.isArray(response.data) || response.data.length > limit) throw Error('SIDECAR_QUERY_INVALID');
      return response.data;
    },
    pendingMedia: (limit = 20) => query(MEDIA, { status: 'pending', checkState: 'queued' }, limit),
    stalledChecks: (now, limit = 20) => query(MEDIA, {status:'pending',checkStartedAt:db.command.lte(new Date(now.getTime()-30*60000).toISOString())},limit),
    orphanMedia: (now, limit = 20) => query(MEDIA, { orphanedAt: db.command.lte(new Date(now.getTime() - 86400000).toISOString()) }, limit),
    preparedMedia: (now, limit = 20) => query(MEDIA, { status: 'prepared', createdAt: db.command.lte(new Date(now.getTime() - 86400000).toISOString()) }, limit),
    ownerMedia: (owner, ownerEpoch, limit = 20) => query(MEDIA, { owner, ownerEpoch }, limit),
    ownerBindings: (owner, ownerEpoch, limit = 20) => query(BINDINGS, { owner, ownerEpoch }, limit),
    ownerTraces: (owner, ownerEpoch, limit = 20) => query(TRACES, { owner, ownerEpoch }, limit),
    invalidationMedia: (limit = 20) => query(MEDIA, { deleteRequested: true }, limit)
  };
}
module.exports = { INVITES, RELATIONS, INDEXES, MEDIA, BINDINGS, TRACES, hash, bindingId, createSupervisionTx, createSupervisionRepository };

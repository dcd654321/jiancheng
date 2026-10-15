const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createRepository, COLLECTION } = require('../server/cloudbase-repository');
const { MEDIA, BINDINGS, RELATIONS, INDEXES, bindingId } = require('../server/supervision-repository');
const { createApi } = require('../server/handler');
const { createRecordMutationGuard } = require('../server/media');
const { domain, dates, plan } = require('./helpers/cloud-fixture.cjs');
const sdkPath = path.resolve(__dirname, '../cloudfunctions/jiancheng_daka_api/node_modules/wx-server-sdk');

test('installed SDK commits photo binding and account together, rolls back each write fault and replays before side effects',
  { skip: !fs.existsSync(sdkPath) && '请安装锁定云函数依赖' }, async t => {
    const http = require('node:http'), https = require('node:https');
    const original = { http: http.request, https: https.request, fetch: global.fetch };
    http.request = https.request = global.fetch = () => { throw Error('PHOTO_SDK_NETWORK_FORBIDDEN'); };
    t.after(() => { http.request = original.http; https.request = original.https; global.fetch = original.fetch; });
    const cloud = require(sdkPath); cloud.init({ env: 'photo-sdk-contract-local-only' });
    const db = cloud.database(), Db = db._db.constructor, originalRequest = Db.reqClass;
    let saved = new Map(), transactions = new Map(), serial = 0, fault = '', conflict = false;
    const calls = [];
    Db.reqClass = class {
      async send(action, params = {}) {
        calls.push({ action, collection: params.collectionName, transactionId: params.transactionId });
        if (action === 'database.startTransaction') { const id = 'photo-tx-' + (++serial); transactions.set(id, new Map(saved)); return { transactionId: id }; }
        const target = params.transactionId ? transactions.get(params.transactionId) : saved;
        assert.ok(target);
        if (action === 'database.abortTransaction') { transactions.delete(params.transactionId); return { ok: 1 }; }
        if (action === 'database.commitTransaction') {
          if (conflict) { conflict = false; return { code: 'DATABASE_TRANSACTION_CONFLICT', message: 'retry conflict' }; }
          if (fault === 'commit') return { code: 'PERMISSION_DENIED', message: 'commit failed' };
          saved = target; transactions.delete(params.transactionId); return { ok: 1 };
        }
        assert.ok([COLLECTION, MEDIA, BINDINGS, RELATIONS, INDEXES].includes(params.collectionName));
        const key = params.collectionName + ':' + JSON.parse(params.query)._id;
        if (action === 'database.getDocument') return { data: { list: target.has(key) ? [target.get(key)] : [] } };
        if (action === 'database.modifyDocument') {
          assert.ok(params.transactionId, 'all binding, media and account writes use one SDK transaction');
          if (fault === params.collectionName) return { code: 'PERMISSION_DENIED', message: 'write fault' };
          const value = JSON.parse(params.data); assert.equal(value._id, undefined);
          target.set(key, params.data); return { data: { updated: 1 } };
        }
        throw Error('Unexpected SDK action ' + action);
      }
    };
    t.after(() => { Db.reqClass = originalRequest; });
    const identity = { APPID: 'wx-sdk-photo', OPENID: 'sdk-photo-user', SOURCE: 'wx_client' }, day = '2026-10-13';
    let guardCalls = 0;
    const guard = createRecordMutationGuard({ domain, dates });
    const api = createApi({ repository: createRepository(db, { supervisionEnabled: true }), domain, dates,
      allowedAppId: identity.APPID, allowedSources: ['wx_client'], clock: () => new Date(day + 'T04:00:00Z'), newEpoch: () => 'sdk-photo-epoch',
      recordMutationGuard: async (tx, previous, command) => {
        if (['complete', 'completeMinimum'].includes(command.type)) guardCalls++;
        await guard(tx, previous, command, day, new Date(day + 'T04:00:00Z'));
      } });
    const call = event => api(event, identity);
    let snapshot = await call({ action: 'pull' });
    snapshot = await call({ action: 'mutate', operationId: 'sdk-photo-create', epoch: snapshot.epoch, expectedRevision: snapshot.revision,
      operationDate: day, command: { type: 'create', id: 'read', startDate: day, plan: plan() } });
    const photoId = 'c'.repeat(64), relationId = 'd'.repeat(64), supervisor = 'b'.repeat(64);
    saved.set(COLLECTION + ':' + supervisor, JSON.stringify({ payload: { epoch: 'sdk-supervisor-epoch', revision: 0,
      state: domain.emptyState(), receipts: [], updatedAt: day + 'T04:00:00Z' } }));
    saved.set(INDEXES + ':' + snapshot.accountId, JSON.stringify({ _id: snapshot.accountId, owner: snapshot.accountId,
      ownerEpoch: snapshot.epoch, relationIds: [relationId], inviteIds: [], receipts: [] }));
    saved.set(RELATIONS + ':' + relationId, JSON.stringify({ _id: relationId, schemaVersion: 1, status: 'active', revision: 1,
      subjectOwner: snapshot.accountId, subjectEpoch: snapshot.epoch, supervisorOwner: supervisor, supervisorEpoch: 'sdk-supervisor-epoch',
      habitId: 'read', startDate: day, endDate: dates.shift(day, 6), rules: [{ effectiveDate: day, deadline: '21:00', photoRequired: true }] }));
    saved.set(MEDIA + ':' + photoId, JSON.stringify({ _id: photoId, schemaVersion: 1, owner: snapshot.accountId, ownerEpoch: snapshot.epoch,
      habitId: 'read', date: day, uploaded: true, metadataVerified: true, bytes: 100, mimeType: 'image/png', status: 'pending', bound: false }));
    const request = { action: 'mutate', operationId: 'sdk-photo-complete', epoch: snapshot.epoch, expectedRevision: snapshot.revision,
      operationDate: day, command: { type: 'complete', id: 'read', date: day, mediaIds: [photoId] } };
    assert.equal((await call({ ...request, operationId: 'sdk-old-client', command: { type: 'complete', id: 'read', date: day } })).code, 'PHOTO_REQUIRED');
    for (const target of [BINDINGS, MEDIA, COLLECTION, 'commit']) {
      fault = target; const before = [...saved];
      assert.equal((await call(request)).code, 'SERVICE_UNAVAILABLE'); assert.deepEqual([...saved], before);
      fault = '';
    }
    calls.length = 0; conflict = true;
    const completed = await call(request); assert.equal(completed.ok, true); assert.equal(completed.state.records['read@' + day].status, 'standard');
    assert.equal(calls.filter(item => item.action === 'database.startTransaction').length, 2);
    assert.deepEqual(JSON.parse(saved.get(BINDINGS + ':' + bindingId(snapshot.accountId, snapshot.epoch, 'read', day))).mediaIds, [photoId]);
    assert.equal(JSON.parse(saved.get(MEDIA + ':' + photoId)).bound, true);
    const beforeReplay = guardCalls;
    assert.equal((await call(request)).replayed, true); assert.equal(guardCalls, beforeReplay);
  });

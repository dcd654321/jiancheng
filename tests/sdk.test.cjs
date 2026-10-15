const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRepository, COLLECTION } = require('../server/cloudbase-repository');
const { createApi } = require('../server/handler');
const { domain, dates, plan } = require('./helpers/cloud-fixture.cjs');
const sdkPath = path.resolve(__dirname, '../cloudfunctions/jiancheng_daka_api/node_modules/wx-server-sdk');

test('已安装真实SDK合同：运营事件先读账户与事件，再update/inc栅栏并幂等写入',
  { skip: !fs.existsSync(sdkPath) && '先安装锁定云函数依赖' }, async t => {
    const http = require('node:http'), https = require('node:https');
    const previous = { http: http.request, https: https.request, fetch: global.fetch };
    const deny = () => { throw Error('SDK_CONTRACT_NETWORK_FORBIDDEN'); };
    http.request = https.request = global.fetch = deny;
    t.after(() => { http.request = previous.http; https.request = previous.https; global.fetch = previous.fetch; });
    const cloud = require(sdkPath);
    cloud.init({ env: 'local-sdk-contract-only' });
    const db = cloud.database(), Db = db._db.constructor, original = Db.reqClass;
    const calls = [], identity = { APPID: 'wx58e61dffcbfa4249', OPENID: 'sdk-monitor-user', SOURCE: 'wx_client' };
    let transactionId = 0, conflict = true;
    const pendingTransactions = new Set();
    Db.reqClass = class {
      async send(action, params = {}) {
        calls.push({ action, params });
        if (action === 'database.startTransaction') return { transactionId: 'monitor-tx-' + (++transactionId) };
        assert.ok(params.transactionId);
        if (action === 'database.abortTransaction') return { ok: 1 };
        if (action === 'database.commitTransaction') {
          if (conflict) { conflict = false; return { code: 'DATABASE_TRANSACTION_CONFLICT', message: 'write conflict' }; }
          return { ok: 1 };
        }
        if (pendingTransactions.has(params.transactionId)) throw Error('ResourceUnavailable.TransactionBusy');
        pendingTransactions.add(params.transactionId);
        await new Promise(resolve => setImmediate(resolve));
        pendingTransactions.delete(params.transactionId);
        assert.ok(['jiancheng_daka_accounts', 'monitor_events'].includes(params.collectionName));
        if (action === 'database.getDocument') return { data: { list: params.collectionName === 'jiancheng_daka_accounts'
          ? [JSON.stringify({ payload: { epoch: 'sdk-epoch' }, _monitorFence: 4 })] : [] } };
        if (action === 'database.modifyDocument') {
          if (params.collectionName === 'jiancheng_daka_accounts') {
            assert.equal(params.merge, true);
            const patch = JSON.parse(params.data, (_, value) => value && typeof value === 'object' && '$numberInt' in value ? Number(value.$numberInt) : value);
            assert.deepEqual(patch, { $inc: { _monitorFence: 1 } });
          } else {
            assert.equal(params.upsert, true); assert.equal(params.merge, false);
            const event = JSON.parse(params.data);
            assert.equal(event.appId, 'jiancheng'); assert.equal(event.type, 'habit_created');
            assert.equal(event.payload.secret, undefined);
          }
          return { data: { updated: 1 } };
        }
        throw Error('Unexpected SDK action: ' + action);
      }
    };
    t.after(() => { Db.reqClass = original; });
    const { createOperationsReporter } = require('../server/operations-monitor');
    const result = await createOperationsReporter(db)({ type: 'habit_created', eventId: 'sdk-monitor-event', accountGeneration: 'sdk-epoch', payload: {} }, identity, new Date('2026-10-12T00:00:00Z'));
    assert.equal(result, true);
    assert.equal(transactionId, 2, 'write conflict retries with a fresh transaction');
    for (const id of ['monitor-tx-1', 'monitor-tx-2']) {
      assert.deepEqual(calls.filter(call => call.params.transactionId === id && call.action !== 'database.abortTransaction').map(call => call.action),
        ['database.getDocument', 'database.getDocument', 'database.modifyDocument', 'database.modifyDocument', 'database.commitTransaction']);
    }
  });

test('已安装真实wx-server-sdk合同：事务、序列化、错误、幂等（仅底层请求模拟，无网络）',
  { skip: !fs.existsSync(sdkPath) && '先在cloudfunctions/jiancheng_daka_api安装锁定依赖' }, async t => {
    // Tripwires ensure an accidental transport fallback cannot use host credentials/network.
    const http = require('node:http'), https = require('node:https');
    const oldHttp = http.request, oldHttps = https.request, oldFetch = global.fetch;
    const denyNetwork = () => { throw Error('SDK_CONTRACT_NETWORK_FORBIDDEN'); };
    http.request = https.request = global.fetch = denyNetwork;
    t.after(() => { http.request = oldHttp; https.request = oldHttps; global.fetch = oldFetch; });
    const cloud = require(sdkPath);
    assert.equal(require(sdkPath + '/package.json').version, require('../cloudfunctions/jiancheng_daka_api/package.json').dependencies['wx-server-sdk']);
    cloud.init({ env: 'local-sdk-contract-only' }); const db = cloud.database();
    const Db = db._db.constructor, original = Db.reqClass;
    let saved = new Map(), transactions = new Map(), serial = 0, calls = [], fault = '', faultCollection = '', commitConflict = false;
    const copy = x => JSON.parse(JSON.stringify(x));
    Db.reqClass = class {
      async send(action, params = {}) {
        calls.push({ action, params: copy(params) });
        if (action === fault && (!faultCollection || params.collectionName === faultCollection)) return { code: 'PERMISSION_DENIED', message: 'permission denied for collection' };
        if (action === 'database.startTransaction') {
          const id = 'tx-' + (++serial); transactions.set(id, new Map(saved)); return { transactionId: id };
        }
        const tx = params.transactionId ? transactions.get(params.transactionId) : saved;
        assert.ok(tx, 'Every transactional operation uses a real SDK transaction id');
        if (!params.transactionId) assert.equal(action, 'database.getDocument', 'Only document reads can omit a transaction');
        if (action === 'database.commitTransaction') {
          if (commitConflict) { commitConflict = false; return { code: 'DATABASE_TRANSACTION_CONFLICT', message: 'database transaction conflict' }; }
          saved = tx; transactions.delete(params.transactionId); return { ok: 1 };
        }
        if (action === 'database.abortTransaction') { transactions.delete(params.transactionId); return { ok: 1 }; }
        assert.ok([COLLECTION, 'jiancheng_daka_preferences'].includes(params.collectionName));
        const owner = JSON.parse(params.query)._id;
        const id = params.collectionName === COLLECTION ? owner : 'preferences:' + owner;
        if (action === 'database.getDocument') return { data: { list: tx.has(id) ? [tx.get(id)] : [] } };
        if (action === 'database.modifyDocument') {
          assert.equal(params.upsert, true); assert.equal(params.merge, false);
          const value = JSON.parse(params.data); if (params.collectionName === COLLECTION) assert.ok(value.payload); assert.equal(value.data, undefined);
          tx.set(id, params.data); return { data: { updated: 1, upsert_id: id } };
        }
        throw Error('Unexpected SDK action: ' + action);
      }
    };
    t.after(() => { Db.reqClass = original; });
    const api = createApi({ repository: createRepository(db), domain, dates, allowedAppId: 'wx-contract', allowedSources: ['wx_client', 'wx_devtools'],
      clock: () => new Date('2026-09-15T04:00:00Z'), newEpoch: () => 'contract-epoch' });
    const identity = { APPID: 'wx-contract', OPENID: 'contract-user', SOURCE: 'wx_client' };
    let snapshot;
    await t.test('SDK缺失文档错误被正确识别，原子创建账户；重复pull不写', async () => {
      snapshot = await api({ action: 'pull' }, identity); assert.equal(snapshot.ok, true); assert.equal(snapshot.revision, 0);
      assert.deepEqual(calls.map(c => c.action), ['database.getDocument', 'database.startTransaction', 'database.getDocument', 'database.modifyDocument', 'database.commitTransaction']);
      calls = []; assert.equal((await api({ action: 'pull' }, identity)).ok, true);
      assert.equal(calls.some(c => c.action === 'database.modifyDocument'), false);
      assert.deepEqual(calls.map(c => c.action), ['database.getDocument']);
      assert.equal(calls[0].params.transactionId, undefined);
    });
    await t.test('已有账户只读权限失败和坏文档不创建空账户或进入事务', async () => {
      const owner = snapshot.accountId, original = saved.get(owner);
      try {
        fault = 'database.getDocument'; calls = [];
        assert.equal((await api({ action: 'pull' }, identity)).code, 'SERVICE_UNAVAILABLE');
        assert.deepEqual(calls.map(c => c.action), ['database.getDocument']); assert.equal(saved.get(owner), original); fault = '';
        for (const document of [{ unknown: true }, { payload: { epoch: 'invalid epoch', revision: 0, receipts: [], state: domain.emptyState() } },
          { payload: { epoch: snapshot.epoch, revision: 0, receipts: [], state: { ...domain.emptyState(), habits: 'invalid' } } }]) {
          saved.set(owner, JSON.stringify(document)); calls = [];
          assert.equal((await api({ action: 'pull' }, identity)).code, 'SERVICE_UNAVAILABLE');
          assert.deepEqual(calls.map(c => c.action), ['database.getDocument']); assert.equal(saved.get(owner), JSON.stringify(document));
        }
      } finally { saved.set(owner, original); fault = ''; }
    });
    await t.test('真实SDK嵌套payload往返与同ID重放不重复写', async () => {
      const event = { action: 'mutate', operationId: 'contract-create', epoch: snapshot.epoch, expectedRevision: 0,
        operationDate: '2026-09-15', command: { type: 'create', id: 'read', startDate: '2026-09-15', plan: plan() } };
      snapshot = await api(event, identity); assert.equal(snapshot.ok, true); assert.equal(snapshot.state.habits[0].versions[0].minimum, 2);
      calls = []; const repeated = await api(event, identity); assert.equal(repeated.replayed, true);
      assert.equal(repeated.revision, 1); assert.equal(calls.some(c => c.action === 'database.modifyDocument'), false);
    });
    await t.test('SDK权限错误和写入错误回滚，不误造空数据也不声称成功', async () => {
      for (const action of ['database.getDocument', 'database.modifyDocument']) {
        calls = []; const before = Array.from(saved); fault = action;
        const result = await api({ action: 'mutate', operationId: 'fail-write', epoch: snapshot.epoch, expectedRevision: 1,
          operationDate: '2026-09-15', command: { type: 'complete', id: 'read', date: '2026-09-15' } }, identity);
        assert.equal(result.code, 'SERVICE_UNAVAILABLE'); assert.deepEqual(Array.from(saved), before);
        assert.ok(calls.some(c => c.action === 'database.abortTransaction'));
        assert.equal(calls.some(c => c.action === 'database.commitTransaction'), false);
        fault = '';
      }
    });
    await t.test('真实SDK事务冲突重新读取重试，返回已提交结果', async () => {
      calls = []; commitConflict = true;
      const result = await api({ action: 'mutate', operationId: 'conflict-retry', epoch: snapshot.epoch, expectedRevision: 1,
        operationDate: '2026-09-15', command: { type: 'complete', id: 'read', date: '2026-09-15' } }, identity);
      assert.equal(result.ok, true); assert.equal(result.revision, 2);
      assert.equal(calls.filter(c => c.action === 'database.startTransaction').length, 2);
      assert.equal((await api({ action: 'pull' }, identity)).state.records['read@2026-09-15'].status, 'standard');
    });
    await t.test('单项删除与置顶原子提交：偏好/账户读写错误均回滚，重放不删除重建的ID', async () => {
      const a = await api({ action: 'pull' }, identity), owner = a.accountId;
      const pref = require('../server/preferences').readPreferences(null, owner, a.epoch, '2026-09-15T04:00:00Z');
      Object.assign(pref, { pinnedHabitId: 'read', theme: 'paper', reminderSlot: '12:30' });
      saved.set('preferences:' + owner, JSON.stringify(pref));
      const event = { action: 'mutate', operationId: 'sdk-delete-habit', epoch: a.epoch, expectedRevision: a.revision,
        operationDate: '2026-09-15', command: { type: 'deleteHabit', id: 'read', baseRevision: 1 } };
      for (const [action, collection] of [['database.getDocument', 'jiancheng_daka_preferences'],
        ['database.modifyDocument', 'jiancheng_daka_preferences'], ['database.modifyDocument', COLLECTION], ['database.commitTransaction', '']]) {
        calls = []; const before = Array.from(saved); fault = action; faultCollection = collection;
        assert.equal((await api(event, identity)).code, 'SERVICE_UNAVAILABLE'); assert.deepEqual(Array.from(saved), before);
        assert.ok(calls.some(c => c.action === 'database.abortTransaction')); fault = ''; faultCollection = '';
      }
      for (const patch of [{ owner: 'other' }, { ownerEpoch: 'other-epoch' }, { theme: 'invalid' }, { revision: Number.MAX_SAFE_INTEGER }]) {
        saved.set('preferences:' + owner, JSON.stringify({ ...pref, ...patch })); const before = Array.from(saved);
        assert.equal((await api(event, identity)).code, 'SERVICE_UNAVAILABLE'); assert.deepEqual(Array.from(saved), before);
      }
      saved.set('preferences:' + owner, JSON.stringify(pref)); calls = []; commitConflict = true;
      const removed = await api(event, identity); assert.equal(removed.ok, true); assert.deepEqual(removed.state.habits, []);
      assert.deepEqual(removed.state.records, {}); assert.equal(removed.epoch, a.epoch);
      const afterPref = JSON.parse(saved.get('preferences:' + owner), (_, value) =>
        value && typeof value === 'object' && '$numberInt' in value ? Number(value.$numberInt) : value);
      assert.deepEqual(afterPref, { ...pref, pinnedHabitId: null, revision: 1, updatedAt: '2026-09-15T04:00:00.000Z' });
      assert.equal(calls.filter(c => c.action === 'database.startTransaction').length, 2);
      const created = await api({ action: 'mutate', operationId: 'sdk-recreate', epoch: a.epoch, expectedRevision: removed.revision,
        operationDate: '2026-09-15', command: { type: 'create', id: 'read', startDate: '2026-09-15', plan: plan() } }, identity);
      assert.equal(created.ok, true); calls = [];
      assert.equal((await api(event, identity)).state.habits.length, 1);
      assert.equal(calls.some(c => c.action === 'database.modifyDocument'), false);
      // An existing pin to a different id is untouched; a missing preference is not created.
      saved.set('preferences:' + owner, JSON.stringify({ ...afterPref, pinnedHabitId: 'another' }));
      const again = { ...event, operationId: 'sdk-delete-again', expectedRevision: created.revision };
      assert.equal((await api(again, identity)).ok, true);
      assert.equal(JSON.parse(saved.get('preferences:' + owner)).pinnedHabitId, 'another');
      const empty = await api({ action: 'pull' }, identity);
      const newHabit = await api({ action: 'mutate', operationId: 'sdk-recreate-again', epoch: a.epoch, expectedRevision: empty.revision,
        operationDate: '2026-09-15', command: { type: 'create', id: 'read', startDate: '2026-09-15', plan: plan() } }, identity);
      saved.delete('preferences:' + owner);
      assert.equal((await api({ ...again, operationId: 'sdk-delete-no-pref', expectedRevision: newHabit.revision }, identity)).ok, true);
      assert.equal(saved.has('preferences:' + owner), false);
    });
    await t.test('删除旁路清理完成标记通过真实SDK持久化，后续读取不重复清理',async()=>{
      let cleanups=0;
      const cleanupApi=createApi({repository:createRepository(db),domain,dates,allowedAppId:'wx-contract',allowedSources:['wx_client'],
        clock:()=>new Date('2026-09-15T04:00:00Z'),newEpoch:()=> 'cleanup-epoch',cleanup:async()=>{cleanups++;}});
      const current=await api({action:'pull'},identity);
      const result=await cleanupApi({action:'purge',operationId:'sdk-cleanup',epoch:current.epoch,expectedRevision:current.revision,
        operationDate:'2026-09-15',confirmation:'DELETE_MY_DATA'},identity);
      assert.equal(result.ok,true);assert.equal(cleanups,1);
      const stored=JSON.parse(saved.get(current.accountId)).payload;
      assert.equal(stored.cleanupPending,undefined);assert.equal(stored.cleanupSourceEpoch,undefined);
      assert.equal((await cleanupApi({action:'pull'},identity)).ok,true);assert.equal(cleanups,1);
    });
  });

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRepository, COLLECTION } = require('../server/cloudbase-repository');
const { createApi } = require('../server/handler');
const { domain, dates, plan } = require('./helpers/cloud-fixture.cjs');
const sdkPath = path.resolve(__dirname, '../cloudfunctions/jiancheng_daka_api/node_modules/wx-server-sdk');

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
    let saved = new Map(), transactions = new Map(), serial = 0, calls = [], fault = '', commitConflict = false;
    const copy = x => JSON.parse(JSON.stringify(x));
    Db.reqClass = class {
      async send(action, params = {}) {
        calls.push({ action, params: copy(params) });
        if (action === fault) return { code: 'PERMISSION_DENIED', message: 'permission denied for collection' };
        if (action === 'database.startTransaction') {
          const id = 'tx-' + (++serial); transactions.set(id, new Map(saved)); return { transactionId: id };
        }
        const tx = transactions.get(params.transactionId); assert.ok(tx, 'Every operation uses a real SDK transaction id');
        if (action === 'database.commitTransaction') {
          if (commitConflict) { commitConflict = false; return { code: 'DATABASE_TRANSACTION_CONFLICT', message: 'database transaction conflict' }; }
          saved = tx; transactions.delete(params.transactionId); return { ok: 1 };
        }
        if (action === 'database.abortTransaction') { transactions.delete(params.transactionId); return { ok: 1 }; }
        assert.equal(params.collectionName, COLLECTION);
        const id = JSON.parse(params.query)._id;
        if (action === 'database.getDocument') return { data: { list: tx.has(id) ? [tx.get(id)] : [] } };
        if (action === 'database.modifyDocument') {
          assert.equal(params.upsert, true); assert.equal(params.merge, false);
          const value = JSON.parse(params.data); assert.ok(value.payload); assert.equal(value.data, undefined);
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
      assert.deepEqual(calls.map(c => c.action), ['database.startTransaction', 'database.getDocument', 'database.modifyDocument', 'database.commitTransaction']);
      calls = []; assert.equal((await api({ action: 'pull' }, identity)).ok, true);
      assert.equal(calls.some(c => c.action === 'database.modifyDocument'), false);
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
  });

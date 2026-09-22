const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, storageFixture, copy } = require('./helpers/cloud-fixture.cjs');
const { createSyncEngine, PREFIX } = require('../miniprogram/services/sync-engine');
const record = (type = 'complete', extra = {}) => ({ type, id: 'read', date: '2026-09-10', ...extra });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function setup(callOverride) {
  const f = fixture(), snapshot = await f.seed(), storage = storageFixture(); let serial = 0;
  const engine = createSyncEngine({ storage, call: callOverride ? e => callOverride(e, f) : f.api,
    accountId: snapshot.accountId, consent: true, clock: () => f.date, newId: () => 'offline-' + (++serial) });
  engine.attach(snapshot);
  return { f, snapshot, storage, engine, key: PREFIX + snapshot.accountId };
}

test('同步须明确授权和账户绑定，不覆盖原有本机存储或已有缓存', async () => {
  assert.throws(() => createSyncEngine({ consent: false }), /授权/);
  const { engine, storage, snapshot } = await setup();
  storage.values.set('yidian.local.v1', 'original');
  assert.throws(() => engine.attach(snapshot), /已有/);
  assert.equal(storage.values.get('yidian.local.v1'), 'original');
  assert.equal(engine.read().pending, 0);
});

test('purge requires explicit confirmation and saves only the returned empty generation', async () => {
  const f = fixture();
  const snapshot = await f.seed();
  const storage = storageFixture();
  const key = PREFIX + snapshot.accountId;
  const engine = createSyncEngine({ storage, call: event => f.api(event),
    accountId: snapshot.accountId, consent: true, clock: () => f.date,
    newId: () => 'purge-client-op' });
  engine.attach(snapshot);
  storage.setStorageSync(key + ':recovery', 'old-recovery');
  const oldEpoch = snapshot.epoch;
  await assert.rejects(engine.purge(''), /确认/);
  const result = await engine.purge('DELETE_MY_DATA');
  assert.equal(result.state.habits.length, 0);
  assert.equal(result.pending, 0);
  const saved = JSON.parse(storage.getStorageSync(key));
  assert.notEqual(saved.base.epoch, oldEpoch);
  assert.equal(saved.base.state.habits.length, 0);
  assert.equal(storage.getStorageSync(key + ':recovery'), undefined);
});

test('purge failure or invalid acknowledgement preserves the confirmed snapshot and recovery copy', async () => {
  let mode = 'offline';
  const h = await setup(async (event, f) => {
    if (event.action !== 'purge') return f.api(event);
    if (mode === 'offline') throw Error('offline');
    return { ...(await f.api(event)), operationId: 'wrong-operation' };
  });
  h.storage.setStorageSync(h.key + ':recovery', 'keep-recovery');
  const before = h.engine.exportPending();
  await assert.rejects(h.engine.purge('DELETE_MY_DATA'), /offline/);
  assert.equal(h.engine.exportPending(), before);
  assert.equal(h.storage.getStorageSync(h.key + ':recovery'), 'keep-recovery');
  mode = 'invalid';
  await assert.rejects(h.engine.purge('DELETE_MY_DATA'), /确认无效/);
  assert.equal(h.engine.exportPending(), before);
  assert.equal(h.storage.getStorageSync(h.key + ':recovery'), 'keep-recovery');
});

test('离线打卡即时投影，依序提交后只清除已确认的队列', async () => {
  const { engine, f } = await setup();
  engine.enqueue(record()); engine.enqueue(record('note', { note: '今天读完' }));
  assert.equal(engine.read().pending, 2);
  assert.equal(engine.read().state.records['read@2026-09-10'].status, 'standard');
  const result = await engine.flush();
  assert.equal(result.pending, 0);
  assert.equal((await f.pull()).state.records['read@2026-09-10'].note, '今天读完');
});

test('只接受今日记录，长期修改和错误记录不会落盘', async () => {
  const { engine } = await setup(); const before = engine.exportPending();
  assert.throws(() => engine.enqueue({ type: 'edit' }), /长期修改/);
  assert.throws(() => engine.enqueue(record('complete', { date: '2026-09-09' })), /今天/);
  assert.throws(() => engine.enqueue(record('note', { note: '字'.repeat(1000) })));
  assert.equal(engine.exportPending(), before);
});

test('服务端已保存但响应丢失：原请求重试不会重复写入', async () => {
  let lose = true;
  const { engine, f } = await setup(async (e, f) => {
    const result = await f.api(e); if (lose) { lose = false; throw Error('lost response'); } return result;
  });
  engine.enqueue(record());
  assert.equal((await engine.flush()).pending, 1);
  const revision = (await f.pull()).revision;
  assert.equal((await engine.flush()).pending, 0);
  assert.equal((await f.pull()).revision, revision);
});

test('确认写本机失败时保留队首，下次幂等重试恢复', async () => {
  let storageRef, fail = true;
  const { engine, f, storage } = await setup(async (e, f) => {
    const result = await f.api(e); if (fail) storageRef.failWrite = true; return result;
  });
  storageRef = storage; engine.enqueue(record());
  await assert.rejects(engine.flush(), /保存失败/);
  assert.equal(engine.read().pending, 1);
  const revision = (await f.pull()).revision;
  fail = false; storage.failWrite = false;
  assert.equal((await engine.flush()).pending, 0);
  assert.equal((await f.pull()).revision, revision);
});

test('离线入队写入失败不能显示虚假完成', async () => {
  const { engine, storage } = await setup(); storage.failWrite = true;
  assert.throws(() => engine.enqueue(record()), /保存失败/);
  assert.equal(engine.read().pending, 0);
  assert.equal(engine.read().state.records['read@2026-09-10'], undefined);
});

test('请求飞行中新增记录不会丢失，并发flush共用一次串行任务', async () => {
  const started = deferred(), release = deferred(); let calls = 0;
  const { engine, f } = await setup(async (e, f) => {
    calls++; if (calls === 1) { started.resolve(); await release.promise; } return f.api(e);
  });
  engine.enqueue(record()); const first = engine.flush();
  await started.promise; assert.equal(engine.flush(), first);
  engine.enqueue(record('undo')); release.resolve();
  assert.equal((await first).pending, 0); assert.equal(calls, 2);
  assert.equal((await f.pull()).state.records['read@2026-09-10'].status, 'pending');
});

test('另一设备修改产生可见冲突，确认前不覆盖、不自动重排意图', async () => {
  const { engine, f } = await setup(); engine.enqueue(record());
  await f.mutate(record('note', { note: '另一设备' }));
  const result = await engine.flush();
  assert.equal(result.conflict.code, 'CONFLICT'); assert.equal(result.pending, 1);
  assert.throws(() => engine.enqueue(record('undo')), /冲突/);
  assert.throws(() => engine.useRemote(''), /明确确认/);
  const remote = engine.useRemote('DISCARD_PENDING');
  assert.equal(remote.pending, 0); assert.equal(remote.state.records['read@2026-09-10'].note, '另一设备');
  assert.equal(JSON.parse(engine.exportRecovery()).queue.length, 1);
});

test('冲突恢复备份失败时不得舍弃任何待同步操作', async () => {
  const { engine, f, storage } = await setup(); engine.enqueue(record());
  await f.mutate(record('note', { note: '冲突' })); await engine.flush();
  const before = engine.exportPending(); storage.failWrite = true;
  assert.throws(() => engine.useRemote('DISCARD_PENDING'));
  assert.equal(engine.exportPending(), before);
});

test('云端删除后的旧设备保留本机冲突，不复活云端记录', async () => {
  const { engine, f } = await setup(); engine.enqueue(record());
  const snapshot = await f.pull();
  await f.api({ action: 'purge', operationId: 'purge-op', expectedRevision: snapshot.revision,
    epoch: snapshot.epoch, operationDate: f.date, confirmation: 'DELETE_MY_DATA' });
  const result = await engine.flush();
  assert.equal(result.conflict.code, 'EPOCH_CHANGED'); assert.equal(result.pending, 1);
  assert.equal((await f.pull()).state.habits.length, 0);
  assert.equal(engine.useRemote('DISCARD_PENDING').state.habits.length, 0);
});

test('确认丢失后远端又更新：只移除已确认操作，剩余意图保持可恢复', async () => {
  let lose = true;
  const { engine, f } = await setup(async (e, f) => {
    const result = await f.api(e); if (lose) { lose = false; throw Error('lost'); } return result;
  });
  engine.enqueue(record()); engine.enqueue(record('note', { note: '本机意图' }));
  await engine.flush(); await f.mutate(record('undo'));
  const result = await engine.flush();
  assert.equal(result.conflict.code, 'REMOTE_ADVANCED'); assert.equal(result.pending, 1);
  assert.equal(result.state.records['read@2026-09-10'].note, '本机意图');
  assert.equal((await f.pull()).state.records['read@2026-09-10'].status, 'pending');
  assert.equal(JSON.parse(engine.exportPending()).queue[0].event.command.type, 'note');
});

test('过期离线操作保留并停止重试，刷新后显式处理并备份', async () => {
  const { engine, f } = await setup(); engine.enqueue(record()); f.date = '2026-09-17';
  const result = await engine.flush();
  assert.equal(result.conflict.code, 'EXPIRED_OPERATION'); assert.equal(result.pending, 1);
  assert.throws(() => engine.useRemote('DISCARD_PENDING'), /快照/);
  await engine.refresh(); assert.equal(engine.useRemote('DISCARD_PENDING').pending, 0);
  assert.equal(JSON.parse(engine.exportRecovery()).queue.length, 1);
});

test('异常响应、伪确认和跨账户快照均不清除队列', async () => {
  for (const change of [r => null, r => ({ ...r, operationId: 'wrong' }), r => ({ ...r, accountId: 'f'.repeat(64) })]) {
    const { engine } = await setup(async (e, f) => change(await f.api(e)));
    engine.enqueue(record()); await assert.rejects(engine.flush()); assert.equal(engine.read().pending, 1);
  }
});

test('慢pull不会回滚其间已保存的更新确认', async () => {
  const started = deferred(), release = deferred();
  const { engine } = await setup(async (e, f) => {
    const response = await f.api(e);
    if (e.action === 'pull') { started.resolve(); await release.promise; } return response;
  });
  const refresh = engine.refresh(); await started.promise;
  engine.enqueue(record()); await engine.flush(); release.resolve(); await refresh;
  assert.equal(engine.read().pending, 0);
  assert.equal(engine.read().state.records['read@2026-09-10'].status, 'standard');
});

test('损坏缓存停止读写，原始内容仍可导出', async () => {
  const { engine, storage, key } = await setup(); storage.values.set(key, '{broken');
  assert.throws(() => engine.read(), /损坏/); assert.throws(() => engine.enqueue(record()), /损坏/);
  assert.equal(engine.exportPending(), '{broken');
});

test('待同步数量与重复ID有界，损坏队列不自动修复覆盖', async () => {
  const { engine, storage, key } = await setup();
  for (let i = 0; i < 200; i++) engine.enqueue(record());
  assert.throws(() => engine.enqueue(record()), /较多/);
  const envelope = JSON.parse(engine.exportPending());
  envelope.queue[1] = copy(envelope.queue[0]); storage.values.set(key, JSON.stringify(envelope));
  assert.throws(() => engine.read(), /队列格式/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, plan, domain, dates, storageFixture } = require('./helpers/cloud-fixture.cjs');
const { createSyncEngine } = require('../miniprogram/services/sync-engine');

const day = '2026-09-10';
const command = (type = 'completeMinimum', id = 'read', date = day) => ({ type, id, date });
function stateWith(planOverrides = {}) {
  return domain.reduce(domain.emptyState(), {
    type: 'create', id: 'read', startDate: day, plan: plan(planOverrides)
  }, day);
}

test('busy-goal check-in writes the configured target and status in one revision', () => {
  const before = stateWith();
  const after = domain.reduce(before, command(), day);
  assert.equal(after.revision, before.revision + 1);
  assert.deepEqual(after.records['read@' + day], {
    id: 'read', date: day, versionRevision: 1, todayTarget: 2, status: 'minimum', note: ''
  });
  assert.equal(before.records['read@' + day], undefined);
  assert.equal(domain.validateState(after), after);
  assert.equal(domain.summary(after, day, 7).minimum, 1);
});

test('busy-goal check-in rejects missing goal, custom goal, already done and stale day without changing input', () => {
  const without = stateWith({ minimum: null });
  assert.throws(() => domain.reduce(without, command(), day), /没有设置忙时目标/);
  const base = stateWith();
  const custom = domain.reduce(base, { type: 'simplify', id: 'read', date: day, target: 1 }, day);
  assert.throws(() => domain.reduce(custom, command(), day), /已调整/);
  const done = domain.reduce(base, command(), day);
  assert.throws(() => domain.reduce(done, command(), day), /已打卡/);
  assert.throws(() => domain.reduce(base, command('completeMinimum', 'read', day), dates.shift(day, 1)), /日期/);
  assert.equal(Object.keys(base.records).length, 0);
  assert.equal(custom.records['read@' + day].todayTarget, 1);
});

test('server derives busy goal and rejects injected target, preserving another user', async () => {
  const f = fixture(), snapshot = await f.seed();
  const injected = await f.api(f.request(snapshot, { ...command(), target: 1 }));
  assert.equal(injected.code, 'INVALID_REQUEST');
  const b = await f.api({action:'pull'}, {...f.identity, OPENID:'other-user'});
  assert.notEqual(b.accountId, snapshot.accountId);
  assert.equal((await f.api(f.request(b, command()), {...f.identity, OPENID:'other-user'})).code, 'INVALID_COMMAND');
  const request = f.request(snapshot, command());
  const first = await f.api(request);
  assert.equal(first.ok, true);
  assert.equal(first.state.records['read@' + day].todayTarget, 2);
  const replay = await f.api(request);
  assert.equal(replay.replayed, true);
  assert.equal(replay.revision, first.revision);
  assert.equal((await f.api(f.request(snapshot, command()))).code, 'CONFLICT');
  assert.equal((await f.api({action:'pull'}, {...f.identity, OPENID:'other-user'})).state.habits.length, 0);
});

test('offline busy-goal check-in projects immediately, keeps queue until server confirms', async () => {
  const f = fixture(), snapshot = await f.seed(), storage = storageFixture();
  let online = false;
  const engine = createSyncEngine({ storage, call: event => online ? f.api(event) : Promise.reject(Error('offline')),
    accountId: snapshot.accountId, consent: true, clock: () => f.date, newId: () => 'busy-op' });
  engine.attach(snapshot);
  engine.enqueue(command());
  assert.equal(engine.read().pending, 1);
  assert.equal(engine.read().state.records['read@' + day].status, 'minimum');
  assert.equal((await engine.flush()).pending, 1);
  assert.equal((await f.pull()).state.records['read@' + day], undefined);
  online = true;
  assert.equal((await engine.flush()).pending, 0);
  assert.equal((await f.pull()).state.records['read@' + day].todayTarget, 2);
});

test('another device advancing the account keeps the pending busy-goal check-in visible as a conflict', async () => {
  const f = fixture(), snapshot = await f.seed(), storage = storageFixture();
  const engine = createSyncEngine({ storage, call: event => f.api(event),
    accountId: snapshot.accountId, consent: true, clock: () => f.date, newId: () => 'busy-conflict' });
  engine.attach(snapshot);
  engine.enqueue(command());
  await f.mutate({type:'note',id:'read',date:day,note:'来自另一设备'});
  const result = await engine.flush();
  assert.equal(result.pending, 1);
  assert.equal(result.conflict.code, 'CONFLICT');
  assert.equal(engine.read().state.records['read@' + day].status, 'minimum');
  assert.equal((await f.pull()).state.records['read@' + day].status, 'pending');
});

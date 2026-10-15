const test = require('node:test');
const assert = require('node:assert/strict');
const { createApi } = require('../server/handler');
const { fail } = require('../server/protocol');
const { domain, dates, plan, copy } = require('./helpers/cloud-fixture.cjs');

function photoFixture() {
  let account = null, bindings = new Map(), serial = 0, guardCalls = 0;
  const f = { failCommit: false, required: false, guardCalls: () => guardCalls,
    identity: { APPID: 'wx-photo-test', OPENID: 'photo-user', SOURCE: 'wx_client' }, date: '2026-10-13' };
  const repository = { async transact(owner, work) {
    const draft = new Map([...bindings].map(([id, value]) => [id, copy(value)]));
    const result = await work(copy(account), { owner, bindings: draft });
    if (f.failCommit) throw Error('COMMIT_FAILED');
    account = copy(result.account); bindings = draft; return copy(result.result);
  } };
  const guard = async (tx, previous, command) => {
    guardCalls++;
    if (['complete', 'completeMinimum'].includes(command.type)) {
      assert.equal(previous.state.records['read@' + f.date]?.status || 'pending', 'pending');
      if (f.required && !command.mediaIds?.length) fail('PHOTO_REQUIRED', '此习惯需要照片打卡');
      if (command.mediaIds?.length) tx.bindings.set('read@' + f.date, command.mediaIds);
    } else if (command.type === 'undo') tx.bindings.delete('read@' + f.date);
    else if (command.type === 'purge') { assert.ok(previous.state.habits.length); tx.bindings.clear(); }
  };
  const api = createApi({ repository, domain, dates, recordMutationGuard: guard, allowedAppId: f.identity.APPID,
    allowedSources: ['wx_client'], clock: () => new Date(f.date + 'T04:00:00Z'), newEpoch: () => 'photo-epoch' });
  f.api = event => api(event, f.identity);
  f.pull = () => f.api({ action: 'pull' });
  f.request = (snapshot, command) => ({ action: 'mutate', epoch: snapshot.epoch, expectedRevision: snapshot.revision,
    operationId: 'photo-op-' + (++serial), operationDate: f.date, command });
  f.mutate = async command => f.api(f.request(await f.pull(), command));
  f.bindings = () => bindings;
  f.seed = () => f.mutate({ type: 'create', id: 'read', startDate: f.date, plan: plan() });
  return f;
}

test('required photos guard old clients and commit binding with completion; failed commit rolls both back', async () => {
  const f = photoFixture(); await f.seed(); f.required = true;
  assert.equal((await f.mutate({ type: 'complete', id: 'read', date: f.date })).code, 'PHOTO_REQUIRED');
  assert.equal((await f.pull()).state.records['read@' + f.date], undefined);
  const request = f.request(await f.pull(), { type: 'completeMinimum', id: 'read', date: f.date, mediaIds: ['photo-one'] });
  f.failCommit = true;
  assert.equal((await f.api(request)).code, 'SERVICE_UNAVAILABLE');
  assert.equal(f.bindings().size, 0);
  f.failCommit = false;
  assert.equal((await f.pull()).state.records['read@' + f.date], undefined);
  const saved = await f.api(request); assert.equal(saved.ok, true); assert.equal(saved.state.records['read@' + f.date].status, 'minimum');
  assert.deepEqual(f.bindings().get('read@' + f.date), ['photo-one']);
  const calls = f.guardCalls();
  assert.equal((await f.api(request)).replayed, true); assert.equal(f.guardCalls(), calls, 'receipt replay precedes photo effects');
  await f.mutate({ type: 'undo', id: 'read', date: f.date });
  assert.equal(f.bindings().size, 0); assert.equal((await f.pull()).state.records['read@' + f.date].status, 'pending');
});

test('invalid photo commands and disabled integration cannot discard photos while claiming completion', async () => {
  const f = photoFixture(); await f.seed(); const calls = f.guardCalls();
  for (const mediaIds of [['photo', 'photo'], ['a', 'b', 'c', 'd'], ['other/unsafe'], 'photo']) {
    assert.equal((await f.mutate({ type: 'complete', id: 'read', date: f.date, mediaIds })).code, 'INVALID_REQUEST');
  }
  assert.equal(f.guardCalls(), calls);
  assert.equal((await f.mutate({ type: 'completeMinimum', id: 'missing', date: f.date, mediaIds: ['photo'] })).code, 'INVALID_COMMAND');
  assert.equal(f.guardCalls(), calls, 'invalid reducer cannot create a binding');
  const legacy = require('./helpers/cloud-fixture.cjs').fixture(); await legacy.seed();
  assert.equal((await legacy.mutate({ type: 'complete', id: 'read', date: legacy.date, mediaIds: ['photo'] })).code, 'NOT_ENABLED');
});

test('purge guard receives deleted account before epoch replacement and is not replayed', async () => {
  const f = photoFixture(); await f.seed();
  await f.mutate({ type: 'complete', id: 'read', date: f.date, mediaIds: ['photo'] });
  const before = await f.pull(), request = { action: 'purge', epoch: before.epoch, expectedRevision: before.revision,
    operationId: 'photo-purge', operationDate: f.date, confirmation: 'DELETE_MY_DATA' };
  assert.equal((await f.api(request)).ok, true); assert.equal(f.bindings().size, 0);
  const calls = f.guardCalls(); assert.equal((await f.api(request)).replayed, true); assert.equal(f.guardCalls(), calls);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { supervisionFixture } = require('./helpers/supervision-fixture.cjs');
const { bindingId } = require('../server/supervision-repository');

test('actual guard blocks old no-photo client and binds pending uploads atomically with retriable completion', async () => {
  const f = await supervisionFixture(); await f.agreement({ required: true });
  const date = f.dates.today(f.now.getTime());
  assert.equal((await f.mutate({ type: 'complete', id: 'read', date })).code, 'PHOTO_REQUIRED');
  const photo = await f.photo(), id = photo.media.mediaId, before = await f.pull();
  const request = { action: 'mutate', epoch: before.epoch, expectedRevision: before.revision, operationId: 'actual-photo-complete',
    operationDate: date, command: { type: 'completeMinimum', id: 'read', date, mediaIds: [id] } };
  f.failWrite = true; assert.equal((await f.api(request, f.a)).code, 'SERVICE_UNAVAILABLE'); f.failWrite = false;
  assert.equal(f.tables.bindings.size, 0); assert.equal(f.tables.media.get(id).bound, false);
  const completed = await f.api(request, f.a); assert.equal(completed.ok, true); assert.equal(completed.state.records['read@' + date].status, 'minimum');
  const media = f.tables.media.get(id); assert.equal(media.status, 'pending'); assert.equal(media.bound, true);
  const revision = [...f.tables.bindings.values()][0].revision;
  assert.equal((await f.api(request, f.a)).replayed, true); assert.equal([...f.tables.bindings.values()][0].revision, revision);
});

test('actual guard rejects wrong owner, date, metadata and known rejected photos while preserving confirmed completion', async () => {
  for (const patch of [{ owner: 'b'.repeat(64) }, { ownerEpoch: 'another' }, { date: '2026-10-12' }, { metadataVerified: false }, { status: 'risky' }]) {
    const f = await supervisionFixture(); await f.agreement({ required: true });
    const photo = await f.photo(), id = photo.media.mediaId, date = f.dates.today(f.now.getTime());
    Object.assign(f.tables.media.get(id), patch);
    assert.equal((await f.mutate({ type: 'complete', id: 'read', date, mediaIds: [id] })).ok, false);
    assert.equal((await f.pull()).state.records['read@' + date], undefined); assert.equal(f.tables.bindings.size, 0);
  }
  const f = await supervisionFixture(); const agreement = await f.agreement({ required: true });
  const photo = await f.photo(), id = photo.media.mediaId, date = f.dates.today(f.now.getTime());
  await f.mutate({ type: 'complete', id: 'read', date, mediaIds: [id] });
  f.tables.media.get(id).status = 'risky';
  assert.equal((await f.pull()).state.records['read@' + date].status, 'standard');
  const record = await f.mediaRequest('getRecordMedia', { supervisionId: agreement.supervision.supervisionId, date }, f.b);
  assert.equal(record.ok, true); assert.deepEqual(record.recordMedia.items, []); assert.equal(record.recordMedia.unavailableCount, 1);
  await f.mutate({ type: 'undo', id: 'read', date });
  assert.equal(f.tables.media.get(id).bound, false);
  assert.equal((await f.mutate({ type: 'complete', id: 'read', date, mediaIds: [id] })).code, 'MEDIA_CHECK_REJECTED');
});

test('last required photo deletion demands confirmation and atomically undoes; relation ends on habit deletion or either account purge', async () => {
  const f = await supervisionFixture(); await f.agreement({ required: true });
  const photo = await f.photo(), id = photo.media.mediaId, date = f.dates.today(f.now.getTime());
  await f.mutate({ type: 'complete', id: 'read', date, mediaIds: [id] });
  const snapshot = await f.pull(), fields = { habitId: 'read', date, expectedRevision: snapshot.revision, mediaIds: [] };
  assert.equal((await f.mediaRequest('updateRecordMedia', fields)).code, 'CONFIRMATION_REQUIRED');
  f.failWrite = true;
  assert.equal((await f.mediaRequest('updateRecordMedia', { ...fields, confirmation: 'REMOVE_LAST_PHOTO_AND_UNDO' })).code, 'SERVICE_UNAVAILABLE'); f.failWrite = false;
  assert.equal((await f.pull()).state.records['read@' + date].status, 'standard'); assert.equal(f.tables.media.get(id).bound, true);
  const removed = await f.mediaRequest('updateRecordMedia', { ...fields, confirmation: 'REMOVE_LAST_PHOTO_AND_UNDO' });
  assert.equal(removed.ok, true); assert.equal(removed.snapshot.state.records['read@' + date].status, 'pending'); assert.equal(f.tables.media.get(id).bound, false);
  assert.deepEqual(f.tables.bindings.get(bindingId(f.owner(f.a), snapshot.epoch, 'read', date)).mediaIds, []);
  for (const action of ['deleteHabit', 'subjectPurge', 'supervisorPurge']) {
    const g = await supervisionFixture(); await g.agreement({ required: true });
    if (action === 'deleteHabit') assert.equal((await g.mutate({ type: 'deleteHabit', id: 'read', baseRevision: 1 })).ok, true);
    else {
      const identity = action === 'subjectPurge' ? g.a : g.b, old = await g.pull(identity);
      assert.equal((await g.api({ action: 'purge', epoch: old.epoch, expectedRevision: old.revision,
        operationId: 'actual-purge-' + action, operationDate: date, confirmation: 'DELETE_MY_DATA' }, identity)).ok, true);
    }
    assert.equal([...g.tables.relations.values()][0].status, 'ended', action);
  }
});

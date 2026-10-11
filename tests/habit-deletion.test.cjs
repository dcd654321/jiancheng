const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, domain, dates, plan, copy } = require('./helpers/cloud-fixture.cjs');
const { featuresFixture } = require('./helpers/features-fixture.cjs');
const { reminderFixture } = require('./helpers/reminder-fixture.cjs');
const remove = habit => ({ type: 'deleteHabit', id: habit.id, baseRevision: habit.revision });

test('delete removes all target dates and future versions, keeps similar ids/settings and never mutates input', () => {
  const day = '2026-10-09', first = dates.shift(day, -2);
  let state = domain.emptyState();
  for (const id of ['read', 'read_more']) state = domain.reduce(state, { type: 'create', id, startDate: first, plan: plan() }, first);
  for (let offset = -2; offset <= 0; offset++) {
    const date = dates.shift(day, offset);
    state = domain.reduce(state, { type: 'note', id: 'read', date, note: 'private' }, date);
    if (offset !== -1) state = domain.reduce(state, { type: 'complete', id: 'read', date }, date);
  }
  state = domain.reduce(state, { type: 'complete', id: 'read_more', date: day }, day);
  state = domain.reduce(state, { type: 'settings', hideQuote: true }, day);
  state = domain.reduce(state, { type: 'edit', id: 'read', baseRevision: 1, plan: plan({ target: 8 }) }, day);
  const before = copy(state), result = domain.reduce(state, remove(state.habits[0]), day);
  assert.deepEqual(state, before); assert.equal(result.revision, state.revision + 1);
  assert.deepEqual(result.habits, [before.habits[1]]);
  assert.deepEqual(result.records, { ['read_more@' + day]: before.records['read_more@' + day] });
  assert.deepEqual(result.settings, before.settings); domain.validateState(result);
  assert.deepEqual(domain.tasksOn(result, day).map(t => t.id), ['read_more']);
  assert.equal(domain.summary(result, day, 7).done, 1);
});

test('active, paused, archived and future-only habits can be deleted; invalid targets and revisions cannot', () => {
  const day = '2026-10-09';
  for (const status of ['active', 'paused', 'archived', 'future']) {
    const startDate = status === 'future' ? dates.shift(day, 1) : day;
    let state = domain.reduce(domain.emptyState(), { type: 'create', id: 'read', startDate, plan: plan() }, day);
    if (['paused', 'archived'].includes(status)) {
      state = domain.reduce(state, { type: 'status', id: 'read', baseRevision: 1, status }, day);
    }
    const result = domain.reduce(state, remove(state.habits[0]), day);
    assert.equal(result.habits.length, 0); domain.validateState(result);
    assert.throws(() => domain.reduce(state, { type: 'deleteHabit', id: 'read', baseRevision: 99 }, day), /重新查看/);
    assert.throws(() => domain.reduce(state, { type: 'deleteHabit', id: 'missing', baseRevision: 1 }, day), /未找到/);
    assert.throws(() => domain.reduce(state, { type: 'deleteHabit', id: '__proto__', baseRevision: 1 }, day), /标识/);
  }
});

test('API deletion is private, immediately atomic and a replay cannot delete a recreated id', async () => {
  const f = fixture(), a = await f.seed(), other = { ...f.identity, OPENID: 'test_other' };
  const b = await f.api({ action: 'pull' }, other);
  await f.api(f.request(b, { type: 'create', id: 'read', startDate: f.date, plan: plan() }), other);
  await f.mutate({ type: 'note', id: 'read', date: f.date, note: 'private-note' });
  const event = f.request(await f.pull(), { type: 'deleteHabit', id: 'read', baseRevision: 1 });
  const result = await f.api(event);
  assert.equal(result.ok, true); assert.equal(result.epoch, a.epoch);
  assert.deepEqual(result.state.habits, []); assert.deepEqual(result.state.records, {});
  assert.doesNotMatch(JSON.stringify(result), /private-note/);
  assert.equal((await f.api({ action: 'pull' }, other)).state.habits.length, 1);
  await f.mutate({ type: 'create', id: 'read', startDate: f.date, plan: plan() });
  const before = copy([...f.db]), replay = await f.api(event);
  assert.equal(replay.replayed, true); assert.equal(replay.state.habits.length, 1);
  assert.deepEqual([...f.db], before);
});

test('API rejects unsafe deletion fields, spoofed identities, stale versions, dates and failed writes', async () => {
  const f = fixture(); await f.seed();
  const a = await f.pull(), command = { type: 'deleteHabit', id: 'read', baseRevision: 1 };
  for (const changed of [{ ...command, baseRevision: '1' }, { ...command, baseRevision: 0 }, { ...command, id: ['read'] },
    { ...command, owner: 'injected' }, { ...command, confirmation: true }]) {
    assert.equal((await f.api(f.request(a, changed))).code, 'INVALID_REQUEST');
  }
  assert.equal((await f.api({ ...f.request(a, command), OPENID: 'injected' })).code, 'INVALID_REQUEST');
  assert.equal((await f.api(f.request(a, command), { ...f.identity, SOURCE: 'http' })).code, 'UNAUTHORIZED');
  assert.equal((await f.api(f.request(a, command, { epoch: 'old' }))).code, 'EPOCH_CHANGED');
  assert.equal((await f.api(f.request(a, command, { operationDate: dates.shift(f.date, -1) }))).code, 'RECONFIRM_REQUIRED');
  await f.mutate({ type: 'settings', hideQuote: true });
  assert.equal((await f.api(f.request(a, command))).code, 'CONFLICT');
  const event = f.request(await f.pull(), command), before = copy([...f.db]); f.failWrite = true;
  assert.equal((await f.api(event)).code, 'SERVICE_UNAVAILABLE'); assert.deepEqual([...f.db], before);
});

test('existing public shares remain independent while deletion invalidates an uncreated preview', async () => {
  const f = featuresFixture(); await f.seed();
  const first = await f.features(await f.requestShare('plan', { sourceHabitId: 'read', categoryKey: 'read', includeWeekdays: false }), f.identity);
  const pending = await f.requestShare('plan', { sourceHabitId: 'read', categoryKey: 'read', includeWeekdays: false });
  assert.equal((await f.mutate({ type: 'deleteHabit', id: 'read', baseRevision: 1 })).ok, true);
  assert.equal((await f.features(pending, f.identity)).code, 'PREVIEW_CHANGED');
  assert.equal((await f.publicShare({ action: 'getPublicShare', shareId: first.share.shareId })).ok, true);
  const a = await f.pull();
  assert.equal((await f.features({ action: 'previewShare', epoch: a.epoch, kind: 'plan', sourceHabitId: 'read',
    categoryKey: 'read', includeWeekdays: false }, f.identity)).code, 'PLAN_UNAVAILABLE');
});

test('reminder final check excludes deleted habits and cancels when no tasks remain', async () => {
  for (const keepAnother of [true, false]) {
    const f = reminderFixture(); await f.seed();
    if (keepAnother) await f.mutate({ type: 'create', id: 'walk', startDate: f.date, plan: plan() });
    const preview = await f.preview(); await f.schedule(preview);
    await f.mutate({ type: 'deleteHabit', id: 'read', baseRevision: 1 });
    f.time = Date.parse(preview.dueAt) + 1000;
    const result = await f.worker()();
    assert.equal(result.sent, keepAnother ? 1 : 0);
    assert.equal([...f.reminders.values()][0].status, keepAnother ? 'sent' : 'cancelled');
    if (keepAnother) assert.equal(f.sends[0].count, 1);
  }
});

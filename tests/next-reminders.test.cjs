const test = require('node:test');
const assert = require('node:assert/strict');
const { createReminderApi, createRecipientCodec, recipientAAD, reminderId } = require('../server/reminders');
const { createReminderWorker, createSender } = require('../server/reminder-worker');
const { reminderFixture } = require('./helpers/reminder-fixture.cjs');
const { domain, dates, fixture, copy } = require('./helpers/cloud-fixture.cjs');

async function nextFixture() {
  const f = reminderFixture(), a = await f.seed();
  const config = { repository: f.repository, domain, dates, codec: f.codec, templateIds: { self: 'next-self-template', supervisor: 'next-supervisor-template' },
    allowedAppId: f.identity.APPID, allowedSources: ['wx_client'], clock: () => new Date(f.time) };
  const api = createReminderApi(config);
  f.next = request => api({ epoch: a.epoch, ...request }, f.identity);
  f.nextPreview = input => f.next({ action: 'previewReminder', type: 'self', businessDate: f.date, ...input });
  f.nextSchedule = preview => { const { templateId, items, ...fields } = preview; return f.next({ action: 'scheduleReminder', ...fields, subscriptionResult: 'accept' }); };
  f.nextWorker = overrides => createReminderWorker({ ...config, send: async value => { f.sends.push(value); return { errCode: 0 }; }, ...overrides });
  return f;
}

test('arbitrary-time self preview selects explicit owned habits; denied subscription or forged scope never schedules', async () => {
  const f = await nextFixture(); const result = await f.nextPreview({ slot: '12:37', habitIds: ['read'] });
  assert.equal(result.ok, true); const p = result.preview;
  assert.equal(p.dueAt, f.date + 'T04:37:00.000Z'); assert.equal(p.type, 'self'); assert.equal(p.items[0].title, '读一会儿');
  const { templateId, items, ...fields } = p;
  assert.equal((await f.next({ action: 'scheduleReminder', ...fields, subscriptionResult: 'reject' })).code, 'INVALID_REQUEST');
  assert.equal((await f.nextSchedule({ ...p, scopeFingerprint: 'a'.repeat(64) })).code, 'PREVIEW_CHANGED');
  assert.equal((await f.nextPreview({ slot: '25:00' })).code, 'INVALID_REQUEST');
  assert.equal((await f.nextPreview({ slot: '12:37', habitIds: ['not-mine'] })).code, 'INVALID_REQUEST');
  assert.equal((await f.nextPreview({ slot: '12:37', habitIds: ['read', 'read'] })).code, 'INVALID_REQUEST');
  assert.equal(f.reminders.size, 0);
  const saved = await f.nextSchedule(p); assert.equal(saved.ok, true);
  assert.equal(f.codec.open([...f.reminders.values()][0].recipient, recipientAAD([...f.reminders.values()][0])), f.identity.OPENID);
});

test('new and old self protocols share daily quota, replay is stable, list can include both kinds', async () => {
  const f = await nextFixture(), p = (await f.nextPreview({ slot: '12:37' })).preview;
  const saved = await f.nextSchedule(p); assert.equal(saved.ok, true); assert.equal((await f.nextSchedule(p)).replayed, true);
  assert.equal((await f.reminderApi({ action: 'previewReminder', epoch: (await f.pull()).epoch, slot: '20:30' })).code, 'REMINDER_EXISTS');
  const list = await f.next({ action: 'getReminders', includeTypes: true }); assert.equal(list.items.length, 1); assert.equal(list.items[0].type, 'self');
  const cancel = { action: 'cancelReminder', type: 'self', businessDate: f.date, generation: 1 };
  assert.equal((await f.next(cancel)).reminder.status, 'cancelled'); assert.equal((await f.nextSchedule(p)).reminder.status, 'cancelled');
  const later = (await f.nextPreview({ slot: '13:07' })).preview;
  assert.equal((await f.nextSchedule(later)).reminder.generation, 2); assert.equal((await f.next(cancel)).code, 'CONFLICT');
  assert.notEqual(reminderId('owner', 'epoch', f.date, 'supervisor'), reminderId('owner', 'epoch', f.date));
});

test('v2 self worker rechecks completion, concurrent workers send once, unknown never retries', async () => {
  const f = await nextFixture(), p = (await f.nextPreview({ slot: '12:37' })).preview; await f.nextSchedule(p); f.time = Date.parse(p.dueAt);
  await Promise.all([f.nextWorker()(), f.nextWorker()()]); assert.equal(f.sends.length, 1); assert.equal(f.sends[0].type, 'self');
  assert.equal([...f.reminders.values()][0].status, 'sent'); await f.nextWorker()(); assert.equal(f.sends.length, 1);
  const completed = await nextFixture(), pp = (await completed.nextPreview({ slot: '12:37' })).preview; await completed.nextSchedule(pp);
  await completed.mutate({ type: 'complete', id: 'read', date: completed.date }); completed.time = Date.parse(pp.dueAt); await completed.nextWorker()();
  assert.equal(completed.sends.length, 0); assert.equal([...completed.reminders.values()][0].status, 'cancelled');
  const uncertain = await nextFixture(), up = (await uncertain.nextPreview({ slot: '12:37' })).preview; await uncertain.nextSchedule(up); uncertain.time = Date.parse(up.dueAt);
  let attempts = 0;
  await uncertain.nextWorker({ timeoutMs: 5, send: () => { attempts++; return new Promise(() => {}); } })();
  assert.equal([...uncertain.reminders.values()][0].status, 'unknown'); await uncertain.nextWorker()(); assert.equal(attempts, 1);
});

test('new scopes require matching dedicated templates and sender routes each recipient-owned kind independently', async () => {
  const f = await nextFixture();
  const disabled = createReminderApi({ repository: f.repository, domain, dates, codec: createRecipientCodec('c'.repeat(64)),
    templateId: 'only-self-template', allowedAppId: f.identity.APPID, allowedSources: ['wx_client'], clock: () => new Date(f.time) });
  assert.equal((await disabled({ action: 'previewReminder', type: 'supervisor', epoch: (await f.pull()).epoch, businessDate: f.date }, f.identity)).code, 'NOT_ENABLED');
  const calls = [], fields = { text: 'thing1', count: 'number2', time: 'time3' };
  const send = createSender({ openapi: { subscribeMessage: { send: async value => { calls.push(value); return { errCode: 0 }; } } } },
    { templateIds: { self: 'self-template-test', supervisor: 'supervisor-template-test' }, fieldsByType: { self: fields, supervisor: fields }, state: 'trial' });
  await send({ type: 'self', recipient: 'first', count: 1, businessDate: f.date, slot: '18:07' });
  await send({ type: 'supervisor', recipient: 'second', count: 2, businessDate: f.date, slot: '00:05', dueAt: f.date + 'T16:05:00.000Z' });
  assert.equal(calls[0].templateId, 'self-template-test'); assert.equal(calls[1].templateId, 'supervisor-template-test');
  assert.equal(calls[1].page, 'pages/supervision/index?tab=supervisor'); assert.equal(calls[1].touser, 'second');
  assert.deepEqual(calls[1].data.time3, { value: dates.shift(f.date, 1) + ' 00:05' });
  const selfOnly = createSender({ openapi: { subscribeMessage: { send: async () => assert.fail('must not send') } } },
    { templateId: 'self-template-test', fields, state: 'trial' });
  await assert.rejects(selfOnly({ type: 'supervisor', recipient: 'second', count: 1, businessDate: f.date, slot: '21:15' }));
});

async function supervisorFixture(deadline = '21:00') {
  const core = fixture(), subject = await core.seed();
  const identity = { ...core.identity, OPENID: 'supervisor-recipient' }, recipient = await core.api({ action: 'pull' }, identity);
  const relationId = 'a'.repeat(64), relation = { _id: relationId, schemaVersion: 1, status: 'active', revision: 1,
    subjectOwner: subject.accountId, subjectEpoch: subject.epoch, supervisorOwner: recipient.accountId, supervisorEpoch: recipient.epoch,
    habitId: 'read', startDate: core.date, endDate: dates.shift(core.date, 6), rules: [{ effectiveDate: core.date, deadline, photoRequired: true }] };
  const index = { _id: recipient.accountId, owner: recipient.accountId, ownerEpoch: recipient.epoch, relationIds: [relationId], inviteIds: [], receipts: [] };
  const jobs = new Map(), sends = [], f = { core, identity, subject, recipient, relation, relationId, jobs, sends, time: Date.parse(core.date + 'T04:00:00Z') };
  let tail = Promise.resolve();
  const repository = { transact(owner, work) {
    const result = tail.then(async () => {
      const draft = new Map([...jobs].map(([id, value]) => [id, copy(value)]));
      const output = await work({ account: async () => copy(core.db.get(owner)), subjectAccount: async id => copy(core.db.get(id)),
        supervisionIndex: async id => id === recipient.accountId ? copy(index) : null,
        supervision: async id => id === relationId ? copy(relation) : null,
        reminder: async id => copy(draft.get(id)), put: async doc => draft.set(doc._id, copy(doc)) });
      jobs.clear(); for (const [id, value] of draft) jobs.set(id, value); return output;
    }); tail = result.catch(() => {}); return result;
  }, due: async (now, limit) => [...jobs.values()].filter(doc => doc.status === 'pending' && Date.parse(doc.dueAt) <= now.getTime()).slice(0, limit).map(copy),
    stale: async (now, limit) => [...jobs.values()].filter(doc => doc.status === 'claimed' && Date.parse(doc.claimedAt) <= now.getTime() - 300000).slice(0, limit).map(copy) };
  const codec = createRecipientCodec('e'.repeat(64));
  const config = { repository, domain, dates, codec, templateIds: { self: 'recipient-self-template', supervisor: 'recipient-supervisor-template' },
    allowedAppId: identity.APPID, allowedSources: ['wx_client'], clock: () => new Date(f.time) };
  const api = createReminderApi(config);
  f.api = event => api({ epoch: recipient.epoch, ...event }, identity);
  f.preview = input => f.api({ action: 'previewReminder', type: 'supervisor', businessDate: core.date, relationIds: [relationId], ...input });
  f.schedule = preview => { const { templateId, items, ...fields } = preview; return f.api({ action: 'scheduleReminder', ...fields, subscriptionResult: 'accept' }); };
  f.worker = overrides => createReminderWorker({ ...config, send: async value => { sends.push(value); return { errCode: 0 }; }, ...overrides });
  f.codec = codec;
  return f;
}

test('supervisor preview uses only authorized relations, defaults cutoff+15 and encrypts the supervisor recipient', async () => {
  const f = await supervisorFixture(), p = (await f.preview()).preview;
  assert.equal(p.slot, '21:15'); assert.deepEqual(p.items, [{ habitId: 'read', title: '读一会儿', relationId: f.relationId, deadline: '21:00' }]);
  assert.doesNotMatch(JSON.stringify(p), /subjectOwner|subjectEpoch|supervisorOwner|note|media/);
  assert.equal((await f.preview({ slot: '21:14' })).code, 'BEFORE_DEADLINE');
  assert.equal((await f.preview({ relationIds: ['b'.repeat(64)] })).code, 'NO_SCHEDULE');
  assert.equal((await f.schedule(p)).ok, true);
  const doc = [...f.jobs.values()][0]; assert.equal(f.codec.open(doc.recipient, recipientAAD(doc)), f.identity.OPENID);
  const self = await f.api({ action: 'previewReminder', type: 'self', businessDate: f.core.date, slot: '21:15' });
  assert.equal(self.code, 'NO_SCHEDULE', 'supervisor cannot schedule personal reminders for the subject account');
});

test('supervisor worker rechecks both epochs, relation and completion twice; processing photos do not cause a nudge', async () => {
  for (const scenario of ['completed', 'subject-epoch', 'recipient-epoch', 'ended', 'after-claim', 'rest']) {
    const f = await supervisorFixture(), p = (await f.preview()).preview; await f.schedule(p); f.time = Date.parse(p.dueAt);
    const subject = f.core.db.get(f.subject.accountId);
    if (scenario === 'completed') {
      subject.state = domain.reduce(subject.state, { type: 'complete', id: 'read', date: f.core.date }, f.core.date);
      subject.state.records['read@' + f.core.date].photoStatus = 'pending';
    }
    if (scenario === 'subject-epoch') subject.epoch = 'changed-subject';
    if (scenario === 'recipient-epoch') f.core.db.get(f.recipient.accountId).epoch = 'changed-recipient';
    if (scenario === 'ended') f.relation.status = 'ended';
    if (scenario === 'rest') subject.state.habits[0].versions[0].weekdays = [dates.weekday(dates.shift(f.core.date, 1))];
    await f.worker(scenario === 'after-claim' ? { limiter: async () => { f.relation.status = 'ended'; } } : {})();
    assert.equal(f.sends.length, 0, scenario); assert.equal([...f.jobs.values()][0].status, 'cancelled', scenario);
  }
});

test('supervisor cutoff across midnight preserves original business date and sends next-day once', async () => {
  const f = await supervisorFixture('23:50'), p = (await f.preview()).preview;
  assert.equal(p.businessDate, f.core.date); assert.equal(p.slot, '00:05'); assert.equal(p.dueAt, f.core.date + 'T16:05:00.000Z');
  await f.schedule(p); f.time = Date.parse(p.dueAt);
  await Promise.all([f.worker()(), f.worker()()]); assert.equal(f.sends.length, 1); assert.equal(f.sends[0].count, 1);
  assert.equal(f.sends[0].type, 'supervisor'); assert.equal([...f.jobs.values()][0].status, 'sent');
});

test('cross-midnight and next-business-date appointments share actual delivery-day quota including sent or unknown outcomes', async () => {
  for (const outcome of ['pending', 'sent', 'unknown', 'cancelled']) {
    const f = await supervisorFixture('23:50'), nextDay = dates.shift(f.core.date, 1);
    f.relation.rules.push({ effectiveDate: nextDay, deadline: '21:00', photoRequired: true });
    const first = (await f.preview()).preview; await f.schedule(first);
    const previous = [...f.jobs.values()][0]; previous.status = outcome;
    const next = await f.preview({ businessDate: nextDay });
    if (outcome === 'cancelled') {
      assert.equal(next.ok, true); assert.equal((await f.schedule(next.preview)).ok, true);
      assert.equal((await f.preview()).code, 'REMINDER_EXISTS', 'cancelled business-date job cannot be revived alongside the new same-delivery-day job');
    } else assert.equal(next.code, 'REMINDER_EXISTS', outcome);
  }
});

test('supervisor recent states remain readable without exposing ended or epoch-invalid subject titles', async () => {
  for (const scenario of ['ended', 'subject-epoch', 'expired']) {
    const f = await supervisorFixture(), p = (await f.preview()).preview; await f.schedule(p);
    if (scenario === 'ended') f.relation.status = 'ended';
    if (scenario === 'subject-epoch') f.core.db.get(f.subject.accountId).epoch = 'new-subject';
    if (scenario === 'expired') { f.relation.endDate = f.core.date; f.time += 86400000; }
    const list = await f.api({ action: 'getReminders', includeTypes: true }); assert.equal(list.ok, true);
    assert.equal(list.items[0].status, 'pending'); assert.deepEqual(list.items[0].items, [], scenario);
    const replay = await f.schedule(p); assert.equal(replay.replayed, true); assert.deepEqual(replay.reminder.items, [], scenario);
  }
});

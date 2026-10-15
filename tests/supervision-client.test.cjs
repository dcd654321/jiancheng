const test = require('node:test');
const assert = require('node:assert/strict');
const { createSupervisionClient, sorted } = require('../miniprogram/services/supervision-client');
const names = require('../miniprogram/config/cloud-resources');
const invitation = { inviteId: 'b'.repeat(64), status: 'open', expiresAt: '2026-10-15T04:00:00.000Z', habit: { title: '阅读' }, rules: { durationDays: 7, deadline: '21:00', photoRequired: false } };

test('supervision remains independent from public sharing and repeats an unknown invite using the same operation', async () => {
  const events = [], status = { ready: true, accountId: 'a'.repeat(64), epoch: 'one' }; let lost = true;
  const client = createSupervisionClient({}, { enabled: true, functionName: names.apiFunction }, { enabled: true }, { status: () => status }, {
    transportFactory: () => async event => { events.push(event); if (lost) { lost = false; throw Error('lost after commit'); } return { ok: true, invite: invitation }; }
  });
  const input = { habitId: 'read', durationDays: 7, deadline: '21:00', photoRequired: false };
  await assert.rejects(client.create(input), /lost/); const created = await client.create(input);
  assert.equal(created.inviteId, invitation.inviteId); assert.equal(events[0].operationId, events[1].operationId);
  assert.equal(events[0].epoch, 'one'); assert.equal('openid' in events[0], false); assert.equal('appid' in events[0], false);
});

test('disabled supervision, uncertain core writes and changed accounts cannot send or accept old actions', async () => {
  let calls = 0, resolve; const status = { ready: true, accountId: 'a'.repeat(64), epoch: 'one', pending: 0 };
  const cloud = { enabled: true, functionName: names.apiFunction }, session = { status: () => status };
  const disabled = createSupervisionClient({}, cloud, { enabled: false }, session, { transportFactory: () => { calls++; } });
  await assert.rejects(disabled.list(), /尚未开放/); assert.equal(calls, 0);
  const client = createSupervisionClient({}, cloud, { enabled: true }, session, { transportFactory: () => () => new Promise(r => { resolve = r; }) });
  status.pending = 1; await assert.rejects(client.list(), /恢复云端/); status.pending = 0;
  const work = client.invitation(invitation.inviteId); status.epoch = 'two'; resolve({ ok: true, invite: invitation, canApply: true }); await assert.rejects(work, /账户数据已变化/);
});

test('supervision list distinguishes overdue, planned, completed and rest days without reading notes', () => {
  const items = [
    { supervisionId: 'rest', status: 'active', today: { status: 'not-planned' } },
    { supervisionId: 'done', status: 'active', today: { status: 'minimum', deadline: '20:00' } },
    { supervisionId: 'later', status: 'active', today: { status: 'pending', deadline: '23:00' } },
    { supervisionId: 'overdue', status: 'active', today: { status: 'pending', deadline: '19:00' } }
  ];
  const result = sorted(items, new Date('2026-10-13T12:00:00Z'));
  assert.deepEqual(result.map(item => item.supervisionId), ['overdue', 'later', 'done', 'rest']);
  assert.equal(result.find(item => item.supervisionId === 'done').dayLabel, '忙时已完成');
  assert.equal(result.find(item => item.supervisionId === 'rest').dayLabel, '今天无需完成');
  assert.equal('note' in result[0], false);
});

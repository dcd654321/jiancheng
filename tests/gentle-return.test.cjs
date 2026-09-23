const test = require('node:test');
const assert = require('node:assert/strict');
const domain = require('../miniprogram/core/habits');
const dates = require('../miniprogram/core/date');
const { missedScheduledDays, firstReturnTask } = require('../miniprogram/services/gentle-return');

const daily = [1, 2, 3, 4, 5, 6, 7];
const plan = (weekdays = daily, overrides = {}) => ({ title: '阅读', target: 5, minimum: 2, unit: '分钟', time: '', weekdays, ...overrides });
function created(createdDate, startDate = createdDate, habitPlan = plan()) {
  return domain.reduce(domain.emptyState(), { type: 'create', id: 'read', startDate, plan: habitPlan }, createdDate);
}
const misses = (state, today) => missedScheduledDays(state, state.habits[0], today);

test('two closed scheduled days qualify but one or the current day does not', () => {
  assert.equal(dates.weekday('2026-09-21'), 1);
  const state = created('2026-09-22');
  assert.equal(misses(state, '2026-09-23'), 1);
  assert.equal(misses(state, '2026-09-24'), 2);
  const task = domain.tasksOn(state, '2026-09-24');
  assert.equal(firstReturnTask(state, '2026-09-24', task).id, 'read');
});

test('rest days are skipped while a completion breaks the unfinished run', () => {
  const monday = '2026-09-28';
  let state = created('2026-09-24', '2026-09-24', plan([1, 4, 5]));
  assert.equal(misses(state, monday), 2); // Thursday and Friday; weekend is rest.
  state = domain.reduce(state, { type: 'complete', id: 'read', date: '2026-09-25' }, '2026-09-25');
  assert.equal(misses(state, monday), 0);
});

test('not started, paused or archived versions cannot join old misses', () => {
  const newHabit = created('2026-09-23', '2026-09-24');
  assert.equal(misses(newHabit, '2026-09-24'), 0);
  assert.equal(misses(newHabit, '2026-09-23'), 0);
  for (const inactive of ['paused', 'archived']) {
    let state = created('2026-09-21');
    state = domain.reduce(state, { type: 'status', id: 'read', baseRevision: 1, status: inactive }, '2026-09-22');
    state = domain.reduce(state, { type: 'status', id: 'read', baseRevision: 2, status: 'active' }, '2026-09-23');
    assert.equal(misses(state, '2026-09-25'), 1); // Thursday only; Wednesday was inactive.
  }
});

test('historical weekday versions are respected without rewriting records', () => {
  let state = created('2026-09-21', '2026-09-21', plan([1]));
  state = domain.reduce(state, { type: 'edit', id: 'read', baseRevision: 1, plan: plan([3, 4]) }, '2026-09-22');
  const before = JSON.stringify(state);
  assert.equal(misses(state, '2026-09-24'), 2); // Wednesday on new plan, Monday on old plan.
  assert.equal(JSON.stringify(state), before);
});

test('today without a pending task never qualifies, and account states stay separate', () => {
  const oldAccount = created('2026-09-21');
  const newAccount = created('2026-09-23');
  assert.equal(misses(oldAccount, '2026-09-24'), 2);
  assert.equal(misses(newAccount, '2026-09-24'), 1);
  assert.equal(firstReturnTask(newAccount, '2026-09-24', domain.tasksOn(newAccount, '2026-09-24')), null);
  let completed = domain.reduce(oldAccount, { type: 'complete', id: 'read', date: '2026-09-24' }, '2026-09-24');
  assert.equal(misses(completed, '2026-09-24'), 0);
  assert.equal(firstReturnTask(completed, '2026-09-24', domain.tasksOn(completed, '2026-09-24').filter(t => !t.done)), null);
  completed = created('2026-09-21', '2026-09-21', plan([1]));
  assert.equal(misses(completed, '2026-09-24'), 0); // Thursday is a rest day.
});

test('a projected completed record is not called missed', () => {
  let state = created('2026-09-21');
  state = domain.reduce(state, { type: 'complete', id: 'read', date: '2026-09-23' }, '2026-09-23');
  assert.equal(misses(state, '2026-09-24'), 0);
});

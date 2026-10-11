const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createFormDrafts } = require('../miniprogram/services/form-drafts');
const { createFeaturesClient } = require('../miniprogram/services/features-client');
const domain = require('../miniprogram/core/habits');
const dates = require('../miniprogram/core/date');
const event = (field, value) => ({ currentTarget: { dataset: { field } }, detail: { value } });

test('session draft clones input, bounds entries and rejects old version/account/day removals', () => {
  const d = createFormDrafts(), input = { weekdays: [1], title: '草稿' };
  const old = d.set('a:2026-10-07', 'read', input); input.title = '外部改动';
  assert.equal(d.read('a:2026-10-07', 'read').value.title, '草稿');
  const next = d.set('a:2026-10-07', 'read', { title: '新草稿' });
  d.remove('a:2026-10-07', 'read', old); assert.equal(d.read('a:2026-10-07', 'read').version, next);
  assert.equal(d.read('b:2026-10-07', 'read'), null);
  d.set('b:2026-10-07', 'read', { title: '另一账户' }); d.remove('a:2026-10-07', 'read');
  assert.equal(d.read('b:2026-10-07', 'read').value.title, '另一账户');
  assert.equal(d.read('b:2026-10-08', 'read'), null);
  for (let i = 0; i < 9; i++) d.set('b:2026-10-08', String(i), { title: String(i) });
  assert.equal(d.read('b:2026-10-08', '0'), null); assert.ok(d.read('b:2026-10-08', '8'));
});

function harness(t) {
  let context = 'a:epoch', state = domain.emptyState(); const nav = [], clips = [], modals = [], pages = [];
  const store = { read: () => structuredClone(state), contextKey: () => context,
    info: () => ({ ready: true, source: 'cloud' }), dispatch(command) { state = domain.reduce(state, command, dates.today()); } };
  const app = { store }, wx = { setNavigationBarTitle() {}, hideKeyboard() {}, showToast() {}, switchTab: o => nav.push(o.url), navigateBack() {},
    setClipboardData: o => clips.push(o.data), showModal: o => modals.push(o), pageScrollTo() {} };
  global.wx = wx; global.getApp = () => app;
  t.after(() => pages.forEach(p => p.onUnload()));
  function page(options = {}) {
    let def; global.Page = value => { def = value; };
    const file = path.resolve(__dirname, '../miniprogram/pages/edit/index.js'); delete require.cache[file]; require(file);
    const p = { ...def, data: structuredClone(def.data), setData(value, cb) { Object.assign(this.data, value); if (cb) cb(); } };
    pages.push(p); p.onLoad(options); p.onShow(); return p;
  }
  function sharedDraft(snapshot = {}) {
    if (!app.featuresClient) app.featuresClient = createFeaturesClient(wx, {}, {}, { status: () => {
      const [accountId, epoch] = context.split(':'); return { ready: true, accountId, epoch };
    } });
    return app.featuresClient.handoff({ kind: 'plan', categoryKey: 'read', target: 5, minimum: 2, unit: '分钟',
      weekdays: [1,2,3,4,5,6,7], ...snapshot });
  }
  return { page, store, app, nav, clips, modals, sharedDraft, context: value => { context = value; }, seed: value => { state = value; } };
}

test('return/reentry restores unsaved template input with same id, copy and explicit discard', t => {
  const h = harness(t), first = h.page({ template: 'read' }), id = first._id;
  first.onInput(event('title', '睡前阅读')); first.onInput(event('target', '7')); first.onHide();
  const second = h.page({ template: 'read' }); assert.equal(second.data.title, '睡前阅读'); assert.equal(second.data.target, '7');
  assert.equal(second._id, id); assert.equal(second.data.draftRestored, true); assert.equal(h.store.read().habits.length, 0);
  second.onCopyDraft(); assert.match(h.clips[0], /睡前阅读\n平时 7 分钟/);
  second.onDiscardDraft(); h.modals.pop().success({ confirm: true });
  assert.equal(second.data.target, '30'); assert.equal(second.data.draftDirty, false);
});

test('account switch clears visible old form and prevents clipboard/old draft reuse', t => {
  const h = harness(t), p = h.page(); p.onInput(event('title', '旧账户输入'));
  h.context('b:epoch'); p.refresh(); assert.equal(p.data.title, ''); assert.equal(p.data.draftDirty, false);
  p.onCopyDraft(); assert.equal(h.clips.length, 0); const next = h.page(); assert.equal(next.data.title, '');
});

test('business day change clears visible draft and never carries it into the next day', t => {
  const realToday = dates.today; let day = '2026-10-07'; dates.today = () => day;
  t.after(() => { dates.today = realToday; });
  const h = harness(t), p = h.page(); p.onInput(event('title', '昨天的未保存输入'));
  day = '2026-10-08'; p.refresh(); assert.equal(p.data.title, ''); assert.match(p.data.error, /状态已变化/);
  const next = h.page(); assert.equal(next.data.title, ''); assert.equal(next.data.draftRestored, false);
});

test('confirmed save clears matching draft but an old async receipt preserves a newer edit', async t => {
  const h = harness(t), p = h.page({ template: 'tidy' }); p.onInput(event('title', '整理书桌'));
  let resolve; h.store.dispatch = () => new Promise(r => { resolve = r; }); const save = p.onSave(); p.onHide();
  const newPage = h.page({ template: 'tidy' }); newPage.onInput(event('title', '新的未提交整理'));
  resolve(); await save;
  const again = h.page({ template: 'tidy' }); assert.equal(again.data.title, '新的未提交整理'); assert.equal(h.nav.length, 0);
});

test('ordinary confirmed creation removes draft while failure retains input and same create id', async t => {
  const h = harness(t), p = h.page({ template: 'study' }); p.onInput(event('title', '复习一小段'));
  const id = p._id; h.store.dispatch = () => Promise.reject(Error('未确认'));
  await p.onSave(); assert.match(p.data.error, /未确认/); assert.equal(p.data.saving, false); p.onHide();
  const again = h.page({ template: 'study' }); assert.equal(again._id, id); assert.equal(again.data.title, '复习一小段');
  h.store.dispatch = command => domain.reduce(h.store.read(), command, dates.today()); await again.onSave();
  const clean = h.page({ template: 'study' }); assert.equal(clean.data.draftDirty, false); assert.equal(clean.data.draftRestored, false);
});

function fullState(freeTomorrow = false) {
  const day = dates.today(), plan = { title: '已有习惯', target: 5, minimum: 2, unit: '分钟', weekdays: [1,2,3,4,5,6,7], time: '' };
  let state = domain.emptyState();
  for (let i = 0; i < 5; i++) state = domain.reduce(state, { type: 'create', id: 'existing-' + i, startDate: day, plan }, day);
  if (freeTomorrow) state = domain.reduce(state, { type: 'status', status: 'paused', id: 'existing-0', baseRevision: 1 }, day);
  return state;
}

test('system-selected tomorrow is clean and remains available after discarding edits', async t => {
  const h = harness(t); h.seed(fullState(true));
  const p = h.page({ template: 'tidy' });
  assert.equal(p.data.startOffset, 1); assert.equal(p.data.draftDirty, false);
  assert.equal(p.data.canCreateToday, false); assert.equal(p.data.canCreateTomorrow, true);
  p.onStart({ currentTarget: { dataset: { offset: 0 } } }); assert.equal(p.data.startOffset, 1);
  p.onInput(event('title', '未保存修改')); p.onDiscardDraft(); h.modals.pop().success({ confirm: true });
  assert.equal(p.data.startOffset, 1); assert.equal(p.data.draftDirty, false);
  assert.equal(p.data.title, '整理桌面'); await p.onSave();
  assert.equal(h.store.read().habits.length, 6);
  assert.equal(domain.findHabit(h.store.read(), p._id).versions[0].effectiveDate, dates.shift(dates.today(), 1));
});

test('restored drafts reconcile changed capacity and full forms explain why creation is blocked', t => {
  const h = harness(t), p = h.page({ template: 'tidy' });
  p.onInput(event('title', '保留名称')); p.onHide(); h.seed(fullState(true));
  const restored = h.page({ template: 'tidy' });
  assert.equal(restored.data.title, '保留名称'); assert.equal(restored.data.startOffset, 1);
  restored.onDiscardDraft(); h.modals.pop().success({ confirm: true });
  assert.equal(restored.data.startOffset, 1); assert.equal(restored.data.draftDirty, false);
  h.seed(fullState()); const full = h.page();
  assert.equal(full.data.capacityFull, true); assert.equal(full.data.canCreateToday, false); assert.equal(full.data.canCreateTomorrow, false);
  assert.match(full.data.capacityNote, /5 个进行中的习惯/);
  full.onStart({ currentTarget: { dataset: { offset: 1 } } }); assert.equal(full.data.startOffset, 0);
  assert.equal(h.store.read().habits.length, 5);
});

test('the fifth confirmed create remains reviewable without a duplicate write after reentry', async t => {
  const h = harness(t), seed = fullState(); seed.habits.pop(); h.seed(seed);
  const p = h.page({ template: 'tidy' }); p.onInput(event('title', '第五个习惯'));
  let release, writes = 0;
  h.store.dispatch = command => { writes++; h.seed(domain.reduce(h.store.read(), command, dates.today())); return new Promise(resolve => { release = resolve; }); };
  const pending = p.onSave(); p.onHide(); const reentered = h.page({ template: 'tidy' });
  assert.equal(reentered.data.capacityFull, true); assert.equal(reentered.data.confirmedCreate, true);
  assert.match(reentered.data.capacityNote, /已创建/);
  release(); await pending; await reentered.onSave();
  assert.equal(writes, 1); assert.equal(h.nav.at(-1), '/pages/today/index');
});

test('saving after midnight rejects ordinary input and public share draft before the date timer refreshes', async t => {
  const realToday = dates.today; let day = '2026-10-09'; dates.today = () => day;
  t.after(() => { dates.today = realToday; });
  const h = harness(t), ordinary = h.page(); ordinary.onInput(event('title', '昨天的普通输入'));
  const adopted = h.page({ sharedDraft: h.sharedDraft() });
  day = '2026-10-10';
  for (const p of [ordinary, adopted]) {
    await p.onSave();
    assert.equal(p.data.saving, false); assert.equal(p.data.title, '');
    assert.match(p.data.error, /数据状态已变化/);
  }
  assert.equal(h.store.read().habits.length, 0); assert.equal(h.nav.length, 0);
});

test('public share reentry resumes matching unsaved input while changed public goals use a separate draft', t => {
  const h = harness(t), first = h.page({ sharedDraft: h.sharedDraft() }), id = first._id;
  first.onInput(event('title', '我的睡前阅读')); first.onHide();
  const reentered = h.page({ sharedDraft: h.sharedDraft() });
  assert.equal(reentered.data.title, '我的睡前阅读'); assert.equal(reentered._id, id);
  assert.equal(reentered.data.draftRestored, true); assert.equal(reentered.data.compact, true);
  const different = h.page({ sharedDraft: h.sharedDraft({ target: 10, minimum: 3 }) });
  assert.equal(different.data.title, '读一会儿'); assert.equal(different.data.target, '10');
  assert.equal(different.data.draftRestored, false); assert.notEqual(different._id, id);
  assert.equal(h.store.read().habits.length, 0);
});

test('public share input and tokens remain bound to their recipient account', async t => {
  const h = harness(t), oldToken = h.sharedDraft(), adopted = h.page({ sharedDraft: h.sharedDraft() });
  adopted.onInput(event('title', '旧账户的分享输入')); adopted.onHide();
  h.context('b:epoch'); adopted.onShow();
  assert.equal(adopted.data.title, ''); assert.match(adopted.data.error, /数据状态已变化/);
  const expired = h.page({ sharedDraft: oldToken });
  assert.equal(expired._invalidDraft, true); await expired.onSave();
  assert.equal(h.store.read().habits.length, 0);
  const fresh = h.page({ sharedDraft: h.sharedDraft() });
  assert.equal(fresh.data.title, '读一会儿'); assert.equal(fresh.data.draftRestored, false);
});

test('draft updates require the version read by the page and removed input cannot be resurrected', () => {
  const d = createFormDrafts(), scope = 'a:2026-10-09', key = 'new:custom';
  const first = d.set(scope, key, { title: '旧输入' }, 0);
  const newer = d.set(scope, key, { title: '新输入' }, first);
  assert.equal(d.set(scope, key, { title: '旧输入' }, first), null);
  assert.equal(d.read(scope, key).value.title, '新输入');
  d.remove(scope, key, newer);
  assert.equal(d.set(scope, key, { title: '旧输入' }, first), null);
  assert.equal(d.read(scope, key), null);
  assert.ok(d.set(scope, key, { title: '新的独立输入' }, 0) > newer);
});

test('returning to an older form adopts newer nested input and hidden unload cannot overwrite it', t => {
  const h = harness(t), first = h.page(); first.onInput(event('title', '原表单输入')); first.onHide();
  const nested = h.page(); nested.onInput(event('title', '较新表单输入')); nested.onUnload();
  first.onShow(); assert.equal(first.data.title, '较新表单输入');
  assert.equal(first._id, nested._id); assert.equal(first._draftVersion, nested._draftVersion);
  first.onHide();
  const newest = h.page(); newest.onInput(event('title', '最后修改的输入'));
  first.onUnload();
  const reentered = h.page(); assert.equal(reentered.data.title, '最后修改的输入');
});

test('a newer confirmed save clears the draft without an older page recreating the old input', async t => {
  const h = harness(t), first = h.page(); first.onInput(event('title', '原表单输入')); first.onHide();
  const newer = h.page(); newer.onInput(event('title', '确认创建的输入')); await newer.onSave();
  assert.equal(h.store.read().habits[0].versions[0].title, '确认创建的输入');
  first.onShow(); first.keepDraft(); first.onUnload();
  const clean = h.page(); assert.equal(clean.data.title, ''); assert.equal(clean.data.draftRestored, false);
});

test('returning input to clean or explicitly discarding it starts a fresh editable draft', t => {
  const h = harness(t), p = h.page({ template: 'tidy' });
  p.onInput(event('title', '第一次修改')); p.onInput(event('title', '整理桌面'));
  assert.equal(p.data.draftDirty, false);
  p.onInput(event('title', '第二次修改')); p.onHide();
  const restored = h.page({ template: 'tidy' }); assert.equal(restored.data.title, '第二次修改');
  restored.onDiscardDraft(); h.modals.pop().success({ confirm: true });
  restored.onInput(event('title', '放弃后的新输入')); restored.onHide();
  const latest = h.page({ template: 'tidy' }); assert.equal(latest.data.title, '放弃后的新输入');
});

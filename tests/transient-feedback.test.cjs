const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const domain = require('../miniprogram/core/habits');
const dates = require('../miniprogram/core/date');
const ui = require('../miniprogram/services/ui');
const featureWork = require('../miniprogram/services/feature-page');
const event = (dataset = {}, value) => ({ currentTarget: { dataset }, detail: { value } });

function harness(t) {
  let state = domain.emptyState(), context = 'account-a';
  const toasts = [], navigation = [], modals = [], pages = [];
  const day = dates.today();
  const store = {
    read: () => state, contextKey: () => context,
    info: () => ({ ready: true, source: 'cloud', syncText: '已同步' }),
    dispatch(command) { state = domain.reduce(state, command, day); },
    clear() { state = domain.emptyState(); }
  };
  const app = { store, featuresClient: { status: () => ({ enabled: false }), cachedPreferences: () => null } };
  global.getApp = () => app;
  global.wx = { showToast: value => toasts.push(value), showModal: value => modals.push(value),
    setNavigationBarTitle() {}, navigateBack: () => navigation.push('back'),
    switchTab: value => navigation.push(value.url), navigateTo: value => navigation.push(value.url) };
  t.after(() => pages.forEach(page => page.onUnload()));
  function page(name, options = {}) {
    let definition; global.Page = value => { definition = value; };
    const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
    delete require.cache[file]; require(file);
    const result = { ...definition, data: structuredClone(definition.data),
      setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); } };
    pages.push(result); if (result.onLoad) result.onLoad(options); result.onShow(); return result;
  }
  function seed(id = 'read') {
    store.dispatch({ type: 'create', id, startDate: day,
      plan: { title: id, target: 5, minimum: 2, unit: '分钟', time: '', weekdays: [1,2,3,4,5,6,7] } });
  }
  function delayDispatch() {
    const dispatch = store.dispatch;
    let resolve, reject, pending;
    store.dispatch = command => { pending = command; return new Promise((ok, fail) => { resolve = ok; reject = fail; }); };
    return { finish() { store.dispatch = dispatch; resolve(dispatch(pending)); }, fail() { store.dispatch = dispatch; reject(Error('请求失败')); } };
  }
  return { app, store, day, page, seed, toasts, modals, navigation, delayDispatch, context: value => { context = value; } };
}

test('confirmed feedback expires after five seconds and refresh cannot resurrect it', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t); h.seed(); const p = h.page('today');
  p.onCompleteMinimum(event({ id: 'read', date: h.day }));
  t.mock.timers.tick(4999); assert.equal(p.data.completionFeedback.id, 'read');
  p.refresh(); t.mock.timers.tick(1); assert.equal(p.data.completionFeedback, null);
  p.refresh(); assert.equal(p.data.completionFeedback, null);
  assert.equal(p.data.completed.length, 1); assert.equal(p.data.showCompleted, true);
  p.onComplete(event({ id: 'read', date: h.day, done: true }));
  assert.equal(p.data.done, 0); assert.equal(p.data.pending[0].target, 2);
});

test('each new confirmed completion gets a full five seconds without old feedback resurfacing on undo', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t); h.seed(); h.seed('walk'); const p = h.page('today');
  p.onComplete(event({ id: 'read', date: h.day })); t.mock.timers.tick(4000);
  p.onCompleteMinimum(event({ id: 'walk', date: h.day })); t.mock.timers.tick(1000);
  assert.equal(p.data.completionFeedback.id, 'walk');
  t.mock.timers.tick(3999); assert.equal(p.data.completionFeedback.id, 'walk');
  p.onComplete(event({ id: 'walk', date: h.day, done: true }));
  assert.equal(p.data.completionFeedback, null); p.refresh(); assert.equal(p.data.completionFeedback, null);
  assert.equal(p.data.done, 1); t.mock.timers.tick(1); assert.equal(p.data.completionFeedback, null);
});

test('hide, unload, date and context changes cancel the feedback timer', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t); h.seed(); const p = h.page('today');
  p.onComplete(event({ id: 'read', date: h.day })); p.onHide();
  assert.equal(p.data.completionFeedback, null); assert.equal(p._feedbackTimer, null);
  p.onShow(); p.onComplete(event({ id: 'read', date: h.day, done: true }));
  p.onComplete(event({ id: 'read', date: h.day })); h.context('account-b'); p.refresh();
  assert.equal(p.data.completionFeedback, null); assert.equal(p._feedbackTimer, null);
  p.onComplete(event({ id: 'read', date: h.day, done: true })); p.onComplete(event({ id: 'read', date: h.day }));
  const today = dates.today; dates.today = () => dates.shift(h.day, 1);
  try { p.refresh(); assert.equal(p.data.completionFeedback, null); assert.equal(p._feedbackTimer, null); }
  finally { dates.today = today; }
  p.refresh(); p.onComplete(event({ id: 'read', date: h.day, done: true }));
  p.onComplete(event({ id: 'read', date: h.day }));
  p.onUnload(); assert.equal(p._feedbackTimer, null);
  p.setData = () => { throw Error('updated unloaded page'); }; t.mock.timers.tick(5000);
});

for (const outcome of ['finish', 'fail']) for (const returned of [false, true]) {
  test(`late mutation ${outcome} does not show feedback after leaving${returned ? ' and returning' : ''}`, async t => {
    const h = harness(t); h.seed(); const p = h.page('today'), deferred = h.delayDispatch();
    const work = p.onComplete(event({ id: 'read', date: h.day })); p.onHide(); if (returned) p.onShow();
    deferred[outcome](); await work;
    assert.equal(h.toasts.length, 0); assert.equal(p.data.completionFeedback, null);
    assert.equal(p.data.error, ''); assert.equal(p.data.writeBusy, false); assert.equal(p._mutating, false);
    p.refresh(); assert.equal(p.data.done, outcome === 'finish' ? 1 : 0);
  });
}

test('a new write clears the previous rejection while the retry is waiting', async t => {
  const h = harness(t); h.seed(); const p = h.page('today'); p.setData({ error: '上一次失败' });
  const deferred = h.delayDispatch(), work = p.onComplete(event({ id: 'read', date: h.day }));
  assert.equal(p.data.error, ''); deferred.fail(); await work;
  assert.match(p.data.error, /请求失败/); assert.equal(p.data.writeBusy, false);
});

for (const outcome of ['finish', 'fail']) {
  test(`a previous day's delayed ${outcome} cannot report into today's tasks`, async t => {
    const h = harness(t); h.seed(); const p = h.page('today'), deferred = h.delayDispatch();
    const work = p.onComplete(event({ id: 'read', date: h.day }));
    const original = dates.today; dates.today = () => dates.shift(h.day, 1);
    try {
      deferred[outcome](); await work;
      assert.equal(h.toasts.length, 0); assert.equal(p.data.completionFeedback, null);
      assert.equal(p.data.error, ''); assert.equal(p.data.date, dates.today());
      assert.equal(p.data.done, 0); assert.equal(p.data.writeBusy, false);
    } finally { dates.today = original; }
  });
}

for (const outcome of ['finish', 'fail']) {
  test(`late form ${outcome} cannot navigate or report into a newer visit or account`, async t => {
    const h = harness(t), p = h.page('edit', { template: 'read' }), deferred = h.delayDispatch();
    const work = p.onSave(); p.onHide(); p.onShow(); deferred[outcome](); await work;
    assert.equal(h.navigation.length, 0); assert.equal(h.toasts.length, 0);
    assert.equal(p.data.saving, false); assert.equal(p.data.error, '');
    const q = h.page('edit', { template: 'read' }), other = h.delayDispatch();
    const newer = q.onSave(); h.context('account-b'); other[outcome](); await newer;
    assert.equal(h.navigation.length, 0); assert.equal(h.toasts.length, 0); assert.equal(q.data.error, '');
  });
}

test('confirmation dialogs cannot submit a previous visit or account intent', t => {
  const h = harness(t); h.seed(); const p = h.page('detail', { id: 'read' });
  const before = structuredClone(h.store.read());
  p.onSimplify(event({ id: 'read', date: h.day })); const simplify = h.modals.pop();
  p.onHide(); p.onShow(); simplify.success({ confirm: true, content: '2' });
  assert.deepEqual(h.store.read(), before);
  p.onStatus(event({ status: 'paused' })); const status = h.modals.pop();
  p.onHide(); p.onShow(); status.success({ confirm: true }); assert.deepEqual(h.store.read(), before);
  p.onStatus(event({ status: 'paused' })); const oldAccount = h.modals.pop();
  h.context('account-b'); p.refresh(); oldAccount.success({ confirm: true }); assert.deepEqual(h.store.read(), before);
  const data = h.page('data'); data.onDelete(); const first = h.modals.pop();
  data.onHide(); data.onShow(); first.success({ confirm: true });
  assert.equal(h.modals.length, 0); assert.equal(data.data.deleting, false);
  data.onDelete(); h.modals.pop().success({ confirm: true }); const second = h.modals.pop();
  data.onHide(); data.onShow(); second.success({ confirm: true }); assert.deepEqual(h.store.read(), before);
});

test('a previous discard confirmation leaves the current note draft intact', t => {
  const h = harness(t); h.seed(); const p = h.page('detail', { id: 'read' });
  p.onNote(event({}, '未保存的备注')); p.onDiscardNote(); const dialog = h.modals.pop();
  p.onHide(); p.onShow(); dialog.success({ confirm: true });
  assert.equal(p.data.note, '未保存的备注'); assert.equal(p.data.noteDirty, true);
  p.refresh(); assert.equal(p.data.note, '未保存的备注');
  p.onDiscardNote(); h.modals.pop().success({ confirm: true });
  assert.equal(p.data.noteDirty, false); assert.equal(p.data.note, '');
});

test('a previous pin failure cannot replace the current detail state', async t => {
  const h = harness(t); h.seed(); const p = h.page('detail', { id: 'read' }); let reject;
  h.app.featuresClient.setPinned = () => new Promise((_, fail) => { reject = fail; });
  const work = p.onPin(); p.onHide(); p.onShow(); reject(Error('旧置顶失败')); await work;
  assert.equal(p.data.pinError, ''); assert.equal(p.data.pinning, false);
});

test('previous retry failure cannot replace a newer successfully displayed page', async t => {
  const h = harness(t); h.seed(); const p = h.page('today'); let reject;
  h.app.cloudSession = { start: () => new Promise((_, fail) => { reject = fail; }) };
  const work = p.onDataRetry(); p.onHide(); p.onShow(); reject(Error('旧请求失败')); await work;
  assert.equal(p.data.dataReady, true); assert.equal(p.data.dataUnavailable, false); assert.equal(p.data.error, '');
  assert.equal(p._retrying, false);
});

test('a late feature preview cannot reopen content in a newer visit', async t => {
  const h = harness(t); h.seed(); const p = h.page('today'); let resolve, callbacks = 0;
  const work = featureWork.run(p, () => new Promise(ok => { resolve = ok; }), () => { callbacks++; });
  p.onHide(); p.onShow(); resolve({}); await work;
  assert.equal(callbacks, 0); assert.equal(p._featureBusy, false);
});

test('a previous sync-page failure cannot report an error into a newer visit', async t=>{
  const h=harness(t); let reject;
  h.app.cloudSession={status:()=>({ready:true,busy:false}),refresh:()=>new Promise((_,fail)=>{reject=fail;})};
  const p=h.page('sync'), work=p.onRefresh();p.onHide();p.onShow();reject(Error('旧同步失败'));await work;
  assert.equal(p.data.error,'');assert.equal(p.data.busy,false);
});

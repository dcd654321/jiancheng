const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const domain = require('../miniprogram/core/habits');
const dates = require('../miniprogram/core/date');
function setup(t, name) {
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  const status = { ready: false, phase: 'loading', accountId: '', epoch: '', pending: 0 };
  const listeners = new Set(), calls = [];
  let preferences = null;
  const state = domain.reduce(domain.emptyState(), { type: 'create', id: 'read', startDate: dates.today(),
    plan: { title: '读一会儿', target: 5, minimum: 2, unit: '分钟', weekdays: [1,2,3,4,5,6,7], time: '' } }, dates.today());
  const features = {
    status: () => ({ enabled: true, reminders: true }),
    contextKey() { if (!status.ready) throw Error('not ready'); return status.accountId + ':' + status.epoch; },
    cachedPreferences: () => preferences,
    async preferences() { this.contextKey(); calls.push('preferences'); return preferences = { pinnedHabitId: 'read' }; },
    async reminders() { this.contextKey(); calls.push('reminders'); return []; },
    async list() { this.contextKey(); calls.push('list'); return { items: [], nextCursor: null }; }
  };
  const app = { dataReady: ready, featuresClient: features,
    cloudSession: { status: () => ({ ...status }), subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } },
    store: { contextKey: () => 'cloud:' + status.accountId + ':' + status.epoch,
      info: () => ({ source: 'cloud', ...status }), read() {
        if (!status.ready) { const error = Error('cloud not ready'); error.code = status.phase === 'loading' ? 'DATA_LOADING' : 'DATA_UNAVAILABLE'; throw error; }
        return structuredClone(state);
      } } };
  global.getApp = () => app; global.wx = { showToast() {}, navigateTo() {} };
  let definition; global.Page = value => { definition = value; };
  const source = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
  delete require.cache[source]; require(source);
  const p = { ...definition, data: structuredClone(definition.data),
    setData(value, callback) { Object.assign(this.data, value); if (callback) callback(); } };
  if (p.onLoad) p.onLoad({ id: 'read' });
  t.after(() => p.onUnload());
  return { p, calls, app, status, async finish({ fail = false } = {}) {
    Object.assign(status, fail ? { ready: false, phase: 'offline' }
      : { ready: true, phase: 'ready', accountId: 'fixture-account', epoch: 'fixture-epoch' });
    listeners.forEach(fn => fn()); release(); await ready; await new Promise(setImmediate);
  } };
}
for (const name of ['today', 'detail', 'reminder', 'share-list']) {
  test(name + ': waits for cold-start account before reading optional private data', async t => {
    const h = setup(t, name); h.p.onShow(); assert.equal(h.calls.length, 0);
    await h.finish(); assert.equal(h.calls.length, 1);
    if (name === 'today') assert.equal(h.p.data.pending[0].pinned, true);
    if (name === 'detail') assert.equal(h.p.data.pinned, true);
    if (name === 'share-list') assert.equal(h.p.data.loaded, true);
  });
  test(name + ': failed bootstrap sends no optional request and exposes core recovery', async t => {
    const h = setup(t, name); h.p.onShow(); await h.finish({ fail: true });
    assert.equal(h.calls.length, 0); assert.equal(h.p.data.dataUnavailable, true);
  });
  for (const unload of [false, true]) test(name + ': late bootstrap ignores a ' + (unload ? 'destroyed' : 'hidden') + ' page', async t => {
    const h = setup(t, name); h.p.onShow(); unload ? h.p.onUnload() : h.p.onHide();
    await h.finish(); assert.equal(h.calls.length, 0);
    if (!unload) { await h.p.onShow(); await new Promise(setImmediate); assert.equal(h.calls.length, 1); }
  });
}
test('old share-list startup callback cannot restart a load after leaving and returning', async t => {
  const h = setup(t, 'share-list'); let attempts = 0;
  const original = h.p.load; h.p.load = function(...args) { attempts++; return original.apply(this, args); };
  h.p.onShow(); h.p.onHide(); h.p.onShow(); await h.finish();
  assert.equal(attempts, 1); assert.equal(h.calls.length, 1);
});

test('detail: a successful preferences reread removes the previous read error', async t => {
  const h = setup(t, 'detail'); await h.finish();
  const preferences = h.app.featuresClient.preferences;
  h.app.featuresClient.preferences = async () => { throw Error('fixture read failed'); };
  await h.p.onShow(); await new Promise(setImmediate);
  assert.match(h.p.data.pinError, /未读取到/);
  h.p.onHide(); h.app.featuresClient.preferences = preferences;
  await h.p.onShow(); await new Promise(setImmediate);
  assert.equal(h.p.data.pinned, true); assert.equal(h.p.data.pinError, '');
});

test('detail: switching account removes the previous preferences error', async t => {
  const h = setup(t, 'detail'); await h.finish();
  h.app.featuresClient.preferences = async () => { throw Error('fixture read failed'); };
  await h.p.onShow(); await new Promise(setImmediate);
  assert.match(h.p.data.pinError, /未读取到/);
  h.status.accountId = 'another-fixture-account'; h.status.epoch = 'another-fixture-epoch'; h.p.refresh();
  assert.equal(h.p.data.pinError, '');
});

for (const fail of [false, true]) test('detail: a ' + (fail ? 'failed' : 'successful') + ' preferences reread preserves an unconfirmed pin write error', async t => {
  const h = setup(t, 'detail'); await h.finish();
  if (fail) h.app.featuresClient.preferences = async () => { throw Error('fixture read failed'); };
  h.p.setData({ pinError: '置顶未保存，请重试' });
  await h.p.onShow(); await new Promise(setImmediate);
  assert.equal(h.p.data.pinError, '置顶未保存，请重试');
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(t, { ready = true, appearanceEnabled = true, withoutController = false, publicShare } = {}) {
  const state = { ready, accountId: ready ? 'account-a' : '', epoch: ready ? 'epoch-a' : '', phase: ready ? 'ready' : 'loading' };
  const listeners = new Set(), pages = [], paints = [];
  let starts = 0, reads = 0;
  const controller = { view: () => ({ key: state.accountId + ':' + state.epoch, theme: 'mist', enabled: appearanceEnabled,
    revision: null, loadState: 'idle', pendingTheme: '' }), subscribe: () => () => {}, ensureRead() { reads++; } };
  const app = { cloudSession: { status: () => ({ ...state }), subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } },
    store: { contextKey: () => state.accountId + ':' + state.epoch },
    featuresClient: { publicShare: publicShare || (() => Promise.reject(Error('分享尚未开放'))), status: () => ({ publicShares: false }) },
    appearanceController: withoutController ? null : controller,
    onCoreContentRendered() { if (this._rendered) return; this._rendered = true; starts++; if (this.appearanceController) this.appearanceController.ensureRead(); } };
  global.getApp = () => app;
  global.wx = { hideShareMenu() {} };
  t.after(() => pages.forEach(page => page.onUnload && page.onUnload()));
  function page(name, options = {}) {
    let definition;
    global.Page = value => { definition = value; };
    const source = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
    delete require.cache[source]; require(source);
    const instance = { ...definition, data: structuredClone(definition.data), setData(patch, callback) {
      Object.assign(this.data, patch); if (callback) paints.push(callback);
    } };
    pages.push(instance); if (instance.onLoad) instance.onLoad(options);
    return instance;
  }
  return { app, state, page, starts: () => starts, reads: () => reads,
    paint() { const pending = paints.splice(0); pending.forEach(callback => callback()); },
    ready() { Object.assign(state, { ready: true, accountId: 'account-a', epoch: 'epoch-a', phase: 'ready' }); listeners.forEach(listener => listener()); } };
}

for (const options of [{}, { appearanceEnabled: false }, { withoutController: true }]) {
  test('appearance entry opens the optional-service gate only after its ready frame ' + JSON.stringify(options), async t => {
    const h = fixture(t, options), page = h.page('appearance');
    await page.onShow();
    assert.equal(h.starts(), 0); assert.equal(h.reads(), 0, 'onShow must not read appearance before the paint callback');
    h.paint();
    assert.equal(h.starts(), 1);
    assert.equal(h.reads(), options.withoutController ? 0 : 1);
    page.refresh(); h.paint(); assert.equal(h.starts(), 1, 'theme projections do not restart optional services');
  });
}

test('a cold appearance entry retries the render gate when the main account becomes ready', async t => {
  const h = fixture(t, { ready: false }), page = h.page('appearance');
  await page.onShow(); h.paint();
  assert.equal(h.starts(), 0); assert.equal(h.reads(), 0);
  h.ready(); assert.equal(h.starts(), 0); assert.equal(h.reads(), 0);
  h.paint(); assert.equal(h.starts(), 1); assert.equal(h.reads(), 1);
});

test('a closed public-share entry still opens the gate after both its error frame and account readiness', async t => {
  const h = fixture(t, { ready: false }), page = h.page('share-view', { id: 'closed-share' });
  await page.onShow();
  assert.equal(page.data.loading, false); assert.equal(page.data.error, '分享尚未开放');
  h.paint(); assert.equal(h.starts(), 0);
  h.ready(); assert.equal(h.starts(), 0, 'the session notification must wait for the displayed frame');
  h.paint(); assert.equal(h.starts(), 1); assert.equal(h.reads(), 1);
});

test('old public-share render callbacks cannot open the gate after reload or hide and reentry', async t => {
  const requests = [deferred(), deferred(), deferred()], queue = [...requests];
  const h = fixture(t, { publicShare: () => queue.shift().promise }), page = h.page('share-view', { id: 'closed-share' });
  const first = page.onShow(); requests[0].reject(Error('first')); await first;
  const second = page.load(); h.paint();
  assert.equal(h.starts(), 0, 'the previous load callback is obsolete within this visit');
  requests[1].reject(Error('second')); await second;
  page.onHide(); const third = page.onShow(); h.paint();
  assert.equal(h.starts(), 0, 'a previous visit callback is obsolete after reentry');
  requests[2].reject(Error('third')); await third;
  assert.equal(h.starts(), 0); h.paint(); assert.equal(h.starts(), 1);
});

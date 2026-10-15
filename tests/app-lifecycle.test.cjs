const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppLifecycle } = require('../miniprogram/services/app-lifecycle');

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('launch creates services once and foreground waits for bootstrap', async () => {
  const gate = deferred();
  let starts = 0;
  let foregrounds = 0;
  const session = {
    start() {
      starts += 1;
      return gate.promise;
    },
    onForeground() {
      foregrounds += 1;
      return Promise.resolve({ phase: 'ready' });
    },
    status() {
      return { phase: 'offline', ready: true };
    }
  };
  const lifecycle = createAppLifecycle({
    wxApi: {},
    cloudConfig: {},
    createCloudSession: () => session,
    createWorkspaceStore: (current, drafts) => ({ current, drafts }),
    createQuoteSession: () => ({ kind: 'quotes' })
  });
  const app = {};
  lifecycle.onLaunch(app);
  const foreground = lifecycle.onShow(app);
  assert.equal(starts, 1);
  assert.equal(foregrounds, 0);
  gate.resolve({ phase: 'ready' });
  assert.deepEqual(await foreground, { phase: 'ready' });
  assert.equal(foregrounds, 0, 'first show reuses the confirmed launch read');
  assert.equal(app.store.current, session);
  lifecycle.onHide(app);
  await lifecycle.onShow(app);
  assert.equal(foregrounds, 1, 'later foreground visits still check freshness');
});

test('monitor setup and sync/async hooks cannot interrupt core account lifecycle', async () => {
  for (const factoryFails of [true, false]) {
    let starts = 0, foregrounds = 0, metadata;
    const session = { start: async () => { starts++; return { phase: 'ready' }; },
      onForeground: async () => { foregrounds++; return { phase: 'ready' }; }, status: () => ({ phase: 'ready' }), subscribe: () => () => {} };
    const lifecycle = createAppLifecycle({ wxApi: {}, cloudConfig: {},
      createCloudSession: (_wx, _config, _transport, options) => { metadata = options; return session; },
      createWorkspaceStore: () => ({ original: true }), createQuoteSession: () => ({}),
      createOperationsMonitor() {
        if (factoryFails) throw Error('monitor unavailable');
        return { onShow() { throw Error('monitor start failed'); }, onReady: () => Promise.reject(Error('monitor ready failed')),
          onHide() { throw Error('monitor end failed'); }, capture() { throw Error('monitor capture failed'); } };
      }
    });
    const app = {};
    assert.deepEqual(await lifecycle.onLaunch(app), { phase: 'ready' });
    assert.deepEqual(await lifecycle.onShow(app), { phase: 'ready' });
    assert.doesNotThrow(() => app.onCoreContentRendered());
    assert.doesNotThrow(() => lifecycle.onHide(app)); assert.equal(metadata.sessionId(), undefined);
    assert.equal(starts, 1); assert.equal(foregrounds, 0); assert.equal(app.store.original, true);
    await new Promise(resolve => setImmediate(resolve));
  }
});

test('appearance subscriptions and monitoring wait for visible core content, once per visit', async () => {
  const listeners = new Set(), events = [];
  const session = { start: async () => ({ phase: 'ready' }), onForeground: async () => ({ phase: 'ready' }),
    status: () => ({ phase: 'ready' }), subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } };
  const lifecycle = createAppLifecycle({ wxApi: {}, cloudConfig: {}, createCloudSession: () => session,
    createWorkspaceStore: () => ({}), createQuoteSession: () => ({}), createAppearanceClient: () => ({}),
    createAppearanceController({ session: appearanceSession }) {
      appearanceSession.subscribe(() => events.push('appearance-subscription'));
      return { ensureRead() { events.push('appearance'); return Promise.reject(Error('optional failure')); } };
    },
    createOperationsMonitor: () => ({ onShow() { events.push('monitor-show'); }, onReady() { events.push('monitor-ready'); }, onHide() { events.push('monitor-hide'); } })
  });
  const app = {};
  await lifecycle.onLaunch(app); await lifecycle.onShow(app);
  listeners.forEach(listener => listener()); assert.deepEqual(events, []);
  app.onCoreContentRendered(); app.onCoreContentRendered();
  assert.deepEqual(events, ['monitor-show', 'monitor-ready', 'appearance']);
  lifecycle.onHide(app); app.onCoreContentRendered(); listeners.forEach(listener => listener());
  assert.equal(events.length, 4);
  await lifecycle.onShow(app); assert.equal(events.length, 4);
  app.onCoreContentRendered();
  assert.deepEqual(events.slice(4), ['monitor-show', 'monitor-ready', 'appearance']);
  await new Promise(resolve => setImmediate(resolve));
});

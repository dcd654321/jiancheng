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
  assert.equal(foregrounds, 1);
  assert.equal(app.store.current, session);
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
    assert.doesNotThrow(() => lifecycle.onHide(app)); assert.equal(metadata.sessionId(), undefined);
    assert.equal(starts, 1); assert.equal(foregrounds, 1); assert.equal(app.store.original, true);
    await new Promise(resolve => setImmediate(resolve));
  }
});

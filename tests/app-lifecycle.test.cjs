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
    aiConfig: {},
    createStore: () => ({ kind: 'legacy' }),
    createCloudSession: () => session,
    createWorkspaceStore: (legacy, current) => ({ legacy, current }),
    createPlanAssistant: () => ({ kind: 'assistant' }),
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

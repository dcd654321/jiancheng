const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { createFeaturesClient } = require('../miniprogram/services/features-client');
const { createPlanAssistant } = require('../miniprogram/services/plan-assistant');
const domain = require('../miniprogram/core/habits');
test('every registered page opens without writes or model requests and resolves its event handlers', async t => {
  const pages = [], requests = [], writes = [];
  const status = { ready: true, accountId: 'a'.repeat(64), epoch: 'fixture-epoch', phase: 'ready', pending: 0 };
  const session = { status: () => ({ ...status }), subscribe: () => () => {} };
  const wx = { navigateTo() {}, switchTab() {}, showToast() {}, setNavigationBarTitle() {} };
  const cloud = { enabled: true, envId: 'fixture', functionName: 'jiancheng_daka_api' };
  const transportFactory = () => event => { requests.push(event); throw Error('opening must not send a request'); };
  const app = { cloudSession: session, dataReady: Promise.resolve(),
    store: { read: () => domain.emptyState(), info: () => ({ ...status, source: 'cloud' }),
      contextKey: () => status.accountId + ':' + status.epoch, dispatch: command => writes.push(command) },
    featuresClient: createFeaturesClient(wx, cloud, { enabled: false }, session, { transportFactory }),
    planAssistant: createPlanAssistant(wx, cloud, { enabled: true, functionName: 'jiancheng_daka_plan' }, { session, transportFactory }) };
  global.getApp = () => app; global.wx = wx;
  t.after(() => pages.forEach(p => p.onUnload && p.onUnload()));
  for (const route of require('../miniprogram/app.json').pages) {
    let definition; global.Page = value => { definition = value; };
    const file = path.resolve(__dirname, '../miniprogram/' + route + '.js');
    delete require.cache[file]; require(file);
    const p = { ...definition, data: structuredClone(definition.data),
      setData(value, callback) { Object.assign(this.data, value); if (callback) callback(); } };
    pages.push(p); if (p.onLoad) p.onLoad({}); if (p.onShow) await p.onShow(); await new Promise(setImmediate);
    assert.equal(p.data.loading, false, route);
    const markup = fs.readFileSync(file.replace(/\.js$/, '.wxml'), 'utf8');
    for (const match of markup.matchAll(/(?:bind|catch)(?::)?(?:tap|change|input|focus|blur|keyboardheightchange)="(\w+)"/g)) {
      assert.equal(typeof p[match[1]], 'function', route + ': ' + match[1]);
    }
    for (const match of markup.matchAll(/<import src="([^"]+)"/g)) {
      const template = fs.readFileSync(path.resolve(path.dirname(file), match[1]), 'utf8');
      for (const hook of template.matchAll(/(?:bind|catch)(?::)?(?:tap|change|input)="(\w+)"/g)) {
        assert.equal(typeof p[hook[1]], 'function', route + ': template ' + hook[1]);
      }
    }
  }
  assert.equal(pages.length, 14); assert.equal(requests.length, 0); assert.equal(writes.length, 0);
});

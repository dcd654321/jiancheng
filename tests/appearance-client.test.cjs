const test = require('node:test');
const assert = require('node:assert/strict');
const { featuresFixture } = require('./helpers/features-fixture.cjs');
const { createAppearanceClient, validAppearance } = require('../miniprogram/services/appearance-client');
const { createAppearanceController, themeSnapshot } = require('../miniprogram/services/appearance');
const { THEMES } = require('../miniprogram/config/theme-tokens');

function harness(options = {}) {
  const f = featuresFixture();
  const account = { id: '', epoch: '' };
  let identity = f.identity;
  const session = {
    status: () => ({ ready: !!account.id, accountId: account.id, epoch: account.epoch,
      pending: options.pending ? 1 : 0, conflict: null, deletionPending: !!options.deletionPending,
      networkOffline: !!options.offline, phase: options.offline ? 'offline' : 'ready' })
  };
  const calls = [];
  const transport = async event => {
    calls.push(JSON.parse(JSON.stringify(event)));
    if (options.route) return options.route(event, f, calls);
    return f.features(event, identity);
  };
  const client = createAppearanceClient({}, { enabled: true, functionName: 'jiancheng_daka_api', envId: 'fixture' },
    { enabled: options.enabled !== false }, session, { transportFactory: () => transport, clock: () => 1000 });
  async function login(openid) {
    if (openid) identity = { ...f.identity, OPENID: openid };
    const snapshot = await f.api({ action: 'pull' }, identity);
    account.id = snapshot.accountId; account.epoch = snapshot.epoch;
    return snapshot;
  }
  return { f, session, client, calls, login, account, identity: () => identity };
}

test('appearance requests use the dedicated features function, never the main api function', async () => {
  const f = featuresFixture();
  const snapshot = await f.pull();
  const session = { status: () => ({ ready: true, accountId: snapshot.accountId, epoch: snapshot.epoch,
    pending: 0, conflict: null, deletionPending: false, networkOffline: false, phase: 'ready' }) };
  const configs = [];
  const client = createAppearanceClient({}, { enabled: true, functionName: 'jiancheng_daka_api', envId: 'fixture' },
    { enabled: true }, session, { transportFactory: (wxApi, config) => { configs.push(config); return event => f.features(event, f.identity); }, clock: () => 1000 });
  await client.read();
  await client.save('paper');
  assert.equal(configs.length, 1, '同一个客户端只创建一个传输器');
  assert.equal(configs[0].functionName, 'jiancheng_daka_features', '外观动作必须走专属 features 函数');
  assert.equal(configs[0].envId, 'fixture');
});
test('first read returns mist without writing preferences and shared reads dedupe', async () => {
  const h = harness();
  await h.login();
  const [one, two] = await Promise.all([h.client.read(), h.client.read()]);
  assert.deepEqual(one, { revision: 0, theme: 'mist' });
  assert.deepEqual(two, one);
  assert.equal(h.calls.filter(call => call.action === 'getAppearance').length, 1, '同一上下文共享一次在途读取');
  assert.equal(h.f.prefs.size, 0, '读取缺省主题不落库');
  assert.deepEqual(await h.client.read(), { revision: 0, theme: 'mist' }, '缓存命中不再请求');
});

test('a lost receipt keeps one frozen request: replay uses the same operationId and adds no revision', async () => {
  const h = harness();
  await h.login();
  const original = h.f.features;
  let lost = true;
  const failing = createAppearanceClient({}, { enabled: true, functionName: 'jiancheng_daka_api', envId: 'fixture' },
    { enabled: true }, h.session, {
      transportFactory: () => async event => {
        const result = await original(event, h.identity());
        if (lost && event.action === 'setAppearance') { lost = false; throw Error('response lost'); }
        return result;
      }, clock: () => 1000
    });
  await failing.read();
  await assert.rejects(failing.save('paper'), /response lost/);
  assert.equal(failing.status().frozen, 'paper', '结果不明保留冻结请求');
  const preference = h.f.prefs.get(h.account.id);
  assert.equal(preference.theme, 'paper', '服务端已写入');
  assert.equal(preference.preferenceReceipts.length, 1);
  const revision = preference.revision;
  const replayed = await failing.replay();
  assert.equal(replayed.theme, 'paper');
  assert.equal(replayed.replayed, true, '同请求重放由服务端幂等收据确认');
  assert.equal(h.f.prefs.get(h.account.id).revision, revision, '重放不增加偏好版本');
  assert.equal(h.f.prefs.get(h.account.id).preferenceReceipts.length, 1, '重放不产生第二条收据');
  assert.equal(failing.status().frozen, null);
});

test('save requires a readable revision and never freezes on known precondition failures', async () => {
  const h = harness();
  await assert.rejects(h.client.save('paper'), /云端记录尚未读取/);
  assert.equal(h.calls.length, 0, '没有可信上下文时不发请求');
  assert.equal(h.client.status().frozen, null);
  const offline = harness({ offline: true });
  await offline.login();
  await assert.rejects(offline.client.save('paper'), /连接网络后可保存主题/);
  assert.equal(offline.calls.length, 0);
  assert.equal(offline.client.status().frozen, null);
  const busy = harness({ pending: true });
  await busy.login();
  await assert.rejects(busy.client.save('paper'), /请先完成云端同步/);
  assert.equal(busy.calls.length, 0);
});

test('known rejections end the frozen request while unknown results keep it for identical replay only', async () => {
  const h = harness({ route: async (event, f) => {
    if (event.action === 'setAppearance') return { ok: false, code: 'NOT_ENABLED', message: '外观主题服务尚未开放' };
    return f.features(event, f.identity);
  } });
  await h.login();
  await h.client.read();
  await assert.rejects(h.client.save('paper'), /尚未开放/);
  assert.equal(h.client.status().frozen, null, '无副作用的拒绝不保留冻结');
  const g = harness({ route: async (event, f) => {
    if (event.action === 'setAppearance') throw Error('network down');
    return f.features(event, f.identity);
  } });
  await g.login();
  await g.client.read();
  await assert.rejects(g.client.save('paper'), /network down/);
  assert.equal(g.client.status().frozen, 'paper');
  await assert.rejects(g.client.save('mist'), /network down/, '不确定状态下再次保存只允许原请求核对');
  const sends = g.calls.filter(call => call.action === 'setAppearance');
  assert.equal(sends.length, 2);
  assert.deepEqual(sends[0], sends[1], '重放必须是完全相同的 operationId 与 payload');
});

test('conflict keeps the server value authoritative and a new explicit save uses the new revision', async () => {
  const h = harness();
  await h.login();
  // 另一设备先修改偏好到 paper（revision 1）
  await h.f.features({ action: 'setAppearance', epoch: h.account.epoch, operationId: 'other-device', expectedRevision: 0, theme: 'paper' }, h.f.identity);
  // 本机缓存仍是 revision 0 的陈旧视图；冲突后重新读取拿到当前服务端版本
  let staleReads = 1;
  const stale = createAppearanceClient({}, { enabled: true, functionName: 'jiancheng_daka_api', envId: 'fixture' }, { enabled: true }, h.session, {
    transportFactory: () => async event => {
      if (event.action === 'getAppearance' && staleReads > 0) { staleReads -= 1; return { ok: true, appearance: { revision: 0, theme: 'mist' } }; }
      return h.f.features(event, h.f.identity);
    }, clock: () => 2000
  });
  await stale.read();
  await assert.rejects(stale.save('mist'), err => err.code === 'CONFLICT');
  assert.equal(stale.status().frozen, null, '冲突不保留冻结请求，避免自动覆盖');
  assert.equal(h.f.prefs.get(h.account.id).theme, 'paper', '冲突时不覆盖他人修改');
  const next = await stale.save('mist');
  assert.equal(next.revision, 2, '用户再次确认后使用新 revision');
  assert.equal(h.f.prefs.get(h.account.id).theme, 'mist');
});

test('stale account responses are rejected and never applied to a new context', async () => {
  const h = harness({ route: async (event, f) => {
    const result = await f.features(event, f.identity);
    if (event.action === 'setAppearance') { h.account.id = 'b'.repeat(64); h.account.epoch = 'epoch-switched'; }
    return result;
  } });
  await h.login();
  await h.client.read();
  await assert.rejects(h.client.save('paper'), /账户数据已变化/);
  assert.equal(h.client.status().frozen, null, '上下文变化丢弃旧回包与冻结请求');
});

test('controller applies only validated receipts, resets on account change and drives native chrome', async () => {
  const h = harness();
  await h.login();
  const native = { nav: [], tab: [], items: [], background: [] };
  const wxApi = {
    setNavigationBarColor: value => native.nav.push(value),
    setTabBarStyle: value => native.tab.push(value),
    setTabBarItem: value => native.items.push(value),
    setBackgroundColor: value => native.background.push(value)
  };
  const controller = createAppearanceController({ client: h.client, wxApi, session: h.session });
  const seen = [];
  controller.subscribe(view => seen.push(view.theme));
  await controller.ensureRead();
  assert.equal(controller.current(), 'mist');
  assert.equal(native.nav.at(-1).backgroundColor, THEMES.mist.page);
  const paper = await controller.save('paper');
  assert.equal(paper.theme, 'paper');
  assert.equal(controller.current(), 'paper');
  assert.equal(native.tab.at(-1).selectedColor, THEMES.paper.primary);
  assert.equal(native.items.at(-1).selectedIconPath, 'assets/tabbar/mine-selected-paper.png');
  // 账户切换：新账户从缺省 mist 重新读取，不沿用旧账户回包
  await h.login('user_c');
  const switched = await controller.ensureRead();
  assert.equal(switched.theme, 'mist', '新账户缺省回到 mist');
  assert.equal(controller.current(), 'mist');
  assert.ok(seen.includes('paper') && seen.includes('mist'));
  assert.throws(() => validAppearance({ revision: -1, theme: 'mist' }));
  assert.throws(() => validAppearance({ revision: 0, theme: 'dark' }));
  assert.throws(() => validAppearance({ revision: 0.5, theme: 'paper' }));
  assert.throws(() => validAppearance({ revision: 0, theme: {} }));
});

test('native chrome failures never block applying the theme', async () => {
  const h = harness();
  await h.login();
  const wxApi = {
    setNavigationBarColor() { throw Error('base library too old'); },
    setTabBarStyle() { throw Error('unsupported'); },
    setTabBarItem() { throw Error('unsupported'); },
    setBackgroundColor() { throw Error('unsupported'); }
  };
  const controller = createAppearanceController({ client: h.client, wxApi, session: h.session });
  await controller.ensureRead();
  const paper = await controller.save('paper');
  assert.equal(paper.theme, 'paper');
  assert.equal(controller.current(), 'paper');
});

test('theme snapshot falls back to mist without an app controller and reports the pending theme', async () => {
  global.getApp = () => ({});
  assert.equal(themeSnapshot().theme, 'mist');
  assert.equal(themeSnapshot().primary, THEMES.mist.primary);
  const h = harness({ route: async (event, f) => {
    if (event.action === 'setAppearance') throw Error('unknown');
    return f.features(event, f.identity);
  } });
  await h.login();
  const controller = createAppearanceController({ client: h.client, wxApi: {}, session: h.session });
  global.getApp = () => ({ appearanceController: controller });
  await controller.ensureRead();
  await assert.rejects(controller.save('paper'));
  assert.equal(themeSnapshot().pendingTheme, 'paper');
  assert.equal(themeSnapshot().theme, 'mist', '不确定状态下全局仍显示已确认主题');
});

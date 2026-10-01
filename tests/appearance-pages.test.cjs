const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { featuresFixture } = require('./helpers/features-fixture.cjs');
const { createAppearanceClient } = require('../miniprogram/services/appearance-client');
const { createAppearanceController } = require('../miniprogram/services/appearance');
const { THEMES } = require('../miniprogram/config/theme-tokens');

async function setup(t, options = {}) {
  const f = featuresFixture();
  const snapshot = await f.pull();
  const toasts = [], nav = [];
  const sessionState = { ready: true, accountId: snapshot.accountId, epoch: snapshot.epoch,
    pending: 0, conflict: null, deletionPending: false, networkOffline: !!options.offline, phase: options.offline ? 'offline' : 'ready' };
  const session = { status: () => ({ ...sessionState }), subscribe: () => () => {} };
  const calls = [];
  const client = createAppearanceClient({}, { enabled: true, functionName: 'jiancheng_daka_api', envId: 'fixture' },
    { enabled: options.enabled !== false }, session, {
      transportFactory: () => async event => {
        calls.push(JSON.parse(JSON.stringify(event)));
        if (options.route) return options.route(event, f, calls);
        return f.features(event, f.identity);
      }, clock: () => 1000
    });
  const wx = { navigateTo: o => nav.push(o.url), navigateBack: o => nav.push('back'), switchTab: o => nav.push(o.url),
    showToast: o => toasts.push(o), setNavigationBarTitle() {}, showModal() {} };
  const controller = createAppearanceController({ client, wxApi: wx, session });
  const store = { contextKey: () => sessionState.accountId + ':' + sessionState.epoch,
    read: () => structuredClone(f.db.get(sessionState.accountId).state),
    info: () => ({ ready: true, source: 'cloud', pending: 0 }),
    dispatch: async command => { const r = await f.api(f.request(await f.pull(), command)); return r.state; } };
  const app = { cloudSession: session, store, appearanceController: controller, quoteSession: { current: () => '' } };
  global.wx = wx; global.getApp = () => app;
  const pages = []; t.after(() => pages.forEach(p => p.onUnload && p.onUnload()));
  function page(name, opts = {}) {
    let definition; global.Page = value => { definition = value; };
    const source = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
    delete require.cache[source]; require(source);
    const p = { ...definition, data: structuredClone(definition.data),
      setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); } };
    pages.push(p); if (p.onLoad) p.onLoad(opts); if (p.onShow) p.onShow();
    return p;
  }
  // 等待账户就绪后的主题读取结算，再断言渲染结果。
  async function open(name, opts = {}) {
    const p = page(name, opts);
    await controller.ensureRead();
    await new Promise(resolve => setImmediate(resolve));
    return p;
  }
  return { f, snapshot, sessionState, session, client, calls, wx, nav, toasts, controller, app, page, open };
}

for (const fail of [false,true]) test(`an old theme save ${fail?'failure':'success'} keeps a newer preview and stays quiet`, async t=>{
  let release,started=false;
  const h=await setup(t,{route:async(event,f)=>{
    if(event.action==='setAppearance'){
      started=true;await new Promise(ok=>{release=ok;});
      if(fail)throw Error('旧保存失败');
    }
    return f.features(event,f.identity);
  }});
  const p=await h.open('appearance'); p.onPick({currentTarget:{dataset:{theme:'paper'}}});
  const work=p.onApply(); await new Promise(setImmediate); assert.equal(started,true);
  p.onHide();p.onShow();p.onPick({currentTarget:{dataset:{theme:'mist'}}});release();await work;
  assert.equal(p.data.preview,'mist');assert.equal(p.data.saveError,'');assert.equal(h.toasts.length,0);
  assert.equal(p.data.saving,false);
});

test('closed capability hides the mine entry and the direct page explains and exits', async t => {
  const h = await setup(t, { enabled: false });
  const mine = await h.open('mine');
  assert.equal(mine.data.appearanceEnabled, false);
  const markup = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/mine/index.wxml'), 'utf8');
  assert.match(markup, /wx:if="\{\{appearanceEnabled\}\}"[^>]*bindtap="onAppearance"/, '入口随能力开关隐藏，不显示必定失败的选项');
  const page = await h.open('appearance');
  assert.equal(page.data.enabled, false);
  page.onBack(); assert.equal(h.nav.at(-1), 'back');
});

test('two fixed previews keep their own colors; picking previews in-page without any write', async t => {
  const h = await setup(t);
  const page = await h.open('appearance');
  assert.equal(page.data.enabled, true);
  assert.deepEqual(page.data.options.map(o => o.key), ['mist', 'paper'], '固定顺序薄雾绿、暖纸白');
  assert.deepEqual(page.data.options.map(o => o.badge), ['使用中', '']);
  assert.equal(page.data.primaryLabel, '正在使用');
  assert.equal(page.data.primaryDisabled, true, '选中当前主题时按钮为正在使用且禁用');
  page.onPick({ currentTarget: { dataset: { theme: 'paper' } } });
  assert.equal(page.data.theme, 'paper', '仅本页预览改变');
  assert.deepEqual(page.data.options.map(o => o.badge), ['使用中', '预览中'], '已保存标使用中，未保存的选择标预览中');
  assert.equal(page.data.primaryLabel, '使用暖纸白');
  assert.equal(h.calls.filter(call => call.action === 'setAppearance').length, 0, '预览不发写请求');
  assert.equal(h.controller.current(), 'mist', '全局主题不变');
  const markup = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/appearance/index.wxml'), 'utf8');
  assert.match(markup, /class="theme-thumb theme-\{\{item\.key\}\}"/, '缩略图固定使用各自主题');
  assert.match(markup, /aria-pressed/);
});

test('preview keeps its root color after a forced read and delayed first read', async t => {
  const h = await setup(t);
  const page = await h.open('appearance');
  page.onPick({ currentTarget: { dataset: { theme: 'paper' } } });
  await h.controller.ensureRead(true);
  assert.equal(page.data.theme, 'paper');
  assert.equal(page.data.preview, 'paper');
  assert.equal(page.data.savedTheme, 'mist');
  assert.equal(page.data.primaryLabel, '使用暖纸白');
  assert.equal(h.calls.filter(call => call.action === 'setAppearance').length, 0);

  let release;
  const delayed = await setup(t, { route: async (event, f) => {
    if (event.action === 'getAppearance') await new Promise(resolve => { release = resolve; });
    return f.features(event, f.identity);
  } });
  const first = delayed.page('appearance');
  first.onPick({ currentTarget: { dataset: { theme: 'paper' } } });
  assert.equal(first.data.hasRevision, false);
  release();
  await delayed.controller.ensureRead();
  assert.equal(first.data.theme, 'paper');
  assert.equal(first.data.savedTheme, 'mist');
  assert.equal(delayed.calls.filter(call => call.action === 'setAppearance').length, 0);
});

test('leaving without saving discards the preview while a save applies one request and keeps the page', async t => {
  const h = await setup(t);
  const page = await h.open('appearance');
  page.onPick({ currentTarget: { dataset: { theme: 'paper' } } });
  page.onHide(); page.onShow();
  assert.equal(page.data.preview, 'paper', '同一页面生命周期内保留选择');
  const reopened = await h.open('appearance');
  assert.equal(reopened.data.preview, 'mist', '重新进入不被未保存的预览带偏');
  reopened.onPick({ currentTarget: { dataset: { theme: 'paper' } } });
  await reopened.onApply();
  assert.equal(h.calls.filter(call => call.action === 'setAppearance').length, 1);
  assert.equal(h.controller.current(), 'paper', '云回执确认后全局应用');
  assert.equal(reopened.data.savedTheme, 'paper');
  assert.deepEqual(reopened.data.options.map(o => o.badge), ['', '使用中']);
  assert.match(h.toasts.at(-1).title, /已切换为暖纸白/);
  assert.equal(reopened.data.primaryLabel, '正在使用');
  // 选当前主题不重复提交
  await reopened.onApply();
  assert.equal(h.calls.filter(call => call.action === 'setAppearance').length, 1);
});

test('offline shows the reason, disables saving but still allows preview', async t => {
  const h = await setup(t, { offline: true });
  const page = await h.open('appearance');
  page.onPick({ currentTarget: { dataset: { theme: 'paper' } } });
  assert.equal(page.data.preview, 'paper');
  assert.match(page.data.statusNote, /连接网络后可保存主题/);
  assert.equal(page.data.primaryDisabled, true);
  await page.onApply();
  assert.equal(h.calls.filter(call => call.action === 'setAppearance').length, 0, '离线不排队、不写请求');
});

test('unknown save results keep the old theme, offer re-check, and replay the identical request', async t => {
  let lost = true;
  const h = await setup(t, { route: async (event, f) => {
    const result = await f.features(event, f.identity);
    if (lost && event.action === 'setAppearance') { lost = false; throw Error('timeout'); }
    return result;
  } });
  const page = await h.open('appearance');
  page.onPick({ currentTarget: { dataset: { theme: 'paper' } } });
  await page.onApply();
  assert.equal(h.controller.current(), 'mist', '确认前全局保持已保存主题');
  assert.equal(page.data.pendingTheme, 'paper');
  assert.equal(page.data.primaryLabel, '重新核对');
  assert.match(page.data.statusNote, /待核对/);
  assert.equal(h.f.prefs.get(h.snapshot.accountId).theme, 'paper', '服务端已写入');
  const sends = h.calls.filter(call => call.action === 'setAppearance');
  await page.onApply();
  const after = h.calls.filter(call => call.action === 'setAppearance');
  assert.deepEqual(after[0], after[1], '重新核对只重放相同 operationId 与 payload');
  assert.equal(h.controller.current(), 'paper');
  assert.equal(page.data.savedTheme, 'paper');
  assert.equal(after.length, sends.length + 1);
});

test('conflict reads the current cloud value, keeps the preview and only a new explicit tap writes again', async t => {
  let bumped = false;
  const h = await setup(t, { route: async (event, f) => {
    if (event.action === 'setAppearance' && !bumped) {
      bumped = true;
      // 另一设备先写入 mist，把偏好版本推进到 revision 1；本页保存仍基于 revision 0
      await f.features({ action: 'setAppearance', epoch: event.epoch, operationId: 'other-device', expectedRevision: 0, theme: 'mist' }, f.identity);
    }
    return f.features(event, f.identity);
  } });
  const page = await h.open('appearance');
  page.onPick({ currentTarget: { dataset: { theme: 'paper' } } });
  await page.onApply();
  assert.match(page.data.saveError, /其他设备更新/);
  assert.equal(page.data.preview, 'paper', '保留用户选择预览，不静默覆盖');
  await h.controller.ensureRead(true);
  assert.equal(page.data.theme, 'paper', '冲突重读后的根颜色仍与预览一致');
  assert.equal(h.controller.current(), 'mist', '冲突后先应用当前云值');
  const writes = h.calls.filter(call => call.action === 'setAppearance');
  assert.equal(writes.length, 1, '冲突不产生第二次自动写入');
  await page.onApply();
  const after = h.calls.filter(call => call.action === 'setAppearance');
  assert.equal(after.length, 2);
  assert.equal(after[1].expectedRevision, 1, '用户再次确认后使用读取到的新 revision');
  assert.equal(h.f.prefs.get(h.snapshot.accountId).theme, 'paper');
  assert.equal(h.controller.current(), 'paper');
  assert.equal(page.data.preview, 'paper', '应用后页面仍停留在所选主题');
});

test('a save that outlives the page still updates the global theme without touching the destroyed view', async t => {
  let release;
  const h = await setup(t, { route: async (event, f) => {
    if (event.action === 'setAppearance') { await new Promise(resolve => { release = resolve; }); }
    return f.features(event, f.identity);
  } });
  const page = await h.open('appearance');
  page.onPick({ currentTarget: { dataset: { theme: 'paper' } } });
  const work = page.onApply();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.data.saving, true);
  let updated = false;
  page.setData = () => { updated = true; throw Error('destroyed view must not be updated'); };
  page.onUnload();
  release();
  await work;
  assert.equal(updated, false, '卸载后的页面不被回调更新');
  assert.equal(h.controller.current(), 'paper', '已发出的云事务由会话协调器按有效回执更新全局');
});

test('mine shows the confirmed theme name and the pending re-check note', async t => {
  const h = await setup(t, { route: async (event, f) => {
    if (event.action === 'setAppearance') throw Error('timeout');
    return f.features(event, f.identity);
  } });
  const page = await h.open('appearance');
  page.onPick({ currentTarget: { dataset: { theme: 'paper' } } });
  await page.onApply();
  const mine = await h.open('mine');
  assert.equal(mine.data.appearanceEnabled, true);
  assert.equal(mine.data.appearancePending, true);
  assert.equal(mine.data.appearanceLabel, '主题保存结果待核对');
  const markup = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/mine/index.wxml'), 'utf8');
  assert.match(markup, /保存结果待核对/);
});

test('every registered page root consumes the theme scope with a single template set', () => {
  const app = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../miniprogram/app.json'), 'utf8'));
  for (const page of app.pages) {
    const markup = fs.readFileSync(path.resolve(__dirname, '../miniprogram', page + '.wxml'), 'utf8');
    assert.match(markup, /class="page[^"]*theme-\{\{theme\}\}/, page + ' 根节点消费主题作用域');
  }
  const themeScope = fs.readFileSync(path.resolve(__dirname, '../miniprogram/styles/theme.wxss'), 'utf8');
  assert.match(themeScope, /\.theme-mist \{/);
  assert.match(themeScope, /\.theme-paper \{/);
  const tokens = require('../miniprogram/config/theme-tokens');
  for (const [name, values] of Object.entries(tokens.THEMES)) {
    for (const [key, value] of Object.entries(values)) {
      assert.ok(themeScope.includes(value), name + '.' + key + ' 出现在生成的主题作用域中');
    }
  }
  assert.equal(THEMES.mist.page, '#F7F8F5');
  assert.equal(THEMES.paper.primary, '#79604F');
});

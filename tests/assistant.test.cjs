const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createPlanAssistant } = require('../miniprogram/services/plan-assistant');
const { DIRECTIONS, validateInput, ruleSuggestion } = require('../miniprogram/core/plan-assistant');
const { createStore } = require('../miniprogram/services/store');
const { createWorkspaceStore } = require('../miniprogram/services/workspace-store');
const input = extra => ({ direction: 'read', minutes: 5, weekdays: [1, 2, 3, 4, 5], time: '12:30', ...extra });
const cloudConfig = { enabled: true, envId: 'local-test' }, aiConfig = { enabled: true, functionName: 'jiancheng_daka_plan', timeoutMs: 1000 };
function fixture(reply, config = aiConfig, cloud = cloudConfig) {
  const calls = [], inits = [];
  const wx = { cloud: { init: o => inits.push(o), callFunction: o => { calls.push(o); return reply ? reply(o) : Promise.resolve({ result: {
    ok: true, source: 'ai', moderated: true, operationId: o.data.operationId, draft: ruleSuggestion(o.data.input).draft } }); } } };
  const service = createPlanAssistant(wx, cloud, config); return { service, calls, inits, wx };
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('本机规则四方向均可用，不超过用户时长，1分钟不产生无效简化目标', () => {
  for (const d of DIRECTIONS) for (const minutes of [1, 2, 3, 5, 30, 60]) {
    const result = ruleSuggestion(input({ direction: d.id, minutes }));
    assert.equal(result.source, 'rule'); assert.ok(result.draft.target <= minutes);
    assert.deepEqual(result.draft.weekdays, [1, 2, 3, 4, 5]); assert.equal(result.draft.time, '12:30');
    assert.equal(minutes === 1 ? result.draft.minimum : null, null);
    assert.ok(!result.draft.minimum || result.draft.minimum < result.draft.target);
  }
});
test('计划助手输入不接受非法方向、时长、星期或时间；只返回必要字段', () => {
  for (const x of [{ direction: 'medical' }, { minutes: 0 }, { minutes: 61 }, { minutes: 1.5 }, { weekdays: [] }, { weekdays: [8] }, { time: '99:00' }]) assert.throws(() => validateInput(input(x)));
  assert.deepEqual(validateInput(input({ minutes: '5', privateNote: 'private', occupation: 'private' })), input());
});
test('AI双开关/占位符/同意门控，打开和本机模板不联网', async () => {
  for (const [c, a] of [[cloudConfig, { ...aiConfig, enabled: false }], [{ ...cloudConfig, enabled: false }, aiConfig], [{ ...cloudConfig, envId: 'YOUR_CLOUD_ENV_ID' }, aiConfig]]) {
    const f = fixture(null, a, c); f.service.status(); f.service.rules(input());
    await assert.rejects(f.service.generate(input(), true), /尚未配置/); assert.equal(f.calls.length, 0); assert.equal(f.inits.length, 0);
  }
  const f = fixture(); await assert.rejects(f.service.generate(input(), false), /同意/); assert.equal(f.calls.length, 0);
});
test('AI仅发送必要安排，检验请求ID/来源/安全标记；星期和时间仍由用户决定', async () => {
  const f = fixture(o => Promise.resolve({ result: { ok: true, source: 'ai', moderated: true, operationId: o.data.operationId,
    draft: { ...ruleSuggestion(input()).draft, weekdays: [7], time: '23:59' } } }));
  const result = await f.service.generate(input({ privateNote: '不得上传' }), true);
  assert.equal(result.source, 'ai'); assert.deepEqual(result.draft.weekdays, [1, 2, 3, 4, 5]); assert.equal(result.draft.time, '12:30');
  assert.deepEqual(f.calls[0].data.input, input()); assert.deepEqual(f.inits[0], { env: 'local-test', traceUser: false });
  assert.equal(f.service.status().busy, false);
});
test('未审核、错误来源/请求ID、额度耗尽及非法AI目标均不产生可用预览', async () => {
  for (const change of [r => { r.moderated = false; }, r => { r.source = 'rule'; }, r => { r.operationId = 'different'; },
    r => { r.draft.target = 80; }, r => { r.draft.target = '5'; }, r => { r.draft.action = '<script>x</script>'; }, r => { r.ok = false; r.code = 'RATE_LIMITED'; }]) {
    const f = fixture(o => { const result = { ok: true, source: 'ai', moderated: true, operationId: o.data.operationId, draft: ruleSuggestion(input()).draft }; change(result); return Promise.resolve({ result }); });
    await assert.rejects(f.service.generate(input(), true)); assert.equal(f.service.status().busy, false);
  }
});
test('AI并发保护：超时不自动重试，底层请求未完成时禁止再次计费请求', async () => {
  const pending = deferred(), f = fixture(() => pending.promise, { ...aiConfig, timeoutMs: 10 });
  const work = f.service.generate(input(), true);
  await assert.rejects(f.service.generate(input(), true), /尚未结束/);
  await assert.rejects(work, /超时/); assert.equal(f.calls.length, 1); assert.equal(f.service.status().busy, true);
  assert.equal(f.service.rules(input()).source, 'rule');
  await assert.rejects(f.service.generate(input(), true), /尚未结束/);
  pending.resolve({ result: { ok: false } }); await new Promise(r => setImmediate(r));
  assert.equal(f.service.status().busy, false); assert.equal(f.calls.length, 1);
});
test('同步云初始化/调用失败、异步网络错误都释放请求锁', async () => {
  const f = fixture(); f.wx.cloud.init = () => { throw Error('init'); };
  await assert.rejects(f.service.generate(input(), true), /init/); assert.equal(f.service.status().busy, false);
  const g = fixture(() => { throw Error('call'); }); await assert.rejects(g.service.generate(input(), true), /call/); assert.equal(g.service.status().busy, false);
  const h = fixture(() => Promise.reject(Error('offline'))); await assert.rejects(h.service.generate(input(), true), /offline/); assert.equal(h.service.status().busy, false);
});
test('草稿交接仅会话内、一次性、限时、与数据状态绑定，值不能被引用篡改', () => {
  let now = 1000; const service = createPlanAssistant({}, {}, {}, { clock: () => now }), suggestion = ruleSuggestion(input());
  const token = service.handoff(suggestion, 'local:0'); suggestion.draft.title = '改了';
  assert.equal(service.consume(token, 'local:0').draft.title, '读一会儿'); assert.throws(() => service.consume(token, 'local:0'), /过期/);
  const second = service.handoff(ruleSuggestion(input()), 'local:0'); assert.throws(() => service.consume(second, 'cloud:1'), /状态/);
  const third = service.handoff(ruleSuggestion(input()), 'local:0'); now += 600001; assert.throws(() => service.consume(third, 'local:0'), /过期/);
});

function pageFixture(override) {
  const f = fixture(override), memory = {}, navigation = [], toasts = [];
  const wx = { ...f.wx, getStorageSync: k => memory[k], setStorageSync: (k, v) => { memory[k] = v; }, removeStorageSync: k => { delete memory[k]; },
    setNavigationBarTitle() {}, navigateTo: o => navigation.push(o), navigateBack() {}, switchTab: o => navigation.push(o), showToast: o => toasts.push(o) };
  const active = createStore(wx);
  const legacyMemory = {};
  const legacy = createStore({ getStorageSync: key => legacyMemory[key],
    setStorageSync: (key, value) => { legacyMemory[key] = value; }, removeStorageSync: key => { delete legacyMemory[key]; } });
  let accountId = 'a'.repeat(64);
  const session = {
    status: () => ({ busy: false, ready: true, phase: 'ready', accountId, pending: 0 }),
    read: () => active.read(),
    dispatch: command => active.dispatch(command),
    backup: () => JSON.stringify({ format: 'test', state: active.read() })
  };
  const store = createWorkspaceStore(legacy, session);
  global.wx = wx; global.getApp = () => ({ store, planAssistant: f.service });
  const page = (name, options = {}) => { let def; global.Page = x => { def = x; };
    const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js'); delete require.cache[file]; require(file);
    const p = { ...def, data: JSON.parse(JSON.stringify(def.data)), setData(x) { Object.assign(this.data, x); } };
    if (p.onLoad) p.onLoad(options); p.refresh(); return p; };
  return { ...f, store, page, navigation, toasts,
    changeAccount() { accountId = 'b'.repeat(64); } };
}
test('真实助手页→预览→创建表单：两步采用，预览和导航均不创建习惯', () => {
  const f = pageFixture(), p = f.page('assistant'); p.onRules();
  assert.equal(p.data.preview.source, 'rule'); assert.equal(f.store.read().habits.length, 0);
  p.onAdopt(); p.onAdopt(); assert.equal(f.navigation.length, 1); assert.equal(f.store.read().habits.length, 0);
  const token = f.navigation[0].url.split('draft=')[1], edit = f.page('edit', { draft: token });
  assert.match(edit.data.source, /本机规则/); assert.equal(edit.data.target, '5'); assert.deepEqual(edit.data.weekdays, [1, 2, 3, 4, 5]);
  edit.onSave(); assert.equal(f.store.read().habits.length, 1); assert.equal(f.calls.length, 0);
});
test('修改输入清除旧预览，过期交接不保存；账户状态切换后需重新预览', () => {
  const f = pageFixture(), p = f.page('assistant'); p.onRules(); p.onMinutes({ detail: { value: '2' } });
  assert.equal(p.data.preview, null); p.onAdopt(); assert.equal(f.navigation.length, 0);
  const edit = f.page('edit', { draft: 'missing' }); edit.onSave(); assert.match(edit.data.error, /失效/); assert.equal(f.store.read().habits.length, 0);
  p.onRules(); f.changeAccount(); p.onAdopt(); assert.match(p.data.error, /数据状态/); assert.equal(f.navigation.length, 0);
});
test('生成过程中禁止改输入与重复请求，离开后的结果不会写入页面', async () => {
  const pending = deferred(), f = pageFixture(() => pending.promise), p = f.page('assistant'); p.setData({ consent: true });
  const work = p.onGenerate(); p.onMinutes({ detail: { value: '2' } }); assert.equal(p.data.minutes, '5');
  await p.onGenerate(); assert.equal(f.calls.length, 1);
  p.onHide(); p.onUnload();
  pending.resolve({ result: { ok: true, source: 'ai', moderated: true, operationId: f.calls[0].data.operationId, draft: ruleSuggestion(input()).draft } });
  await work; assert.equal(p.data.preview, null); assert.equal(f.store.read().habits.length, 0);
});

test('预览渲染后才滚动；隐藏、卸载、修改输入或切换来源后不滚动其他页面', () => {
  for (const action of ['visible', 'hide', 'unload', 'change', 'source']) {
    const f = pageFixture(), p = f.page('assistant'), callbacks = [], scrolls = [];
    global.wx.pageScrollTo = o => scrolls.push(o);
    p.setData = function (data, callback) { Object.assign(this.data, data); if (callback) callbacks.push(callback); };
    p.onRules(); assert.equal(scrolls.length, 0);
    if (action === 'hide') p.onHide();
    if (action === 'unload') p.onUnload();
    if (action === 'change') p.onMinutes({ detail: { value: '3' } });
    if (action === 'source') f.changeAccount();
    callbacks.forEach(fn => fn());
    assert.equal(scrolls.length, action === 'visible' ? 1 : 0);
    if (scrolls.length) assert.equal(scrolls[0].selector, '#plan-preview');
  }
});

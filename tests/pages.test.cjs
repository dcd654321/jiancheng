const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ui = require('../miniprogram/services/ui');
const { createStore, STORAGE_KEY } = require('../miniprogram/services/store');
const { createCloudSession } = require('../miniprogram/services/cloud-session');
const { createWorkspaceStore } = require('../miniprogram/services/workspace-store');
const { fixture } = require('./helpers/cloud-fixture.cjs');

function harness() {
  const storage = {}, navigation = [], modals = [], toasts = [], exports = [];
  const wx = {
    getStorageSync: k => storage[k], setStorageSync: (k, value) => { storage[k] = value; }, removeStorageSync: k => { delete storage[k]; },
    navigateTo: value => navigation.push(['push', value.url]), navigateBack: () => navigation.push(['back']), switchTab: value => navigation.push(['tab', value.url]),
    setNavigationBarTitle: () => {}, showToast: value => toasts.push(value), showModal: value => modals.push(value),
    env: { USER_DATA_PATH: '/test-files' }, shareFileMessage: value => exports.push(value),
    getFileSystemManager: () => ({
      writeFile: value => { exports.push(value); value.success(); },
      unlinkSync: () => {}, renameSync: () => {}
    })
  };
  const store = createStore(wx);
  global.wx = wx; global.getApp = () => ({ store });
  function page(name, options = {}) {
    let definition;
    global.Page = value => { definition = value; };
    const source = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
    delete require.cache[source]; require(source);
    const result = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch); } };
    if (result.onLoad) result.onLoad(options);
    result.refresh(); return result;
  }
  return { page, store, storage, navigation, modals, toasts, exports, wx };
}
function seed(h) {
  const edit = h.page('edit', { template: 'read' }); edit.onSave();
  return h.store.read().habits[0].id;
}
function event(dataset = {}, value) { return { currentTarget: { dataset }, detail: { value } }; }

async function cloudHarness({ consent = false } = {}) {
  const f = fixture();
  f.date = ui.date.today();
  await f.seed();
  const storage = {}, navigation = [];
  const wx = {
    getStorageSync: key => storage[key],
    setStorageSync: (key, value) => { storage[key] = value; },
    removeStorageSync: key => { delete storage[key]; },
    navigateTo: value => navigation.push(value.url),
    showModal() {}, showToast() {}, setNavigationBarTitle() {},
    env: { USER_DATA_PATH: '/test-files' },
    getFileSystemManager: () => ({ writeFile() {} })
  };
  const session = createCloudSession(wx, { enabled: true, envId: 'test-env' }, () => event => f.api(event));
  const legacy = createStore(wx);
  const store = createWorkspaceStore(legacy, session);
  const app = { store, cloudSession: session, quoteSession: { current: () => '一点，也算向前。' } };
  global.wx = wx;
  global.getApp = () => app;
  function page(name, options = {}) {
    let definition;
    global.Page = value => { definition = value; };
    const source = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
    delete require.cache[source]; require(source);
    const result = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch); } };
    if (result.onLoad) result.onLoad(options);
    if (result.refresh) result.refresh();
    return result;
  }
  if (consent) await session.acceptConsent(true);
  return { f, wx, storage, navigation, session, legacy, store, page };
}

function deletionPage({ clearFails }) {
  const storage = { [STORAGE_KEY]: 'legacy-raw' }, modals = [], toasts = [];
  const files = new Set(['/files/yidian-export.json']);
  let calls = 0;
  const state = ui.domain.emptyState();
  const store = {
    read: () => state,
    contextKey: () => 'cloud:test:0',
    info: () => ({ source: 'cloud', ready: true, phase: 'ready', pending: 0,
      syncText: '数据已同步', lastSyncedAt: '2026-09-15T00:00:00.000Z' }),
    clear: async confirmation => {
      calls += 1;
      assert.equal(confirmation, 'DELETE_MY_DATA');
      if (clearFails) throw Error('云端未确认删除');
      delete storage[STORAGE_KEY];
      return { state };
    }
  };
  global.getApp = () => ({ store, cloudSession: { status: store.info } });
  global.wx = {
    showModal: value => modals.push(value), showToast: value => toasts.push(value),
    env: { USER_DATA_PATH: '/files' },
    getFileSystemManager: () => ({
      unlinkSync(filePath) {
        if (!files.delete(filePath)) { const error = Error('ENOENT'); error.code = 'ENOENT'; throw error; }
      }
    })
  };
  let definition;
  global.Page = value => { definition = value; };
  const source = path.resolve(__dirname, '../miniprogram/pages/mine/index.js');
  delete require.cache[source]; require(source);
  const mine = { ...definition, data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch); } };
  mine.refresh();
  return { mine, modals, toasts, files, storage, clearCalls: () => calls };
}

test('cloud or acknowledgement failure never clears legacy data or exports', async () => {
  const h = deletionPage({ clearFails: true });
  const legacyRaw = h.storage[STORAGE_KEY];
  h.mine.onDelete();
  await h.modals.shift().success({ confirm: true });
  await h.modals.shift().success({ confirm: true });
  assert.equal(h.clearCalls(), 1);
  assert.equal(h.storage[STORAGE_KEY], legacyRaw);
  assert.equal(h.files.has('/files/yidian-export.json'), true);
  assert.match(h.mine.data.error, /未确认删除/);
});

test('confirmed cloud deletion cleans local exports only after acknowledgement', async () => {
  const h = deletionPage({ clearFails: false });
  h.mine.onDelete();
  h.modals.shift().success({ confirm: true });
  await h.modals.shift().success({ confirm: true });
  assert.equal(h.clearCalls(), 1);
  assert.equal(h.storage[STORAGE_KEY], undefined);
  assert.equal(h.files.has('/files/yidian-export.json'), false);
  assert.equal(h.toasts.at(-1).title, '全部数据已清除');
});

test('首次页面只在同意后读取云端，且从不创建或上传旧本机记录', async () => {
  const h = await cloudHarness();
  const legacyRaw = h.legacy.rawBackup();
  const today = h.page('today');
  assert.equal(today.data.needsConsent, true);
  assert.equal(today.data.dataReady, false);
  today.onDataStart();
  assert.equal(h.navigation.at(-1), '/pages/sync/index');
  const sync = h.page('sync');
  await sync.onConsentAndStart();
  today.refresh();
  assert.equal(today.data.dataReady, true);
  assert.equal(h.store.read().habits[0].id, 'read');
  assert.equal(h.legacy.rawBackup(), legacyRaw);
});

test('首页短句开关表示显示状态，关闭时才写入隐藏设置', () => {
  const h = harness();
  seed(h);
  const mine = h.page('mine');
  mine.onQuote(event({}, true));
  assert.equal(h.store.read().settings.hideQuote, false);
  mine.onQuote(event({}, false));
  assert.equal(h.store.read().settings.hideQuote, true);
});

test('真实页面控制器：模板创建不会自动打卡；今日勾选、撤销联动进度', () => {
  const app = harness(), today = app.page('today');
  assert.equal(today.data.hasHabits, false);
  seed(app); today.refresh(); assert.equal(today.data.pending.length, 1); assert.equal(today.data.done, 0);
  const task = today.data.pending[0];
  today.onComplete(event({ id: task.id, date: task.date, done: false }));
  assert.equal(today.data.completed.length, 1);
  assert.equal(app.toasts.at(-1).title, '第一步已记下');
  const progress = app.page('progress'); assert.equal(progress.data.stats.done, 1);
  today.onComplete(event({ id: task.id, date: task.date, done: true }));
  progress.refresh(); assert.equal(progress.data.stats.done, 0);
});
test('真实页面控制器：简化确认只是改目标，完成后单独统计', () => {
  const app = harness(); seed(app); const today = app.page('today'), task = today.data.pending[0];
  today.onSimplify(event({ id: task.id, date: task.date }));
  app.modals.pop().success({ confirm: true, content: '2' });
  assert.equal(today.data.pending[0].target, 2); assert.equal(today.data.done, 0);
  today.onComplete(event({ id: task.id, date: task.date, done: false }));
  assert.equal(today.data.minimum, 1);
  assert.equal(app.page('progress').data.stats.minimum, 1);
});
test('首次行动反馈只在没有既有完成记录时出现', () => {
  const app = harness(), firstId = seed(app), today = app.page('today'), day = ui.date.today();
  today.onComplete(event({ id: firstId, date: day, done: false }));
  assert.equal(app.toasts.at(-1).title, '第一步已记下');
  app.store.dispatch({ type: 'create', id: 'later', startDate: day,
    plan: { title: '再做一件', target: 1, minimum: null, unit: '次', time: '', weekdays: [1, 2, 3, 4, 5, 6, 7] } });
  today.refresh(); today.onComplete(event({ id: 'later', date: day, done: false }));
  assert.equal(app.toasts.at(-1).title, '已记录');
});
test('真实页面控制器：跨日后旧按钮报错，不写到新日期', () => {
  const app = harness(); seed(app); const today = app.page('today');
  const task = today.data.pending[0], before = app.storage[STORAGE_KEY];
  today.onComplete(event({ id: task.id, date: ui.date.shift(task.date, -1), done: false }));
  assert.match(today.data.error, /日期/); assert.equal(app.storage[STORAGE_KEY], before);
});
test('真实页面控制器：创建验证失败留在当前页', () => {
  const app = harness(), edit = app.page('edit');
  edit.onSave(); assert.match(edit.data.error, /名称/); assert.equal(app.navigation.length, 0);
  edit.onInput(event({ field: 'title' }, '读书'));
  edit.setData({ weekdays: [] }); edit.onSave(); assert.match(edit.data.error, /星期/);
  assert.equal(app.store.read().habits.length, 0);
});
test('真实页面控制器：已有计划编辑更新同一个ID，使用原生返回栈', () => {
  const app = harness(), id = seed(app), edit = app.page('edit', { id });
  edit.onInput(event({ field: 'target' }, '8')); edit.onSave();
  assert.equal(app.store.read().habits.length, 1);
  assert.equal(app.store.read().habits[0].versions[1].target, 8);
  assert.deepEqual(app.navigation[app.navigation.length - 1], ['back']);
});
test('真实页面控制器：统计切换后区间、日期格和选中详情一致', () => {
  const app = harness(); seed(app); const progress = app.page('progress');
  assert.equal(progress.data.stats.cells.length, 7);
  progress.onPeriod(event({ days: 28 }));
  assert.equal(progress.data.stats.cells.length, 28);
  const first = progress.data.stats.cells[0]; progress.onDate(event({ date: first.date }));
  assert.equal(progress.data.selected.date, first.date);
  progress.onPeriod(event({ days: 7 }));
  assert.ok(progress.data.selected.date >= progress.data.stats.start);
});
test('真实页面控制器：暂停要确认且保留今日安排，可撤销待生效版本', () => {
  const app = harness(), id = seed(app), detail = app.page('detail', { id });
  detail.onStatus(event({ status: 'paused' }));
  app.modals.pop().success({ confirm: false }); assert.equal(app.store.read().habits[0].revision, 1);
  detail.onStatus(event({ status: 'paused' })); app.modals.pop().success({ confirm: true });
  assert.ok(detail.data.task); assert.equal(detail.data.future.status, 'paused');
  detail.onCancelFuture(); assert.equal(detail.data.future, null);
});
test('真实页面控制器：导出不默认带备注，文件发送和分享成功不混淆', () => {
  const app = harness(), id = seed(app); app.store.dispatch({ type: 'note', id, date: ui.date.today(), note: '私人内容' });
  const mine = app.page('mine'); mine.onExport(); app.modals.pop().success({ cancel: true, confirm: false });
  assert.equal(app.exports.length, 2); assert.doesNotMatch(app.exports[0].data, /私人内容/);
  assert.equal(app.exports[1].fileName, `渐成习惯打卡记录-${ui.date.today()}.csv`);
  app.exports[1].fail(); assert.match(mine.data.error, /发送未完成/);
  mine.onResend(); assert.equal(app.exports[2].fileName, app.exports[1].fileName);
});
test('真实页面控制器：两次确认后仅删本工程存储', async () => {
  const app = harness(); seed(app); app.storage.otherProject = 'keep'; const mine = app.page('mine');
  mine.onDelete(); app.modals.pop().success({ confirm: true }); app.modals.pop().success({ confirm: false });
  assert.equal(app.store.read().habits.length, 1);
  mine.onDelete(); app.modals.pop().success({ confirm: true }); await app.modals.pop().success({ confirm: true });
  assert.equal(app.store.read().habits.length, 0); assert.equal(app.storage.otherProject, 'keep');
});
test('清除本机数据后才完成的旧导出不会在用户目录留下文件', async () => {
  const app = harness(), id = seed(app), mine = app.page('mine');
  const files = new Set(), pendingWrites = [];
  app.wx.getFileSystemManager = () => ({
    writeFile: value => pendingWrites.push({
      filePath: value.filePath,
      complete() { files.add(value.filePath); value.success(); }
    }),
    unlinkSync: filePath => {
      if (files.delete(filePath)) return;
      const error = Error('ENOENT: no such file'); error.code = 'ENOENT'; throw error;
    },
    renameSync: (oldPath, newPath) => {
      if (!files.delete(oldPath)) { const error = Error('ENOENT: no such file'); error.code = 'ENOENT'; throw error; }
      files.delete(newPath); files.add(newPath);
    }
  });
  mine.writeExport(() => ui.store().rawBackup(), 'json'); assert.equal(pendingWrites.length, 1);
  mine.onDelete(); app.modals.pop().success({ confirm: true }); await app.modals.pop().success({ confirm: true });
  assert.equal(app.store.read().habits.length, 0);
  pendingWrites[0].complete();
  assert.equal(files.has(pendingWrites[0].filePath), false);
  assert.equal(app.exports.length, 0); assert.equal(mine.data.exportPath, '');
});
test('清除后重新导出时，旧写入完成不会删除新的导出文件', async () => {
  const app = harness(), id = seed(app), mine = app.page('mine');
  const files = new Set(), pendingWrites = [];
  app.wx.getFileSystemManager = () => ({
    writeFile: value => pendingWrites.push({
      filePath: value.filePath,
      complete() { files.add(value.filePath); value.success(); }
    }),
    unlinkSync: filePath => {
      if (files.delete(filePath)) return;
      const error = Error('ENOENT: no such file'); error.code = 'ENOENT'; throw error;
    },
    renameSync: (oldPath, newPath) => {
      if (!files.delete(oldPath)) { const error = Error('ENOENT: no such file'); error.code = 'ENOENT'; throw error; }
      files.delete(newPath); files.add(newPath);
    }
  });
  mine.writeExport(() => ui.store().rawBackup(), 'json');
  mine.onDelete(); app.modals.pop().success({ confirm: true }); await app.modals.pop().success({ confirm: true });
  mine.writeExport(() => ui.store().rawBackup(), 'json'); assert.equal(pendingWrites.length, 2);
  assert.notEqual(pendingWrites[0].filePath, pendingWrites[1].filePath);
  pendingWrites[1].complete(); pendingWrites[0].complete();
  assert.deepEqual([...files], [mine.data.exportPath]);
  assert.match(mine.data.exportPath, /yidian-export\.json$/);
});
test('真实页面控制器：存储失败不会提示保存成功', () => {
  const app = harness(); seed(app); const today = app.page('today'); const task = today.data.pending[0];
  const toastCount = app.toasts.length;
  app.wx.setStorageSync = () => { throw Error('quota'); };
  today.onComplete(event({ id: task.id, date: task.date, done: false }));
  assert.match(today.data.error, /保存失败/); assert.equal(app.toasts.length, toastCount); assert.equal(today.data.done, 0);
});

test('品牌与实际AppID配置一致，旧存储可读且测试云默认启用', () => {
  const { APP_NAME } = require('../miniprogram/config/brand');
  assert.equal(APP_NAME, '渐成习惯打卡');
  assert.equal(require('../miniprogram/app.json').window.navigationBarTitleText, APP_NAME);
  assert.equal(require('../miniprogram/pages/today/index.json').navigationBarTitleText, APP_NAME);
  assert.equal(require('../project.config.json').projectname, APP_NAME);
  assert.equal(require('../project.config.json').appid, 'wx58e61dffcbfa4249');
  assert.deepEqual(require('../miniprogram/config/cloud'), { enabled: true, envId: 'cloud1-d4gq76oyt363f08a7', functionName: 'habitApi' });
  assert.equal(STORAGE_KEY, 'yidian.native.v1');
  assert.equal(require('../miniprogram/services/sync-engine').PREFIX, 'yidian.sync.v1:');
  assert.equal(require('../server/cloudbase-repository').COLLECTION, 'jiancheng_daka_accounts');
  const h = harness(); seed(h);
  const raw = h.storage[STORAGE_KEY];
  assert.equal(createStore(h.wx).read().habits.length, 1);
  assert.equal(h.storage[STORAGE_KEY], raw);
});

test('三个底部导航均提供成对的81像素透明PNG图标', () => {
  const app = require('../miniprogram/app.json');
  const miniRoot = path.resolve(__dirname, '../miniprogram');
  assert.equal(app.tabBar.list.length, 3);
  for (const tab of app.tabBar.list) {
    for (const field of ['iconPath', 'selectedIconPath']) {
      assert.equal(typeof tab[field], 'string', `${tab.text}缺少${field}`);
      const file = path.resolve(miniRoot, tab[field]);
      assert.ok(file.startsWith(miniRoot + path.sep), `${field}必须位于小程序目录内`);
      const png = fs.readFileSync(file);
      assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${tab[field]}不是PNG`);
      assert.equal(png.readUInt32BE(16), 81, `${tab[field]}宽度应为81像素`);
      assert.equal(png.readUInt32BE(20), 81, `${tab[field]}高度应为81像素`);
      assert.equal(png[25], 6, `${tab[field]}必须使用带Alpha通道的RGBA格式`);
      assert.ok(png.length <= 40 * 1024, `${tab[field]}超过40 KiB`);
    }
  }
});

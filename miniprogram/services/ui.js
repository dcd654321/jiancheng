const date = require('../core/date');
const domain = require('../core/habits');
const cloudConfig = require('../config/cloud');
const { apiFunction } = require('../config/cloud-resources');
const { themeSnapshot, appearanceController } = require('./appearance');
const quickMinimumEnabled = cloudConfig.enabled === true && cloudConfig.functionName === apiFunction && cloudConfig.completeMinimumEnabled === true;

function store() { return getApp().store; }
function contextKey() { return store().contextKey ? store().contextKey() : 'cloud'; }
// 异步交互属于发起时的可见访问；隐藏后重入也不能接收旧页面副作用。
function isCurrentView(page, context, showVersion) {
  return !page._gone && page._visible !== false && page._showVersion === showVersion && contextKey() === context;
}
function assertContext(page) {
  if (page._context && page._context !== contextKey()) throw Error('数据状态已变化，请返回后重新打开此页面');
}
function storageInfo() { return store().info ? store().info() : { source: 'cloud', ready: false, phase: 'offline', syncText: '云端不可用' }; }
function error(page, err) {
  page.setData({ error: err.message || '操作失败，请重试' });
}
// 读取分三态：就绪、首次读取中、不可用。会话里已有本账户已确认数据时
// （刷新失败但内存快照仍可信）保留可读内容并标为只读，不再清空页面。
function read(page, callback) {
  const unavailable = err => {
    const pending = storageInfo().pending > 0;
    page.setData({ loading: false, dataUnavailable: true, dataReady: false, dataReadOnly: false,
      pendingConfirm: pending, recoveryLabel: pending ? '重新核对' : '重新读取',
      error: pending ? '正在核对这次记录：' + (err.message || '结果未确认') : (err.message || '暂时无法读取记录') });
  };
  try {
    const state = store().read();
    page._context = contextKey();
    callback(state, date.today());
    const info = storageInfo();
    page.setData({ loading: false, dataUnavailable: false, dataReady: true, dataReadOnly: false, pendingConfirm: false,
      dataSource: info.source, syncText: info.syncText, syncAttention: !!info.syncAttention,
      error: page._syncRefreshing && page.data.dataReady ? page.data.error : '' });
  } catch (err) {
    if (err.code === 'DATA_LOADING') page.setData({ loading: true,
      dataUnavailable: false, dataReady: false, error: '' });
    else if (err.code === 'DATA_UNAVAILABLE') {
      const info = storageInfo();
      const stale = store().stale ? store().stale() : null;
      if (stale) {
        try {
          page._context = contextKey();
          callback(stale, date.today());
          page.setData({ loading: false, dataUnavailable: false, dataReady: true, dataReadOnly: true, pendingConfirm: false,
            dataSource: info.source, syncText: info.syncText, syncAttention: true,
            error: '暂时无法更新，请连接网络后重试' });
        } catch (projectionError) { unavailable(projectionError); }
      } else unavailable(err);
    }
    else unavailable(err);
  }
}
function taskStatusLabel(task) { return task.status === 'minimum' ? '忙时完成' : task.statusText; }
// 写操作前置：云会话明确给出不可写状态时先给出原因，而不是让按钮看起来可用。
// 没有云信息接口的旧测试夹具不做此判断，写结果仍由 dispatch 与其自身校验负责。
function assertWritable() {
  const s = store();
  if (!s || typeof s.info !== 'function') return;
  const info = s.info();
  if (info && info.ready === false) throw Error('暂时无法更新，请连接网络后重试');
}
function mutate(page, command, message, options = {}) {
  if (page._mutating) return false;
  const mutationContext = contextKey();
  const showVersion = page._showVersion;
  const mutationDate = date.today();
  const previousOrder = (page.data.pending || []).map(task => task.id);
  const clearRecording = () => { if (!page._gone && typeof page.setData === 'function') page.setData({ recordingId: '', recordingType: '', recordingLabel: '', writeBusy: false, writeStatus: '' }); };
  const finish = () => {
    page._mutating = false;
    clearRecording();
    if (!isCurrentView(page, mutationContext, showVersion)) return true;
    if (mutationDate !== date.today()) { page.refresh(); return true; }
    if (page.onRecorded) page.onRecorded(command, previousOrder);
    page.refresh();
    const completion = ['complete', 'completeMinimum'].includes(command.type);
    // 完成确认用带成功图标的小弹窗“已完成”；首次/回归加短后缀；撤销与调整沿用文字提示。
    const toast = command.type === 'undo' ? { title: '已撤销这次记录', icon: 'none' }
      : options.firstCompletion && completion ? { title: '已完成 · 第一次', icon: 'success' }
      : options.returnCompletion && completion ? { title: '已完成 · 接上了', icon: 'success' }
      : completion ? { title: '已完成', icon: 'success' }
      : message ? { title: message, icon: 'none' } : null;
    if (toast) wx.showToast(toast);
    return true;
  };
  const failed = err => {
    page._mutating = false; clearRecording();
    if (isCurrentView(page, mutationContext, showVersion)) {
      if (mutationDate !== date.today()) page.refresh();
      else error(page, err);
    }
    return false;
  };
  try {
    assertContext(page); assertWritable(); page._mutating = true;
    // 进行中的按钮显示“正在记录…”，串行锁禁重复写，页面其余内容仍可阅读。
    const recordingLabel = command.type === 'undo' ? '正在撤销…'
      : command.type === 'restore' ? '正在恢复…'
      : ['complete', 'completeMinimum'].includes(command.type) ? '正在记录…' : '正在保存…';
    if (typeof page.setData === 'function') page.setData({ recordingId: command.id, recordingType: command.type, recordingLabel, writeBusy: true,
      error: '', writeStatus: command.type === 'undo' ? '正在确认撤销，请稍候。' : '正在确认这次操作，请稍候。' });
    const result = store().dispatch(command);
    return result && typeof result.then === 'function' ? result.then(finish).catch(failed) : finish();
  } catch (err) { return failed(err); }
}
function primaryColor() { return themeSnapshot().primary; }
function id() { return 'h_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10); }

// 各私有页共用的读取恢复：单次请求、进行中防连点、成功原地恢复、失败保留重试入口。
const recoveryActions = {
  async onDataRetry() {
    if (this._retrying || this._gone) return;
    const context = contextKey();
    const showVersion = this._showVersion;
    const session = getApp().cloudSession;
    this._retrying = true;
    this.setData({ loading: true, dataUnavailable: false, error: '' });
    try {
      if (session && typeof session.start === 'function') await session.start();
      if (isCurrentView(this, context, showVersion)) this.refresh();
    } catch (err) {
      if (isCurrentView(this, context, showVersion)) {
        error(this, err);
        this.setData({ loading: false, dataUnavailable: true, dataReady: false });
      }
    } finally { this._retrying = false; }
  }
};

function withLifecycle(definition, { watchDate = true } = {}) {
  const onShow = definition.onShow;
  const onHide = definition.onHide;
  const onUnload = definition.onUnload;
  return Object.assign({}, recoveryActions, definition, {
    data: { writeBusy: false, recordingId: '', recordingType: '', recordingLabel: '', writeStatus: '', ...definition.data },
    onShow() {
      this._gone = false;
      this._visible = true;
      const showVersion = this._showVersion = (this._showVersion || 0) + 1;
      this._day = date.today();
      this.bindTheme();
      if (this.refresh) this.refresh();
      if (onShow) onShow.call(this);
      if (this._unsubscribeSync) this._unsubscribeSync();
      const session = getApp().cloudSession;
      if (session && typeof session.subscribe === 'function') {
        this._unsubscribeSync = session.subscribe(() => {
          if (this._gone || !this._visible || this._showVersion !== showVersion) return;
          this._syncRefreshing = true;
          try { if (this.refresh) this.refresh(); }
          catch (err) { error(this, err); }
          finally { this._syncRefreshing = false; }
        });
      }
      clearInterval(this._dayTimer);
      if (watchDate) this._dayTimer = setInterval(() => {
        if (this._day !== date.today()) {
          this._day = date.today();
          if (this.refresh) this.refresh();
        }
      }, 10000);
      // Page onShow can precede the cloud response. Render both success and
      // failure after bootstrap/foreground work, without touching an old view.
      const ready = getApp().dataReady;
      if (ready && typeof ready.then === 'function') {
        const refreshReady = () => {
          if (this._gone || !this._visible || this._showVersion !== showVersion) return;
          try { if (this.refresh) this.refresh(); }
          catch (err) { error(this, err); }
        };
        return Promise.resolve(ready).then(refreshReady, refreshReady);
      }
    },
    // 主题只更新根节点作用域和状态文案，不触发数据刷新；账户变化由控制器清空旧值。
    bindTheme() {
      const controller = appearanceController();
      const update = () => {
        if (typeof this.onThemeChange === 'function') this.onThemeChange();
        else this.setData(themeSnapshot());
      };
      if (controller && !this._unsubscribeTheme) {
        this._unsubscribeTheme = controller.subscribe(() => {
          if (this._gone || !this._visible) return;
          update();
        });
      }
      update();
    },
    onHide() {
      this._visible = false; clearInterval(this._dayTimer);
      if (this._unsubscribeSync) this._unsubscribeSync();
      this._unsubscribeSync = null;
      if (this._unsubscribeTheme) this._unsubscribeTheme();
      this._unsubscribeTheme = null;
      if (onHide) onHide.call(this);
    },
    onUnload() {
      this._gone = true; this._visible = false; clearInterval(this._dayTimer);
      if (this._unsubscribeSync) this._unsubscribeSync();
      this._unsubscribeSync = null;
      if (this._unsubscribeTheme) this._unsubscribeTheme();
      this._unsubscribeTheme = null;
      if (onUnload) onUnload.call(this);
    }
  });
}

const taskActions = {
  onOpen(event) { wx.navigateTo({ url: '/pages/detail/index?id=' + event.currentTarget.dataset.id }); },
  onComplete(event) {
    const { id, date: taskDate, done } = event.currentTarget.dataset;
    return this.recordCompletion(id, taskDate, done ? 'undo' : 'complete');
  },
  onCompleteMinimum(event) {
    const { id, date: taskDate } = event.currentTarget.dataset;
    return this.recordCompletion(id, taskDate, 'completeMinimum');
  },
  recordCompletion(id, taskDate, type) {
    if (this._mutating) return false;
    let firstCompletion = false;
    if (type !== 'undo') {
      try {
        assertWritable();
        firstCompletion = !Object.values(store().read().records).some(record => record.status !== 'pending');
      }
      catch (err) { error(this, err); return false; }
    }
    const guide = this.data.returnGuide;
    const returnCompletion = type !== 'undo' && guide && guide.id === id && guide.date === taskDate;
    return mutate(this, { type, id, date: taskDate }, '', { firstCompletion, returnCompletion });
  },
  onSimplify(event) {
    if (this._mutating) return false;
    const { id, date: taskDate } = event.currentTarget.dataset;
    try {
      const state = store().read();
      const task = domain.taskAt(state, domain.findHabit(state, id), taskDate);
      if (!task || task.done) throw Error('请先撤销今天的记录，再调整目标');
      if (task.originalTarget <= 1) throw Error('这个目标已经是最小的了，改小请编辑计划');
      if (taskDate !== date.today()) throw Error('日期已变化，请刷新');
      const context = contextKey(), showVersion = this._showVersion;
      wx.showModal({
        title: '只调整今天目标（不记录）',
        content: task.minimum ? String(task.minimum) : '', editable: true,
        placeholderText: `原目标${task.originalTarget}${task.unit}，输入更小的整数`,
        confirmText: '只改今天', confirmColor: primaryColor(),
        success: result => { if (result.confirm && isCurrentView(this, context, showVersion)) mutate(this, { type: 'simplify', id, date: taskDate, target: result.content }, '今天目标已调小'); }
      });
    } catch (err) { error(this, err); }
  },
  onRestore(event) {
    const { id, date: taskDate } = event.currentTarget.dataset;
    mutate(this, { type: 'restore', id, date: taskDate }, '已恢复原目标');
  }
};

module.exports = { date, domain, store, read, mutate, error, id, contextKey, isCurrentView, assertContext, assertWritable, storageInfo, primaryColor, taskStatusLabel, quickMinimumEnabled, withLifecycle, taskActions, recoveryActions };

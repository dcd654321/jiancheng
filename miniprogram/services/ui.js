const date = require('../core/date');
const domain = require('../core/habits');

function store() { return getApp().store; }
function contextKey() { return store().contextKey ? store().contextKey() : 'cloud'; }
function assertContext(page) {
  if (page._context && page._context !== contextKey()) throw Error('数据状态已变化，请返回后重新打开此页面');
}
function storageInfo() { return store().info ? store().info() : { source: 'local', sourceName: '本机', ready: true, phase: 'ready', syncText: '' }; }
function error(page, err) {
  page.setData({ error: err.message || '操作失败，请重试' });
}
function read(page, callback) {
  try {
    const state = store().read();
    page._context = contextKey();
    callback(state, date.today());
    const info = storageInfo();
    page.setData({ needsConsent: false, loading: false, dataUnavailable: false, dataReady: true,
      dataSource: info.source, syncText: info.syncText, syncAttention: !!info.syncAttention,
      error: page._syncRefreshing && page.data.dataReady ? page.data.error : '' });
  } catch (err) {
    if (err.code === 'NEEDS_CONSENT') page.setData({ needsConsent: true, loading: false,
      dataUnavailable: false, dataReady: false, error: '' });
    else if (err.code === 'DATA_LOADING') page.setData({ needsConsent: false, loading: true,
      dataUnavailable: false, dataReady: false, error: '' });
    else if (err.code === 'DATA_UNAVAILABLE') page.setData({ needsConsent: false, loading: false,
      dataUnavailable: true, dataReady: false, error: err.message || '暂时无法读取记录' });
    else error(page, err);
  }
}
function mutate(page, command, message) {
  if (page._mutating) return false;
  const finish = () => {
    page._mutating = false;
    if (page._gone) return true;
    page.refresh();
    const info = storageInfo();
    const notice = ['complete', 'undo', 'simplify', 'restore', 'note'].includes(command.type)
      ? (info.pending ? '已记录，待同步' : '已记录') : '已保存';
    if (notice) wx.showToast({ title: notice, icon: 'none' });
    return true;
  };
  const failed = err => { page._mutating = false; if (!page._gone) error(page, err); return false; };
  try {
    assertContext(page); page._mutating = true;
    const result = store().dispatch(command);
    return result && typeof result.then === 'function' ? result.then(finish).catch(failed) : finish();
  } catch (err) { return failed(err); }
}
function id() { return 'h_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10); }

function withLifecycle(definition, { watchDate = true } = {}) {
  const onShow = definition.onShow;
  const onHide = definition.onHide;
  const onUnload = definition.onUnload;
  return Object.assign({}, definition, {
    onShow() {
      this._gone = false;
      this._visible = true;
      const showVersion = this._showVersion = (this._showVersion || 0) + 1;
      this._day = date.today();
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
    onHide() {
      this._visible = false; clearInterval(this._dayTimer);
      if (this._unsubscribeSync) this._unsubscribeSync();
      this._unsubscribeSync = null;
      if (onHide) onHide.call(this);
    },
    onUnload() {
      this._gone = true; this._visible = false; clearInterval(this._dayTimer);
      if (this._unsubscribeSync) this._unsubscribeSync();
      this._unsubscribeSync = null;
      if (onUnload) onUnload.call(this);
    }
  });
}

const taskActions = {
  onOpen(event) { wx.navigateTo({ url: '/pages/detail/index?id=' + event.currentTarget.dataset.id }); },
  onComplete(event) {
    const { id, date: taskDate, done } = event.currentTarget.dataset;
    mutate(this, { type: done ? 'undo' : 'complete', id, date: taskDate }, done ? '已撤销' : '已保存到本机');
  },
  onSimplify(event) {
    const { id, date: taskDate } = event.currentTarget.dataset;
    try {
      const state = store().read();
      const task = domain.taskAt(state, domain.findHabit(state, id), taskDate);
      if (!task || task.done) throw Error('请先撤销今天的记录，再调整目标');
      if (taskDate !== date.today()) throw Error('日期已变化，请刷新');
      wx.showModal({
        title: '今天少做一点',
        content: task.minimum ? String(task.minimum) : '', editable: true,
        placeholderText: `原目标${task.originalTarget}${task.unit}，输入更小的整数`,
        confirmText: '只改今天', confirmColor: '#245c44',
        success: result => { if (result.confirm) mutate(this, { type: 'simplify', id, date: taskDate, target: result.content }, '今天目标已简化'); }
      });
    } catch (err) { error(this, err); }
  },
  onRestore(event) {
    const { id, date: taskDate } = event.currentTarget.dataset;
    mutate(this, { type: 'restore', id, date: taskDate }, '已恢复原目标');
  }
};

module.exports = { date, domain, store, read, mutate, error, id, contextKey, assertContext, storageInfo, withLifecycle, taskActions };

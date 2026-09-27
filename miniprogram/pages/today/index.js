const ui = require('../../services/ui');
const { QUOTES } = require('../../services/quotes');
const { firstReturnTask } = require('../../services/gentle-return');
const flow = require('../../services/today-flow');

Page(ui.withLifecycle({
  data: { error: '', needsConsent: false, loading: true, dataUnavailable: false, dataReady: false,
    date: '', dateLabel: '', pending: [], completed: [], total: 0, done: 0, minimum: 0, rate: 0,
    hasHabits: false, hideQuote: false, quote: QUOTES[0], showCompleted: false,
    quickMinimumEnabled: ui.quickMinimumEnabled,
    firstHabitGuide: '', returnGuide: null, pendingRows: [], tomorrow: null, canCreateToday: true, canCreateTomorrow: true },
  refresh() {
    ui.read(this, (state, date) => {
      const tasks = ui.domain.tasksOn(state, date);
      const completed = tasks.filter(t => t.done);
      const pending = tasks.filter(t => !t.done);
      const app = getApp();
      const guide = app.firstHabitGuide;
      let firstHabitGuide = this.data.firstHabitGuide;
      if (guide && state.habits.some(habit => habit.id === guide.id)) {
        const task = pending.find(item => item.id === guide.id);
        if (task) {
          firstHabitGuide = `已创建「${guide.title}」。做完今天的目标，再点“打卡”记下第一次。`;
        } else if (guide.firstDate >= date) {
          firstHabitGuide = `已创建「${guide.title}」。首次安排：${ui.date.label(guide.firstDate)}；今天不用打卡。`;
        } else firstHabitGuide = `已创建「${guide.title}」。今天没有这项安排，可到“我的习惯”查看。`;
        this._firstGuideId = guide.id;
        app.firstHabitGuide = null;
      }
      if (this._firstGuideId && completed.some(item => item.id === this._firstGuideId)) firstHabitGuide = '';
      if (this._firstGuideId && firstHabitGuide) {
        const task = pending.find(item => item.id === this._firstGuideId);
        if (task) { pending.splice(pending.indexOf(task), 1); pending.unshift(task); }
      }
      const returnGuide = ui.storageInfo().syncAttention ? null : firstReturnTask(state, date, pending);
      const context = ui.contextKey();
      if (this._recentDone && (this._recentDone.context !== context || this._recentDone.date !== date ||
        this._recentDone.until <= Date.now() || !completed.some(t => t.id === this._recentDone.id))) this.clearRecent();
      const capacity = flow.creationAvailability(state, date);
      this.setData({ date, dateLabel: ui.date.label(date), pending, completed, firstHabitGuide, returnGuide,
        pendingRows: flow.pendingRows(pending, completed, this._recentDone, date, context, Date.now()),
        tomorrow: flow.tomorrowSummary(state, date), canCreateToday: capacity.today, canCreateTomorrow: capacity.tomorrow,
        total: tasks.length, done: completed.length, minimum: completed.filter(t => t.status === 'minimum').length,
        rate: tasks.length ? completed.length / tasks.length * 100 : 0,
        hasHabits: state.habits.length > 0, hideQuote: state.settings.hideQuote,
        quote: state.settings.hideQuote ? '' : (getApp().quoteSession ? getApp().quoteSession.current() : QUOTES[0]) });
    });
  },
  clearRecent() { clearTimeout(this._undoTimer); this._undoTimer = null; this._recentDone = null; },
  onRecorded(command, order) {
    if (command.type === 'undo') { this.clearRecent(); return; }
    if (!['complete', 'completeMinimum'].includes(command.type) || command.date !== ui.date.today()) return;
    this.clearRecent();
    this._recentDone = { id: command.id, date: command.date, context: ui.contextKey(), until: Date.now() + 6000, order };
    this._undoTimer = setTimeout(() => { this.clearRecent(); if (!this._gone && this._visible) this.refresh(); }, 6000);
  },
  onQuickUndo(event) {
    const recent = this._recentDone;
    if (!recent || recent.id !== event.currentTarget.dataset.id || recent.date !== ui.date.today() ||
      recent.context !== ui.contextKey() || recent.until <= Date.now() || !this._visible) {
      this.clearRecent(); if (!this._gone) this.refresh(); return false;
    }
    return this.recordCompletion(recent.id, recent.date, 'undo');
  },
  onHide() { this.clearRecent(); this.setData({ firstHabitGuide: '', returnGuide: null, pendingRows: [] }); this._firstGuideId = null; },
  onUnload() { this.clearRecent(); },
  onDismissGuide() { this.setData({ firstHabitGuide: '' }); this._firstGuideId = null; },
  onReturnOriginal(event) {
    const guide = this.data.returnGuide;
    if (!guide || guide.id !== event.currentTarget.dataset.id || this.data.date !== ui.date.today()) {
      this.refresh(); return;
    }
    if (guide.simplified) return ui.taskActions.onRestore.call(this, event);
    wx.navigateTo({ url: '/pages/detail/index?id=' + guide.id });
  },
  onReturnSmall(event) {
    const guide = this.data.returnGuide;
    if (!guide || guide.id !== event.currentTarget.dataset.id || guide.originalTarget <= 1 || this.data.date !== ui.date.today()) {
      this.refresh(); return;
    }
    return ui.taskActions.onSimplify.call(this, event);
  },
  onDataStart() { wx.navigateTo({ url: '/pages/sync/index' }); },
  async onDataRetry() {
    if (this._retrying) return;
    this._retrying = true;
    this.setData({ loading: true, dataUnavailable: false, error: '' });
    try {
      await getApp().cloudSession.start();
      if (!this._gone) this.refresh();
    } catch (err) {
      if (!this._gone) {
        ui.error(this, err);
        this.setData({ loading: false, dataUnavailable: true, dataReady: false });
      }
    } finally { this._retrying = false; }
  },
  onCreate(event) {
    try {
      ui.assertContext(this);
      const capacity = flow.creationAvailability(ui.store().read(), ui.date.today());
      if (!capacity.today && !capacity.tomorrow) {
        wx.showModal({ title: '先专注这 5 个习惯', content: '最多同时进行 5 个习惯。可以先暂停或归档一个，调整明天生效，历史记录会保留。',
          confirmText: '管理习惯', cancelText: '继续打卡', success: result => {
            if (result.confirm && !this._gone && this._visible) this.onManage();
          } });
        return;
      }
      const template = event.currentTarget.dataset.template;
      const params = [template ? 'template=' + encodeURIComponent(template) : '', !capacity.today ? 'start=tomorrow' : ''].filter(Boolean);
      wx.navigateTo({ url: '/pages/edit/index' + (params.length ? '?' + params.join('&') : '') });
    } catch (err) { ui.error(this, err); }
  },
  onManage() { wx.navigateTo({ url: '/pages/manage/index' }); },
  onToggleCompleted() { this.setData({ showCompleted: !this.data.showCompleted }); },
  onSync() { wx.navigateTo({ url: '/pages/sync/index' }); },
  onAssistant() { wx.navigateTo({ url: '/pages/assistant/index' }); },
  ...ui.taskActions
}));

const ui = require('../../services/ui');
const { TODAY_QUOTE } = require('../../services/quotes');
const { firstReturnTask } = require('../../services/gentle-return');
const flow = require('../../services/today-flow');
const { features } = require('../../services/features-client');
const { HABIT_TEMPLATES } = require('../../config/habit-templates');

function usesLargeFont() {
  try { return typeof wx.getSystemInfoSync === 'function' && Number(wx.getSystemInfoSync().fontSizeSetting) > 16; }
  catch (_) { return false; }
}

Page(ui.withLifecycle({
  data: { error: '', loading: true, dataUnavailable: false, dataReady: false, dataReadOnly: false,
    pendingConfirm: false, recoveryLabel: '重新读取',
    date: '', dateLabel: ui.date.label(ui.date.today()), pending: [], completed: [], total: 0, done: 0, minimum: 0, rate: 0,
    hasHabits: false, hideQuote: false, quote: TODAY_QUOTE, showCompleted: false, chooserOpen: false,
    quickMinimumEnabled: ui.quickMinimumEnabled,
    firstHabitGuide: '', returnGuide: null, tomorrow: null, canCreateToday: true, canCreateTomorrow: true,
    templates: HABIT_TEMPLATES, largeFont: false },
  refresh() {
    ui.read(this, (state, date) => {
      const feedbackContext = ui.contextKey() + ':' + date;
      if (this._firstGuideContext !== feedbackContext) {
        this._firstGuideId = null; this.setData({ firstHabitGuide: '' }); this._firstGuideContext = feedbackContext;
      }
      if (this._pinContext !== ui.contextKey()) this._visitPinnedId = null;
      this._pinContext = ui.contextKey();
      const cached = features().cachedPreferences();
      const pinnedId = this._visitPinnedId || (cached && cached.pinnedHabitId);
      const tasks = ui.domain.tasksOn(state, date).map(task => ({ ...task, pinned: task.id === pinnedId }));
      const pinned = tasks.findIndex(task => task.pinned);
      if (pinned > 0) tasks.unshift(tasks.splice(pinned, 1)[0]);
      const completed = tasks.filter(t => t.done);
      const pending = tasks.filter(t => !t.done);
      const app = getApp();
      const guide = app.firstHabitGuide;
      let firstHabitGuide = this.data.firstHabitGuide;
      if (guide && (!guide.context || guide.context === ui.contextKey()) && state.habits.some(habit => habit.id === guide.id)) {
        const task = pending.find(item => item.id === guide.id);
        if (task) {
          firstHabitGuide = `已创建「${guide.title}」。做完后，在这里打卡。`;
        } else if (guide.firstDate > date) {
          const when = guide.firstDate === ui.date.shift(date, 1) ? '明天' : ui.date.label(guide.firstDate);
          firstHabitGuide = `已创建「${guide.title}」。${when}会出现在这里。`;
        } else firstHabitGuide = `已创建「${guide.title}」。今天没有这项安排，可到“我的习惯”查看。`;
        this._firstGuideId = guide.id;
        app.firstHabitGuide = null;
      }
      if (guide && guide.context && guide.context !== ui.contextKey()) app.firstHabitGuide = null;
      if (this._firstGuideId && completed.some(item => item.id === this._firstGuideId)) firstHabitGuide = '';
      if (this._firstGuideId && firstHabitGuide) {
        const task = pending.find(item => item.id === this._firstGuideId);
        if (task) { pending.splice(pending.indexOf(task), 1); pending.unshift(task); }
      }
      // 今天已经留下任何记录后，回归提示不再出现；有同步异常时优先恢复，不叠加提示。
      const returnGuide = (ui.storageInfo().syncAttention || completed.length) ? null : firstReturnTask(state, date, pending);
      const capacity = flow.creationAvailability(state, date);
      this.setData({ date, dateLabel: ui.date.label(date), pending, completed, firstHabitGuide, returnGuide,
        tomorrow: flow.tomorrowSummary(state, date), canCreateToday: capacity.today, canCreateTomorrow: capacity.tomorrow,
        total: tasks.length, done: completed.length, minimum: completed.filter(t => t.status === 'minimum').length,
        rate: tasks.length ? completed.length / tasks.length * 100 : 0,
        hasHabits: state.habits.length > 0, hideQuote: state.settings.hideQuote,
        quote: state.settings.hideQuote ? '' : TODAY_QUOTE });
    });
  },
  async onShow() {
    this.setData({ largeFont: usesLargeFont(), dateLabel: ui.date.label(ui.date.today()) });
    const service = features();
    if (!service.status().enabled) return;
    const showVersion = this._showVersion;
    let key;
    try {
      await Promise.resolve(getApp().dataReady);
      if (this._gone || this._visible === false || this._showVersion !== showVersion) return;
      key = ui.contextKey();
      const preferences = await service.preferences();
      if (ui.isCurrentView(this, key, showVersion)) {
        this._visitPinnedId = preferences && preferences.pinnedHabitId; this.refresh();
      }
    } catch (_) { /* Keep the stable time/ID order when preferences are unavailable. */ }
  },
  onHide() {
    this._visitPinnedId = null;
    this.setData({ firstHabitGuide: '', returnGuide: null, chooserOpen: false, showCompleted: false });
    this._firstGuideId = null;
  },
  onDismissGuide() { this.setData({ firstHabitGuide: '' }); this._firstGuideId = null; },
  onToggleChooser() { this.setData({ chooserOpen: !this.data.chooserOpen }); },
  onCreate(event) {
    try {
      ui.assertContext(this);
      const capacity = flow.creationAvailability(ui.store().read(), ui.date.today());
      if (!capacity.today && !capacity.tomorrow) {
        const context = ui.contextKey(), showVersion = this._showVersion;
        wx.showModal({ title: '先专注这 5 个习惯', content: '最多同时进行 5 个习惯。可以先暂停或归档一个，调整明天生效，历史记录会保留。',
          confirmText: '管理习惯', cancelText: '继续打卡', success: result => {
            if (result.confirm && ui.isCurrentView(this, context, showVersion)) this.onManage();
          } });
        return;
      }
      const template = event.currentTarget.dataset.template;
      const params = [template ? 'template=' + encodeURIComponent(template) : '', !capacity.today ? 'start=tomorrow' : ''].filter(Boolean);
      this.setData({ chooserOpen: false });
      wx.navigateTo({ url: '/pages/edit/index' + (params.length ? '?' + params.join('&') : '') });
    } catch (err) { ui.error(this, err); }
  },
  onManage() { wx.navigateTo({ url: '/pages/manage/index' }); },
  onToggleCompleted() { this.setData({ showCompleted: !this.data.showCompleted }); },
  onSync() { wx.navigateTo({ url: '/pages/sync/index' }); },
  ...ui.taskActions
}));

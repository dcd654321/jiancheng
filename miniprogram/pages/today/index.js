const ui = require('../../services/ui');
const { QUOTES } = require('../../services/quotes');
const { firstReturnTask } = require('../../services/gentle-return');
const flow = require('../../services/today-flow');
const { features } = require('../../services/features-client');

// 冷启动等待时的问候与轻松说明：随包发布的静态文案，不读取账户数据、不写任何状态。
const LOADING_NOTES = ['正在把今天的安排取回来。', '一点一点来，今天就很好。', '忙的时候，做小一点也算数。', '记录保存在云端，换手机也在。'];
const FEEDBACK_DURATION = 5000;
function greeting(now = new Date()) {
  const hour = now.getHours();
  if (hour < 5) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 13) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}
function loadingNote(now = new Date()) {
  const day = Math.floor((now.getTime() - now.getTimezoneOffset() * 60000) / 86400000);
  return LOADING_NOTES[Math.abs(day) % LOADING_NOTES.length];
}

Page(ui.withLifecycle({
  onLoad() { this.setData({ loadingGreeting: greeting(), loadingNote: loadingNote() }); },
  data: { error: '', loading: true, dataUnavailable: false, dataReady: false, dataReadOnly: false,
    loadingGreeting: '今天好', loadingNote: LOADING_NOTES[0],
    pendingConfirm: false, recoveryLabel: '重新读取',
    date: '', dateLabel: '', pending: [], completed: [], total: 0, done: 0, minimum: 0, rate: 0,
    hasHabits: false, hideQuote: false, quote: QUOTES[0], showCompleted: false, chooserOpen: false, completionFeedback: null,
    quickMinimumEnabled: ui.quickMinimumEnabled,
    firstHabitGuide: '', returnGuide: null, tomorrow: null, canCreateToday: true, canCreateTomorrow: true },
  refresh() {
    ui.read(this, (state, date) => {
      const feedbackContext = ui.contextKey() + ':' + date;
      if (this._firstGuideContext !== feedbackContext) {
        this._firstGuideId = null; this.setData({ firstHabitGuide: '' }); this._firstGuideContext = feedbackContext;
      }
      if (this._feedbackContext !== feedbackContext) {
        this.clearCompletionFeedback(); this._feedbackContext = feedbackContext;
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
      const latest = completed.find(task => task.id === this._feedbackId);
      if (this._feedbackId && !latest) this.clearCompletionFeedback();
      const completionFeedback = latest ? { id: latest.id, date, title: latest.title,
        goal: '已按' + (latest.status === 'minimum' ? '忙时' : '原目标') + latest.target + latest.unit + '记下' } : null;
      const app = getApp();
      const guide = app.firstHabitGuide;
      let firstHabitGuide = this.data.firstHabitGuide;
      if (guide && (!guide.context || guide.context === ui.contextKey()) && state.habits.some(habit => habit.id === guide.id)) {
        const task = pending.find(item => item.id === guide.id);
        if (task) {
          firstHabitGuide = `已创建「${guide.title}」。做完后，在这里记下。`;
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
      this.setData({ date, dateLabel: ui.date.label(date), pending, completed, firstHabitGuide, returnGuide, completionFeedback,
        tomorrow: flow.tomorrowSummary(state, date), canCreateToday: capacity.today, canCreateTomorrow: capacity.tomorrow,
        total: tasks.length, done: completed.length, minimum: completed.filter(t => t.status === 'minimum').length,
        rate: tasks.length ? completed.length / tasks.length * 100 : 0,
        hasHabits: state.habits.length > 0, hideQuote: state.settings.hideQuote,
        quote: state.settings.hideQuote ? '' : (getApp().quoteSession ? getApp().quoteSession.current() : QUOTES[0]) });
    });
  },
  async onShow() {
    const service = features();
    if (!service.status().enabled) return;
    const key = ui.contextKey();
    const showVersion = this._showVersion;
    try {
      const preferences = await service.preferences();
      if (ui.isCurrentView(this, key, showVersion)) {
        this._visitPinnedId = preferences && preferences.pinnedHabitId; this.refresh();
      }
    } catch (_) { /* Keep the stable time/ID order when preferences are unavailable. */ }
  },
  clearCompletionFeedback() {
    clearTimeout(this._feedbackTimer); this._feedbackTimer = null;
    this._feedbackId = null;
    this._feedbackVersion = (this._feedbackVersion || 0) + 1;
    if (!this._gone) this.setData({ completionFeedback: null });
  },
  // 只保留最近一次确认项的短时反馈；长期撤销入口留在已完成分组。
  onRecorded(command) {
    if (command.type === 'undo' && command.id === this._feedbackId) this.clearCompletionFeedback();
    if (!['complete', 'completeMinimum'].includes(command.type) || command.date !== ui.date.today()) return;
    const context = ui.contextKey() + ':' + command.date;
    this.clearCompletionFeedback();
    this._feedbackContext = context;
    this._feedbackId = command.id;
    this.setData({ showCompleted: true });
    const version = this._feedbackVersion;
    this._feedbackTimer = setTimeout(() => {
      if (this._feedbackVersion === version) this.clearCompletionFeedback();
    }, FEEDBACK_DURATION);
  },
  onHide() {
    this._visitPinnedId = null; this.clearCompletionFeedback();
    this.setData({ firstHabitGuide: '', returnGuide: null, chooserOpen: false, showCompleted: false, completionFeedback: null });
    this._firstGuideId = null;
  },
  onUnload() { this.clearCompletionFeedback(); },
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
  onViewCompleted() {
    this.setData({ showCompleted: true }, () => {
      if (wx.pageScrollTo) wx.pageScrollTo({ selector: '#completed-section', duration: 200 });
    });
  },
  onSync() { wx.navigateTo({ url: '/pages/sync/index' }); },
  ...ui.taskActions
}));

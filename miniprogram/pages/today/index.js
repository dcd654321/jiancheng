const ui = require('../../services/ui');
const { QUOTES } = require('../../services/quotes');
const { firstReturnTask } = require('../../services/gentle-return');

Page(ui.withLifecycle({
  data: { error: '', needsConsent: false, loading: true, dataUnavailable: false, dataReady: false,
    date: '', dateLabel: '', pending: [], completed: [], total: 0, done: 0, minimum: 0, rate: 0,
    hasHabits: false, hideQuote: false, quote: QUOTES[0], showCompleted: false,
    firstHabitGuide: '', returnGuide: null },
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
      this.setData({ date, dateLabel: ui.date.label(date), pending, completed, firstHabitGuide, returnGuide,
        total: tasks.length, done: completed.length, minimum: completed.filter(t => t.status === 'minimum').length,
        rate: tasks.length ? completed.length / tasks.length * 100 : 0,
        hasHabits: state.habits.length > 0, hideQuote: state.settings.hideQuote,
        quote: state.settings.hideQuote ? '' : (getApp().quoteSession ? getApp().quoteSession.current() : QUOTES[0]) });
    });
  },
  onHide() { this.setData({ firstHabitGuide: '', returnGuide: null }); this._firstGuideId = null; },
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
  onCreate(event) { wx.navigateTo({ url: '/pages/edit/index' + (event.currentTarget.dataset.template ? '?template=' + event.currentTarget.dataset.template : '') }); },
  onManage() { wx.navigateTo({ url: '/pages/manage/index' }); },
  onToggleCompleted() { this.setData({ showCompleted: !this.data.showCompleted }); },
  onSync() { wx.navigateTo({ url: '/pages/sync/index' }); },
  onAssistant() { wx.navigateTo({ url: '/pages/assistant/index' }); },
  ...ui.taskActions
}));

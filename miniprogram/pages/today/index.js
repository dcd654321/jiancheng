const ui = require('../../services/ui');
const { QUOTES } = require('../../services/quotes');

Page(ui.withLifecycle({
  data: { error: '', needsConsent: false, loading: true, dataUnavailable: false, dataReady: false,
    date: '', dateLabel: '', pending: [], completed: [], total: 0, done: 0, minimum: 0, rate: 0,
    hasHabits: false, hideQuote: false, quote: QUOTES[0], showCompleted: false },
  refresh() {
    ui.read(this, (state, date) => {
      const tasks = ui.domain.tasksOn(state, date);
      const completed = tasks.filter(t => t.done);
      this.setData({ date, dateLabel: ui.date.label(date), pending: tasks.filter(t => !t.done), completed,
        total: tasks.length, done: completed.length, minimum: completed.filter(t => t.status === 'minimum').length,
        rate: tasks.length ? completed.length / tasks.length * 100 : 0,
        hasHabits: state.habits.length > 0, hideQuote: state.settings.hideQuote,
        quote: state.settings.hideQuote ? '' : (getApp().quoteSession ? getApp().quoteSession.current() : QUOTES[0]) });
    });
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

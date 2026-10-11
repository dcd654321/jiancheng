const ui = require('../../services/ui');
const review = require('../../core/progress-review');
const { advise } = require('../../core/progress-advice');

const TABS = ['week', 'month', 'calendar'];
function systemFontScale() {
  try {
    const size = Number(wx.getSystemInfoSync().fontSizeSetting);
    return Number.isFinite(size) && size > 0 ? Math.max(1, Math.min(size / 16, 2)) : 1;
  } catch (_) { return 1; }
}
function usable(page) {
  return page._visible !== false && !page._gone && page.data.dataReady &&
    page._projectionContext === ui.contextKey();
}

Page(ui.withLifecycle({
  data: { error: '', loading: true, dataUnavailable: false, dataReady: false,
    activeTab: 'week', days: 7, stats: null, calendar: null, selected: null,
    selectedDate: '', visibleMonth: '', todayDate: '', jumpDate: '', rangeLabel: '', startLabel: '',
    advice: '', hasHabits: false, fontScale: 1, weekdays: ['一', '二', '三', '四', '五', '六', '日'] },
  refresh() {
    const fontScale = systemFontScale();
    if (fontScale !== this.data.fontScale) this.setData({ fontScale });
    const context = ui.contextKey();
    if (this._projectionContext !== context) {
      this._projectionContext = context;
      this._selectionGeneration = (this._selectionGeneration || 0) + 1;
      this._pickerGuard = null;
      this.setData({ activeTab: 'week', days: 7, selectedDate: '', visibleMonth: '',
        todayDate: '', jumpDate: '', stats: null, calendar: null, selected: null,
        advice: '', rangeLabel: '', startLabel: '', hasHabits: false });
    }
    ui.read(this, (state, today) => {
      let selectedDate = this.data.selectedDate;
      let month = this.data.visibleMonth;
      if (!selectedDate || (this.data.todayDate && today !== this.data.todayDate && selectedDate === this.data.todayDate)) {
        selectedDate = today; month = review.monthOf(today);
      }
      const calendar = review.buildMonth(state, { month: month || review.monthOf(today), selectedDate, today });
      const stats = review.summarizeRange(state, { start: ui.date.shift(today, 1 - this.data.days), end: today, today });
      this.setData({ stats, calendar, selected: calendar.selected, selectedDate: calendar.selectedDate,
        visibleMonth: calendar.month, todayDate: today,
        jumpDate: calendar.selectedDate > today ? today : calendar.selectedDate,
        rangeLabel: ui.date.shortLabel(stats.start) + ' – ' + ui.date.shortLabel(stats.end),
        startLabel: ui.date.shortLabel(stats.start),
        advice: advise(stats.closed) || '', hasHabits: state.habits.length > 0 });
    });
    if (!this.data.dataReady) this.setData({ stats: null, calendar: null, selected: null, advice: '' });
  },
  onTab(event) {
    if (!usable(this)) return;
    const tab = event.currentTarget.dataset.tab;
    if (!TABS.includes(tab)) return;
    this._selectionGeneration = (this._selectionGeneration || 0) + 1;
    this._pickerGuard = null;
    this.setData({ activeTab: tab, days: tab === 'month' ? 30 : tab === 'week' ? 7 : this.data.days });
    this.refresh();
  },
  onPeriod(event) {
    const days = Number(event.currentTarget.dataset.days);
    if (days === 7 || days === 30) this.onTab({ currentTarget: { dataset: { tab: days === 7 ? 'week' : 'month' } } });
  },
  onDate(event) {
    if (!usable(this)) return;
    const date = event.currentTarget.dataset.date;
    try { ui.date.assertDate(date); } catch (_) { return; }
    const calendar = this.data.calendar;
    if (!calendar || date < calendar.minDate || date.slice(0, 7) > review.monthOf(this.data.todayDate)) return;
    this._selectionGeneration = (this._selectionGeneration || 0) + 1;
    this._pickerGuard = null;
    this.setData({ activeTab: 'calendar', selectedDate: date, visibleMonth: review.monthOf(date) });
    this.refresh();
  },
  onCalendar() {
    this.onTab({ currentTarget: { dataset: { tab: 'calendar' } } });
  },
  onMonth(event) {
    if (!usable(this) || this.data.activeTab !== 'calendar') return;
    const direction = Number(event.currentTarget.dataset.direction);
    if (![1, -1].includes(direction)) return;
    const calendar = this.data.calendar;
    if (!calendar || (direction < 0 && !calendar.canPrevious) || (direction > 0 && !calendar.canNext)) return;
    const date = review.shiftSelectedMonth(this.data.selectedDate, direction);
    this.onDate({ currentTarget: { dataset: { date: date < calendar.minDate ? calendar.minDate : date } } });
  },
  onPickerOpen() {
    if (!usable(this) || this.data.activeTab !== 'calendar') return;
    this._pickerGuard = { context: ui.contextKey(), showVersion: this._showVersion,
      generation: this._selectionGeneration, month: this.data.visibleMonth };
  },
  onPickerCancel() { this._pickerGuard = null; },
  onDateJump(event) {
    const guard = this._pickerGuard; this._pickerGuard = null;
    if (!guard || !usable(this) || this.data.activeTab !== 'calendar' ||
      !ui.isCurrentView(this, guard.context, guard.showVersion) ||
      guard.generation !== this._selectionGeneration || guard.month !== this.data.visibleMonth) return;
    const date = event.detail.value;
    try { ui.date.assertDate(date); } catch (_) { return; }
    if (date < this.data.calendar.minDate || date > this.data.todayDate) return;
    this.onDate({ currentTarget: { dataset: { date } } });
  },
  onCalendarToday() {
    if (!usable(this)) return;
    if (this.data.todayDate !== ui.date.today()) this.refresh();
    this.onDate({ currentTarget: { dataset: { date: ui.date.today() } } });
  },
  onHide() { this._pickerGuard = null; },
  onUnload() { this._pickerGuard = null; },
  onCreate() { if (usable(this)) wx.navigateTo({ url: '/pages/edit/index' }); },
  onToday() { if (usable(this)) wx.switchTab({ url: '/pages/today/index' }); },
  onOpen(event) { if (usable(this)) ui.taskActions.onOpen.call(this, event); }
}));

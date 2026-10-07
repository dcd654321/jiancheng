const ui = require('../../services/ui');
const { createNoteDrafts } = require('../../services/note-drafts');
const { features } = require('../../services/features-client');
const PIN_READ_ERROR = '暂时未读取到置顶设置，打卡不受影响';

function drafts() {
  const app = getApp();
  if (!app.noteDrafts) app.noteDrafts = createNoteDrafts();
  return app.noteDrafts;
}

Page(ui.withLifecycle({
  data: { error: '', loading: true, dataUnavailable: false, dataReady: false,
    invalid: false,
    title: '', schedule: '', current: null, future: null, task: null, history: [], note: '',
    noteDirty: false, noteExpired: false, noteDate: '', date: '', statusText: '',
    noteOpen: false, moreOpen: false, showHistory: false, visibleHistory: [], focusNote: false,
    quickMinimumEnabled: ui.quickMinimumEnabled, featuresEnabled: false, pinned: false, pinning: false, pinError: '' },
  onLoad(options) { this._id = options.id; this.refresh(); },
  async onShow() {
    const service = features();
    if (!service.status().enabled) return;
    const showVersion = this._showVersion;
    let key;
    try {
      await Promise.resolve(getApp().dataReady);
      if (this._gone || this._visible === false || this._showVersion !== showVersion) return;
      key = ui.contextKey();
      await service.preferences();
      if (ui.isCurrentView(this, key, showVersion)) {
        if (this.data.pinError === PIN_READ_ERROR) this.setData({ pinError: '' });
        this.refresh();
      }
    } catch (_) {
      if (ui.isCurrentView(this, key, showVersion) && (!this.data.pinError || this.data.pinError === PIN_READ_ERROR)) {
        this.setData({ pinError: PIN_READ_ERROR });
      }
    }
  },
  refresh() {
    if (!this._id) { this.setData({ loading: false, dataReady: false, dataUnavailable: false, invalid: true,
      error: '这个习惯链接不完整，没有可显示的记录。' }); return; }
    ui.read(this, (state, date) => {
      const context = ui.contextKey();
      const draft = drafts().read(context, this._id);
      if (this._draftContext && this._draftContext !== context) {
        // Do not leave another account/generation's text visible if this habit no longer exists.
        this.setData({ note: '', noteDirty: false, noteExpired: false, title: '', task: null, pinError: '',
          history: [], dataReady: false, dataUnavailable: true });
      }
      this._draftContext = context;
      // 无效ID不渲染空白卡或别人的记录，给原因和出口。
      const habit = state.habits.find(h => h.id === this._id);
      if (!habit) {
        this._revision = null;
        this.setData({ invalid: true, dataReady: true, title: '', current: null, future: null, task: null,
          history: [], visibleHistory: [], note: '', noteDirty: false });
        return;
      }
      this.setData({ invalid: false });
      this._revision = habit.revision;
      const current = ui.domain.versionAt(habit, date);
      const last = habit.versions[habit.versions.length - 1];
      const future = last.effectiveDate > date ? last : null;
      const display = current || last;
      const task = ui.domain.taskAt(state, habit, date);
      const preferences = features().cachedPreferences();
      const history = ui.date.range(date, 28).reverse().map(day => {
        const record = ui.domain.taskAt(state, habit, day);
        return record ? { date: day, status: ui.taskStatusLabel(record), goal: `${record.target} ${record.unit}` } : null;
      }).filter(Boolean);
      this.setData({ title: display.title, current, future, task, history, date,
        featuresEnabled: features().status().enabled, pinned: !!preferences && preferences.pinnedHabitId === this._id,
        visibleHistory: this.data.showHistory ? history : history.slice(0, 7),
        note: draft ? draft.text : task ? task.note : '', noteDirty: !!draft,
        noteDate: draft ? draft.date : date, noteExpired: !!draft && (draft.date !== date || !task),
        schedule: ui.domain.weekdayText(display.weekdays),
        statusText: current ? ({ active: '进行中', paused: '已暂停', archived: '已归档' })[current.status] : '尚未开始',
        nextStatusText: ({ active: '进行中', paused: '暂停', archived: '归档' })[last.status] });
    });
  },
  onEdit() { wx.navigateTo({ url: '/pages/edit/index?id=' + this._id }); },
  async onPin() {
    if (this._pinning || this._mutating) return;
    const key = ui.contextKey();
    const showVersion = this._showVersion;
    this._pinning = true; this.setData({ pinning: true, pinError: '' });
    try {
      ui.assertContext(this);
      await features().setPinned(this.data.pinned ? null : this._id);
      if (ui.isCurrentView(this, key, showVersion)) this.refresh();
    } catch (err) { if (ui.isCurrentView(this, key, showVersion)) this.setData({ pinError: err.message || '置顶未保存，请重试' }); }
    finally { this._pinning = false; if (!this._gone) this.setData({ pinning: false }); }
  },
  onToggleNote() { this.setData({ noteOpen: !this.data.noteOpen }); },
  onNoteFocus() { this.setData({ focusNote: true }); },
  onNoteBlur() { this.setData({ focusNote: false }); },
  onMore() { this.setData({ moreOpen: !this.data.moreOpen }); },
  onToggleHistory() { this.setData({ showHistory: !this.data.showHistory }); this.refresh(); },
  onNote(event) {
    const text = event.detail.value;
    const context = ui.contextKey();
    if (!this.data.noteExpired && this.data.task && text === this.data.task.note) drafts().remove(context, this._id);
    else drafts().set(context, this._id, this.data.noteDate || this.data.date, text);
    this.setData({ note: text, noteDirty: !!drafts().read(context, this._id) });
  },
  onSaveNote() {
    if (this.data.noteExpired || this.data.noteDate !== ui.date.today()) {
      ui.error(this, Error('日期已变化，旧草稿未提交。请复制保留后，点击“放弃草稿”填写今天的备注。'));
      return false;
    }
    const context = ui.contextKey(), showVersion = this._showVersion, draft = { date: this.data.noteDate, text: this.data.note };
    const finish = saved => {
      if (saved) {
        drafts().remove(context, this._id, draft);
        if (ui.isCurrentView(this, context, showVersion)) this.refresh();
      }
      return saved;
    };
    const saved = ui.mutate(this, { type: 'note', id: this._id, date: draft.date, note: draft.text }, '备注已保存');
    return saved && typeof saved.then === 'function' ? saved.then(finish) : finish(saved);
  },
  onDiscardNote() {
    const context = ui.contextKey(), draft = drafts().read(context, this._id);
    const showVersion = this._showVersion;
    wx.showModal({ title: '放弃未保存的备注？', content: '草稿将被清除，已保存的备注不会改变。', confirmText: '放弃草稿',
      success: result => {
        if (result.confirm && ui.isCurrentView(this, context, showVersion)) { drafts().remove(context, this._id, draft); this.refresh(); }
      } });
  },
  onStatus(event) {
    if (this._mutating) return false;
    const status = event.currentTarget.dataset.status;
    const verb = { active: '恢复', paused: '暂停', archived: '归档' }[status];
    const baseRevision = this._revision;
    const context = ui.contextKey(), showVersion = this._showVersion;
    wx.showModal({ title: `明日起${verb}？`, content: '今天的安排仍保留，历史记录不会改变。', confirmText: verb, confirmColor: ui.primaryColor(),
      success: result => { if (result.confirm && ui.isCurrentView(this, context, showVersion)) ui.mutate(this, { type: 'status', id: this._id, status, baseRevision }, '修改明日生效'); } });
  },
  onCancelFuture() { ui.mutate(this, { type: 'cancelFuture', id: this._id, baseRevision: this._revision }, '待生效修改已撤销'); },
  onToday() { wx.switchTab({ url: '/pages/today/index' }); },
  ...ui.taskActions
}));

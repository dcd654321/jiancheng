const ui = require('../../services/ui');
const { createNoteDrafts } = require('../../services/note-drafts');
const { features } = require('../../services/features-client');
const { themeSnapshot } = require('../../services/appearance');
const { THEMES } = require('../../config/theme-tokens');
const PIN_READ_ERROR = '暂时未读取到置顶设置，打卡不受影响';

function drafts() {
  const app = getApp();
  if (!app.noteDrafts) app.noteDrafts = createNoteDrafts();
  return app.noteDrafts;
}

Page(ui.withLifecycle({
  data: { error: '', loading: true, dataUnavailable: false, dataReady: false,
    invalid: false, largeFont: false,
    title: '', schedule: '', current: null, future: null, task: null, history: [], note: '',
    noteDirty: false, noteExpired: false, noteDate: '', date: '', statusText: '',
    noteOpen: false, moreOpen: false, showHistory: false, visibleHistory: [], focusNote: false, deleteConfirming: false, plannedStatus: '',
    quickMinimumEnabled: ui.quickMinimumEnabled, featuresEnabled: false, pinned: false, pinning: false, pinError: '' },
  onLoad(options) { this._id = options.id; this.refresh(); },
  async onShow() {
    let largeFont = false;
    try { largeFont = wx.getSystemInfoSync().fontSizeSetting > 16; } catch (_) {}
    this.setData({ largeFont });
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
        drafts().remove(context, this._id);
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
        plannedStatus: last.status,
        featuresEnabled: features().status().enabled, pinned: !!preferences && preferences.pinnedHabitId === this._id,
        visibleHistory: this.data.showHistory ? history : history.slice(0, 7),
        note: draft ? draft.text : task ? task.note : '', noteDirty: !!draft,
        noteDate: draft ? draft.date : date, noteExpired: !!draft && (draft.date !== date || !task),
        schedule: ui.domain.weekdayText(display.weekdays),
        statusText: ({ active: '进行中', paused: '已暂停', archived: '已归档' })[last.status] });
    });
    this.finishDelete();
    if (this._deleteNavigationFailed && this.data.invalid) this.setData({ error: '习惯已删除，请点击“返回我的习惯”。' });
  },
  onEdit() { wx.navigateTo({ url: '/pages/edit/index?id=' + this._id }); },
  onSharePlan() { wx.navigateTo({ url: '/pages/share-create/index?kind=plan&habitId=' + this._id }); },
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
  onCopyNote() {
    if (this._draftContext !== ui.contextKey()) return;
    const context = ui.contextKey(), showVersion = this._showVersion;
    wx.setClipboardData({ data: this.data.note || '', fail: () => { if (ui.isCurrentView(this, context, showVersion)) ui.error(this, Error('复制未完成，备注仍已保留，请重试')); } });
  },
  onMore() { this.setData({ moreOpen: !this.data.moreOpen }); },
  onDeleteHabit() {
    if (this._gone || this._visible === false || this._deleteConfirmation || this._mutating || this._pinning || this.data.invalid || !this.data.dataReady || this.data.dataReadOnly) return false;
    let context, showVersion, state, habit;
    try {
      ui.assertContext(this); ui.assertWritable();
      context = ui.contextKey(); showVersion = this._showVersion; state = ui.store().read();
      habit = ui.domain.findHabit(state, this._id);
    } catch (err) { ui.error(this, err); return false; }
    const confirmation = { id: this._id, baseRevision: habit.revision, stateRevision: state.revision,
      date: ui.date.today(), context, showVersion };
    this._deleteConfirmation = confirmation; this.setData({ deleteConfirming: true });
    const release = () => {
      if (this._deleteConfirmation !== confirmation) return;
      this._deleteConfirmation = null;
      if (!this._gone) this.setData({ deleteConfirming: false });
    };
    const display = this.data.title;
    try {
      wx.showModal({ title: '删除这个习惯？',
        content: `将删除「${display}」及其全部历史打卡、备注和待生效计划，无法恢复。其他习惯不受影响。`
          + (this.data.noteDirty ? '未保存的备注也会丢弃。' : '')
          + '已创建的分享仍可访问，请在分享管理中单独撤销。',
        cancelText: '取消', confirmText: '删除', confirmColor: THEMES[themeSnapshot().theme].error,
        success: result => {
          if (this._deleteConfirmation !== confirmation) return false;
          release();
          if (!result.confirm || !ui.isCurrentView(this, context, showVersion)) return false;
          try {
            ui.assertWritable();
            const current = ui.store().read();
            if (ui.date.today() !== confirmation.date || current.revision !== confirmation.stateRevision
              || ui.domain.findHabit(current, confirmation.id).revision !== confirmation.baseRevision) {
              throw Error('日期或记录已变化，请重新查看后确认删除');
            }
            const attempt = this._deleteAttempt = { ...confirmation, confirmed: false };
            const session = getApp().cloudSession;
            if (session && typeof session.subscribeConfirmed === 'function') {
              const origin = session.status();
              this._unsubscribeDelete = session.subscribeConfirmed(event => {
                const command = event.command;
                if (this._deleteAttempt !== attempt || event.accountId !== origin.accountId || event.epoch !== origin.epoch
                  || !command || command.type !== 'deleteHabit' || command.id !== attempt.id || command.baseRevision !== attempt.baseRevision) return;
                attempt.confirmed = true;
                if (ui.isCurrentView(this, context, showVersion)) this.refresh();
              });
            }
            const saved = ui.mutate(this, { type: 'deleteHabit', id: attempt.id, baseRevision: attempt.baseRevision });
            const finish = confirmed => {
              if (confirmed) drafts().remove(context, attempt.id);
              if (this._deleteAttempt !== attempt) return confirmed;
              if (confirmed) { attempt.confirmed = true; this.finishDelete(); }
              else if (!ui.storageInfo().pending) this.clearDeleteAttempt();
              return confirmed;
            };
            return saved && typeof saved.then === 'function' ? saved.then(finish) : finish(saved);
          } catch (err) { this.clearDeleteAttempt(); ui.error(this, err); return false; }
        },
        fail: () => { release(); if (ui.isCurrentView(this, context, showVersion)) ui.error(this, Error('确认窗口未打开，请重试')); },
        complete: release
      });
    } catch (err) { release(); ui.error(this, err); }
  },
  finishDelete() {
    const attempt = this._deleteAttempt;
    if (!attempt || !attempt.confirmed || !this.data.invalid || !this.data.dataReady || this.data.dataUnavailable
      || !ui.isCurrentView(this, attempt.context, attempt.showVersion)) return;
    this.clearDeleteAttempt();
    this.returnToHabits({
      success: () => { if (ui.contextKey() === attempt.context && this._showVersion === attempt.showVersion) wx.showToast({ title: '习惯已删除', icon: 'none' }); },
      fail: () => { if (ui.isCurrentView(this, attempt.context, attempt.showVersion)) { this._deleteNavigationFailed = true; this.setData({ error: '习惯已删除，请点击“返回我的习惯”。' }); } }
    });
  },
  returnToHabits(callbacks = {}) {
    const context = ui.contextKey(), showVersion = this._showVersion;
    if (!ui.isCurrentView(this, context, showVersion)) return;
    const fail = () => {
      if (!ui.isCurrentView(this, context, showVersion)) return;
      if (callbacks.fail) callbacks.fail();
      else ui.error(this, Error('返回未完成，请再点“返回我的习惯”重试。'));
    };
    const redirect = () => {
      if (!ui.isCurrentView(this, context, showVersion)) return;
      wx.redirectTo({ url: '/pages/manage/index', success: callbacks.success, fail });
    };
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    for (let i = pages.length - 2; i >= 0; i--) {
      if (pages[i].route === 'pages/manage/index') {
        wx.navigateBack({ delta: pages.length - 1 - i, success: callbacks.success, fail: redirect });
        return;
      }
    }
    redirect();
  },
  onManage() { this.returnToHabits(); },
  clearDeleteAttempt() {
    if (this._unsubscribeDelete) this._unsubscribeDelete();
    this._unsubscribeDelete = null; this._deleteAttempt = null;
  },
  onHide() { this.clearDeleteAttempt(); this._deleteConfirmation = null; this.setData({ deleteConfirming: false }); },
  onUnload() { this.clearDeleteAttempt(); this._deleteConfirmation = null; },
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
    if (this._mutating || this._gone || this._visible === false || this.data.invalid) return false;
    const status = event.currentTarget.dataset.status;
    const verb = status === 'active' && this.data.plannedStatus === 'archived' ? '取消归档' : { active: '恢复', paused: '暂停', archived: '归档' }[status];
    const baseRevision = this._revision;
    const context = ui.contextKey(), showVersion = this._showVersion, confirmationDate = ui.date.today();
    wx.showModal({ title: `明日起${verb}？`, content: '今天的安排仍保留，历史记录不会改变。', confirmText: verb, confirmColor: ui.primaryColor(),
      success: result => {
        if (!result.confirm || !ui.isCurrentView(this, context, showVersion)) return false;
        if (ui.date.today() !== confirmationDate) { ui.error(this, Error('日期已变化，请重新确认计划')); return false; }
        return ui.mutate(this, { type: 'status', id: this._id, status, baseRevision }, `${verb}明日生效`);
      } });
  },
  onResume() {
    return this.data.current && this.data.current.status === 'active' && this.data.future && this.data.future.status === 'paused'
      ? this.restorePlannedStatus('paused', '已恢复')
      : this.onStatus({ currentTarget: { dataset: { status: 'active' } } });
  },
  onUnarchive() {
    return this.data.current && this.data.current.status !== 'archived' && this.data.future && this.data.future.status === 'archived'
      ? this.restorePlannedStatus('archived', '已取消归档')
      : this.onStatus({ currentTarget: { dataset: { status: 'active' } } });
  },
  restorePlannedStatus(status, message) {
    if (this._mutating || this._gone || this._visible === false || this.data.invalid) return false;
    try {
      ui.assertContext(this); ui.assertWritable();
      const date = ui.date.today(), habit = ui.domain.findHabit(ui.store().read(), this._id);
      const current = ui.domain.versionAt(habit, date), future = habit.versions[habit.versions.length - 1];
      const verb = status === 'paused' ? '暂停' : '归档';
      if (!current || current.status === status || future.effectiveDate !== ui.date.shift(date, 1) || future.status !== status) throw Error(`${verb}计划已变化，请重新查看`);
      const samePlan = ['title', 'target', 'minimum', 'unit', 'weekdays', 'time'].every(key => JSON.stringify(current[key]) === JSON.stringify(future[key]));
      return ui.mutate(this, { type: samePlan ? 'cancelFuture' : 'status', id: this._id, baseRevision: habit.revision,
        ...(samePlan ? {} : { status: current.status }) }, message);
    } catch (err) { ui.error(this, err); return false; }
  },
  onToday() { wx.switchTab({ url: '/pages/today/index' }); }
}));

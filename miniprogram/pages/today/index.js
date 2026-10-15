const ui = require('../../services/ui');
const { TODAY_QUOTE } = require('../../services/quotes');
const { firstReturnTask } = require('../../services/gentle-return');
const flow = require('../../services/today-flow');
const { HABIT_TEMPLATES } = require('../../config/habit-templates');

const disabledFeatures = { status: () => ({ enabled: false, reminders: false }), cachedPreferences: () => null };
const disabledService = { status: () => ({ enabled: false }) };
function features() {
  if (getApp().featuresClient) return getApp().featuresClient;
  if (!require('../../config/features').enabled && !require('../../config/reminders').enabled) return disabledFeatures;
  return require('../../services/features-client').features();
}
function supervision() {
  if (getApp().supervisionClient) return getApp().supervisionClient;
  if (!require('../../config/supervision').enabled) return disabledService;
  return require('../../services/supervision-client').supervision();
}
function media() {
  if (getApp().mediaClient) return getApp().mediaClient;
  if (!require('../../config/media').enabled) return disabledService;
  return require('../../services/media-client').media();
}
function createPhotoCheckin(options) { return require('../../services/photo-checkin').createPhotoCheckin(options); }

function usesLargeFont() {
  try { return typeof wx.getSystemInfoSync === 'function' && Number(wx.getSystemInfoSync().fontSizeSetting) > 16; }
  catch (_) { return false; }
}

Page(ui.withLifecycle({
  data: { error: '', loading: true, dataUnavailable: false, dataReady: false, dataReadOnly: false,
    startupLoadingText: '', startupUnavailableTitle: '', readRefreshing: false,
    pendingConfirm: false, recoveryLabel: '重新读取',
    date: '', dateLabel: ui.date.label(ui.date.today()), pending: [], completed: [], total: 0, done: 0, minimum: 0, rate: 0,
    hasHabits: false, hideQuote: false, quote: TODAY_QUOTE, showCompleted: false, chooserOpen: false,
    quickMinimumEnabled: ui.quickMinimumEnabled,
    firstHabitGuide: '', returnGuide: null, tomorrow: null, canCreateToday: true, canCreateTomorrow: true,
    templates: HABIT_TEMPLATES, largeFont: false, supervisionEnabled: false, supervisionCount: 0, supervisionOverdue: 0, photoEnabled: false, remindersEnabled: false,
    photoOpen: false, photoTitle: '', photoRequired: false, photoBusy: false, photoError: '', photoItems: [], photoCanSubmit: false, photoPending: false },
  clearStartupFeedback() {
    if (this._startupFeedback) this._startupFeedback.timers.forEach(timer => clearTimeout(timer));
    this._startupFeedback = null;
  },
  onDataReadState({ phase, error, info } = {}) {
    if (phase !== 'loading') {
      this.clearStartupFeedback();
      if (this._gone || this._visible === false) return;
      const code = error && error.causeCode || info && info.lastErrorCode || error && error.code;
      const timedOut = ['CLOUD_READ_TIMEOUT', 'CLOUD_INIT_TIMEOUT'].includes(code);
      this.setData({ startupLoadingText: '', startupUnavailableTitle: phase === 'unavailable' && timedOut && !(info && info.pending)
        ? '暂时没能读取习惯' : '' });
      return;
    }
    if (this._gone || this._visible === false) { this.clearStartupFeedback(); return; }
    const lastAttemptAt = Number(info && info.lastAttemptAt);
    const startedAt = Number.isFinite(lastAttemptAt) && lastAttemptAt > 0 ? lastAttemptAt
      : this._startupFeedback ? this._startupFeedback.startedAt : Date.now();
    const showVersion = this._showVersion;
    if (this._startupFeedback && this._startupFeedback.startedAt === startedAt && this._startupFeedback.showVersion === showVersion) return;
    this.clearStartupFeedback();
    const feedback = this._startupFeedback = { startedAt, showVersion, timers: [] };
    const message = () => Date.now() - startedAt >= 3000 ? '连接有些慢，正在读取今日习惯'
      : Date.now() - startedAt >= 300 ? '正在读取今日习惯' : '';
    this.setData({ startupLoadingText: message(), startupUnavailableTitle: '' });
    for (const threshold of [300, 3000]) {
      const remaining = threshold - (Date.now() - startedAt);
      if (remaining <= 0) continue;
      feedback.timers.push(setTimeout(() => {
        if (this._startupFeedback !== feedback || this._gone || this._visible === false || this._showVersion !== showVersion || !this.data.loading || this.data.dataReady) return;
        this.setData({ startupLoadingText: message() });
      }, remaining));
    }
  },
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
      if (this._supervisionContext !== ui.contextKey() || this._supervisionDate !== date) { this._photoRequirements = {}; this.setData({ supervisionCount: 0, supervisionOverdue: 0 }); }
      if (this._photoStatusScope !== feedbackContext) { this._photoStatuses = {}; this._photoStatusScope = feedbackContext; this._mediaLoadedKey = null; }
      const tasks = ui.domain.tasksOn(state, date).map(task => ({ ...task, pinned: task.id === pinnedId,
        photoRequired: !!(this._photoRequirements && this._photoRequirements[task.id]), ...(this._photoStatuses && this._photoStatuses[task.id] || {}) }));
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
        quote: state.settings.hideQuote ? '' : TODAY_QUOTE,
        supervisionEnabled: supervision().status().enabled, photoEnabled: media().status().enabled, remindersEnabled: features().status().reminders });
      if (this._photoCheckin) this.setData(this._photoCheckin.view());
      if (this._supervisionDate !== date && this.data.supervisionEnabled) this.loadSupervisions();
      if (this.data.photoEnabled && this._mediaLoadedKey !== feedbackContext + ':' + state.revision) Promise.resolve().then(() => this.loadMediaStatuses());
    });
  },
  async onShow() {
    this.setData({ largeFont: usesLargeFont(), dateLabel: ui.date.label(ui.date.today()) });
    if (this._photoCheckin) this.setData(this._photoCheckin.view());
    const session = getApp().cloudSession;
    if (this._unsubscribePhoto) this._unsubscribePhoto();
    if (session && typeof session.subscribeConfirmed === 'function') this._unsubscribePhoto = session.subscribeConfirmed(event => { if (this._photoCheckin) this._photoCheckin.confirmed(event); });
    this.loadSupervisions();
    this.loadMediaStatuses(true);
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
    this.clearStartupFeedback();
    this._visitPinnedId = null;
    this.setData({ firstHabitGuide: '', returnGuide: null, chooserOpen: false, showCompleted: false });
    this._firstGuideId = null;
    if (this._unsubscribePhoto) this._unsubscribePhoto(); this._unsubscribePhoto = null;
    this.setData({ photoOpen: false });
  },
  onUnload() { this.clearStartupFeedback(); if (this._unsubscribePhoto) this._unsubscribePhoto(); this._unsubscribePhoto = null; },
  async loadSupervisions() {
    if (!supervision().status().enabled || this._loadingSupervisions) return;
    const version = this._showVersion; let context; this._loadingSupervisions = true;
    try {
      await Promise.resolve(getApp().dataReady);
      if (this._gone || this._visible === false || this._showVersion !== version) return;
      context = ui.contextKey();
      const result = await supervision().list();
      if (!ui.isCurrentView(this, context, version)) return;
      this._supervisionContext = context; this._supervisionDate = ui.date.today(); this._photoRequirements = {};
      const active = result.items.filter(item => ['active', 'scheduled'].includes(item.status));
      for (const item of active) if (item.role === 'subject' && item.today && item.today.date === ui.date.today()) this._photoRequirements[item.habitId] = item.today.photoRequired;
      const supervised = active.filter(item => item.role === 'supervisor');
      const overdue = supervised.filter(item => item.today && item.today.status === 'pending' && Date.now() >= Date.parse(item.today.date + 'T' + item.today.deadline + ':00+08:00')).length;
      this.setData({ supervisionCount: supervised.length, supervisionOverdue: overdue }); this.refresh();
    } catch (_) { /* Core completion still enforces a required-photo agreement. */ }
    finally { this._loadingSupervisions = false; }
  },
  async loadMediaStatuses(force = false) {
    if (!media().status().enabled || this._loadingMediaStatuses || this._gone || this._visible === false) return;
    let state; try { state = ui.store().read(); } catch (_) { return; }
    const context = ui.contextKey(), day = ui.date.today(), version = this._showVersion, key = context + ':' + day + ':' + state.revision;
    if (!force && this._mediaLoadedKey === key) return;
    this._loadingMediaStatuses = true; this._mediaLoadedKey = key;
    try {
      const completed = ui.domain.tasksOn(state, day).filter(task => task.done);
      const results = await Promise.all(completed.map(async task => {
        try { const record = await media().record({ habitId: task.id, date: day }); return [task.id, { photoCount: record.items.length, photosPending: record.processingCount > 0, photosUnavailable: record.unavailableCount > 0 }]; }
        catch (_) { return [task.id, this._photoStatuses && this._photoStatuses[task.id] || {}]; }
      }));
      if (!ui.isCurrentView(this, context, version) || day !== ui.date.today() || ui.store().read().revision !== state.revision) return;
      this._photoStatuses = {}; results.forEach(([id, value]) => { this._photoStatuses[id] = value; }); this.refresh();
    } catch (_) { /* A photo read cannot change the confirmed completion. */ }
    finally {
      this._loadingMediaStatuses = false;
      if (!this._gone && this._visible !== false) {
        try { if (context !== ui.contextKey() || day !== ui.date.today() || ui.store().read().revision !== state.revision) this.loadMediaStatuses(true); } catch (_) {}
      }
    }
  },
  photoController() {
    if (!this._photoCheckin) this._photoCheckin = createPhotoCheckin({ wx, media: media(), context: ui.contextKey, today: ui.date.today,
      visible: () => !this._gone && this._visible !== false, change: value => this.setData(value), pending: () => ui.storageInfo().pending > 0,
      dispatch: command => ui.mutate(this, command), retry: async () => { await getApp().cloudSession.retry(); return true; } });
    return this._photoCheckin;
  },
  openPhotoCheckin(task, type) { try { ui.assertContext(this); ui.assertWritable(); this.photoController().open(task, type); } catch (err) { ui.error(this, err); } },
  onMutationFailure(err, command) {
    if (err.code !== 'PHOTO_REQUIRED' || !this.data.photoEnabled || !['complete', 'completeMinimum'].includes(command.type)) return;
    const task = this.data.pending.find(item => item.id === command.id); if (task) this.openPhotoCheckin({ ...task, photoRequired: true }, command.type);
  },
  onPhotoClose() { if (this._photoCheckin) this._photoCheckin.close(); },
  onPhotoChoose() { if (this._photoCheckin) this._photoCheckin.choose(); },
  onPhotoRetry() { return this._photoCheckin && this._photoCheckin.upload(); },
  onPhotoRemove(event) { if (this._photoCheckin) this._photoCheckin.remove(event.currentTarget.dataset.id); },
  onPhotoSubmit() { return this._photoCheckin && this._photoCheckin.submit(); },
  onPhotoBackdrop() {},
  onSupervisions() { wx.navigateTo({ url: '/pages/supervision/index?tab=supervisor' }); },
  onNextReminder() { wx.navigateTo({ url: '/pages/reminder/index?type=self&date=' + ui.date.shift(ui.date.today(), 1) }); },
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

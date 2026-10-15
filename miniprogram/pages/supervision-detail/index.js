const ui = require('../../services/ui');
const { supervision, statusLabel } = require('../../services/supervision-client');
Page(ui.withLifecycle({
  data: { loading: true, dataReady: false, dataUnavailable: false, enabled: false, error: '', busy: false, item: null, days: [],
    deadline: '21:00', photoRequired: false, editingRules: false, dayLabel: '', encouraged: [] },
  onLoad(options = {}) { this._id = options.id; },
  refresh() {
    const context = ui.contextKey();
    if (this._detailContext && this._detailContext !== context) this.setData({ item: null, days: [], encouraged: [], editingRules: false });
    this._detailContext = context; this.setData({ enabled: supervision().status().enabled }); ui.read(this, () => {});
  },
  async onShow() {
    const version = this._showVersion; try { await Promise.resolve(getApp().dataReady); } catch (_) {}
    if (this._gone || !this._visible || version !== this._showVersion) return;
    this.refresh(); if (this.data.enabled && this.data.dataReady) return this.load();
  },
  async run(action, finish) {
    if (this._supervisionBusy) return;
    const context = ui.contextKey(), version = this._showVersion; this._supervisionBusy = true; this.setData({ busy: true, error: '' });
    try { const result = await action(supervision()); if (ui.isCurrentView(this, context, version)) finish(result); }
    catch (err) { if (ui.isCurrentView(this, context, version)) { if (err.code === 'SUPERVISION_UNAVAILABLE') this.setData({ item: null, days: [], encouraged: [], editingRules: false }); ui.error(this, err); } }
    finally { this._supervisionBusy = false; if (ui.isCurrentView(this, context, version)) this.setData({ busy: false }); }
  },
  present(item) {
    const rules = item.pendingRules || item.rules;
    this.setData({ item, dayLabel: statusLabel(item.today), deadline: rules.deadline, photoRequired: rules.photoRequired,
      schedule: item.habitPlan ? ui.domain.weekdayText(item.habitPlan.weekdays) : '' });
    if (!['active', 'scheduled'].includes(item.status)) this.setData({ days: [], encouraged: [], editingRules: false });
  },
  load() {
    if (!this._id) { this.setData({ error: '这个约定链接不完整' }); return; }
    return this.run(s => s.detail(this._id), result => {
      this.present(result.supervision);
      this.setData({ encouraged: result.days.filter(day => day.encouraged).map(day => day.date), days: result.days.map(day => ({ ...day, label: statusLabel(day), canEncourage: result.supervision.role === 'supervisor' && ['standard', 'minimum'].includes(day.status) })) });
    });
  },
  onRefresh() { return this.load(); },
  async onDataRetry() { await ui.recoveryActions.onDataRetry.call(this); if (this.data.enabled && this.data.dataReady) return this.load(); },
  onEditRules() { this.setData({ editingRules: !this.data.editingRules }); },
  onTime(event) { this.setData({ deadline: event.detail.value }); },
  onPhoto(event) { this.setData({ photoRequired: event.detail.value === true }); },
  onSaveRules() { return this.run(s => s.update(this.data.item, { deadline: this.data.deadline, photoRequired: this.data.photoRequired }), item => { this.present(item); this.setData({ editingRules: false }); wx.showToast({ title: '约定明天生效', icon: 'none' }); }); },
  onEnd() {
    if (this.data.busy || !this.data.item) return;
    const context = ui.contextKey(), version = this._showVersion;
    wx.showModal({ title: '结束这份监督约定？', content: '对方将不能继续查看记录，相关提醒停止。本人打卡保留。', confirmText: '结束监督',
      success: result => { if (result.confirm && ui.isCurrentView(this, context, version)) this.run(s => s.end(this.data.item), item => this.present(item)); } });
  },
  onEncourage(event) {
    const date = event.currentTarget.dataset.date;
    return this.run(s => s.encourage(this._id, date), () => { const encouraged = this.data.encouraged.concat(date); this.setData({ encouraged, days: this.data.days.map(day => ({ ...day, encouraged: encouraged.includes(day.date) })) }); wx.showToast({ title: '已送出鼓励', icon: 'none' }); });
  },
  onPhotos(event) { const item = this.data.item; wx.navigateTo({ url: '/pages/photo-record/index?' + (item.role === 'subject' ? 'habitId=' + item.habitId : 'supervisionId=' + this._id) + '&date=' + event.currentTarget.dataset.date }); },
  onReminder() { wx.navigateTo({ url: '/pages/reminder/index?type=' + (this.data.item.role === 'supervisor' ? 'supervisor&relationId=' + this._id : 'self&habitId=' + this.data.item.habitId) }); }
}));

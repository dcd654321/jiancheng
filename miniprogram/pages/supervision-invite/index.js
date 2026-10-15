const ui = require('../../services/ui');
const { supervision } = require('../../services/supervision-client');
const { APP_NAME } = require('../../config/brand');
Page(ui.withLifecycle({
  data: { loading: true, dataReady: false, dataUnavailable: false, enabled: false, error: '', busy: false,
    habitId: '', habits: [], habitIndex: 0, durationDays: 7, deadline: '21:00', photoRequired: false, displayName: '',
    invite: null, canApply: false, canConfirm: false, applied: false },
  onLoad(options = {}) { this._inviteId = options.inviteId; this._selectedHabit = options.habitId || ''; },
  refresh() {
    const context = ui.contextKey();
    if (this._inviteContext && this._inviteContext !== context) { this._inviteId = null; this.setData({ invite: null, displayName: '', canApply: false, canConfirm: false, applied: false }); }
    this._inviteContext = context;
    this.setData({ enabled: supervision().status().enabled });
    ui.read(this, (state, date) => {
      const habits = state.habits.filter(h => { const p = ui.domain.versionAt(h, date); return p && p.status === 'active'; }).map(h => ({ id: h.id, title: ui.domain.versionAt(h, date).title }));
      const index = Math.max(0, habits.findIndex(h => h.id === (this.data.habitId || this._selectedHabit)));
      this.setData({ habits, habitIndex: index, habitId: habits[index] ? habits[index].id : '' });
    });
  },
  async onShow() {
    const version = this._showVersion; try { await Promise.resolve(getApp().dataReady); } catch (_) {}
    if (this._gone || !this._visible || version !== this._showVersion) return;
    this.refresh(); if (this._inviteId && this.data.enabled && this.data.dataReady) return this.load();
  },
  async run(action, finish) {
    if (this._inviteBusy) return;
    const context = ui.contextKey(), version = this._showVersion;
    this._inviteBusy = true; this.setData({ busy: true, error: '' });
    try { ui.assertContext(this); const result = await action(supervision()); if (ui.isCurrentView(this, context, version)) finish(result); }
    catch (err) { if (ui.isCurrentView(this, context, version)) ui.error(this, err); }
    finally { this._inviteBusy = false; if (ui.isCurrentView(this, context, version)) this.setData({ busy: false }); }
  },
  load() { return this.run(s => s.invitation(this._inviteId), result => this.setData({ invite: result.invite, canApply: result.canApply === true, canConfirm: result.canConfirm === true, applied: result.invite.status === 'applied' && !result.canConfirm })); },
  onRefresh() { return this.load(); },
  async onDataRetry() { await ui.recoveryActions.onDataRetry.call(this); if (this._inviteId && this.data.enabled && this.data.dataReady) return this.load(); },
  onHabit(event) { const index = Number(event.detail.value); this.setData({ habitIndex: index, habitId: this.data.habits[index].id }); },
  onDuration(event) { this.setData({ durationDays: Number(event.currentTarget.dataset.days) }); },
  onTime(event) { this.setData({ deadline: event.detail.value }); },
  onPhoto(event) { this.setData({ photoRequired: event.detail.value === true }); },
  onName(event) { this.setData({ displayName: Array.from(event.detail.value || '').slice(0, 12).join('') }); },
  onCreate() {
    if (!this.data.habitId) { this.setData({ error: '先添加一个进行中的习惯，再邀请好友' }); return; }
    return this.run(s => s.create({ habitId: this.data.habitId, durationDays: this.data.durationDays, deadline: this.data.deadline, photoRequired: this.data.photoRequired,
      ...(this.data.displayName.trim() ? { displayName: this.data.displayName.trim() } : {}) }), invite => { this._inviteId = invite.inviteId; this.setData({ invite, canApply: false, canConfirm: false }); });
  },
  onApply() { return this.run(s => s.apply(this._inviteId, this.data.displayName.trim()), () => { this.setData({ applied: true, canApply: false }); this.loadAfterAction = true; }); },
  onConfirm() { return this.run(s => s.confirm(this._inviteId), item => wx.redirectTo({ url: '/pages/supervision-detail/index?id=' + item.supervisionId })); },
  onShareAppMessage() { return this.data.invite ? { title: '陪我坚持一个小习惯 · ' + APP_NAME, path: '/pages/supervision-invite/index?inviteId=' + this.data.invite.inviteId, imageUrl: '/assets/share/cover.png' } : { title: APP_NAME, path: '/pages/today/index' }; },
  onList() { wx.redirectTo({ url: '/pages/supervision/index?tab=subject' }); }
}));

const ui = require('../../services/ui');
const { supervision, sorted } = require('../../services/supervision-client');
Page(ui.withLifecycle({
  data: { loading: true, dataReady: false, dataUnavailable: false, enabled: false, error: '', busy: false,
    tab: 'supervisor', items: [], invitations: [], visibleItems: [] },
  onLoad(options = {}) { this.setData({ tab: options.tab === 'subject' ? 'subject' : 'supervisor' }); },
  refresh() {
    const context = ui.contextKey();
    if (this._listContext && this._listContext !== context) this.setData({ items: [], invitations: [], visibleItems: [] });
    this._listContext = context; this.setData({ enabled: supervision().status().enabled }); ui.read(this, () => {});
  },
  async onShow() {
    const version = this._showVersion;
    try { await Promise.resolve(getApp().dataReady); } catch (_) {}
    if (this._gone || !this._visible || version !== this._showVersion) return;
    this.refresh(); if (this.data.enabled && this.data.dataReady) return this.load();
  },
  async load() {
    if (this._loadingList || !this.data.enabled) return;
    const context = ui.contextKey(), version = this._showVersion;
    this._loadingList = true; this.setData({ busy: true, error: '' });
    try {
      const result = await supervision().list();
      if (!ui.isCurrentView(this, context, version)) return;
      this.setData({ items: sorted(result.items), invitations: result.invitations }); this.filter();
    } catch (err) { if (ui.isCurrentView(this, context, version)) ui.error(this, err); }
    finally { this._loadingList = false; if (ui.isCurrentView(this, context, version)) this.setData({ busy: false }); }
  },
  filter() { this.setData({ visibleItems: this.data.items.filter(item => item.role === this.data.tab) }); },
  onTab(event) { this.setData({ tab: event.currentTarget.dataset.tab }); this.filter(); },
  onRefresh() { return this.load(); },
  async onDataRetry() { await ui.recoveryActions.onDataRetry.call(this); if (this.data.enabled && this.data.dataReady) return this.load(); },
  onInvite() { wx.navigateTo({ url: '/pages/supervision-invite/index' }); },
  onInvitation(event) { wx.navigateTo({ url: '/pages/supervision-invite/index?inviteId=' + encodeURIComponent(event.currentTarget.dataset.id) }); },
  onOpen(event) { wx.navigateTo({ url: '/pages/supervision-detail/index?id=' + encodeURIComponent(event.currentTarget.dataset.id) }); },
  onReminders() { wx.navigateTo({ url: '/pages/reminder/index?type=supervisor' }); }
}));

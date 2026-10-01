const { features } = require('../../services/features-client');
const { present } = require('../../core/share-presentation');
const { APP_NAME } = require('../../config/brand');
const { themeSnapshot, appearanceController } = require('../../services/appearance');
const dates = require('../../core/date');
Page({
  data: { loading: true, error: '', view: null, mine: false, active: false, busy: false, statusLabel: '', expires: '', shareEnabled: false, theme: 'mist' },
  onLoad(options = {}) { this._id = options.id || ''; this.setData({ mine: options.mine === '1' }); },
  bindTheme() {
    const controller = appearanceController();
    if (controller && !this._themeUnsubscribe) this._themeUnsubscribe = controller.subscribe(() => {
      if (this._visible) this.setData(themeSnapshot());
    });
    this.setData(themeSnapshot());
  },
  onShow() {
    this._visible = true; this._gone = false;
    this.bindTheme();
    const session = getApp().cloudSession;
    if (this._unsubscribe) this._unsubscribe();
    if (this.data.mine && session && session.subscribe) this._unsubscribe = session.subscribe(() => {
      if (!this._visible || !this._context) return;
      let key = ''; try { key = features().contextKey(); } catch (_) { /* lost account context */ }
      if (key !== this._context) {
        this._version = (this._version || 0) + 1; this._snapshot = null;
        this.setData({ view: null, active: false, shareEnabled: false, error: '账户数据已变化，请重新打开分享' });
        if (wx.hideShareMenu) wx.hideShareMenu();
      }
    });
    return this.load();
  },
  onHide() { this._visible = false; this._version = (this._version || 0) + 1; if (this._unsubscribe) this._unsubscribe(); this._unsubscribe = null; if (this._themeUnsubscribe) this._themeUnsubscribe(); this._themeUnsubscribe = null; this._snapshot = null; this.setData({ view: null, active: false, shareEnabled: false }); },
  onUnload() { this._visible = false; this._gone = true; this._version = (this._version || 0) + 1; if (this._unsubscribe) this._unsubscribe(); this._unsubscribe = null; if (this._themeUnsubscribe) this._themeUnsubscribe(); this._themeUnsubscribe = null; this._snapshot = null; },
  async load() {
    const version = this._version = (this._version || 0) + 1;
    this.setData({ loading: true, error: '', view: null, active: false, shareEnabled: false });
    if (wx.hideShareMenu) wx.hideShareMenu();
    try {
      const service = features();
      if (this.data.mine) await Promise.resolve(getApp().dataReady);
      const key = this.data.mine ? service.contextKey() : '';
      const result = this.data.mine ? await service.ownShare(this._id) : await service.publicShare(this._id);
      if (!this._visible || this._gone || version !== this._version || (key && key !== service.contextKey())) return;
      this._context = key; this._snapshot = result.publicSnapshot;
      const active = !result.status || result.status === 'active';
      const capabilities = service.status();
      const shareEnabled = active && capabilities.publicShares;
      this.setData({ loading: false, view: present(result.publicSnapshot), active, shareEnabled,
        expires: dates.today(Date.parse(result.expiresAt)), statusLabel: { revoked: '已撤回 · 仅本人可回看', expired: '已到期 · 仅本人可回看' }[result.status] || '公开快照' });
      if (shareEnabled && wx.showShareMenu) wx.showShareMenu({ menus: capabilities.timeline ? ['shareAppMessage','shareTimeline'] : ['shareAppMessage'] });
    } catch (err) {
      if (this._visible && !this._gone && version === this._version) this.setData({ loading: false, error: err.message || '分享暂不可用' });
    }
  },
  onRetry() { return this.load(); },
  onStart() { wx.switchTab({ url: '/pages/today/index', fail: () => this.setData({ error: '请先从微信预览进入小程序，再创建自己的习惯。' }) }); },
  onCopy() {
    try {
      if (!this._snapshot || !this.data.view || !this.data.view.canCopy) throw Error('请先读取有效的计划');
      const token = features().handoff(this._snapshot);
      wx.navigateTo({ url: '/pages/edit/index?sharedDraft=' + token,
        fail: () => this.setData({ error: '请先进入完整小程序，再创建这份计划。' }) });
    } catch (err) { this.setData({ error: err.message }); }
  },
  onManage(event) {
    if (!this.data.mine || this.data.busy) return;
    const action = event.currentTarget.dataset.action;
    if (!['revoke','remove'].includes(action)) return;
    const key = this._context, version = this._version;
    wx.showModal({ title: action === 'revoke' ? '撤回这份分享？' : '删除这份分享？',
      content: '旧链接将不能再读取内容；别人已保存的图片或聊天卡片无法收回。' + (action === 'remove' ? '也会从你的分享列表移除。' : '你仍可在我的分享回看。'),
      confirmText: action === 'revoke' ? '撤回分享' : '删除分享', confirmColor: '#983e28',
      success: async answer => {
        if (!answer.confirm || !this._visible || this._gone || version !== this._version || this.data.busy) return;
        this.setData({ busy: true, error: '' });
        try {
          if (!key || key !== features().contextKey()) throw Error('账户数据已变化，请重新打开');
          await features()[action](this._id);
          if (!this._visible || this._gone || version !== this._version) return;
          if (action === 'remove') {
            this._snapshot = null; this.setData({ view: null, active: false, shareEnabled: false, error: '这份分享已删除' });
            if (wx.hideShareMenu) wx.hideShareMenu();
          } else await this.load();
        } catch (err) { if (!this._gone && this._visible && version === this._version) this.setData({ error: err.message || '操作未确认，请重试' }); }
        finally { if (!this._gone) this.setData({ busy: false }); }
      } });
  },
  onShareAppMessage() {
    return this.data.shareEnabled && this.data.view
      ? { title: this.data.view.title, path: '/pages/share-view/index?id=' + this._id }
      : { title: APP_NAME, path: '/pages/today/index' };
  },
  onShareTimeline() {
    return this.data.shareEnabled && features().status().timeline && this.data.view
      ? { title: this.data.view.title, query: 'id=' + this._id }
      : { title: APP_NAME, query: '' };
  }
});

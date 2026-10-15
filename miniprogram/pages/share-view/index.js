const { features } = require('../../services/features-client');
const { present } = require('../../core/share-presentation');
const { APP_NAME } = require('../../config/brand');
const { themeSnapshot, appearanceController } = require('../../services/appearance');
const dates = require('../../core/date');
const ui = require('../../services/ui');
Page({
  data: { loading: true, error: '', view: null, mine: false, active: false, busy: false, adopting: false, adoptError: '', adoptNeedsSync: false, statusLabel: '', expires: '', shareEnabled: false, theme: 'mist' },
  onLoad(options = {}) { this._id = options.id || ''; this.setData({ mine: options.mine === '1' }); },
  contentRendered(version = this._version) {
    const rendered = ui.coreContentRendered(this, () => !this.data.loading);
    return () => { if (version === this._version) rendered(); };
  },
  bindTheme() {
    const controller = appearanceController();
    if (controller && !this._themeUnsubscribe) this._themeUnsubscribe = controller.subscribe(() => {
      if (this._visible) this.setData(themeSnapshot());
    });
    this.setData(themeSnapshot());
  },
  onShow() {
    this._visible = true; this._gone = false;
    const showVersion = this._showVersion = (this._showVersion || 0) + 1;
    this.bindTheme();
    const session = getApp().cloudSession;
    if (this._unsubscribe) this._unsubscribe();
    if (session && session.subscribe) this._unsubscribe = session.subscribe(() => {
      if (!this._visible || this._gone || this._showVersion !== showVersion) return;
      if (this.data.mine && this._context) {
        let key = ''; try { key = features().contextKey(); } catch (_) { /* lost account context */ }
        if (key !== this._context) {
          this._version = (this._version || 0) + 1; this._snapshot = null;
          this.setData({ view: null, active: false, shareEnabled: false, error: '账户数据已变化，请重新打开分享' });
          if (wx.hideShareMenu) wx.hideShareMenu();
        }
      }
      if (!this.data.loading) this.setData({ loading: false }, this.contentRendered());
    });
    return this.load();
  },
  onHide() { this._visible = false; this._version = (this._version || 0) + 1; if (this._unsubscribe) this._unsubscribe(); this._unsubscribe = null; if (this._themeUnsubscribe) this._themeUnsubscribe(); this._themeUnsubscribe = null; this._snapshot = null; this.setData({ view: null, active: false, shareEnabled: false, adopting: false }); },
  onUnload() { this._visible = false; this._gone = true; this._version = (this._version || 0) + 1; if (this._unsubscribe) this._unsubscribe(); this._unsubscribe = null; if (this._themeUnsubscribe) this._themeUnsubscribe(); this._themeUnsubscribe = null; this._snapshot = null; },
  async load() {
    const version = this._version = (this._version || 0) + 1;
    this.setData({ loading: true, error: '', view: null, active: false, shareEnabled: false, adopting: false, adoptError: '', adoptNeedsSync: false });
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
        expires: dates.today(Date.parse(result.expiresAt)), statusLabel: { revoked: '已撤回 · 仅本人可回看', expired: '已到期 · 仅本人可回看' }[result.status] || '公开快照' }, this.contentRendered(version));
      if (shareEnabled && wx.showShareMenu) wx.showShareMenu({ menus: capabilities.timeline ? ['shareAppMessage','shareTimeline'] : ['shareAppMessage'] });
    } catch (err) {
      if (this._visible && !this._gone && version === this._version) this.setData({ loading: false, error: err.message || '分享暂不可用' }, this.contentRendered(version));
    }
  },
  onRetry() { return this.load(); },
  onStart() { wx.switchTab({ url: '/pages/today/index', fail: () => this.setData({ error: '请先从微信预览进入小程序，再创建自己的习惯。' }) }); },
  onAccountStatus() { wx.navigateTo({ url: '/pages/sync/index', fail: () => this.setData({ adoptError: '请从微信会话打开完整小程序后查看账户状态。' }) }); },
  async onCopy() {
    if (this.data.adopting) return;
    const version = this._version, snapshot = this._snapshot;
    const current = () => this._visible && !this._gone && version === this._version && snapshot === this._snapshot;
    this.setData({ adopting: true, adoptError: '', adoptNeedsSync: false });
    let timer, navigating = false;
    try {
      if (!snapshot || !this.data.view || !this.data.view.canCopy) throw Error('请先读取有效的计划');
      const app = getApp(), session = app.cloudSession;
      const prepare = async () => {
        await Promise.resolve(app.dataReady);
        if (!current()) return;
        const status = session && session.status ? session.status() : {};
        // start会重发已有pending；采用分享不能顺带确认另一笔私有写入。
        if (status.pending || status.conflict || status.deletionPending) {
          this.setData({ adoptNeedsSync: true });
          throw Error('先到云端状态核对已有操作，再回来使用这个计划；公开内容已保留');
        }
        if (status.ready === false && session && typeof session.start === 'function') await session.start();
      };
      await Promise.race([prepare(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('账户读取尚未确认，请重试；这份计划仍在本页')), 15000); })]);
      if (!current()) return;
      const status = session && session.status ? session.status() : {};
      if (status.pending || status.conflict || status.deletionPending || status.networkOffline) throw Error('账户暂时不可创建，请恢复云端记录后重试；计划已保留');
      const token = features().handoff(snapshot);
      navigating = true;
      wx.navigateTo({ url: '/pages/edit/index?sharedDraft=' + token,
        fail: () => { if (current()) this.setData({ adopting: false, adoptError: '确认页未打开，请重试。习惯尚未创建。' }); } });
    } catch (err) { navigating = false; if (current()) this.setData({ adoptError: err.message || '账户暂时无法读取，请重试' }); }
    finally { clearTimeout(timer); if (current() && !navigating) this.setData({ adopting: false }); }
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
      ? { title: this.data.view.canCopy ? this.data.view.title + '：平时' + this.data.view.plan.target + this.data.view.plan.unit + '，忙时' + this.data.view.plan.minimum + this.data.view.plan.unit : this.data.view.title,
        path: '/pages/share-view/index?id=' + this._id, imageUrl: '/assets/share/cover.png' }
      : { title: APP_NAME + '：忙的时候，也能做一点', path: '/pages/today/index', imageUrl: '/assets/share/cover.png' };
  },
  onShareTimeline() {
    return this.data.shareEnabled && features().status().timeline && this.data.view
      ? { title: this.data.view.title, query: 'id=' + this._id }
      : { title: APP_NAME, query: '' };
  }
});

const ui = require('../../services/ui');
const { features } = require('../../services/features-client');
const { present } = require('../../core/share-presentation');
const pageWork = require('../../services/feature-page');
const dates = require('../../core/date');
Page(ui.withLifecycle({
  data: { error: '', loading: true, dataUnavailable: false, dataReady: false,
    enabled: false, busy: false, loaded: false, items: [], nextCursor: null },
  refresh() {
    pageWork.resetOnContext(this, () => this.setData({ items: [], nextCursor: null, loaded: false }));
    this.setData({ enabled: features().status().enabled, busy: !!this._featureBusy });
    ui.read(this, () => {});
  },
  async onShow() { await Promise.resolve(getApp().dataReady); if (!this._gone && this._visible) { this.refresh(); if (this.data.enabled && this.data.dataReady) this.load(false); } },
  load(more) {
    return pageWork.run(this, service => service.list(more ? this.data.nextCursor : null), result => {
      const items = result.items.map(item => ({ ...item, title: present(item.publicSnapshot).title,
        statusLabel: { active: '可查看', revoked: '已撤回', expired: '已到期' }[item.status], createdLabel: dates.today(Date.parse(item.createdAt)) }));
      const combined = more ? this.data.items.concat(items) : items;
      this.setData({ items: combined.filter((item, i) => combined.findIndex(other => other.shareId === item.shareId) === i), nextCursor: result.nextCursor, loaded: true });
    });
  },
  onRefreshList() { return this.load(false); },
  onMore() { if (this.data.nextCursor) return this.load(true); },
  onOpen(event) { wx.navigateTo({ url: '/pages/share-view/index?id=' + event.currentTarget.dataset.id + '&mine=1' }); },
  onCreate() { wx.navigateTo({ url: '/pages/share-create/index' }); },
}));

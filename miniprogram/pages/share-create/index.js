const ui = require('../../services/ui');
const { features } = require('../../services/features-client');
const { present } = require('../../core/share-presentation');
const pageWork = require('../../services/feature-page');
Page(ui.withLifecycle({
  data: { error: '', loading: true, dataUnavailable: false, dataReady: false,
    enabled: false, busy: false, kind: 'invite', plans: [], planIndex: 0, categories: ['阅读','步行','复习','整理'],
    categoryIndex: 0, includeWeekdays: false, captions: ['每天一小步，也在向前。','不必完美，今天继续。','忙时少做一点，也值得记录。'],
    captionIndex: 0, preview: null },
  onLoad(options = {}) { if (['invite','plan','weekly'].includes(options.kind)) this.setData({ kind: options.kind }); },
  refresh() {
    pageWork.resetOnContext(this, () => { this._preview = null; this.setData({ preview: null, plans: [], planIndex: 0 }); });
    this.setData({ enabled: features().status().enabled, busy: !!this._featureBusy });
    ui.read(this, (state, day) => {
      const plans = state.habits.map(h => ({ id: h.id, plan: ui.domain.versionAt(h, day) }))
        .filter(h => h.plan && h.plan.status === 'active' && h.plan.minimum)
        .map(h => ({ id: h.id, title: h.plan.title }));
      this.setData({ plans, planIndex: Math.min(this.data.planIndex, Math.max(0, plans.length - 1)) });
    });
  },
  clearPreview() { this._preview = null; this.setData({ preview: null, error: '' }); },
  onKind(event) { if (this.data.busy || !['invite','plan','weekly'].includes(event.currentTarget.dataset.kind)) return; this.setData({ kind: event.currentTarget.dataset.kind }); this.clearPreview(); },
  onChoice(event) {
    if (this.data.busy) return;
    const field = event.currentTarget.dataset.field;
    const limits = { planIndex: this.data.plans.length, categoryIndex: 4, captionIndex: 3 };
    const value = Number(event.detail.value);
    if (!Object.prototype.hasOwnProperty.call(limits, field) || !Number.isInteger(value) || value < 0 || value >= limits[field]) return;
    this.setData({ [field]: value }); this.clearPreview();
  },
  onWeekdays(event) { if (!this.data.busy) { this.setData({ includeWeekdays: !!event.detail.value }); this.clearPreview(); } },
  onPreview() {
    const input = { kind: this.data.kind };
    if (input.kind === 'plan') {
      const plan = this.data.plans[this.data.planIndex];
      if (!plan) { ui.error(this, Error('先设置一个进行中且有忙时目标的习惯')); return; }
      Object.assign(input, { sourceHabitId: plan.id, categoryKey: ['read','walk','study','tidy'][this.data.categoryIndex], includeWeekdays: this.data.includeWeekdays });
    }
    if (input.kind === 'weekly') input.captionKey = ['small-steps','keep-going','busy-still-counts'][this.data.captionIndex];
    this.clearPreview();
    return pageWork.run(this, service => service.preview(input), preview => {
      this._preview = preview; this.setData({ preview: present(preview.publicSnapshot) });
    });
  },
  onCreate() {
    if (!this._preview) { ui.error(this, Error('请先预览公开内容')); return; }
    return pageWork.run(this, service => service.create(this._preview), share => {
      wx.navigateTo({ url: '/pages/share-view/index?id=' + share.shareId + '&mine=1' });
    });
  },
}));

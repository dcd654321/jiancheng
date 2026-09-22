const ui = require('../../services/ui');
const { DIRECTIONS, validateInput } = require('../../core/plan-assistant');
Page(ui.withLifecycle({
  data: { directions: DIRECTIONS, direction: 'read', minutes: '5', weekdays: [1, 2, 3, 4, 5], days: [], time: '',
    error: '', busy: false, configured: false, consent: false, preview: null, schedule: '', moreOpen: false, inputSchedule: '' },
  onLoad() { this._request = 0; this._context = ui.contextKey(); },
  onHide() { this._request++; this.setData({ busy: false, consent: false }); },
  refresh() {
    try {
      if (this._context !== ui.contextKey()) {
        this._suggestion = null; this._context = ui.contextKey(); this.setData({ preview: null, error: '数据状态已变化，请重新预览' });
      }
      this.setData({ configured: getApp().planAssistant.status().configured,
        inputSchedule: ui.domain.weekdayText(this.data.weekdays) + (this.data.time ? ' · ' + this.data.time : ' · 时间不限'),
        days: [1, 2, 3, 4, 5, 6, 7].map(value => ({ value, label: '一二三四五六日'[value - 1], selected: this.data.weekdays.includes(value) })) });
    } catch (err) { ui.error(this, err); }
  },
  change(patch) {
    if (this.data.busy) return;
    this._suggestion = null; this.setData({ ...patch, preview: null, error: '' }); this.refresh();
  },
  onDirection(e) { this.change({ direction: e.currentTarget.dataset.id }); },
  onMinutes(e) { this.change({ minutes: e.detail.value }); },
  onDay(e) { const value = Number(e.currentTarget.dataset.day); this.change({ weekdays: this.data.weekdays.includes(value) ? this.data.weekdays.filter(n => n !== value) : this.data.weekdays.concat(value) }); },
  onTime(e) { this.change({ time: e.detail.value }); },
  onClearTime() { this.change({ time: '' }); },
  onMore() { if (!this.data.busy) this.setData({ moreOpen: !this.data.moreOpen }); },
  onConsent(e) { if (!this.data.busy) this.setData({ consent: e.detail.value.includes('agree') }); },
  showSuggestion(result) {
    const request = this._request, context = ui.contextKey();
    this._suggestion = result;
    this.setData({ preview: result, schedule: ui.domain.weekdayText(result.draft.weekdays), error: '' }, () => {
      if (!this._gone && request === this._request && this._suggestion === result && context === ui.contextKey() && wx.pageScrollTo) {
        wx.pageScrollTo({ selector: '#plan-preview', duration: 200 });
      }
    });
  },
  onRules() {
    if (this.data.busy) return;
    try { ui.assertContext(this); this.showSuggestion(getApp().planAssistant.rules(validateInput(this.data))); }
    catch (err) { ui.error(this, err); }
  },
  async onGenerate() {
    if (this.data.busy) return;
    const request = ++this._request, context = ui.contextKey();
    try {
      ui.assertContext(this); const input = validateInput(this.data);
      this._suggestion = null; this.setData({ busy: true, preview: null, error: '' });
      const result = await getApp().planAssistant.generate(input, this.data.consent);
      if (!this._gone && request === this._request && context === ui.contextKey()) this.showSuggestion(result);
    } catch (err) { if (!this._gone && request === this._request) ui.error(this, err); }
    finally { if (!this._gone && request === this._request) this.setData({ busy: false }); }
  },
  onAdopt() {
    if (this.data.busy || !this._suggestion) return;
    try {
      ui.assertContext(this);
      const token = getApp().planAssistant.handoff(this._suggestion, ui.contextKey());
      this.setData({ busy: true });
      wx.navigateTo({ url: '/pages/edit/index?draft=' + token, fail: () => { if (!this._gone) { this.setData({ busy: false }); ui.error(this, Error('表单未打开，请重试；习惯尚未创建')); } } });
    } catch (err) { this.setData({ busy: false }); ui.error(this, err); }
  }
}));

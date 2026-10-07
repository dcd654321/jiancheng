const ui = require('../../services/ui');
const { DIRECTIONS, validateInput } = require('../../core/plan-assistant');
const flow = require('../../services/today-flow');
const defaults = () => ({ direction: 'read', minutes: '5', weekdays: [1, 2, 3, 4, 5, 6, 7], time: '' });
const cloudRecoveryCodes = ['EPOCH_CHANGED', 'ACCOUNT_REQUIRED', 'DELETE_PENDING'];
Page(ui.withLifecycle({
  data: { ...defaults(), directions: DIRECTIONS, presets: [2, 5, 10, 15], customMinutes: false,
    days: [], inputSchedule: '', loading: false, dataReady: false, dataUnavailable: false,
    error: '', requestError: '', fieldErrors: {}, focusField: '', busy: false, serviceBusy: false,
    configured: false, canGenerate: false, blockedReason: '', consent: false,
    preview: null, schedule: '', moreOpen: false, privacyOpen: false,
    canAdopt: false, capacityNote: '', capacityFull: false, adopting: false, needsCloudRefresh: false, retryLabel: '生成 AI 建议' },
  onLoad() { this._request = 0; this._assistantContext = ui.contextKey(); this._inputDay = ui.date.today(); },
  onShow() { this.updateAvailability(); },
  onHide() { this.invalidateRequest(); this.setData({ consent: false, adopting: false }); },
  onUnload() { this.invalidateRequest(); },
  invalidateRequest() {
    this._request = (this._request || 0) + 1;
    clearTimeout(this._statusTimer); this._statusTimer = null;
    if (!this._gone) this.setData({ busy: false });
  },
  refresh() {
    const context = ui.contextKey(), day = ui.date.today();
    if (this._assistantContext !== context || this._inputDay !== day) {
      const accountChanged = this._assistantContext !== context;
      this.invalidateRequest(); this._suggestion = null;
      this._assistantContext = context; this._inputDay = day;
      this.setData({ ...(accountChanged ? { ...defaults(), needsCloudRefresh: false } : {}), preview: null, consent: false,
        requestError: accountChanged ? '账户数据已变化，请重新选择和预览' : '日期已变化，请重新预览',
        fieldErrors: {}, focusField: '', moreOpen: false, privacyOpen: false, customMinutes: false,
        adopting: false, retryLabel: '生成 AI 建议' });
    }
    ui.read(this, state => {
      const capacity = flow.creationAvailability(state, day);
      this.setData({ capacityFull: !capacity.today && !capacity.tomorrow,
        capacityNote: !capacity.today && !capacity.tomorrow ? '已有 5 个进行中的习惯，调整一个后再创建。'
          : !capacity.today ? '今天的位置已满，新习惯将从明天开始。' : '' });
    });
    this.updateChoices(); this.updateAvailability();
  },
  updateChoices() {
    this.setData({ inputSchedule: this.data.weekdays.length ? ui.domain.weekdayText(this.data.weekdays) + (this.data.time ? ' · ' + this.data.time : ' · 时间自定') : '至少选一天',
      days: [1, 2, 3, 4, 5, 6, 7].map(value => ({ value, label: '一二三四五六日'[value - 1], selected: this.data.weekdays.includes(value) })) });
  },
  updateAvailability() {
    const service = getApp().planAssistant, status = service ? service.status() : {};
    const info = ui.storageInfo();
    const canAdopt = this.data.dataReady && !this.data.dataReadOnly && info.ready !== false
      && !info.pending && !info.conflict && !info.deletionPending && !this.data.capacityFull && !this.data.needsCloudRefresh;
    this.setData({ configured: !!status.configured, serviceBusy: !!status.busy,
      canGenerate: status.canGenerate === true && !this.data.capacityFull && !this.data.needsCloudRefresh,
      blockedReason: this.data.needsCloudRefresh ? '请重新读取云端账户，确认最新状态后继续。'
        : this.data.capacityFull ? this.data.capacityNote : status.blockedReason || '', canAdopt: !!canAdopt });
    clearTimeout(this._statusTimer); this._statusTimer = null;
    // 仅检查内存在途状态，不轮询云端；隐藏/卸载立即停止。
    if (status.busy && this._visible !== false && !this._gone) this._statusTimer = setTimeout(() => this.updateAvailability(), 800);
  },
  change(patch) {
    if (this.data.busy || this.data.adopting) return;
    const changed = ['direction', 'minutes', 'weekdays', 'time'].some(key =>
      Object.prototype.hasOwnProperty.call(patch, key) && JSON.stringify(patch[key]) !== JSON.stringify(this.data[key]));
    if (!changed) { this.setData(patch); return; }
    this.invalidateRequest(); this._suggestion = null;
    this.setData({ ...patch, consent: false, preview: null, requestError: '', fieldErrors: {}, retryLabel: '生成 AI 建议' });
    this.updateChoices(); this.updateAvailability();
  },
  onDirection(e) { this.change({ direction: e.currentTarget.dataset.id }); },
  onPreset(e) { this.change({ minutes: String(e.currentTarget.dataset.minutes), customMinutes: false }); },
  onCustom() { if (!this.data.busy && !this.data.adopting) this.setData({ customMinutes: true, focusField: 'minutes' }); },
  onMinutes(e) { this.change({ minutes: e.detail.value }); this.validateFields(false); },
  onDay(e) { const day = Number(e.currentTarget.dataset.day); this.change({ weekdays: this.data.weekdays.includes(day) ? this.data.weekdays.filter(x => x !== day) : this.data.weekdays.concat(day) }); },
  onTime(e) { this.change({ time: e.detail.value }); },
  onClearTime() { this.change({ time: '' }); },
  onMore() { if (!this.data.busy && !this.data.adopting) this.setData({ moreOpen: !this.data.moreOpen }); },
  onPrivacy() { this.setData({ privacyOpen: !this.data.privacyOpen }); },
  onFieldFocus() { this.setData({ focusField: 'minutes' }); },
  onFieldBlur() { this.setData({ focusField: '' }); this.validateFields(false); },
  onConsent(e) { if (!this.data.busy && !this.data.adopting) this.setData({ consent: e.detail.value.includes('agree'), requestError: '' }); },
  validateFields(scroll = true) {
    const fieldErrors = {}, minutes = Number(this.data.minutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) fieldErrors.minutes = '请输入 1—60 的整数分钟';
    if (!this.data.weekdays.length) fieldErrors.weekdays = '至少选择一天';
    this.setData({ fieldErrors, moreOpen: this.data.moreOpen || !!fieldErrors.weekdays, customMinutes: this.data.customMinutes || !!fieldErrors.minutes });
    const first = Object.keys(fieldErrors)[0];
    if (first && scroll && wx.pageScrollTo) wx.pageScrollTo({ selector: '#field-' + first, duration: 200 });
    return !first;
  },
  showSuggestion(result) {
    this._suggestion = result;
    const request = this._request, context = ui.contextKey(), showVersion = this._showVersion;
    this.setData({ preview: result, requestError: '', schedule: ui.domain.weekdayText(result.draft.weekdays) + (result.draft.time ? ' · ' + result.draft.time : ' · 时间自定'),
      retryLabel: result.source === 'ai' ? '查看本次 AI 建议' : '生成 AI 建议' }, () => {
      if (request === this._request && ui.isCurrentView(this, context, showVersion) && wx.pageScrollTo) wx.pageScrollTo({ selector: '#plan-preview', duration: 200 });
    });
    this.updateAvailability();
  },
  onRules() {
    this.refresh();
    if (this.data.adopting || !this.validateFields()) return;
    this.invalidateRequest();
    try { this.showSuggestion(getApp().planAssistant.rules(validateInput(this.data))); }
    catch (err) { this.setData({ requestError: err.message }); }
  },
  async onDataRetry() {
    if (!this.data.needsCloudRefresh) return ui.recoveryActions.onDataRetry.call(this);
    if (this._retrying || this._gone || this._visible === false) return;
    const context = ui.contextKey(), showVersion = this._showVersion, session = getApp().cloudSession;
    this._retrying = true;
    this.setData({ loading: true, dataUnavailable: false, error: '' });
    try {
      if (!session || typeof session.start !== 'function') throw Error('云端账户暂时无法读取，请稍后重试');
      await session.start();
      if (this._gone || this._visible === false || this._showVersion !== showVersion) return;
      const info = ui.storageInfo();
      if (info.ready === true && !info.pending && !info.conflict && !info.deletionPending) {
        this.setData({ needsCloudRefresh: false, consent: false, requestError: '', retryLabel: '生成 AI 建议' });
      }
      // 成功读取可以取得新 epoch；refresh 负责清除旧账户输入与预览。
      this.refresh();
    } catch (err) {
      if (ui.isCurrentView(this, context, showVersion)) this.setData({ loading: false,
        requestError: '云端账户尚未确认，请稍后重新读取。基础方案仍可预览。' });
    } finally { this._retrying = false; }
  },
  async onGenerate() {
    this.refresh();
    if (this.data.busy || this.data.adopting || !this.validateFields()) return;
    this.updateAvailability();
    if (!this.data.consent) { this.setData({ requestError: '请先勾选本次发送同意，也可以直接查看基础方案' }); return; }
    if (!this.data.canGenerate) { this.setData({ requestError: this.data.serviceBusy ? 'AI仍在处理，可以先看基础方案' : this.data.blockedReason }); return; }
    const request = ++this._request, context = ui.contextKey(), showVersion = this._showVersion, day = ui.date.today();
    const current = () => request === this._request && day === ui.date.today() && ui.isCurrentView(this, context, showVersion);
    try {
      ui.assertContext(this); const input = validateInput(this.data);
      if (wx.hideKeyboard) wx.hideKeyboard({ fail() {} });
      this._suggestion = null; this.setData({ busy: true, preview: null, requestError: '' });
      const work = getApp().planAssistant.generate(input, true); this.updateAvailability();
      if (current() && wx.pageScrollTo) wx.pageScrollTo({ selector: '#ai-generation', duration: 200 });
      const result = await work;
      if (current()) this.showSuggestion(result);
    } catch (err) {
      if (current()) {
        const recoverCloud = cloudRecoveryCodes.includes(err.code);
        const known = recoverCloud || ['RATE_LIMITED', 'NOT_ENABLED', 'AI_PENDING', 'AI_UNAVAILABLE', 'AI_TIMEOUT'].includes(err.code);
        this.setData({ needsCloudRefresh: this.data.needsCloudRefresh || recoverCloud,
          consent: recoverCloud ? false : this.data.consent,
          requestError: known ? err.message : '暂未收到可用的 AI 结果。输入已保留，可先看基础方案或核对这次结果',
          retryLabel: !known || ['AI_PENDING', 'AI_TIMEOUT'].includes(err.code) ? '核对这次 AI 结果' : '再次查看 AI 结果' });
      }
    } finally { if (current()) { this.setData({ busy: false }); this.updateAvailability(); } }
  },
  onAdopt() {
    this.refresh();
    if (this.data.busy || this.data.adopting || !this._suggestion) return;
    this.updateAvailability();
    if (!this.data.canAdopt) { this.setData({ requestError: this.data.capacityFull ? this.data.capacityNote : '请先恢复云端记录，再确认创建。方案已保留。' }); return; }
    const context = ui.contextKey(), showVersion = this._showVersion;
    try {
      ui.assertContext(this); ui.assertWritable();
      const token = getApp().planAssistant.handoff(this._suggestion, context);
      this.setData({ adopting: true, requestError: '' });
      wx.navigateTo({ url: '/pages/edit/index?draft=' + encodeURIComponent(token),
        fail: () => { if (ui.isCurrentView(this, context, showVersion)) this.setData({ adopting: false, requestError: '确认页未打开，请重试。习惯尚未创建。' }); } });
    } catch (err) { this.setData({ adopting: false, requestError: err.message }); }
  },
  onManage() { wx.navigateTo({ url: '/pages/manage/index' }); },
  onSync() { wx.navigateTo({ url: '/pages/sync/index' }); }
}));

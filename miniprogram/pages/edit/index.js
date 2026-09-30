const ui = require('../../services/ui');
const form = require('../../services/plan-form');
const flow = require('../../services/today-flow');
const templates = {
  read: { title: '读一会儿', target: '5', minimum: '2' },
  walk: { title: '走路一会儿', target: '10', minimum: '3' },
  study: { title: '复习一小段', target: '5', minimum: '2' },
  tidy: { title: '整理桌面', target: '3', minimum: '1' }
};

Page(ui.withLifecycle({
  data: { error: '', loading: true, dataUnavailable: false, dataReady: false, dataReadOnly: false,
    pendingConfirm: false, recoveryLabel: '重新读取',
    editing: false, compact: false, saving: false, title: '', target: '5', minimum: '', unit: '分钟', units: ['分钟', '页', '次'],
    time: '', weekdays: [1, 2, 3, 4, 5, 6, 7], days: [], startOffset: 0, firstLabel: '', effectiveLabel: '', source: '',
    moreOpen: false, frequencyOpen: false, startOpen: false, addingMinimum: false, keyboardOpen: false, focusField: '',
    canCreateToday: true, capacityNote: '', fieldErrors: {}, titleCount: 0, targetHint: '', frequencyLabel: '', moreSummary: '' },
  onLoad(options = {}) {
    this._id = options.id || ui.id();
    this._loaded = false;
    this._editContext = ui.contextKey();
    // 模板、有效助手草稿和有效分享草稿进入紧凑确认；自定义和编辑保留完整表单。
    const compact = !options.id && !!(options.template || options.draft || options.sharedDraft);
    this.setData({ editing: !!options.id, compact });
    if (!options.id && options.start === 'tomorrow') this.setData({ startOffset: 1 });
    if (options.sharedDraft) {
      try {
        if (options.id || options.draft || options.template) throw Error('分享草稿不能覆盖已有计划或其他草稿');
        const plan = require('../../services/features-client').features().consume(options.sharedDraft);
        this.setData({ ...plan, target: String(plan.target), minimum: String(plan.minimum),
          addingMinimum: plan.minimum != null, source: '来自公开轻计划 · 请核对后创建自己的习惯' });
      } catch (err) { this._invalidDraft = true; ui.error(this, err); }
    }
    if (options.draft) {
      try {
        if (options.id) throw Error('新计划草稿不能直接覆盖已有习惯');
        const result = getApp().planAssistant.consume(options.draft, this._editContext);
        const draft = result.draft;
        this.setData({ title: draft.title, target: String(draft.target), minimum: draft.minimum == null ? '' : String(draft.minimum),
          unit: draft.unit, weekdays: draft.weekdays, time: draft.time, addingMinimum: draft.minimum != null,
          source: (result.source === 'ai' ? 'AI建议 · 请自行核对' : '基础建议 · 本机规则，非AI') + '。' + draft.action });
      } catch (err) { this._invalidDraft = true; ui.error(this, err); }
    }
    if (templates[options.template]) this.setData({ ...templates[options.template] });
    if (options.id) wx.setNavigationBarTitle({ title: '编辑习惯' });
    else if (compact) wx.setNavigationBarTitle({ title: '确认新习惯' });
    this.refresh();
  },
  refresh() {
    ui.read(this, state => {
      if (this.data.editing && !this._loaded) {
        const habit = ui.domain.findHabit(state, this._id);
        const plan = habit.versions[habit.versions.length - 1];
        this._baseRevision = habit.revision;
        this.setData({ title: plan.title, target: String(plan.target), minimum: plan.minimum == null ? '' : String(plan.minimum),
          unit: plan.unit, time: plan.time, weekdays: plan.weekdays, addingMinimum: plan.minimum != null });
        this._loaded = true;
      }
      if (!this.data.editing) {
        // 今天容量已满时明确从明天开始，不静默改日期；提交冲突仍由领域层拒绝。
        const capacity = flow.creationAvailability(state, ui.date.today());
        const forced = !capacity.today && capacity.tomorrow;
        this.setData({ canCreateToday: capacity.today,
          capacityNote: forced ? '今天的 5 个位置已满，这个习惯从明天开始。' : '',
          startOffset: forced ? 1 : this.data.startOffset });
      }
    });
    this.updateSchedule();
  },
  updateSchedule() {
    const date = ui.date.today();
    const start = ui.date.shift(date, this.data.editing ? 1 : this.data.startOffset);
    const days = [1, 2, 3, 4, 5, 6, 7].map(value => ({ value, label: '一二三四五六日'[value - 1], selected: this.data.weekdays.includes(value) }));
    this.setData({ days, ...form.presentation(this.data), effectiveLabel: ui.date.label(start),
      firstLabel: this.data.weekdays.length ? ui.date.label(ui.domain.firstExecution(this.data, start)) : '至少选择一个星期' });
  },
  onInput(event) {
    if (this.data.saving) return;
    const field = event.currentTarget.dataset.field;
    if (!['title', 'target', 'minimum'].includes(field)) return;
    const value = field === 'title' ? Array.from(event.detail.value).slice(0, 20).join('') : event.detail.value;
    this.setData({ [field]: value, error: '' });
    this.updateSchedule(); this.validateField(field);
    if (field === 'target') this.validateField('minimum');
    return value;
  },
  validateField(field) { const errors = form.fields(this.data); this.setData({ fieldErrors: { ...this.data.fieldErrors, [field]: errors[field] || '' } }); },
  onBlur(event) { const field = event.currentTarget.dataset.field; this.validateField(field); if (this.data.focusField === field) this.setData({ focusField: '' }); },
  onFocus(event) { const field = event.currentTarget.dataset.field; if (field) this.setData({ focusField: field }); },
  // 键盘高度变化（基础库 2.7.0+）决定底栏固定或随内容流，避免遮挡输入。
  onKeyboard(event) { const height = event.detail && event.detail.height || 0; this.setData({ keyboardOpen: height > 0 }); },
  onMore() { if (!this.data.saving) this.setData({ moreOpen: !this.data.moreOpen }); },
  onToggleFrequency() { if (!this.data.saving) this.setData({ frequencyOpen: !this.data.frequencyOpen }); },
  onToggleStart() { if (!this.data.saving) this.setData({ startOpen: !this.data.startOpen }); },
  onAddMinimum() { if (!this.data.saving) this.setData({ addingMinimum: true }); },
  onRemoveMinimum() { if (!this.data.saving) { this.setData({ minimum: '', addingMinimum: false, fieldErrors: { ...this.data.fieldErrors, minimum: '' } }); this.updateSchedule(); } },
  onUnit(event) { if (this.data.saving) return; this.setData({ unit: this.data.units[Number(event.detail.value)] }); this.updateSchedule(); this.validateField('target'); this.validateField('minimum'); },
  onTime(event) { if (this.data.saving) return; this.setData({ time: event.detail.value }); this.updateSchedule(); },
  clearTime() { if (this.data.saving) return; this.setData({ time: '' }); this.updateSchedule(); },
  onDay(event) {
    if (this.data.saving) return;
    const value = Number(event.currentTarget.dataset.day);
    const selected = this.data.weekdays;
    this.setData({ weekdays: selected.includes(value) ? selected.filter(n => n !== value) : selected.concat(value).sort(), error: '' });
    this.updateSchedule(); this.validateField('weekdays');
  },
  onFrequency(event) {
    if (this.data.saving) return;
    this.setData({ weekdays: event.currentTarget.dataset.kind === 'work' ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 6, 7] });
    this.updateSchedule(); this.validateField('weekdays');
  },
  onStart(event) { if (this.data.saving) return; this.setData({ startOffset: Number(event.currentTarget.dataset.offset) }); this.updateSchedule(); },
  onSave() {
    if (this.data.saving) return;
    if (this.data.dataReadOnly) { ui.error(this, Error('暂时无法更新，请连接网络后重试')); return; }
    // 提交前收起键盘：不依赖键盘覆盖下的按钮完成操作。
    if (typeof wx.hideKeyboard === 'function') wx.hideKeyboard({ fail() {} });
    this.setData({ saving: true, error: '', keyboardOpen: false });
    let firstGuide = null;
    const finish = () => {
      if (this._gone) return;
      this.setData({ saving: false });
      if (this.data.editing) wx.navigateBack();
      else {
        if (firstGuide) getApp().firstHabitGuide = firstGuide;
        wx.switchTab({ url: '/pages/today/index' });
      }
      wx.showToast({ title: this.data.editing ? '已保存，明天生效' : '已创建', icon: 'none' });
    };
    const failed = err => { if (!this._gone) { ui.error(this, err); this.setData({ saving: false }); } };
    try {
      if (this._invalidDraft) throw Error('计划草稿已失效，请返回重新预览，未创建任何习惯');
      if (this._editContext !== ui.contextKey()) throw Error('数据状态已变化，请返回后重新打开表单');
      const fieldErrors = form.fields(this.data), first = Object.keys(fieldErrors)[0];
      if (first) {
        this.setData({ fieldErrors, moreOpen: this.data.moreOpen || !!fieldErrors.time,
          frequencyOpen: this.data.frequencyOpen || first === 'weekdays', addingMinimum: this.data.addingMinimum || first === 'minimum' }, () => {
          if (!this._gone && this._visible !== false && wx.pageScrollTo) wx.pageScrollTo({ selector: '#field-' + first, duration: 200 });
        });
        throw Error(fieldErrors[first]);
      }
      const plan = ui.domain.validatePlan(this.data);
      const startDate = ui.date.shift(ui.date.today(), this.data.startOffset);
      if (!this.data.editing && !ui.store().read().habits.length) firstGuide = {
        id: this._id, title: plan.title, firstDate: ui.domain.firstExecution(plan, startDate)
      };
      const command = this.data.editing
        ? { type: 'edit', id: this._id, baseRevision: this._baseRevision, plan }
        : { type: 'create', id: this._id, startDate, plan };
      const result = ui.store().dispatch(command);
      if (result && typeof result.then === 'function') return result.then(finish).catch(failed);
      finish();
    } catch (err) { failed(err); }
  }
}));

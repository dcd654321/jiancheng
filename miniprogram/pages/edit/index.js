const ui = require('../../services/ui');
const form = require('../../services/plan-form');
const flow = require('../../services/today-flow');
const { createFormDrafts } = require('../../services/form-drafts');
const draftFields = ['title', 'target', 'minimum', 'unit', 'time', 'weekdays', 'startOffset', 'addingMinimum', 'minimumVisible'];
const inputSnapshot = data => draftFields.reduce((result, key) => { result[key] = data[key]; return result; }, {});
function drafts() { const app = getApp(); return app.formDrafts || (app.formDrafts = createFormDrafts()); }
const { templatePlan } = require('../../config/habit-templates');

Page(ui.withLifecycle({
  data: { error: '', loading: true, dataUnavailable: false, dataReady: false, dataReadOnly: false,
    pendingConfirm: false, recoveryLabel: '重新读取',
    editing: false, compact: false, saving: false, title: '', target: '5', minimum: '', unit: '分钟', units: ['分钟', '页', '次'],
    time: '', weekdays: [1, 2, 3, 4, 5, 6, 7], days: [], startOffset: 0, startOptions: [], startIndex: 0, firstLabel: '', effectiveLabel: '', source: '',
    moreOpen: false, frequencyOpen: false, startOpen: false, addingMinimum: false, minimumVisible: true, keyboardOpen: false, focusField: '',
    canCreateToday: true, canCreateTomorrow: true, capacityFull: false, confirmedCreate: false, capacityNote: '', fieldErrors: {}, titleCount: 0, targetHint: '', frequencyLabel: '', moreSummary: '', draftDirty: false, draftRestored: false },
  onLoad(options = {}) {
    this._id = options.id || ui.id();
    this._loaded = false;
    this._editContext = ui.contextKey();
    this._draftScope = this._editContext + ':' + ui.date.today();
    this._draftKey = options.id ? 'edit:' + options.id : 'new:' + (options.template || options.sharedDraft || 'custom');
    this._contextBound = !!options.sharedDraft;
    // 模板和有效分享草稿进入紧凑确认；自定义和编辑保留完整表单。
    const compact = !options.id && !!(options.template || options.sharedDraft);
    this.setData({ editing: !!options.id, compact });
    if (!options.id && options.start === 'tomorrow') this.setData({ startOffset: 1 });
    if (options.draft) {
      this._invalidDraft = true;
      this._draftError = '该入口已停用，请返回今日添加习惯';
      ui.error(this, Error(this._draftError));
    } else if (options.sharedDraft) {
      try {
        if (options.id || options.draft || options.template) throw Error('分享草稿不能覆盖已有计划或其他草稿');
        const plan = require('../../services/features-client').features().consume(options.sharedDraft);
        this.setData({ ...plan, target: String(plan.target), minimum: String(plan.minimum),
          addingMinimum: plan.minimum != null, source: '来自公开轻计划 · 请核对后创建自己的习惯' });
      } catch (err) { this._invalidDraft = true; ui.error(this, err); }
    }
    const template = templatePlan(options.template);
    if (template) this.setData(template);
    if (!this._invalidDraft && options.sharedDraft) {
      // 每次分享草稿令牌不同；同一内容可接续，换计划则使用独立草稿。
      this._draftKey = 'new:shared:' + JSON.stringify({ input: inputSnapshot(this.data), source: this.data.source });
    }
    if (options.id) wx.setNavigationBarTitle({ title: '编辑习惯' });
    else if (compact) wx.setNavigationBarTitle({ title: '确认新习惯' });
    this.refresh();
  },
  refresh() {
    ui.read(this, state => {
      const context = ui.contextKey();
      if (this._contextBound && (this._editContext !== context || this._draftScope !== context + ':' + ui.date.today())) {
        drafts().read(context + ':' + ui.date.today(), this._draftKey);
        this._draftInitialized = false; this._invalidDraft = true;
        this.setData({ title: '', target: '', minimum: '', weekdays: [], time: '', source: '', fieldErrors: {}, focusField: '', draftDirty: false, draftRestored: false });
        throw Error('数据状态已变化，请返回后重新打开表单');
      }
      if (!this._contextBound) { this._editContext = context; this._draftScope = context + ':' + ui.date.today(); this._contextBound = true; }
      if (this.data.editing && !this._loaded) {
        const habit = ui.domain.findHabit(state, this._id);
        const plan = habit.versions[habit.versions.length - 1];
        this._baseRevision = habit.revision;
        this.setData({ title: plan.title, target: String(plan.target), minimum: plan.minimum == null ? '' : String(plan.minimum),
          unit: plan.unit, time: plan.time, weekdays: plan.weekdays, addingMinimum: plan.minimum != null });
        this._loaded = true;
      }
      this.updateCapacity(state);
      if (!this._invalidDraft) {
        const saved = drafts().read(this._draftScope, this._draftKey);
        if (!this._draftInitialized || (saved && saved.version > (this._draftVersion || 0))) {
          if (!this._draftInitialized) this._cleanInput = inputSnapshot(this.data);
          if (saved) {
            this._id = saved.value.id; this._baseRevision = saved.value.baseRevision;
            this._cleanInput = saved.value.clean;
            this._saveAttempted = saved.value.saveAttempted;
            this._draftVersion = saved.version;
            this.setData({ ...saved.value.input, draftRestored: true, draftDirty: true });
          }
          this._draftInitialized = true;
        }
      }
      // 接续的草稿也按当前容量核对，系统选择可用日期不算用户修改。
      this.updateCapacity(state);
    });
    if (this.data.dataReady && this._draftError) ui.error(this, Error(this._draftError));
    this.updateSchedule();
  },
  updateCapacity(state) {
    if (this.data.editing) return;
    const capacity = flow.creationAvailability(state, ui.date.today());
    const confirmedCreate = state.habits.some(habit => habit.id === this._id);
    const forced = !confirmedCreate && !capacity.today && capacity.tomorrow;
    const startOptions = [0, 1].filter(offset => offset === 0 ? capacity.today : capacity.tomorrow).map(offset => ({ offset,
      label: (offset ? '明天' : '今天') + ' · ' + ui.date.shortLabel(ui.date.shift(ui.date.today(), offset)) }));
    if (forced && this._cleanInput) this._cleanInput.startOffset = 1;
    this.setData({ canCreateToday: capacity.today, canCreateTomorrow: capacity.tomorrow, startOptions,
      startIndex: Math.max(0, startOptions.findIndex(option => option.offset === (forced ? 1 : this.data.startOffset))),
      capacityFull: !capacity.today && !capacity.tomorrow, confirmedCreate,
      capacityNote: confirmedCreate ? '这个习惯已创建。核对后可返回今日；修改已有计划请进入习惯详情。'
        : !capacity.today && !capacity.tomorrow ? '已有 5 个进行中的习惯，调整一个后再创建。'
        : forced ? '今天的 5 个位置已满，这个习惯从明天开始。' : '',
      startOffset: forced ? 1 : this.data.startOffset });
  },
  onManage() { wx.navigateTo({ url: '/pages/manage/index' }); },
  updateSchedule() {
    const date = ui.date.today();
    const start = ui.date.shift(date, this.data.editing ? 1 : this.data.startOffset);
    const days = [1, 2, 3, 4, 5, 6, 7].map(value => ({ value, label: '一二三四五六日'[value - 1], selected: this.data.weekdays.includes(value) }));
    const first = this.data.weekdays.length ? ui.domain.firstExecution(this.data, start) : null;
    this.setData({ days, ...form.presentation(this.data), effectiveLabel: ui.date.label(start),
      showStartSummary: this.data.editing || !first || first !== start,
      firstLabel: first ? ui.date.label(first) : '至少选择一个星期' });
    this.keepDraft();
  },
  keepDraft() {
    if (!this._draftInitialized || this._saved || this._invalidDraft || this._gone || this._visible === false || this._draftScope !== ui.contextKey() + ':' + ui.date.today()) return;
    const saved = drafts().read(this._draftScope, this._draftKey);
    if (saved && saved.version > (this._draftVersion || 0)) return;
    const input = inputSnapshot(this.data), dirty = !!this._saveAttempted || JSON.stringify(input) !== JSON.stringify(this._cleanInput);
    this.setData({ draftDirty: dirty });
    if (dirty) {
      const version = drafts().set(this._draftScope, this._draftKey, { input, clean: this._cleanInput, id: this._id, baseRevision: this._baseRevision, saveAttempted: !!this._saveAttempted }, this._draftVersion || 0);
      if (version != null) this._draftVersion = version;
    } else {
      drafts().remove(this._draftScope, this._draftKey, this._draftVersion || 0);
      this._draftVersion = undefined;
    }
  },
  onHide() { this.keepDraft(); },
  onUnload() { this.keepDraft(); },
  onCopyDraft() {
    if (this._draftScope !== ui.contextKey() + ':' + ui.date.today()) return;
    const context = ui.contextKey(), showVersion = this._showVersion;
    wx.setClipboardData({ data: `${this.data.title || '未命名习惯'}\n平时 ${this.data.target || '未填写'} ${this.data.unit}\n忙时 ${this.data.minimum || '未设置'} ${this.data.unit}\n${ui.domain.weekdayText(this.data.weekdays)}${this.data.time ? ' · ' + this.data.time : ''}`,
      fail: () => { if (ui.isCurrentView(this, context, showVersion)) ui.error(this, Error('复制未完成，输入仍在本页，可以重试')); } });
  },
  onDiscardDraft() {
    if (this.data.saving || !this.data.draftDirty) return;
    const context = ui.contextKey(), showVersion = this._showVersion, version = this._draftVersion;
    wx.showModal({ title: '放弃未保存的修改？', content: '恢复进入表单时的内容，已保存的计划不会改变。' + (this._saveAttempted ? '不会撤回已发送的操作；结果请到云端状态核对。' : ''), confirmText: '放弃修改',
      success: result => { if (result.confirm && ui.isCurrentView(this, context, showVersion) && version === this._draftVersion) {
        drafts().remove(this._draftScope, this._draftKey, version); this._draftVersion = undefined; this._saveAttempted = false; this.setData({ ...this._cleanInput, draftDirty: false, draftRestored: false, error: '', fieldErrors: {} }); this.refresh();
      } } });
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
  onStartPicker(event) { const option = this.data.startOptions[Number(event.detail.value)]; if (option) this.onStart({ currentTarget: { dataset: { offset: option.offset } } }); },
  onAddMinimum() { if (!this.data.saving) { this.setData({ addingMinimum: true }); this.keepDraft(); } },
  onBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/today/index' }) }); },
  onToggleMinimum(event) {
    if (this.data.saving) return;
    const minimumVisible = event.detail.value === true;
    this.setData({ minimumVisible });
    if (!minimumVisible) this.onRemoveMinimum();
    else this.onAddMinimum();
  },
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
  onStart(event) {
    if (this.data.saving) return;
    const offset = Number(event.currentTarget.dataset.offset);
    if (![0, 1].includes(offset) || (offset === 0 ? !this.data.canCreateToday : !this.data.canCreateTomorrow)) return;
    this.setData({ startOffset: offset, startIndex: Math.max(0, this.data.startOptions.findIndex(option => option.offset === offset)) }); this.updateSchedule();
  },
  onSave() {
    if (this.data.saving) return;
    if (this.data.dataReadOnly) { ui.error(this, Error('暂时无法更新，请连接网络后重试')); return; }
    // 提交前收起键盘：不依赖键盘覆盖下的按钮完成操作。
    if (typeof wx.hideKeyboard === 'function') wx.hideKeyboard({ fail() {} });
    this.setData({ saving: true, error: '', keyboardOpen: false });
    const context = ui.contextKey(), showVersion = this._showVersion;
    this.keepDraft();
    let draftVersion = this._draftVersion;
    const draftScope = this._draftScope, draftKey = this._draftKey;
    let firstGuide = null;
    const finish = () => {
      if (draftVersion != null) drafts().remove(draftScope, draftKey, draftVersion);
      if (ui.isCurrentView(this, context, showVersion)) this._saved = true;
      if (this._gone) return;
      this.setData({ saving: false });
      if (!ui.isCurrentView(this, context, showVersion)) return;
      if (this.data.editing) wx.navigateBack();
      else {
        if (firstGuide) getApp().firstHabitGuide = firstGuide;
        wx.switchTab({ url: '/pages/today/index' });
      }
      wx.showToast({ title: this.data.editing ? '已保存，明天生效' : '已创建', icon: 'none' });
    };
    const failed = err => { if (!this._gone) this.setData({ saving: false }); if (ui.isCurrentView(this, context, showVersion)) ui.error(this, err); };
    try {
      if (this._invalidDraft) throw Error(this._draftError || '计划草稿已失效，请返回重新预览，未创建任何习惯');
      if (this._editContext !== ui.contextKey() || this._draftScope !== ui.contextKey() + ':' + ui.date.today()) {
        this.refresh();
        throw Error('数据状态已变化，请返回后重新打开表单');
      }
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
      const state = ui.store().read();
      const existing = !this.data.editing && state.habits.find(habit => habit.id === this._id);
      if (existing) {
        const saved = existing.versions[existing.versions.length - 1];
        const samePlan = ['title', 'target', 'minimum', 'unit', 'time', 'weekdays'].every(field =>
          JSON.stringify(saved[field]) === JSON.stringify(plan[field]));
        if (!samePlan || existing.versions.length !== 1 || saved.status !== 'active' || saved.effectiveDate !== startDate) {
          throw Error('这个习惯已创建，当前修改尚未保存。请返回今日，从习惯详情修改计划。');
        }
        finish(); return;
      }
      if (!this.data.editing && !state.habits.length) firstGuide = {
        id: this._id, title: plan.title, firstDate: ui.domain.firstExecution(plan, startDate), context
      };
      const command = this.data.editing
        ? { type: 'edit', id: this._id, baseRevision: this._baseRevision, plan }
        : { type: 'create', id: this._id, startDate, plan };
      this._saveAttempted = true; this.keepDraft(); draftVersion = this._draftVersion;
      const result = ui.store().dispatch(command);
      if (result && typeof result.then === 'function') return result.then(finish).catch(failed);
      finish();
    } catch (err) { failed(err); }
  }
}));

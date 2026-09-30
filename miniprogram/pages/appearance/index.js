const ui = require('../../services/ui');
const { appearanceController } = require('../../services/appearance');

const OPTIONS = [
  { key: 'mist', name: '薄雾绿', desc: '接近自然光的浅灰绿，清爽安静，适合每天短时记录。' },
  { key: 'paper', name: '暖纸白', desc: '略暖的米白纸面，颜色更温和，适合偏好纸面阅读。' }
];

function optionsFor(preview, savedTheme) {
  return OPTIONS.map(option => ({
    ...option,
    selected: option.key === preview,
    badge: option.key === savedTheme ? '使用中' : option.key === preview ? '预览中' : ''
  }));
}

Page(ui.withLifecycle({
  data: { error: '', loading: false, dataReady: true,
    enabled: false, theme: 'mist', preview: 'mist', savedTheme: 'mist', hasRevision: false,
    pendingTheme: '', saving: false, saveError: '', offline: false,
    options: optionsFor('mist', 'mist'), primaryLabel: '正在使用', primaryDisabled: true, statusNote: '',
    quickMinimumEnabled: ui.quickMinimumEnabled },
  onLoad() {
    const controller = appearanceController();
    if (controller) this._unsubscribe = controller.subscribe(() => { if (!this._gone && this._visible !== false) this.syncView(); });
  },
  onShow() {
    const controller = appearanceController();
    if (controller) controller.ensureRead();
    this.syncView();
  },
  onUnload() { if (this._unsubscribe) this._unsubscribe(); this._unsubscribe = null; },
  onHide() { this.setData({ saving: false }); },
  // 不需要习惯数据：主题读取失败也不阻塞本页预览和核心任务。
  refresh() { this.syncView(); },
  syncView() {
    const controller = appearanceController();
    if (!controller) { this.setData({ enabled: false, options: optionsFor('mist', 'mist') }); return; }
    const view = controller.view();
    // 账户上下文变化时清空预览；同一账户内保存成功或冲突读取都不丢弃用户的选择。
    if (this._viewKey !== view.key) { this._viewKey = view.key; this._preview = null; }
    if (view.pendingTheme && !this._preview) this._preview = view.pendingTheme;
    const preview = this._preview || view.theme;
    if (!view.enabled) {
      this.setData({ enabled: false, theme: view.theme, preview: view.theme, savedTheme: view.theme,
        options: optionsFor(view.theme, view.theme) });
      return;
    }
    const hasRevision = view.revision !== null && view.revision !== undefined;
    const pending = !!view.pendingTheme;
    const offline = this.isOffline();
    const usingSaved = preview === view.theme && !pending;
    const option = OPTIONS.find(item => item.key === preview) || OPTIONS[0];
    let statusNote = '';
    if (pending) statusNote = '主题保存结果待核对，请点“重新核对”确认，不会重复保存。';
    else if (this.data.saving) statusNote = '';
    else if (offline) statusNote = '连接网络后可保存主题；现在可以先预览。';
    else if (!hasRevision) statusNote = '主题暂未读取，可稍后重试；预览仍可使用，读取成功后才能保存。';
    else if (!usingSaved) statusNote = '当前是预览，点下面的按钮保存到云端。';
    this.setData({ enabled: true, theme: preview, savedTheme: view.theme, preview, hasRevision,
      pendingTheme: view.pendingTheme || '', offline, options: optionsFor(preview, view.theme),
      primaryLabel: this.data.saving ? '正在保存…' : pending ? '重新核对' : usingSaved ? '正在使用' : '使用' + option.name,
      primaryDisabled: this.data.saving || usingSaved || (!pending && (!hasRevision || offline)),
      statusNote });
  },
  isOffline() {
    try {
      const status = getApp().cloudSession.status();
      return status.networkOffline === true || status.phase === 'offline' || this.data.pendingConfirm === true;
    } catch (_) { return false; }
  },
  onPick(event) {
    if (this.data.saving) return;
    const key = event.currentTarget.dataset.theme;
    if (!OPTIONS.some(option => option.key === key)) return;
    this._preview = key;
    this.setData({ saveError: '' });
    this.syncView();
  },
  async onApply() {
    if (this.data.saving || this.data.primaryDisabled) return;
    const controller = appearanceController();
    if (!controller) return;
    const preview = this.data.preview;
    this.setData({ saving: true, saveError: '' });
    try {
      if (this.data.pendingTheme) await controller.replay();
      else await controller.save(preview);
      if (!this._gone) {
        this._preview = null;
        this.setData({ saving: false });
        this.syncView();
        if (this._visible !== false) wx.showToast({ title: '已切换为' + (this.data.savedTheme === 'paper' ? '暖纸白' : '薄雾绿'), icon: 'none' });
      }
    } catch (err) {
      if (this._gone) return;
      const view = controller.view();
      const message = err.code === 'CONFLICT'
        ? '主题设置已在其他设备更新，已读取当前主题；请确认后再应用。'
        : err.message || '主题未保存，请重试';
      this.setData({ saving: false, saveError: message });
      this.syncView();
      // 明确冲突：读取当前值但不覆盖，保留用户预览，下一次点击才产生新请求。
      if (err.code === 'CONFLICT') controller.ensureRead(true).catch(() => {});
      if (this.data.pendingTheme) this._preview = preview;
    }
  },
  onReload() {
    const controller = appearanceController();
    if (controller) controller.ensureRead(true);
    this.syncView();
  },
  onBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/today/index' }) }); }
}));

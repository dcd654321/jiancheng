const ui = require('../../services/ui');
const { media } = require('../../services/media-client');
const { createPhotoCheckin } = require('../../services/photo-checkin');
const LABELS = { pending: '照片处理中', pass: '已检查', review: '照片暂不能展示，请更换', risky: '照片未通过检查，请更换', failed: '照片检查失败，请更换' };
Page(ui.withLifecycle({
  data: { loading: true, dataReady: false, dataUnavailable: false, enabled: false, error: '', busy: false,
    date: '', record: null, images: [], selectedIds: [], editable: false, photoItems: [], photoBusy: false, photoError: '', photoCanSubmit: false },
  onLoad(options = {}) { this._input = options.supervisionId ? { supervisionId: options.supervisionId, date: options.date } : { habitId: options.habitId, date: options.date }; },
  refresh() {
    const context = ui.contextKey();
    if (this._mediaContext && this._mediaContext !== context) this.setData({ record: null, images: [], selectedIds: [], photoItems: [], photoError: '', editable: false });
    this._mediaContext = context; this.setData({ enabled: media().status().enabled }); ui.read(this, () => {});
  },
  async onShow() {
    const version = this._showVersion; try { await Promise.resolve(getApp().dataReady); } catch (_) {}
    if (this._gone || !this._visible || version !== this._showVersion) return;
    this.refresh(); if (this.data.enabled && this.data.dataReady) return this.load();
  },
  async load() {
    if (this._mediaBusy) return;
    const context = ui.contextKey(), version = this._showVersion; this._mediaBusy = true; this.setData({ busy: true, error: '' });
    try {
      ui.date.assertDate(this._input.date);
      const record = await media().record(this._input);
      if (!ui.isCurrentView(this, context, version)) return;
      this.present(record);
      if (this.data.editable) this.controller().open({ id: this._input.habitId, date: this._input.date, title: '补充打卡照片', photoRequired: record.photoRequired }, 'complete');
    } catch (err) { if (ui.isCurrentView(this, context, version)) ui.error(this, err); }
    finally { this._mediaBusy = false; if (ui.isCurrentView(this, context, version)) this.setData({ busy: false }); }
  },
  present(record) {
    this.setData({ record, date: record.date, selectedIds: record.items.map(item => item.mediaId),
      images: record.items.map(item => ({ ...item, label: LABELS[item.status] || '照片状态待核对', removed: false })),
      editable: !!this._input.habitId && this._input.date === ui.date.today() && ['standard', 'minimum'].includes(record.recordStatus) });
  },
  controller() {
    if (!this._photoEditor) this._photoEditor = createPhotoCheckin({ wx, media: media(), context: ui.contextKey, today: ui.date.today,
      visible: () => !this._gone && this._visible !== false, change: value => this.setData(value),
      maxCount: () => Math.max(0, 3 - this.data.selectedIds.length), pending: () => false,
      dispatch: async command => {
        ui.assertContext(this); ui.assertWritable();
        const context = ui.contextKey(), version = this._showVersion;
        const ids = this.data.selectedIds.concat(command.mediaIds); if (ids.length > 3) throw Error('最多保留3张照片，请先删掉一张');
        const result = await media().update({ ...this._input, expectedRevision: this.data.record.revision, mediaIds: ids });
        if (ui.isCurrentView(this, context, version) && this._input.date === ui.date.today()) this.present(result);
        return true;
      }, retry: async () => false });
    return this._photoEditor;
  },
  onRefresh() { return this.load(); },
  async onDataRetry() { await ui.recoveryActions.onDataRetry.call(this); if (this.data.enabled && this.data.dataReady) return this.load(); },
  onChoosePhotos() { if (this.data.editable && !this.data.busy) { try { ui.assertContext(this); ui.assertWritable(); const controller = this.controller(); controller.open({ id: this._input.habitId, date: this._input.date, title: '补充打卡照片', photoRequired: this.data.record.photoRequired }, 'complete'); controller.choose(); } catch (err) { ui.error(this, err); } } },
  onRetryPhotos() { return this.controller().upload(); },
  onRemoveNew(event) { this.controller().remove(event.currentTarget.dataset.id); },
  onSavePhotos() { return this.controller().submit(); },
  onTogglePhoto(event) {
    if (!this.data.editable || this.data.busy || this.data.photoBusy) return;
    const id = event.currentTarget.dataset.id, selectedIds = this.data.selectedIds.includes(id) ? this.data.selectedIds.filter(value => value !== id) : this.data.selectedIds.concat(id);
    this.setData({ selectedIds, images: this.data.images.map(item => ({ ...item, removed: !selectedIds.includes(item.mediaId) })) });
  },
  onSaveRemoval() {
    if (!this.data.editable || this.data.busy || this.data.photoBusy || !this.data.record || this.data.photoItems.length) return;
    const context = ui.contextKey(), version = this._showVersion, ids = this.data.selectedIds.slice();
    const save = async confirmation => {
      if (!ui.isCurrentView(this, context, version)) return;
      this.setData({ busy: true, error: '' }); this._mediaBusy = true;
      try { const result = await media().update({ ...this._input, expectedRevision: this.data.record.revision, mediaIds: ids, ...(confirmation ? { confirmation } : {}) }); if (ui.isCurrentView(this, context, version)) this.present(result); }
      catch (err) { if (ui.isCurrentView(this, context, version)) ui.error(this, err); }
      finally { this._mediaBusy = false; if (ui.isCurrentView(this, context, version)) this.setData({ busy: false }); }
    };
    if (!ids.length && this.data.record.photoRequired) wx.showModal({ title: '删除最后一张并撤销打卡？', content: '这项约定要求照片。删除最后一张会同时撤销今天的打卡；可先添加新照片再替换。', confirmText: '删除并撤销', success: result => { if (result.confirm) save('REMOVE_LAST_PHOTO_AND_UNDO'); } });
    else return save();
  },
  onToday() { wx.switchTab({ url: '/pages/today/index' }); },
  onPreviewPhoto(event) {
    const item = this.data.images.find(image => image.mediaId === event.currentTarget.dataset.id);
    if (!item || !item.url) return;
    if (Date.parse(item.expiresAt) <= Date.now()) { this.setData({ error: '照片链接已过期，刷新后可继续查看' }); return this.load(); }
    wx.previewImage({ current: item.url, urls: this.data.images.filter(image => image.url).map(image => image.url) });
  }
}));

'use strict';

const ui = require('./ui');
const media = () => getApp().mediaClient || require('./media-client').media();
const supervision = () => getApp().supervisionClient || require('./supervision-client').supervision();
const photoData = { photoOpen: false, photoTitle: '', photoRequired: false, photoBusy: false, photoError: '', photoItems: [], photoCanSubmit: false, photoPending: false };
const actions = {
  startPhotoCheckin() {
    if (this._photoCheckin) this.setData(this._photoCheckin.view());
    if (this._unsubscribePhoto) this._unsubscribePhoto();
    const session = getApp().cloudSession;
    if (session && typeof session.subscribeConfirmed === 'function') this._unsubscribePhoto = session.subscribeConfirmed(event => {
      if (this._photoCheckin) this._photoCheckin.confirmed(event);
    });
  },
  stopPhotoCheckin() {
    if (this._unsubscribePhoto) this._unsubscribePhoto();
    this._unsubscribePhoto = null;
    this.setData({ photoOpen: false });
  },
  photoController() {
    if (!this._photoCheckin) this._photoCheckin = require('./photo-checkin').createPhotoCheckin({ wx, media: media(), context: ui.contextKey, today: ui.date.today,
      visible: () => !this._gone && this._visible !== false, change: value => this.setData(value), pending: () => ui.storageInfo().pending > 0,
      dispatch: command => ui.mutate(this, command), retry: async () => { await getApp().cloudSession.retry(); return !ui.storageInfo().pending; } });
    return this._photoCheckin;
  },
  openPhotoCheckin(task, type) {
    try { ui.assertContext(this); ui.assertWritable(); this.photoController().open(task, type); }
    catch (err) { ui.error(this, err); }
  },
  onMutationFailure(err, command) {
    if (err.code !== 'PHOTO_REQUIRED' || !this.data.photoEnabled || !['complete', 'completeMinimum'].includes(command.type)) return;
    const task = (this.data.pending || []).find(item => item.id === command.id && item.date === command.date);
    if (task) this.openPhotoCheckin({ ...task, photoRequired: true }, command.type);
  },
  async loadCheckinRequirements() {
    const service = supervision();
    if (!service.status().enabled || this._loadingCheckinRequirements) return;
    const context = ui.contextKey(), version = this._showVersion, date = ui.date.today();
    this._loadingCheckinRequirements = true;
    try {
      await Promise.resolve(getApp().dataReady);
      if (!ui.isCurrentView(this, context, version)) return;
      const result = await service.list();
      if (!ui.isCurrentView(this, context, version) || date !== ui.date.today()) return;
      const requirements = {};
      for (const item of result.items) if (['active', 'scheduled'].includes(item.status) && item.role === 'subject' && item.today && item.today.date === date) requirements[item.habitId] = !!item.today.photoRequired;
      this._checkinRequirementsScope = context + ':' + date;
      this._checkinRequirements = requirements;
      this.refresh();
    } catch (_) { /* Server-side PHOTO_REQUIRED remains authoritative. */ }
    finally { this._loadingCheckinRequirements = false; }
  },
  onPhotoClose() { if (this._photoCheckin) this._photoCheckin.close(); },
  onPhotoChoose() { if (this._photoCheckin) this._photoCheckin.choose(); },
  onPhotoRetry() { return this._photoCheckin && this._photoCheckin.upload(); },
  onPhotoRemove(event) { if (this._photoCheckin) this._photoCheckin.remove(event.currentTarget.dataset.id); },
  onPhotoSubmit() { return this._photoCheckin && this._photoCheckin.submit(); },
  onPhotoBackdrop() {}
};
module.exports = { actions, photoData };

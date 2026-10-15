// Only a current-session draft: no device persistence and no background write queue.
function createPhotoCheckin(options) {
  let draft = null, choosing = false, serial = 0;
  const scope = () => options.context() + ':' + options.today();
  function current() { if (draft && draft.scope !== scope()) { draft = null; choosing = false; } return draft; }
  function view() { const d = current(); return d ? { photoOpen: d.open !== false, photoTitle: d.title, photoRequired: d.required, photoBusy: d.busy,
    photoError: d.error, photoItems: d.photos.map(p => ({ localId: p.localId, path: p.tempFilePath, status: p.status })),
    photoCanSubmit: d.photos.length > 0 && d.photos.every(p => p.status === 'ready') && !d.busy, photoPending: !!d.pending } :
    { photoOpen: false, photoTitle: '', photoRequired: false, photoBusy: false, photoError: '', photoItems: [], photoCanSubmit: false, photoPending: false }; }
  function publish() { if (options.visible()) options.change(view()); }
  return {
    view,
    open(task, type) {
      if (!task || task.date !== options.today()) throw Error('日期已变化，请刷新后打卡');
      if (!current() || draft.id !== task.id || draft.type !== type) draft = { scope: scope(), id: task.id, date: task.date, title: task.title, required: !!task.photoRequired,
        type, photos: [], busy: false, pending: false, error: '' };
      draft.open = true; publish();
    },
    close() { if (current() && !draft.busy) { draft.open = false; publish(); } },
    choose() {
      const d = current(), limit = options.maxCount ? options.maxCount() : 3; if (!d || d.busy || choosing || d.pending || d.photos.length >= limit) return;
      choosing = true;
      if (typeof options.wx.chooseMedia !== 'function') { choosing = false; d.error = '当前微信版本不支持选择照片，请升级后重试'; publish(); return; }
      options.wx.chooseMedia({ count: limit - d.photos.length, mediaType: ['image'], sourceType: ['album', 'camera'],
        success: result => {
          choosing = false; if (current() !== d) return;
          for (const file of (result.tempFiles || []).slice(0, limit - d.photos.length)) d.photos.push({ ...file, localId: 'local-' + Date.now().toString(36) + '-' + (++serial) + '-' + Math.random().toString(36).slice(2, 8), status: 'selected' });
          this.upload();
        }, fail: err => { choosing = false; if (current() === d && !/cancel/i.test(err && err.errMsg || '')) { d.error = '没有选到照片，请重试'; publish(); } }
      });
    },
    async upload() {
      const d = current(); if (!d || d.busy || d.pending) return false;
      d.busy = true; d.error = ''; publish();
      try {
        for (const photo of d.photos) {
          if (photo.status === 'ready') continue;
          photo.status = 'uploading'; publish();
          try { const result = await options.media.upload(photo, d.id, d.date); if (current() !== d) return false; photo.mediaId = result.mediaId; photo.status = 'ready'; }
          catch (err) { if (current() !== d) return false; photo.status = 'failed'; throw err; }
          publish();
        }
        return true;
      } catch (err) { if (current() === d) d.error = err.message || '上传没有完成，照片已保留，可重试'; return false; }
      finally { if (current() === d) { d.busy = false; publish(); } }
    },
    remove(localId) { const d = current(); if (!d || d.busy || d.pending) return; d.photos = d.photos.filter(p => p.localId !== localId); d.error = ''; publish(); },
    async submit() {
      const d = current(); if (!d || d.busy || !d.photos.length || d.photos.some(p => p.status !== 'ready')) return false;
      d.busy = true; d.error = ''; publish();
      try {
        const command = { type: d.type, id: d.id, date: d.date, mediaIds: d.photos.map(p => p.mediaId) };
        const saved = d.pending ? await options.retry(command) : await options.dispatch(command);
        if (current() !== d) return !!saved;
        if (saved) { draft = null; publish(); return true; }
        d.pending = !!options.pending(); d.error = d.pending ? '打卡结果尚未确认，照片已保留。请核对这次打卡。' : '打卡没有完成，照片已保留，可重试'; return false;
      } catch (err) { if (current() === d) { d.pending = !!options.pending(); d.error = err.message || '打卡未确认，照片已保留'; } return false; }
      finally { if (current() === d) d.busy = false; publish(); }
    },
    confirmed(event) {
      const d = current(), cmd = event && event.command;
      if (!d || !cmd || cmd.id !== d.id || cmd.date !== d.date || cmd.type !== d.type || !Array.isArray(cmd.mediaIds) ||
        JSON.stringify(cmd.mediaIds) !== JSON.stringify(d.photos.map(p => p.mediaId))) return;
      if (event.accountId + ':' + event.epoch !== options.context()) return;
      draft = null; publish();
    }
  };
}
module.exports = { createPhotoCheckin };

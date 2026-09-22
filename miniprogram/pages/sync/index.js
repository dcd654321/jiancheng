const { APP_NAME } = require('../../config/brand');
const ui = require('../../services/ui');
const { syncPresentation } = require('../../services/sync-presentation');

Page(ui.withLifecycle({
  data: { configured: false, consented: false, needsConsent: true, loading: false, dataUnavailable: false,
    ready: false, busy: false, pending: 0, count: 0, conflict: null, lastError: '', error: '',
    lastSyncedAt: '', lastSyncedLabel: '', syncText: '', syncAttention: false, exportPath: '' },
  refresh() {
    try {
      const status = getApp().cloudSession.status();
      this.setData({ ...status, ...syncPresentation(status), busy: status.busy || !!this._running,
        needsConsent: !status.consented,
        loading: status.consented && !status.ready && !status.lastError,
        dataUnavailable: status.consented && !status.ready && !!status.lastError });
    } catch (err) { this.setData({ error: err.message || '暂时无法读取同步状态' }); }
  },
  async run(action) {
    if (this.data.busy) return;
    this._running = true;
    this.setData({ busy: true, error: '' });
    try { await action(); }
    catch (err) { if (!this._gone) this.setData({ error: err.message || '操作失败，已有数据不会被清除' }); }
    finally { this._running = false; if (!this._gone && this._visible) this.refresh(); }
  },
  onConsentAndStart() { return this.run(() => getApp().cloudSession.acceptConsent(true)); },
  onRefresh() { return this.run(() => getApp().cloudSession.refresh()); },
  onRetry() { return this.run(() => getApp().cloudSession.retry()); },
  onUseRemote() {
    if (this.data.busy) return;
    wx.showModal({ title: '舍弃待同步记录？',
      content: '将使用云端最新版本，并舍弃当前设备尚未同步的操作。系统会先保留一份可导出的恢复副本。',
      confirmText: '采用云端', confirmColor: '#983e28',
      success: result => { if (result.confirm && !this._gone) this.run(() => getApp().cloudSession.useRemote('DISCARD_PENDING')); } });
  },
  onBackup() {
    if (this.data.busy || !this.data.ready) return;
    try {
      const data = getApp().cloudSession.backup();
      const filePath = wx.env.USER_DATA_PATH + '/yidian-cloud-sync-backup.json';
      this._running = true;
      this.setData({ busy: true, error: '' });
      wx.getFileSystemManager().writeFile({ filePath, data, encoding: 'utf8',
        success: () => { this._running = false; if (!this._gone) { this.setData({ busy: false, exportPath: filePath, error: '' }); this.onResend(); } },
        fail: () => { this._running = false; if (!this._gone) this.setData({ busy: false, error: '备份文件写入失败，已有数据没有改变' }); } });
    } catch (err) { this._running = false; this.setData({ busy: false, error: err.message || '备份未完成' }); }
  },
  onResend() {
    if (!this.data.exportPath) return;
    if (!wx.shareFileMessage) { this.setData({ error: '备份已生成，当前微信版本不支持发送文件' }); return; }
    wx.shareFileMessage({ filePath: this.data.exportPath, fileName: APP_NAME + '云同步备份.json',
      fail: () => { if (!this._gone) this.setData({ error: '备份已生成，发送未完成，可重试发送' }); } });
  }
}, { watchDate: false }));

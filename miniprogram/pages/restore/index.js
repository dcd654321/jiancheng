const ui = require('../../services/ui');
const { APP_NAME } = require('../../config/brand');

Page(ui.withLifecycle({
  data: { error: '', needsConsent: false, loading: true, dataUnavailable: false, dataReady: false,
    busy: false, hasLegacyData: false, exportPath: '', exportName: '' },
  refresh() {
    try { this.setData({ hasLegacyData: ui.store().hasLegacyData() }); }
    catch (_) { this.setData({ hasLegacyData: true }); }
    ui.read(this, () => {});
  },
  writeBackup(content, pathName, fileName) {
    if (this.data.busy) return;
    try {
      const data = content();
      const filePath = `${wx.env.USER_DATA_PATH}/${pathName}`;
      this.setData({ busy: true, error: '' });
      wx.getFileSystemManager().writeFile({ filePath, data, encoding: 'utf8',
        success: () => {
          if (this._gone) return;
          this.setData({ busy: false, exportPath: filePath, exportName: fileName, error: '' });
          this.onResend();
        },
        fail: () => { if (!this._gone) this.setData({ busy: false, error: '备份文件写入失败，已有数据没有改变' }); }
      });
    } catch (err) {
      this.setData({ busy: false });
      ui.error(this, err);
    }
  },
  onCloudBackup() {
    if (!this.data.dataReady) return;
    this.writeBackup(() => ui.store().rawBackup(), 'yidian-cloud-sync-backup.json', `${APP_NAME}当前备份.json`);
  },
  onLegacyBackup() {
    this.writeBackup(() => ui.store().legacyBackup(), 'yidian-legacy-backup.json', `${APP_NAME}旧版本机记录.json`);
  },
  onResend() {
    if (!this.data.exportPath) return;
    if (!wx.shareFileMessage) { this.setData({ error: '备份已生成，当前微信版本不支持发送文件' }); return; }
    wx.shareFileMessage({ filePath: this.data.exportPath, fileName: this.data.exportName,
      fail: () => { if (!this._gone) this.setData({ error: '备份已生成，发送未完成，可再次发送' }); } });
  }
}));

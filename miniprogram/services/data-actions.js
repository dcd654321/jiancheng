const ui = require('./ui');
const { APP_NAME } = require('../config/brand');

function removeFile(fs, filePath) {
  try { fs.unlinkSync(filePath); return true; }
  catch (err) {
    return /no such file|not exist|ENOENT/i.test(err.errMsg || err.message || '') || false;
  }
}

module.exports = {
  data: { error: '', needsConsent: false, loading: true, dataUnavailable: false, dataReady: false,
    count: 0, hideQuote: false, syncText: '', exportPath: '', exportName: '', deleting: false },
  refresh() { ui.read(this, state => { this.setData({ count: state.habits.length, hideQuote: state.settings.hideQuote }); }); },
  onManage() { wx.navigateTo({ url: '/pages/manage/index' }); },
  onSync() { wx.navigateTo({ url: '/pages/sync/index' }); },
  onBackupHub() { wx.navigateTo({ url: '/pages/restore/index' }); },
  onQuote(event) { ui.mutate(this, { type: 'settings', hideQuote: event.detail.value !== true }); },
  onPrivacy() {
    wx.showModal({ title: '隐私与数据说明', showCancel: false,
      content: '习惯名称、目标、执行日期、打卡数量和你填写的备注会保存到微信云开发环境，用于同步和换机找回。不会获取手机号、头像、昵称、联系人或位置。打卡在离线时会先保存在当前设备，联网后自动同步。你可以导出记录或清除全部数据。' });
  },
  onExport() {
    if (this._deleting) return;
    const context = ui.contextKey();
    wx.showModal({ title: '导出打卡记录', content: '是否在CSV中包含私人备注？选择“不含备注”仍会继续导出。', confirmText: '包含备注', cancelText: '不含备注',
      success: result => { if (context !== ui.contextKey()) { ui.error(this, Error('数据状态已变化，请重新导出')); return; }
        this.writeExport(() => ui.store().exportCsv(!!result.confirm), 'csv'); } });
  },
  writeExport(content, extension) {
    if (this._deleting) return;
    if (this._fileJob) { this.setData({ error: '已有导出正在处理，请稍后再试' }); return; }
    const generation = (this._fileGeneration || 0) + 1;
    const finalPath = `${wx.env.USER_DATA_PATH}/yidian-export.${extension}`;
    const token = `${Date.now().toString(36)}-${generation}-${Math.random().toString(36).slice(2, 10)}`;
    const tempPath = `${wx.env.USER_DATA_PATH}/yidian-export-${token}.${extension}.tmp`;
    const fs = wx.getFileSystemManager();
    const job = { generation, tempPath, finalPath };
    this._fileGeneration = generation; this._fileJob = job;
    const context = ui.contextKey();
    try {
      const data = content();
      const fileName = `${APP_NAME}记录-${ui.date.today()}.${extension}`;
      fs.writeFile({ filePath: tempPath, data, encoding: 'utf8',
        success: () => {
          if (this._fileJob !== job || this._gone || context !== ui.contextKey()) {
            const cleaned = removeFile(fs, tempPath);
            if (!cleaned && !this._gone && context === ui.contextKey()) this.setData({ error: '记录已清除，但一个在途导出副本清理失败，请稍后重试清除。' });
            return;
          }
          if (!removeFile(fs, finalPath)) {
            removeFile(fs, tempPath); this._fileJob = null;
            this.setData({ error: '旧导出文件无法替换，本次导出未完成，原始记录未改变' }); return;
          }
          try { fs.renameSync(tempPath, finalPath); }
          catch (err) {
            removeFile(fs, tempPath); this._fileJob = null;
            this.setData({ error: '导出文件整理失败，原始记录未改变' }); return;
          }
          this._fileJob = null;
          this.setData({ exportPath: finalPath, exportName: fileName, error: '' });
          if (wx.shareFileMessage) {
            wx.shareFileMessage({ filePath: finalPath, fileName,
              fail: () => { this.setData({ error: '导出文件已生成，文件发送未完成。可点击重新发送；开发者工具可能不支持发送。' }); } });
          } else this.setData({ error: '文件已生成，当前微信版本不支持文件发送，请在支持的真机版本重试。' });
        }, fail: () => {
          removeFile(fs, tempPath);
          if (this._fileJob !== job || this._gone || context !== ui.contextKey()) return;
          this._fileJob = null; this.setData({ error: '导出文件写入失败，原始记录未改变' });
        } });
    } catch (err) { removeFile(fs, tempPath); if (this._fileJob === job) this._fileJob = null; ui.error(this, err); }
  },
  onResend() {
    if (this.data.exportPath && wx.shareFileMessage) wx.shareFileMessage({ filePath: this.data.exportPath, fileName: this.data.exportName,
      fail: () => this.setData({ error: '文件发送未完成，原文件仍保留在本机' }) });
  },
  onDelete() {
    if (this._deleting) return;
    this._deleting = true;
    this.setData({ deleting: true });
    const release = () => { this._deleting = false; if (!this._gone) this.setData({ deleting: false }); };
    const context = ui.contextKey();
    wx.showModal({ title: '清除全部打卡数据？',
      content: '将删除云端习惯、打卡和备注，并清理本机缓存与导出文件。建议先导出备份。',
      confirmText: '继续', confirmColor: '#983e28',
      success: first => {
        if (!first.confirm || this._gone) { release(); return; }
        wx.showModal({ title: '最后确认',
          content: '删除后无法恢复。确认清除全部习惯、备注和打卡记录？',
          confirmText: '确认清除', confirmColor: '#983e28',
          success: async second => {
            if (!second.confirm || this._gone) { release(); return; }
            try {
              if (context !== ui.contextKey()) throw Error('数据状态已变化，请重新确认删除');
              await ui.store().clear('DELETE_MY_DATA');
            } catch (_) {
              if (!this._gone) this.setData({ error: '云端未确认删除，所有数据均已保留' });
              release();
              return;
            }
            const pendingPath = this._fileJob && this._fileJob.tempPath;
            this._fileGeneration = (this._fileGeneration || 0) + 1;
            this._fileJob = null;
            let cleanupFailed = false;
            try {
              const fs = wx.getFileSystemManager();
              [
              `${wx.env.USER_DATA_PATH}/yidian-export.csv`,
              `${wx.env.USER_DATA_PATH}/yidian-export.json`,
              `${wx.env.USER_DATA_PATH}/yidian-cloud-sync-backup.json`,
              `${wx.env.USER_DATA_PATH}/yidian-legacy-backup.json`,
              pendingPath
              ].filter(Boolean).forEach(filePath => { if (!removeFile(fs, filePath)) cleanupFailed = true; });
            } catch (_) { cleanupFailed = true; }
            if (!this._gone) {
              this.refresh();
              this.setData({ exportPath: '', exportName: '',
                error: cleanupFailed ? '云端数据已清除，但一个本机导出文件未能删除，请手动处理。' : '' });
              if (this._visible !== false) wx.showToast({ title: cleanupFailed ? '数据已清除' : '全部数据已清除', icon: 'none' });
            }
            release();
          }, fail: release
        });
      }, fail: release
    });
  }
};

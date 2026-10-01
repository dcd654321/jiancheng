const ui = require('../../services/ui');
const { syncPresentation } = require('../../services/sync-presentation');

Page(ui.withLifecycle({
  data: { configured: false, loading: true, dataUnavailable: false, ready: false, busy: false,
    pending: 0, deletionPending: false, count: 0, lastError: '', error: '',
    lastSyncedAt: '', lastSyncedLabel: '', syncText: '', syncAttention: false },
  refresh() {
    try {
      const status = getApp().cloudSession.status();
      this.setData({ ...status, ...syncPresentation(status), busy: status.busy || !!this._running,
        loading: !status.ready && !status.lastError,
        dataUnavailable: !status.ready && !!status.lastError });
    } catch (err) { this.setData({ error: err.message || '暂时无法读取云端状态' }); }
  },
  async run(action) {
    if (this.data.busy) return;
    const context = ui.contextKey(), showVersion = this._showVersion;
    this._running = true;
    this.setData({ busy: true, error: '' });
    try { await action(); }
    catch (err) { if (ui.isCurrentView(this, context, showVersion)) this.setData({ error: err.message || '云端操作未确认，请重试' }); }
    finally { this._running = false; if (!this._gone && this._visible) this.refresh(); }
  },
  onRefresh() { return this.run(() => getApp().cloudSession.refresh()); },
  onRetry() { return this.run(() => getApp().cloudSession.retry()); },
  onData() { wx.navigateTo({ url: '/pages/data/index' }); }
}, { watchDate: false }));

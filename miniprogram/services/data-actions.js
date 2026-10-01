const ui = require('./ui');

module.exports = {
  data: { error: '', loading: true, dataUnavailable: false, dataReady: false,
    count: 0, hideQuote: false, syncText: '', deleting: false },
  refresh() { ui.read(this, state => { this.setData({ count: state.habits.length, hideQuote: state.settings.hideQuote }); }); },
  onManage() { wx.navigateTo({ url: '/pages/manage/index' }); },
  onSync() { wx.navigateTo({ url: '/pages/sync/index' }); },
  onQuote(event) { ui.mutate(this, { type: 'settings', hideQuote: event.detail.value !== true }); },
  onPrivacy() {
    const featureNotice = require('./features-client').features().status().enabled
      ? '使用置顶或分享时，还会保存偏好和你确认创建的公开快照；私人名称与备注不进入分享。可以在我的分享撤回或删除。' : '';
    const reminderNotice = require('./features-client').features().status().reminders
      ? '申请提醒时，服务端加密保存用于本次发送的微信用户标识；处理结束清除接收标识，提醒状态在计划时间14天后进入到期清理。删除个人数据会清理提醒，已在途消息无法撤回。' : '';
    const aiNotice = getApp().planAssistant && getApp().planAssistant.status().configured
      ? '主动同意AI建议后，本次方向和可用分钟发送给DeepSeek；云端另存最多32条受限结果和请求指纹用于去重，不存模型任意文本。删除个人数据会清理这些结果，但不能撤回已发送给服务商的请求。' : '';
    wx.showModal({ title: '隐私与数据说明', showCancel: false,
      content: '习惯名称、目标、执行日期、打卡数量和你填写的备注直接保存到微信云开发环境，用于换机找回。不会获取手机号、头像、昵称、联系人或位置。断网时不能读取或修改打卡记录。' + featureNotice + reminderNotice + aiNotice + '你可以在这里清除全部云端数据。' });
  },
  onDelete() {
    if (this._deleting) return;
    this._deleting = true;
    this.setData({ deleting: true });
    const release = () => { this._deleting = false; if (!this._gone) this.setData({ deleting: false }); };
    const context = ui.contextKey();
    const showVersion = this._showVersion;
    wx.showModal({ title: '清除全部打卡数据？',
      content: '将删除云端习惯、打卡、备注和已启用功能的偏好/分享/提醒/AI结果。删除后不能恢复。',
      confirmText: '继续', confirmColor: '#983e28',
      success: first => {
        if (!first.confirm || !ui.isCurrentView(this, context, showVersion)) { release(); return; }
        wx.showModal({ title: '最后确认',
          content: '删除后无法恢复。确认清除全部习惯、备注和打卡记录？',
          confirmText: '确认清除', confirmColor: '#983e28',
          success: async second => {
            if (!second.confirm || !ui.isCurrentView(this, context, showVersion)) { release(); return; }
            try {
              if (context !== ui.contextKey()) throw Error('数据状态已变化，请重新确认删除');
              await ui.store().clear('DELETE_MY_DATA');
            } catch (_) {
              if (ui.isCurrentView(this, context, showVersion)) this.setData({ error: '云端尚未完成或未确认删除，请联网重试确认。' });
              release();
              return;
            }
            if (!this._gone && this._visible !== false && this._showVersion === showVersion) {
              this.refresh();
              this.setData({ error: '' });
              if (this._visible !== false) wx.showToast({ title: '云端数据已清除', icon: 'none' });
            }
            release();
          }, fail: release
        });
      }, fail: release
    });
  }
};

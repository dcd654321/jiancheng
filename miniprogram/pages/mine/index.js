const ui = require('../../services/ui');
const actions = require('../../services/data-actions');
Page(ui.withLifecycle({
  ...actions,
  onData() { wx.navigateTo({ url: '/pages/data/index' }); },
  onHelp() {
    wx.showModal({ title: '使用帮助', showCancel: false,
      content: '完成每次目标后点“打卡”，不会自动计时或累计数量。忙时可手动少做一点，仅影响今天。计划时间只用于排序，不发送提醒。编辑、暂停和归档明天生效。换手机使用同一微信账号可找回已同步记录，未同步前请勿清缓存。' });
  }
}));

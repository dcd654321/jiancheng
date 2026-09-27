const ui = require('../../services/ui');
const actions = require('../../services/data-actions');
const { features } = require('../../services/features-client');
const { APP_NAME } = require('../../config/brand');
Page(ui.withLifecycle({
  ...actions,
  data: { ...actions.data, sharingEnabled: false },
  refresh() { actions.refresh.call(this); this.setData({ sharingEnabled: features().status().enabled }); },
  onShares() { wx.navigateTo({ url: '/pages/share-list/index' }); },
  onShareAppMessage() { return { title: APP_NAME + '：再忙，也能做一点', path: '/pages/today/index' }; },
  onData() { wx.navigateTo({ url: '/pages/data/index' }); },
  onHelp() {
    const smallGoalHelp = ui.quickMinimumEnabled
      ? '若已完成预设的忙时目标，可点“按忙时目标打卡”；只想调整目标，请进入详情。'
      : '忙时可点“今天少做一点”调小目标，做完后再打卡；调整本身不会打卡。';
    wx.showModal({ title: '使用帮助', showCancel: false,
      content: '完成每次目标后点“打卡”，不会自动计时或累计数量。' + smallGoalHelp + '误触后可在原处短时撤销，也可展开“已完成”撤销。计划时间只用于排序，不发送提醒。编辑、暂停和归档明天生效。换手机使用同一微信账号可找回已同步记录，未同步前请勿清缓存。' });
  }
}));

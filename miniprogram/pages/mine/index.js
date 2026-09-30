const ui = require('../../services/ui');
const actions = require('../../services/data-actions');
const { features } = require('../../services/features-client');
const { themeSnapshot } = require('../../services/appearance');
const { APP_NAME } = require('../../config/brand');
Page(ui.withLifecycle({
  ...actions,
  data: { ...actions.data, sharingEnabled: false, remindersEnabled: false,
    appearanceEnabled: false, appearanceLabel: '', appearancePending: false },
  refresh() {
    actions.refresh.call(this);
    const theme = themeSnapshot();
    this.setData({ sharingEnabled: features().status().enabled, remindersEnabled: features().status().reminders,
      appearanceEnabled: theme.enabled, appearancePending: !!theme.pendingTheme,
      appearanceLabel: theme.pendingTheme ? '主题保存结果待核对' : theme.themeName });
  },
  onAppearance() { wx.navigateTo({ url: '/pages/appearance/index' }); },
  onReminders() { wx.navigateTo({url:'/pages/reminder/index'}); },
  onShares() { wx.navigateTo({ url: '/pages/share-list/index' }); },
  onShareAppMessage() { return { title: APP_NAME + '：再忙，也能做一点', path: '/pages/today/index' }; },
  onData() { wx.navigateTo({ url: '/pages/data/index' }); },
  onHelp() {
    const smallGoalHelp = ui.quickMinimumEnabled
      ? '忙时可点“忙时按…记下”完成预设的小目标；也可以点“今天少做一点”只调小今天的目标，调整本身不会记下。'
      : '忙时可点“今天少做一点”调小目标，做完后再记下；调整本身不会记下。';
    wx.showModal({ title: '使用帮助', showCancel: false,
      content: '完成每次目标后点“按…记下”，不会自动计时或累计数量。' + smallGoalHelp + '误触后可在原处撤销这次记录，也可展开“今日已完成”撤销。计划时间只用于排序，不发送提醒。编辑、暂停和归档明天生效。记录直接保存到云端；保存成功后，同一微信账号换机可读取。断网时不能记录。' });
  }
}));

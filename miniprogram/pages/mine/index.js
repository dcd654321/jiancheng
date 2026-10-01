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
      ? '忙时可点“忙时按…记下”完成预设的小目标；只想调小目标时，点任务名称进入详情，选择“只调整今天目标（不记录）”。调整本身不会记下。'
      : '忙时可点任务名称进入详情，选择“只调整今天目标（不记录）”，做完后再记下。调整本身不会记下。';
    wx.showModal({ title: '使用帮助', showCancel: false,
      content: '完成每次目标后点“按…记下”，不会自动计时或累计数量。' + smallGoalHelp + '误触后可用底部完成反馈的“撤销”，或展开“今日已完成”撤销。计划时间只用于排序，不发送提醒。编辑、暂停和归档明天生效。记录直接保存到云端；保存成功后，同一微信账号换机可读取。断网时不能记录。' });
  }
}));

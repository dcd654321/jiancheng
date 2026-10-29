const ui = require('../../services/ui');
const actions = require('../../services/data-actions');
const { features } = require('../../services/features-client');
const { themeSnapshot } = require('../../services/appearance');
const appearanceConfig = require('../../config/appearance');
const { APP_NAME } = require('../../config/brand');
const { OVERVIEW_PATH, STATIC_SHARE_IMAGE } = require('../../config/search-pages');
const { supervision } = require('../../services/supervision-client');
Page(ui.withLifecycle({
  ...actions,
  data: { ...actions.data, sharingEnabled: false, remindersEnabled: false, supervisionEnabled: false,
    todayDone: 0, socialOpen: false,
    appearanceEnabled: false, appearanceLabel: '', appearancePending: false },
  refresh() {
    ui.read(this, (state, date) => this.setData({ count: state.habits.length, hideQuote: state.settings.hideQuote,
      todayDone: ui.domain.tasksOn(state, date).filter(task => task.done).length }));
    const theme = themeSnapshot();
    this.setData({ sharingEnabled: features().status().publicShares, remindersEnabled: features().status().reminders, supervisionEnabled: supervision().status().enabled,
      appearanceEnabled: theme.enabled && appearanceConfig.showEntry !== false, appearancePending: !!theme.pendingTheme,
      appearanceLabel: theme.pendingTheme ? '主题保存结果待核对' : theme.themeName });
  },
  onAppearance() { wx.navigateTo({ url: '/pages/appearance/index' }); },
  onToggleSocial() { this.setData({ socialOpen: !this.data.socialOpen }); },
  onReminders() { wx.navigateTo({url:'/pages/reminder/index'}); },
  onShares() { wx.navigateTo({ url: '/pages/share-list/index' }); },
  onSupervisions() { wx.navigateTo({ url: '/pages/supervision/index' }); },
  onShareAppMessage() { return { title: APP_NAME + '：忙的时候，也能做一点', path: OVERVIEW_PATH, imageUrl: STATIC_SHARE_IMAGE }; },
  onData() { wx.navigateTo({ url: '/pages/data/index' }); },
  onHelp() {
    const smallGoalHelp = ui.quickMinimumEnabled
      ? '实际做完忙时目标后点忙时目标下的“打卡”；只想调小目标时，点任务名称进入详情，选择“只调整今天目标（不打卡）”。调整本身不会打卡。'
      : '忙时可点任务名称进入详情，选择“只调整今天目标（不打卡）”，做完后再打卡。调整本身不会打卡。';
    wx.showModal({ title: '使用帮助', showCancel: false,
      content: '实际做完目标后点“打卡”，不会自动计时或累计数量。' + smallGoalHelp + '误触后可展开“今日已打卡”，选择“撤销打卡”。计划时间只用于排序，不发送提醒。编辑、暂停和归档明天生效；尚未生效的暂停可以撤销，已暂停的习惯可以设置明日起恢复。打卡直接保存到云端；保存成功后，同一微信账号换机可读取。断网时不能打卡。' });
  }
}));

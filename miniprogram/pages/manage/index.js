const ui = require('../../services/ui');
Page(ui.withLifecycle({
  data: { error: '', needsConsent: false, loading: true, dataUnavailable: false, dataReady: false, habits: [] },
  refresh() {
    ui.read(this, (state, date) => {
      this.setData({ habits: state.habits.map(h => {
        const current = ui.domain.versionAt(h, date), latest = h.versions[h.versions.length - 1];
        return { id: h.id, title: (current || latest).title,
          status: current ? ({ active: '进行中', paused: '暂停中', archived: '已归档' })[current.status] : '尚未开始',
          schedule: ui.domain.weekdayText((current || latest).weekdays),
          pending: latest.effectiveDate > date ? `${latest.effectiveDate} 有变更生效` : '' };
      }) });
    });
  },
  onCreate() { wx.navigateTo({ url: '/pages/edit/index' }); },
  onOpen: ui.taskActions.onOpen
}));

const ui = require('../../services/ui');

function pendingChange(current, latest, date) {
  if (latest.effectiveDate <= date) return '';
  if (!current) return `${latest.effectiveDate} ${{ active: '开始', paused: '起暂停', archived: '起归档' }[latest.status]}`;
  const changes = [];
  if (current.status !== latest.status) {
    changes.push(latest.status === 'active' ? (current.status === 'archived' ? '取消归档' : '恢复')
      : latest.status === 'paused' ? (current.status === 'archived' ? '取消归档并暂停' : '暂停') : '归档');
  }
  if (current.title !== latest.title) changes.push(`名称改为「${latest.title}」`);
  if (current.target !== latest.target || current.unit !== latest.unit) changes.push(`目标改为 ${latest.target} ${latest.unit}`);
  if (current.minimum !== latest.minimum || (latest.minimum !== null && current.unit !== latest.unit)) {
    changes.push(latest.minimum === null ? '取消忙时目标' : `忙时目标改为 ${latest.minimum} ${latest.unit}`);
  }
  if (JSON.stringify(current.weekdays) !== JSON.stringify(latest.weekdays)) changes.push(`执行日改为${ui.domain.weekdayText(latest.weekdays)}`);
  if (current.time !== latest.time) changes.push(latest.time ? `计划时间改为 ${latest.time}` : '取消计划时间');
  return changes.length ? `${latest.effectiveDate} 起${changes.join('；')}` : '';
}

Page(ui.withLifecycle({
  data: { error: '', loading: true, dataUnavailable: false, dataReady: false, habits: [] },
  refresh() {
    ui.read(this, (state, date) => {
      this.setData({ habits: state.habits.map(h => {
        const current = ui.domain.versionAt(h, date), latest = h.versions[h.versions.length - 1];
        return { id: h.id, title: (current || latest).title,
          status: ({ active: '进行中', paused: '已暂停', archived: '已归档' })[latest.status],
          schedule: ui.domain.weekdayText((current || latest).weekdays),
          pending: pendingChange(current, latest, date) };
      }) });
    });
  },
  onCreate() { wx.navigateTo({ url: '/pages/edit/index' }); },
  onOpen: ui.taskActions.onOpen
}));

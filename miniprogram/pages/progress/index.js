const ui = require('../../services/ui');

Page(ui.withLifecycle({
  data: { error: '', needsConsent: false, loading: true, dataUnavailable: false, dataReady: false,
    days: 7, stats: null, selectedDate: '', selected: null, showHabits: false },
  refresh() {
    ui.read(this, (state, date) => {
      const stats = ui.domain.summary(state, date, this.data.days);
      stats.cells = stats.cells.map(cell => ({ ...cell, mark: cell.tone === 'rest' ? '休' : cell.done + '/' + cell.planned }));
      const selected = stats.cells.find(c => c.date === this.data.selectedDate) || stats.cells[stats.cells.length - 1];
      this.setData({ stats, selected, selectedDate: selected.date });
    });
  },
  onPeriod(event) { this.setData({ days: Number(event.currentTarget.dataset.days) }); this.refresh(); },
  onDate(event) { this.setData({ selectedDate: event.currentTarget.dataset.date }); this.refresh(); },
  onToggleHabits() { this.setData({ showHabits: !this.data.showHabits }); },
  onOpen: ui.taskActions.onOpen
}));

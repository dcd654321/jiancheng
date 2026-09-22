const ui = require('../../services/ui');
const actions = require('../../services/data-actions');
Page(ui.withLifecycle({ ...actions }));

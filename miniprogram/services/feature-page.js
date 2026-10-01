const ui = require('./ui');
const { features } = require('./features-client');
async function run(page, work, finish) {
  if (page._featureBusy) return;
  const context = ui.contextKey();
  const showVersion = page._showVersion;
  page._featureBusy = true; page.setData({ busy: true, error: '' });
  try {
    ui.assertContext(page);
    const value = await work(features());
    if (ui.isCurrentView(page, context, showVersion)) finish(value);
  } catch (err) {
    if (ui.isCurrentView(page, context, showVersion)) ui.error(page, err);
  } finally { page._featureBusy = false; if (!page._gone && page._visible) page.setData({ busy: false }); }
}
function resetOnContext(page, reset) {
  const key = ui.contextKey();
  if (page._featureContext && page._featureContext !== key) reset();
  page._featureContext = key;
}
module.exports = { run, resetOnContext };

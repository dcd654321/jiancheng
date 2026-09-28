const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { QUOTES, createQuoteSession } = require('../miniprogram/services/quotes');
const domain = require('../miniprogram/core/habits');

test('a quote is selected once per running app session without device persistence', () => {
  let calls = 0;
  const session = createQuoteSession(() => { calls++; return 0.55; });
  assert.equal(calls, 0);
  const first = session.current();
  assert.ok(QUOTES.includes(first));
  assert.equal(session.current(), first);
  assert.equal(calls, 1);
  assert.equal(createQuoteSession(() => 0).current(), QUOTES[0]);
});

test('invalid random source cannot block the quote or cloud workspace', () => {
  for (const random of [() => NaN, () => -1, () => 1, () => { throw Error('random'); }]) {
    assert.equal(createQuoteSession(random).current(), QUOTES[0]);
  }
});

test('hiding quote leaves the session selection untouched and creates no storage write', () => {
  const state = domain.emptyState();
  let writes = 0;
  const quoteSession = createQuoteSession(() => { writes++; return 0; });
  const store = { read: () => state, info: () => ({ source: 'cloud', ready: true }), contextKey: () => 'cloud:test' };
  global.wx = { showToast() {}, setNavigationBarTitle() {} };
  global.getApp = () => ({ store, quoteSession });
  let definition; global.Page = page => { definition = page; };
  const file = path.resolve(__dirname, '../miniprogram/pages/today/index.js'); delete require.cache[file]; require(file);
  const page = { ...definition, data: { ...definition.data }, setData(data) { Object.assign(this.data, data); } };
  state.settings.hideQuote = true; page.refresh(); assert.equal(page.data.quote, ''); assert.equal(writes, 0);
  state.settings.hideQuote = false; page.refresh(); assert.equal(page.data.quote, QUOTES[0]); assert.equal(writes, 1);
  state.settings.hideQuote = true; page.refresh();
  state.settings.hideQuote = false; page.refresh(); assert.equal(page.data.quote, QUOTES[0]); assert.equal(writes, 1);
});

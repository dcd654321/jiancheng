const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { QUOTES, QUOTE_KEY, createQuoteSession } = require('../miniprogram/services/quotes');
const { createStore } = require('../miniprogram/services/store');

function fixture(initial) {
  const values = { other: 'keep', [QUOTE_KEY]: initial }, writes = [];
  const storage = { getStorageSync: key => values[key], setStorageSync: (key, value) => { writes.push([key, value]); values[key] = value; } };
  return { values, writes, storage };
}

test('首次展示固定短句；初始化不读写、不随机、不联网', () => {
  const f = fixture(); let randomCalls = 0, reads = 0;
  const session = createQuoteSession({ ...f.storage, getStorageSync: key => { reads++; return f.values[key]; } }, () => { randomCalls++; return 0; });
  assert.equal(reads, 0); assert.equal(f.writes.length, 0);
  assert.equal(session.current(), QUOTES[0]); assert.equal(reads, 1); assert.equal(randomCalls, 0);
  assert.deepEqual(f.writes, [[QUOTE_KEY, 0]]); assert.equal(f.values.other, 'keep');
});

test('同一启动会话短句稳定，后续启动排除上次短句', () => {
  for (let index = 0; index < QUOTES.length; index++) for (const sample of [0, 0.5, 0.999999]) {
    const f = fixture(index), session = createQuoteSession(f.storage, () => sample);
    const quote = session.current(); assert.ok(QUOTES.includes(quote)); assert.notEqual(quote, QUOTES[index]);
    assert.equal(session.current(), quote); assert.equal(f.writes.length, 1);
    const next = createQuoteSession(f.storage, () => sample); assert.notEqual(next.current(), quote);
  }
});

test('损坏索引使用首句，不遍历、修改其他本机记录', () => {
  for (const invalid of ['', null, '0', {}, -1, 100, 1.1]) {
    const f = fixture(invalid); assert.equal(createQuoteSession(f.storage).current(), QUOTES[0]);
    assert.deepEqual(Object.keys(f.values).sort(), [QUOTE_KEY, 'other'].sort());
  }
});

test('存储读取/写入失败和随机源异常不影响页面使用', () => {
  const unavailable = { getStorageSync() { throw Error('read'); }, setStorageSync() { throw Error('write'); } };
  const session = createQuoteSession(unavailable); assert.equal(session.current(), QUOTES[0]); assert.equal(session.current(), QUOTES[0]);
  for (const random of [() => NaN, () => -1, () => 1, () => { throw Error('random'); }]) {
    assert.equal(createQuoteSession(fixture(0).storage, random).current(), QUOTES[1]);
  }
});

test('隐藏短句时不消费首次展示；首页刷新、打卡或切换开关不换句', () => {
  const f = fixture(), store = createStore(f.storage), quoteSession = createQuoteSession(f.storage, () => 0);
  global.wx = f.storage; global.getApp = () => ({ store, quoteSession });
  store.dispatch({ type: 'settings', hideQuote: true });
  let definition; global.Page = value => { definition = value; };
  const file = path.resolve(__dirname, '../miniprogram/pages/today/index.js'); delete require.cache[file]; require(file);
  const page = { ...definition, data: { ...definition.data }, setData(data) { Object.assign(this.data, data); } };
  page.refresh(); assert.equal(page.data.quote, ''); assert.equal(f.writes.filter(([key]) => key === QUOTE_KEY).length, 0);
  store.dispatch({ type: 'settings', hideQuote: false }); page.refresh(); assert.equal(page.data.quote, QUOTES[0]);
  page.refresh(); assert.equal(page.data.quote, QUOTES[0]);
  store.dispatch({ type: 'settings', hideQuote: true }); page.refresh(); assert.equal(page.data.quote, '');
  store.dispatch({ type: 'settings', hideQuote: false }); page.refresh(); assert.equal(page.data.quote, QUOTES[0]);
  assert.equal(f.writes.filter(([key]) => key === QUOTE_KEY).length, 1);
});

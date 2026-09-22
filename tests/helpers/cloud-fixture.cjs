const domain = require('../../miniprogram/core/habits');
const dates = require('../../miniprogram/core/date');
const { createApi } = require('../../server/handler');
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
const plan = (overrides = {}) => ({ title: '读一会儿', target: 5, minimum: 2, unit: '分钟', weekdays: [1,2,3,4,5,6,7], time: '12:30', ...overrides });
function fixture() {
  const db = new Map(); let tail = Promise.resolve(), serial = 0, epoch = 0;
  const f = { db, date: '2026-09-10', failWrite: false, identity: { APPID: 'wx-test-app', OPENID: 'test_user_a', SOURCE: 'wx_client' } };
  const repository = {
    transact(owner, callback) {
      const result = tail.then(async () => {
        const outcome = await callback(copy(db.get(owner) || null));
        if (f.failWrite) throw Error('Database write unavailable');
        db.set(owner, copy(outcome.account)); return copy(outcome.result);
      });
      tail = result.catch(() => {}); return result;
    }
  };
  const api = createApi({ repository, domain, dates, allowedAppId: f.identity.APPID, allowedSources: ['wx_client', 'wx_devtools'],
    clock: () => new Date(f.date + 'T04:00:00Z'), newEpoch: () => 'epoch-' + (++epoch) });
  f.api = (event, identity = f.identity) => api(event, identity);
  f.pull = () => f.api({ action: 'pull' });
  f.request = (snapshot, command, extra = {}) => ({ action: 'mutate', operationId: 'test-op-' + (++serial),
    epoch: snapshot.epoch, expectedRevision: snapshot.revision, operationDate: f.date, command, ...extra });
  f.mutate = async command => f.api(f.request(await f.pull(), command));
  f.seed = async () => f.mutate({ type: 'create', id: 'read', startDate: f.date, plan: plan() });
  return f;
}
function storageFixture() {
  const values = new Map();
  return { values, failWrite: false, getStorageSync(key) { return values.get(key); },
    setStorageSync(key, value) { if (this.failWrite) throw Error('disk full'); values.set(key, value); },
    removeStorageSync(key) { values.delete(key); } };
}
module.exports = { fixture, storageFixture, plan, copy, domain, dates };

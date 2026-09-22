'use strict';
const crypto = require('node:crypto');
const { ApiError, fail, validateEvent, canonical, RECORD_TYPES } = require('./protocol');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const MAX_ACCOUNT_BYTES = 700 * 1024;
const MAX_RECEIPTS = 256;

/** Repository must atomically commit account state and receipts together. Identity is trusted server context, never event fields. */
function createApi({ repository, domain, dates, clock = () => new Date(), newEpoch = () => crypto.randomUUID(), allowedAppId, allowedSources }) {
  function snapshot(account, owner, serverDate) {
    return { accountId: owner, epoch: account.epoch, revision: account.revision, state: clone(account.state), serverDate };
  }
  return async function handle(event, identity) {
    try {
      if (!allowedAppId || !Array.isArray(allowedSources) || !identity || identity.APPID !== allowedAppId ||
        !allowedSources.includes(identity.SOURCE) || typeof identity.OPENID !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(identity.OPENID)) fail('UNAUTHORIZED', '未取得有效的小程序身份');
      const encoded = JSON.stringify(event);
      if (!encoded || Buffer.byteLength(encoded, 'utf8') > 4096) fail('INVALID_REQUEST', '请求过大');
      validateEvent(event);
      const owner = hash(identity.APPID + ':' + identity.OPENID);
      const now = clock();
      const serverDate = dates.today(now.getTime());
      const fingerprint = hash(canonical(event));
      return await repository.transact(owner, async saved => {
        let account = saved || { epoch: newEpoch(), revision: 0, state: domain.emptyState(), receipts: [], updatedAt: now.toISOString() };
        if (!Number.isSafeInteger(account.revision) || account.revision < 0 || !Array.isArray(account.receipts) || account.receipts.length > MAX_RECEIPTS || !/^[a-zA-Z0-9_-]{1,100}$/.test(account.epoch || '')) throw Error('ACCOUNT_CORRUPT');
        domain.validateState(account.state);
        const respond = extras => ({ ok: true, ...snapshot(account, owner, serverDate), ...extras });
        if (event.action === 'pull') return { account, result: respond({}) };

        // Receipts are checked before version/date gates so a delayed retry after midnight is still acknowledged.
        const receipt = account.receipts.find(item => item.id === event.operationId);
        if (receipt) {
          if (receipt.fingerprint !== fingerprint) fail('IDEMPOTENCY_MISMATCH', '同一请求标识不能用于不同操作');
          return { account, result: respond({ operationId: event.operationId, appliedRevision: receipt.revision, replayed: true }) };
        }
        if (event.epoch !== account.epoch) return { account, result: { ok: false, code: 'EPOCH_CHANGED', message: '云端数据已重建或删除，旧记录不会自动上传', snapshot: snapshot(account, owner, serverDate) } };
        if (event.expectedRevision !== account.revision) return { account, result: { ok: false, code: 'CONFLICT', message: '另一设备已有修改，请先查看冲突', snapshot: snapshot(account, owner, serverDate) } };

        try { dates.assertDate(event.operationDate); } catch (_) { fail('INVALID_REQUEST', '操作日期无效'); }
        if (event.operationDate > serverDate) fail('FUTURE_DATE', '不能记录未来日期');
        const isRecord = event.action === 'mutate' && RECORD_TYPES.includes(event.command.type);
        if (isRecord) {
          if (event.operationDate < dates.shift(serverDate, -6)) fail('EXPIRED_OPERATION', '离线记录已超过7天恢复窗口，请保留本机备份');
          if (event.command.date !== event.operationDate) fail('INVALID_REQUEST', '记录日期与操作日期不一致');
        } else if (event.operationDate !== serverDate) fail('RECONFIRM_REQUIRED', '跨日的计划修改或删除需要重新确认');

        if (event.action === 'purge') {
          account = { epoch: newEpoch(), revision: account.revision + 1, state: domain.emptyState(), receipts: [], updatedAt: now.toISOString() };
        } else {
          const candidate = clone(account);
          try {
            candidate.state = domain.reduce(candidate.state, event.command, isRecord ? event.operationDate : serverDate);
            domain.validateState(candidate.state);
          } catch (err) { fail('INVALID_COMMAND', err.message); }
          if (candidate.state.habits.length > 100) fail('CAPACITY_LIMIT', '当前测试版最多保留100个习惯，请先导出数据');
          // Delayed completion remains an explicitly self-reported record, never proof for rewards.
          if (isRecord) {
            const r = candidate.state.records[`${event.command.id}@${event.operationDate}`];
            if (r) {
              r.lastSyncedAt = now.toISOString();
              r.delayedSync = Boolean(r.delayedSync || event.operationDate !== serverDate);
            }
          }
          candidate.revision += 1; candidate.updatedAt = now.toISOString(); account = candidate;
        }
        account.receipts.push({ id: event.operationId, fingerprint, revision: account.revision });
        account.receipts = account.receipts.slice(-MAX_RECEIPTS);
        if (Buffer.byteLength(JSON.stringify(account), 'utf8') > MAX_ACCOUNT_BYTES) fail('CAPACITY_LIMIT', '当前测试版存储容量已达上限，请导出并联系开发者');
        return { account, result: respond({ operationId: event.operationId, appliedRevision: account.revision, replayed: false }) };
      });
    } catch (err) {
      if (err instanceof ApiError) return { ok: false, code: err.code, message: err.message };
      // No notes, request body, openid, SDK errors or stack traces in client responses.
      return { ok: false, code: 'SERVICE_UNAVAILABLE', message: '服务暂不可用，本机待同步记录应保留后重试' };
    }
  };
}
module.exports = { createApi, MAX_RECEIPTS, MAX_ACCOUNT_BYTES };

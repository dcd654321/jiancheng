'use strict';
const crypto = require('node:crypto');
const { ApiError, fail, validateEvent, canonical, RECORD_TYPES } = require('./protocol');
const { authenticate } = require('./identity');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const MAX_ACCOUNT_BYTES = 700 * 1024;
const MAX_RECEIPTS = 256;

/** Repository must atomically commit account state and receipts together. Identity is trusted server context, never event fields. */
function createApi({ repository, domain, dates, clock = () => new Date(), newEpoch = () => crypto.randomUUID(), allowedAppId, allowedSources, cleanup }) {
  function snapshot(account, owner, serverDate) {
    return { accountId: owner, epoch: account.epoch, revision: account.revision, state: clone(account.state), serverDate };
  }
  return async function handle(event, identity) {
    try {
      const owner = authenticate(identity, allowedAppId, allowedSources);
      const encoded = JSON.stringify(event);
      if (!encoded || Buffer.byteLength(encoded, 'utf8') > 4096) fail('INVALID_REQUEST', '请求过大');
      validateEvent(event);
      const now = clock();
      const serverDate = dates.today(now.getTime());
      const fingerprint = hash(canonical(event));
      const outcome = await repository.transact(owner, async saved => {
        let account = saved || { epoch: newEpoch(), revision: 0, state: domain.emptyState(), receipts: [], updatedAt: now.toISOString() };
        if (!Number.isSafeInteger(account.revision) || account.revision < 0 || !Array.isArray(account.receipts) || account.receipts.length > MAX_RECEIPTS || !/^[a-zA-Z0-9_-]{1,100}$/.test(account.epoch || '')) throw Error('ACCOUNT_CORRUPT');
        domain.validateState(account.state);
        const respond = extras => ({ ok: true, ...snapshot(account, owner, serverDate), ...extras });
        const pending = () => ({ ok: false, code: 'DELETE_PENDING', cleanupEpoch: account.epoch, cleanupSourceEpoch: account.cleanupSourceEpoch });
        if (account.cleanupPending) {
          // The deletion intent is already durable in the cloud. A later pull may
          // finish cleanup even when the original client and its operation ID are gone.
          if (event.action === 'pull') return { account, result: pending() };
          const oldReceipt = account.receipts.find(item => item.id === event.operationId);
          if (event.action !== 'purge' || !oldReceipt) fail('DELETE_PENDING', '个人数据正在删除，请用原删除操作重试');
          if (oldReceipt.fingerprint !== fingerprint) fail('IDEMPOTENCY_MISMATCH', '同一请求标识不能用于不同操作');
          return { account, result: pending() };
        }
        if (event.action === 'pull') return { account, result: respond({}) };

        // Receipts are checked before version/date gates so a delayed retry after midnight is still acknowledged.
        const receipt = account.receipts.find(item => item.id === event.operationId);
        if (receipt) {
          if (receipt.fingerprint !== fingerprint) fail('IDEMPOTENCY_MISMATCH', '同一请求标识不能用于不同操作');
          return { account, result: respond({ operationId: event.operationId, appliedRevision: receipt.revision, replayed: true }) };
        }
        if (event.epoch !== account.epoch) return { account, result: { ok: false, code: 'EPOCH_CHANGED', message: '云端数据已重建或删除，请刷新后重试', snapshot: snapshot(account, owner, serverDate) } };
        if (event.expectedRevision !== account.revision) return { account, result: { ok: false, code: 'CONFLICT', message: '另一设备已有修改，请先查看冲突', snapshot: snapshot(account, owner, serverDate) } };

        try { dates.assertDate(event.operationDate); } catch (_) { fail('INVALID_REQUEST', '操作日期无效'); }
        if (event.operationDate > serverDate) fail('FUTURE_DATE', '不能记录未来日期');
        const isRecord = event.action === 'mutate' && RECORD_TYPES.includes(event.command.type);
        if (isRecord) {
          if (event.operationDate < dates.shift(serverDate, -6)) fail('EXPIRED_OPERATION', '记录日期已超出允许范围，请刷新后重试');
          if (event.command.date !== event.operationDate) fail('INVALID_REQUEST', '记录日期与操作日期不一致');
        } else if (event.operationDate !== serverDate) fail('RECONFIRM_REQUIRED', '跨日的计划修改或删除需要重新确认');

        if (event.action === 'purge') {
          const oldEpoch = account.epoch;
          account = { epoch: newEpoch(), revision: account.revision + 1, state: domain.emptyState(), receipts: [], updatedAt: now.toISOString(),
            ...(cleanup ? { cleanupPending: true, cleanupSourceEpoch: oldEpoch } : {}) };
        } else {
          const candidate = clone(account);
          try {
            candidate.state = domain.reduce(candidate.state, event.command, isRecord ? event.operationDate : serverDate);
            domain.validateState(candidate.state);
          } catch (err) { fail('INVALID_COMMAND', err.message); }
          if (candidate.state.habits.length > 100) fail('CAPACITY_LIMIT', '当前最多保留100个习惯，请先整理已有习惯');
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
        if (Buffer.byteLength(JSON.stringify(account), 'utf8') > MAX_ACCOUNT_BYTES) fail('CAPACITY_LIMIT', '云端账户容量已达上限，请联系开发者');
        return { account, result: account.cleanupPending ? pending() : respond({ operationId: event.operationId, appliedRevision: account.revision, replayed: false }) };
      });
      if (outcome.code !== 'DELETE_PENDING' || !outcome.cleanupEpoch) return outcome;
      // Cleanup is outside the account transaction and ONLY targets the deleted epoch.
      // Concurrent retries must never delete sidecars created under the new epoch.
      try {
        if (typeof cleanup !== 'function' || !outcome.cleanupSourceEpoch) throw Error('CLEANUP_NOT_CONFIGURED');
        await cleanup(owner, outcome.cleanupSourceEpoch);
        return await repository.transact(owner, async account => {
          if (!account || account.epoch !== outcome.cleanupEpoch) throw Error('CLEANUP_EPOCH_CHANGED');
          const receipt = event.action === 'pull' ? null : account.receipts.find(item => item.id === event.operationId && item.fingerprint === fingerprint);
          if (event.action !== 'pull' && !receipt) throw Error('CLEANUP_RECEIPT_MISSING');
          delete account.cleanupPending; delete account.cleanupSourceEpoch;
          return { account, result: event.action === 'pull'
            ? { ok: true, ...snapshot(account, owner, serverDate) }
            : { ok: true, ...snapshot(account, owner, serverDate), operationId: event.operationId,
              appliedRevision: receipt.revision, replayed: true } };
        });
      } catch (_) {
        return { ok: false, code: 'DELETE_PENDING', message: '删除处理中，旧分享已停用。请联网重试完成删除' };
      }
    } catch (err) {
      if (err instanceof ApiError) return { ok: false, code: err.code, message: err.message };
      // No notes, request body, openid, SDK errors or stack traces in client responses.
      return { ok: false, code: 'SERVICE_UNAVAILABLE', message: '云端服务暂不可用，请稍后重试确认' };
    }
  };
}
module.exports = { createApi, MAX_RECEIPTS, MAX_ACCOUNT_BYTES };

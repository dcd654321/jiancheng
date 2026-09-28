'use strict';

function formatSyncTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value)) return '';
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '';
  if (new Date(time).toISOString() !== value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z')) return '';
  const china = new Date(time + 8 * 60 * 60 * 1000).toISOString();
  return china.slice(0, 10) + ' ' + china.slice(11, 16) + '（北京时间）';
}

function syncPresentation(status) {
  const pending = status.pending || 0;
  const offline = status.networkOffline || status.phase === 'offline';
  let syncText = '', syncAttention = false;
  if (status.deletionPending) { syncText = '云端删除尚未确认 · 请重试'; syncAttention = true; }
  else if (pending) {
    syncText = '云端操作结果待确认';
    syncAttention = true;
  } else if (offline) { syncText = '当前离线 · 无法读取云端'; syncAttention = true; }
  else if (status.lastError) { syncText = '云端暂不可用'; syncAttention = true; }
  else if (status.busy) syncText = '正在读取云端';
  else if (status.ready) syncText = '云端数据已确认';
  return { syncText, syncAttention, lastSyncedLabel: formatSyncTime(status.lastSyncedAt) };
}

module.exports = { syncPresentation, formatSyncTime };

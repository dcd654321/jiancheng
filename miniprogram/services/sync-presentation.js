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
  if (status.conflict) { syncText = '需要处理同步冲突'; syncAttention = true; }
  else if (pending) {
    syncText = (offline ? '当前离线 · ' : '') + pending + ' 条待同步';
    syncAttention = true;
  } else if (offline) { syncText = '当前离线 · 显示上次同步记录'; syncAttention = true; }
  else if (status.lastError) { syncText = '未能确认最新数据'; syncAttention = true; }
  else if (status.busy) syncText = '正在同步';
  else if (status.ready) syncText = '数据已同步';
  return { syncText, syncAttention, lastSyncedLabel: formatSyncTime(status.lastSyncedAt) };
}

module.exports = { syncPresentation, formatSyncTime };

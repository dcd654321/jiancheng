'use strict';

class ApiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new ApiError(code, message); };
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
function object(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('INVALID_REQUEST', '请求结构无效');
  if (Object.keys(value).some(key => !allowed.includes(key))) fail('INVALID_REQUEST', '请求包含不支持的字段');
}
function string(value, min, max) { return typeof value === 'string' && value.length >= min && value.length <= max; }
function token(value) { return string(value, 1, 100) && /^[a-zA-Z0-9_-]+$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value); }
const RECORD_TYPES = ['complete', 'completeMinimum', 'undo', 'simplify', 'restore', 'note'];
function validateSearchSource(source) {
  object(source, ['visitId', 'scene', 'route', 'templateKey']);
  if (!token(source.visitId) || !Number.isInteger(source.scene) ||
    !(source.scene === 0 || (source.scene >= 1000 && source.scene <= 1999 && source.scene !== 1129)) ||
    !['pages/discover/index', 'pages/template/index', 'pages/today/index'].includes(source.route) ||
    (own(source, 'templateKey') && !['read', 'walk', 'study', 'tidy'].includes(source.templateKey)) ||
    (source.route === 'pages/template/index' && !own(source, 'templateKey')) ||
    (source.route === 'pages/today/index' && own(source, 'templateKey'))) fail('INVALID_REQUEST', '公开来源字段无效');
  return source;
}
const COMMAND_FIELDS = {
  create: ['type', 'id', 'startDate', 'plan'], edit: ['type', 'id', 'baseRevision', 'plan'],
  status: ['type', 'id', 'baseRevision', 'status'], cancelFuture: ['type', 'id', 'baseRevision'],
  deleteHabit: ['type', 'id', 'baseRevision'],
  complete: ['type', 'id', 'date', 'mediaIds'], completeMinimum: ['type', 'id', 'date', 'mediaIds'], undo: ['type', 'id', 'date'],
  simplify: ['type', 'id', 'date', 'target'], restore: ['type', 'id', 'date'],
  note: ['type', 'id', 'date', 'note'], settings: ['type', 'hideQuote']
};
function validateCommand(command) {
  if (!command || !own(COMMAND_FIELDS, command.type)) fail('INVALID_REQUEST', '不支持的操作');
  object(command, COMMAND_FIELDS[command.type]);
  if (command.type !== 'settings' && !token(command.id)) fail('INVALID_REQUEST', '习惯标识无效');
  if (['edit', 'status', 'cancelFuture', 'deleteHabit'].includes(command.type) && (!Number.isSafeInteger(command.baseRevision) || command.baseRevision < 1)) fail('INVALID_REQUEST', '计划版本无效');
  if (['create', 'edit'].includes(command.type)) {
    object(command.plan, ['title', 'target', 'minimum', 'unit', 'weekdays', 'time']);
    if (typeof command.plan.title !== 'string' || !Number.isInteger(command.plan.target) || (command.plan.minimum != null && !Number.isInteger(command.plan.minimum))) fail('INVALID_REQUEST', '目标字段类型无效');
  }
  if (command.type === 'simplify' && !Number.isInteger(command.target)) fail('INVALID_REQUEST', '目标需为整数');
  if (command.type === 'note' && !string(command.note, 0, 280)) fail('INVALID_REQUEST', '备注长度无效');
  if (own(command, 'mediaIds') && (!Array.isArray(command.mediaIds) || command.mediaIds.length > 3 ||
    command.mediaIds.some(id => !token(id)) || new Set(command.mediaIds).size !== command.mediaIds.length)) {
    fail('INVALID_REQUEST', '请选择最多3张本次打卡照片');
  }
  return command;
}
function validateEvent(event) {
  object(event, ['action', 'operationId', 'expectedRevision', 'epoch', 'operationDate', 'command', 'confirmation', 'sessionId', 'kind', 'searchSource']);
  if (!['pull', 'mutate', 'purge', 'trackDiscovery'].includes(event.action)) fail('INVALID_REQUEST', '不支持的请求');
  if (event.action === 'trackDiscovery') {
    object(event, ['action', 'epoch', 'kind', 'searchSource']);
    if (!token(event.epoch) || !['entry', 'public_view', 'template_selected'].includes(event.kind)) fail('INVALID_REQUEST', '公开事件无效');
    validateSearchSource(event.searchSource);
    if (event.kind !== 'entry' && event.searchSource.route === 'pages/today/index') fail('INVALID_REQUEST', '公开事件路由无效');
    if (event.kind === 'template_selected' && !event.searchSource.templateKey) fail('INVALID_REQUEST', '模板来源无效');
    return event;
  }
  if (event.action === 'pull') {
    if (Object.keys(event).length !== 1) fail('INVALID_REQUEST', '读取请求不接受用户身份或筛选条件');
    return event;
  }
  if (!token(event.operationId) || !token(event.epoch) || !Number.isSafeInteger(event.expectedRevision) || event.expectedRevision < 0) fail('INVALID_REQUEST', '同步请求标识或版本无效');
  if (!string(event.operationDate, 10, 10)) fail('INVALID_REQUEST', '操作日期无效');
  if (event.action === 'mutate') {
    if (own(event, 'confirmation') || own(event, 'kind')) fail('INVALID_REQUEST', '操作字段无效');
    if (own(event, 'sessionId') && !token(event.sessionId)) fail('INVALID_REQUEST', '会话标识无效');
    validateCommand(event.command);
    if (own(event, 'searchSource')) {
      if (!['create', 'complete', 'completeMinimum'].includes(event.command.type)) fail('INVALID_REQUEST', '该操作不接受公开来源');
      validateSearchSource(event.searchSource);
    }
  } else if (event.confirmation !== 'DELETE_MY_DATA' || own(event, 'command') || own(event, 'sessionId') || own(event, 'searchSource') || own(event, 'kind')) fail('CONFIRMATION_REQUIRED', '删除数据需要明确确认');
  return event;
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
module.exports = { ApiError, fail, validateEvent, validateSearchSource, canonical, token, RECORD_TYPES };

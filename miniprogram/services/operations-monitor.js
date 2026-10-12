'use strict';
const { createCloudTransport, setCloudTelemetryObserver } = require('./cloud-transport');
const { monitorFunction } = require('../config/cloud-resources');

const INTERVAL_MS = 60000;

function createOperationsMonitor(wxApi, config, options = {}) {
  const now = options.now || Date.now;
  const timers = options.timers || { setTimeout, clearTimeout };
  const contextKey = options.contextKey || (() => '');
  const accountGeneration = options.accountGeneration || (() => '');
  const newId = options.newId || (() => 'mon_' + now().toString(36) + '_' + Math.random().toString(36).slice(2, 12));
  const route = options.route || (() => {
    try { const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []; return pages.length ? pages[pages.length - 1].route : ''; } catch (_) { return ''; }
  });
  const envVersion = options.envVersion || (() => {
    try { return wxApi.getAccountInfoSync().miniProgram.envVersion; } catch (_) { return 'develop'; }
  });
  let foreground = false, disposed = false, current = null, timer = null, transport = null, serial = 0, generation = 0;
  const retries = new Set();
  function scope() { try { return contextKey() || ''; } catch (_) { return ''; } }
  function valid(context) { return !disposed && context && context.generation === generation && context.scope && context.scope === scope(); }
  function capture() { return current && valid(current) ? { scope: current.scope, generation: current.generation, accountGeneration: current.accountGeneration, ...metadata(current) } : null; }
  function metadata(context) {
    const currentRoute = context.route === undefined ? route() : context.route;
    const version = context.envVersion === undefined ? envVersion() : context.envVersion;
    return { route: typeof currentRoute === 'string' && /^[a-zA-Z0-9_/-]{0,120}$/.test(currentRoute) ? currentRoute : '',
      sessionId: context.sessionId, envVersion: ['develop', 'trial', 'release'].includes(version) ? version : 'develop' };
  }
  function send(event, context) {
    if (!valid(context)) return Promise.resolve(false);
    const attempt = () => {
      if (!valid(context)) return Promise.resolve(false);
      try {
        if (!transport) transport = (options.transportFactory || createCloudTransport)(wxApi, { ...config, functionName: monitorFunction });
        return Promise.resolve(transport({ ...event, accountGeneration: context.accountGeneration })).then(result => {
          if (!result || result.ok !== true) throw Error('MONITOR_REJECTED');
          return true;
        });
      } catch (error) { return Promise.reject(error); }
    };
    return attempt().catch(() => {
      if (!valid(context)) return false;
      return new Promise(resolve => {
        if (retries.size >= 64) {
          const oldest = retries.values().next().value;
          timers.clearTimeout(oldest.id); oldest.resolve(false); retries.delete(oldest);
        }
        const pending = { resolve, id: null };
        pending.id = timers.setTimeout(() => {
          retries.delete(pending);
          if (!valid(context)) return resolve(false);
          attempt().then(resolve, () => resolve(false));
        }, 1000);
        retries.add(pending);
      });
    });
  }
  function usage(kind, session) {
    if (!valid(session)) return;
    const reportedAt = now();
    if (kind === 'start') {
      session.startWork = send({ action: 'trackUsage', eventType: kind, sessionId: session.sessionId, elapsedMs: 0 }, session).then(accepted => {
        session.startedAt = now(); return accepted;
      });
      session.usageWork = session.startWork;
      return;
    }
    session.usageWork = session.usageWork.then(async accepted => {
      if (!accepted || !valid(session)) return false;
      const elapsedMs = Math.min(86400000, Math.max(0, Math.floor(reportedAt - session.startedAt)));
      await send({ action: 'trackUsage', eventType: kind, sessionId: session.sessionId, elapsedMs }, session);
      return true;
    });
  }
  function emit(type, eventId, payload, context = capture()) {
    if (!valid(context)) return;
    void send({ action: 'ingestEvent', type, eventId, payload: { ...metadata(context), ...payload } }, context);
  }
  function stopTimer() { if (timer !== null) timers.clearTimeout(timer); timer = null; }
  function clearRetries() { retries.forEach(pending => { timers.clearTimeout(pending.id); pending.resolve(false); }); retries.clear(); }
  function schedule() {
    stopTimer();
    if (!foreground || !current || !valid(current)) return;
    timer = timers.setTimeout(() => {
      timer = null;
      if (!foreground || !current || !valid(current)) return;
      usage('heartbeat', current); schedule();
    }, INTERVAL_MS);
  }
  function bind() {
    if (!foreground || disposed) return;
    const key = scope();
    if (current && current.scope && current.scope !== key) { generation += 1; current = null; stopTimer(); clearRetries(); }
    if (!key || (current && current.scope)) return;
    const accountEpoch = accountGeneration();
    if (typeof accountEpoch !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(accountEpoch)) return;
    current = current || { sessionId: newId(), startedAt: now(), generation };
    current.scope = key; current.accountGeneration = accountEpoch; current.startedAt = now();
    usage('start', current);
    emit('app_start', current.sessionId + ':start', {}, current);
    schedule();
  }
  const errorListener = () => emit('error', newId() + ':error:' + (++serial), { code: 'APP_ERROR' });
  const rejectionListener = () => emit('unhandled_rejection', newId() + ':rejection:' + (++serial), { code: 'UNHANDLED_REJECTION' });
  if (typeof wxApi.onError === 'function') wxApi.onError(errorListener);
  if (typeof wxApi.onUnhandledRejection === 'function') wxApi.onUnhandledRejection(rejectionListener);
  const unobserve = setCloudTelemetryObserver(wxApi, {
    capture,
    recordPerformance(context, functionName, durationMs, code) {
      emit('performance', newId() + ':perf:' + (++serial), { functionName, durationMs, code }, context);
    }
  });
  const unsubscribe = options.subscribe ? options.subscribe(bind) : () => {};
  return {
    capture,
    onReady: bind,
    onShow() { if (disposed || foreground) return; generation += 1; clearRetries(); foreground = true; current = { scope: '', sessionId: newId(), startedAt: now(), generation }; bind(); },
    onHide() { if (!foreground) return; foreground = false; stopTimer(); if (current) usage('end', current); current = null; },
    dispose() { disposed = true; foreground = false; current = null; stopTimer(); clearRetries(); unsubscribe(); unobserve();
      if (typeof wxApi.offError === 'function') wxApi.offError(errorListener);
      if (typeof wxApi.offUnhandledRejection === 'function') wxApi.offUnhandledRejection(rejectionListener); }
  };
}
module.exports = { createOperationsMonitor, INTERVAL_MS };

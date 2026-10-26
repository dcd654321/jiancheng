'use strict';

const OVERVIEW_ROUTE = 'pages/discover/index';
const TEMPLATE_ROUTE = 'pages/template/index';
const TODAY_ROUTE = 'pages/today/index';
const TEMPLATE_KEYS = ['read', 'walk', 'study', 'tidy'];
const templateKey = value => typeof value === 'string' && TEMPLATE_KEYS.includes(value) ? value : '';
const publicRoute = value => typeof value === 'string' && [OVERVIEW_ROUTE, TEMPLATE_ROUTE].includes(value.replace(/^\//, '')) ? value.replace(/^\//, '') : '';
const sceneValue = value => Number.isInteger(value) && value >= 1000 && value <= 1999 ? value : 0;

function entry(options = {}) {
  const path = options.path;
  const route = path === undefined || path === '' || path === TODAY_ROUTE || path === '/' + TODAY_ROUTE ? TODAY_ROUTE : publicRoute(path);
  return { scene: sceneValue(options.scene), route,
    templateKey: route === TEMPLATE_ROUTE ? templateKey(options.query && options.query.key) : '' };
}

function normalizeSource(value) {
  if (!value || typeof value !== 'object' || typeof value.visitId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value.visitId) ||
    !Number.isInteger(value.scene) || !(value.scene === 0 || sceneValue(value.scene)) || value.scene === 1129) return null;
  const route = value.route === TODAY_ROUTE ? TODAY_ROUTE : publicRoute(value.route), key = templateKey(value.templateKey);
  if (!route || (route === TEMPLATE_ROUTE && !key) || (value.templateKey !== undefined && !key)) return null;
  if (route === TODAY_ROUTE && key) return null;
  return { visitId: value.visitId, scene: value.scene, route, ...(key ? { templateKey: key } : {}) };
}

/** Only the current visit lives in memory. Public browsing never opens an account. */
function createSearchAttribution({ session, newId = () => 'visit_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12) }) {
  let current = null, firstShow = false, disposed = false, serial = 0;
  function scope() {
    const status = session.status();
    return !status.deletionPending && status.accountId && status.epoch ? status.accountId + ':' + status.epoch : '';
  }
  function invalidate(visit) { visit.invalid = true; visit.pending.clear(); }
  function isCurrent(visit) {
    if (disposed || !visit || current !== visit || visit.invalid || visit.scene === 1129) return false;
    const status = session.status(), key = scope();
    if (status.deletionPending || (visit.scope && visit.scope !== key)) { invalidate(visit); return false; }
    return true;
  }
  function source(visit, route = visit.route, key = visit.templateKey) {
    return { visitId: visit.id, scene: visit.scene, route, ...(key ? { templateKey: key } : {}) };
  }
  function capture() {
    const visit = current;
    if (!isCurrent(visit) || !visit.route || (visit.route === TEMPLATE_ROUTE && !visit.templateKey)) return null;
    const key = scope();
    if (!key) return null;
    if (!visit.scope) visit.scope = key;
    return source(visit);
  }
  function flush() {
    const visit = current;
    if (!isCurrent(visit) || visit.sending || !session.status().ready || typeof session.trackDiscovery !== 'function') return;
    const key = scope();
    if (!key) return;
    if (!visit.scope) visit.scope = key;
    visit.sending = true;
    // Entry, public pages and template choices are bounded to eleven items.
    // Each is attempted once; no timer, persistence or offline retry queue exists.
    void (async () => {
      for (const [id, event] of visit.pending) {
        if (!isCurrent(visit) || !session.status().ready) break;
        visit.pending.delete(id);
        try { await session.trackDiscovery(event.kind, event.source); } catch (_) { /* Best effort only. */ }
      }
    })().finally(() => { visit.sending = false; if (visit.pending.size) flush(); });
  }
  function begin(options) {
    if (current) invalidate(current);
    const normalized = entry(options);
    let id = newId();
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) id = 'visit_' + (++serial);
    current = { id, ...normalized, scope: scope(), pending: new Map(), seen: new Set(), invalid: false, sending: false };
    if (normalized.route && (normalized.route !== TEMPLATE_ROUTE || normalized.templateKey)) remember('entry', normalized.route, normalized.templateKey);
  }
  function remember(kind, route, key) {
    const visit = current;
    if (!isCurrent(visit)) return;
    const id = kind + ':' + route + ':' + key;
    if (visit.seen.has(id) || visit.seen.size >= 11) return;
    visit.seen.add(id);
    visit.pending.set(id, { kind, source: source(visit, route, key) });
    flush();
  }
  const unsubscribe = typeof session.subscribe === 'function' ? session.subscribe(flush) : () => {};
  return {
    onLaunch(options = {}) { begin(options); firstShow = true; },
    onShow(options = {}) { if (firstShow) { firstShow = false; return; } begin(options); },
    isCrawler() { return !!current && current.scene === 1129; },
    capture,
    viewPage({ route, templateKey: value } = {}) {
      if (!current) begin({});
      route = publicRoute(route);
      const key = templateKey(value);
      if (!route || (route === TEMPLATE_ROUTE && !key) || !isCurrent(current)) return;
      current.route = route; current.templateKey = route === TEMPLATE_ROUTE ? key : '';
      remember('public_view', route, current.templateKey);
    },
    chooseTemplate(value) {
      const key = templateKey(value);
      if (!key || !isCurrent(current) || !publicRoute(current.route)) return;
      current.templateKey = key;
      remember('template_selected', current.route, key);
    },
    dispose() { disposed = true; if (current) invalidate(current); unsubscribe(); }
  };
}

module.exports = { createSearchAttribution, publicRoute, sceneValue, entry, normalizeSource };

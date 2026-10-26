'use strict';

const SEARCH_SCENES = new Set([1005, 1006, 1042, 1053, 1106]);
const KEYS = new Set(['read', 'walk', 'study', 'tidy']);
const ROUTES = new Set(['pages/today/index', 'pages/discover/index', 'pages/template/index']);
const STAGES = {
  discovery_entry: 'enteredVisits',
  discovery_page_view: 'viewedVisits', discovery_template_selected: 'selectedVisits',
  habit_created: 'createdVisits', checkin_completed: 'checkinVisits'
};
const blank = () => ({ visits: 0, enteredVisits: 0, viewedVisits: 0, selectedVisits: 0, createdVisits: 0, checkinVisits: 0, orderedConversions: 0 });

function sourceOf(row) {
  const payload = row && row.payload;
  const source = payload && (row.type.startsWith('discovery_') ? payload : payload.searchSource);
  if (!source || typeof source.visitId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(source.visitId)
    || !Number.isInteger(source.scene) || (source.scene !== 0 && (source.scene < 1000 || source.scene > 1999))
    || source.scene === 1129 || !ROUTES.has(source.route)
    || (source.templateKey !== undefined && !KEYS.has(source.templateKey))
    || (source.route === 'pages/template/index' && !KEYS.has(source.templateKey))) return null;
  return source;
}

function channel(scene) {
  if (SEARCH_SCENES.has(scene)) return 'search';
  if (scene === 1027) return 'search_used';
  if ([1007, 1008].includes(scene)) return 'chat_share';
  if (scene === 1058) return 'official_article';
  return 'other';
}

function timestamp(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value.$date : value;
  const time = typeof raw === 'number' ? raw : typeof raw === 'string' ? Date.parse(raw) : NaN;
  return Number.isFinite(time) ? time : null;
}

function summarizeDiscovery(rows) {
  if (!Array.isArray(rows)) throw Error('输入须为 monitor_events 事件数组');
  const visits = new Map();
  const activity = new Map(), cohorts = new Map();
  let lastObservedDay = -Infinity;
  let ignoredRows = 0;
  for (const row of rows) {
    const stageKnown = row && Object.hasOwn(STAGES, row.type);
    const parsedSource = stageKnown ? sourceOf(row) : null;
    const activityTime = row && timestamp(row.occurredAt);
    const actor = row && row.appId === 'jiancheng' && typeof row.sourceUserId === 'string' && row.sourceUserId
      ? JSON.stringify([row.sourceUserId, row.accountGeneration || '']) : null;
    const day = activityTime === null ? null : Math.floor((activityTime + 8 * 60 * 60 * 1000) / 86400000);
    if (actor && day !== null && (row.type === 'app_start' || parsedSource) &&
      !(row.payload && row.payload.scene === 1129)) {
      if (!activity.has(actor)) activity.set(actor, new Set());
      activity.get(actor).add(day); lastObservedDay = Math.max(lastObservedDay, day);
    }
    if (!row || row.appId !== 'jiancheng' || !Object.hasOwn(STAGES, row.type)) { ignoredRows++; continue; }
    const source = parsedSource, time = activityTime;
    if (!source || time === null || typeof row.sourceUserId !== 'string' || !row.sourceUserId) { ignoredRows++; continue; }
    if (!cohorts.has(actor) || day < cohorts.get(actor)) cohorts.set(actor, day);
    // A random visit ID is scoped to the server-confirmed actor and generation.
    // Output exposes aggregate counts only, never either identity field.
    const id = JSON.stringify([row.sourceUserId, row.accountGeneration || '', source.visitId]);
    let visit = visits.get(id);
    if (!visit) {
      visit = { scene: source.scene, templateKey: source.templateKey || (source.route === 'pages/today/index' ? 'none' : 'overview'), stages: {}, stageTimes: {}, templateAt: -Infinity };
      visits.set(id, visit);
    }
    if (visit.scene !== source.scene) { ignoredRows++; continue; }
    const stage = STAGES[row.type];
    visit.stages[stage] = Math.min(visit.stages[stage] ?? Infinity, time);
    if (!visit.stageTimes[stage]) visit.stageTimes[stage] = new Set();
    visit.stageTimes[stage].add(time);
    if (source.templateKey && time >= visit.templateAt) {
      visit.templateKey = source.templateKey; visit.templateAt = time;
    }
  }
  const totals = blank(), byChannel = {}, byTemplate = {};
  const add = (counts, visit) => {
    counts.visits++;
    for (const stage of Object.values(STAGES)) if (visit.stages[stage] !== undefined) counts[stage]++;
    let previous = -Infinity, ordered = true;
    for (const stage of ['viewedVisits', 'selectedVisits', 'createdVisits', 'checkinVisits']) {
      const next = [...(visit.stageTimes[stage] || [])].filter(time => time >= previous).sort((a, b) => a - b)[0];
      if (next === undefined) { ordered = false; break; }
      previous = next;
    }
    if (ordered) counts.orderedConversions++;
  };
  for (const visit of visits.values()) {
    const group = channel(visit.scene);
    add(totals, visit);
    add(byChannel[group] || (byChannel[group] = blank()), visit);
    add(byTemplate[visit.templateKey] || (byTemplate[visit.templateKey] = blank()), visit);
  }
  const retention = { cohortAccounts: cohorts.size };
  for (const [name, offset] of [['nextDay', 1], ['day7', 7]]) {
    let eligibleAccounts = 0, returnedAccounts = 0;
    for (const [actor, day] of cohorts) {
      if (day + offset > lastObservedDay) continue;
      eligibleAccounts++;
      if (activity.get(actor) && activity.get(actor).has(day + offset)) returnedAccounts++;
    }
    retention[name] = { eligibleAccounts, returnedAccounts,
      rate: eligibleAccounts ? returnedAccounts / eligibleAccounts : null };
  }
  return { totals, byChannel, byTemplate, retention, ignoredRows,
    scope: '仅导出事件范围内已关联账户的访问；打卡按访问去重，不代表用户终身首次打卡；匿名纯浏览不在此报表内。' };
}

module.exports = { summarizeDiscovery };

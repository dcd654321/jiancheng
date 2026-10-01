'use strict';

const { THEMES, DEFAULT_THEME, THEME_NAMES } = require('../config/theme-tokens');

// 主题状态与页面订阅：页面只读取当前主题并订阅变化；预览由页面自行持有。
// 已保存主题仅在合法云回执后更新；账户/epoch 变化立即回到默认浅底并丢弃旧回执权限。
const TAB_ICONS = [
  ['assets/tabbar/today.png', 'assets/tabbar/today-selected.png', 'assets/tabbar/today-selected-paper.png'],
  ['assets/tabbar/progress.png', 'assets/tabbar/progress-selected.png', 'assets/tabbar/progress-selected-paper.png'],
  ['assets/tabbar/mine.png', 'assets/tabbar/mine-selected.png', 'assets/tabbar/mine-selected-paper.png']
];

function createAppearanceController({ client, wxApi, session }) {
  let saved = { theme: DEFAULT_THEME, revision: null };
  let loadState = 'idle', loadError = '', accountKey = '', reading = null;
  let generation = 0;
  const listeners = new Set();

  function status() {
    let current = { enabled: false, frozen: null, contextKey: '' };
    try { current = client.status(); } catch (_) { /* 未配置或未就绪时保持默认外观 */ }
    return current;
  }
  function view() {
    syncContext();
    const s = status();
    return { theme: saved.theme, revision: saved.revision, enabled: s.enabled, key: accountKey,
      loadState, loadError, pendingTheme: s.frozen || '', themeName: THEME_NAMES[saved.theme] };
  }
  function notify() { listeners.forEach(listener => { try { listener(view()); } catch (_) { /* 页面回调不能打断主题状态 */ } }); }
  function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  function syncContext() {
    const key = status().contextKey || '';
    if (key === accountKey) return false;
    accountKey = key; generation += 1; reading = null;
    saved = { theme: DEFAULT_THEME, revision: null }; loadState = 'idle'; loadError = '';
    client.invalidate(); applyNative(DEFAULT_THEME);
    return true;
  }
  function ticket() { syncContext(); return { key: accountKey, generation }; }
  function isCurrent(request) { syncContext(); return request.key === accountKey && request.generation === generation; }

  // 原生区域：官方 API 可用则换色，失败保留中性浅底且不阻塞业务页面。
  function applyNative(theme) {
    const tokens = THEMES[theme] || THEMES[DEFAULT_THEME];
    const call = (fn, payload) => { try { if (typeof fn === 'function') fn.call(wxApi, payload); } catch (_) { /* 原生配色可选 */ } };
    call(wxApi.setNavigationBarColor, { frontColor: '#000000', backgroundColor: tokens.page });
    call(wxApi.setBackgroundColor, { backgroundColor: tokens.page, backgroundColorTop: tokens.page, backgroundColorBottom: tokens.page });
    call(wxApi.setTabBarStyle, { color: tokens.secondary, selectedColor: tokens.primary, backgroundColor: tokens.surface, borderStyle: 'white' });
    TAB_ICONS.forEach(([normal, mist, paper], index) => {
      call(wxApi.setTabBarItem, { index, iconPath: normal, selectedIconPath: theme === 'paper' ? paper : mist });
    });
  }

  function applyConfirmed(value) {
    if (saved.revision !== null && value.revision < saved.revision) { loadState = 'ready'; loadError = ''; return false; }
    const next = { theme: value.theme === 'paper' ? 'paper' : DEFAULT_THEME, revision: value.revision };
    const changed = next.theme !== saved.theme || next.revision !== saved.revision;
    saved = next; loadState = 'ready'; loadError = '';
    if (changed) applyNative(saved.theme);
    return changed;
  }

  // 冷启动/账户就绪后去重读取：同一上下文最多一个在途请求，不阻塞核心数据。
  function ensureRead(force = false) {
    syncContext();
    if (!status().enabled) { loadState = 'disabled'; notify(); return Promise.resolve(null); }
    let key = '';
    try { key = client.contextKey(); } catch (_) { loadState = saved.revision === null ? 'unavailable' : loadState; return Promise.resolve(null); }
    if (reading) return reading.work;
    if (!force && saved.revision !== null) return Promise.resolve(view());
    loadState = 'loading'; notify();
    const flight = ticket();
    flight.work = client.read(force).then(value => {
      if (!isCurrent(flight)) return null;
      applyConfirmed(value); notify();
      return view();
    }).catch(err => {
      if (!isCurrent(flight)) return null;
      loadState = 'unavailable'; loadError = err.message || '主题暂未读取，可稍后重试'; notify();
      return null;
    }).finally(() => { if (reading === flight) reading = null; });
    reading = flight;
    return flight.work;
  }

  // 保存由页面发起；回执合法才应用全局，离页不影响已发出的云事务。
  function save(theme) {
    const request = ticket();
    return client.save(theme).then(value => {
      if (!isCurrent(request)) { const err = Error('账户数据已变化，已忽略旧页面的结果'); err.code = 'EPOCH_CHANGED'; throw err; }
      applyConfirmed(value); notify();
      return view();
    });
  }
  function replay() {
    const request = ticket();
    return client.replay().then(value => {
      if (!isCurrent(request)) return view();
      if (value) { applyConfirmed(value); notify(); }
      return view();
    });
  }

  let wasReadable = false;
  const unsubscribe = session && typeof session.subscribe === 'function' ? session.subscribe(() => {
    const changed = syncContext(), s = session.status();
    const readable = !!s.ready && !s.pending && !s.conflict && !s.deletionPending && !s.networkOffline;
    const becameReadable = readable && !wasReadable;
    wasReadable = readable;
    if (changed) notify();
    if (accountKey && readable && (changed || becameReadable) && saved.revision === null) ensureRead();
  }) : null;
  return {
    view, subscribe, ensureRead, save, replay,
    current: () => view().theme,
    confirmedTheme: () => view().theme,
    hasRevision: () => view().revision !== null,
    invalidate() { client.invalidate(); },
    dispose() { if (unsubscribe) unsubscribe(); listeners.clear(); }
  };
}

// 页面通过这里读取主题；测试与旧页面没有外观控制器时回退默认薄雾绿。
function appearanceController() {
  const app = getApp();
  return app && app.appearanceController ? app.appearanceController : null;
}
function themeSnapshot() {
  const controller = appearanceController();
  if (!controller) return { theme: DEFAULT_THEME, revision: null, enabled: false, loadState: 'idle', loadError: '', pendingTheme: '', themeName: THEME_NAMES[DEFAULT_THEME], primary: THEMES[DEFAULT_THEME].primary };
  const view = controller.view();
  // 关键图形（如完成小图标）需要与主题一致的实色，统一从这里取，不在页面硬编码。
  return { ...view, primary: (THEMES[view.theme] || THEMES[DEFAULT_THEME]).primary };
}

module.exports = { createAppearanceController, appearanceController, themeSnapshot, TAB_ICONS };

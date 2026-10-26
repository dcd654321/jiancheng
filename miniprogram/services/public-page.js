'use strict';

const { themeSnapshot, appearanceController } = require('./appearance');

function currentApp() {
  try { return typeof getApp === 'function' ? getApp() : null; } catch (_) { return null; }
}

function trackPublicPage(route, templateKey) {
  try {
    const app = currentApp();
    if (app && app.searchAttribution && typeof app.searchAttribution.viewPage === 'function') {
      app.searchAttribution.viewPage(templateKey ? { route, templateKey } : { route });
    }
  } catch (_) { /* 来源统计不能阻塞静态内容。 */ }
}

function choosePublicTemplate(key) {
  try {
    const app = currentApp();
    if (app && app.searchAttribution && typeof app.searchAttribution.chooseTemplate === 'function') app.searchAttribution.chooseTemplate(key);
  } catch (_) { /* 统计不可用时仍可进入确认页。 */ }
}

function setPublicTitle(title) {
  try { if (typeof wx.setNavigationBarTitle === 'function') wx.setNavigationBarTitle({ title }); }
  catch (_) { /* 原生标题 API 不影响公开内容。 */ }
}

function releaseTheme(page) {
  if (page._unsubscribePublicTheme) page._unsubscribePublicTheme();
  page._unsubscribePublicTheme = null;
}

// 公开页只订阅已经存在的主题，不绑定账户读取、会话恢复或日期定时器。
function withPublicLifecycle(definition) {
  return { ...definition,
    onShow() {
      this._visible = true;
      try {
        const app = currentApp();
        if (app && typeof app.onPublicContentShown === 'function') app.onPublicContentShown();
      } catch (_) { /* 公开内容不依赖账户恢复或监控服务。 */ }
      releaseTheme(this);
      const updateTheme = () => {
        if (!this._visible) return;
        let theme = 'mist';
        try { theme = themeSnapshot().theme === 'paper' ? 'paper' : 'mist'; } catch (_) { /* 无账户可直接使用默认主题。 */ }
        this.setData({ theme });
      };
      try {
        const controller = appearanceController();
        if (controller && typeof controller.subscribe === 'function') this._unsubscribePublicTheme = controller.subscribe(updateTheme);
      } catch (_) { /* 无应用上下文仍可直接浏览。 */ }
      updateTheme();
      try { if (typeof wx.showShareMenu === 'function') wx.showShareMenu({ menus: ['shareAppMessage'] }); } catch (_) { /* 分享入口可选。 */ }
      if (definition.onShow) definition.onShow.call(this);
    },
    onHide() { this._visible = false; releaseTheme(this); if (definition.onHide) definition.onHide.call(this); },
    onUnload() { this._visible = false; releaseTheme(this); if (definition.onUnload) definition.onUnload.call(this); }
  };
}

module.exports = { withPublicLifecycle, trackPublicPage, choosePublicTemplate, setPublicTitle };

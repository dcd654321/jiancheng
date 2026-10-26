const { INTRODUCTION, SEARCH_TEMPLATES, TEMPLATE_ROUTE, OVERVIEW_PATH, STATIC_SHARE_IMAGE, getSearchTemplate, templatePath } = require('../../config/search-pages');
const { withPublicLifecycle, trackPublicPage, choosePublicTemplate, setPublicTitle } = require('../../services/public-page');

Page(withPublicLifecycle({
  data: { theme: 'mist', template: null, related: [], overviewPath: OVERVIEW_PATH, error: '' },
  onLoad(options = {}) {
    const template = getSearchTemplate(options && options.key);
    this.setData({ template, related: template ? SEARCH_TEMPLATES.filter(item => item.key !== template.key) : [], error: '' });
    setPublicTitle(template ? template.navigationTitle : '查看习惯模板 · 渐成');
  },
  onShow() { if (this.data.template) trackPublicPage(TEMPLATE_ROUTE, this.data.template.key); },
  onUseTemplate() {
    const template = getSearchTemplate(this.data.template && this.data.template.key);
    if (!template) return;
    this.setData({ error: '' });
    choosePublicTemplate(template.key);
    wx.navigateTo({ url: '/pages/edit/index?template=' + template.key,
      fail: () => { if (this._visible) this.setData({ error: '确认页暂时未打开，请重试。习惯尚未创建。' }); } });
  },
  onShareAppMessage() {
    const template = getSearchTemplate(this.data.template && this.data.template.key);
    return { title: template ? template.shareTitle : INTRODUCTION.shareTitle,
      path: template ? templatePath(template.key) : OVERVIEW_PATH, imageUrl: STATIC_SHARE_IMAGE };
  }
}));

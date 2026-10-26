const { INTRODUCTION, SEARCH_TEMPLATES, OVERVIEW_ROUTE, OVERVIEW_PATH, STATIC_SHARE_IMAGE } = require('../../config/search-pages');
const { withPublicLifecycle, trackPublicPage, setPublicTitle } = require('../../services/public-page');

Page(withPublicLifecycle({
  data: { theme: 'mist', intro: INTRODUCTION, templates: SEARCH_TEMPLATES },
  onLoad() { setPublicTitle(INTRODUCTION.title); },
  onShow() { trackPublicPage(OVERVIEW_ROUTE); },
  onShareAppMessage() { return { title: INTRODUCTION.shareTitle, path: OVERVIEW_PATH, imageUrl: STATIC_SHARE_IMAGE }; }
}));
